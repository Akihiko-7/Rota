import { useState, type FormEvent } from "react";
import { AccountLink, Card, ErrorNote, Loading, TxButton } from "../components/ui";
import { repoFile } from "../config";
import { short, when } from "../lib/format";
import { useNet } from "../lib/net";
import { Link, navigate } from "../lib/router";
import { harvestTxs, type HarvestPot, type HarvestStage, type HarvestStatus } from "../lib/rota";
import { useData } from "../lib/useData";
import { useChain } from "../near/chain";
import { useWallet } from "../near/wallet";

const NEAR = 10n ** 24n;

/** NEAR with up to 5 decimals; amounts under 0.00001 NEAR are shown in yoctoNEAR so nothing is rounded to 0. */
export function nearAmount(yocto: bigint): string {
  const sign = yocto < 0n ? "-" : "";
  const v = yocto < 0n ? -yocto : yocto;
  if (v > 0n && v < 10n ** 19n) return `${sign}${v.toString()} yoctoNEAR`;
  const frac = ((v % NEAR) / 10n ** 19n).toString().padStart(5, "0").replace(/0+$/, "");
  return `${sign}${v / NEAR}${frac ? `.${frac}` : ""} NEAR`;
}

function parseNear(text: string): bigint {
  const t = text.trim();
  if (!/^\d+(\.\d{1,24})?$/.test(t)) throw new Error("Enter an amount like 2 or 0.5.");
  const [w, f = ""] = t.split(".");
  return BigInt(w) * NEAR + BigInt(f.padEnd(24, "0"));
}

const STAGES: Record<HarvestStage, string> = {
  Filling: "Filling: deposits are open",
  Staking: "Being staked",
  Staked: "Staked and earning",
  Unstaking: "Being unstaked",
  Unbonding: "Unstaked: waiting for the pool to release it",
  Withdrawing: "Being withdrawn",
  Ripe: "Ripe: ready to share out",
  Distributed: "Shared out",
  Cancelled: "Cancelled: take your deposit back",
};

export function HarvestPage({ id }: { id?: string }) {
  const { cfg, to } = useNet();
  if (!cfg.harvest) {
    return (
      <Card title="Harvest is testnet only for now" className="narrow soon">
        <p>
          Harvest lets a group put NEAR into one pot, stake it with a validator for a fixed term, and share out the deposits plus the rewards. It runs on
          testnet while we test it; it isn't available with real money yet.
        </p>
        <Link className="btn secondary" to="/testnet/harvest">
          See Harvest on testnet
        </Link>
      </Card>
    );
  }
  if (!id) return <HarvestHome />;
  return <Pot id={id} key={`${to("")}-${id}`} />;
}

