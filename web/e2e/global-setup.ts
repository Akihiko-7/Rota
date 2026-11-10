import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Tops up the demo members' testnet NEAR and test USDC before the wallet tests. */
export default function globalSetup() {
  const script = fileURLToPath(new URL("./prepare.ts", import.meta.url));
  execFileSync("node", ["--env-file=../.env", script], { stdio: "inherit", cwd: fileURLToPath(new URL("..", import.meta.url)) });
}
