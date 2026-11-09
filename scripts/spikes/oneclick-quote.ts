// Phase 0 spike: can a 1Click swap deliver USDC to a NEAR contract with
// `ft_transfer_call` and our own `msg`?
//
// Sends two DRY quotes (no deposit address is issued, nothing can be spent):
//   A. plain delivery to a NEAR account (ft_transfer)
//   B. delivery with `customRecipientMsg` (ft_transfer_call)
//
// Run: node scripts/spikes/oneclick-quote.ts [recipient.near]
// Optional: ONECLICK_JWT in the environment.

const API = "https://1click.chaindefuser.com/v0";
const USDC_BASE = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

const recipient = process.argv[2] ?? "rota-spike.near";
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (process.env.ONECLICK_JWT) headers.Authorization = `Bearer ${process.env.ONECLICK_JWT}`;

async function quote(label: string, extra: Record<string, unknown>) {
  const body = {
    dry: true,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: USDC_BASE,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: USDC_NEAR,
    amount: "1000000", // exactly 1 USDC delivered, as a contribution must be exact
    refundTo: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", // example address from the 1Click OpenAPI spec; dry quotes never refund
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...extra,
  };
  const res = await fetch(`${API}/quote`, { method: "POST", headers, body: JSON.stringify(body) });
  const json = (await res.json()) as any;
  console.log(`\n== ${label}: HTTP ${res.status}`);
  if (!res.ok) return console.log(JSON.stringify(json, null, 2));
  const q = json.quote ?? {};
  console.log({
    amountIn: q.amountInFormatted,
    amountOut: q.amountOutFormatted,
    timeEstimateSec: q.timeEstimate,
    echoedMsg: json.quoteRequest?.customRecipientMsg,
  });
}

await quote("A. plain transfer", {});
await quote("B. ft_transfer_call with msg", {
  customRecipientMsg: JSON.stringify({ circle_id: "1", kind: "contribution", on_behalf_of: "alice.near" }),
});
