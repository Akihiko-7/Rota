// The Telegram link message the bot asks members to sign (NEP-413).
// Must match bot/src/link.ts exactly; bot/test checks this.

export const LINK_RECIPIENT = "rota-bot";

export function linkMessage(telegramUserId: number, accountId: string): string {
  return `Link Telegram user ${telegramUserId} to NEAR account ${accountId} in Rota`;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const c of text) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of text) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/**
 * The signature as base64 (what the bot's /verify expects). NEP-413 says
 * wallets return base64; some return "ed25519:<base58>", which is converted.
 */
export function signatureBase64(signature: string): string {
  const s = signature.trim();
  if (s.startsWith("ed25519:")) return toBase64(base58Decode(s.slice(8)));
  return s;
}

export function base64ToBytes(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
