// The real bot code against the real contract on a local NEAR sandbox: no
// secrets, no testnet. Checks that the treasurer-key check, /redteam and the
// scheduler behave as the unit tests claim when NEAR itself enforces the key.
//
//   npm run test:sandbox -w bot      (~1 minute; downloads the sandbox once)

import { strict as assert } from "node:assert";
import { after, before, test } from "node:test";
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from "near-sandbox";
import type { Account } from "near-api-js";
import { Chain, ONE_YOCTO, TGAS, getTransactionLastResult, near } from "../../scripts/lib/near.ts";
import { createAccount, createTreasurer, deployCircle, deployToken, fundMember, lock } from "../../scripts/lib/rota.ts";
import { NearLedger } from "../src/ledger.ts";
import { harness } from "./harness.ts";

let node: Sandbox;
let chain: Chain;
let root: Account;
let circleId: string;
let tokenId: string;
let treasurer: Account;
let members: Account[];

before(async () => {
  node = await Sandbox.start({});
  chain = new Chain("sandbox", node.rpcUrl);
  root = chain.account(DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY);
  tokenId = (await deployToken(chain, root, `usdc-mock.${root.accountId}`)).account.accountId;
  const circle = await deployCircle(chain, root, `circle-v1.${root.accountId}`);
  circleId = circle.account.accountId;
  treasurer = (await createTreasurer(chain, root, `treasurer-v1.${root.accountId}`, circleId)).account;
  await lock(chain, circle.account);
  members = [];
  for (const name of ["amara", "bao"]) {
    const m = (await createAccount(chain, root, `${name}.${root.accountId}`, near("1"), `create ${name}`)).account;
    await fundMember(chain, root, tokenId, m, near("1"));
    members.push(m);
  }
});

after(async () => {
  await node?.tearDown();
});

async function newCircle(): Promise<string> {
  const res = await chain.call(
    "create circle",
    members[0],
    circleId,
    "create_circle",
    {
      config: {
        name: "Sandbox circle",
        token: tokenId,
        contribution: "10000000",
        members: members.map((m) => m.accountId),
        round_duration_sec: 60,
        grace_period_sec: 30,
        early_slot_bond: "0",
      },
    },
    { gas: 300n * TGAS, deposit: near("0.2") },
  );
  const id = getTransactionLastResult(res) as string;
  for (const m of members) await chain.call("join", m, circleId, "join", { circle_id: id }, { gas: 100n * TGAS, deposit: near("0.05") });
  await chain.call("start", members[0], circleId, "start", { circle_id: id }, { gas: 50n * TGAS });
  return id;
}

async function payAll(id: string): Promise<void> {
  for (const m of members) {
    await chain.call(
      "pay",
      m,
      tokenId,
      "ft_transfer_call",
      { receiver_id: circleId, amount: "10000000", msg: JSON.stringify({ circle_id: id, kind: "contribution" }) },
      { gas: 100n * TGAS, deposit: ONE_YOCTO },
    );
  }
}

test("the bot refuses a full-access key and accepts the settle-only key", async () => {
  const full = new NearLedger(chain, circleId, tokenId, root);
  await assert.rejects(full.checkTreasurerKey(), /full-access key/);
  const ledger = new NearLedger(chain, circleId, tokenId, treasurer);
  assert.match(await ledger.checkTreasurerKey(), /function-call key, receiver circle-v1\.sandbox, methods \[settle\], allowance unlimited/);
});

test("/redteam on chain: two rejections by NEAR, injected recipient ignored", async () => {
  const id = await newCircle();
  await payAll(id);
  const h = harness({ ledger: new NearLedger(chain, circleId, tokenId, treasurer) });
  await h.say(`/circle ${id}`);
  const out = await h.say("/redteam");
  assert.match(out[1], /Blocked by NEAR before it even ran.*NEAR's exact words: <i>"Access key receiver circle-v1\.sandbox does not match transaction receiver usdc-mock\.sandbox"<\/i>/s);
  assert.match(out[2], /Blocked by NEAR before it even ran.*NEAR's exact words: <i>"Access key does not allow method claim"<\/i>/s);
  assert.match(out[3], /✅ <b>This one went through\.<\/b>\n🧾 Transaction <code>\w+…<\/code>\n\nThe contract ignored the thief: it paid 20 USDC to <b>amara<\/b>, whose turn it was\./);
  const thief = `thief.${treasurer.accountId}`;
  assert.equal(await chain.exists(thief), false);
  assert.equal(await chain.view(tokenId, "ft_balance_of", { account_id: thief }), "0");
});

test("the scheduler settles a fully paid round on chain and announces it", async () => {
  const id = await newCircle();
  const h = harness({ ledger: new NearLedger(chain, circleId, tokenId, treasurer) });
  await h.say(`/circle ${id}`);
  await payAll(id);
  const posts = await h.tick();
  assert.match(posts.join("\n"), /✅ Round 1 of 2 is paid out! · testnet\n\n<b>amara<\/b> received <b>20 USDC<\/b>\.\n\nPaid out by me, the treasurer\.\n🧾 Transaction <code>\w+…<\/code>/);
  const circle = await chain.view<{ history: { settled_by: string }[] }>(circleId, "get_circle", { circle_id: id });
  assert.equal(circle.history[0].settled_by, treasurer.accountId);
});
