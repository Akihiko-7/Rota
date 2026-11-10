// Creates the mainnet deployer: a fresh implicit account (its id is derived
// from the key, so it exists as soon as someone sends it NEAR). Stores the key
// in .env as MAINNET_DEPLOYER_ACCOUNT_ID / MAINNET_DEPLOYER_PRIVATE_KEY and
// prints only the account id. Deploys nothing and spends nothing.
//
// Run: node scripts/create-mainnet-deployer.ts

import { KeyPair, keyToImplicitAddress } from "near-api-js";
import { loadEnv, setEnv } from "./lib/env.ts";

loadEnv();
if (process.env.MAINNET_DEPLOYER_ACCOUNT_ID) {
  console.log(`already set: ${process.env.MAINNET_DEPLOYER_ACCOUNT_ID}`);
} else {
  const keyPair = KeyPair.fromRandom("ed25519");
  const id = keyToImplicitAddress(keyPair.getPublicKey());
  setEnv({ MAINNET_DEPLOYER_ACCOUNT_ID: id, MAINNET_DEPLOYER_PRIVATE_KEY: keyPair.toString() });
  console.log(`mainnet deployer (implicit account): ${id}`);
}
