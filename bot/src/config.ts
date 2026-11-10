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
  "BOT_STATE_PATH",
  "BOT_TRANSCRIPT_PATH",
  "SETTLE_INTERVAL_SEC",
];

/**
 * Copies allowed variables from `.env` text into `env` (existing values win)
 * and deletes any other *PRIVATE_KEY variable from `env`. Returns the names
 * it deleted.
 */
export function applyEnv(envText: string | undefined, env: NodeJS.ProcessEnv): string[] {
  if (envText) {
    const parsed = parseEnv(envText);
    for (const k of ALLOWED) if (parsed[k] && !env[k]) env[k] = parsed[k];
  }
  const dropped = Object.keys(env).filter((k) => /PRIVATE_KEY/.test(k) && k !== "TREASURER_FC_PRIVATE_KEY");
  for (const k of dropped) delete env[k];
  return dropped;
}
