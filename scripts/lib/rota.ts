// Deploys Rota's contracts and runs the demo cycle. Shared by
// deploy-testnet.ts and demo-round.ts, on testnet and on the local sandbox.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { KeyPair, PublicKey, baseEncode } from "near-api-js";
import type { Account } from "near-api-js";
import { Chain, ONE_YOCTO, TGAS, actions, getTransactionLastResult, near } from "./near.ts";

const wasm = (name: string) => readFileSync(new URL(`../../contract/res/${name}`, import.meta.url));
export const circleWasm = () => wasm("rota_circle.wasm");
export const tokenWasm = () => wasm("rota_mock_ft.wasm");

export const USDC = 1_000_000n;
const CONTRIBUTION = 10n * USDC;
const BOND = CONTRIBUTION;
const ROUND_SEC = 120;
const GRACE_SEC = 30;

/**
 * NEAR given to each new account. Contract code costs 1 NEAR per 100 kB of
 * storage. Before accepting a transaction, NEAR checks that the signer can pay
 * for its attached gas at a pessimistic price (about 10x the current one), so
 * the treasurer's 300 Tgas settle needs ~0.3 NEAR available even though it
 * burns ~0.0005 NEAR and the rest is refunded.
 */
export const FUNDING = {
  circle: near("2.35"),
  token: near("1.6"),
  treasurer: near("0.5"),
  creator: near("0.6"),
  member: near("0.3"),
};

export const MEMBER_NAMES = ["amara", "bao", "carmen", "dara"];

export interface NewAccount {
  account: Account;
  privateKey: string;
}

/** NEAR's code hash: base58 of the wasm's sha256. */
export function codeHash(code: Uint8Array): string {
  return baseEncode(createHash("sha256").update(code).digest());
}

/**
 * Creates `id` under `parent` with one full-access key, in one transaction
 * that can also deploy code and call an init method.
 */
export async function createAccount(
  chain: Chain,
  parent: Account,
  id: string,
  balance: bigint,
  label: string,
  extra: { code?: Uint8Array; init?: { method: string; args: Record<string, unknown> } } = {},
): Promise<NewAccount> {
  const kp = KeyPair.fromRandom("ed25519");
  const txActions = [actions.createAccount(), actions.transfer(balance), actions.addFullAccessKey(kp.getPublicKey())];
  if (extra.code) txActions.push(actions.deployContract(extra.code));
  if (extra.init) txActions.push(actions.functionCall(extra.init.method, extra.init.args, 30n * TGAS, 0n));
  await chain.send(label, parent, id, txActions);
  return { account: chain.account(id, kp.toString()), privateKey: kp.toString() };
}

export function deployToken(chain: Chain, parent: Account, id: string): Promise<NewAccount> {
  return createAccount(chain, parent, id, FUNDING.token, `create ${id} and deploy the mock USDC (6 decimals, anyone can mint)`, {
    code: tokenWasm(),
    init: { method: "new", args: { symbol: "USDC", decimals: 6 } },
  });
}

export async function deployCircle(chain: Chain, parent: Account, id: string): Promise<NewAccount> {
  const code = circleWasm();
  const created = await createAccount(chain, parent, id, FUNDING.circle, `create ${id} and deploy the circle contract`, { code });
  const onChain = (await chain.provider.viewAccount({ accountId: id })).code_hash;
  assert.equal(onChain, codeHash(code), "deployed code hash differs from contract/res/rota_circle.wasm");
  console.log(`      code hash ${onChain} = sha256 of contract/res/rota_circle.wasm`);
  return created;
}

/**
 * Creates the treasurer account with a single function-call key: receiver
 * `circleId`, method `settle`, no allowance cap (gas is paid from the
 * account's own small balance). It never has a full-access key, so nobody,
 * including us, can give it more power later.
 */
export async function createTreasurer(chain: Chain, parent: Account, id: string, circleId: string): Promise<NewAccount> {
  const kp = KeyPair.fromRandom("ed25519");
  await chain.send(`create ${id} holding only a settle key for ${circleId} (unlimited allowance)`, parent, id, [
    actions.createAccount(),
    actions.transfer(FUNDING.treasurer),
    actions.addFunctionCallAccessKey(kp.getPublicKey(), circleId, ["settle"], undefined),
  ]);
  const { keys } = await chain.provider.viewAccessKeyList({ accountId: id });
  assert.equal(keys.length, 1, "treasurer must have exactly one key");
  const permission = keys[0].access_key.permission as { FunctionCall?: { allowance: string | null; receiver_id: string; method_names: string[] } };
  assert.deepEqual(permission.FunctionCall, { allowance: null, receiver_id: circleId, method_names: ["settle"] });
  console.log(`      on-chain: 1 key, FunctionCall { receiver: ${circleId}, methods: [settle], allowance: unlimited }`);
  return { account: chain.account(id, kp.toString()), privateKey: kp.toString() };
}

