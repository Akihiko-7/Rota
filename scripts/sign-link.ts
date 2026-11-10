// Testnet demo helper: signs a bot link message (NEP-413) with a demo
// member's key from credentials/testnet.json and prints the /verify command.
// Stands in for the wallet signing page until the web app exists. Prints only
// the public key and the signature.
//
// Run: node scripts/sign-link.ts <account> <telegram_user_id> <nonce_base64>

import { KeyPair, KeyPairSigner } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { linkPayload } from "../bot/src/link.ts";
import { getKey } from "./lib/keys.ts";

const [accountId, userId, nonce] = process.argv.slice(2);
if (!accountId || !/^\d+$/.test(userId ?? "") || !nonce) throw new Error("usage: sign-link.ts <account> <telegram_user_id> <nonce_base64>");
const key = getKey(accountId);
if (!key) throw new Error(`no key for ${accountId} in credentials/testnet.json`);

const keyPair = KeyPair.fromString(key as KeyPairString);
const signed = await new KeyPairSigner(keyPair).signNep413Message(accountId, linkPayload(Number(userId), accountId, nonce));
console.log(`/verify ${keyPair.getPublicKey().toString()} ${Buffer.from(signed.signature).toString("base64")}`);
