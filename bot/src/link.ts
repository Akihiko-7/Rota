// Linking a Telegram user to a NEAR account with a NEP-413 signed message.
// The user's wallet signs {message, recipient, nonce}; the bot checks the
// signature and that the key is a full-access key of the account. Until then
// the link is unverified.

import { randomBytes } from "node:crypto";

export const LINK_RECIPIENT = "rota-bot";

export function linkMessage(telegramUserId: number, accountId: string): string {
  return `Link Telegram user ${telegramUserId} to NEAR account ${accountId} in Rota`;
}

export function newNonce(): string {
  return randomBytes(32).toString("base64");
}

export function linkPayload(telegramUserId: number, accountId: string, nonce: string) {
  return { message: linkMessage(telegramUserId, accountId), recipient: LINK_RECIPIENT, nonce: Buffer.from(nonce, "base64") };
}

/** A plausible NEAR account id (named or implicit). The chain is the real check. */
export function isAccountId(id: string): boolean {
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id) && id.length >= 2 && id.length <= 64;
}
