// Test doubles: no secrets, no network. A fake ledger that follows the
// contract's settle rules, a Telegram API that records what the bot sends,
// and a scriptable NEAR AI endpoint.

import { verifyMessage } from "near-api-js/nep413";
import type { UserFromGetMe } from "grammy/types";
import { NearAi } from "../src/ai.ts";
import { createBot } from "../src/bot.ts";
import type { Circle, Ledger, Nep413Proof, Reputation, RoundStatus, TxOutcome } from "../src/ledger.ts";
import { Scheduler } from "../src/scheduler.ts";
import { Store } from "../src/store.ts";
import type { EpochTiming, Harvest, Pot, PotStatus } from "../src/harvest.ts";

export const C = 10_000_000n; // 10 USDC
const ROUND_MS = 120_000;
const GRACE_MS = 30_000;

/** One active 3-member circle (id "1") with the contract's settle rules. */
export class FakeLedger implements Ledger {
  readonly network = "testnet";
  readonly contractId = "circle-v2.rota.testnet";
  readonly tokenId = "usdc-mock.rota.testnet";
  readonly treasurerId = "treasurer-v2.rota.testnet";
  now = 1_800_000_000_000;
  readonly paid = new Set<string>();
  readonly settleCalls: Record<string, unknown>[] = [];
  /** account → its full-access public key, for NEP-413 checks. */
  readonly fullAccessKeys = new Map<string, string>();
  readonly c: Circle;
  private txs = 0;

  constructor(members = ["amara.rota.testnet", "bao.rota.testnet", "carmen.rota.testnet"]) {
    this.c = {
      id: "1",
      name: "Test circle",
      creator: members[0],
      token: this.tokenId,
      contribution: C.toString(),
      early_slot_bond: "0",
      round_duration_sec: ROUND_MS / 1000,
      grace_period_sec: GRACE_MS / 1000,
      status: "Active",
      members: members.map((a) => ({ account_id: a, joined: true, bond: "0", claimable: "0", paid_round: null, paid_at_ms: null, missed: 0 })),
      order: [...members],
      current_round: 0,
      start_ms: this.now,
      history: [],
    };
  }

  pay(account: string): void {
    this.paid.add(account);
  }

  private deadline(): number {
    return this.c.start_ms + (this.c.current_round + 1) * ROUND_MS;
  }

  async circle(id: string): Promise<Circle | null> {
    return id === this.c.id ? structuredClone(this.c) : null;
  }

  async roundStatus(id: string): Promise<RoundStatus> {
    if (id !== this.c.id) throw new Error("unknown circle");
    const members = this.c.order;
    const paid = members.filter((a) => this.paid.has(a));
    const deadline = this.deadline();
    return {
      circle_id: id,
      status: this.c.status,
      round: this.c.current_round,
      rounds_total: members.length,
      recipient: this.c.status === "Active" ? members[this.c.current_round] : null,
      deadline_ms: deadline,
      grace_ends_ms: deadline + GRACE_MS,
      now_ms: this.now,
      paid,
      unpaid: members.filter((a) => !this.paid.has(a)),
      collected: (C * BigInt(paid.length)).toString(),
      can_settle: this.c.status === "Active" && (paid.length === members.length || this.now > deadline + GRACE_MS),
    };
  }

  async reputation(): Promise<Reputation> {
    return { on_time_contributions: 3, late_contributions: 0, missed_contributions: 1, circles_completed: 0, defaults: 1 };
  }

  async settle(id: string, extraArgs?: Record<string, unknown>): Promise<TxOutcome> {
    this.settleCalls.push({ circle_id: id, ...extraArgs });
    const hash = `TX${++this.txs}`;
    const s = await this.roundStatus(id);
    if (!s.can_settle) {
      const error =
        s.status !== "Active"
          ? "Smart contract panicked: circle is not active"
          : `Smart contract panicked: round ${s.round} can't settle yet: ${s.paid.length} of ${s.paid.length + s.unpaid.length} paid; settling opens at ${s.grace_ends_ms} ms`;
      return { status: "failed", hash, url: `https://explorer/${hash}`, error };
    }
    this.c.history.push({
      round: s.round,
      recipient: s.recipient!,
      amount: s.collected,
      contributions: s.paid.length,
      slashed: "0",
      missed: s.unpaid,
      settled_at_ms: this.now,
      settled_by: this.treasurerId,
      payout: "Paid",
    });
    this.paid.clear();
    this.c.current_round++;
    if (this.c.current_round === this.c.order.length) this.c.status = "Completed";
    return { status: "ok", hash, url: `https://explorer/${hash}` };
  }