/** Deletes every access key of `account` in one transaction, then checks none are left. */
export async function lock(chain: Chain, account: Account): Promise<void> {
  const id = account.accountId;
  const { keys } = await chain.provider.viewAccessKeyList({ accountId: id });
  await chain.send(
    `lock ${id}: delete all ${keys.length} access key(s)`,
    account,
    id,
    keys.map((k) => actions.deleteKey(PublicKey.from(k.public_key))),
  );
  // Check final (not optimistic) state, polling while finality catches up.
  let left = -1;
  for (let i = 0; i < 20 && left !== 0; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1_500));
    left = (await chain.provider.viewAccessKeyList({ accountId: id, finalityQuery: { finality: "final" } })).keys.length;
  }
  assert.equal(left, 0, `${id} still has ${left} key(s)`);
  console.log(`      on-chain (final): ${id} has 0 access keys; its code can never be changed`);
}

/**
 * Tops `member` up to `near` NEAR if they have less, registers them on the
 * token and mints up to 100 USDC if they hold less than 50.
 */
export async function fundMember(chain: Chain, funder: Account, tokenId: string, member: Account, nearTarget: bigint): Promise<void> {
  const id = member.accountId;
  const { amount } = await chain.provider.viewAccount({ accountId: id });
  if (BigInt(amount) < nearTarget) {
    await chain.send(`top up ${id} to its starting NEAR balance`, funder, id, [actions.transfer(nearTarget - BigInt(amount))]);
  }
  const registered = await chain.view(tokenId, "storage_balance_of", { account_id: id });
  if (!registered) {
    await chain.call(`${id} registers on the token`, member, tokenId, "storage_deposit", { account_id: id, registration_only: true }, { deposit: near("0.00125") });
  }
  const balance = BigInt(await chain.view<string>(tokenId, "ft_balance_of", { account_id: id }));
  if (balance < 50n * USDC) {
    const amount = 100n * USDC - balance;
    await chain.call(`mint ${fmt(amount)} mock USDC to ${id}`, funder, tokenId, "mint", { account_id: id, amount: amount.toString() });
  }
}

interface Circle {
  status: string;
  order: string[];
  current_round: number;
  history: { round: number; recipient: string; amount: string; slashed: string; missed: string[]; settled_by: string }[];
}

interface Reputation {
  on_time_contributions: number;
  late_contributions: number;
  missed_contributions: number;
  circles_completed: number;
  defaults: number;
}

/**
 * One full circle: 4 members, 2-minute rounds, every round settled by the
 * treasurer's settle-only key. The member who posts the bond takes the first
 * pot, then misses round 1, so after the grace period the contract records a
 * default and slashes their bond into that round's pot.
 *
 * With `resume`, picks up a demo circle from its on-chain state (forming or
 * active). With `setupOnly`, stops before `start`, so a Telegram group can
 * follow the circle from round 1. With `botSettles`, the script only pays and
 * waits for the treasurer bot to settle each round.
 */
