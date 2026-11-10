import { useState } from "react";
import { CrossChainPay } from "../components/CrossChain";
import { Card, ErrorNote, ExplorerLink, LaunchingSoon, Loading, TestWallet, TxButton } from "../components/ui";
import { isLive } from "../config";
import { every, list, short, span, usdc, when } from "../lib/format";
import { useNet } from "../lib/net";
import { Link } from "../lib/router";
import { txs, type Circle, type RoundStatus } from "../lib/rota";
import { useData, useNow } from "../lib/useData";
import { useChain } from "../near/chain";
import { useWallet } from "../near/wallet";

/** This network's transaction builders. */
const useTx = () => txs(useNet().cfg);

const STATUS: Record<Circle["status"], string> = {
  Forming: "Waiting to start",
  Active: "Running",
  Completed: "Finished",
  Dissolved: "Closed by a members' vote",
};

export function CirclePage({ id }: { id: string }) {
  const { cfg } = useNet();
  if (!isLive(cfg)) return <LaunchingSoon />;
  return <LiveCircle id={id} />;
}

function LiveCircle({ id }: { id: string }) {
  const { net, cfg } = useNet();
  const chain = useChain();
  const { data, error, reload } = useData(
    async () => {
      const c = await chain.getCircle(id);
      const s = c?.status === "Active" ? await chain.getRoundStatus(id) : undefined;
      return { c, s, fetchedAt: Date.now() };
    },
    [id, net],
    5000,
  );
  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Loading what={`circle ${id}`} />;
  const { c, s } = data;
  if (!c) return <Card title="Circle not found">There's no circle {id} on {cfg.contractId}.</Card>;
  const offset = s ? s.now_ms - data.fetchedAt : 0;

  return (
    <>
      <Card className="circle-head">
        <p className="eyebrow">
          Circle {c.id} · {net}
        </p>
        <h1>{c.name}</h1>
        <span className={`chip ${c.status.toLowerCase()}`}>{STATUS[c.status]}</span>
        <ul className="facts">
          <li>
            <b>{c.members.length}</b> members
          </li>
          <li>
            <b>{usdc(c.contribution)}</b> each per round
          </li>
          <li>
            A new round every <b>{every(c.round_duration_sec)}</b>
          </li>
          <li>
            Pot each round: <b>{usdc(BigInt(c.contribution) * BigInt(c.members.length))}</b>
          </li>
        </ul>
        {((cfg.testRuns as string[]).includes(c.id) || c.name.startsWith("E2E ")) && (
          <p className="note small testrun">This circle was created by an automated browser test of the web app. It's kept as a test record.</p>
        )}
      </Card>
      <div className="dash">
        <div className="dash-main">
          {c.status === "Forming" && <Forming c={c} reload={reload} />}
          {c.status === "Active" && s && <ThisRound c={c} s={s} offset={offset} reload={reload} />}
          {c.status === "Active" && <Swaps c={c} reload={reload} />}
          <History c={c} />
        </div>
        <aside className="dash-side">
          <Order c={c} />
          <More c={c} reload={reload} />
          <TestWallet onChange={reload} />
        </aside>
      </div>
    </>
  );
}

const member = (c: Circle, accountId?: string) => c.members.find((m) => m.account_id === accountId);

