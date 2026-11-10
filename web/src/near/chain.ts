// Read-only chain access from the browser, per network. No wallet needed.

import { JsonRpcProvider } from "near-api-js";
import type { NetConfig } from "../config";
import { useNet } from "../lib/net";
import type { Circle, HarvestPot, HarvestStatus, Reputation, RoundStatus } from "../lib/rota";

export interface KeyInfo {
  publicKey: string;
  permission: "FullAccess" | { receiver: string; methods: string[]; allowance: string | null };
}

const cache = new Map<string, ReturnType<typeof make>>();

function make(cfg: NetConfig) {
  const providers = cfg.rpc.map((url) => new JsonRpcProvider({ url }));
  /** Tries each RPC endpoint in turn. */
  async function withRpc<T>(read: (p: JsonRpcProvider) => Promise<T>): Promise<T> {
    let last: unknown;
    for (const p of providers) {
      try {
        return await read(p);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }
  const view = <T,>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
    withRpc((p) => p.callFunction({ contractId, method, args }) as Promise<T>);
  const contract = () => {
    if (!cfg.contractId) throw new Error(`Rota isn't live on ${cfg.network} yet.`);
    return cfg.contractId;
  };
  return {
    view,
    getCircle: (id: string) => view<Circle | null>(contract(), "get_circle", { circle_id: id }),
    getRoundStatus: (id: string) => view<RoundStatus>(contract(), "get_round_status", { circle_id: id }),
    getReputation: (accountId: string) => view<Reputation>(contract(), "get_reputation", { account_id: accountId }),
    listCirclesFor: (accountId: string) => view<string[]>(contract(), "list_circles_for", { account_id: accountId }),
    tokenBalance: (accountId: string) => view<string>(cfg.tokenId, "ft_balance_of", { account_id: accountId }),
    tokenRegistered: async (accountId: string) => (await view<unknown>(cfg.tokenId, "storage_balance_of", { account_id: accountId })) !== null,
    async nearBalance(accountId: string): Promise<bigint> {
      return BigInt((await withRpc((p) => p.viewAccount({ accountId, blockQuery: { finality: "final" } }))).amount);
    },
    async accessKeys(accountId: string): Promise<KeyInfo[]> {
      const list = await withRpc((p) => p.viewAccessKeyList({ accountId, finalityQuery: { finality: "final" } }));
      return list.keys.map((k) => {
        const perm = k.access_key.permission as "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[]; allowance: string | null } };
        return {
          publicKey: k.public_key,
          permission:
            perm === "FullAccess" ? "FullAccess" : { receiver: perm.FunctionCall.receiver_id, methods: perm.FunctionCall.method_names, allowance: perm.FunctionCall.allowance },
        };
      });
    },
    async codeHash(accountId: string): Promise<string> {
      return (await withRpc((p) => p.viewAccount({ accountId, blockQuery: { finality: "final" } }))).code_hash;
    },
    harvest: {
      pot: (contractId: string, id: string) => view<HarvestPot | null>(contractId, "get_pot", { pot_id: id }),
      status: (contractId: string, id: string) => view<HarvestStatus>(contractId, "get_status", { pot_id: id }),
      count: async (contractId: string) => Number(await view<string>(contractId, "get_pot_count")),
      /** What the Harvest contract holds in the pool (staked + unstaked), yocto. */
      inPool: async (poolId: string, contractId: string) => BigInt(await view<string>(poolId, "get_account_total_balance", { account_id: contractId })),
    },
    /** The current epoch: its height, start time, and average length from recent block times. */
    async epochs(): Promise<{ height: number; startMs: number; msPerEpoch: number; epochLength: number }> {
      const config = await rawRpc<{ epoch_length: number }>("EXPERIMENTAL_protocol_config", { finality: "final" });
      const v = await rawRpc<{ epoch_start_height: number; epoch_height: number }>("validators", [null]);
      const head = (await rawRpc<{ header: { height: number; timestamp_nanosec: string } }>("block", { finality: "final" })).header;
      const start = (await rawRpc<{ header: { timestamp_nanosec: string } }>("block", { block_id: v.epoch_start_height })).header;
      const startMs = Number(BigInt(start.timestamp_nanosec) / 1_000_000n);
      const nowMs = Number(BigInt(head.timestamp_nanosec) / 1_000_000n);
      const msPerBlock = (nowMs - startMs) / Math.max(1, head.height - v.epoch_start_height);
      return { height: v.epoch_height, startMs, msPerEpoch: msPerBlock * config.epoch_length, epochLength: config.epoch_length };
    },
    /**
     * The pool's current APY, calculated from NEAR's on-chain reward parameters:
     * yearly inflation × validators' share × total supply ÷ total stake, less the pool's fee.
     */
    async poolApy(poolId: string): Promise<{ apy: number; fee: number; inflation: number; validatorShare: number; supply: bigint; stake: bigint }> {
      const config = await rawRpc<{ max_inflation_rate: [number, number]; protocol_reward_rate: [number, number] }>("EXPERIMENTAL_protocol_config", { finality: "final" });
      const v = await rawRpc<{ current_validators: { stake: string }[] }>("validators", [null]);
      const head = (await rawRpc<{ header: { total_supply: string } }>("block", { finality: "final" })).header;
      const fee = await view<{ numerator: number; denominator: number }>(poolId, "get_reward_fee_fraction");
      const inflation = config.max_inflation_rate[0] / config.max_inflation_rate[1];
      const validatorShare = 1 - config.protocol_reward_rate[0] / config.protocol_reward_rate[1];
      const supply = BigInt(head.total_supply);
      const stake = v.current_validators.reduce((s, x) => s + BigInt(x.stake), 0n);
      const feeRate = fee.numerator / fee.denominator;
      const apy = inflation * validatorShare * (Number(supply / 10n ** 18n) / Number(stake / 10n ** 18n)) * (1 - feeRate);
      return { apy, fee: feeRate, inflation, validatorShare, supply, stake };
    },
  };

  async function rawRpc<T>(method: string, params: unknown): Promise<T> {
    let last: unknown;
    for (const url of cfg.rpc) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const body = (await res.json()) as { result?: T; error?: unknown };
        if (body.result !== undefined) return body.result;
        last = body.error;
      } catch (e) {
        last = e;
      }
    }
    throw new Error(`${method}: ${JSON.stringify(last)}`);
  }
}

export type Chain = ReturnType<typeof make>;

export function chainFor(cfg: NetConfig): Chain {
  let c = cache.get(cfg.network);
  if (!c) cache.set(cfg.network, (c = make(cfg)));
  return c;
}

export function useChain(): Chain {
  return chainFor(useNet().cfg);
}
