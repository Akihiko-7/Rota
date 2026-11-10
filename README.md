# Rota

Your savings circle has an AI treasurer, and even the AI can't steal the money.

Rota is a rotating savings circle (susu, tanda, chama, chit fund, hui) on NEAR. N members each pay a fixed amount every round, and each round one member receives the whole pot. A contract holds the money and pays each round to the scheduled member. An AI treasurer coordinates the circle, but its only key can call `settle` and nothing else.

> **Status: work in progress (NEAR HACKATHON, Nov 2026).**
>
> | Part | State |
> |---|---|
> | Circle contract (`contract/circle`) | Built; sandbox tests pass. Not deployed yet |
> | Mock NEP-141 (`contract/mock-ft`) | Built. Used in tests and on testnet; anyone can mint |
> | AI treasurer bot (`bot/`) | Not started |
> | Web app (`web/`) | Not started |
>
> Phase 0 findings (API checks, design consequences) are in [docs/PHASE0.md](docs/PHASE0.md).

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

After deployment the contract account's keys are deleted (locked), so nobody can redeploy the code and drain it. A fix means a fresh deployment under a new versioned name (`circle-v1`, `circle-v2`, …). Unanimous dissolve is the escape hatch for circles on an old version.

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
| `contract/integration-tests` | near-workspaces sandbox tests |
| `scripts/` | Testnet account setup and Phase 0 spike scripts |
| `docs/` | Design notes |

## Libraries

near-sdk 5.30, near-contract-standards 5.30 (mock token only), near-workspaces 0.24 and cargo-near 0.23 (tests and builds), near-api-js 7.4 (scripts).

## License

MIT
