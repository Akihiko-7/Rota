// Appends transactions to docs/<network>/transactions.json, so the README's
// hashes come from what the scripts actually sent.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TxRecord } from "./near.ts";

export function appendRun(run: string, txs: TxRecord[], network = "testnet"): void {
  if (txs.length === 0) return;
  const DIR = fileURLToPath(new URL(`../../docs/${network}/`, import.meta.url));
  const FILE = `${DIR}transactions.json`;
  const runs = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as unknown[]) : [];
  runs.push({ run, at: new Date().toISOString(), transactions: txs });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, `${JSON.stringify(runs, null, 2)}\n`);
}