  async attempt(receiverId: string, method: string): Promise<TxOutcome> {
    if (receiverId !== this.contractId) {
      return { status: "rejected", error: `Access key receiver ${this.contractId} does not match transaction receiver ${receiverId}` };
    }
    if (method !== "settle") return { status: "rejected", error: `Access key does not allow method ${method}` };
    return this.settle(this.c.id);
  }

  async verifyNep413(proof: Nep413Proof): Promise<void> {
    const provider = {
      viewAccessKey: async ({ accountId, publicKey }: { accountId: string; publicKey: unknown }) => {
        if (this.fullAccessKeys.get(accountId) === String(publicKey)) return { permission: "FullAccess" };
        throw new Error(`access key ${String(publicKey)} does not exist on ${accountId}`);
      },
    };
    await verifyMessage({
      signerAccountId: proof.accountId,
      signerPublicKey: proof.publicKey,
      payload: proof.payload,
      signature: proof.signature,
      provider: provider as never,
    });
  }

  accountUrl(id: string): string {
    return `https://explorer/address/${id}`;
  }
}

export const BOT_INFO: UserFromGetMe = {
  id: 999,
  is_bot: true,
  first_name: "Rota",
  username: "RotaTestBot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as UserFromGetMe;

export const GROUP = -100123;
export const ALICE = { id: 1, username: "alice", first_name: "Alice" };
export const BOB = { id: 2, username: "bob", first_name: "Bob" };

type AiReply = { status?: number; body: unknown };

/**
 * A bot wired to the fake ledger. `aiReplies` are returned in order by the
 * fake NEAR AI endpoint; the requests it got are in `aiRequests`.
 */
export function harness<L extends Ledger = FakeLedger>(
  opts: { ledger?: L; mainnet?: Ledger; harvest?: Harvest; aiReplies?: AiReply[]; admins?: number[]; budgetUsd?: number; webUrl?: string; store?: Store } = {},
) {
  const ledger = (opts.ledger ?? new FakeLedger()) as L;
  const ledgers = { testnet: ledger, ...(opts.mainnet ? { mainnet: opts.mainnet } : {}) };
  const store = opts.store ?? new Store();
  const sent: { chat: number; text: string }[] = [];
  const aiRequests: { url: string; body: Record<string, unknown> }[] = [];
  const aiReplies = [...(opts.aiReplies ?? [])];
  const admins = new Set(opts.admins ?? [ALICE.id]);

  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    aiRequests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
    const next = aiReplies.shift();
    if (!next) throw new Error("no scripted AI reply left");
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  // Qwen3.8-27B's published price, so no model-list request is made.
  const ai = new NearAi({ apiKey: "test-key", model: "test/model", fetch: fakeFetch, price: { in: 4e-8, out: 1.35e-6 }, dailyBudgetUsd: opts.budgetUsd });
  const scheduler = new Scheduler(ledgers, store, async (chat, text) => {
    sent.push({ chat, text });
  });
  scheduler.harvest = opts.harvest;
  const bot = createBot("123:TEST", { ledgers, store, ai, scheduler, webUrl: opts.webUrl, harvest: opts.harvest }, BOT_INFO);
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, unknown>;
    const ok = (result: unknown) => ({ ok: true as const, result }) as never;
    if (method === "sendMessage") {
      sent.push({ chat: Number(p.chat_id), text: String(p.text) });
      return ok({ message_id: sent.length, date: 0, chat: { id: p.chat_id, type: "group", title: "Test" }, text: p.text });
    }
    if (method === "sendChatAction") return ok(true);
    if (method === "getChatMember") {
      return ok({ status: admins.has(Number(p.user_id)) ? "administrator" : "member", user: { id: p.user_id, is_bot: false, first_name: "x" } });
    }
    throw new Error(`unexpected Telegram call ${method}`);
  });

  let updateId = 0;
  /** Delivers one message to the bot and returns what it sent in response. */
  async function say(text: string, from = ALICE, chat = GROUP, extra: Record<string, unknown> = {}) {
    const command = text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0].length }] : [];
    const at = text.indexOf(`@${BOT_INFO.username}`);
    // How Telegram marks an @mention (privacy mode keeps these from reaching the bot in groups).
    const mention = !text.startsWith("/") && at >= 0 ? [{ type: "mention", offset: at, length: BOT_INFO.username.length + 1 }] : [];
    await bot.handleUpdate({
      update_id: ++updateId,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: chat < 0 ? { id: chat, type: "group", title: "Test circle" } : { id: chat, type: "private", first_name: from.first_name },
        from: { ...from, is_bot: false },
        text,
        entities: [...command, ...mention],
        ...extra,
      },
    } as never);
    return sent.splice(0).map((m) => m.text);
  }

  /** Runs one scheduler pass and returns what it posted. */
  async function tick() {
    await scheduler.tick();
    return sent.splice(0).map((m) => m.text);
  }

  /** Delivers a my_chat_member update: the bot's own status in GROUP changed. */
  async function botStatus(status: string) {
    await bot.handleUpdate({
      update_id: ++updateId,
      my_chat_member: {
        chat: { id: GROUP, type: "group", title: "Test circle" },
        from: { ...ALICE, is_bot: false },
        date: 0,
        old_chat_member: { status: "member", user: { id: BOT_INFO.id, is_bot: true, first_name: "Rota" } },
        new_chat_member: { status, user: { id: BOT_INFO.id, is_bot: true, first_name: "Rota" } },
      },
    } as never);
    return sent.splice(0).map((m) => m.text);
  }

  return { bot, ai, ledger, store, sent, say, tick, botStatus, aiRequests };
}