export async function demoCycle(opts: {
  chain: Chain;
  circleId: string;
  tokenId: string;
  members: Account[];
  treasurer: Account;
  resume?: string;
  setupOnly?: boolean;
  botSettles?: boolean;
}): Promise<string> {
  const { chain, circleId, tokenId, members, treasurer } = opts;
  const ids = members.map((m) => m.accountId);
  const [creator] = members;
  const bonded = members[members.length - 1];
  // Early slots keep invitation order, so inviting the bonded member first
  // gives them slot 0 even when others have earned early slots by history.
  const invited = [bonded.accountId, ...ids.filter((a) => a !== bonded.accountId)];
  const byId = new Map(members.map((m) => [m.accountId, m]));
  const view = <T>(method: string, args: Record<string, unknown>) => chain.view<T>(circleId, method, args);
  const balances = () => Promise.all(ids.map(async (id) => BigInt(await chain.view<string>(tokenId, "ft_balance_of", { account_id: id }))));
  let start = await balances();
  let id: string;

  if (opts.resume === undefined) {
    heading("Set up the circle");
    const created = await chain.call(
      `${creator.accountId} creates a circle: ${ids.length} members, 10 USDC per round, 2-minute rounds, 30 s grace, 10 USDC bond for early slots`,
      creator,
      circleId,
      "create_circle",
      {
        config: {
          name: "Demo circle",
          token: tokenId,
          contribution: CONTRIBUTION.toString(),
          members: invited,
          round_duration_sec: ROUND_SEC,
          grace_period_sec: GRACE_SEC,
          early_slot_bond: BOND.toString(),
        },
      },
      { gas: 300n * TGAS, deposit: near("0.2") },
    );
    id = getTransactionLastResult(created) as string;
    console.log(`      circle id ${id}`);
    for (const m of members) {
      await chain.call(`${m.accountId} joins`, m, circleId, "join", { circle_id: id }, { gas: 100n * TGAS, deposit: near("0.05") });
    }
    await pay(bonded, "bond", BOND, `${bonded.accountId} posts the 10 USDC bond for an early slot`);
    if (opts.setupOnly) {
      console.log(`\nCircle ${id} is set up and waiting to start. Follow it in Telegram with /circle ${id}, then run with --resume ${id}.`);
      return id;
    }
    await chain.call(`${creator.accountId} starts the circle`, creator, circleId, "start", { circle_id: id }, { gas: 50n * TGAS });
  } else {
    id = opts.resume;
    let c = await view<Circle>("get_circle", { circle_id: id });
    if (c.status === "Forming") {
      await chain.call(`${creator.accountId} starts the circle`, creator, circleId, "start", { circle_id: id }, { gas: 50n * TGAS });
      c = await view<Circle>("get_circle", { circle_id: id });
    }
    assert.equal(c.status, "Active", `circle ${id} is ${c.status}; only a forming or active demo circle can be resumed`);
    // Balances before the circle: undo what each member has paid in and received so far.
    const { paid } = await view<{ paid: string[] }>("get_round_status", { circle_id: id });
    start = start.map((b, i) => {
      const a = ids[i];
      const settledPaid = c.history.filter((r) => !r.missed.includes(a)).length;
      const paidIn = CONTRIBUTION * BigInt(settledPaid + (paid.includes(a) ? 1 : 0)) + (a === bonded.accountId ? BOND : 0n);
      const received = c.history.filter((r) => r.recipient === a).reduce((s, r) => s + BigInt(r.amount), 0n);
      return b - received + paidIn;
    });
    console.log(`\nResuming circle ${id} at round ${c.current_round}`);
  }

  const { order } = await view<Circle>("get_circle", { circle_id: id });
  console.log(`      payout order: ${order.map((a, i) => `round ${i} → ${a}`).join(", ")}`);
  assert.equal(order[0], bonded.accountId, "the bonded member takes the first slot");
  const defaulter = order[0];

  async function pay(m: Account, kind: string, amount: bigint, label: string): Promise<void> {
    const res = await chain.call(
      label,
      m,
      tokenId,
      "ft_transfer_call",
      { receiver_id: circleId, amount: amount.toString(), msg: JSON.stringify({ circle_id: id, kind }) },
      { gas: 100n * TGAS, deposit: ONE_YOCTO },
    );
    assert.equal(BigInt(getTransactionLastResult(res) as string), amount, `${label}: the contract did not keep the payment`);
  }

  async function settle(round: number, label: string, expectFailure = false) {
    if (opts.botSettles) {
      if (expectFailure) return;
      console.log(`      waiting for the treasurer bot to settle round ${round}...`);
      for (let i = 0; (await view<Circle>("get_circle", { circle_id: id })).history.length <= round; i++) {
        if (i > 200) throw new Error(`the bot did not settle round ${round} within 10 minutes`);
        await new Promise((r) => setTimeout(r, 3_000));
      }
    } else {
      await chain.call(label, treasurer, circleId, "settle", { circle_id: id }, { gas: 300n * TGAS, expectFailure });
      if (expectFailure) return;
    }
    const rec = (await view<Circle>("get_circle", { circle_id: id })).history[round];
    console.log(`      round ${round}: ${fmt(BigInt(rec.amount))} USDC paid to ${rec.recipient}` + (rec.missed.length ? `; missed by ${rec.missed.join(", ")}, ${fmt(BigInt(rec.slashed))} USDC of bond slashed into the pot` : ""));
    return rec;
  }

  const first = (await view<Circle>("get_circle", { circle_id: id })).current_round;
  for (let round = first; round < order.length; round++) {
    heading(`Round ${round}: pot goes to ${order[round]}`);
    const status = await view<{ paid: string[]; grace_ends_ms: number; now_ms: number }>("get_round_status", { circle_id: id });
    const payers = (round === 1 ? ids.filter((a) => a !== defaulter) : ids).filter((a) => !status.paid.includes(a));
    for (const a of payers) await pay(byId.get(a)!, "contribution", CONTRIBUTION, `${a} pays 10 USDC`);

    if (round !== 1) {
      await settle(round, `treasurer settles round ${round} (everyone paid)`);
      continue;
    }

    console.log(`      ${defaulter} already received a pot and does not pay this round`);
    if (!opts.botSettles && (await chain.nowMs()) <= status.grace_ends_ms) {
      await settle(round, "treasurer tries to settle early: refused by the contract, a payment is missing", true);
      await tryAbuse(chain, treasurer, tokenId, circleId, id);
      console.log(`      waiting for the deadline plus grace period (block time ${new Date(status.grace_ends_ms).toISOString()})...`);
      await chain.waitUntil(status.grace_ends_ms + 1_000);
    }
    const rec = await settle(round, `treasurer settles round ${round} after the grace period`);
    assert.deepEqual(rec!.missed, [defaulter]);
    assert.equal(BigInt(rec!.slashed), BOND, "the whole bond is slashed");
    assert.equal(BigInt(rec!.amount), 3n * CONTRIBUTION + BOND, "the recipient is made whole by the bond");
  }

  heading("Result");
  const circle = await view<Circle>("get_circle", { circle_id: id });
  assert.equal(circle.status, "Completed");
  assert.equal(BigInt(await view<string>("get_circle_balance", { circle_id: id })), 0n, "nothing is left in the circle");
  for (const rec of circle.history) assert.equal(rec.settled_by, treasurer.accountId);
  const end = await balances();
  console.log(`      status ${circle.status}; every round settled by ${treasurer.accountId}; circle balance 0`);
  for (const [i, a] of ids.entries()) {
    const rep = await chain.view<Reputation>(circleId, "get_reputation", { account_id: a });
    const net = end[i] - start[i];
    console.log(
      `      ${a.padEnd(36)} net ${net >= 0n ? "+" : ""}${fmt(net)} USDC   on time ${rep.on_time_contributions}, missed ${rep.missed_contributions}, defaults ${rep.defaults}, circles completed ${rep.circles_completed}`,
    );
    assert.equal(net, 0n, `${a} should end even: the bond covered the missed payment`);
  }
  const rep = await chain.view<Reputation>(circleId, "get_reputation", { account_id: defaulter });
  assert.ok(rep.defaults >= 1, "the default is on the record");
  return id;
}

