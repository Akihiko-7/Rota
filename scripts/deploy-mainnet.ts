// Deploys the circle contract under a top-level name, adds the treasurer and
// locks the contract, the same steps as on testnet but from an implicit
// deployer account, which can't create named accounts itself: the network's
// registrar (`near` on mainnet, `testnet` on testnet) creates the contract
// account through `create_account`.
//
//   node scripts/deploy-mainnet.ts check v1          read-only: plan, costs, preconditions
//   node scripts/deploy-mainnet.ts go v1             mainnet: rota-circle-v1.near
//   node scripts/deploy-mainnet.ts rehearse r1       the same steps on testnet: rota-circle-r1.testnet
//
// Steps (each skipped if already done, so a failed run can be re-run):
//   1. the registrar creates rota-circle-<v>.<tld> with a fresh full-access key
//   2. that account deploys contract/res/rota_circle.wasm (its code hash must
//      equal the locked, tested circle-v2 on testnet) and checks it on chain
//   3. it creates treasurer.rota-circle-<v>.<tld> holding only a `settle` key
//      for the circle, so the treasurer never has a full-access key
//   4. it deletes all its own keys (lock) and checks 0 keys remain at final
// Keys go to credentials/<network>.json before each transaction that uses
// them; on mainnet the treasurer's ids and key are also written to .env as
// MAINNET_*. Nothing secret is printed.

import assert from "node:assert/strict";
import { KeyPair } from "near-api-js";
import { Chain, TGAS, actions, near } from "./lib/near.ts";
import { getKey, saveKey } from "./lib/keys.ts";
import { loadEnv, requireEnv, setEnv } from "./lib/env.ts";
import { appendRun } from "./lib/record.ts";
import { FUNDING, codeHash, circleWasm, lock } from "./lib/rota.ts";

loadEnv();
const [mode, version] = process.argv.slice(2);
if (!["check", "go", "rehearse"].includes(mode) || !/^[vr]\d+$/.test(version ?? "")) {
  throw new Error("usage: deploy-mainnet.ts check|go v<N>  or  rehearse r<N>");
}
const network = mode === "rehearse" ? "testnet" : "mainnet";
const tld = network === "mainnet" ? "near" : "testnet";
const MAINNET_RPC = "https://rpc.mainnet.fastnear.com,https://free.rpc.fastnear.com";
const chain = new Chain(network, network === "mainnet" ? process.env.MAINNET_NEAR_RPC_URL || MAINNET_RPC : requireEnv("NEAR_RPC_URL"));
const testnet = network === "testnet" ? chain : new Chain("testnet", requireEnv("NEAR_RPC_URL"));
const deployer =
  network === "mainnet"
    ? chain.account(requireEnv("MAINNET_DEPLOYER_ACCOUNT_ID"), requireEnv("MAINNET_DEPLOYER_PRIVATE_KEY"))
    : chain.account(requireEnv("NEAR_ACCOUNT_ID"), requireEnv("NEAR_PRIVATE_KEY"));

const circleId = `rota-circle-${version}.${tld}`;
const treasurerId = `treasurer.${circleId}`;
const TESTED = `circle-v2.${process.env.NEAR_ACCOUNT_ID}`;

// The circle account pays for its code's storage (1 NEAR per 100 kB), the
// treasurer's balance and its own three transactions.
const code = circleWasm();
const storage = (BigInt(code.length) + 2_000n) * 10n ** 19n;
const circleFunding = storage + near("0.05") + FUNDING.treasurer + near("0.02");
const fmt = (y: bigint) => `${(Number(y / 10n ** 18n) / 1e6).toFixed(4)} NEAR`;

async function balance(id: string): Promise<bigint> {
  return BigInt((await chain.provider.viewAccount({ accountId: id })).amount);
}

