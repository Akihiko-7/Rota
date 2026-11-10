// Private keys of the accounts the scripts create (demo members, the token,
// unlocked contracts, treasurers), kept in credentials/<network>.json
// (gitignored, mode 600). Never printed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../../credentials/", import.meta.url));
const file = (network: string) => `${DIR}${network}.json`;

type Store = Record<string, string>;

function load(network: string): Store {
  return existsSync(file(network)) ? (JSON.parse(readFileSync(file(network), "utf8")) as Store) : {};
}

export function getKey(accountId: string, network = "testnet"): string | undefined {
  return load(network)[accountId];
}

export function saveKey(accountId: string, privateKey: string, network = "testnet"): void {
  const store = load(network);
  store[accountId] = privateKey;
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(file(network), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}
