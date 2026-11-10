import { describe, expect, it } from "vitest";
import { KeyPair, KeyPairSigner } from "near-api-js";
import { every, list, parseUsdc, short, span, usdc } from "./format";
import { base64ToBytes, linkMessage, LINK_RECIPIENT, signatureBase64 } from "./link";
import { getQuote, NEAR_USDC_ASSET, ORIGINS, quoteRequest } from "./oneclick";
import { txs, validate } from "./rota";
import networks from "../generated/networks.json";

const tx = txs(networks.testnet);

describe("format", () => {
  it("shows and parses amounts", () => {
    expect(usdc("10000000")).toBe("10 USDC");
    expect(usdc(12_500_000n)).toBe("12.5 USDC");
    expect(parseUsdc("12.5")).toBe(12_500_000n);
    expect(() => parseUsdc("1.2345678")).toThrow(/up to 6 decimals/);
    expect(() => parseUsdc("-1")).toThrow();
  });
  it("writes names, lists and times in plain words", () => {
    expect(short("amara.rota-nearhack.testnet")).toBe("amara");
    expect(list(["a", "b", "c"])).toBe("a, b and c");
    expect(span(80_000)).toBe("1 min 20 s");
    expect(every(120)).toBe("2 minutes");
    expect(every(7 * 86400)).toBe("1 week");
  });
});

describe("link signing", () => {
  it("turns an ed25519:base58 signature into the same bytes in base64", async () => {
    const kp = KeyPair.fromRandom("ed25519");
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const signed = await new KeyPairSigner(kp).signNep413Message("amara.testnet", { message: linkMessage(1, "amara.testnet"), recipient: LINK_RECIPIENT, nonce });
    const b64 = btoa(String.fromCharCode(...signed.signature));
    const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = signed.signature.reduce((acc, b) => acc * 256n + BigInt(b), 0n);
    let b58 = "";
    while (n > 0n) {
      b58 = B58[Number(n % 58n)] + b58;
      n /= 58n;
    }
    for (const b of signed.signature) {
      if (b !== 0) break;
      b58 = `1${b58}`;
    }
    expect(signatureBase64(`ed25519:${b58}`)).toBe(b64);
    expect(signatureBase64(b64)).toBe(b64);
    expect([...base64ToBytes(b64)]).toEqual([...signed.signature]);
  });
});

describe("circle form", () => {
  const ok = { name: "Friends", members: ["a.testnet", "b.testnet"], contribution: 1n, roundSec: 60, graceSec: 0, bond: 0n };
  it("mirrors the contract's limits", () => {
    expect(validate(ok)).toBeUndefined();
    expect(validate({ ...ok, members: ["a.testnet"] })).toMatch(/2 to 10/);
    expect(validate({ ...ok, members: ["a.testnet", "a.testnet"] })).toMatch(/only be listed once/);
    expect(validate({ ...ok, roundSec: 59 })).toMatch(/at least 1 minute/);
    expect(validate({ ...ok, graceSec: 31 * 86400 })).toMatch(/at most 30 days/);
  });
  it("builds the same calls the tests and scripts use", () => {
    const pay = tx.pay("5", "contribution", "10000000");
    expect(pay.actions[0].params).toMatchObject({ methodName: "ft_transfer_call", deposit: "1", gas: "100000000000000" });
    expect(JSON.parse((pay.actions[0].params.args as { msg: string }).msg)).toEqual({ circle_id: "5", kind: "contribution" });
    expect(tx.create(ok).actions[0].params.deposit).toBe((10n ** 23n * 2n).toString());
    expect(tx.settle("5").actions[0].params).toMatchObject({ methodName: "settle", deposit: "0" });
  });
});

describe("networks", () => {
  it("mainnet uses real USDC and isn't live until the contract is deployed", () => {
    expect(networks.mainnet.tokenId).toBe("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
    expect(networks.mainnet.explorer).toBe("https://nearblocks.io");
    expect(() => txs(networks.mainnet).faucet("a.near", true)).toThrow(/only exists on testnet/);
    expect(txs(networks.testnet).pay("1", "contribution", "1").receiverId).toBe("usdc-mock.rota-nearhack.testnet");
  });
});

describe("cross-chain pay (1Click)", () => {
  const base = ORIGINS.find((o) => o.id === "base")!;
  const input = { origin: base, amount: 1_000_000n, recipient: "amara.near", refundTo: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", dry: false };
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("asks for an exact amount of USDC on NEAR, delivered to the member's own account", () => {
    const r = quoteRequest(input, Date.parse("2026-11-13T12:00:00Z"));
    expect(r).toMatchObject({
      swapType: "EXACT_OUTPUT",
      originAsset: base.assetId,
      destinationAsset: NEAR_USDC_ASSET,
      amount: "1000000",
      recipient: "amara.near",
      recipientType: "DESTINATION_CHAIN",
      refundTo: input.refundTo,
      refundType: "ORIGIN_CHAIN",
      deadline: "2026-11-13T12:20:00.000Z",
    });
    expect(r).not.toHaveProperty("customRecipientMsg");
    expect(NEAR_USDC_ASSET).toBe(`nep141:${networks.mainnet.tokenId}`);
  });
  it("checks the refund address and the quoted amount", async () => {
    await expect(getQuote({ ...input, refundTo: "amara.near" })).rejects.toThrow(/Base address/);
    const quote = { depositAddress: "0xabc", amountIn: "1010309", amountInFormatted: "1.010309", minAmountIn: "1000205", amountOut: "1000000", amountOutFormatted: "1.0", deadline: "", timeEstimate: 35 };
    await expect(getQuote(input, reply(201, { quote }))).resolves.toMatchObject({ depositAddress: "0xabc" });
    await expect(getQuote(input, reply(201, { quote: { ...quote, amountOut: "990000" } }))).rejects.toThrow(/different amount/);
    await expect(getQuote(input, reply(201, { quote: { ...quote, depositAddress: undefined } }))).rejects.toThrow(/deposit address/);
    await expect(getQuote(input, reply(400, { message: "recipient not found" }))).rejects.toThrow("NEAR Intents: recipient not found");
  });
  it("accepts each origin chain's address format", () => {
    expect(ORIGINS.find((o) => o.id === "sol")!.isAddress("9WL2A89YBr6X47ABKYNzPentWiBA3H8tpaiuf5CaYHx6")).toBe(true);
    expect(ORIGINS.find((o) => o.id === "sol")!.isAddress(input.refundTo)).toBe(false);
    expect(base.isAddress("0x2527d02599ba641c19fea793cd0f167589a0f10")).toBe(false);
  });
});
