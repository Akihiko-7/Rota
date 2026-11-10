// Read-only chain access from the browser. No wallet or key needed.

import { JsonRpcProvider } from "near-api-js";
import { config } from "../config";
import type { Circle, Reputation, RoundStatus } from "../lib/rota";

const providers = config.rpc.map((url) => new JsonRpcProvider({ url }));

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

export const view = <T,>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  withRpc((p) => p.callFunction({ contractId, method, args }) as Promise<T>);

export const getCircle = (id: string) => view<Circle | null>(config.contractId, "get_circle", { circle_id: id });
export const getRoundStatus = (id: string) => view<RoundStatus>(config.contractId, "get_round_status", { circle_id: id });
export const getReputation = (accountId: string) => view<Reputation>(config.contractId, "get_reputation", { account_id: accountId });
export const getCircleCount = () => view<string>(config.contractId, "get_circle_count");
export const listCirclesFor = (accountId: string) => view<string[]>(config.contractId, "list_circles_for", { account_id: accountId });
export const tokenBalance = (accountId: string) => view<string>(config.tokenId, "ft_balance_of", { account_id: accountId });
export const tokenRegistered = async (accountId: string) =>
  (await view<unknown>(config.tokenId, "storage_balance_of", { account_id: accountId })) !== null;

export interface KeyInfo {
  publicKey: string;
  permission: "FullAccess" | { receiver: string; methods: string[]; allowance: string | null };
}

export async function accessKeys(accountId: string): Promise<KeyInfo[]> {
  const list = await withRpc((p) => p.viewAccessKeyList({ accountId, finalityQuery: { finality: "final" } }));
  return list.keys.map((k) => {
    const perm = k.access_key.permission as "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[]; allowance: string | null } };
    return {
      publicKey: k.public_key,
      permission: perm === "FullAccess" ? "FullAccess" : { receiver: perm.FunctionCall.receiver_id, methods: perm.FunctionCall.method_names, allowance: perm.FunctionCall.allowance },
    };
  });
}

export async function codeHash(accountId: string): Promise<string> {
  return (await withRpc((p) => p.viewAccount({ accountId, blockQuery: { finality: "final" } }))).code_hash;
}
