# Rota

Your savings circle has an AI treasurer, and even the AI can't steal the money.

Rota is a rotating savings circle (susu, tanda, chama, chit fund, hui) on NEAR. N members each pay a fixed amount every round, and each round one member receives the whole pot. A contract holds the money and pays each round to the scheduled member. An AI treasurer coordinates the circle, but its only key can call `settle` and nothing else.

> **Status: work in progress (NEAR HACKATHON, Nov 2026).**
>
> | Part | State |
> |---|---|
> | Circle contract (`contract/circle`) | Sandbox tests pass. Deployed and **locked** on testnet as `circle-v2.rota-nearhack.testnet`; full cycles run on-chain. Not on mainnet |
> | Mock NEP-141 (`contract/mock-ft`) | **A freely mintable test token, not USDC and worth nothing.** Anyone can call `mint`. Used in tests and on testnet as `usdc-mock.rota-nearhack.testnet` |
> | Treasurer key | Real and on testnet: an account whose only key can call `settle` on the circle |
> | Telegram bot (`bot/`) | Commands, status reads, reminders, auto-settle with the treasurer key, `/redteam`, account linking. Tested with a mocked LLM and Telegram, and against a local sandbox. Ran a full circle live in a test group (circle 5 on circle-v2) |
> | AI answers (NEAR AI Cloud) | Working live with `Qwen/Qwen3.8-27B` (tool calling confirmed, about $0.0003 per question). Tests use a mocked endpoint |
> | Web app (`web/`) | Read-only pages work without a wallet: live proof checks, the finished demo circle, any circle by number. With a wallet: create, join, deposit, start, pay, pay out, swap turns, close by vote, and the NEP-413 page for the bot's `/link`. The full flow passes end-to-end browser tests on testnet. **Not deployed yet** (ready for Vercel) |
> | Cross-chain pay (NEAR Intents) | **Mainnet only. Built, not yet used with real money.** The circle page asks the 1Click API for a deposit address on Base, Arbitrum, Solana, Polygon or Ethereum, then follows the swap until the USDC arrives in the member's own NEAR account, where they press Pay as usual (two steps, see [docs/PHASE0.md](docs/PHASE0.md)). Checked against live 1Click price quotes for all five chains, and in a browser with the API mocked. The first real swap is planned for the mainnet circle on 13 Nov. On testnet it shows disabled, labelled "Mainnet only" |
> | Harvest, group staking (`contract/harvest`) | **Testnet only.** Sandbox tests pass. Locked `harvest-v1.rota-nearhack.testnet` is running its first real pot (17 test NEAR in `aurora.pool.f863973.m0`); results will be added when it ripens |
> | Mainnet | **Not deployed yet.** The web app shows mainnet as "launching soon" with actions disabled |
>
> Phase 0 findings (API checks, design consequences) are in [docs/PHASE0.md](docs/PHASE0.md).

## Run the demo

Needs Node.js 24 or later. No accounts, keys or `.env`:

```sh
npm install
npm run demo:sandbox
```

It starts a local NEAR sandbox (the first run downloads the ~90 MB sandbox binary), deploys the mock USDC and the circle contract from [contract/res/](contract/res/), locks the circle, creates a treasurer that holds only a `settle` key, and runs one full circle in about 35 seconds:

- 4 members, 10 USDC per round, 2-minute rounds with a 30 s grace period (the sandbox fast-forwards block time).
- dara posts a 10 USDC bond, takes the first slot and the first pot, then skips round 1.
- The treasurer tries to settle round 1 early. The contract refuses: a payment is missing.
- The treasurer's key tries `ft_transfer` on the token and `claim` on the circle. The network rejects both before they execute.
- After the grace period the treasurer settles. The contract records dara's miss and default and slashes the bond into the pot, so the recipient still gets 40 USDC.
- Rounds 2 and 3 complete. Every member ends even, the circle holds nothing, and every round was settled by the treasurer.

The script checks each of these and exits non-zero if any fails. `npm run demo:testnet` runs the same cycle against the testnet contracts in `.env`; it takes about 7 minutes of real time.

