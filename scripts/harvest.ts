// Rota Harvest on testnet: deploy, restricted treasurer, lock, and pot operations.
// New keys go to credentials/testnet.json (never printed); transactions to docs/testnet/transactions.json.
//
//   node scripts/harvest.ts deploy v1                  harvest-v1.<root>, from contract/res/rota_harvest.wasm
//   node scripts/harvest.ts treasurer v1               harvest-treasurer-v1.<root>: one key for stake/unstake/withdraw/distribute
//   node scripts/harvest.ts lock v1                    delete every key of harvest-v1, verify 0 keys and the code hash
//   node scripts/harvest.ts create v1 <pool> <fill_min> <term_epochs> "<name>"   (signed by the deployer)
//   node scripts/harvest.ts deposit v1 <pot> <account> <near>                     (signed by a demo member)
//   node scripts/harvest.ts step v1 <pot> stake|unstake|withdraw|distribute       (signed by the restricted treasurer)
//   node scripts/harvest.ts status v1 <pot>

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { KeyPair, PublicKey } from "near-api-js";
import { Chain, TGAS, actions, getTransactionLastResult, near } from "./lib/near.ts";
import { getKey, saveKey } from "./lib/keys.ts";
import { loadEnv, requireEnv } from "./lib/env.ts";
import { appendRun } from "./lib/record.ts";
import { codeHash, createAccount } from "./lib/rota.ts";

loadEnv();
const [cmd, version, ...args] = process.argv.slice(2);
if (!/^v\d+$/.test(version ?? "")) throw new Error("usage: harvest.ts <command> v<N> ...");
const chain = new Chain("testnet", requireEnv("NEAR_RPC_URL"));
const root = chain.account(requireEnv("NEAR_ACCOUNT_ID"), requireEnv("NEAR_PRIVATE_KEY"));
const harvestId = `harvest-${version}.${root.accountId}`;
const treasurerId = `harvest-treasurer-${version}.${root.accountId}`;
const wasm = () => readFileSync(new URL("../contract/res/rota_harvest.wasm", import.meta.url));
const STEPS = ["stake", "unstake", "withdraw", "distribute"];
const accountOf = (id: string) => {
  const key = getKey(id);
  if (!key) throw new Error(`no key for ${id} in credentials/testnet.json`);
  return chain.account(id, key);
};

try {
  switch (cmd) {
    case "deploy": {
      if (await chain.exists(harvestId)) throw new Error(`${harvestId} already exists`);
      const code = wasm();
      const { privateKey } = await createAccount(chain, root, harvestId, near("2.15"), `create ${harvestId} and deploy the Harvest contract`, { code });
      saveKey(harvestId, privateKey);
      const onChain = (await chain.provider.viewAccount({ accountId: harvestId })).code_hash;
      assert.equal(onChain, codeHash(code));
      console.log(`      code hash ${onChain} = sha256 of contract/res/rota_harvest.wasm`);
      break;
    }
    case "treasurer": {
      if (await chain.exists(treasurerId)) throw new Error(`${treasurerId} already exists`);
      const kp = KeyPair.fromRandom("ed25519");
      await chain.send(`create ${treasurerId} holding only a key for ${STEPS.join("/")} on ${harvestId}`, root, treasurerId, [
        actions.createAccount(),
        actions.transfer(near("0.5")),
        actions.addFunctionCallAccessKey(kp.getPublicKey(), harvestId, STEPS, undefined),
      ]);
      saveKey(treasurerId, kp.toString());
      let keys: Awaited<ReturnType<typeof chain.provider.viewAccessKeyList>>["keys"] = [];
      for (let i = 0; i < 20 && keys.length === 0; i++) {
        if (i) await new Promise((r) => setTimeout(r, 1500));
        keys = (await chain.provider.viewAccessKeyList({ accountId: treasurerId, finalityQuery: { finality: "final" } })).keys;
      }
      assert.equal(keys.length, 1);
      const fc = (keys[0].access_key.permission as { FunctionCall?: { receiver_id: string; method_names: string[]; allowance: string | null } }).FunctionCall;
      assert.deepEqual(fc, { allowance: null, receiver_id: harvestId, method_names: STEPS });
      console.log(`      on-chain: 1 key, FunctionCall { receiver: ${harvestId}, methods: [${STEPS}], allowance: unlimited }`);
      break;
    }
    case "lock": {
      const account = accountOf(harvestId);
      const { keys } = await chain.provider.viewAccessKeyList({ accountId: harvestId });
      await chain.send(`lock ${harvestId}: delete all ${keys.length} access key(s)`, account, harvestId, keys.map((k) => actions.deleteKey(PublicKey.from(k.public_key))));
      let left = -1;
      for (let i = 0; i < 20 && left !== 0; i++) {
        if (i) await new Promise((r) => setTimeout(r, 1500));
        left = (await chain.provider.viewAccessKeyList({ accountId: harvestId, finalityQuery: { finality: "final" } })).keys.length;
      }
      assert.equal(left, 0);
      const onChain = (await chain.provider.viewAccount({ accountId: harvestId, blockQuery: { finality: "final" } })).code_hash;
      assert.equal(onChain, codeHash(wasm()));
      console.log(`      on-chain (final): ${harvestId} has 0 access keys; code hash ${onChain} = sha256 of contract/res/rota_harvest.wasm`);
      break;
    }
    case "create": {
      const [pool, fillMin, term, name] = args;
      const res = await chain.call(
        `create pot "${name}" on ${harvestId}: pool ${pool}, filling ${fillMin} min, term ${term} epoch(s)`,
        root,
        harvestId,
        "create_pot",
        { name, pool_id: pool, fill_sec: Number(fillMin) * 60, term_epochs: Number(term) },
        { gas: 30n * TGAS, deposit: near("0.05") },
      );
      console.log(`      pot id ${getTransactionLastResult(res)}`);
      break;
    }
    case "deposit": {
      const [pot, who, amount] = args;
      await chain.call(`${who} deposits ${amount} NEAR into pot ${pot}`, accountOf(who), harvestId, "deposit", { pot_id: pot }, { gas: 30n * TGAS, deposit: near(amount) });
      break;
    }
    case "step": {
      const [pot, step] = args;
      assert.ok(STEPS.includes(step), `step must be one of ${STEPS}`);
      const res = await chain.call(`treasurer key: ${step} pot ${pot}`, accountOf(treasurerId), harvestId, step, { pot_id: pot }, { gas: 300n * TGAS, allowFailure: true });
      const logs = [res.transaction_outcome, ...res.receipts_outcome].flatMap((o) => o.outcome.logs);
      for (const l of logs) console.log(`      ${l}`);
      break;
    }
    case "status": {
      const [pot] = args;
      console.log(JSON.stringify(await chain.view(harvestId, "get_status", { pot_id: pot }), null, 2));
      const p = await chain.view<{ pool_id: string; stage: string; total: string }>(harvestId, "get_pot", { pot_id: pot });
      const inPool = await chain.view<string>(p.pool_id, "get_account_total_balance", { account_id: harvestId });
      console.log(`stage ${p.stage}; deposits ${Number(BigInt(p.total)) / 1e24} NEAR; in pool ${Number(BigInt(inPool)) / 1e24} NEAR (${inPool} yocto)`);
      break;
    }
    default:
      throw new Error("usage: harvest.ts deploy|treasurer|lock|create|deposit|step|status v<N> ...");
  }
} finally {
  appendRun(`harvest ${cmd} ${version} ${args.join(" ")}`.trim(), chain.log);
}
