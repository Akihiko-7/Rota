import { useMemo, useState } from "react";
import { Card, TxButton } from "../components/ui";
import { every, parseUsdc, usdc } from "../lib/format";
import { navigate } from "../lib/router";
import { tx, validate, type NewCircle as Draft } from "../lib/rota";
import { useWallet } from "../near/wallet";

const ROUNDS: [number, string][] = [
  [120, "2 minutes (for a quick test)"],
  [3600, "1 hour"],
  [86400, "1 day"],
  [7 * 86400, "1 week"],
  [14 * 86400, "2 weeks"],
  [30 * 86400, "30 days"],
];
const GRACE: [number, string][] = [
  [30, "30 seconds"],
  [3600, "1 hour"],
  [86400, "1 day"],
  [3 * 86400, "3 days"],
];

export function NewCircle() {
  const { accountId } = useWallet();
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  const [amount, setAmount] = useState("10");
  const [roundSec, setRoundSec] = useState(120);
  const [graceSec, setGraceSec] = useState(30);
  const [bond, setBond] = useState("0");

  const memberList = useMemo(() => {
    const typed = members.split(/[\s,]+/).map((m) => m.trim().toLowerCase()).filter(Boolean);
    return accountId && !typed.includes(accountId) ? [accountId, ...typed] : typed;
  }, [members, accountId]);

  let draft: Draft | undefined;
  let problem: string | undefined;
  try {
    draft = { name: name.trim(), members: memberList, contribution: parseUsdc(amount), roundSec, graceSec, bond: parseUsdc(bond || "0") };
    problem = validate(draft);
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }

  return (
    <Card title="Start a circle">
      <p className="muted">You'll be a member. Everyone you add joins with their own wallet; the circle starts once they all have.</p>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Friday friends" maxLength={60} />
      </label>
      <label>
        Other members' NEAR accounts
        <textarea
          value={members}
          onChange={(e) => setMembers(e.target.value)}
          rows={4}
          placeholder={"bao.testnet\ncarmen.testnet"}
          autoCapitalize="off"
          spellCheck={false}
        />
        <span className="small muted">One per line. 2 to 10 members including you{accountId ? ` (${accountId})` : ""}.</span>
      </label>
      <label>
        Amount each member pays per round (USDC)
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
      </label>
      <label>
        How long each round lasts
        <select value={roundSec} onChange={(e) => setRoundSec(Number(e.target.value))}>
          {ROUNDS.map(([s, l]) => (
            <option key={s} value={s}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Grace period after the deadline
        <select value={graceSec} onChange={(e) => setGraceSec(Number(e.target.value))}>
          {GRACE.map(([s, l]) => (
            <option key={s} value={s}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Deposit for an early turn (USDC, 0 for none)
        <input value={bond} onChange={(e) => setBond(e.target.value)} inputMode="decimal" />
        <span className="small muted">Covers a missed payment. It comes back at the end, minus anything used.</span>
      </label>

      {draft && !problem && (
        <p className="summary">
          {draft.members.length} members each pay {usdc(draft.contribution)} every {every(draft.roundSec)}. There are {draft.members.length} rounds, and each
          member receives {usdc(draft.contribution * BigInt(draft.members.length))} once.
        </p>
      )}
      {problem && (name || members) && <p className="err">{problem}</p>}
      <p className="small muted">Creating a circle sets aside 0.2 NEAR for storage; anything unused is refunded.</p>
      {draft && !problem ? (
        <TxButton
          tx={tx.create(draft)}
          onDone={(sent) => {
            if (typeof sent.result === "string") navigate(`/c/${sent.result}`);
          }}
        >
          Create the circle
        </TxButton>
      ) : (
        <button className="btn" disabled>
          Create the circle
        </button>
      )}
    </Card>
  );
}
