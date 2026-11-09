# Phase 0 findings (9 Nov 2026)

Each finding names its source. Spike scripts live in `scripts/spikes/` and `contract/integration-tests/tests/`.

## 1. Toolchain

| Item | Version | Note |
|---|---|---|
| near-sdk | 5.30.1 | Declares `min_protocol_version = 85` |
| near-workspaces (Rust) | 0.24.0 | Requires rustc ≥ 1.95. Pinned in `contract/rust-toolchain.toml` |
| cargo-near / cargo-near-build | 0.23.0 / 0.11.5 | Rust 1.87+ wasm (bulk-memory opcodes) is allowed from protocol 84 |
| Live protocol version | 88 on testnet and mainnet | Checked over RPC `status` |
| near-api-js | 7.4.0 | |
| @hot-labs/near-connect | 0.12.0 | Candidate for wallet login; choose in Phase 4 |
| grammy | 1.46.0 | |

near-workspaces always builds `native-tls`. The tests vendor OpenSSL (`openssl/vendored`), so they need perl, make and cc but not `libssl-dev`.

## 2. NEAR AI Cloud

- **Model list.** Docs say `GET https://cloud-api.near.ai/v1/models` (public). The response reports `supported_features` (`tools`, `json_mode`, …). The `/v1/model/list` path in the brief also exists. On 9 Nov both returned HTTP 500 ("Database connection pool error") or timed out. **Not yet verified.**
- **Candidate models**, both Confidential TEE according to the docs: `z-ai/glm-5.2` (model-discovery guide) and `z-ai/glm-5.3-flash` (SDK example with E2EE). Pick one once `/v1/models` confirms `tools`.
- **Tool calling.** The docs list Chat Completions with tool calling. `scripts/spikes/nearai-tools.ts` proves it end to end and falls back to JSON mode. **Not yet run: needs `NEARAI_API_KEY`.**
- **Attestation.** `GET /v1/attestation/report?model=…&provider=near&nonce=…&signing_algo=ecdsa` with `x-no-aliasing: true` is public.
  - The gateway report (Intel TDX quote, dstack app) came back on 9 Nov.
  - The per-model request failed with the same backend outage.
  - Full verification (DCAP quote, RTMR3 replay, app_compose hash, GPU evidence) is done by `@nearai/inference-sdk` (needs Node ≥ 24.22.1; local is 24.14.1) or by the embeddable Verification Center widget.
  - Plan for the Security page: show the report fields, verify the nonce echo, and embed the Verification Center for the full check.

## 3. 1Click deposit attribution

Source: `https://1click.chaindefuser.com/docs/v0/openapi.yaml`, QuoteRequest.

- `customRecipientMsg` exists: "**HIGHLY EXPERIMENTAL** Message to pass to `ft_transfer_call` when withdrawing assets to NEAR. Otherwise, `ft_transfer` will be used. **WARNING**: Funds will be lost if used with non NEP-141 tokens, in case of insufficient `storage_deposit` or if the recipient does not implement `ft_on_transfer`."
- `scripts/spikes/oneclick-quote.ts` sent dry quotes from Base USDC to NEAR USDC, EXACT_OUTPUT 1.000000. Both the plain quote and the `customRecipientMsg` quote returned HTTP 201: in ≈ 1.010224, out exactly 1.0, about 35 s. The recipient account must already exist; quotes to a non-existent account failed.
- **Problems with delivering straight to the circle contract:**
  - The `ft_on_transfer` sender would be the Intents contract, not the member, so `msg` would have to name the member.
  - If the contract rejects the deposit (round already settled, already paid), the refund goes back through the Intents withdrawal path. That path isn't documented, and the docs warn funds can be lost.
- **Recommendation:** the two-step flow. 1Click delivers to the member's own NEAR account, then the member calls `ft_transfer_call` from the web app. The direct route stays an optional mainnet experiment.

## 4. Tokens

- **Mainnet USDC:** `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, 6 decimals. Source: the 1Click `GET /v0/tokens` list.
- **Testnet:** `usdc.fakes.testnet` (USDC.e), Circle's `3e2210e1…b8af` and `usdc.testnet` all exist, but none can be minted freely. We'll deploy our own mock NEP-141 (`near-contract-standards`) so the demo can mint.

## 5. Function-call keys

Source: docs.near.org/protocol/accounts-contracts/access-keys. A function-call key is limited to one `receiver_id`, an optional `method_names` list and an optional `allowance`. It can't attach a deposit.

`contract/integration-tests/tests/access_keys.rs` (sandbox, passing) adds `function_call_access(circle, ["settle"], Some(1 NEAR))` and checks each rejection:

| Attempt with the key | Result |
|---|---|
| Transfer 1 yocto | `RequiresFullAccess` |
| Call `withdraw` on the circle | `MethodNameMismatch` |
| Call `settle` on another account | `ReceiverMismatch` |
| `settle` with 1 yocto attached | `DepositWithFunctionCall` |
| AddKey (full access) | `RequiresFullAccess` |
| `settle` on the circle | Passes key validation |

**Consequences for the design:**
- `settle` must not need an attached deposit, so no `assert_one_yocto`.
- When an allowance runs out, the key is dead for good. Since `settle` is permissionless, the fix is a new key or account; the contract doesn't change.
- **Contract account lock:** a contract account that still has a full-access key can redeploy its code and drain funds. "No admin withdraw" is only true once the contract account's keys are deleted after deployment. We should do that on mainnet and show it on the Security page.
