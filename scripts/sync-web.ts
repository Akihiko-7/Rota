// Writes web/src/generated/networks.json: for testnet and mainnet, the RPC
// endpoints, explorer, contract, token and treasurer the web app uses, the
// code hash it expects on chain (from the committed contract/res wasm) and the
// testnet demo circle. Mainnet stays "launching soon" (contractId null) until
// MAINNET_ROTA_CONTRACT_ID and MAINNET_TREASURER_ACCOUNT_ID are set in .env.
//
//   node scripts/sync-web.ts

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadEnv } from "./lib/env.ts";
import { codeHash, circleWasm } from "./lib/rota.ts";

const harvestWasm = readFileSync(new URL("../contract/res/rota_harvest.wasm", import.meta.url));

loadEnv();
const root = new URL("../", import.meta.url);
const wasm = circleWasm();
const demo = JSON.parse(readFileSync(new URL("docs/demo/circle-5.json", root), "utf8"));
const shared = {
  botUsername: "RotaNear_Bot",
  repo: "https://github.com/Akihiko-7/Rota",
  wasm: {
    path: "contract/res/rota_circle.wasm",
    bytes: wasm.length,
    codeHash: codeHash(wasm),
    sha256Hex: createHash("sha256").update(wasm).digest("hex"),
  },
};

const out = {
  testnet: {
    ...shared,
    network: "testnet",
    label: "Testnet (test wallet)",
    rpc: ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com"],
    explorer: "https://testnet.nearblocks.io",
    contractId: "circle-v2.rota-nearhack.testnet",
    tokenId: "usdc-mock.rota-nearhack.testnet",
    tokenNote: "a free test token with no value",
    treasurerId: "treasurer-v2.rota-nearhack.testnet",
    accountSuffix: ".testnet",
    demo: {
      circleId: demo.circle_id as string,
      payouts: demo.payouts as { round: number; hash: string }[],
      redteam: demo.redteam_settle_attempt as { hash: string; note: string },
    },
    /** Circles created by automated browser tests, labelled as such on their pages. */
    testRuns: ["6", "7", "8", "9", "10", "12", "13"],
    /** Group staking (Harvest), testnet only. */
    harvest: {
      contractId: process.env.HARVEST_CONTRACT_ID || "harvest-v1.rota-nearhack.testnet",
      treasurerId: process.env.HARVEST_TREASURER_ACCOUNT_ID || "harvest-treasurer-v1.rota-nearhack.testnet",
      defaultPool: "aurora.pool.f863973.m0",
      wasm: { path: "contract/res/rota_harvest.wasm", codeHash: codeHash(harvestWasm) },
      unlockEpochs: 4,
    } as { contractId: string; treasurerId: string; defaultPool: string; wasm: { path: string; codeHash: string }; unlockEpochs: number } | null,
  },
  mainnet: {
    ...shared,
    network: "mainnet",
    label: "Mainnet (real money)",
    rpc: ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com"],
    explorer: "https://nearblocks.io",
    contractId: process.env.MAINNET_ROTA_CONTRACT_ID || null,
    // Circle's native USDC on NEAR (6 decimals).
    tokenId: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    tokenNote: "real USDC issued by Circle",
    treasurerId: process.env.MAINNET_TREASURER_ACCOUNT_ID || null,
    accountSuffix: ".near",
    demo: null,
    testRuns: [] as string[],
    harvest: null,
  },
};

const dir = new URL("web/src/generated/", root);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("networks.json", dir), `${JSON.stringify(out, null, 2)}\n`);
const old = new URL("chain.json", dir);
if (existsSync(old)) rmSync(old);
console.log(`web/src/generated/networks.json: code hash ${shared.wasm.codeHash}; mainnet ${out.mainnet.contractId ?? "launching soon"}`);
