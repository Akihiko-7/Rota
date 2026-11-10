// Writes web/src/generated/chain.json: the testnet accounts the web app reads,
// the code hash it expects on chain (computed from the committed
// contract/res/rota_circle.wasm) and the demo circle's transactions.
// Run after redeploying or rebuilding the contract:
//
//   node scripts/sync-web.ts

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { codeHash, circleWasm } from "./lib/rota.ts";

const root = new URL("../", import.meta.url);
const wasm = circleWasm();
const demo = JSON.parse(readFileSync(new URL("docs/demo/circle-5.json", root), "utf8"));

const out = {
  network: "testnet",
  rpc: ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com"],
  explorer: "https://testnet.nearblocks.io",
  contractId: "circle-v2.rota-nearhack.testnet",
  tokenId: "usdc-mock.rota-nearhack.testnet",
  treasurerId: "treasurer-v2.rota-nearhack.testnet",
  botUsername: "RotaNear_Bot",
  repo: "https://github.com/Akihiko-7/Rota",
  wasm: {
    path: "contract/res/rota_circle.wasm",
    bytes: wasm.length,
    codeHash: codeHash(wasm),
    sha256Hex: createHash("sha256").update(wasm).digest("hex"),
  },
  demo: {
    circleId: demo.circle_id as string,
    payouts: demo.payouts as { round: number; hash: string }[],
    redteam: demo.redteam_settle_attempt as { hash: string; note: string },
  },
};

const dir = new URL("web/src/generated/", root);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("chain.json", dir), `${JSON.stringify(out, null, 2)}\n`);
console.log(`web/src/generated/chain.json: code hash ${out.wasm.codeHash}, ${out.demo.payouts.length} demo payouts`);
