import { createContext, useContext, useState, type ReactNode } from "react";
import { accountUrl, isTestnet, txUrl } from "../config";
import { short } from "../lib/format";
import { Link } from "../lib/router";
import type { Tx } from "../lib/rota";
import { useWallet, type Sent } from "../near/wallet";

export function Header() {
  const wallet = useWallet();
  return (
    <header className="header">
      <Link to="/" className="brand" aria-label="Rota home">
        <img src="/favicon.svg" alt="" width={28} height={28} />
        <span>Rota</span>
      </Link>
      {wallet.accountId ? (
        <div className="who">
          <a href={accountUrl(wallet.accountId)} target="_blank" rel="noreferrer" className="pill" title={wallet.accountId}>
            {short(wallet.accountId)}
          </a>
          <button className="link" onClick={() => void wallet.disconnect()}>
            Disconnect
          </button>
        </div>
      ) : (
        <button className="btn small" disabled={!wallet.ready} onClick={() => void wallet.connect()}>
          Connect wallet
        </button>
      )}
    </header>
  );
}

/** The result of the last transaction, shown at the top of the page so it survives the button disappearing. */
interface Notice {
  seq: number;
  label: string;
  hash?: string;
  error?: string;
}
const NoticeContext = createContext<{ notice?: Notice; show(n: Omit<Notice, "seq">): void; clear(): void }>({ show: () => {}, clear: () => {} });

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice>();
  const value = {
    notice,
    show: (n: Omit<Notice, "seq">) => setNotice((old) => ({ ...n, seq: (old?.seq ?? 0) + 1 })),
    clear: () => setNotice(undefined),
  };
  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>;
}

export function NoticeBar() {
  const { notice, clear } = useContext(NoticeContext);
  if (!notice) return null;
  return (
    <div className={`notice ${notice.error ? "bad" : "good"}`} role="status" data-seq={notice.seq}>
      <p>
        {notice.error ? `❌ ${notice.label}: ${notice.error}` : `✅ Done: ${notice.label}.`}{" "}
        {notice.hash && <ExplorerLink hash={notice.hash} />}
      </p>
      <button className="link" onClick={clear} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

export function TestnetBanner() {
  if (!isTestnet) return null;
  return <div className="banner">🧪 Test network. The "USDC" here is a free test token with no value.</div>;
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function ExplorerLink({ hash, children = "View on NEAR explorer" }: { hash: string; children?: ReactNode }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer">
      🧾 {children}
    </a>
  );
}

export function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn small secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

/**
 * A button that asks the wallet to sign `tx`, then shows the outcome in plain
 * words with an explorer link. Asks to connect first if no wallet is connected.
 */
export function TxButton({
  tx,
  children,
  onDone,
  secondary,
  disabled,
}: {
  tx: Tx;
  children: ReactNode;
  onDone?: (sent: Sent) => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const wallet = useWallet();
  const { show } = useContext(NoticeContext);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const sent = await wallet.send(tx);
      show({ label: tx.label, hash: sent.hash });
      onDone?.(sent);
    } catch (e) {
      show({ label: tx.label, error: e instanceof Error ? e.message : String(e), hash: (e as { hash?: string }).hash });
    } finally {
      setBusy(false);
    }
  };
  if (!wallet.accountId) {
    return (
      <button className={`btn ${secondary ? "secondary" : ""}`} disabled={!wallet.ready} onClick={() => void wallet.connect()}>
        Connect a wallet to continue
      </button>
    );
  }
  return (
    <div className="tx">
      <button className={`btn ${secondary ? "secondary" : ""}`} disabled={busy || disabled} onClick={() => void run()}>
        {busy ? "Waiting for your wallet…" : children}
      </button>
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <p className="muted">Loading {what}…</p>;
}

export function ErrorNote({ error }: { error: string }) {
  return <p className="err">Couldn't read from NEAR: {error}</p>;
}
