// Runs one full Rota circle on chain and prints every transaction:
// 4 members, 2-minute rounds, every round settled by the AI treasurer's
// settle-only key, and one missed payment, so the contract records a default
// and slashes the defaulter's bond into the pot.
//
//   npm run demo:sandbox   local NEAR sandbox; no accounts, keys or .env needed.
//                          Deploys and locks everything itself; fast-forwards block time.
//   npm run demo:testnet   the testnet contracts in .env (ROTA_CONTRACT_ID,
//                          ROTA_TOKEN_ID, TREASURER_*); takes ~7 minutes of real
//                          time. Demo member accounts are created on first run.
//                          Add `-- --resume <circle_id>` to finish an interrupted run.
//                          `-- --setup-only` stops before start; `-- --bot` leaves
//                          settling to the running treasurer bot.

import { Chain } from "./lib/near.ts";
import { getKey, saveKey } from "./lib/keys.ts";
import { loadEnv, requireEnv } from "./lib/env.ts";
import { appendRun } from "./lib/record.ts";
import { FUNDING, MEMBER_NAMES, createAccount, createTreasurer, demoCycle, deployCircle, deployToken, fundMember, lock } from "./lib/rota.ts";
import type { Account } from "near-api-js";

async function members(chain: Chain, root: Account, tokenId: string, keep: boolean): Promise<Account[]> {
  const out: Account[] = [];
  for (const [i, name] of MEMBER_NAMES.entries()) {
    const id = `${name}.${root.accountId}`;
    const known = keep ? getKey(id) : undefined;
    const funding = i === 0 ? FUNDING.creator : FUNDING.member;
    let m: Account;
    if (known && (await chain.exists(id))) {
      m = chain.account(id, known);
    } else {
      const created = await createAccount(chain, root, id, funding, `create demo member ${id}`);
      if (keep) saveKey(id, created.privateKey);
      m = created.account;
    }
    await fundMember(chain, root, tokenId, m, funding);
    out.push(m);
  }
  return out;
}

async function sandbox(): Promise<void> {
  const { Sandbox, DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY } = await import("near-sandbox");
  console.log("Starting a local NEAR sandbox (the first run downloads the sandbox binary)...");
  const node = await Sandbox.start({});
  try {
    const chain = new Chain("sandbox", node.rpcUrl);
    // The sandbox's genesis account uses a published test key; it exists only on this local chain.
    const root = chain.account(DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY);
    console.log("\nDeploy");
    const token = await deployToken(chain, root, `usdc-mock.${root.accountId}`);
    const circle = await deployCircle(chain, root, `circle-v1.${root.accountId}`);
    const treasurer = await createTreasurer(chain, root, `treasurer-v1.${root.accountId}`, circle.account.accountId);
    await lock(chain, circle.account);
    console.log("\nDemo members");
    const ms = await members(chain, root, token.account.accountId, false);
    await demoCycle({ chain, circleId: circle.account.accountId, tokenId: token.account.accountId, members: ms, treasurer: treasurer.account });
    console.log(`\nDemo passed: ${chain.log.length} transactions, all checks held.`);
  } finally {
    await node.tearDown();
  }
}

async function testnet(): Promise<void> {
  loadEnv();
  const chain = new Chain("testnet", requireEnv("NEAR_RPC_URL"));
  const root = chain.account(requireEnv("NEAR_ACCOUNT_ID"), requireEnv("NEAR_PRIVATE_KEY"));
  const circleId = requireEnv("ROTA_CONTRACT_ID");
  const tokenId = requireEnv("ROTA_TOKEN_ID");
  const treasurer = chain.account(requireEnv("TREASURER_ACCOUNT_ID"), requireEnv("TREASURER_FC_PRIVATE_KEY"));
  console.log(`Circle contract ${circleId}  ${chain.accountUrl(circleId)}`);
  console.log(`Treasurer       ${treasurer.accountId}  ${chain.accountUrl(treasurer.accountId)}`);
  try {
    console.log("\nDemo members");
    const ms = await members(chain, root, tokenId, true);
    const i = process.argv.indexOf("--resume");
    const resume = i > 0 ? process.argv[i + 1] : undefined;
    const setupOnly = process.argv.includes("--setup-only");
    const botSettles = process.argv.includes("--bot");
    const id = await demoCycle({ chain, circleId, tokenId, members: ms, treasurer, resume, setupOnly, botSettles });
    if (setupOnly) {
      appendRun(`demo setup ${circleId} circle ${id}`, chain.log);
      return;
    }
    console.log(`\nDemo passed: ${chain.log.length} transactions, all checks held.`);
    appendRun(`demo ${circleId} circle ${id}${resume ? " (resumed)" : ""}`, chain.log);
  } catch (e) {
    appendRun(`demo ${circleId} (failed)`, chain.log);
    throw e;
  }
}

await (process.argv.includes("--sandbox") ? sandbox() : testnet());
