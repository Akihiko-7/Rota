import { useEffect, useState } from "react";
import { span, usdc } from "../lib/format";
import { getQuote, getStatus, isFinal, ORIGINS, STATUS_TEXT, type Quote, type StatusResponse } from "../lib/oneclick";
import { useNow } from "../lib/useData";
import { Copy } from "./ui";

interface Swap {
  origin: string;
  refundTo: string;
  quote: Quote;
}

// The active swap and the last chain and address used. Per viewer and best
// effort: if storage is unavailable the swap is still shown until a reload.
function load<T>(key: string): T | undefined {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}
function save(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/**
 * Turns USDC on another chain into `amount` of USDC on NEAR in the member's own
 * account through NEAR Intents (1Click). The member then pays with the usual
 * Pay button. Mainnet only.
 */
export function CrossChainPay({ amount, accountId, registered, swapKey, onArrived }: { amount: bigint; accountId: string; registered: boolean; swapKey: string; onArrived: () => void }) {
  const [open, setOpen] = useState(() => load<Swap>(swapKey) !== undefined);
  const last = load<{ origin: string; refundTo: string }>("rota:xchain:last");
  const [originId, setOriginId] = useState(last?.origin ?? ORIGINS[0].id);
  const [refundTo, setRefundTo] = useState(last?.refundTo ?? "");
  const [swap, setSwap] = useState<Swap | undefined>(() => load<Swap>(swapKey));
  const [status, setStatus] = useState<StatusResponse>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const now = useNow();
  const origin = ORIGINS.find((o) => o.id === originId) ?? ORIGINS[0];

  useEffect(() => {
    if (!swap) return;
    let stop = false;
    const poll = async () => {
      try {
        const s = await getStatus(swap.quote.depositAddress);
        if (stop) return;
        setStatus(s);
        if (s.status === "SUCCESS") onArrived();
        if (isFinal(s.status)) return;
      } catch {
        // A status read failing (e.g. just after the quote) is retried.
      }
      if (!stop) setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap?.quote.depositAddress]);

  if (!open)
    return (
      <button className="btn secondary" onClick={() => setOpen(true)}>
        Pay from another chain
      </button>
    );

  const start = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const quote = await getQuote({ origin, amount, recipient: accountId, refundTo: refundTo.trim(), dry: false });
      const s = { origin: origin.id, refundTo: refundTo.trim(), quote };
      save(swapKey, s);
      save("rota:xchain:last", { origin: origin.id, refundTo: refundTo.trim() });
      setStatus(undefined);
      setSwap(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    save(swapKey, undefined);
    setSwap(undefined);
    setStatus(undefined);
  };

  if (!swap) {
    return (
      <div className="xchain">
        <h3>Pay from another chain</h3>
        <p className="small">
          NEAR Intents swaps USDC from another chain into {usdc(amount)} on NEAR, delivered to your own account <code>{accountId}</code>. Then you press Pay as usual.
        </p>
        {!registered ? (
          <p className="err">Your account isn't registered with USDC on NEAR yet, so the swap couldn't deliver to it. Join the circle first.</p>
        ) : (
          <>
            <label>
              Pay with USDC on
              <select value={originId} onChange={(e) => setOriginId(e.target.value)}>
                {ORIGINS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Your address on {origin.label} (refunds go here)
              <input value={refundTo} onChange={(e) => setRefundTo(e.target.value)} placeholder={origin.addressHint} spellCheck={false} autoComplete="off" />
            </label>
            <p className="small muted">
              You'll also need a little {origin.gasCoin} on {origin.label} for the transfer fee. NEAR Intents' fee is included in the amount it shows you.
            </p>
            <div className="row">
              <button className="btn" disabled={busy || !origin.isAddress(refundTo.trim())} onClick={() => void start()}>
                {busy ? "Asking NEAR Intents…" : "Get deposit address"}
              </button>
              <button className="btn secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </>
        )}
        {error && <p className="err">{error}</p>}
      </div>
    );
  }

  const o = ORIGINS.find((x) => x.id === swap.origin) ?? origin;
  const deadline = Date.parse(swap.quote.deadline);
  const st = status?.status;
  const expired = (!st || st === "PENDING_DEPOSIT") && now > deadline;
  const done = st && isFinal(st);
  const links = [...(status?.swapDetails?.originChainTxHashes ?? []).map((t) => ({ ...t, label: `${o.label} transaction` })), ...(status?.swapDetails?.destinationChainTxHashes ?? []).map((t) => ({ ...t, label: "NEAR transaction" }))];
  return (
    <div className="xchain" aria-live="polite">
      <h3>Pay from {o.label}</h3>
      {!done && !expired && (
        <>
          <p>
            Send exactly <b className="num">{swap.quote.amountInFormatted} USDC</b> on <b>{o.label}</b> to:
          </p>
          <p className="deposit">
            <code>{swap.quote.depositAddress}</code> <Copy text={swap.quote.depositAddress} label="Copy address" />
          </p>
          <p className="small">
            You'll receive <b>{swap.quote.amountOutFormatted} USDC</b> on NEAR. The amount includes a 1% safety margin; whatever isn't needed is refunded to <code>{swap.refundTo}</code>. Send it within{" "}
            {span(Math.max(0, deadline - now))}. It usually takes about {swap.quote.timeEstimate} seconds after your deposit confirms.
          </p>
        </>
      )}
      <p className={st === "SUCCESS" ? "ok" : st === "REFUNDED" || st === "FAILED" || st === "INCOMPLETE_DEPOSIT" ? "err" : ""}>
        <b>Status:</b> {expired ? "This deposit address has expired. Don't send to it." : st ? STATUS_TEXT[st] : "Checking…"}
        {st === "REFUNDED" && status?.swapDetails?.refundedAmountFormatted ? ` Refunded: ${status.swapDetails.refundedAmountFormatted} USDC.` : ""}
      </p>
      {links.length > 0 && (
        <p className="small">
          {links.map((l) => (
            <a key={l.hash} href={l.explorerUrl} target="_blank" rel="noreferrer" style={{ marginRight: 12 }}>
              {l.label} ↗
            </a>
          ))}
        </p>
      )}
      {(done || expired) && (
        <button className="btn small secondary" onClick={reset}>
          {st === "SUCCESS" ? "Hide" : "Start again"}
        </button>
      )}
    </div>
  );
}
