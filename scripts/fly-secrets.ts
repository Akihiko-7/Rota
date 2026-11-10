// Prints the bot's settings from .env as KEY=VALUE lines for
// `fly secrets import`: only the variables the bot itself would read
// (bot/src/config.ts), so the deployer's and members' keys never leave this
// computer. Refuses to print to a terminal, since the output holds the
// treasurers' settle-only keys and the Telegram token.
//
//   node scripts/fly-secrets.ts | fly secrets import --stage -a <app>

import { existsSync, readFileSync } from "node:fs";
import { applyEnv, ALLOWED } from "../bot/src/config.ts";

if (process.stdout.isTTY) {
  console.error("This prints secrets; pipe it into `fly secrets import` instead.");
  process.exit(1);
}
const envFile = new URL("../.env", import.meta.url);
if (!existsSync(envFile)) throw new Error(".env not found");
const env: NodeJS.ProcessEnv = {};
applyEnv(readFileSync(envFile, "utf8"), env);
// fly.toml sets these to paths on the volume.
const ON_FLY = ["BOT_STATE_PATH", "BOT_TRANSCRIPT_PATH"];
const lines = ALLOWED.filter((k) => env[k] && !ON_FLY.includes(k)).map((k) => `${k}=${env[k]}`);
process.stdout.write(`${lines.join("\n")}\n`);
console.error(`${lines.length} settings: ${lines.map((l) => l.split("=")[0]).join(", ")}`);
