// Spike: one real /ask through the bot's code, end to end except Telegram:
// real NEAR AI Cloud, real testnet circle, the bot's own handlers and tools.
// Telegram is replaced by a stub that prints what the bot would send.
//
// Run: node --env-file=.env scripts/spikes/bot-ask.ts <circle_id> "<question>"

import { NearAi } from "../../bot/src/ai.ts";
import { createBot } from "../../bot/src/bot.ts";
import { NearLedger } from "../../bot/src/ledger.ts";
import { Scheduler } from "../../bot/src/scheduler.ts";
import { Store } from "../../bot/src/store.ts";
import { Chain } from "../lib/near.ts";

const [circleId, question] = process.argv.slice(2);
if (!circleId || !question) throw new Error('usage: bot-ask.ts <circle_id> "<question>"');
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const chain = new Chain("testnet", env("NEAR_RPC_URL"));
const ledger = new NearLedger(chain, env("ROTA_CONTRACT_ID"), env("ROTA_TOKEN_ID"), chain.account(env("TREASURER_ACCOUNT_ID"), env("TREASURER_FC_PRIVATE_KEY")));
const store = new Store();
const ai = new NearAi({ apiKey: env("NEARAI_API_KEY"), model: process.env.NEARAI_MODEL || "Qwen/Qwen3.8-27B" });
const scheduler = new Scheduler(ledger, store, async () => {});
const me = { id: 1, is_bot: true, first_name: "Rota", username: "RotaNear_Bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
const bot = createBot("0:stub", { ledger, store, ai, scheduler }, me as never);
bot.api.config.use(async (_prev, method, payload) => {
  const p = payload as { text?: string };
  if (method === "sendMessage") console.log(`\nbot → ${p.text}\n`);
  return { ok: true, result: method === "getChatMember" ? { status: "creator", user: { id: 2 } } : { message_id: 1, date: 0, chat: { id: -1, type: "group" } } } as never;
});

let id = 0;
const send = (text: string) =>
  bot.handleUpdate({
    update_id: ++id,
    message: {
      message_id: id,
      date: 0,
      chat: { id: -1, type: "group", title: "spike" },
      from: { id: 2, is_bot: false, first_name: "Spike" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }],
    },
  } as never);

store.state.groups["-1"] = { circleId, linkedBy: 2, linkedAt: 0 };
await send(`/ask ${question}`);
