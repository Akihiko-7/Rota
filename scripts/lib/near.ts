// Chain access shared by the deploy and demo scripts: NEAR testnet, or a local
// sandbox that needs no secrets. Every transaction goes through `send`, which
// prints its hash (and explorer link on testnet) and records it.

import { Account, FailoverRpcProvider, JsonRpcProvider, actions, getTransactionLastResult, nearToYocto } from "near-api-js";
import type { KeyPairString } from "near-api-js";

export type Network = "testnet" | "sandbox";
type Action = Parameters<Account["signAndSendTransaction"]>[0]["actions"][number];
type TxResult = Awaited<ReturnType<Account["signAndSendTransaction"]>>;

export const TGAS = 10n ** 12n;
export const ONE_YOCTO = 1n;
export const near = (amount: string): bigint => nearToYocto(amount as `${number}`);
export { actions };

export interface TxRecord {
  label: string;
  hash: string;
  signer: string;
  receiver: string;
  ok: boolean;
  error?: string;
  url?: string;
}

/** Timeouts, unreachable hosts, rate limits and gateway errors: worth trying another RPC. */
export function isNetworkError(e: unknown): boolean {
  const text = `${e instanceof Error ? e.message : e} ${JSON.stringify((e as { cause?: unknown })?.cause ?? "")}`;
  return /fetch failed|ETIMEDOUT|ENETUNREACH|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket|timeout|429|50[234]/i.test(text);
}

/**
 * near-api-js's FailoverRpcProvider, changed to fail over only on network
 * errors. Other errors (e.g. "Access key does not allow method claim") are
 * thrown unchanged instead of being retried and wrapped in a generic
 * "Exceeded N providers" error. Uses the 7.4.0 internals (pinned exactly).
 */
class NetworkFailover extends FailoverRpcProvider {
  async withBackoff<T>(getResult: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    const self = this as unknown as { providers: JsonRpcProvider[]; currentProvider: JsonRpcProvider; switchToNextProvider(): void };
    let last: unknown;
    for (let i = 0; i < self.providers.length; i++) {
      try {
        return await getResult(self.currentProvider);
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        last = e;
        self.switchToNextProvider();
      }
    }
    throw last;
  }
}

export class Chain {
  readonly network: Network;
  readonly rpcUrl: string;
  readonly provider: FailoverRpcProvider;
  readonly log: TxRecord[] = [];

  /** `rpcUrl` may list several endpoints, comma-separated; calls fail over between them. */
  constructor(network: Network, rpcUrl: string) {
    this.network = network;
    const urls = rpcUrl.split(",").map((u) => u.trim()).filter(Boolean);
    this.rpcUrl = urls[0];
    this.provider = new NetworkFailover(urls.map((url) => new JsonRpcProvider({ url })));
  }

  txUrl(hash: string): string | undefined {
    return this.network === "testnet" ? `https://testnet.nearblocks.io/txns/${hash}` : undefined;
  }

  accountUrl(id: string): string | undefined {
    return this.network === "testnet" ? `https://testnet.nearblocks.io/address/${id}` : undefined;
  }

  account(id: string, privateKey: string): Account {
    return new Account(id, this.provider, privateKey as KeyPairString);
  }

  async exists(id: string): Promise<boolean> {
    return this.provider.viewAccount({ accountId: id }).then(
      () => true,
      () => false,
    );
  }

