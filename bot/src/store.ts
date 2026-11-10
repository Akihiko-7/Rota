// The bot's own state, kept in one JSON file (or in memory for tests): which
// group follows which circle, Telegram ↔ NEAR links, and what has already
// been announced. It holds no keys.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface UserLink {
  accountId: string;
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
  /** Telegram chat id → circle id. */
  groups: Record<string, { circleId: string; linkedBy: number; linkedAt: number }>;
  /** Telegram user id → NEAR account link. */
  users: Record<string, UserLink>;
  /** Circle id → announcement progress. */
  watches: Record<string, Watch>;
  /** `${circleId}:${round}` → the settle transaction the bot sent. */
  settleTx: Record<string, { hash: string; url?: string }>;
}

const empty = (): State => ({ groups: {}, users: {}, watches: {}, settleTx: {} });

export class Store {
  readonly state: State;
  private readonly path?: string;

  /** Without `path`, state lives in memory only. */
  constructor(path?: string) {
    this.path = path;
    this.state = path && existsSync(path) ? { ...empty(), ...(JSON.parse(readFileSync(path, "utf8")) as State) } : empty();
  }

  save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`);
    renameSync(tmp, this.path);
  }

  circleOf(chatId: number): string | undefined {
    return this.state.groups[String(chatId)]?.circleId;
  }

  chatsFor(circleId: string): number[] {
    return Object.entries(this.state.groups)
      .filter(([, g]) => g.circleId === circleId)
      .map(([chat]) => Number(chat));
  }

  watch(circleId: string): Watch {
    return (this.state.watches[circleId] ??= { announced: 0, paid: {}, reminded: {} });
  }

  user(userId: number): UserLink | undefined {
    return this.state.users[String(userId)];
  }

  /** Telegram username linked to `accountId`, if any. */
  usernameOf(accountId: string): { username?: string; verified: boolean } | undefined {
    const link = Object.values(this.state.users).find((u) => u.accountId === accountId);
    return link && { username: link.username, verified: link.verified };
  }
}
