import { Header, NoticeBar, NoticeProvider, TestnetBanner } from "./components/ui";
import { config, repoFile } from "./config";
import { Link, useLocation } from "./lib/router";
import { CirclePage } from "./pages/CirclePage";
import { Home } from "./pages/Home";
import { LinkPage } from "./pages/LinkPage";
import { NewCircle } from "./pages/NewCircle";

export function App() {
  const { path, query } = useLocation();
  const circle = /^\/c\/(\d+)\/?$/.exec(path);
  let page;
  if (path === "/") page = <Home />;
  else if (circle) page = <CirclePage id={circle[1]} />;
  else if (path === "/new") page = <NewCircle />;
  else if (path === "/link") page = <LinkPage query={query} />;
  else
    page = (
      <section className="card">
        <h2>Page not found</h2>
        <Link to="/">Back to the start</Link>
      </section>
    );
  return (
    <NoticeProvider>
      <Header />
      <TestnetBanner />
      <NoticeBar />
      <main>{page}</main>
      <footer className="footer">
        <p>
          Rota runs on NEAR {config.network}. Contract <a href={`${config.explorer}/address/${config.contractId}`}>{config.contractId}</a>.
        </p>
        <p>
          <a href={config.repo}>Source code</a> · <a href={repoFile("README.md")}>How it works</a> · No AI runs on this website.
        </p>
      </footer>
    </NoticeProvider>
  );
}
