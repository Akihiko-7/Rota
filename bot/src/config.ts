// Which environment variables the bot may read. Anything else in .env (the
// deployer's NEAR_PRIVATE_KEY, demo member keys) never reaches the process.

import { parseEnv } from "node:util";

export const ALLOWED = [
  "NEAR_NETWORK",
  "NEAR_RPC_URL",
  "ROTA_CONTRACT_ID",
  "ROTA_TOKEN_ID",
  "TREASURER_ACCOUNT_ID",
  "TREASURER_FC_PRIVATE_KEY",
  "TELEGRAM_BOT_TOKEN",
  "NEARAI_API_KEY",
  "NEARAI_BASE_URL",
  "NEARAI_MODEL",
  "NEARAI_DAILY_BUDGET_USD",
  "BOT_STATE_PATH",
  "BOT_TRANSCRIPT_PATH",
  "SETTLE_INTERVAL_SEC",
  "WEB_URL",
  "MAINNET_NEAR_RPC_URL",
  "MAINNET_ROTA_CONTRACT_ID",
  "MAINNET_ROTA_TOKEN_ID",
  "MAINNET_TREASURER_ACCOUNT_ID",
  "MAINNET_TREASURER_FC_PRIVATE_KEY",
  "HARVEST_CONTRACT_ID",
  "HARVEST_TREASURER_ACCOUNT_ID",
  "HARVEST_TREASURER_FC_PRIVATE_KEY",
];

/** The only private keys the bot may hold: the treasurers' settle-only function-call keys. */
const TREASURER_KEYS = ["TREASURER_FC_PRIVATE_KEY", "MAINNET_TREASURER_FC_PRIVATE_KEY", "HARVEST_TREASURER_FC_PRIVATE_KEY"];

/**
 * Copies allowed variables from `.env` text into `env` (existing values win)
 * and deletes every other *PRIVATE_KEY variable from `env`. Returns the names
 * it deleted.
 */
export function applyEnv(envText: string | undefined, env: NodeJS.ProcessEnv): string[] {
  if (envText) {
    const parsed = parseEnv(envText);
    for (const k of ALLOWED) if (parsed[k] && !env[k]) env[k] = parsed[k];
  }
  const dropped = Object.keys(env).filter((k) => /PRIVATE_KEY/.test(k) && !TREASURER_KEYS.includes(k));
  for (const k of dropped) delete env[k];
  return dropped;
}
