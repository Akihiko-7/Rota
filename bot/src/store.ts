// The bot's own state, kept in one JSON file (or in memory for tests): which
// group follows which circle, Telegram ↔ NEAR links, and what has already
// been announced. It holds no keys.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Net = "testnet" | "mainnet";
export const isNet = (s: string | undefined): s is Net => s === "testnet" || s === "mainnet";
/** The network an account belongs to, from its name; undefined for implicit (hex) accounts. */
export function netOfAccount(accountId: string): Net | undefined {
  if (accountId.endsWith(".testnet")) return "testnet";
  if (accountId.endsWith(".near")) return "mainnet";
  return undefined;
}

export interface UserLink {
  accountId: string;
  network?: Net;
  /** True only after a valid NEP-413 signature from a full-access key of `accountId`. */
  verified: boolean;
  /** Base64 nonce the user must sign (32 bytes). */
  nonce: string;
  username?: string;
  linkedAt: number;
}

export interface Watch {
  /** How many settled rounds have been announced. */
  announced: number;
  /** Payers already announced, per round. */
  paid: Record<string, string[]>;
  /** Reminders already sent, per round. */
  reminded: Record<string, string[]>;
  ended?: boolean;
}

export interface State {
  /** Telegram chat id → the circle it follows. */
  groups: Record<string, { circleId: string; network: Net; linkedBy: number; linkedAt: number }>;
  /** Telegram user id → NEAR account link. */
  users: Record<string, UserLink>;
  /** `${network}:${circleId}` → announcement progress. */
  watches: Record<string, Watch>;
  /** `${network}:${circleId}:${round}` → the settle transaction the bot sent. */
  settleTx: Record<string, { hash: string; url?: string }>;
  /** NEAR AI spend for one UTC day, for the daily budget cap. */
  aiSpend: { day: string; usd: number };
}

const empty = (): State => ({ groups: {}, users: {}, watches: {}, settleTx: {}, aiSpend: { day: "", usd: 0 } });

export class Store {
  readonly state: State;
  private readonly path?: string;

  /** Without `path`, state lives in memory only. */
  constructor(path?: string) {
    this.path = path;
    this.state = path && existsSync(path) ? { ...empty(), ...(JSON.parse(readFileSync(path, "utf8")) as State) } : empty();
    migrate(this.state);
  }

  save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`);
    renameSync(tmp, this.path);
  }

  circleOf(chatId: number): { net: Net; id: string } | undefined {
    const g = this.state.groups[String(chatId)];
    return g && { net: g.network, id: g.circleId };
  }

  chatsFor(net: Net, circleId: string): number[] {
    return Object.entries(this.state.groups)
      .filter(([, g]) => g.network === net && g.circleId === circleId)
      .map(([chat]) => Number(chat));
  }

  watch(net: Net, circleId: string): Watch {
    return (this.state.watches[`${net}:${circleId}`] ??= { announced: 0, paid: {}, reminded: {} });
  }

  settleTx(net: Net, circleId: string, round: number): { hash: string; url?: string } | undefined {
    return this.state.settleTx[`${net}:${circleId}:${round}`];
  }

  recordSettle(net: Net, circleId: string, round: number, tx: { hash: string; url?: string }): void {
    this.state.settleTx[`${net}:${circleId}:${round}`] ??= tx;
  }

  user(userId: number): UserLink | undefined {
    return this.state.users[String(userId)];
  }

  /** The daily NEAR AI spend, kept in this file so restarts don't reset it. */
  spendBook(): { today(): number; add(usd: number): void } {
    const day = () => new Date().toISOString().slice(0, 10);
    return {
      today: () => (this.state.aiSpend.day === day() ? this.state.aiSpend.usd : 0),
      add: (usd: number) => {
        if (this.state.aiSpend.day !== day()) this.state.aiSpend = { day: day(), usd: 0 };
        this.state.aiSpend.usd += usd;
        this.save();
      },
    };
  }

  /** Telegram username linked to `accountId`, if any. */
  usernameOf(accountId: string): { username?: string; verified: boolean } | undefined {
    const link = Object.values(this.state.users).find((u) => u.accountId === accountId);
    return link && { username: link.username, verified: link.verified };
  }
}

/** State saved before the bot supported two networks was all testnet. */
function migrate(state: State): void {
  for (const g of Object.values(state.groups)) g.network ??= "testnet";
  for (const k of Object.keys(state.watches)) {
    if (!k.includes(":")) {
      state.watches[`testnet:${k}`] = state.watches[k];
      delete state.watches[k];
    }
  }
  for (const k of Object.keys(state.settleTx)) {
    if (k.split(":").length === 2) {
      state.settleTx[`testnet:${k}`] = state.settleTx[k];
      delete state.settleTx[k];
    }
  }
}
