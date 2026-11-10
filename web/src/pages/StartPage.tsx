import type { ReactNode } from "react";
import { TestWallet } from "../components/ui";
import { BOT } from "../config";
import { useNet } from "../lib/net";
import { Link } from "../lib/router";

/** The walkthrough video, once recorded (YouTube embed URL or a file in /public). */
const WALKTHROUGH_VIDEO: string | null = null;

function Shot({ src, alt, caption }: { src: string; alt: string; caption?: ReactNode }) {
  return (
    <figure className="shot">
      <img src={`/tutorial/${src}`} alt={alt} loading="lazy" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="step" id={`step-${n}`}>
      <h2>
        <span className="step-n">{n}</span> {title}
      </h2>
      {children}
    </section>
  );
}

export function StartPage() {
  const { net } = useNet();
  return net === "testnet" ? <TryItFree /> : <GetStarted />;
}

function Toc({ items }: { items: string[] }) {
  return (
    <nav className="toc" aria-label="Steps">
      <p className="eyebrow">Steps</p>
      <ol>
        {items.map((t, i) => (
          <li key={t}>
            <a href={`#step-${i + 1}`}>{t}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function GetStarted() {
  const { to } = useNet();
  const steps = [
    "Create a NEAR wallet",
    "Add a little NEAR for fees",
    "Get USDC on NEAR",
    "Join your circle",
    "Pay each round",
    "Link your Telegram",
    "If you miss a payment",
    "Stay safe",
  ];
  return (
    <div className="article-grid">
      <aside className="article-side">
        <Toc items={steps} />
      </aside>
      <article className="card article">
        <p className="eyebrow">Mainnet · real money</p>
        <h1>Get started with Rota</h1>
        <p className="lede">
          Never used crypto before? This guide takes you from nothing to paying your first round. It takes about 20 minutes, most of it getting USDC.
          Want to practise first? <Link to="/testnet/start">Try it free on testnet</Link>: same steps, no real money.
        </p>
        <p className="note">
          Rota's mainnet contract is <b>launching soon</b>. You can do steps 1 to 3 now so you're ready. The screenshots below are from testnet; mainnet
          looks the same with real USDC.
        </p>

        <Step n={1} title="Create a NEAR wallet">
          <p>A wallet holds your money and signs payments. Only you control it. Rota works with any wallet in the NEAR Connect list, including:</p>
          <ul>
            <li>
              <b>Meteor Wallet</b>: in your web browser, or as a phone app (Android, iPhone) or Chrome extension.{" "}
              <a href="https://meteorwallet.app/" target="_blank" rel="noreferrer">meteorwallet.app</a>
            </li>
            <li>
              <b>HOT Wallet</b>: a phone app, also inside Telegram. <a href="https://hot-labs.org/wallet" target="_blank" rel="noreferrer">hot-labs.org/wallet</a>
            </li>
            <li>
              <b>Intear Wallet</b>: in your web browser. <a href="https://wallet.intear.tech/" target="_blank" rel="noreferrer">wallet.intear.tech</a>
            </li>
            <li>
              <b>MyNearWallet</b>: in your web browser. <a href="https://mynearwallet.com" target="_blank" rel="noreferrer">mynearwallet.com</a>
            </li>
            <li>
              <b>NEAR Mobile</b>: a phone app. <a href="https://nearmobile.app" target="_blank" rel="noreferrer">nearmobile.app</a>
            </li>
          </ul>
          <p>
            When you create the wallet it shows a <b>secret phrase</b> (12 or 24 words). Write it on paper and keep it somewhere safe. Anyone with
            those words can take everything in the wallet, and nobody can recover it for you if you lose them.
          </p>
          <p>
            Your account gets a name like <code>yourname.near</code>, or a long code of letters and numbers. That's what you give the person starting
            the circle.
          </p>
          <Shot src="wallet-choice.png" alt="The Connect wallet window on Rota listing NEAR wallets" caption="Clicking Connect wallet on Rota shows the wallets you can use." />
        </Step>

        <Step n={2} title="Add a little NEAR for fees">
          <p>Every action on NEAR costs a tiny fee in NEAR, the network's own coin. Here's what we measured on a real 4-round circle:</p>
          <table className="numbers">
            <tbody>
              <tr>
                <td>Joining a circle</td>
                <td className="num">about 0.002 NEAR</td>
              </tr>
              <tr>
                <td>Each payment</td>
                <td className="num">about 0.0007 NEAR</td>
              </tr>
              <tr>
                <td>A whole 4-round circle, as a member</td>
                <td className="num">about 0.005 NEAR</td>
              </tr>
              <tr>
                <td>Starting a circle (extra, held for its storage)</td>
                <td className="num">about 0.012 NEAR per member</td>
              </tr>
            </tbody>
          </table>
          <p>
            <b>Keep about 0.2 NEAR in your wallet</b> (about 0.6 if you start the circle). You won't spend most of it. Before each action, NEAR checks
            that you could cover the highest possible fee, up to 0.1 NEAR for a payment, and refunds the rest straight away. Joining also holds 0.05
            NEAR briefly and returns what isn't used.
          </p>
          <p>
            To get NEAR, buy it on an exchange that lists it (many large exchanges do), then withdraw it to your wallet's account name, choosing the{" "}
            <b>NEAR</b> network. Some wallets also let you buy NEAR inside the app.
          </p>
        </Step>

        <Step n={3} title="Get USDC on NEAR">
          <p>
            Circles are paid in <b>USDC</b>, a digital dollar issued by Circle. It has to be USDC <b>on the NEAR network</b>. There are two ways to get it:
          </p>
          <ul>
            <li>
              <b>From an exchange.</b> Buy USDC and withdraw it, choosing <b>NEAR</b> as the network. Not every exchange offers this; check the network
              list before you withdraw, and send a small amount first.
            </li>
            <li>
              <b>From another chain.</b> If you already have USDC on Ethereum, Base, Solana or another chain, swap it to USDC on NEAR with{" "}
              <a href="https://near-intents.org" target="_blank" rel="noreferrer">NEAR Intents</a>.
            </li>
          </ul>
          <p className="small">
            Check it's the real one: USDC on NEAR is the token <code>17208628f84f…36133a1</code>. An older bridged version called USDC.e is a different
            token, and Rota doesn't accept it.
          </p>
          <p>
            You need the amount per round times the number of rounds, plus the optional deposit. In a 4-member circle at 10 USDC a round, that's 40 USDC
            in total, paid 10 at a time.
          </p>
        </Step>

        <Step n={4} title="Join your circle">
          <p>
            The person starting the circle adds your account name and sends you the circle's link. Open it, click <b>Connect wallet</b>, then{" "}
            <b>Join the circle</b>, and approve in your wallet. If the circle has a deposit, posting it gets you an earlier turn.
          </p>
          <Shot src="join.png" alt="A circle waiting to start, with a Join the circle button" caption="A circle waiting for its members to join." />
        </Step>

        <Step n={5} title="Pay each round">
          <p>
            Once everyone has joined, the circle starts. Each round, open the circle and press <b>Pay</b>. You pay exactly the agreed amount; the page
            shows how long you have. When everyone has paid, the AI treasurer pays the whole pot to whoever's turn it is.
          </p>
          <Shot src="pay.png" alt="The current round with the Pay button and who has paid" caption="This round: who's paid, the deadline, and your Pay button." />
        </Step>

        <Step n={6} title="Link your Telegram">
          <p>
            Your circle's Telegram group has the treasurer bot, <a href={`https://t.me/${BOT}`}>@{BOT}</a>. It posts reminders and every payout. In the
            group, send <code>/link yourname.near</code>. The bot replies with a link to a signing page: open it, approve the message in your wallet, and
            send the <code>/verify</code> line it shows you back to the group. Signing is free and gives nobody access to your money.
          </p>
          <Shot src="link.png" alt="The signing page that proves you own your NEAR account" caption="The signing page proves the account is yours." />
        </Step>

        <Step n={7} title="If you miss a payment">
          <p>
            If a round's deadline and grace period pass without your payment, the treasurer pays out what was collected. Your missed payment goes on your
            payment record, and if you posted a deposit, up to one round's amount is taken from it and added to the pot, so the person due that round is
            still paid. Missing a payment after you've already had your turn counts as a default.
          </p>
          <Shot src="missed.png" alt="A round where one member didn't pay and their deposit covered it" caption="A missed payment, covered by the member's deposit." />
          <p>
            Anyone can see a member's record on the <Link to={to("/rep")}>payment records</Link> page.
          </p>
        </Step>

        <Step n={8} title="Stay safe">
          <ul>
            <li>
              <b>Never share your secret phrase</b>, not with us, the bot, or anyone claiming to be support. Rota never asks for it.
            </li>
            <li>
              <b>The treasurer can't take your money.</b> Its only key can do one thing: pay out a round to whoever's turn it is. You can check this
              yourself on the <Link to={to("/")}>home page</Link>.
            </li>
            <li>Only join circles with people you know and trust. The contract enforces the rules, but it can't make anyone keep paying.</li>
            <li>Payments can't be reversed. Check the circle number and amount before you approve.</li>
            <li>Make sure you're on the real Rota site before connecting your wallet.</li>
          </ul>
        </Step>
      </article>
    </div>
  );
}

function TryItFree() {
  const { to } = useNet();
  const steps = ["Create a test wallet", "Get free test NEAR", "Get free test USDC", "Try a circle", "Add the treasurer bot"];
  return (
    <div className="article-grid">
      <aside className="article-side">
        <Toc items={steps} />
        <TestWallet />
      </aside>
      <article className="card article">
        <p className="eyebrow">Testnet · free, nothing is real</p>
        <h1>Try Rota for free</h1>
        <p className="lede">
          Testnet is NEAR's practice network. Everything works exactly like the real thing, but the coins are free and worth nothing, so you can't lose
          money. It takes about 10 minutes.
        </p>
        {WALKTHROUGH_VIDEO ? (
          <div className="video">
            <iframe src={WALKTHROUGH_VIDEO} title="Rota walkthrough" allow="fullscreen; picture-in-picture" allowFullScreen />
          </div>
        ) : (
          <p className="note small">A video walkthrough of these steps is coming soon.</p>
        )}

        <Step n={1} title="Create a test wallet">
          <p>
            You need a wallet that works on testnet. Rota offers the ones that support it when you click <b>Connect wallet</b> with <b>Testnet</b>{" "}
            selected at the top, including <b>Meteor Wallet</b> and <b>Intear Wallet</b>. Create a new account and choose testnet. Testnet account names
            end in <code>.testnet</code>.
          </p>
          <Shot src="wallet-choice-testnet.png" alt="The Connect wallet window on testnet" caption="Wallets that work on testnet." />
        </Step>

        <Step n={2} title="Get free test NEAR">
          <p>
            Test NEAR pays the tiny fees. Paste your account name into the official{" "}
            <a href="https://docs.near.org/getting-started/faucet" target="_blank" rel="noreferrer">NEAR testnet faucet</a> (or{" "}
            <a href="https://near-faucet.io/" target="_blank" rel="noreferrer">near-faucet.io</a>) and request tokens. 0.5 test NEAR is plenty.
          </p>
        </Step>

        <Step n={3} title="Get free test USDC">
          <p>
            Connect your wallet on this site and press <b>Get test USDC</b> (in the box on this page, or on any circle page). It adds 100 test USDC to your
            wallet, and you can press it again whenever you run low.
          </p>
          <Shot src="test-wallet.png" alt="Your test wallet with the Get test USDC button" caption="Your test balances and the Get test USDC button." />
        </Step>

        <Step n={4} title="Try a circle">
          <p>
            <Link to={to("/new")}>Start a circle</Link> with a friend, or with a second test account of your own. Pick 2-minute rounds to see it all in a
            few minutes. Everyone joins, the circle starts, and each round everyone pays. Try missing a payment to see the deposit cover it.
          </p>
          <Shot src="new-circle.png" alt="The Start a circle form" caption="Starting a circle: members, amount per round, round length and deposit." />
          <Shot src="pay.png" alt="Paying a round" caption="Each round: pay, and watch the pot go to whoever's turn it is." />
        </Step>

        <Step n={5} title="Add the treasurer bot">
          <p>
            Make a Telegram group with your circle's members and add <a href={`https://t.me/${BOT}`}>@{BOT}</a> (don't make it an admin). Then send{" "}
            <code>/circle 12 testnet</code>, using your circle's number. The bot posts each payment, reminds anyone late, and pays out every round. Reply to
            any of its messages to ask it a question, or send <code>/redteam</code> to watch it try, and fail, to steal the pot.
          </p>
        </Step>
      </article>
    </div>
  );
}
