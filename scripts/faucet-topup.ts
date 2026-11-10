// Tops up the testnet deployer (NEAR_ACCOUNT_ID) from the testnet faucet.
// The faucet only funds new accounts, so this creates a throwaway account
// with a fresh key held in memory, then deletes it with the deployer as
// beneficiary, which moves its whole balance (~10 NEAR) to the deployer.
//
// Run: node scripts/faucet-topup.ts

import { randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
import { Chain } from "./lib/near.ts";
import { loadEnv, requireEnv } from "./lib/env.ts";
import { appendRun } from "./lib/record.ts";
import { saveKey } from "./lib/keys.ts";

const FAUCET = "https://helper.nearprotocol.com/account";

loadEnv();
const chain = new Chain("testnet", requireEnv("NEAR_RPC_URL"));
const beneficiary = requireEnv("NEAR_ACCOUNT_ID");
const temp = `rota-topup-${randomBytes(4).toString("hex")}.testnet`;
const keyPair = KeyPair.fromRandom("ed25519");

const balance = async (id: string) => BigInt((await chain.provider.viewAccount({ accountId: id })).amount);
const near = (y: bigint) => (Number(y / 10n ** 21n) / 1000).toFixed(3);
const before = await balance(beneficiary);

const res = await fetch(FAUCET, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ newAccountId: temp, newAccountPublicKey: keyPair.getPublicKey().toString() }),
});
if (!res.ok) throw new Error(`faucet: HTTP ${res.status} ${await res.text()}`);
for (let i = 0; i < 20 && !(await chain.exists(temp)); i++) await new Promise((r) => setTimeout(r, 1_500));
console.log(`faucet created ${temp} with ${near(await balance(temp))} NEAR`);
// Keep the key until the account is deleted, so a dropped connection doesn't strand the NEAR.
saveKey(temp, keyPair.toString());

try {
  await chain.send(`delete ${temp}, sending its balance to ${beneficiary}`, chain.account(temp, keyPair.toString()), temp, [
    (await import("near-api-js")).actions.deleteAccount(beneficiary),
  ]);
} finally {
  appendRun(`faucet top-up of ${beneficiary}`, chain.log);
}
console.log(`${beneficiary}: ${near(before)} → ${near(await balance(beneficiary))} NEAR`);
