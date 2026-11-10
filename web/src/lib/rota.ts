// Circle contract types and the transactions the web app asks wallets to sign.
// Amounts and gas are strings (yocto / gas units), as wallets expect.

import { config } from "../config";

export type Status = "Forming" | "Active" | "Completed" | "Dissolved";

export interface Member {
  account_id: string;
  joined: boolean;
  bond: string;
  claimable: string;
  paid_round: number | null;
  missed: number;
}

export interface RoundRecord {
  round: number;
  recipient: string;
  amount: string;
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
  swaps: { proposer: string; other: string }[];
  dissolve_votes: string[];
}

export interface RoundStatus {
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

export interface FunctionCall {
  type: "FunctionCall";
  params: { methodName: string; args: object; gas: string; deposit: string };
}

export interface Tx {
  receiverId: string;
  actions: FunctionCall[];
  /** What the wallet is asked to do, in plain words. */
  label: string;
}

const TGAS = 10n ** 12n;
const NEAR = 10n ** 24n;
const call = (methodName: string, args: object, tgas: bigint, deposit: bigint = 0n): FunctionCall => ({
  type: "FunctionCall",
  params: { methodName, args, gas: (tgas * TGAS).toString(), deposit: deposit.toString() },
});
const circleTx = (label: string, ...actions: FunctionCall[]): Tx => ({ receiverId: config.contractId, actions, label });

export interface NewCircle {
  name: string;
  members: string[];
  contribution: bigint;
  roundSec: number;
  graceSec: number;
  bond: bigint;
}

export const tx = {
  /** 0.2 NEAR covers storage for up to 10 members; the contract refunds the rest. */
  create: (c: NewCircle) =>
    circleTx(
      `Create "${c.name}"`,
      call(
        "create_circle",
        {
          config: {
            name: c.name,
            token: config.tokenId,
            contribution: c.contribution.toString(),
            members: c.members,
            round_duration_sec: c.roundSec,
            grace_period_sec: c.graceSec,
            early_slot_bond: c.bond.toString(),
          },
        },
        300n,
        NEAR / 5n,
      ),
    ),
  join: (id: string) => circleTx("Join the circle", call("join", { circle_id: id }, 100n, NEAR / 20n)),
  start: (id: string) => circleTx("Start the circle", call("start", { circle_id: id }, 50n)),
  settle: (id: string) => circleTx("Pay out this round", call("settle", { circle_id: id }, 300n)),
  claim: (id: string) => circleTx("Claim your money", call("claim", { circle_id: id }, 100n, 1n)),
  proposeSwap: (id: string, other: string) => circleTx("Propose a swap of turns", call("propose_swap", { circle_id: id, other }, 30n, 1n)),
  acceptSwap: (id: string, proposer: string) => circleTx("Accept the swap of turns", call("accept_swap", { circle_id: id, proposer }, 30n, 1n)),
  proposeDissolve: (id: string) => circleTx("Propose closing the circle", call("propose_dissolve", { circle_id: id }, 150n, 1n)),
  voteDissolve: (id: string) => circleTx("Vote to close the circle", call("vote_dissolve", { circle_id: id }, 150n, 1n)),
  /** Contribution or bond: ft_transfer_call on the token, with the circle as receiver. */
  pay: (id: string, kind: "contribution" | "bond", amount: string): Tx => ({
    receiverId: config.tokenId,
    label: kind === "bond" ? "Post your deposit" : "Pay this round",
    actions: [
      call(
        "ft_transfer_call",
        { receiver_id: config.contractId, amount, msg: JSON.stringify({ circle_id: id, kind }) },
        100n,
        1n,
      ),
    ],
  }),
  /** Testnet only: register on the mock token if needed and mint 100 free test USDC. */
  faucet: (accountId: string, register: boolean): Tx => ({
    receiverId: config.tokenId,
    label: "Get 100 free test USDC",
    actions: [
      ...(register ? [call("storage_deposit", { account_id: accountId, registration_only: true }, 30n, 1_250_000_000_000_000_000_000n)] : []),
      call("mint", { account_id: accountId, amount: "100000000" }, 30n),
    ],
  }),
};

/** Mirrors the contract's create_circle checks, so the form can explain problems before signing. */
export function validate(c: NewCircle): string | undefined {
  if (!c.name.trim()) return "Give the circle a name.";
  if (c.members.length < 2 || c.members.length > 10) return "A circle needs 2 to 10 members.";
  if (new Set(c.members).size !== c.members.length) return "Each member can only be listed once.";
  if (c.contribution <= 0n) return "The amount per round must be more than 0.";
  if (c.roundSec < 60) return "Rounds must be at least 1 minute long.";
  if (c.graceSec > 30 * 86400) return "The grace period can be at most 30 days.";
  return undefined;
}