/** The treasurer's key is rejected by the network for anything but `settle` on the circle. */
async function tryAbuse(chain: Chain, treasurer: Account, tokenId: string, circleId: string, id: string): Promise<void> {
  const attempts: [string, string, ReturnType<typeof actions.functionCall>][] = [
    [
      "treasurer key tries ft_transfer of 10 USDC on the token",
      tokenId,
      actions.functionCall("ft_transfer", { receiver_id: treasurer.accountId, amount: CONTRIBUTION.toString() }, 30n * TGAS, 0n),
    ],
    ["treasurer key tries claim on the circle", circleId, actions.functionCall("claim", { circle_id: id }, 30n * TGAS, 0n)],
  ];
  for (const [label, receiverId, action] of attempts) {
    try {
      await treasurer.signAndSendTransaction({ receiverId, actions: [action], waitUntil: "EXECUTED_OPTIMISTIC" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ✗ (expected) ${label}`);
      console.log(`      rejected by the network before execution, no transaction created: ${msg.split("\n")[0]}`);
      continue;
    }
    throw new Error(`${label}: the network accepted it`);
  }
}

function heading(text: string): void {
  console.log(`\n${text}`);
}

export function fmt(amount: bigint): string {
  const sign = amount < 0n ? "-" : "";
  const abs = amount < 0n ? -amount : amount;
  const frac = (abs % USDC).toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}${abs / USDC}${frac ? `.${frac}` : ""}`;
}
