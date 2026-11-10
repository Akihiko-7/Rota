import { createContext, useContext, useState, type ReactNode } from "react";
import { accountUrl, isLive, txUrl, type Net } from "../config";
import { short, usdc } from "../lib/format";
import { markMainnetWarningSeen, mainnetWarningSeen, useNet } from "../lib/net";
import { Link, navigate, useLocation } from "../lib/router";
import { txs, type Tx } from "../lib/rota";
import { useData } from "../lib/useData";
import { useChain } from "../near/chain";
import { useWallet, type Sent } from "../near/wallet";

/** The Rota mark: members around a circle, one receiving the pot. Colours follow the design tokens. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" className="logo-bg" />
      <circle cx="16" cy="16" r="8.5" className="logo-ring" />
      <circle cx="16" cy="7.5" r="3.2" className="logo-dot" />
    </svg>
  );
}

export function Header() {
  const wallet = useWallet();
  const { net, to } = useNet();
  return (
    <div className="header-bar">
      <header className="header">
        <Link to={to("/")} className="brand" aria-label="Rota home">
          <Logo />
          <span>Rota</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <Link to={to("/start")}>{net === "testnet" ? "Try it free" : "Get started"}</Link>
          <Link to={to("/new")}>Start a circle</Link>
          <Link to={to("/rep")}>Payment records</Link>
          <a href={`${to("/")}#how`}>How it works</a>
        </nav>
        <div className="header-right">
          <NetworkSwitch />
          {wallet.accountId ? (
            <div className="who">
              <Link to={to(`/rep/${wallet.accountId}`)} className="pill" title={wallet.accountId}>
                {short(wallet.accountId)}
              </Link>
              <button className="link" onClick={() => void wallet.disconnect()}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="btn small" disabled={!wallet.ready} onClick={() => void wallet.connect()}>
              Connect wallet
            </button>
          )}
        </div>
      </header>
      <nav className="nav-mobile" aria-label="Main (mobile)">
        <Link to={to("/start")}>{net === "testnet" ? "Try it free" : "Get started"}</Link>
        <Link to={to("/new")}>Start a circle</Link>
        <Link to={to("/rep")}>Records</Link>
      </nav>
    </div>
  );
}

/** "Testnet (test wallet)" / "Mainnet (real money)". Keeps the current page; warns once before mainnet. */
export function NetworkSwitch() {
  const { net } = useNet();
  const { path } = useLocation();
  const [confirming, setConfirming] = useState(false);
  const rest = path.replace(/^\/(testnet|mainnet)/, "") || "/";
  const go = (target: Net) => navigate(`/${target}${rest === "/" ? "" : rest}${location.search}`);
  const choose = (target: Net) => {
    if (target === net) return;
    if (target === "mainnet" && !mainnetWarningSeen()) setConfirming(true);
    else go(target);
  };
  return (
    <>
      <div className="netswitch" role="group" aria-label="Network">
        <button aria-pressed={net === "testnet"} className={net === "testnet" ? "on" : ""} onClick={() => choose("testnet")}>
          Testnet <span>(test wallet)</span>
        </button>
        <button aria-pressed={net === "mainnet"} className={net === "mainnet" ? "on main" : ""} onClick={() => choose("mainnet")}>
          Mainnet <span>(real money)</span>
        </button>
      </div>
      {confirming && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="mainnet-warning">
          <div className="modal">
            <h2 id="mainnet-warning">You're switching to real money</h2>
            <p>
              On mainnet, circles use <b>real USDC</b> and <b>real NEAR</b>. Payments can't be undone, and a circle only works if every member keeps
              paying.
            </p>
            <ul>
              <li>Only join circles with people you know and trust.</li>
              <li>Never share your wallet's secret phrase with anyone, including us.</li>
              <li>If you just want to see how it works, stay on testnet: it's free and nothing is real.</li>
            </ul>
            <div className="actions">
              <button
                className="btn"
                onClick={() => {
                  markMainnetWarningSeen();
                  setConfirming(false);
                  go("mainnet");
                }}
              >
                I understand, switch to mainnet
              </button>
              <button className="btn secondary" onClick={() => setConfirming(false)}>
                Stay on testnet
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function NetBanner() {
  const { net, cfg, to } = useNet();
  let body: ReactNode;
  if (net === "testnet") body = <>🧪 Testnet: free test wallet, and the "USDC" here is a test token with no value.</>;
  else if (!isLive(cfg))
    body = (
      <>
        Mainnet is <b>launching soon</b>. Until the mainnet contract is deployed, everything here is read-only. <Link to={to("/start")}>Get ready</Link>.
      </>
    );
  else body = <>💵 Mainnet: real USDC and real NEAR. Payments can't be undone.</>;
  return (
    <div className="banner-wrap">
      <div className={`banner ${net}`}>{body}</div>
    </div>
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
    <div className="notice-wrap">
      <div className={`notice ${notice.error ? "bad" : "good"}`} role="status" data-seq={notice.seq}>
        <p>
          {notice.error ? `Failed: ${notice.label}. ${notice.error}` : `✓ Done: ${notice.label}.`} {notice.hash && <ExplorerLink hash={notice.hash} />}
        </p>
        <button className="link" onClick={clear} aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}

export function Card({ title, children, className = "", id }: { title?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`card ${className}`}>
      {id && <span id={id} className="anchor" />}
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function ExplorerLink({ hash, children = "View on NEAR explorer" }: { hash: string; children?: ReactNode }) {
  const { cfg } = useNet();
  return (
    <a href={txUrl(cfg, hash)} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function AccountLink({ id, children }: { id: string; children?: ReactNode }) {
  const { cfg } = useNet();
  return (
    <a href={accountUrl(cfg, id)} target="_blank" rel="noreferrer">
      {children ?? id}
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
 * A button that asks the wallet to sign `tx`; the result appears in the page
 * notice. Asks to connect first. Disabled where Rota isn't live yet.
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
  const { cfg } = useNet();
  const { show } = useContext(NoticeContext);
  const [busy, setBusy] = useState(false);
  const live = isLive(cfg);
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
  if (!live) {
    return (
      <button className={`btn ${secondary ? "secondary" : ""}`} disabled title="Launching soon on mainnet">
        {children} (launching soon)
      </button>
    );
  }
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

/** Testnet only: the connected wallet's balances, free test USDC and the NEAR faucet. */
export function TestWallet({ onChange }: { onChange?: () => void }) {
  const { net, cfg } = useNet();
  const wallet = useWallet();
  const chain = useChain();
  const { data, reload } = useData(
    async () =>
      wallet.accountId
        ? {
            near: await chain.nearBalance(wallet.accountId).catch(() => 0n),
            usdc: BigInt(await chain.tokenBalance(wallet.accountId)),
            registered: await chain.tokenRegistered(wallet.accountId),
          }
        : undefined,
    [wallet.accountId, net],
  );
  if (net !== "testnet") return null;
  return (
    <Card title="Your test wallet" className="testwallet">
      {!wallet.accountId ? (
        <p className="muted">Connect a testnet wallet to see your test NEAR and test USDC.</p>
      ) : (
        <>
          <dl className="balances">
            <div>
              <dt>Test NEAR</dt>
              <dd>{data ? (Number(data.near / 10n ** 21n) / 1000).toFixed(3) : "…"}</dd>
            </div>
            <div>
              <dt>Test USDC</dt>
              <dd>{data ? usdc(data.usdc).replace(" USDC", "") : "…"}</dd>
            </div>
          </dl>
          <div className="actions">
            <TxButton
              tx={txs(cfg).faucet(wallet.accountId, !data?.registered)}
              onDone={() => {
                void reload();
                onChange?.();
              }}
            >
              Get test USDC
            </TxButton>
          </div>
        </>
      )}
      <p className="small">
        Need test NEAR for fees? Use the official <a href="https://docs.near.org/getting-started/faucet" target="_blank" rel="noreferrer">NEAR testnet faucet</a>{" "}
        or <a href="https://near-faucet.io/" target="_blank" rel="noreferrer">near-faucet.io</a>.
      </p>
    </Card>
  );
}

export function Loading({ what }: { what: string }) {
  return <p className="muted">Loading {what}…</p>;
}

export function ErrorNote({ error }: { error: string }) {
  return <p className="err">Couldn't read from NEAR: {error}</p>;
}

/** Shown where an action needs the mainnet contract, before it's deployed. */
export function LaunchingSoon() {
  const { to } = useNet();
  return (
    <Card title="Launching soon on mainnet" className="soon">
      <p>
        Rota's mainnet contract isn't deployed yet, so there are no real-money circles to show and nothing to sign here. Nothing on this page is faked.
      </p>
      <p>
        Meanwhile you can <Link to={to("/start")}>get your wallet ready</Link>, or switch to <b>Testnet</b> at the top to try everything for free.
      </p>
    </Card>
  );
}
