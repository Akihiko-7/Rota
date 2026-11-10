import { describe, expect, it } from "vitest";
import { KeyPair, KeyPairSigner } from "near-api-js";
import { every, list, parseUsdc, short, span, usdc } from "./format";
import { base64ToBytes, linkMessage, LINK_RECIPIENT, signatureBase64 } from "./link";
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
