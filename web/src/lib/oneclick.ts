// Paying a round with USDC from another chain, through NEAR Intents' 1Click
// API (https://docs.near-intents.org/near-intents/1click-api). Two steps, as
// decided in docs/PHASE0.md: 1Click delivers USDC on NEAR to the member's own
// account, then the member pays the circle with the usual `ft_transfer_call`.
// Mainnet only: 1Click has no testnet. No API key: unauthenticated quotes
// work and cost a 0.2% fee, and a key in this page would be public.

export const ONECLICK_API = "https://1click.chaindefuser.com/v0";

/** Circle's native USDC on NEAR, as 1Click names it. */
export const NEAR_USDC_ASSET = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export interface Origin {
  id: string;
  label: string;
  /** 1Click asset id of USDC on that chain (from GET /v0/tokens). */
  assetId: string;
  /** The chain's own coin, needed for the transfer fee. */
  gasCoin: string;
  addressHint: string;
  isAddress: (a: string) => boolean;
}

const evm = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const solana = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);

export const ORIGINS: Origin[] = [
  { id: "base", label: "Base", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", gasCoin: "ETH", addressHint: "0x…", isAddress: evm },
  { id: "arb", label: "Arbitrum", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", gasCoin: "ETH", addressHint: "0x…", isAddress: evm },
  { id: "sol", label: "Solana", assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", gasCoin: "SOL", addressHint: "your Solana address", isAddress: solana },
  { id: "pol", label: "Polygon", assetId: "nep141:pol-0x3c499c542cef5e3811e1192ce70d8cc03d5c3359.omdep.near", gasCoin: "POL", addressHint: "0x…", isAddress: evm },
  { id: "eth", label: "Ethereum", assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", gasCoin: "ETH (fees are high)", addressHint: "0x…", isAddress: evm },
];

export interface Quote {
  depositAddress: string;
  amountIn: string;
  amountInFormatted: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  deadline: string;
  timeEstimate: number;
}

export type SwapStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

export interface StatusResponse {
  status: SwapStatus;
  updatedAt: string;
  swapDetails?: {
    destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
    originChainTxHashes?: { hash: string; explorerUrl: string }[];
    refundedAmountFormatted?: string;
    refundReason?: string;
  };
}

/** What a member sees for each status, in plain words. */
export const STATUS_TEXT: Record<SwapStatus, string> = {
  PENDING_DEPOSIT: "Waiting for your deposit on the other chain.",
  KNOWN_DEPOSIT_TX: "Your deposit was seen. Waiting for it to confirm.",
  PROCESSING: "Swapping into USDC on NEAR.",
  SUCCESS: "Done: the USDC is in your NEAR account. Press Pay.",
  INCOMPLETE_DEPOSIT: "The deposit was less than the amount shown. It will be refunded to your address after the deadline.",
  REFUNDED: "The swap didn't go through, and your deposit was refunded to your address on the other chain.",
  FAILED: "The swap failed. If your deposit went through, NEAR Intents refunds it to your address on the other chain.",
};

export const isFinal = (s: SwapStatus) => s === "SUCCESS" || s === "REFUNDED" || s === "FAILED";

export interface QuoteInput {
  origin: Origin;
  /** USDC on NEAR to deliver, in its 6-decimal units. */
  amount: bigint;
  /** The member's NEAR account. It must be registered with the USDC contract. */
  recipient: string;
  /** The member's own address on the origin chain, for refunds. */
  refundTo: string;
  /** Real quotes get a deposit address; dry ones only price the swap. */
  dry: boolean;
  /** How long the deposit address stays valid. */
  validForMs?: number;
}

/** The POST /v0/quote body: an exact amount out, so the round's payment is exact. */
export function quoteRequest(q: QuoteInput, now = Date.now()) {
  return {
    dry: q.dry,
    depositMode: "SIMPLE",
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: q.origin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR_USDC_ASSET,
    amount: q.amount.toString(),
    refundTo: q.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: q.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now + (q.validForMs ?? 20 * 60_000)).toISOString(),
    referral: "rota",
  };
}

async function call<T>(path: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  const res = await fetcher(`${ONECLICK_API}${path}`, init);
  const body = (await res.json().catch(() => ({}))) as { message?: string } & T;
  if (!res.ok) throw new Error(`NEAR Intents: ${body.message ?? `HTTP ${res.status}`}`);
  return body;
}

export async function getQuote(q: QuoteInput, fetcher: typeof fetch = fetch): Promise<Quote> {
  if (!q.origin.isAddress(q.refundTo)) throw new Error(`That doesn't look like a ${q.origin.label} address.`);
  if (q.amount <= 0n) throw new Error("Nothing to swap.");
  const body = await call<{ quote: Quote }>(
    "/quote",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(quoteRequest(q)) },
    fetcher,
  );
  if (BigInt(body.quote.amountOut) !== q.amount) throw new Error("NEAR Intents quoted a different amount. Try again.");
  if (!q.dry && !body.quote.depositAddress) throw new Error("NEAR Intents didn't return a deposit address. Try again.");
  return body.quote;
}

export function getStatus(depositAddress: string, fetcher: typeof fetch = fetch): Promise<StatusResponse> {
  return call<StatusResponse>(`/status?depositAddress=${encodeURIComponent(depositAddress)}`, undefined, fetcher);
}
