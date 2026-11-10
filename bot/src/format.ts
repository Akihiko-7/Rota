// Message formatting. Telegram messages use HTML parse mode. Messages are
// written for circle members, not developers: short names, plain words,
// blank lines between sections.

import type { Status } from "./ledger.ts";
import type { Store } from "./store.ts";

const DECIMALS = 6;

export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Token amount (6 decimals) as "12.5 USDC". */
export function usdc(amount: string | bigint): string {
  const v = BigInt(amount);
  const unit = 10n ** BigInt(DECIMALS);
  const frac = (v % unit).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return `${v / unit}${frac ? `.${frac}` : ""} USDC`;
}

export function utc(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 16)} UTC`;
}

/** A short countdown: "45 s", "1 min 20 s", "3 h 5 min", "2 days". */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  if (s < 86400) return `${Math.floor(s / 3600)} h${Math.floor((s % 3600) / 60) ? ` ${Math.floor((s % 3600) / 60)} min` : ""}`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** A round length in words: "2 minutes", "1 week". */
export function every(sec: number): string {
  const units: [number, string][] = [
    [7 * 86400, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];
  for (const [size, name] of units) {
    if (sec % size === 0) {
      const n = sec / size;
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return `${sec} seconds`;
}

/** "a", "a and b", "a, b and c". */
export function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The first part of an account id: "amara" for amara.rota-nearhack.testnet. */
export function short(accountId: string): string {
  return accountId.split(".")[0];
}

/** A member's short name in bold, plus their Telegram handle once the link is confirmed. */
export function who(accountId: string, store: Store): string {
  const link = store.usernameOf(accountId);
  const tg = link?.verified && link.username ? ` (@${esc(link.username)})` : "";
  return `<b>${esc(short(accountId))}</b>${tg}`;
}

export function whoList(accounts: string[], store: Store): string {
  return list(accounts.map((a) => who(a, store)));
}

export function receipt(hash: string, url?: string): string {
  return url ? `🧾 <a href="${url}">View on NEAR explorer</a>` : `🧾 Transaction <code>${hash.slice(0, 12)}…</code>`;
}

export function statusWords(status: Status): string {
  return { Forming: "waiting to start", Active: "running", Completed: "finished", Dissolved: "closed by a members' vote" }[status];
}

/** Turns a NEAR or contract error into a plain reason. */
export function plainReason(error: string): string {
  const notYet = /can't settle yet: (\d+) of (\d+) paid/.exec(error);
  if (notYet) return `only ${notYet[1]} of ${notYet[2]} members have paid, and the grace period isn't over yet`;
  if (/does not match transaction receiver/.test(error)) return "my key only works on the circle contract, not on the token";
  const method = /does not allow method (\w+)/.exec(error);
  if (method) return `my key isn't allowed to use "${method[1]}"; it can only use "settle"`;
  if (/circle is not active/.test(error)) return "the circle isn't running";
  if (/DepositWithFunctionCall|attached deposit/i.test(error)) return "my key can't attach any money to a call";
  return error;
}
