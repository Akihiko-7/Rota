// Rota Harvest in the bot (testnet only): /harvest <id> shows a pot, and the
// scheduler drives each followed pot through its permissionless steps with the
// Harvest treasurer's key (which NEAR only accepts for stake, unstake,
// withdraw and distribute on the Harvest contract), posting each stage and a
// reminder when the pot is ripe. Rewards are read from the pool on chain; the
// ripe time is an estimate from current epoch timing and is labelled as one.

import type { Account } from "near-api-js";
import { Chain, TGAS, actions, failureOf } from "../../scripts/lib/near.ts";
import { esc, receipt, short, span, utc, whoList } from "./format.ts";
import type { Store } from "./store.ts";

export type HarvestStage = "Filling" | "Staking" | "Staked" | "Unstaking" | "Unbonding" | "Withdrawing" | "Ripe" | "Distributed" | "Cancelled";

export interface Pot {
  id: string;
  name: string;
  pool_id: string;
  fill_ends_ms: number;
  term_epochs: number;
  stage: HarvestStage;
  deposits: { account_id: string; amount: string }[];
  total: string;
  staked_epoch: number | null;
  unstaked_epoch: number | null;
  returned: string;
  payouts: { account_id: string; amount: string; status: string }[];
}

export interface PotStatus {
  stage: HarvestStage;
  now_ms: number;
  epoch_height: number;
  fill_ends_ms: number;
  can_stake: boolean;
  unstake_from_epoch: number | null;
  can_unstake: boolean;
  withdrawable_from_epoch: number | null;
  can_distribute: boolean;
}

export interface EpochTiming {
  height: number;
  startMs: number;
  msPerEpoch: number;
}

export interface Harvest {
  readonly contractId: string;
  pot(id: string): Promise<Pot | null>;
  status(id: string): Promise<PotStatus>;
  /** What the Harvest contract holds in the pool right now (staked + unstaked), in yocto. */
  inPool(poolId: string): Promise<bigint>;
  epochs(): Promise<EpochTiming>;
  step(id: string, step: "stake" | "unstake" | "withdraw" | "distribute"): Promise<{ ok: boolean; hash?: string; url?: string; error?: string }>;
}

export class NearHarvest implements Harvest {
  readonly contractId: string;
  private readonly chain: Chain;
  private readonly treasurer: Account;

  constructor(chain: Chain, contractId: string, treasurer: Account) {
    this.chain = chain;
    this.contractId = contractId;
    this.treasurer = treasurer;
  }

  /** Refuses any key but one limited to the four Harvest steps on this contract. */
  async checkKey(): Promise<string> {
    const publicKey = await this.treasurer.getSigner()!.getPublicKey();
    const key = await this.chain.provider.viewAccessKey({ accountId: this.treasurer.accountId, publicKey });
    const fc = (key.permission as { FunctionCall?: { receiver_id: string; method_names: string[] } }).FunctionCall;
    const steps = ["stake", "unstake", "withdraw", "distribute"];
    if (!fc || fc.receiver_id !== this.contractId || fc.method_names.length !== 4 || !steps.every((s) => fc.method_names.includes(s))) {
      throw new Error(`the Harvest treasurer key must be a function-call key for [${steps}] on ${this.contractId}`);
    }
    return `${this.treasurer.accountId}: function-call key, receiver ${fc.receiver_id}, methods [${fc.method_names}]`;
  }

  pot(id: string) {
    return this.chain.view<Pot | null>(this.contractId, "get_pot", { pot_id: id });
  }

  status(id: string) {
    return this.chain.view<PotStatus>(this.contractId, "get_status", { pot_id: id });
  }

  async inPool(poolId: string) {
    return BigInt(await this.chain.view<string>(poolId, "get_account_total_balance", { account_id: this.contractId }));
  }