function Forming({ c, reload }: { c: Circle; reload: () => void }) {
  const { accountId } = useWallet();
  const tx = useTx();
  const me = member(c, accountId);
  const bond = BigInt(c.early_slot_bond);
  const joined = c.members.filter((m) => m.joined).length;
  const everyoneIn = joined === c.members.length;
  const canStart = everyoneIn && (accountId === c.creator || Boolean(me));
  return (
    <Card title="Waiting to start">
      <p>
        {joined} of {c.members.length} members have joined.{" "}
        {everyoneIn ? "Everyone is in, so the circle can start." : "The circle starts once everyone has joined."}
      </p>
      <ul className="people">
        {c.members.map((m) => (
          <li key={m.account_id}>
            {m.joined ? "✓" : "…"} {short(m.account_id)}{m.joined ? "" : " (not joined yet)"}
            {bond > 0n && BigInt(m.bond) >= bond && <span className="tag">deposit posted</span>}
          </li>
        ))}
      </ul>
      {bond > 0n && (
        <p className="small">
          Members who post a {usdc(bond)} deposit, or who have finished a circle before without missing a payment, get the early turns. The deposit
          comes back at the end, minus anything used to cover a missed payment.
        </p>
      )}
      {accountId && !me && <p className="muted">You ({short(accountId)}) aren't invited to this circle.</p>}
      <div className="actions">
        {me && !me.joined && (
          <TxButton tx={tx.join(c.id)} onDone={reload}>
            Join the circle
          </TxButton>
        )}
        {me?.joined && bond > 0n && BigInt(me.bond) < bond && (
          <TxButton tx={tx.pay(c.id, "bond", bond.toString())} onDone={reload} secondary>
            Post a {usdc(bond)} deposit for an early turn
          </TxButton>
        )}
        {canStart && (
          <TxButton tx={tx.start(c.id)} onDone={reload}>
            Start the circle
          </TxButton>
        )}
        {!accountId && <TxButton tx={tx.join(c.id)}>Join</TxButton>}
      </div>
    </Card>
  );
}

function ThisRound({ c, s, offset, reload }: { c: Circle; s: RoundStatus; offset: number; reload: () => void }) {
  const now = useNow() + offset;
  const { accountId } = useWallet();
  const tx = useTx();
  const me = member(c, accountId);
  const total = s.paid.length + s.unpaid.length;
  const due =
    now <= s.deadline_ms
      ? `Due in ${span(s.deadline_ms - now)}`
      : now <= s.grace_ends_ms
        ? `The deadline has passed. Grace period ends in ${span(s.grace_ends_ms - now)}.`
        : "The deadline and grace period have passed.";
  return (
    <Card title={`Round ${s.round + 1} of ${s.rounds_total}`} className="round">
      <p className="big">
        The pot goes to <b>{short(s.recipient ?? "")}</b>
      </p>
      <p>{due}</p>
      <div className="progress" aria-label={`${s.paid.length} of ${total} paid`}>
        <span style={{ width: `${(100 * s.paid.length) / total}%` }} />
      </div>
      <p>
        <b>Paid ({s.paid.length} of {total}):</b> {list(s.paid.map(short)) || "nobody yet"}
      </p>
      {s.unpaid.length > 0 && (
        <p>
          <b>Still to pay:</b> {list(s.unpaid.map(short))}
        </p>
      )}
      <p>
        Collected so far: <span className="num">{usdc(s.collected)}</span>
      </p>
      {me && !s.paid.includes(me.account_id) && <PayBox c={c} reload={reload} />}
      {me && s.paid.includes(me.account_id) && <p className="ok">✓ You've paid this round.</p>}
      {s.can_settle ? (
        <div className="actions">
          <p className="small">The pot can be paid out now. The AI treasurer normally does this, but anyone can.</p>
          <TxButton tx={tx.settle(c.id)} onDone={reload} secondary>
            Pay out round {s.round + 1} now
          </TxButton>
        </div>
      ) : (
        <p className="small muted">The pot is paid out once everyone has paid, or when the grace period ends.</p>
      )}
    </Card>
  );
}

function PayBox({ c, reload }: { c: Circle; reload: () => void }) {
  const { accountId } = useWallet();
  const { net, cfg } = useNet();
  const chain = useChain();
  const tx = useTx();
  const { data, reload: reloadBalance } = useData(
    async () => ({ balance: BigInt(await chain.tokenBalance(accountId!)), registered: await chain.tokenRegistered(accountId!) }),
    [accountId, net],
  );
  const need = BigInt(c.contribution);
  const short_ = data && data.balance < need;
  return (
    <div className="pay">
      <h3>Pay your {usdc(need)}</h3>
      {data && <p className="small">Your balance: {usdc(data.balance)}</p>}
      {short_ && net === "testnet" && (
        <div className="actions">
          <p className="small">You need more test USDC. It's free on testnet.</p>
          <TxButton tx={tx.faucet(accountId!, !data.registered)} onDone={() => void reloadBalance()} secondary>
            Get 100 free test USDC
          </TxButton>
        </div>
      )}
      <div className="actions">
        <TxButton tx={tx.pay(c.id, "contribution", c.contribution)} disabled={short_} onDone={() => (reload(), void reloadBalance())}>
          Pay {usdc(need)} now
        </TxButton>
        {net === "mainnet" && data && short_ && (
          <CrossChainPay
            amount={need - data.balance}
            accountId={accountId!}
            registered={data.registered}
            swapKey={`rota:xchain:${cfg.contractId}:${c.id}:${c.current_round}:${accountId}`}
            onArrived={() => void reloadBalance()}
          />
        )}
        {net === "testnet" && (
          <>
            <button className="btn secondary" disabled aria-describedby="xchain">
              Pay from another chain
            </button>
            <p id="xchain" className="small muted">
              <span className="tag">Mainnet only</span> Paying with USDC from another chain uses NEAR Intents, which only works on mainnet. It isn't available on this test network.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Swaps({ c, reload }: { c: Circle; reload: () => void }) {
  const { accountId } = useWallet();
  const tx = useTx();
  const [other, setOther] = useState("");
  const myTurn = accountId ? c.order.indexOf(accountId) : -1;
  const open = c.order.filter((a, i) => i >= c.current_round && a !== accountId);
  const toMe = c.swaps.filter((s) => s.other === accountId);
  const fromMe = c.swaps.filter((s) => s.proposer === accountId);
  if (!accountId || myTurn < 0) return null;
  return (
    <Card title="Swap turns">
      {toMe.map((s) => (
        <div key={s.proposer} className="swap">
          <p>
            🔁 <b>{short(s.proposer)}</b> (turn {c.order.indexOf(s.proposer) + 1}) wants to swap with you (turn {myTurn + 1}).
          </p>
          <TxButton tx={tx.acceptSwap(c.id, s.proposer)} onDone={reload}>
            Accept the swap
          </TxButton>
        </div>
      ))}
      {fromMe.map((s) => (
        <p key={s.other} className="muted">
          You asked {short(s.other)} to swap turns. Waiting for them to accept.
        </p>
      ))}
      {myTurn >= c.current_round && open.length > 0 ? (
        <>
          <p className="small">You can swap your turn ({myTurn + 1}) with a member whose turn hasn't come yet. They have to accept in their own wallet.</p>
          <div className="row">
            <select value={other} onChange={(e) => setOther(e.target.value)} aria-label="Member to swap with">
              <option value="">Choose a member</option>
              {open.map((a) => (
                <option key={a} value={a}>
                  {short(a)} (turn {c.order.indexOf(a) + 1})
                </option>
              ))}
            </select>
          </div>
          {other && (
            <TxButton tx={tx.proposeSwap(c.id, other)} onDone={reload} secondary>
              Ask {short(other)} to swap
            </TxButton>
          )}
        </>
      ) : (
        <p className="small muted">Your turn has already been paid out, so it can't be swapped.</p>
      )}
    </Card>
  );
}

function Order({ c }: { c: Circle }) {
  const { to } = useNet();
  if (!c.order.length) return null;
  return (
    <Card title="Payout order">
      <ol className="order">
        {c.order.map((a, i) => {
          const rec = c.history[i];
          const m = member(c, a);
          return (
            <li key={a} className={i === c.current_round && c.status === "Active" ? "current" : ""}>
              <span>
                <Link to={to(`/rep/${a}`)}>{short(a)}</Link>
              </span>
              <span className="small">
                {rec ? `received ${usdc(rec.amount)}` : i === c.current_round && c.status === "Active" ? "this round" : ""}
                {m && m.missed > 0 ? ` · missed ${m.missed}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function History({ c }: { c: Circle }) {
  const { cfg } = useNet();
  if (!c.history.length) return null;
  const known = cfg.demo && c.id === cfg.demo.circleId ? cfg.demo.payouts : [];
  return (
    <Card title="Paid out">
      <ul className="rounds">
        {c.history.map((r) => {
          const hash = known.find((p) => p.round === r.round)?.hash;
          return (
            <li key={r.round}>
              <p>
                <b>Round {r.round + 1}:</b> {short(r.recipient)} received <b>{usdc(r.amount)}</b>
                {r.payout === "Claimable" ? " (waiting to be claimed)" : ""}.
              </p>
              {r.missed.length > 0 && (
                <p className="note">
                  {list(r.missed.map(short))} didn't pay. {BigInt(r.slashed) > 0n ? `${usdc(r.slashed)} was taken from their deposit and added to the pot.` : "There was no deposit to cover it."}
                </p>
              )}
              <p className="small muted">
                {when(r.settled_at_ms)} · paid out by {r.settled_by === cfg.treasurerId ? "the AI treasurer" : short(r.settled_by)}
                {hash && (
                  <>
                    {" "}
                    · <ExplorerLink hash={hash}>transaction</ExplorerLink>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function More({ c, reload }: { c: Circle; reload: () => void }) {
  const { accountId } = useWallet();
  const tx = useTx();
  const me = member(c, accountId);
  if (!me) return null;
  const claimable = BigInt(me.claimable);
  const canVote = c.status === "Active" || (c.status === "Forming" && me.joined);
  const voted = c.dissolve_votes.includes(me.account_id);
  return (
    <Card title="More">
      {claimable > 0n && (
        <div className="actions">
          <p>A payout to you couldn't be delivered. {usdc(claimable)} is waiting for you.</p>
          <TxButton tx={tx.claim(c.id)} onDone={reload}>
            Claim {usdc(claimable)}
          </TxButton>
        </div>
      )}
      {canVote && (
        <details>
          <summary>Close the circle early</summary>
          <p className="small">
            If every member votes to close the circle, everyone gets back this round's payments and their deposits. It needs all {c.members.length}{" "}
            votes.
          </p>
          <p className="small">
            Votes so far: {c.dissolve_votes.length} of {c.members.length}
            {c.dissolve_votes.length ? ` (${list(c.dissolve_votes.map(short))})` : ""}.
          </p>
          {voted ? (
            <p className="muted">You've voted.</p>
          ) : (
            <TxButton tx={c.dissolve_votes.length ? tx.voteDissolve(c.id) : tx.proposeDissolve(c.id)} onDone={reload} secondary>
              {c.dissolve_votes.length ? "Vote to close the circle" : "Propose closing the circle"}
            </TxButton>
          )}
        </details>
      )}
    </Card>
  );
}
