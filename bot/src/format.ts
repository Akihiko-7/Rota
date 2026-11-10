// Message formatting. Telegram messages use HTML parse mode.

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
  return `${new Date(ms).toISOString().slice(11, 19)} UTC`;
}

export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

/** Account name, short form for this demo's sub-accounts, plus the linked Telegram user. */
export function who(accountId: string, store: Store): string {
  const link = store.usernameOf(accountId);
  const tg = link?.username ? ` (@${esc(link.username)}${link.verified ? "" : ", unverified"})` : "";
  return `<b>${esc(accountId)}</b>${tg}`;
}

export function txLink(hash: string, url?: string): string {
  return url ? `<a href="${url}">${hash.slice(0, 10)}…</a>` : `<code>${hash}</code>`;
}
