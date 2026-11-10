// Read-only chain access from the browser, per network. No wallet needed.

import { JsonRpcProvider } from "near-api-js";
import type { NetConfig } from "../config";
import { useNet } from "../lib/net";
import type { Circle, Reputation, RoundStatus } from "../lib/rota";

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
  };
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
