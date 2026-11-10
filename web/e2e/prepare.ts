// Run by the e2e global setup with node: tops up amara and bao (NEAR + test USDC).
import { Chain } from "../../scripts/lib/near.ts";
import { getKey } from "../../scripts/lib/keys.ts";
import { FUNDING, fundMember } from "../../scripts/lib/rota.ts";

const env = (k: string) => process.env[k] ?? (() => { throw new Error(`${k} is not set`); })();
const chain = new Chain("testnet", env("NEAR_RPC_URL"));
const root = chain.account(env("NEAR_ACCOUNT_ID"), env("NEAR_PRIVATE_KEY"));
for (const name of ["amara", "bao"]) {
  const id = `${name}.${root.accountId}`;
  await fundMember(chain, root, env("ROTA_TOKEN_ID"), chain.account(id, getKey(id)!), FUNDING.creator);
}
