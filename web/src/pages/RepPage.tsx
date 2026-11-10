import { useState, type FormEvent } from "react";
import { AccountLink, Card, ErrorNote, LaunchingSoon, Loading } from "../components/ui";
import { isLive } from "../config";
import { short } from "../lib/format";
import { useNet } from "../lib/net";
import { Link, navigate } from "../lib/router";
import { useData } from "../lib/useData";
import { useChain } from "../near/chain";
import { useWallet } from "../near/wallet";

const STATUS = { Forming: "waiting to start", Active: "running", Completed: "finished", Dissolved: "closed by vote" } as const;

/** A member's payment record across all circles on this network's contract. */
export function RepPage({ account }: { account?: string }) {
  const { cfg } = useNet();
  if (!isLive(cfg)) return <LaunchingSoon />;
  return account ? <Record account={account} /> : <Lookup />;
}

function Lookup() {
  const { cfg, to } = useNet();
  const wallet = useWallet();
  const [id, setId] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (id.trim()) navigate(to(`/rep/${id.trim().toLowerCase()}`));
  };
  return (
    <Card title="Payment records" className="narrow">
      <p>
        Every payment into a circle is recorded on chain: on time, late or missed. Before you invite someone to a circle, you can look up how they've
        paid in other circles.
      </p>
      <form className="open" onSubmit={submit}>
        <label htmlFor="rep-account">NEAR account</label>
        <div className="row">
          <input id="rep-account" placeholder={`e.g. amara${cfg.accountSuffix}`} value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="off" spellCheck={false} />
          <button className="btn secondary" type="submit">
            Look up
          </button>
        </div>
      </form>
      {wallet.accountId && (
        <p>
          <Link to={to(`/rep/${wallet.accountId}`)}>See your own record ({short(wallet.accountId)})</Link>
        </p>
      )}
    </Card>
  );
}

function Record({ account }: { account: string }) {
  const { net, to } = useNet();
  const chain = useChain();
  const { data, error } = useData(async () => {
    const [rep, ids] = await Promise.all([chain.getReputation(account), chain.listCirclesFor(account)]);
    const circles = await Promise.all(ids.map((id) => chain.getCircle(id)));
    return { rep, circles: circles.filter((c) => c !== null) };
  }, [account, net]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading what={`${short(account)}'s record`} />;
  const { rep, circles } = data;
  const stats: [string, number, string][] = [
    ["Paid on time", rep.on_time_contributions, "good"],
    ["Paid late", rep.late_contributions, "warn"],
    ["Missed", rep.missed_contributions, "bad"],
    ["Defaults", rep.defaults, "bad"],
    ["Circles finished without a miss", rep.circles_completed, "good"],
  ];
  return (
    <div className="dash">
      <div className="dash-main">
        <Card className="rep-head">
          <p className="eyebrow">Payment record · {net}</p>
          <h1>{short(account)}</h1>
          <p className="small">
            <AccountLink id={account} />
          </p>
          <dl className="stats">
            {stats.map(([label, n, tone]) => (
              <div key={label} className={n > 0 ? tone : ""}>
                <dt>{label}</dt>
                <dd className="num">{n}</dd>
              </div>
            ))}
          </dl>
          <p className="small muted">
            A default is a missed payment after the member already received the pot. This is a record of what happened, not a score.
          </p>
        </Card>
      </div>
      <aside className="dash-side">
        <Card title={`Circles (${circles.length})`}>
          {circles.length === 0 ? (
            <p className="muted">No circles yet.</p>
          ) : (
            <ul className="people">
              {circles.map((c) => (
                <li key={c.id}>
                  <Link to={to(`/c/${c.id}`)}>
                    {c.name} <span className="muted">#{c.id}</span>
                  </Link>
                  <span className="small muted">{STATUS[c.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>
    </div>
  );
}
