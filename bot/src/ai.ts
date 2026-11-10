// NEAR AI Cloud client: OpenAI-compatible chat completions with tool calls,
// plus the model's TEE attestation report. There is deliberately no fallback
// provider: if NEAR AI is unreachable, callers get AiUnavailable and the bot
// says so.
//
// Cost controls: short replies (max_tokens 300), at most MAX_TOOL_ROUNDS tool
// rounds, no chat history, and a daily USD budget checked before every call.
// Each call's token usage and cost is logged.

import { randomBytes } from "node:crypto";

export class AiUnavailable extends Error {}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<unknown>;
}

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface Answer {
  text: string;
  /** Tools the model called, in order, e.g. `get_round_status({})`. */
  calls: string[];
}

export interface Attestation {
  model: string;
  nonceEchoed: boolean;
  intelQuote: boolean;
  gpuEvidence: boolean;
  signingAddress?: string;
}

const MAX_TOOL_ROUNDS = 2;
const MAX_TOKENS = 300;
const TIMEOUT_MS = 45_000;

/** Where the daily spend is kept (the bot's state file). */
export interface SpendBook {
  /** USD spent today (UTC). */
  today(): number;
  add(usd: number): void;
}

export class MemorySpend implements SpendBook {
  private day = "";
  private usd = 0;
  today(): number {
    return this.day === utcDay() ? this.usd : 0;
  }
  add(usd: number): void {
    if (this.day !== utcDay()) [this.day, this.usd] = [utcDay(), 0];
    this.usd += usd;
  }
}

export const utcDay = () => new Date().toISOString().slice(0, 10);

export class NearAi {
  readonly model: string;
  readonly dailyBudgetUsd: number;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly spend: SpendBook;
  /** USD per token, from the model list; fetched once. */
  private price?: { in: number; out: number };

  constructor(opts: { apiKey?: string; baseUrl?: string; model: string; fetch?: typeof fetch; dailyBudgetUsd?: number; spend?: SpendBook; price?: { in: number; out: number } }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://cloud-api.near.ai/v1").replace(/\/$/, "");
    this.model = opts.model;
    this.fetch = opts.fetch ?? fetch;
    this.dailyBudgetUsd = opts.dailyBudgetUsd ?? 0.5;
    this.spend = opts.spend ?? new MemorySpend();
    this.price = opts.price;
  }

  private async pricing(): Promise<{ in: number; out: number }> {
    if (this.price) return this.price;
    const res = await this.fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const list = (await res.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
    const p = list.data?.find((m) => m.id === this.model)?.pricing;
    if (!p?.prompt || !p.completion) throw new AiUnavailable(`no published price for ${this.model}, so the budget can't be enforced`);
    return (this.price = { in: Number(p.prompt), out: Number(p.completion) });
  }

  /** Answers `question`, letting the model call `tools` up to MAX_TOOL_ROUNDS times. */
  async answer(system: string, question: string, tools: Tool[]): Promise<Answer> {
    const messages: Message[] = [
      { role: "system", content: system },
      { role: "user", content: question },
    ];
    const calls: string[] = [];
    const specs = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

    for (let round = 0; ; round++) {
      const reply = await this.chat({ messages, tools: specs, tool_choice: round < MAX_TOOL_ROUNDS ? "auto" : "none" });
      const toolCalls = reply.tool_calls ?? [];
      if (toolCalls.length === 0 || round >= MAX_TOOL_ROUNDS) {
        return { text: clean(reply.content ?? ""), calls };
      }
      messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const tool = tools.find((t) => t.name === call.function.name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // A malformed call gets an error result, like an unknown tool.
        }
        calls.push(`${call.function.name}(${JSON.stringify(args)})`);
        const result = tool ? await tool.run(args).catch((e: unknown) => ({ error: String(e) })) : { error: `unknown tool ${call.function.name}` };
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 4_000) });
      }
    }
  }

  private async chat(body: Record<string, unknown>): Promise<Message> {
    if (!this.apiKey) throw new AiUnavailable("NEARAI_API_KEY is not set");
    if (this.spend.today() >= this.dailyBudgetUsd) {
      throw new AiUnavailable(`Today's AI budget ($${this.dailyBudgetUsd.toFixed(2)}) is used up; it resets at 00:00 UTC`);
    }
    let price: { in: number; out: number };
    try {
      price = await this.pricing();
    } catch (e) {
      throw e instanceof AiUnavailable ? e : new AiUnavailable(`NEAR AI Cloud is unreachable (${e instanceof Error ? e.message : e})`);
    }
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, max_tokens: MAX_TOKENS, temperature: 0.2, ...body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new AiUnavailable(`NEAR AI Cloud is unreachable (${e instanceof Error ? e.message : e})`);
    }
    const json = (await res.json().catch(() => ({}))) as {
      choices?: { message: Message }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    const tokensIn = json.usage?.prompt_tokens ?? 0;
    const tokensOut = json.usage?.completion_tokens ?? 0;
    const cost = tokensIn * price.in + tokensOut * price.out;
    this.spend.add(cost);
    console.log(
      `ai: ${this.model} HTTP ${res.status} · ${tokensIn} in + ${tokensOut} out tokens · $${cost.toFixed(6)} · today $${this.spend.today().toFixed(4)} of $${this.dailyBudgetUsd.toFixed(2)}`,
    );
    if (!res.ok || !json.choices?.[0]) {
      throw new AiUnavailable(`NEAR AI Cloud returned HTTP ${res.status}${json.error?.message ? `: ${json.error.message}` : ""}`);
    }
    return json.choices[0].message;
  }

  /**
   * Fetches the model's attestation report with a fresh nonce and checks the
   * nonce echo and that TEE evidence is present. Full quote verification
   * (Intel DCAP, GPU evidence) is out of scope here.
   */
  async attestation(): Promise<Attestation> {
    const nonce = randomBytes(32).toString("hex");
    const url = `${this.baseUrl}/attestation/report?${new URLSearchParams({ model: this.model, provider: "near", signing_algo: "ecdsa", nonce })}`;
    let res: Response;
    try {
      res = await this.fetch(url, { headers: { Accept: "application/json", "x-no-aliasing": "true" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new AiUnavailable(`NEAR AI Cloud is unreachable (${e instanceof Error ? e.message : e})`);
    }
    const report = (await res.json().catch(() => ({}))) as {
      model_attestations?: { request_nonce?: string; intel_quote?: string; nvidia_payload?: unknown; signing_address?: string }[];
      error?: { message?: string };
    };
    if (!res.ok) throw new AiUnavailable(`attestation: HTTP ${res.status}${report.error?.message ? `: ${report.error.message}` : ""}`);
    const a = report.model_attestations?.[0];
    return {
      model: this.model,
      nonceEchoed: a?.request_nonce === nonce,
      intelQuote: Boolean(a?.intel_quote),
      gpuEvidence: Boolean(a?.nvidia_payload),
      signingAddress: a?.signing_address,
    };
  }
}

/** Drops reasoning blocks some models put in `content`. */
function clean(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
