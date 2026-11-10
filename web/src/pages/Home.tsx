import { useState, type FormEvent } from "react";
import { AccountLink, Card, ErrorNote, ExplorerLink, Loading, TestWallet } from "../components/ui";
import { isLive, repoFile } from "../config";
import { list, short, usdc } from "../lib/format";
import { useNet } from "../lib/net";
import { Link, navigate } from "../lib/router";
import { useData } from "../lib/useData";
import { useChain } from "../near/chain";

export function Home() {
  const { net, cfg, to } = useNet();
  return (
    <>
      <div className="hero-grid">
        <section className="hero">
          <CircleArt />
          <p className="eyebrow">Savings circles on NEAR</p>
          <h1>Your savings circle has an AI treasurer, and even the AI can't steal the money.</h1>
          <p className="lede">
            Rota runs a rotating savings circle (a susu, tanda, chama or hui) on NEAR. Everyone pays the same amount each round, and one member
            takes home the whole pot. A smart contract holds the money. The AI treasurer can only pay a round out, and only to whoever's turn it is.
          </p>
          <div className="actions hero-actions">
            {net === "testnet" ? (
              <>
                <Link className="btn" to={to("/start")}>
                  Try it free
                </Link>
                <a className="btn secondary" href="#demo">
                  See a finished circle
                </a>
              </>
            ) : (
              <>
                <Link className="btn" to={to("/start")}>
                  Get started
                </Link>
                <Link className="btn secondary" to="/testnet">
                  Try it free on testnet
                </Link>
              </>
            )}
          </div>
          {isLive(cfg) && <OpenCircle />}
        </section>
        <Proof />
      </div>
      <div className="grid-2">
        {net === "testnet" ? <DemoCircle /> : <MainnetSoon />}
        <div className="stack">
          <HowItWorks />
          <TestWallet />
        </div>
      </div>
    </>
  );
}

function OpenCircle() {
  const { to } = useNet();
  const [id, setId] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (/^\d+$/.test(id.trim())) navigate(to(`/c/${id.trim()}`));
  };
  return (
    <form className="open" onSubmit={submit}>
      <label htmlFor="circle-id">Have a circle number?</label>
      <div className="row">
        <input id="circle-id" inputMode="numeric" placeholder="e.g. 5" value={id} onChange={(e) => setId(e.target.value)} />
        <button className="btn secondary" type="submit">
          Open
        </button>
      </div>
    </form>
  );
}

/** Members around a circle; the highlighted one receives this round's pot. */
function CircleArt() {
  const n = 8;
  return (
    <svg className="art" viewBox="0 0 200 200" role="img" aria-label="Eight members in a circle passing the pot to one of them">
      <circle cx="100" cy="100" r="70" className="art-ring" />
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * 2 * Math.PI - Math.PI / 2;
        return <circle key={i} cx={100 + 70 * Math.cos(a)} cy={100 + 70 * Math.sin(a)} r={i === 0 ? 15 : 11} className={i === 0 ? "art-me" : "art-member"} />;
      })}
      <circle cx="100" cy="100" r="26" className="art-pot" />
      <text x="100" y="107" textAnchor="middle" className="art-pot-text">
        pot
      </text>
      <path d="M100 74 L100 52" className="art-arrow" />
    </svg>
  );
}

type Check = { ok: boolean; text: string; detail: string };

