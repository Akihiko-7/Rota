# Rota

Your savings circle has an AI treasurer, and even the AI can't steal the money.

Rota is a rotating savings circle (susu, tanda, chama, chit fund, hui) on NEAR. A contract holds the money and pays each round to the scheduled member. An AI treasurer coordinates the circle, but its only key can call `settle` and nothing else.

> **Status: work in progress (NEAR HACKATHON, Nov 2026).** Nothing is deployed yet. Phase 0 findings are in [docs/PHASE0.md](docs/PHASE0.md).

## Layout

| Path | What |
|---|---|
| `contract/` | Rust contracts and near-workspaces sandbox tests |
| `bot/` | AI treasurer (Telegram + NEAR AI Cloud), not started |
| `web/` | React web app, not started |
| `scripts/` | Demo and spike scripts |
| `docs/` | Design notes |

## Run the tests

Needs Rust (the toolchain is pinned in `contract/rust-toolchain.toml`), plus perl, make and a C compiler for the vendored OpenSSL. No secrets.

```sh
cd contract && cargo test
```

## License

MIT
