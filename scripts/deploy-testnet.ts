// Testnet deployment steps. Each creates a sub-account of NEAR_ACCOUNT_ID,
// stores new keys in credentials/testnet.json (never printed) and updates .env.
//
//   node scripts/deploy-testnet.ts token          usdc-mock.<root>: mock USDC
//   node scripts/deploy-testnet.ts circle v1      circle-v1.<root>: circle contract (left unlocked)
//   node scripts/deploy-testnet.ts treasurer v1   treasurer-v1.<root>: only a settle key for circle-v1
//   node scripts/deploy-testnet.ts lock v1        delete every key of circle-v1 and verify none remain

import { Chain } from "./lib/near.ts";
import { getKey, saveKey } from "./lib/keys.ts";
import { loadEnv, requireEnv, setEnv } from "./lib/env.ts";
import { appendRun } from "./lib/record.ts";
import { createTreasurer, deployCircle, deployToken, lock } from "./lib/rota.ts";

loadEnv();
const [step, version] = process.argv.slice(2);
const chain = new Chain("testnet", requireEnv("NEAR_RPC_URL"));
const root = chain.account(requireEnv("NEAR_ACCOUNT_ID"), requireEnv("NEAR_PRIVATE_KEY"));
const versioned = (prefix: string) => {
  if (!/^v\d+$/.test(version ?? "")) throw new Error(`usage: deploy-testnet.ts ${step} v<N>`);
  return `${prefix}-${version}.${root.accountId}`;
};

async function fresh(id: string): Promise<string> {
  if (await chain.exists(id)) throw new Error(`${id} already exists; use a new version`);
  return id;
}

try {
  switch (step) {
    case "token": {
      const id = await fresh(`usdc-mock.${root.accountId}`);
      const { privateKey } = await deployToken(chain, root, id);
      saveKey(id, privateKey);
      setEnv({ ROTA_TOKEN_ID: id });
      break;
    }
    case "circle": {
      const id = await fresh(versioned("circle"));
      const { privateKey } = await deployCircle(chain, root, id);
      saveKey(id, privateKey);
      setEnv({ ROTA_CONTRACT_ID: id });
      break;
    }
    case "treasurer": {
      const circleId = versioned("circle");
      if (!(await chain.exists(circleId))) throw new Error(`${circleId} does not exist`);
      const id = await fresh(versioned("treasurer"));
      const { privateKey } = await createTreasurer(chain, root, id, circleId);
      saveKey(id, privateKey);
      setEnv({ TREASURER_ACCOUNT_ID: id, TREASURER_FC_PRIVATE_KEY: privateKey });
      break;
    }
    case "lock": {
      const id = versioned("circle");
      const key = getKey(id);
      if (!key) throw new Error(`no key for ${id} in credentials/testnet.json`);
      await lock(chain, chain.account(id, key));
      break;
    }
    default:
      throw new Error("usage: deploy-testnet.ts token | circle v<N> | treasurer v<N> | lock v<N>");
  }
} finally {
  appendRun(`deploy ${step}${version ? ` ${version}` : ""}`, chain.log);
}
