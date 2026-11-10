// The escape hatch: every member of a testnet demo circle votes to dissolve it,
// and the contract refunds the current round's contributions and all bonds.
//
//   node scripts/dissolve-circle.ts <circle_id>     (contract: ROTA_CONTRACT_ID)

import { strict as assert } from "node:assert";
import { Chain, ONE_YOCTO, TGAS } from "./lib/near.ts";
import { getKey } from "./lib/keys.ts";
import { loadEnv, requireEnv } from "./lib/env.ts";
import { appendRun } from "./lib/record.ts";
import { fmt } from "./lib/rota.ts";

loadEnv();
const id = process.argv[2];
if (!/^\d+$/.test(id ?? "")) throw new Error("usage: dissolve-circle.ts <circle_id>");
const chain = new Chain("testnet", requireEnv("NEAR_RPC_URL"));
const circleId = requireEnv("ROTA_CONTRACT_ID");
const tokenId = requireEnv("ROTA_TOKEN_ID");

const circle = await chain.view<{ status: string; members: { account_id: string }[] }>(circleId, "get_circle", { circle_id: id });
const held = BigInt(await chain.view<string>(circleId, "get_circle_balance", { circle_id: id }));
console.log(`circle ${id} on ${circleId}: ${circle.status}, holding ${fmt(held)} USDC`);
const ids = circle.members.map((m) => m.account_id);
const balance = async (a: string) => BigInt(await chain.view<string>(tokenId, "ft_balance_of", { account_id: a }));
const before = await Promise.all(ids.map(balance));

try {
  // Resumes an interrupted vote: skips members who already voted.
  const voted = (await chain.view<{ dissolve_votes: string[] }>(circleId, "get_circle", { circle_id: id })).dissolve_votes;
  for (const a of ids.filter((a) => !voted.includes(a))) {
    const key = getKey(a);
    if (!key) throw new Error(`no key for ${a} in credentials/testnet.json`);
    const opening = voted.length === 0 && a === ids[0];
    // The last vote refunds every member: 4 transfers of 20 Tgas each fit in 150 Tgas.
    await chain.call(`${a} ${opening ? "proposes" : "votes"} to dissolve`, chain.account(a, key), circleId, opening ? "propose_dissolve" : "vote_dissolve", { circle_id: id }, { gas: 150n * TGAS, deposit: ONE_YOCTO });
  }
} finally {
  appendRun(`dissolve ${circleId} circle ${id}`, chain.log);
}

const after = await Promise.all(ids.map(balance));
const refunded = after.reduce((s, b, i) => s + b - before[i], 0n);
const status = (await chain.view<{ status: string }>(circleId, "get_circle", { circle_id: id })).status;
console.log(`status ${status}; refunded ${fmt(refunded)} USDC to members; circle balance now ${fmt(BigInt(await chain.view<string>(circleId, "get_circle_balance", { circle_id: id })))}`);
assert.equal(status, "Dissolved");
assert.equal(refunded, held);
