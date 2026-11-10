// Tops demo members up to a target NEAR balance from the deployer (testnet).
// Run: node scripts/fund-members.ts amara=7.4 bao=5.4 ...
import { Chain, actions, near } from "./lib/near.ts";
import { loadEnv, requireEnv } from "./lib/env.ts";
import { appendRun } from "./lib/record.ts";

loadEnv();
const chain = new Chain("testnet", requireEnv("NEAR_RPC_URL"));
const root = chain.account(requireEnv("NEAR_ACCOUNT_ID"), requireEnv("NEAR_PRIVATE_KEY"));
try {
  for (const arg of process.argv.slice(2)) {
    const [name, target] = arg.split("=");
    const id = `${name}.${root.accountId}`;
    const have = BigInt((await chain.provider.viewAccount({ accountId: id })).amount);
    const want = near(target);
    if (have < want) await chain.send(`top up ${id} to ${target} NEAR`, root, id, [actions.transfer(want - have)]);
    else console.log(`  ${id} already has ${Number(have / 10n ** 21n) / 1000} NEAR`);
  }
} finally {
  appendRun(`fund members ${process.argv.slice(2).join(" ")}`, chain.log);
}
