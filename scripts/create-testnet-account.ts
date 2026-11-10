// Creates the testnet deploy account through the testnet faucet (the helper
// service near-cli uses for `--useFaucet`) and stores its key in .env as
// NEAR_ACCOUNT_ID / NEAR_PRIVATE_KEY. The key is never printed.
//
// Run: node scripts/create-testnet-account.ts <name>.testnet

import { JsonRpcProvider, KeyPair } from "near-api-js";
import { loadEnv, setEnv } from "./lib/env.ts";

const FAUCET = "https://helper.nearprotocol.com/account";
const RPC = "https://rpc.testnet.near.org";

loadEnv();
const accountId = process.argv[2];
if (!accountId?.endsWith(".testnet")) throw new Error("usage: create-testnet-account.ts <name>.testnet");
if (process.env.NEAR_ACCOUNT_ID) throw new Error(`.env already has NEAR_ACCOUNT_ID=${process.env.NEAR_ACCOUNT_ID}`);

const provider = new JsonRpcProvider({ url: RPC });
const exists = await provider.viewAccount({ accountId }).then(() => true, () => false);
if (exists) throw new Error(`${accountId} already exists`);

const keyPair = KeyPair.fromRandom("ed25519");
const res = await fetch(FAUCET, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.getPublicKey().toString() }),
});
if (!res.ok) throw new Error(`faucet: HTTP ${res.status} ${await res.text()}`);

// Store the key before anything else can fail.
setEnv({ NEAR_NETWORK: "testnet", NEAR_RPC_URL: RPC, NEAR_ACCOUNT_ID: accountId, NEAR_PRIVATE_KEY: keyPair.toString() });

for (let i = 0; i < 20; i++) {
  const state = await provider.viewAccount({ accountId }).catch(() => null);
  if (state) {
    console.log(`created ${accountId}, balance ${state.amount} yoctoNEAR`);
    console.log(`public key ${keyPair.getPublicKey().toString()}; private key saved to .env`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
throw new Error("faucet accepted the request but the account did not appear");
