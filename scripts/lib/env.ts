// Reads and updates the repo-root .env without ever printing values.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ENV_PATH = fileURLToPath(new URL("../../.env", import.meta.url));

export function loadEnv(): void {
  if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}

/** Sets keys in .env, replacing existing lines and keeping everything else. */
export function setEnv(values: Record<string, string>): void {
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split("\n") : [];
  for (const [key, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
    process.env[key] = value;
  }
  writeFileSync(ENV_PATH, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
}
