// Everything the bot reads from or signs on chain. It signs with exactly one
// key: the treasurer's function-call key, which NEAR only accepts for `settle`
// on the circle contract. The bot never holds member or deployer keys.

import { strict as assert } from "node:assert";
import { verifyMessage } from "near-api-js/nep413";
import type { Account } from "near-api-js";
import { Chain, TGAS, actions, failureOf } from "../../scripts/lib/near.ts";

export type Status = "Forming" | "Active" | "Completed" | "Dissolved";

export interface Member {
  account_id: string;
  joined: boolean;
  bond: string;
  claimable: string;
  paid_round: number | null;
  paid_at_ms: number | null;
  missed: number;
}

export interface RoundRecord {
  round: number;
  recipient: string;
  amount: string;
  contributions: number;
  slashed: string;
  missed: string[];
  settled_at_ms: number;
  settled_by: string;
  payout: "Empty" | "Pending" | "Paid" | "Claimable";
}

export interface Circle {
  id: string;
  name: string;
  creator: string;
  token: string;
  contribution: string;
  early_slot_bond: string;
  round_duration_sec: number;
  grace_period_sec: number;
  status: Status;
  members: Member[];
  order: string[];
  current_round: number;
  start_ms: number;
  history: RoundRecord[];
}

export interface RoundStatus {
  circle_id: string;
  status: Status;
  round: number;
  rounds_total: number;
  recipient: string | null;
  deadline_ms: number;
  grace_ends_ms: number;
  now_ms: number;
  paid: string[];
  unpaid: string[];
  collected: string;
  can_settle: boolean;
}

export interface Reputation {
  on_time_contributions: number;
  late_contributions: number;
  missed_contributions: number;
  circles_completed: number;
  defaults: number;
}

/**
 * What happened to a transaction: executed (`ok` or `failed`, with a hash), or
 * `rejected` by the network before it existed (no hash; e.g. the key may not
 * call that method).
 */
export interface TxOutcome {
  status: "ok" | "failed" | "rejected";
  hash?: string;
  url?: string;
  error?: string;
}

export interface Nep413Proof {
  accountId: string;
  publicKey: string;
  signature: Uint8Array;
  payload: { message: string; recipient: string; nonce: Uint8Array };
}

export interface Ledger {
  readonly network: string;
  readonly contractId: string;
  readonly tokenId: string;
  readonly treasurerId: string;
  circle(id: string): Promise<Circle | null>;
  roundStatus(id: string): Promise<RoundStatus>;
  reputation(accountId: string): Promise<Reputation>;
  /** Calls `settle` with the treasurer key. `extraArgs` lets /redteam inject arguments. */
  settle(id: string, extraArgs?: Record<string, unknown>): Promise<TxOutcome>;
  /** Tries a function call with the treasurer key that its permission should not allow. */
  attempt(receiverId: string, method: string, args: Record<string, unknown>, deposit: bigint): Promise<TxOutcome>;
  /** Throws unless `proof` is a valid NEP-413 signature by a full-access key of `proof.accountId`. */
  verifyNep413(proof: Nep413Proof): Promise<void>;
  accountUrl(id: string): string | undefined;
}

export class NearLedger implements Ledger {
  readonly network: string;
  readonly contractId: string;
  readonly tokenId: string;
  readonly treasurerId: string;
  private readonly chain: Chain;
  private readonly treasurer: Account;

  constructor(chain: Chain, contractId: string, tokenId: string, treasurer: Account) {
    this.chain = chain;
    this.network = chain.network;
    this.contractId = contractId;
    this.tokenId = tokenId;
    this.treasurer = treasurer;
    this.treasurerId = treasurer.accountId;
  }

  /**
   * Refuses to run with any key other than a settle-only function-call key on
   * this contract. Returns a one-line description of the key.
   */
  async checkTreasurerKey(): Promise<string> {
    const publicKey = await this.treasurer.getSigner()!.getPublicKey();
    const key = await this.chain.provider.viewAccessKey({ accountId: this.treasurerId, publicKey });
    const fc = (key.permission as { FunctionCall?: { receiver_id: string; method_names: string[]; allowance: string | null } }).FunctionCall;
    assert.ok(fc, `the treasurer key on ${this.treasurerId} is a full-access key; the bot only runs with a settle-only function-call key`);
    assert.equal(fc.receiver_id, this.contractId, `the treasurer key may call ${fc.receiver_id}, not ${this.contractId}`);
    assert.deepEqual(fc.method_names, ["settle"], `the treasurer key allows [${fc.method_names}], not just [settle]`);
    return `${this.treasurerId}: function-call key, receiver ${fc.receiver_id}, methods [settle], allowance ${fc.allowance ?? "unlimited"}`;
  }

  async circle(id: string): Promise<Circle | null> {
    return this.chain.view<Circle | null>(this.contractId, "get_circle", { circle_id: id });
  }

  async roundStatus(id: string): Promise<RoundStatus> {
    return this.chain.view<RoundStatus>(this.contractId, "get_round_status", { circle_id: id });
  }

  async reputation(accountId: string): Promise<Reputation> {
    return this.chain.view<Reputation>(this.contractId, "get_reputation", { account_id: accountId });
  }

  async settle(id: string, extraArgs: Record<string, unknown> = {}): Promise<TxOutcome> {
    return this.attempt(this.contractId, "settle", { circle_id: id, ...extraArgs }, 0n);
  }

  async attempt(receiverId: string, method: string, args: Record<string, unknown>, deposit: bigint): Promise<TxOutcome> {
    const label = `treasurer key: ${method} on ${receiverId}`;
    try {
      const res = await this.chain.send(label, this.treasurer, receiverId, [actions.functionCall(method, args, 300n * TGAS, deposit)], {
        allowFailure: true,
      });
      const hash = res.transaction.hash;
      const error = failureOf(res);
      return { status: error ? "failed" : "ok", hash, url: this.chain.txUrl(hash), error };
    } catch (e) {
      const error = (e instanceof Error ? e.message : String(e)).split("\n")[0];
      console.log(`  ✗ ${label}: rejected by the network: ${error}`);
      return { status: "rejected", error };
    }
  }

  async verifyNep413(proof: Nep413Proof): Promise<void> {
    await verifyMessage({
      signerAccountId: proof.accountId,
      signerPublicKey: proof.publicKey,
      payload: proof.payload,
      signature: proof.signature,
      provider: this.chain.provider,
    });
  }

  accountUrl(id: string): string | undefined {
    return this.chain.accountUrl(id);
  }
}
