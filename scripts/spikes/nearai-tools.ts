// Spike: does a NEAR AI Cloud model do OpenAI-style tool calling?
//
// Uses as few paid calls as possible: one question that should produce a tool
// call, then one call with a fake tool result for the final answer. Prints
// token usage and cost from the model's published price.
//
// Run: node --env-file=.env scripts/spikes/nearai-tools.ts [model-id] [--no-think]
//   --no-think  asks the model's chat template to skip reasoning

const BASE = process.env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1";
const KEY = process.env.NEARAI_API_KEY;
const model = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? process.env.NEARAI_MODEL ?? "Qwen/Qwen3.8-27B";
const noThink = process.argv.includes("--no-think");

const models = (await (await fetch(`${BASE}/models`)).json()) as any;
const info = models.data?.find((m: any) => m.id === model);
if (!info) throw new Error(`${model} is not in the model list`);
const price = { in: Number(info.pricing.prompt), out: Number(info.pricing.completion) };
console.log(`${model}: tools ${info.supported_features?.includes("tools")}, $${info.pricing.input}/M in, $${info.pricing.output}/M out`);
if (!KEY) throw new Error("NEARAI_API_KEY is not set");

const tools = [
  {
    type: "function",
    function: {
      name: "get_round_status",
      description: "Current round: who paid, who hasn't, recipient.",
      parameters: { type: "object", properties: { circle_id: { type: "string" } } },
    },
  },
];
let spent = 0;

async function chat(messages: unknown[]) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      tools,
      max_tokens: 300,
      temperature: 0.2,
      ...(noThink ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    }),
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  const u = json.usage ?? {};
  const cost = (u.prompt_tokens ?? 0) * price.in + (u.completion_tokens ?? 0) * price.out;
  spent += cost;
  const msg = json.choices[0].message;
  const reasoning = msg.reasoning_content ?? msg.reasoning ?? "";
  console.log(
    `  call: ${u.prompt_tokens} in + ${u.completion_tokens} out tokens = $${cost.toFixed(6)}; finish ${json.choices[0].finish_reason}; reasoning ${reasoning.length} chars`,
  );
  return msg;
}

const messages: any[] = [
  { role: "system", content: "Treasurer of savings circle 7. Use tools; don't guess. Answer in one sentence." },
  { role: "user", content: "Who still has to pay?" },
];
const first = await chat(messages);
const call = first.tool_calls?.[0];
if (!call) {
  console.log(`no tool call; content: ${JSON.stringify(first.content)}`);
  console.log(`RESULT: no tool call. Spent $${spent.toFixed(6)}`);
  process.exit(1);
}
console.log(`  tool call: ${call.function.name}(${call.function.arguments})`);
messages.push(first, {
  role: "tool",
  tool_call_id: call.id,
  content: JSON.stringify({ round: 2, unpaid: ["bao.testnet"], recipient: "carmen.testnet" }),
});
const second = await chat(messages);
console.log(`  answer: ${JSON.stringify(second.content)}`);
console.log(`RESULT: tool calling ${second.content?.includes("bao") ? "works" : "returned no usable answer"}. Spent $${spent.toFixed(6)}`);
