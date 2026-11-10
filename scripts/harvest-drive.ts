// Drives one Harvest pot to the end with the restricted treasurer key: every
// 2 minutes it takes whichever step the contract allows (stake, unstake,
// withdraw, distribute) and stops once the pot is shared out or cancelled.
// The steps are permissionless and guarded by the contract, so running this
// alongside the bot is harmless: a duplicate step just fails.
//
//   node scripts/harvest-drive.ts v1 0        (run detached; logs to stdout)

import { Chain, TGAS, actions, failureOf } from "./lib/near.ts";
import { getKey } from "./lib/keys.ts";
import { loadEnv, requireEnv } from "./lib/env.ts";
import { appendRun } from "./lib/record.ts";

loadEnv();
const [version, pot] = process.argv.slice(2);
const chain = new Chain("testnet", requireEnv("NEAR_RPC_URL"));
const root = requireEnv("NEAR_ACCOUNT_ID");
const harvestId = `harvest-${version}.${root}`;
const treasurerId = `harvest-treasurer-${version}.${root}`;
const treasurer = chain.account(treasurerId, getKey(treasurerId) ?? requireEnv("HARVEST_TREASURER_FC_PRIVATE_KEY"));

interface Status {
  stage: string;
  epoch_height: number;
  can_stake: boolean;
  can_unstake: boolean;
  withdrawable_from_epoch: number | null;
  can_distribute: boolean;
}

const log = (m: string) => console.log(`${new Date().toISOString().slice(0, 19)}Z ${m}`);

for (;;) {
  try {
    const s = await chain.view<Status>(harvestId, "get_status", { pot_id: pot });
    if (s.stage === "Distributed" || s.stage === "Cancelled") {
      log(`pot ${pot} is ${s.stage}; done`);
      break;
    }
    const step = s.can_stake
      ? "stake"
      : s.can_unstake
        ? "unstake"
        : s.stage === "Unbonding" && s.withdrawable_from_epoch !== null && s.epoch_height >= s.withdrawable_from_epoch
          ? "withdraw"
          : s.can_distribute
            ? "distribute"
            : undefined;
    if (step) {
      const res = await chain.send(`harvest-drive: ${step} pot ${pot}`, treasurer, harvestId, [actions.functionCall(step, { pot_id: pot }, 300n * TGAS, 0n)], { allowFailure: true });
      const err = failureOf(res);
      log(`${step}: ${err ? `failed: ${err}` : "ok"} tx ${res.transaction.hash}`);
      appendRun(`harvest ${version} pot ${pot} ${step} (driver)`, chain.log.splice(0));
    } else {
      log(`stage ${s.stage}, epoch ${s.epoch_height}${s.withdrawable_from_epoch ? `, withdrawable from ${s.withdrawable_from_epoch}` : ""}: waiting`);
    }
  } catch (e) {
    log(`error (will retry): ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
  await new Promise((r) => setTimeout(r, 120_000));
}