function HarvestHome() {
  const { cfg, to } = useNet();
  const h = cfg.harvest!;
  const chain = useChain();
  const { data, error } = useData(async () => {
    const n = await chain.harvest.count(h.contractId);
    const ids = Array.from({ length: Math.min(n, 12) }, (_, i) => String(n - 1 - i));
    return Promise.all(ids.map((i) => chain.harvest.pot(h.contractId, i)));
  }, [h.contractId]);
  return (
    <div className="dash">
      <div className="dash-main">
        <Card className="harvest-head">
          <p className="eyebrow">Harvest · testnet</p>
          <h1>Stake together, share the harvest</h1>
          <p className="lede">
            Everyone puts NEAR into one pot. The pot is staked with a validator for a fixed term, then it's unstaked and shared out: each person gets
            their deposit back plus their share of the rewards, in proportion to what they put in.
          </p>
          <ul className="fineprint small">
            <li>Until staking starts you can take your deposit back. After that nobody can, until the pot is ripe.</li>
            <li>The money can only go back to the people who deposited it. No one can choose another recipient, not even our treasurer.</li>
            <li>After the term, NEAR's staking pools hold unstaked funds for 4 epochs before releasing them. That's why a pot ripens after its term.</li>
          </ul>
        </Card>
        <Card title="Pots">
          {error && <ErrorNote error={error} />}
          {!data && !error && <Loading what="pots" />}
          {data && data.length === 0 && <p className="muted">No pots yet.</p>}
          {data && data.length > 0 && (
            <ul className="people">
              {data.filter((p): p is HarvestPot => p !== null).map((p) => (
                <li key={p.id}>
                  <Link to={to(`/harvest/${p.id}`)}>
                    {p.name} <span className="muted">#{p.id}</span>
                  </Link>
                  <span className="small muted">
                    {nearAmount(BigInt(p.total))} · {STAGES[p.stage].split(":")[0]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <aside className="dash-side">
        <NewPot />
      </aside>
    </div>
  );
}

function NewPot() {
  const { cfg, to } = useNet();
  const h = cfg.harvest!;
  const [name, setName] = useState("");
  const [pool, setPool] = useState(h.defaultPool);
  const [fillMin, setFillMin] = useState(60);
  const [term, setTerm] = useState(1);
  const ok = name.trim().length > 0 && pool.trim().length > 0;
  return (
    <Card title="Start a pot">
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Book club stake" maxLength={60} />
      </label>
      <label>
        Validator pool
        <input value={pool} onChange={(e) => setPool(e.target.value.trim())} autoCapitalize="off" spellCheck={false} />
        <span className="small muted">Fixed for the pot's whole life. The default charges a 9% fee on rewards.</span>
      </label>
      <label>
        Deposits stay open for
        <select value={fillMin} onChange={(e) => setFillMin(Number(e.target.value))}>
          {[
            [10, "10 minutes"],
            [60, "1 hour"],
            [24 * 60, "1 day"],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Staked for
        <select value={term} onChange={(e) => setTerm(Number(e.target.value))}>
          {[1, 2, 4, 8].map((e) => (
            <option key={e} value={e}>
              {e} epoch{e === 1 ? "" : "s"} (about {Math.round(e * 7)} hours on testnet)
            </option>
          ))}
        </select>
      </label>
      {ok ? (
        <TxButton
          tx={harvestTxs(h.contractId).create(name.trim(), pool, fillMin * 60, term)}
          onDone={(sent) => {
            if (typeof sent.result === "string") navigate(to(`/harvest/${sent.result}`));
          }}
        >
          Start the pot
        </TxButton>
      ) : (
        <button className="btn" disabled>
          Start the pot
        </button>
      )}
      <p className="small muted">Starting a pot costs 0.05 NEAR for storage.</p>
    </Card>
  );
}

function Pot({ id }: { id: string }) {
  const { cfg } = useNet();
  const h = cfg.harvest!;
  const chain = useChain();
  const { data, error, reload } = useData(
    async () => {
      const pot = await chain.harvest.pot(h.contractId, id);
      if (!pot) return { pot };
      const [status, inPool, epochs, apy] = await Promise.all([
        chain.harvest.status(h.contractId, id),
        chain.harvest.inPool(pot.pool_id, h.contractId).catch(() => undefined),
        chain.epochs().catch(() => undefined),
        chain.poolApy(pot.pool_id).catch(() => undefined),
      ]);
      return { pot, status, inPool, epochs, apy };
    },
    [id],
    10_000,
  );
  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Loading what={`pot ${id}`} />;
  const { pot, status, inPool, epochs, apy } = data;
  if (!pot || !status) return <Card title="Pot not found">There's no Harvest pot {id} on {h.contractId}.</Card>;

  const total = BigInt(pot.total);
  const staking = ["Staked", "Unstaking", "Unbonding", "Withdrawing"].includes(pot.stage);
  const done = pot.stage === "Ripe" || pot.stage === "Distributed";
  const rewards = done ? BigInt(pot.returned) - total : staking && inPool !== undefined ? inPool - total : undefined;
  const ripe = epochs && ripeEstimate(pot, status, epochs);
  const projection = apy && epochs && pot.stage !== "Distributed" ? projectedReward(total, apy.apy, pot.term_epochs, epochs.msPerEpoch) : undefined;

  return (
    <>
      <Card className="harvest-head">
        <p className="eyebrow">Harvest pot {pot.id} · testnet</p>
        <h1>{pot.name}</h1>
        <span className={`chip ${pot.stage.toLowerCase()}`}>{STAGES[pot.stage]}</span>
        <ul className="facts">
          <li>
            Deposited: <b>{nearAmount(total)}</b>
          </li>
          <li>
            Pool: <AccountLink id={pot.pool_id}>{pot.pool_id.split(".")[0]}</AccountLink>
          </li>
          <li>
            Term: <b>{pot.term_epochs}</b> epoch{pot.term_epochs === 1 ? "" : "s"}
          </li>
          <li>{depositorsText(pot)}</li>
        </ul>
      </Card>
      <div className="dash">
        <div className="dash-main">
          <Card title="Rewards" className="proof">
            {rewards !== undefined ? (
              <p className="big">
                {done ? "Earned" : "Earned so far"}: <span className="num">{nearAmount(rewards)}</span>
              </p>
            ) : (
              <p className="muted">Rewards start once the pot is staked.</p>
            )}
            {staking && inPool !== undefined && (
              <p className="small">
                Read from the pool just now: the Harvest contract holds <span className="num">{inPool.toString()}</span> yoctoNEAR there, against{" "}
                <span className="num">{total.toString()}</span> deposited.
              </p>
            )}
            {done && (
              <p className="small">
                The pool returned <span className="num">{BigInt(pot.returned).toString()}</span> yoctoNEAR for <span className="num">{total.toString()}</span>{" "}
                deposited.
              </p>
            )}
            {apy && (
              <p>
                Pool's current APY: <b className="num">{(apy.apy * 100).toFixed(2)}%</b>
                <span className="small muted">
                  {" "}
                  (calculated from NEAR's on-chain reward parameters: {(apy.inflation * 100).toFixed(1)}% yearly inflation, {(apy.validatorShare * 100).toFixed(0)}%
                  of it to validators, total supply ÷ total stake, less this pool's {(apy.fee * 100).toFixed(0)}% fee)
                </span>
              </p>
            )}
            {projection !== undefined && (
              <p className="note small">
                <b>Projection, not a promise:</b> at this APY, {nearAmount(total)} staked for {pot.term_epochs} epoch{pot.term_epochs === 1 ? "" : "s"} would earn about{" "}
                {nearAmount(projection)}. The real figure is whatever the pool pays, shown above.
              </p>
            )}
          </Card>
          <Timeline pot={pot} status={status} ripe={ripe} />
          <Actions pot={pot} status={status} reload={reload} />
        </div>
        <aside className="dash-side">
          <Depositors pot={pot} />
          <Card title="Check it yourself" className="small">
            <p>
              Contract <AccountLink id={h.contractId} /> runs the code in{" "}
              <a href={repoFile(h.wasm.path)} target="_blank" rel="noreferrer">
                {h.wasm.path}
              </a>{" "}
              (code hash <code>{h.wasm.codeHash.slice(0, 10)}…</code>) and has no access keys, so nobody can change it.
            </p>
            <p>
              The bot's Harvest key (<AccountLink id={h.treasurerId}>{short(h.treasurerId)}</AccountLink>) can only call stake, unstake, withdraw and distribute.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}

function depositorsText(pot: HarvestPot): string {
  const n = pot.deposits.length;
  return `${n} depositor${n === 1 ? "" : "s"}`;
}

/** The pool releases funds 4 epochs after unstaking; estimate when that is from current epoch timing. */
function ripeEstimate(pot: HarvestPot, s: HarvestStatus, t: { height: number; startMs: number; msPerEpoch: number }): number | undefined {
  const at = (epoch: number) => t.startMs + (epoch - t.height) * t.msPerEpoch;
  if (s.withdrawable_from_epoch !== null) return at(s.withdrawable_from_epoch);
  if (s.unstake_from_epoch !== null) return at(Math.max(s.unstake_from_epoch, t.height) + 4);
  if (pot.stage === "Filling") return at(t.height + 1 + pot.term_epochs + 4);
  return undefined;
}

function projectedReward(total: bigint, apy: number, termEpochs: number, msPerEpoch: number): bigint {
  const years = (termEpochs * msPerEpoch) / (365 * 86_400_000);
  return BigInt(Math.floor(Number(total / 10n ** 12n) * apy * years)) * 10n ** 12n;
}

function Timeline({ pot, status, ripe }: { pot: HarvestPot; status: HarvestStatus; ripe?: number }) {
  const rows: [string, string, boolean][] = [
    ["Deposits close", when(pot.fill_ends_ms), status.now_ms >= pot.fill_ends_ms],
    ["Staked", pot.staked_at_ms ? `${when(pot.staked_at_ms)} (epoch ${pot.staked_epoch})` : "after deposits close", pot.staked_at_ms !== null],
    [
      "Term ends",
      status.unstake_from_epoch !== null ? `at epoch ${status.unstake_from_epoch} (now ${status.epoch_height})` : `${pot.term_epochs} epoch(s) after staking`,
      pot.unstaked_at_ms !== null,
    ],
    ["Unstaked", pot.unstaked_at_ms ? `${when(pot.unstaked_at_ms)} (epoch ${pot.unstaked_epoch})` : "when the term ends", pot.unstaked_at_ms !== null],
    [
      "Ripe",
      pot.stage === "Ripe" || pot.stage === "Distributed"
        ? "yes"
        : ripe
          ? `around ${when(ripe)}${status.withdrawable_from_epoch !== null ? ` (epoch ${status.withdrawable_from_epoch})` : ""}: estimated from current epoch timing`
          : "4 epochs after unstaking",
      pot.stage === "Ripe" || pot.stage === "Distributed",
    ],
    ["Shared out", pot.distributed_at_ms ? when(pot.distributed_at_ms) : "as soon as it's ripe", pot.stage === "Distributed"],
  ];
  return (
    <Card title="Timeline">
      <ol className="timeline">
        {rows.map(([label, text, done]) => (
          <li key={label} className={done ? "done" : ""}>
            <b>{label}</b>
            <span className="small">{text}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Depositors({ pot }: { pot: HarvestPot }) {
  const total = BigInt(pot.total);
  return (
    <Card title={`Depositors (${pot.deposits.length})`}>
      {pot.deposits.length === 0 ? (
        <p className="muted">No deposits yet.</p>
      ) : (
        <ul className="people">
          {pot.deposits.map((d) => {
            const payout = pot.payouts.find((p) => p.account_id === d.account_id);
            const share = total > 0n ? Number((BigInt(d.amount) * 10_000n) / total) / 100 : 0;
            return (
              <li key={d.account_id}>
                <span>
                  {short(d.account_id)} <span className="small muted">{share.toFixed(2)}%</span>
                </span>
                <span className="small num">
                  {nearAmount(BigInt(d.amount))}
                  {payout && ` → ${nearAmount(BigInt(payout.amount))}${payout.status === "Claimable" ? " (claimable)" : ""}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Actions({ pot, status, reload }: { pot: HarvestPot; status: HarvestStatus; reload: () => void }) {
  const { cfg } = useNet();
  const tx = harvestTxs(cfg.harvest!.contractId);
  const { accountId } = useWallet();
  const [amount, setAmount] = useState("1");
  const mine = pot.deposits.find((d) => d.account_id === accountId);
  const claimable = pot.payouts.find((p) => p.account_id === accountId && p.status === "Claimable");
  let deposit: bigint | undefined;
  try {
    deposit = parseNear(amount);
  } catch {
    deposit = undefined;
  }
  const open = pot.stage === "Filling" && status.now_ms < pot.fill_ends_ms;
  const next = status.can_stake ? "stake" : status.can_unstake ? "unstake" : pot.stage === "Unbonding" ? "withdraw" : status.can_distribute ? "distribute" : undefined;
  return (
    <Card title="Take part">
      {open && (
        <form className="open" onSubmit={(e: FormEvent) => e.preventDefault()}>
          <label htmlFor="deposit">Deposit (test NEAR, at least 0.1)</label>
          <div className="row">
            <input id="deposit" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <TxButton tx={tx.deposit(pot.id, deposit ?? 0n)} disabled={!deposit || deposit < NEAR / 10n} onDone={reload}>
            Deposit {deposit ? nearAmount(deposit) : ""}
          </TxButton>
        </form>
      )}
      {mine && (pot.stage === "Filling" || pot.stage === "Cancelled") && (
        <div className="actions">
          <p className="small">You've put in {nearAmount(BigInt(mine.amount))}. You can take it back until staking starts.</p>
          <TxButton tx={tx.cancel(pot.id)} onDone={reload} secondary>
            Take my deposit back
          </TxButton>
        </div>
      )}
      {claimable && (
        <TxButton tx={tx.claim(pot.id)} onDone={reload}>
          Claim {nearAmount(BigInt(claimable.amount))}
        </TxButton>
      )}
      {!open && !mine && !claimable && <p className="muted">Deposits are closed for this pot.</p>}
      {next && (
        <div className="actions">
          <p className="small muted">
            The next step is open to anyone (the treasurer bot normally does it). It only moves the pot forward; the money can only go back to the depositors.
          </p>
          <TxButton tx={tx.step(pot.id, next)} onDone={reload} secondary>
            {{ stake: "Stake the pot now", unstake: "Unstake the pot now", withdraw: "Try to withdraw from the pool", distribute: "Share out the pot now" }[next]}
          </TxButton>
        </div>
      )}
    </Card>
  );
}
