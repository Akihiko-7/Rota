import { useEffect } from "react";
import { Header, NetBanner, NoticeBar, NoticeProvider } from "./components/ui";
import { BOT, NETWORKS, isNet, repoFile, type Net } from "./config";
import { NetProvider, lastNetwork, rememberNetwork, useNet } from "./lib/net";
import { Link, navigate, useLocation } from "./lib/router";
import { WalletProvider } from "./near/wallet";
import { CirclePage } from "./pages/CirclePage";
import { HarvestPage } from "./pages/HarvestPage";
import { Home } from "./pages/Home";
import { LinkPage } from "./pages/LinkPage";
import { NewCircle } from "./pages/NewCircle";
import { RepPage } from "./pages/RepPage";
import { StartPage } from "./pages/StartPage";

export function App() {
  const { path, query } = useLocation();
  const m = /^\/([a-z]+)(\/.*)?$/.exec(path);
  const net = m && isNet(m[1]) ? (m[1] as Net) : undefined;

  useEffect(() => {
    // Old or bare links (/, /c/5, /link?...) go to the visitor's last network.
    if (!net) navigate(`/${lastNetwork()}${path === "/" ? "" : path}${location.search}${location.hash}`, { replace: true });
    else rememberNetwork(net);
  }, [net, path]);

  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [path]);

  if (!net) return null;
  return (
    <NetProvider net={net}>
      <WalletProvider key={net} cfg={NETWORKS[net]}>
        <NoticeProvider>
          <Header />
          <NetBanner />
          <NoticeBar />
          <main>
            <Page rest={m?.[2] ?? "/"} query={query} />
          </main>
          <Footer />
        </NoticeProvider>
      </WalletProvider>
    </NetProvider>
  );
}

function Page({ rest, query }: { rest: string; query: URLSearchParams }) {
  const { to } = useNet();
  const circle = /^\/c\/(\d+)\/?$/.exec(rest);
  const rep = /^\/rep\/([^/]+)\/?$/.exec(rest);
  const pot = /^\/harvest\/(\d+)\/?$/.exec(rest);
  if (rest === "/" || rest === "") return <Home />;
  if (circle) return <CirclePage id={circle[1]} />;
  if (rest === "/new") return <NewCircle />;
  if (rest === "/link") return <LinkPage query={query} />;
  if (rest === "/start") return <StartPage />;
  if (rest === "/rep") return <RepPage />;
  if (rep) return <RepPage account={decodeURIComponent(rep[1])} />;
  if (rest === "/harvest") return <HarvestPage />;
  if (pot) return <HarvestPage id={pot[1]} />;
  return (
    <section className="card narrow">
      <h2>Page not found</h2>
      <Link to={to("/")}>Back to the start</Link>
    </section>
  );
}

function Footer() {
  const { cfg } = useNet();
  return (
    <footer className="footer">
      <p>
        Rota on NEAR {cfg.network}. {cfg.contractId ? <>Contract <a href={`${cfg.explorer}/address/${cfg.contractId}`}>{cfg.contractId}</a>.</> : "Mainnet contract: launching soon."}{" "}
        Treasurer bot: <a href={`https://t.me/${BOT}`}>@{BOT}</a>.
      </p>
      <p>
        <a href={cfg.repo}>Source code</a> · <a href={repoFile("README.md")}>How it works</a> · No AI runs on this website.
      </p>
    </footer>
  );
}