  async epochs(): Promise<EpochTiming> {
    const rpc = async (method: string, params: unknown) => {
      const res = await fetch(this.chain.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      return ((await res.json()) as { result: Record<string, never> }).result;
    };
    const config = (await rpc("EXPERIMENTAL_protocol_config", { finality: "final" })) as { epoch_length: number };
    const v = (await rpc("validators", [null])) as { epoch_start_height: number; epoch_height: number };
    const head = ((await rpc("block", { finality: "final" })) as { header: { height: number; timestamp_nanosec: string } }).header;
    const start = ((await rpc("block", { block_id: v.epoch_start_height })) as { header: { timestamp_nanosec: string } }).header;
    const startMs = Number(BigInt(start.timestamp_nanosec) / 1_000_000n);
    const nowMs = Number(BigInt(head.timestamp_nanosec) / 1_000_000n);
    const msPerBlock = (nowMs - startMs) / Math.max(1, head.height - v.epoch_start_height);
    return { height: v.epoch_height, startMs, msPerEpoch: msPerBlock * config.epoch_length };
  }

  async step(id: string, step: "stake" | "unstake" | "withdraw" | "distribute") {
    try {
      const res = await this.chain.send(`harvest key: ${step} pot ${id}`, this.treasurer, this.contractId, [actions.functionCall(step, { pot_id: id }, 300n * TGAS, 0n)], {
        allowFailure: true,
      });
      const error = failureOf(res);
      return { ok: !error, hash: res.transaction.hash, url: this.chain.txUrl(res.transaction.hash), error };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

const NEAR = 10n ** 24n;

/** NEAR amount with up to 5 decimals, e.g. "12.34567 NEAR". Tiny amounts show in full. */
export function nearAmount(yocto: bigint): string {
  const sign = yocto < 0n ? "-" : "";
  const v = yocto < 0n ? -yocto : yocto;
  if (v > 0n && v < 10n ** 19n) return `${sign}${v.toString()} yoctoNEAR`;
  const whole = v / NEAR;
  const frac = ((v % NEAR) / 10n ** 19n).toString().padStart(5, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""} NEAR`;
}

const STAGE_WORDS: Record<HarvestStage, string> = {
  Filling: "filling: deposits are open",
  Staking: "being staked",
  Staked: "staked and earning",
  Unstaking: "being unstaked",
  Unbonding: "unstaked, waiting for the pool to release it",
  Withdrawing: "being withdrawn from the pool",
  Ripe: "ripe: ready to share out",
  Distributed: "shared out",
  Cancelled: "cancelled: everyone can take their deposit back",
};

/** The estimated ripe time from epoch timing (the pool releases funds 4 epochs after unstaking). */
export function ripeEstimate(pot: Pot, s: PotStatus, t: EpochTiming): number | undefined {
  const at = (epoch: number) => t.startMs + (epoch - t.height) * t.msPerEpoch;
  if (s.withdrawable_from_epoch !== null) return at(s.withdrawable_from_epoch);
  if (s.unstake_from_epoch !== null) return at(Math.max(s.unstake_from_epoch, t.height) + 4);
  if (pot.stage === "Filling") return at(t.height + 1 + pot.term_epochs + 4);
  return undefined;
}

export async function potText(h: Harvest, store: Store, id: string, webUrl?: string): Promise<string> {
  const pot = await h.pot(id);
  if (!pot) return `I couldn't find Harvest pot ${esc(id)} on testnet.`;
  const s = await h.status(id);
  const total = BigInt(pot.total);
  const lines = [`🌾 <b>${esc(pot.name)}</b> (Harvest pot ${esc(id)} · testnet)`, "", `Status: ${STAGE_WORDS[pot.stage]}`];
  lines.push(`Pool: ${esc(pot.pool_id)} · term: ${pot.term_epochs} epoch${pot.term_epochs === 1 ? "" : "s"}`);
  lines.push(`Deposits (${pot.deposits.length}): ${pot.deposits.map((d) => `${whoList([d.account_id], store)} ${nearAmount(BigInt(d.amount))}`).join(", ") || "none yet"}`);
  lines.push(`Total deposited: ${nearAmount(total)}`);
  if (["Staked", "Unstaking", "Unbonding", "Withdrawing"].includes(pot.stage)) {
    const inPool = await h.inPool(pot.pool_id);
    lines.push(`In the pool now: ${nearAmount(inPool)} · rewards so far: ${nearAmount(inPool - total)} (read from the pool just now)`);
  }
  if (pot.stage === "Ripe" || pot.stage === "Distributed") {
    const returned = BigInt(pot.returned);
    lines.push(`The pool returned ${nearAmount(returned)}: rewards ${nearAmount(returned - total)}.`);
  }
  if (pot.stage === "Filling") lines.push(`Deposits close ${utc(s.fill_ends_ms)} (in ${span(s.fill_ends_ms - s.now_ms)}).`);
  if (!["Ripe", "Distributed", "Cancelled"].includes(pot.stage)) {
    try {
      const ripe = ripeEstimate(pot, s, await h.epochs());
      if (ripe) lines.push(`Estimated ripe: ${new Date(ripe).toISOString().slice(0, 16).replace("T", " ")} UTC (from current epoch timing; NEAR's epochs vary).`);
    } catch {
      // Without epoch timing, leave the estimate out rather than guess.
    }
  }
  if (pot.stage === "Distributed") {
    lines.push("", pot.payouts.map((p) => `• ${whoList([p.account_id], store)} received ${nearAmount(BigInt(p.amount))}`).join("\n"));
  }
  if (webUrl) lines.push("", `🌐 <a href="${esc(`${webUrl}/testnet/harvest/${id}`)}">Open the pot on the web</a>`);
  return lines.join("\n");
}

/** Drives followed pots through their steps and posts each stage once. */
export async function harvestTick(h: Harvest, store: Store, post: (chat: number, html: string) => Promise<void>, webUrl?: string): Promise<void> {
  const follows = store.state.harvests;
  const pots = new Set(Object.values(follows).flat());
  for (const id of pots) {
    try {
      const chats = Object.entries(follows)
        .filter(([, ids]) => ids.includes(id))
        .map(([chat]) => Number(chat));
      const say = async (html: string) => {
        for (const c of chats) await post(c, html);
      };
      let s = await h.status(id);
      const seen = (store.state.harvestSeen[id] ??= []);
      const once = async (key: string, html: () => Promise<string> | string) => {
        if (seen.includes(key)) return;
        seen.push(key);
        await say(await html());
      };
      const next =
        s.can_stake ? "stake" : s.can_unstake ? "unstake" : s.stage === "Unbonding" && s.withdrawable_from_epoch !== null && s.epoch_height >= s.withdrawable_from_epoch ? "withdraw" : s.can_distribute ? "distribute" : undefined;
      if (next === "distribute") {
        const pot = (await h.pot(id))!;
        await once("ripe", () => `🌾 <b>${esc(pot.name)}</b> is ripe! The pool returned ${nearAmount(BigInt(pot.returned))}, including ${nearAmount(BigInt(pot.returned) - BigInt(pot.total))} of rewards. Sharing it out now.`);
      }
      if (next) {
        const out = await h.step(id, next);
        if (!out.ok) console.error(`harvest ${id} ${next}: ${out.error}`);
        s = await h.status(id);
        if (out.ok && out.hash) store.state.harvestTx[`${id}:${next}`] = { hash: out.hash, url: out.url };
      }
      const tx = (step: string) => {
        const t = store.state.harvestTx[`${id}:${step}`];
        return t ? `\n${receipt(t.hash, t.url)}` : "";
      };
      if (["Staked", "Unstaking", "Unbonding", "Withdrawing", "Ripe", "Distributed"].includes(s.stage)) {
        await once("staked", async () => `🌱 Harvest pot ${esc(id)} · testnet is staked.\n\n${await potText(h, store, id, webUrl)}${tx("stake")}`);
      }
      if (["Unbonding", "Withdrawing", "Ripe", "Distributed"].includes(s.stage)) {
        await once("unstaked", async () => `⏳ Harvest pot ${esc(id)} · testnet is unstaked. The pool releases it after 4 epochs.\n\n${await potText(h, store, id, webUrl)}${tx("unstake")}`);
      }
      if (s.stage === "Distributed") {
        await once("distributed", async () => `✅ Harvest pot ${esc(id)} · testnet is shared out: everyone got their deposit back plus their share of the rewards.\n\n${await potText(h, store, id, webUrl)}${tx("distribute")}`);
      }
      if (s.stage === "Cancelled") await once("cancelled", () => `🛑 Harvest pot ${esc(id)} · testnet was cancelled. Everyone can take their deposit back.`);
    } catch (e) {
      console.error(`harvest ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

export { short };