try {
  console.log(`${network}: deployer ${deployer.accountId}`);
  const hash = codeHash(code);
  const tested = (await testnet.provider.viewAccount({ accountId: TESTED })).code_hash;
  assert.equal(hash, tested, `contract/res/rota_circle.wasm (${hash}) is not the code tested as ${TESTED} (${tested})`);
  assert.equal(await testnet.keyCount(TESTED), 0, `${TESTED} is not locked`);
  console.log(`  wasm ${code.length} bytes, code hash ${hash} = locked ${TESTED}`);

  const circleExists = await chain.exists(circleId);
  const treasurerExists = await chain.exists(treasurerId);
  const have = (await chain.exists(deployer.accountId)) ? await balance(deployer.accountId) : 0n;
  const need = circleExists ? 0n : circleFunding + near("0.01");
  console.log(`  ${circleId}: ${circleExists ? "exists" : "free"}; ${treasurerId}: ${treasurerExists ? "exists" : "free"}`);
  console.log(`  deployer balance ${fmt(have)}; needed ${fmt(need)} (circle account ${fmt(circleFunding)}: code storage ${fmt(storage)}, treasurer ${fmt(FUNDING.treasurer)}, fees and margin)`);
  if (have < need) throw new Error(`the deployer needs ${fmt(need - have)} more`);
  if (mode === "check") process.exit(0);

  // 1. Create the contract account through the registrar.
  let circleKey = getKey(circleId, network);
  if (!circleExists) {
    const kp = KeyPair.fromRandom("ed25519");
    circleKey = kp.toString();
    saveKey(circleId, circleKey, network);
    await chain.send(`registrar ${tld} creates ${circleId} with ${fmt(circleFunding)}`, deployer, tld, [
      actions.functionCall("create_account", { new_account_id: circleId, new_public_key: kp.getPublicKey().toString() }, 100n * TGAS, circleFunding),
    ]);
    for (let i = 0; i < 20 && !(await chain.exists(circleId)); i++) await new Promise((r) => setTimeout(r, 1_500));
    assert.ok(await chain.exists(circleId), `${circleId} was not created`);
  }
  if (!circleKey) throw new Error(`no key for ${circleId} in credentials/${network}.json`);
  const circle = chain.account(circleId, circleKey);

  // 2. Deploy the tested code.
  if ((await chain.provider.viewAccount({ accountId: circleId })).code_hash !== hash) {
    if ((await chain.keyCount(circleId)) === 0) throw new Error(`${circleId} is locked with different code`);
    await chain.send(`${circleId} deploys the circle contract`, circle, circleId, [actions.deployContract(code)]);
  }
  let onChain = "";
  for (let i = 0; i < 20 && onChain !== hash; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1_500));
    onChain = (await chain.provider.viewAccount({ accountId: circleId, finalityQuery: { finality: "final" } })).code_hash;
  }
  assert.equal(onChain, hash, "deployed code hash differs from contract/res/rota_circle.wasm");
  console.log(`      code hash ${onChain} = sha256 of contract/res/rota_circle.wasm`);

  // 3. The treasurer, with only a settle key for this circle.
  let treasurerKey = getKey(treasurerId, network);
  if (!(await chain.exists(treasurerId))) {
    const kp = KeyPair.fromRandom("ed25519");
    treasurerKey = kp.toString();
    saveKey(treasurerId, treasurerKey, network);
    await chain.send(`${circleId} creates ${treasurerId} holding only a settle key for it (unlimited allowance)`, circle, treasurerId, [
      actions.createAccount(),
      actions.transfer(FUNDING.treasurer),
      actions.addFunctionCallAccessKey(kp.getPublicKey(), circleId, ["settle"], undefined),
    ]);
  }
  // Read at final, polling while finality catches up with the transaction.
  let keys: Awaited<ReturnType<typeof chain.provider.viewAccessKeyList>>["keys"] = [];
  for (let i = 0; i < 20 && keys.length === 0; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1_500));
    keys = (await chain.provider.viewAccessKeyList({ accountId: treasurerId, finalityQuery: { finality: "final" } })).keys;
  }
  assert.equal(keys.length, 1, "treasurer must have exactly one key");
  const permission = keys[0].access_key.permission as { FunctionCall?: { allowance: string | null; receiver_id: string; method_names: string[] } };
  assert.deepEqual(permission.FunctionCall, { allowance: null, receiver_id: circleId, method_names: ["settle"] });
  console.log(`      on-chain: ${treasurerId} has 1 key, FunctionCall { receiver: ${circleId}, methods: [settle], allowance: unlimited }`);
  if (!treasurerKey) throw new Error(`no key for ${treasurerId} in credentials/${network}.json`);
  if (network === "mainnet") {
    setEnv({ MAINNET_ROTA_CONTRACT_ID: circleId, MAINNET_TREASURER_ACCOUNT_ID: treasurerId, MAINNET_TREASURER_FC_PRIVATE_KEY: treasurerKey });
    console.log("      .env: MAINNET_ROTA_CONTRACT_ID, MAINNET_TREASURER_ACCOUNT_ID, MAINNET_TREASURER_FC_PRIVATE_KEY");
  }

  // 4. Lock.
  if ((await chain.keyCount(circleId)) > 0) await lock(chain, circle);
  assert.equal((await chain.provider.viewAccessKeyList({ accountId: circleId, finalityQuery: { finality: "final" } })).keys.length, 0);
  console.log(`  done: ${circleId} (locked, ${fmt(await balance(circleId))}), ${treasurerId} (${fmt(await balance(treasurerId))}); deployer left with ${fmt(await balance(deployer.accountId))}`);
} finally {
  appendRun(`deploy-mainnet ${mode} ${version}`, chain.log, network);
}