  async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await retryReads(() => this.provider.callFunction({ contractId, method, args }))) as T;
  }

  async keyCount(id: string): Promise<number> {
    return (await this.provider.viewAccessKeyList({ accountId: id })).keys.length;
  }

  /** Block time of the latest block, in ms. */
  async nowMs(): Promise<number> {
    const block = await retryReads(() => this.provider.viewBlock({ finality: "optimistic" }));
    return Number(BigInt(block.header.timestamp_nanosec) / 1_000_000n);
  }

  /**
   * Returns once block time is past `ms`. The sandbox fast-forwards blocks
   * (about 0.25 s of block time each); testnet waits in real time.
   */
  async waitUntil(ms: number): Promise<void> {
    for (;;) {
      const now = await this.nowMs();
      if (now > ms) return;
      if (this.network === "sandbox") {
        await this.rpc("sandbox_fast_forward", { delta_height: Math.ceil((ms - now) / 250) + 10 });
      } else {
        await new Promise((r) => setTimeout(r, Math.min(5_000, ms - now + 1_000)));
      }
    }
  }

  private async rpc(method: string, params: unknown): Promise<unknown> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "rota", method, params }),
    });
    const body = (await res.json()) as { result?: unknown; error?: unknown };
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  }

  /**
   * Signs and sends one transaction and waits until all its receipts have
   * executed. Throws if it fails, unless `expectFailure` is set, in which case
   * it throws if it succeeds.
   */
  async send(
    label: string,
    signer: Account,
    receiverId: string,
    txActions: Action[],
    opts: { expectFailure?: boolean; allowFailure?: boolean } = {},
  ): Promise<TxResult> {
    const res = await signer.signAndSendTransaction({
      receiverId,
      actions: txActions,
      waitUntil: "EXECUTED_OPTIMISTIC",
      throwOnFailure: false,
    });
    const hash = res.transaction.hash;
    const error = failureOf(res);
    const rec: TxRecord = { label, hash, signer: signer.accountId, receiver: receiverId, ok: !error, url: this.txUrl(hash) };
    if (error) rec.error = error;
    this.log.push(rec);

    const mark = error ? (opts.expectFailure ? "✗ (expected)" : "✗") : "✓";
    console.log(`  ${mark} ${label}`);
    console.log(`      tx ${hash}${rec.url ? `  ${rec.url}` : ""}`);
    if (error) console.log(`      error: ${error}`);
    if (opts.allowFailure) return res;
    if (error && !opts.expectFailure) throw new Error(`${label} failed: ${error}`);
    if (!error && opts.expectFailure) throw new Error(`${label} was expected to fail but succeeded`);
    return res;
  }

  /**
   * `send` for a single function call. With `allowFailure`, returns failed
   * transactions instead of throwing (read the error with `failureOf`).
   */
  call(
    label: string,
    signer: Account,
    contractId: string,
    method: string,
    args: Record<string, unknown>,
    opts: { gas?: bigint; deposit?: bigint; expectFailure?: boolean; allowFailure?: boolean } = {},
  ): Promise<TxResult> {
    const action = actions.functionCall(method, args, opts.gas ?? 30n * TGAS, opts.deposit ?? 0n);
    return this.send(label, signer, contractId, [action], opts);
  }
}

export { getTransactionLastResult };

/**
 * Retries a read through network errors (timeouts, unreachable RPC) for about
 * two minutes. Only reads: retrying a send could submit a transaction twice.
 */
async function retryReads<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (e) {
      if (!isNetworkError(e) || attempt >= 24) throw e;
      console.log(`      (RPC unreachable, retrying read in 5 s: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)})`);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

/**
 * The first failure in the transaction or any of its receipts, as text.
 * Ignores the one expected failure: after a DeleteAccount, the gas refund to
 * the deleted signer fails with AccountDoesNotExist.
 */
export function failureOf(res: TxResult): string | undefined {
  const signer = res.transaction.signer_id;
  const outcomes = [res.transaction_outcome, ...res.receipts_outcome];
  for (const o of outcomes) {
    const status = o.outcome.status as Record<string, unknown>;
    if (!status || typeof status !== "object" || !("Failure" in status)) continue;
    const text = JSON.stringify(status.Failure);
    if (o.outcome.executor_id === signer && text.includes(`"AccountDoesNotExist":{"account_id":"${signer}"}`)) continue;
    return describe(status.Failure);
  }
  const top = res.status as Record<string, unknown>;
  if (top && typeof top === "object" && "Failure" in top) return describe(top.Failure);
  return undefined;
}

function describe(failure: unknown): string {
  const text = JSON.stringify(failure);
  const panic = /"ExecutionError":"((?:[^"\\]|\\.)*)"/.exec(text);
  return panic ? JSON.parse(`"${panic[1]}"`) : text;
}
