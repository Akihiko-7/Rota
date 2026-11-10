// Plain-English formatting, the same conventions as the Telegram bot.

export const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);

/** Token amount (6 decimals) as "12.5 USDC". */
export function usdc(amount: string | bigint): string {
  const v = BigInt(amount);
  const frac = (v % UNIT).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return `${v / UNIT}${frac ? `.${frac}` : ""} USDC`;
}

/** "12.5" → 12500000n. Throws on bad input or more than 6 decimals. */
export function parseUsdc(text: string): bigint {
  const t = text.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(t)) throw new Error("Enter an amount like 10 or 12.5 (up to 6 decimals).");
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole) * UNIT + BigInt(frac.padEnd(DECIMALS, "0"));
}

/** "amara" for amara.rota-nearhack.testnet. */
export const short = (accountId: string) => accountId.split(".")[0];

/** "a", "a and b", "a, b and c". */
export function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
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

export function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
