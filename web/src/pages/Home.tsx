import { useState, type FormEvent } from "react";
import { Card, ErrorNote, ExplorerLink, Loading } from "../components/ui";
import { accountUrl, config, repoFile } from "../config";
import { list, short, usdc } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useData } from "../lib/useData";
import { accessKeys, codeHash, getCircle } from "../near/chain";

export function Home() {
  return (
    <>
      <section className="hero">
        <h1>Your savings circle has an AI treasurer, and even the AI can't steal the money.</h1>
        <p>
          Rota runs a rotating savings circle (a susu, tanda, chama or hui) on NEAR. Everyone pays the same amount each round, and one member
          takes home the whole pot. A smart contract holds the money. The AI treasurer can only pay a round out, and only to whoever's turn it is.
        </p>
        <div className="actions">
          <a className="btn" href="#demo">
            See a finished circle
          </a>
          <Link className="btn secondary" to="/new">
            Start a circle
          </Link>
        </div>
        <OpenCircle />
      </section>
      <Proof />
      <DemoCircle />
      <HowItWorks />
    </>
  );
}

function OpenCircle() {
  const [id, setId] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (/^\d+$/.test(id.trim())) navigate(`/c/${id.trim()}`);
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

type Check = { ok: boolean; text: string; detail: string };

function Proof() {
  const { data, error } = useData(async (): Promise<Check[]> => {
    const [circleKeys, liveHash, treasurerKeys] = await Promise.all([accessKeys(config.contractId), codeHash(config.contractId), accessKeys(config.treasurerId)]);
    const t = treasurerKeys[0]?.permission;
    const settleOnly =
      treasurerKeys.length === 1 && t !== "FullAccess" && t?.receiver === config.contractId && t.methods.length === 1 && t.methods[0] === "settle";
    return [
      {
        ok: circleKeys.length === 0,
        text: circleKeys.length === 0 ? "Nobody holds a key to the circle contract, so its code can never be changed." : `The circle contract still has ${circleKeys.length} key(s).`,
        detail: `${config.contractId}: ${circleKeys.length} access keys`,
      },
      {
        ok: liveHash === config.wasm.codeHash,
        text: liveHash === config.wasm.codeHash ? "The code it runs is exactly the code published in our repository." : "The code on chain differs from the published code.",
        detail: `on chain: ${liveHash}\nexpected: ${config.wasm.codeHash} (SHA-256 of ${config.wasm.path}, ${config.wasm.bytes.toLocaleString()} bytes)`,
      },
      {
        ok: settleOnly,
        text: settleOnly
          ? "The AI treasurer holds exactly one key, and NEAR only accepts it for paying out a round."
          : "The treasurer's keys don't match the settle-only setup.",
        detail: treasurerKeys
          .map((k) =>
            k.permission === "FullAccess"
              ? `${k.publicKey}: full access`
              : `${k.publicKey}: can only call [${k.permission.methods.join(", ")}] on ${k.permission.receiver}, allowance ${k.permission.allowance ?? "unlimited"}`,
          )
          .join("\n"),
      },
    ];
  }, []);

  return (
    <Card title="Don't trust us: check the chain" className="proof">
      <p className="muted">Read live from NEAR just now. No wallet needed.</p>
      {error && <ErrorNote error={error} />}
      {!data && !error && <Loading what="the checks" />}
      {data && (
        <ul className="checks">
          {data.map((c) => (
            <li key={c.detail}>
              <span className="mark">{c.ok ? "✅" : "❌"}</span>
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
        Accounts: <a href={accountUrl(config.contractId)} target="_blank" rel="noreferrer">circle contract</a> ·{" "}
        <a href={accountUrl(config.treasurerId)} target="_blank" rel="noreferrer">AI treasurer</a> ·{" "}
        <a href={repoFile(config.wasm.path)} target="_blank" rel="noreferrer">published code</a>
      </p>
    </Card>
  );
}

function DemoCircle() {
  const id = config.demo.circleId;
  const { data: c, error } = useData(() => getCircle(id), [id]);
  const payout = (round: number) => config.demo.payouts.find((p) => p.round === round)?.hash;
  return (
    <Card title={`A finished circle: circle ${id}`} className="demo">
      <span id="demo" className="anchor" />
      <p className="muted">
        Four test members, 10 USDC each per round, a new round every 2 minutes. The AI treasurer, running as a Telegram bot, paid out every round.
      </p>
      {error && <ErrorNote error={error} />}
      {!c && !error && <Loading what={`circle ${id}`} />}
      {c && (
        <ol className="rounds">
          {c.history.map((r) => (
            <li key={r.round}>
              <p>
                <b>Round {r.round + 1}:</b> {short(r.recipient)} received <b>{usdc(r.amount)}</b>.
              </p>
              {r.missed.length > 0 && (
                <p className="note">
                  ❗ {list(r.missed.map(short))} didn't pay. {usdc(r.slashed)} was taken from their deposit, so {short(r.recipient)} still got the full
                  pot{c.order.indexOf(r.missed[0]) < r.round ? `, and it counts as a default for ${short(r.missed[0])}` : ""}.
                </p>
              )}
              {payout(r.round) && <ExplorerLink hash={payout(r.round)!}>Payout transaction</ExplorerLink>}
            </li>
          ))}
        </ol>
      )}
      <p className="small">
        During round 2 the treasurer was asked to pay the pot to a thief instead.{" "}
        <ExplorerLink hash={config.demo.redteam.hash}>The contract refused</ExplorerLink>.
      </p>
      <div className="actions">
        <Link className="btn secondary" to={`/c/${id}`}>
          Open circle {id}
        </Link>
        <a className="btn secondary" href={repoFile("docs/demo/telegram-transcript.md")} target="_blank" rel="noreferrer">
          Read the Telegram chat
        </a>
      </div>
    </Card>
  );
}

function HowItWorks() {
  return (
    <Card title="How it works">
      <ol className="steps">
        <li>
          <b>Start a circle.</b> Choose the members, the amount per round and how long each round lasts. Everyone joins with their own NEAR wallet.
        </li>
        <li>
          <b>Pay each round.</b> Each member pays the same amount. One member receives the whole pot each round, in a fixed order.
        </li>
        <li>
          <b>The AI treasurer pays out.</b> In Telegram (@{config.botUsername}) it reminds people and pays out each round as soon as the rules
          allow. Its key can't do anything else, and the contract decides who gets paid.
        </li>
        <li>
          <b>Missed payments are covered.</b> Members can post a deposit for an early turn. If they miss a payment, it goes into the pot and onto their
          record.
        </li>
      </ol>
    </Card>
  );
}
