// Wallet connection, only needed for actions. Reading never needs a wallet.
//
// Production uses NEAR Connect (@hot-labs/near-connect). Builds made with
// VITE_DEV_SIGNER=1 (browser tests only, never deployed) can instead sign with
// a testnet key the test injects as window.__ROTA_DEV_SIGNER__; production
// builds don't contain that code.

import { NearConnector } from "@hot-labs/near-connect";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { NetConfig } from "../config";
import type { Tx } from "../lib/rota";

export interface Sent {
  hash: string;
  /** The transaction's return value, parsed as JSON when possible. */
  result?: unknown;
}

export interface SignedMessage {
  accountId: string;
  publicKey: string;
  signature: string;
}

interface Backend {
  connect(): Promise<string | undefined>;
  disconnect(): Promise<void>;
  current(): Promise<string | undefined>;
  send(tx: Tx): Promise<Sent>;
  signMessage(p: { message: string; recipient: string; nonce: Uint8Array }): Promise<SignedMessage>;
  onChange(cb: (accountId: string | undefined) => void): void;
}

export interface Wallet {
  accountId?: string;
  ready: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(tx: Tx): Promise<Sent>;
  signMessage(p: { message: string; recipient: string; nonce: Uint8Array }): Promise<SignedMessage>;
}

/** Throws a readable error for a failed execution outcome; returns its hash and parsed result. */
export function readOutcome(outcome: unknown): Sent {
  const o = outcome as {
    transaction?: { hash?: string };
    transaction_outcome?: { id?: string };
    status?: { SuccessValue?: string; Failure?: unknown };
    receipts_outcome?: { outcome: { status: { Failure?: unknown } } }[];
  };
  const hash = o?.transaction?.hash ?? o?.transaction_outcome?.id ?? "";
  const failure = o?.status?.Failure ?? o?.receipts_outcome?.find((r) => r.outcome.status.Failure)?.outcome.status.Failure;
  if (failure) {
    const text = JSON.stringify(failure);
    const panic = /"ExecutionError":"((?:[^"\\]|\\.)*)"/.exec(text);
    throw Object.assign(new Error(panic ? JSON.parse(`"${panic[1]}"`) : text), { hash });
  }
  let result: unknown;
  const value = o?.status?.SuccessValue;
  if (value) {
    const raw = atob(value);
    try {
      result = JSON.parse(raw);
    } catch {
      result = raw;
    }
  }
  return { hash, result };
}

function connectorBackend(cfg: NetConfig): Backend {
  const network = cfg.network as "testnet" | "mainnet";
  const connector = new NearConnector({
    network,
    providers: { [network]: cfg.rpc },
    // On testnet, NEAR Connect also hides wallets that don't support testnet.
    features: { signAndSendTransaction: true },
    footerBranding: null,
  });
  return {
    async connect() {
      const wallet = await connector.connect();
      return (await wallet.getAccounts())[0]?.accountId;
    },
    async disconnect() {
      await connector.disconnect();
    },
    async current() {
      try {
        const { accounts } = await connector.getConnectedWallet();
        return accounts[0]?.accountId;
      } catch {
        return undefined;
      }
    },
    async send(tx) {
      const wallet = await connector.wallet();
      return readOutcome(await wallet.signAndSendTransaction({ receiverId: tx.receiverId, actions: tx.actions }));
    },
    async signMessage(p) {
      const wallet = await connector.wallet();
      if (!wallet.manifest?.features?.signMessage) {
        throw new Error(`${wallet.manifest?.name ?? "This wallet"} can't sign messages. Disconnect and choose a wallet that can (for example Meteor or HOT).`);
      }
      return wallet.signMessage(p);
    },
    onChange(cb) {
      connector.on("wallet:signIn", (t) => cb(t.accounts[0]?.accountId));
      connector.on("wallet:signOut", () => cb(undefined));
    },
  };
}

async function devBackend(cfg: NetConfig): Promise<Backend> {
  const { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } = await import("near-api-js");
  const dev = (window as unknown as { __ROTA_DEV_SIGNER__?: { accountId: string; privateKey: string } }).__ROTA_DEV_SIGNER__;
  // Stays connected across reloads within the tab, like a real wallet.
  let accountId: string | undefined = dev && sessionStorage.getItem("rota-dev-connected") === dev.accountId ? dev.accountId : undefined;
  let listener: (a: string | undefined) => void = () => {};
  const keyPair = () => KeyPair.fromString(dev!.privateKey as `ed25519:${string}`);
  return {
    async connect() {
      if (!dev) throw new Error("No dev signer key injected");
      accountId = dev.accountId;
      sessionStorage.setItem("rota-dev-connected", accountId);
      listener(accountId);
      return accountId;
    },
    async disconnect() {
      accountId = undefined;
      sessionStorage.removeItem("rota-dev-connected");
      listener(undefined);
    },
    async current() {
      return accountId;
    },
    async send(tx) {
      const account = new Account(dev!.accountId, new JsonRpcProvider({ url: cfg.rpc[0] }), dev!.privateKey as `ed25519:${string}`);
      const res = await account.signAndSendTransaction({
        receiverId: tx.receiverId,
        actions: tx.actions.map((a) => actions.functionCall(a.params.methodName, a.params.args as Record<string, unknown>, BigInt(a.params.gas), BigInt(a.params.deposit))),
        waitUntil: "EXECUTED_OPTIMISTIC",
        throwOnFailure: false,
      });
      return readOutcome(res);
    },
    async signMessage(p) {
      const signed = await new KeyPairSigner(keyPair()).signNep413Message(dev!.accountId, p);
      return { accountId: dev!.accountId, publicKey: keyPair().getPublicKey().toString(), signature: btoa(String.fromCharCode(...signed.signature)) };
    },
    onChange(cb) {
      listener = cb;
    },
  };
}

const WalletContext = createContext<Wallet | null>(null);

/** Remount (key by network) to switch the wallet's network. */
export function WalletProvider({ cfg, children }: { cfg: NetConfig; children: ReactNode }) {
  const [backend, setBackend] = useState<Backend>();
  const [accountId, setAccountId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const make = import.meta.env.VITE_DEV_SIGNER === "1" && cfg.network === "testnet" ? devBackend(cfg) : Promise.resolve(connectorBackend(cfg));
    make.then(async (b) => {
      if (cancelled) return;
      b.onChange(setAccountId);
      setAccountId(await b.current());
      setBackend(b);
    });
    return () => {
      cancelled = true;
    };
  }, [cfg]);

  const connect = useCallback(async () => {
    if (!backend) return;
    setAccountId(await backend.connect());
  }, [backend]);

  const value = useMemo<Wallet>(
    () => ({
      accountId,
      ready: Boolean(backend),
      connect,
      disconnect: async () => {
        await backend?.disconnect();
        setAccountId(undefined);
      },
      send: async (tx) => {
        if (!backend) throw new Error("The wallet isn't ready yet.");
        return backend.send(tx);
      },
      signMessage: async (p) => {
        if (!backend) throw new Error("The wallet isn't ready yet.");
        return backend.signMessage(p);
      },
    }),
    [accountId, backend, connect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(WalletContext);
  if (!w) throw new Error("useWallet outside WalletProvider");
  return w;
}
