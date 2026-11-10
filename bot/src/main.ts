// Runs the bot: Telegram long polling plus the settle scheduler.
//
//   npm start -w bot                                 (reads the repo-root .env)
//   docker run --env-file bot.env -v rota-bot:/data rota-bot
//
// It reads only the variables in config.ts. The one key it holds is the
// treasurer's settle-only function-call key, and it refuses to start with any
// other kind of key or with Telegram privacy mode off.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Chain, type Network } from "../../scripts/lib/near.ts";
import { NearAi } from "./ai.ts";
import { ADMIN_WARNING, createBot } from "./bot.ts";
import { NearHarvest } from "./harvest.ts";
import { applyEnv } from "./config.ts";
import { NearLedger } from "./ledger.ts";
import { Scheduler, type Ledgers } from "./scheduler.ts";
import { Store } from "./store.ts";

const DEFAULT_MODEL = "Qwen/Qwen3.8-27B";

const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
for (const k of applyEnv(existsSync(envFile) ? readFileSync(envFile, "utf8") : undefined, process.env)) {
  console.warn(`ignoring ${k}: the bot holds only the treasurer's settle key`);
}

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

/** A network's ledger, with its treasurer key checked on chain; undefined if not configured. */
async function ledgerFor(net: Network, prefix: string, rpcDefault?: string): Promise<NearLedger | undefined> {
  const env = (k: string) => process.env[`${prefix}${k}`];
  const rpc = env("NEAR_RPC_URL") || rpcDefault;
  const contract = env("ROTA_CONTRACT_ID");
  const treasurerId = env("TREASURER_ACCOUNT_ID");
  const key = env("TREASURER_FC_PRIVATE_KEY");
  if (!rpc || !contract || !treasurerId || !key) return undefined;
  const chain = new Chain(net, rpc);
  const ledger = new NearLedger(chain, contract, env("ROTA_TOKEN_ID") || MAINNET_USDC, chain.account(treasurerId, key));
  console.log(`${net} treasurer key: ${await ledger.checkTreasurerKey()}`);
  return ledger;
}

const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
need("ROTA_CONTRACT_ID");
const ledgers: Ledgers = {};
ledgers.testnet = await ledgerFor("testnet", "");
ledgers.mainnet = await ledgerFor("mainnet", "MAINNET_", "https://rpc.mainnet.fastnear.com,https://free.rpc.fastnear.com");
if (!ledgers.testnet) throw new Error("the testnet treasurer isn't configured (NEAR_RPC_URL, ROTA_CONTRACT_ID, TREASURER_ACCOUNT_ID, TREASURER_FC_PRIVATE_KEY)");
if (!ledgers.mainnet) console.log("mainnet: not configured (launching soon); /circle … mainnet will say so");

const store = new Store(process.env.BOT_STATE_PATH || fileURLToPath(new URL("../data/state.json", import.meta.url)));
const ai = new NearAi({
  apiKey: process.env.NEARAI_API_KEY,
  baseUrl: process.env.NEARAI_BASE_URL || undefined,
  model: process.env.NEARAI_MODEL || DEFAULT_MODEL,
  dailyBudgetUsd: Number(process.env.NEARAI_DAILY_BUDGET_USD || 0.5),
  spend: store.spendBook(),
});

const transcriptPath = process.env.BOT_TRANSCRIPT_PATH;
if (transcriptPath) mkdirSync(dirname(transcriptPath), { recursive: true });
const transcript = transcriptPath
  ? (entry: object) => appendFileSync(transcriptPath, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`)
  : undefined;

let harvest: NearHarvest | undefined;
if (process.env.HARVEST_CONTRACT_ID && process.env.HARVEST_TREASURER_ACCOUNT_ID && process.env.HARVEST_TREASURER_FC_PRIVATE_KEY) {
  const chain = new Chain("testnet", need("NEAR_RPC_URL"));
  harvest = new NearHarvest(chain, process.env.HARVEST_CONTRACT_ID, chain.account(process.env.HARVEST_TREASURER_ACCOUNT_ID, process.env.HARVEST_TREASURER_FC_PRIVATE_KEY));
  console.log(`harvest key: ${await harvest.checkKey()}`);
}

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const scheduler = new Scheduler(ledgers, store, async (chat, text) => {
  await bot.api.sendMessage(chat, text, html);
});
const bot = createBot(need("TELEGRAM_BOT_TOKEN"), { ledgers, store, ai, scheduler, transcript, webUrl: process.env.WEB_URL || undefined, harvest });
scheduler.harvest = harvest;
scheduler.webUrl = process.env.WEB_URL?.replace(/\/$/, "") || undefined;

await bot.init();
if (bot.botInfo.can_read_all_group_messages) {
  console.error(`@${bot.botInfo.username} has Telegram privacy mode OFF. Turn it on in @BotFather (/setprivacy → Enable); the bot won't run without it.`);
  process.exit(1);
}
await bot.api.setMyCommands([
  { command: "status", description: "This round: who paid, deadline, pot" },
  { command: "order", description: "Payout order" },
  { command: "history", description: "Settled rounds" },
  { command: "pay", description: "How to pay this round" },
  { command: "rep", description: "On-chain payment record" },
  { command: "link", description: "Link your NEAR account" },
  { command: "verify", description: "Prove the link (NEP-413)" },
  { command: "swap", description: "Ask to swap payout slots" },
  { command: "settle", description: "Settle now if allowed" },
  { command: "redteam", description: "Try to steal with the treasurer key" },
  { command: "ask", description: "Ask the AI treasurer" },
  { command: "attest", description: "AI model TEE attestation" },
  { command: "circle", description: "Follow a circle (admins)" },
  { command: "help", description: "What I can do" },
]);

for (const chat of Object.keys(store.state.groups)) {
  const me = await bot.api.getChatMember(chat, bot.botInfo.id).catch(() => undefined);
  if (me?.status === "administrator") {
    console.warn(`WARNING: @${bot.botInfo.username} is an admin in chat ${chat}, so Telegram sends it every message despite privacy mode.`);
    await bot.api.sendMessage(chat, ADMIN_WARNING).catch(() => {});
  }
}

const intervalSec = Number(process.env.SETTLE_INTERVAL_SEC || 15);
scheduler.start(intervalSec * 1000);
const stop = () => {
  scheduler.stop();
  void bot.stop();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await bot.start({
  onStart: (me) =>
    console.log(`@${me.username} running · privacy mode on · AI model ${ai.model} (budget $${ai.dailyBudgetUsd}/day) · checking circles every ${intervalSec}s · following ${Object.keys(store.state.groups).length} chat(s)`),
});