## The Telegram bot

[@RotaNear_Bot](https://t.me/RotaNear_Bot) is the circle's treasurer in a Telegram group. Without any LLM it:
- posts each payment as it lands, reminds unpaid members once before the deadline and once after it, and announces every settled round with its transaction;
- settles each round with the treasurer key as soon as the contract allows it;
- answers `/status`, `/order`, `/history`, `/pay`, `/rep`, `/settle`, `/redteam`, `/link`, `/verify` and `/swap`.

On top of that, `/ask` and replies to any of the bot's messages go to NEAR AI Cloud (`Qwen/Qwen3.8-27B` by default, a model served from a TEE with attestation; `/attest` fetches the report with a fresh nonce). The model can read circle state and call one action, `settle_round`. **There is no fallback to another LLM provider:** if NEAR AI is unreachable or refuses the request, the bot says so and the commands keep working.

**AI cost controls.** Only `/ask` and replies to the bot call the LLM. Commands, reminders, status, settlements and `/redteam` are templates. Each question sends a short system prompt and the question, with no chat history and `max_tokens` 300, and allows at most two tool rounds. Two further limits apply:
- A daily budget (`NEARAI_DAILY_BUDGET_USD`, default $0.50) is checked before every call against the model's published price.
- Each user can ask 5 questions per 10 minutes.

Every call's tokens and cost are logged. A typical question costs about $0.0004 with Qwen3.8-27B.

### Even a compromised bot can at worst call settle

The bot server holds one NEAR key: the treasurer's function-call key. It never holds member keys or the deployer key.
- **NEAR enforces the limit.** The key's on-chain permission is receiver `circle-v2…`, methods `[settle]`. NEAR rejects anything else before it executes: transfers, other methods, other contracts, attached deposits.
- **The contract picks the recipient.** `settle` takes only a circle id and pays `order[current_round]`, and only when everyone has paid or the grace period has ended.
- **The bot checks its own key at startup** and refuses to run if it's a full-access key or allows anything but `settle` on this contract.
- **It reads only the variables it needs** ([bot/src/config.ts](bot/src/config.ts)); any other `*PRIVATE_KEY` in the environment is dropped.

So someone who takes over the server, the Telegram account or the LLM can at worst call `settle`, which settles a round the contract already allows to be settled. `/redteam` shows this live in the group. It signs three real attempts with the treasurer key and posts NEAR's answer to each:
1. a direct `ft_transfer` of the pot on the token contract: rejected by NEAR, "Access key receiver … does not match transaction receiver …";
2. `claim`, a method the key doesn't allow: rejected by NEAR, "Access key does not allow method claim";
3. `settle` with an injected `"recipient"`: executed (with its tx hash), and the contract ignores the extra argument and pays the scheduled member, or refuses because the round can't be settled yet.

### Linking Telegram users to NEAR accounts

`/link <account>` records an **unverified** link and shows a NEP-413 message (`message`, `recipient: rota-bot`, a fresh 32-byte nonce). `/verify <public_key> <signature>` checks the signature and that the key is a full-access key of that account, using near-api-js's `verifyMessage`. Unverified users can't start swap requests. The bot can't sign anything for members: `/pay` and `/swap` show the exact call each member signs in their own wallet. A wallet signing page is planned for the web app and isn't built yet.

### Privacy

- **Telegram privacy mode is on**, so the bot only receives commands and replies to its own messages. Ordinary group chat never reaches it, and neither do plain @mentions: Telegram doesn't deliver those to privacy-mode bots (confirmed in the demo group). The bot checks this at startup (`can_read_all_group_messages` must be false) and refuses to run otherwise.
- It stores, in one JSON file: which group follows which circle; Telegram user id, username and NEAR account for users who ran `/link`, and whether the link is verified; and which rounds and payments it has already announced. No keys, and no message text.
- Message logging is off by default. `BOT_TRANSCRIPT_PATH` turns on a log of the messages the bot receives and sends, used to record the demo transcript.
- The text of `/ask` questions and of replies to the bot, plus the circle's public on-chain data, are sent to NEAR AI Cloud.

### Run it

```sh
npm run bot                # reads the allowed variables from .env
npm run test:bot           # unit tests (mocked LLM and Telegram) + sandbox tests; no secrets
```

To run it 24/7, use the [Dockerfile](Dockerfile): copy [bot/bot.env.example](bot/bot.env.example) to `bot/bot.env`, fill in the treasurer key, bot token and NEAR AI key, then

```sh
docker build -t rota-bot .
docker run -d --name rota-bot --restart unless-stopped --env-file bot/bot.env -v rota-bot:/data rota-bot
```

Hosting options for the image (it needs about 150 MB of memory and a small volume for `/data`). Prices are from third-party summaries of each provider's pricing in 2026; check the provider's own page before choosing:

| Host | Smallest always-on option | About |
|---|---|---|
| Fly.io | shared-cpu-1x machine, 256 MB (512 MB recommended), 1 GB volume | $2–4 / month |
| Render | Background worker "Starter" (0.5 CPU, 512 MB) | $7 / month |
| Railway | Hobby plan, billed by usage | $5 / month plan, plus usage (more for 1 GB RAM) |
| VPS (e.g. Hetzner) | smallest shared-CPU server, Docker installed | about $4–6 / month |

We use **Fly.io**. With a Fly account and [flyctl](https://fly.io/docs/flyctl/install/) installed, one command sets it up or updates it:

```sh
bash deploy/fly-deploy.sh
```

It creates the app and a 1 GB volume in Amsterdam, copies only the bot's own settings from `.env` into Fly secrets ([scripts/fly-secrets.ts](scripts/fly-secrets.ts) uses the same allowlist as the bot), deploys the image's `fly` stage on Fly's builders ([fly.toml](fly.toml): one 512 MB machine, restarted if it stops), and on the first run moves the bot's state there. Fly mounts the volume owned by root, so that stage's [entrypoint](deploy/fly-entrypoint.sh) hands `/data` to the `node` user and drops root before starting the bot.

The image is built and smoke-tested by [GitHub Actions](.github/workflows/bot.yml) on every push that touches the bot: it must start, load every module and stop cleanly without config, run as the `node` user (the Fly stage too, with a root-owned volume), and contain no `.env`, `credentials/` or contract sources.

## The web app

[web/](web/) is a mobile-first React app (Vite). It talks to NEAR directly and has no server. No AI runs in it.

**No wallet needed to look.** Judges and members can check the proof on the landing page. It reads live from chain:
- the circle contract has 0 access keys;
- its code hash equals the SHA-256 of the committed [contract/res/rota_circle.wasm](contract/res/rota_circle.wasm);
- the treasurer holds one key, which can only call `settle` on that contract.

The landing page also shows the finished demo circle (circle 5) with each payout's transaction, and any circle opens at `/c/<number>`.

**A wallet only for actions**, through [NEAR Connect](https://docs.near.org/tools/near-connect) (`@hot-labs/near-connect`, as recommended in NEAR's docs):
- create a circle;
- join, post a deposit, start;
- pay a round (on testnet, a button mints free test USDC first if needed);
- pay out a round that the rules allow;
- propose or accept a swap of turns;
- vote to close a circle;
- claim a payout that couldn't be delivered;
- sign the bot's `/link` message on `/link?tg=…&account=…&nonce=…`, which shows the `/verify` line to send in Telegram. If the bot has `WEB_URL` set, its `/link` reply links straight to this page.

**Cross-chain pay is mainnet only.** On testnet the button is shown disabled and labelled "Mainnet only", rather than faked.

**Tests:**
- `cd web && npm test` runs unit tests: formatting, the form checks mirroring the contract's limits, and NEP-413 signature encoding.
- `npm run e2e` drives the app in Chrome at phone size against testnet. It checks the read-only proof, then the whole member flow: create, join as two members, start, swap turns, pay both rounds, pay out, finish. It also checks that the `/link` page's signature passes NEAR's NEP-413 check against the account's real on-chain key.
- The browser tests sign with the demo members' testnet keys through a test-only signer. It exists only in builds made with `VITE_DEV_SIGNER=1`; CI checks it isn't in the production bundle. Signing through a real wallet pop-up (NEAR Connect) isn't automated; it has to be tried by hand.

**Two networks.** A switch in the header on every page: "Testnet (test wallet)" and "Mainnet (real money)". It changes the RPC, contract, token (test USDC or Circle's USDC), explorer links and the wallet's network.
- The network is in the URL (`/testnet/c/5`, `/mainnet/c/5`), and the visitor's last choice is remembered.
- The first switch to mainnet shows a real-money warning.
- Until the mainnet contract is deployed, mainnet pages say so and every action is disabled; nothing is faked.

**Tutorials.**
- [/mainnet/start](web/src/pages/StartPage.tsx) is "Get started": wallets, the NEAR you need (measured on a real circle), USDC on NEAR, joining, paying, linking Telegram, missed payments, and safety.
- `/testnet/start` is "Try it free": a test wallet, the NEAR faucet, the "Get test USDC" button, and trying a circle.
- The screenshots come from the real app, captured by [e2e/tutorial-shots.spec.ts](web/e2e/tutorial-shots.spec.ts). The one-page guide for the real mainnet circle is [docs/mainnet-member-guide.md](docs/mainnet-member-guide.md).

**Deploying on Vercel:** import the repo, set the Root Directory to `web`, and deploy. [web/vercel.json](web/vercel.json) sets the Vite build, the single-page-app rewrites and security headers. No environment variables are needed. Contract IDs and the expected code hash come from [web/src/generated/chain.json](web/src/generated/chain.json); regenerate it with `node scripts/sync-web.ts` after a redeploy.

## Harvest: group staking (testnet only)

Members put NEAR into one pot. When the filling window closes, the whole pot is staked with one validator pool, fixed when the pot is created, for a fixed number of epochs. After the term it's unstaked. NEAR's staking pools hold unstaked funds for 4 epochs, and when that wait is over the pot is withdrawn ("ripe"). Then it's shared out: each depositor gets their deposit back plus their share of the rewards, in proportion to what they put in. The contract is [contract/harvest](contract/harvest/src/lib.rs).

**Safety model:**
- **Only depositors get paid, pro-rata.** No method takes a recipient.
- **Permissionless steps.** `stake`, `unstake`, `withdraw` and `distribute` each check their own preconditions, so the bot's Harvest key, limited to exactly those four methods, can drive a pot and do nothing else.
- **No early exit.** Depositors can take their deposit back until staking starts, and nobody can after that until the pot is ripe.
- **One pot per pool at a time.** This contract's balance in a pool always belongs to exactly one pot.
- **Exact credit.** `withdraw` reads the pool's unstaked balance first and withdraws exactly that, so a pot is credited only with what the pool actually returned.
- **Exact sharing.** Sharing uses exact 256-bit arithmetic. The few yoctoNEAR left over by rounding go to the largest remainders, so the shares always add up to exactly what came back.

**Real numbers, not invented ones:**
- The web app shows rewards **read from the pool** (what the contract holds there minus what was deposited).
- It shows the pool's current APY, **calculated from NEAR's on-chain reward parameters** (yearly inflation, the validators' share, total supply over total stake) less the pool's fee. On testnet today that's 9.00% for `aurora.pool.f863973.m0`.
- Any projection is labelled as a projection.
- The ripe date is an estimate from current epoch timing. A testnet epoch is 43,200 blocks, about 7 hours at the current 0.59 s block time, and the pool unlocks 4 epochs after unstaking.

**The mock pool:** [contract/mock-pool](contract/mock-pool/src/lib.rs) mirrors near/core-contracts `staking-pool` (methods, arguments, share rounding, 4-epoch unlock, rewards detected as balance growth) for the sandbox tests. A live check on an unlocked `harvest-v0` with 0.2 test NEAR confirmed the real `aurora.pool.f863973.m0` behaves the same: `deposit_and_stake` accepted through the restricted key, 5 yocto of share rounding left unstaked, and balances read back exactly.

**Tests:**
- Exact sharing with uneven deposits and rounding dust, in [contract/harvest](contract/harvest/src/lib.rs).
- Sandbox tests in [tests/harvest.rs](contract/integration-tests/tests/harvest.rs):
  - deposits, and early withdrawal only before staking;
  - the full lifecycle to the yoctoNEAR;
  - nobody can redirect funds (restricted key, injected recipient, private callbacks);
  - a refused stake is refunded.
- Bot tests for `/harvest` and the ripe reminder.

**In Telegram:** `/harvest <id>` shows a pot and follows it. The bot then takes each step as soon as it's allowed, posts when the pot is staked and unstaked, sends a reminder when it's ripe, and shares it out. Harvest is testnet only: on mainnet the web app says "testnet only for now" and the bot does the same.

## On testnet

| Account | What | Keys |
|---|---|---|
| [`circle-v2.rota-nearhack.testnet`](https://testnet.nearblocks.io/address/circle-v2.rota-nearhack.testnet) | Circle contract (current) | **None.** Locked: [delete-key tx](https://testnet.nearblocks.io/txns/E6BvtK2voFu59TezZPqmGU6CXMk5768QzZNQkjVs2UdV) |
| [`treasurer-v2.rota-nearhack.testnet`](https://testnet.nearblocks.io/address/treasurer-v2.rota-nearhack.testnet) | AI treasurer for circle-v2 | One function-call key: receiver `circle-v2…`, methods `[settle]`, unlimited allowance ([created](https://testnet.nearblocks.io/txns/71VgUVH8B1LMkMzJsmA86Gj5TafnX9wGxA11bzo5d1qv)). It never had a full-access key |
| [`usdc-mock.rota-nearhack.testnet`](https://testnet.nearblocks.io/address/usdc-mock.rota-nearhack.testnet) | **Freely mintable test token** (symbol USDC, 6 decimals). Not real USDC and worth nothing: anyone can call `mint`. "USDC" amounts in this README are this token | Deployer's key |
| [`harvest-v1.rota-nearhack.testnet`](https://testnet.nearblocks.io/address/harvest-v1.rota-nearhack.testnet) | Harvest contract (group staking) | **None.** Locked: [delete-key tx](https://testnet.nearblocks.io/txns/ANbv6JwXcDQAtwQk3guBPAMFAvgRncQ1zkiTsrYByinG), before its first real pot |
| [`harvest-treasurer-v1.rota-nearhack.testnet`](https://testnet.nearblocks.io/address/harvest-treasurer-v1.rota-nearhack.testnet) | The bot's Harvest key | One function-call key: `stake`, `unstake`, `withdraw`, `distribute` on harvest-v1 ([created](https://testnet.nearblocks.io/txns/BnaxriHQ2cz7YzfSN2k2yxQqsvjZj8L8BbPKvFKDUBBR)) |
| [`harvest-v0.rota-nearhack.testnet`](https://testnet.nearblocks.io/address/harvest-v0.rota-nearhack.testnet) | Harvest live check with 0.2 test NEAR. **Not locked**; don't use it | Deployer's key |
| [`circle-v1.rota-nearhack.testnet`](https://testnet.nearblocks.io/address/circle-v1.rota-nearhack.testnet) | First test deployment, same code. **Superseded and not locked**; don't use it | Deployer's key |
| [`treasurer-v1.rota-nearhack.testnet`](https://testnet.nearblocks.io/address/treasurer-v1.rota-nearhack.testnet) | Treasurer for circle-v1 | Settle key for circle-v1 only |

Both circle accounts run code hash `BPh8us1zdQ7oChpqhAEwD1TvaEVCVjoeoEdCu7mEaX7A`, the base58 SHA-256 of [contract/res/rota_circle.wasm](contract/res/rota_circle.wasm) (hex `9a650789…1b7a95`). The deploy script checks this after deploying. The wasm was built with `cargo near build non-reproducible-wasm`, so a rebuild on another machine may not produce the same bytes.

Check the lock and the treasurer key yourself:

```sh
curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"circle-v2.rota-nearhack.testnet"}}'
# → "keys":[]
```

Every transaction the scripts sent is in [docs/testnet/transactions.json](docs/testnet/transactions.json). The main ones:

One uninterrupted demo run on the locked circle-v2 (circle 2, 31 transactions):

| Step | Transaction |
|---|---|
| amara creates the circle | [Ed95qhon…](https://testnet.nearblocks.io/txns/Ed95qhon51F3Dvi5VPJfTMmjphEHk3EifV67GVSYvffz) |
| dara posts the 10 USDC bond | [9t3dU147…](https://testnet.nearblocks.io/txns/9t3dU147GGQ4qsxX46fVahNmr5FJGpmrB1SMDfLwjP8M) |
| Circle starts; order dara, amara, bao, carmen | [FKKiEmZz…](https://testnet.nearblocks.io/txns/FKKiEmZz2p7mZXVFEUTizQvkyh1jKeYnDpWeBcC1afrk) |
| Treasurer settles round 0: 40 USDC to dara | [H59wSWkF…](https://testnet.nearblocks.io/txns/H59wSWkFv1yTDMjBxf5nFDtMCwuwDqnhStHDqT76eKJB) |
| Treasurer tries to settle round 1 early: **fails**, "3 of 4 paid" | [HTbNXXgP…](https://testnet.nearblocks.io/txns/HTbNXXgPf3diwwrTf9xTqSEAamG8o9TxPEAgJ4NLKw5U) |
| After grace, treasurer settles round 1: dara's miss and default recorded, 10 USDC bond slashed, 40 USDC to amara | [7hxVVTof…](https://testnet.nearblocks.io/txns/7hxVVTofuqNAw6jGsUuTo6FuShGpmdTyTxS14FGSKpZh) |
| Treasurer settles round 2: 40 USDC to bao | [4R5HLut7…](https://testnet.nearblocks.io/txns/4R5HLut7UNGJeHxAe7vqC88xJJnAcyNat3Y62tpYWWXF) |
| Treasurer settles round 3: 40 USDC to carmen; circle completed | [jgNF9Khd…](https://testnet.nearblocks.io/txns/jgNF9Khd58PrRMD9aacQPVUSPLNsJ81mVb4V7dSSm29) |

The treasurer key's `ft_transfer` and `claim` attempts in that run have no transactions: the network rejected them before they were created. Full cycles also completed on circle-v1 (circle 1) and on circle-v2 (circle 0, finished with `--resume` after an RPC timeout).

**Treasurer gas.** Before accepting a transaction, NEAR checks that the signer could pay for all its attached gas at a pessimistic price (about 10× the current one). A `settle` with 300 Tgas therefore needs about 0.3 NEAR available, although it burns about 0.0005 NEAR and the rest is refunded (treasurer-v2 spent 0.006 NEAR on its first 11 transactions). The treasurer was funded with 0.5 NEAR. Anyone can top it up by sending NEAR; nobody can take NEAR out, because it has no key that can sign a transfer.

**One treasurer per contract version.** A treasurer account never has a full-access key, so nobody can add a key for a new contract to it. Each circle version gets its own treasurer.

## Run the tests

Needs Rust and `cargo-near`. The Rust toolchain (1.95) is pinned in `contract/rust-toolchain.toml`. Building the vendored OpenSSL also needs perl, make and a C compiler. No secrets or network accounts are needed: the tests run in a local NEAR sandbox that near-workspaces downloads.

```sh
cargo install --locked --no-default-features cargo-near   # once; no Ledger support needed
npm test                                                   # = cd contract && cargo test
```

The full suite takes about 6 minutes.

## How the contract works

`contract/circle/src/lib.rs`, one contract for many circles. It has no owner and no admin method.

1. `create_circle(config)` sets the members (2–10), the token, the exact contribution, the round length (≥ 60 s, so demos can use minutes), the grace period and the bond for early slots.
2. `join(circle_id)`: each invited member accepts and pays storage. The contract also registers them on the token, so payouts can't fail on registration.
3. Members can post a bond (`ft_transfer_call`, `msg = {"circle_id":"…","kind":"bond"}`).
4. `start(circle_id)` fixes the payout order:
   - Early slots go to members who posted the bond, or who have completed a circle with no missed contribution and no default.
   - Everyone else goes last.
   - Each group keeps invitation order.
5. Each round, members pay exactly the contribution with `ft_transfer_call` (`"kind":"contribution"`). Any excess is returned. A wrong token, wrong amount, non-member, wrong phase or double payment is returned in full.
6. `settle(circle_id)` can be called by anyone: the AI treasurer, a member or a cron job.
   - It's allowed once everyone has paid, or once the deadline plus the grace period has passed.
   - It pays the pot to `order[current_round]`, which the contract computes. No payout method takes a recipient argument.
7. If a payout's `ft_transfer` fails, the amount becomes `claimable` by that same member, who withdraws it with `claim`.
8. `propose_swap` / `accept_swap` trade two unpaid slots, and both members must sign.
9. `propose_dissolve` / `vote_dissolve`: a unanimous vote refunds the current round's contributions and all bonds.

Tokens leave the contract only through `settle`, `claim`, dissolve refunds, and bond returns or slashes. Member actions that move value (`claim`, swaps, dissolve votes) require 1 yoctoNEAR attached, so they need a full-access-key (wallet) signature. `settle` takes no deposit, so the treasurer's function-call key can call it.

### Default policy

- A contribution missing at settle time is recorded as **missed**.
- After the deadline plus the grace period, `settle` pays the recipient **whatever was collected**.
- For each missed round, up to one contribution of the defaulter's bond is **slashed into that round's pot**.
- A miss after the member already received the pot is also recorded as a **default**.

**Bonds deter default; they don't eliminate it.** `tests/settle_rules.rs` shows a bonded member who takes the first pot and stops paying. They end up 10 USDC ahead, and the last recipient ends up 10 USDC short.

### Reputation

`get_reputation(account)` returns counts for one account across all circles on the contract:
- on-time contributions
- late contributions
- missed contributions
- circles completed with no miss
- defaults

It is a history anyone can check, not a score. **Sybil limit:** a new wallet has no history, so it only gets late slots unless it posts a bond. A completed circle is enough to earn early slots, so someone could farm history by running small circles among their own wallets.

### Upgrade policy

After deployment the contract account's keys are deleted (locked), so nobody can redeploy the code and drain it. A fix means a fresh deployment under a new versioned name (`circle-v1`, `circle-v2`, …). Unanimous dissolve is the escape hatch for circles on an old version. It has been used twice on testnet, both times to clean up a demo run that stopped partway:
- On circle-v1, a run was cut off by an RPC rate limit. The four members dissolved the circle and got back all 30 USDC it held ([last vote](https://testnet.nearblocks.io/txns/6A9ET6zkK6XnrTNugHBGRnXYAa1EQvhpEY2keZ4mxR4i)).
- On the locked circle-v2, a run stopped on a wrong assertion in the demo script about payout order. The members dissolved the circle and got back the 10 USDC bond ([last vote](https://testnet.nearblocks.io/txns/CaQx4p1aws2fCwTafS6yjw5T3zQ358Cw3VMb8Ck7e3PU)).

## What the tests check

| Requirement | Test |
|---|---|
| Full cycle: everyone pays every round and receives the pot exactly once; settled by the treasurer's settle-only key | `cycle.rs::full_cycle_each_member_receives_the_pot_once` |
| `settle` before the deadline with a payment missing fails | `settle_rules.rs::settle_before_deadline_with_payment_missing_fails` |
| After grace, `settle` pays what was collected, slashes the bond and records the default | `settle_rules.rs::missed_payment_after_grace_slashes_bond_and_records_default` |
| An early miss is not a default; paying after the deadline counts as late | `settle_rules.rs::early_miss_is_not_a_default_and_late_payment_is_late` |
| Wrong token, wrong amount, non-member, bad `msg`, wrong phase or double payment is refunded | `deposits.rs` |
| A forged `ft_on_transfer` call credits nothing | `deposits.rs::forged_ft_on_transfer_credits_nothing` |
| Every change method, called with hostile arguments, can't move the pot; an injected `recipient` argument is ignored | `no_theft.rs::no_method_sends_the_pot_anywhere_else` |
| The treasurer key fails for every method except `settle`, and for a Transfer | `access_keys.rs`, `no_theft.rs::treasurer_key_is_limited_to_settle` |
| A swap needs both members' approval, and only for unpaid slots | `swaps.rs` |
| A failed `ft_transfer` leaves the funds claimable by the recipient only | `claims.rs` |
| A unanimous dissolve refunds the round and all bonds (the escape hatch) | `dissolve.rs` |
| History earns an early slot | `cycle.rs::completed_history_earns_an_early_slot` |
| The largest circle (10 members, all bonded) fits in gas and in reserved storage | `limits.rs` |

## Layout

| Path | What |
|---|---|
| `contract/circle` | Circle contract |
| `contract/mock-ft` | Mock NEP-141 (testnet and tests only) |
| `contract/harvest` | Harvest group-staking contract (testnet only) |
| `contract/mock-pool` | Sandbox staking pool mirroring near/core-contracts staking-pool |
| `contract/integration-tests` | near-workspaces sandbox tests |
| `contract/res` | Release wasm and ABI that the scripts deploy |
| `scripts/demo-round.ts` | The demo cycle (`npm run demo:sandbox`, `npm run demo:testnet`) |
| `scripts/deploy-testnet.ts` | Testnet deploy steps: `token`, `circle vN`, `treasurer vN`, `lock vN` |
| `scripts/dissolve-circle.ts` | Unanimous dissolve of a testnet demo circle (the escape hatch) |
| `scripts/create-testnet-account.ts` | Faucet account for the deployer |
| `scripts/spikes/` | Phase 0 API checks |
| `bot/` | Telegram bot: [src/scheduler.ts](bot/src/scheduler.ts) (reminders, auto-settle), [src/bot.ts](bot/src/bot.ts) (commands, `/redteam`, AI), [src/ledger.ts](bot/src/ledger.ts) (chain access, key check), [test/](bot/test/) |
| `Dockerfile` | Runs the bot |
| `web/` | Web app: [src/pages/](web/src/pages/), chain reads in [src/near/chain.ts](web/src/near/chain.ts), wallet in [src/near/wallet.tsx](web/src/near/wallet.tsx), browser tests in [e2e/](web/e2e/) |
| `docs/demo/` | The live Telegram demo transcript and the demo circle's transactions |
| `scripts/faucet-topup.ts` | Tops up the deployer from the testnet faucet |
| `docs/` | Design notes; `docs/testnet/transactions.json` records every testnet transaction |

To rebuild the wasm: `cd contract/circle && cargo near build non-reproducible-wasm --locked --out-dir ../res` (and the same in `contract/mock-ft` and `contract/harvest`).

## Libraries

near-sdk 5.30, near-contract-standards 5.30 (mock token only), near-workspaces 0.24 and cargo-near 0.23 (tests and builds), near-api-js 7.4 and near-sandbox 0.3 (scripts and bot tests), grammY 1.46 (Telegram), React 19, Vite 8, NEAR Connect 0.12 (`@hot-labs/near-connect`), Vitest 5 and Playwright 1.64 (web). AI: NEAR AI Cloud's OpenAI-compatible API, called with `fetch`. Testnet RPC: FastNEAR.

`npm audit` reports advisories for `tar` 7.5.13, which near-sandbox pins exactly. It's a dev/test dependency, used to unpack NEAR's sandbox binary. Production installs (`npm ci --omit=dev`, as in the Dockerfile) report 0 vulnerabilities.

## License

MIT