function Proof() {
  const { net, cfg } = useNet();
  const chain = useChain();
  const live = isLive(cfg);
  const { data, error } = useData(async (): Promise<Check[] | undefined> => {
    if (!isLive(cfg)) return undefined;
    const [circleKeys, liveHash, treasurerKeys] = await Promise.all([chain.accessKeys(cfg.contractId), chain.codeHash(cfg.contractId), chain.accessKeys(cfg.treasurerId)]);
    const t = treasurerKeys[0]?.permission;
    const settleOnly = treasurerKeys.length === 1 && t !== "FullAccess" && t?.receiver === cfg.contractId && t.methods.length === 1 && t.methods[0] === "settle";
    return [
      {
        ok: circleKeys.length === 0,
        text: circleKeys.length === 0 ? "Nobody holds a key to the circle contract, so its code can never be changed." : `The circle contract still has ${circleKeys.length} key(s).`,
        detail: `${cfg.contractId}: ${circleKeys.length} access keys`,
      },
      {
        ok: liveHash === cfg.wasm.codeHash,
        text: liveHash === cfg.wasm.codeHash ? "The code it runs is exactly the code published in our repository." : "The code on chain differs from the published code.",
        detail: `on chain: ${liveHash}\nexpected: ${cfg.wasm.codeHash} (SHA-256 of ${cfg.wasm.path}, ${cfg.wasm.bytes.toLocaleString()} bytes)`,
      },
      {
        ok: settleOnly,
        text: settleOnly ? "The AI treasurer holds exactly one key, and NEAR only accepts it for paying out a round." : "The treasurer's keys don't match the settle-only setup.",
        detail: treasurerKeys
          .map((k) =>
            k.permission === "FullAccess"
              ? `${k.publicKey}: full access`
              : `${k.publicKey}: can only call [${k.permission.methods.join(", ")}] on ${k.permission.receiver}, allowance ${k.permission.allowance ?? "unlimited"}`,
          )
          .join("\n"),
      },
    ];
  }, [net]);

  return (
    <Card title="Don't trust us: check the chain" className="proof">
      {!live ? (
        <>
          <p className="muted">
            These checks will run live against the mainnet contract once it's deployed. Until then there's nothing on mainnet to check, and we don't
            show placeholders.
          </p>
          <p>
            The same three checks already run on testnet: <Link to="/testnet">see them on the testnet page</Link>.
          </p>
        </>
      ) : (
        <>
          <p className="muted">Read live from NEAR {net} just now. No wallet needed.</p>
          {error && <ErrorNote error={error} />}
          {!data && !error && <Loading what="the checks" />}
          {data && (
            <ul className="checks">
              {data.map((c) => (
                <li key={c.detail}>
                  <span className={`mark ${c.ok ? "yes" : "no"}`} aria-label={c.ok ? "Passed" : "Failed"}>
                    {c.ok ? "✓" : "✕"}
                  </span>
                  <div>
                    <p>{c.text}</p>
                    <details>
                      <summary>Details</summary>
                      <pre>{c.detail}</pre>
                    </details>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="small">
            Accounts: <AccountLink id={cfg.contractId!}>circle contract</AccountLink> · <AccountLink id={cfg.treasurerId!}>AI treasurer</AccountLink> ·{" "}
            <a href={repoFile(cfg.wasm.path)} target="_blank" rel="noreferrer">
              published code
            </a>
          </p>
        </>
      )}
    </Card>
  );
}

function DemoCircle() {
  const { cfg, to } = useNet();
  const chain = useChain();
  const demo = cfg.demo!;
  const id = demo.circleId;
  const { data: c, error } = useData(() => chain.getCircle(id), [id]);
  const payout = (round: number) => demo.payouts.find((p) => p.round === round)?.hash;
  return (
    <Card title={`A finished circle: circle ${id}`} className="demo" id="demo">
      <p className="muted">
        Four test members, 10 test USDC each per round, a new round every 2 minutes. The AI treasurer, running as a Telegram bot, paid out every round.
      </p>
      {error && <ErrorNote error={error} />}
      {!c && !error && <Loading what={`circle ${id}`} />}
      {c && (
        <ol className="rounds">
          {c.history.map((r) => (
            <li key={r.round}>
              <p>
                <b>Round {r.round + 1}:</b> {short(r.recipient)} received <span className="num">{usdc(r.amount)}</span>.
              </p>
              {r.missed.length > 0 && (
                <p className="note">
                  {list(r.missed.map(short))} didn't pay. {usdc(r.slashed)} was taken from their deposit, so {short(r.recipient)} still got the full pot
                  {c.order.indexOf(r.missed[0]) < r.round ? `, and it counts as a default for ${short(r.missed[0])}` : ""}.
                </p>
              )}
              {payout(r.round) && <ExplorerLink hash={payout(r.round)!}>Payout transaction</ExplorerLink>}
            </li>
          ))}
        </ol>
      )}
      <p className="small">
        During round 2 the treasurer was asked to pay the pot to a thief instead. <ExplorerLink hash={demo.redteam.hash}>The contract refused</ExplorerLink>.
      </p>
      <div className="actions">
        <Link className="btn secondary" to={to(`/c/${id}`)}>
          Open circle {id}
        </Link>
        <a className="btn secondary" href={repoFile("docs/demo/telegram-transcript.md")} target="_blank" rel="noreferrer">
          Read the Telegram chat
        </a>
      </div>
    </Card>
  );
}

function MainnetSoon() {
  const { to } = useNet();
  return (
    <Card title="Mainnet is launching soon" className="demo soon">
      <p>
        Rota's contract runs on NEAR testnet today, locked and verifiable. The mainnet contract, with real USDC, comes next. When it's live, this page
        shows the same live checks against it.
      </p>
      <p>To be ready on day one:</p>
      <ol className="steps">
        <li>Create a NEAR wallet.</li>
        <li>Add a little NEAR for fees (about 0.2 NEAR).</li>
        <li>Get USDC on NEAR for your payments.</li>
      </ol>
      <div className="actions">
        <Link className="btn" to={to("/start")}>
          Read the step-by-step guide
        </Link>
        <Link className="btn secondary" to="/testnet">
          Try a free test circle now
        </Link>
      </div>
    </Card>
  );
}

function HowItWorks() {
  const { cfg } = useNet();
  return (
    <Card title="How it works" className="how" id="how">
      <ol className="steps">
        <li>
          <b>Start a circle.</b> Choose the members, the amount per round and how long each round lasts. Everyone joins with their own NEAR wallet.
        </li>
        <li>
          <b>Pay each round.</b> Each member pays the same amount. One member receives the whole pot each round, in a fixed order.
        </li>
        <li>
          <b>The AI treasurer pays out.</b> In Telegram (@{cfg.botUsername}) it reminds people and pays out each round as soon as the rules allow. Its key
          can't do anything else, and the contract decides who gets paid.
        </li>
        <li>
          <b>Missed payments are covered.</b> Members can post a deposit for an early turn. If they miss a payment, it goes into the pot and onto their
          payment record.
        </li>
      </ol>
    </Card>
  );
}