const NEAR = 10n ** 24n;

/** A Harvest pot on a fake contract: tests set its stage; steps advance it like the contract would. */
export class FakeHarvest implements Harvest {
  readonly contractId = "harvest-v1.rota.testnet";
  readonly steps: string[] = [];
  epoch = 100;
  inPoolNow = 0n;
  readonly p: Pot = {
    id: "0",
    name: "Group stake",
    pool_id: "aurora.pool.f863973.m0",
    fill_ends_ms: 1_800_000_000_000,
    term_epochs: 1,
    stage: "Filling",
    deposits: [
      { account_id: "amara.rota.testnet", amount: (3n * NEAR).toString() },
      { account_id: "bao.rota.testnet", amount: NEAR.toString() },
    ],
    total: (4n * NEAR).toString(),
    staked_epoch: null,
    unstaked_epoch: null,
    returned: "0",
    payouts: [],
  };
  now = 1_800_000_000_000 - 600_000;

  async pot(id: string) {
    return id === "0" ? structuredClone(this.p) : null;
  }
  async status(): Promise<PotStatus> {
    const p = this.p;
    return {
      stage: p.stage,
      now_ms: this.now,
      epoch_height: this.epoch,
      fill_ends_ms: p.fill_ends_ms,
      can_stake: p.stage === "Filling" && this.now >= p.fill_ends_ms,
      unstake_from_epoch: p.staked_epoch === null ? null : p.staked_epoch + p.term_epochs,
      can_unstake: p.stage === "Staked" && p.staked_epoch !== null && this.epoch >= p.staked_epoch + p.term_epochs,
      withdrawable_from_epoch: p.unstaked_epoch === null ? null : p.unstaked_epoch + 4,
      can_distribute: p.stage === "Ripe",
    };
  }
  async inPool() {
    return this.inPoolNow;
  }
  async epochs(): Promise<EpochTiming> {
    return { height: this.epoch, startMs: this.now, msPerEpoch: 7 * 3600_000 };
  }
  async step(_id: string, step: "stake" | "unstake" | "withdraw" | "distribute") {
    this.steps.push(step);
    const p = this.p;
    if (step === "stake") [p.stage, p.staked_epoch, this.inPoolNow] = ["Staked", this.epoch, 4n * NEAR];
    if (step === "unstake") [p.stage, p.unstaked_epoch] = ["Unbonding", this.epoch];
    if (step === "withdraw") [p.stage, p.returned] = ["Ripe", this.inPoolNow.toString()];
    if (step === "distribute") {
      p.stage = "Distributed";
      p.payouts = [
        { account_id: "amara.rota.testnet", amount: ((BigInt(p.returned) * 3n) / 4n).toString(), status: "Paid" },
        { account_id: "bao.rota.testnet", amount: (BigInt(p.returned) - (BigInt(p.returned) * 3n) / 4n).toString(), status: "Paid" },
      ];
    }
    return { ok: true, hash: `H${step}`, url: `https://explorer/H${step}` };
  }
}
