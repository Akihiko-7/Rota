// Private keys of the testnet accounts the scripts create (demo members, the
// token, unlocked contracts, treasurers), kept in credentials/testnet.json
// (gitignored, mode 600). Never printed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../../credentials/", import.meta.url));
const FILE = `${DIR}testnet.json`;

type Store = Record<string, string>;

function load(): Store {
  return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Store) : {};
}

export function getKey(accountId: string): string | undefined {
  return load()[accountId];
}

export function saveKey(accountId: string, privateKey: string): void {
  const store = load();
  store[accountId] = privateKey;
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}
