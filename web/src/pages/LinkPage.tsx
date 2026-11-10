import { useState } from "react";
import { Card, Copy } from "../components/ui";
import { config } from "../config";
import { base64ToBytes, LINK_RECIPIENT, linkMessage, signatureBase64 } from "../lib/link";
import { useWallet } from "../near/wallet";

/** Signs the bot's /link message (NEP-413) with the member's wallet and shows the /verify command. */
export function LinkPage({ query }: { query: URLSearchParams }) {
  const wallet = useWallet();
  const tg = Number(query.get("tg"));
  const account = query.get("account") ?? "";
  const nonce = query.get("nonce") ?? "";
  const [result, setResult] = useState<{ command?: string; error?: string; busy?: boolean }>({});

  if (!tg || !account || !nonce) {
    return (
      <Card title="Link your Telegram">
        <p>
          Open this page from the link the Rota bot sends after <code>/link your-account.testnet</code> in Telegram.
        </p>
      </Card>
    );
  }

  const message = linkMessage(tg, account);
  const wrongAccount = wallet.accountId && wallet.accountId !== account;
  const sign = async () => {
    setResult({ busy: true });
    try {
      const signed = await wallet.signMessage({ message, recipient: LINK_RECIPIENT, nonce: base64ToBytes(nonce) });
      setResult({ command: `/verify ${signed.publicKey} ${signatureBase64(signed.signature)}` });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Card title="Link your Telegram">
      <p>
        Prove that <b>{account}</b> is yours by signing a short message with your wallet. Signing is free, sends nothing, and gives nobody access to
        your account.
      </p>
      <blockquote className="message">{message}</blockquote>
      {!wallet.accountId && (
        <button className="btn" disabled={!wallet.ready} onClick={() => void wallet.connect()}>
          Connect {account}
        </button>
      )}
      {wrongAccount && (
        <p className="err">
          Your wallet is connected as {wallet.accountId}, but the link is for {account}. Disconnect and connect {account}.
        </p>
      )}
      {wallet.accountId === account && !result.command && (
        <button className="btn" disabled={result.busy} onClick={() => void sign()}>
          {result.busy ? "Waiting for your wallet…" : "Sign the message"}
        </button>
      )}
      {result.error && <p className="err">❌ {result.error}</p>}
      {result.command && (
        <div className="done">
          <p className="ok">✅ Signed. Now send this to the bot in your Telegram group:</p>
          <pre className="command">{result.command}</pre>
          <div className="actions">
            <Copy text={result.command} label="Copy the command" />
            <a className="btn secondary small" href={`https://t.me/${config.botUsername}`} target="_blank" rel="noreferrer">
              Open Telegram
            </a>
          </div>
        </div>
      )}
    </Card>
  );
}
