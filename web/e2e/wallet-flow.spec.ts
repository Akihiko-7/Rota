import { expect, test } from "@playwright/test";
import { verifyMessage } from "near-api-js/nep413";
import { JsonRpcProvider } from "near-api-js";
import { AMARA, BAO, connect, noSideScroll, pageAs, sign } from "./helpers";

test("a full circle on testnet: create, join, start, swap, pay, pay out, finish", async ({ browser }) => {
  const amara = await pageAs(browser, AMARA);
  await amara.goto("/new");
  await connect(amara);
  await amara.getByLabel("Name").fill(`E2E ${new Date().toISOString().slice(11, 19)}`);
  await amara.getByLabel("Other members' NEAR accounts").fill(BAO);
  await amara.getByLabel("Amount each member pays per round (USDC)").fill("1");
  await expect(amara.locator(".summary")).toHaveText("2 members each pay 1 USDC every 2 minutes. There are 2 rounds, and each member receives 2 USDC once.");
  // On success the app opens the new circle's page.
  await amara.getByRole("button", { name: "Create the circle" }).click();
  await amara.waitForURL(/\/c\/\d+$/, { timeout: 90_000 });
  const id = /\/c\/(\d+)$/.exec(amara.url())![1];
  test.info().annotations.push({ type: "circle", description: id });
  await expect(amara.locator(".chip")).toHaveText("Waiting to start");
  await sign(amara, "Join the circle");

  const bao = await pageAs(browser, BAO);
  await bao.goto(`/c/${id}`);
  await connect(bao);
  await sign(bao, "Join the circle");
  await sign(bao, "Start the circle");
  await expect(bao.locator(".round h2")).toHaveText("Round 1 of 2", { timeout: 60_000 });

  // Swap: amara (turn 1) asks bao (turn 2); nothing changes until bao accepts.
  await amara.reload();
  await amara.getByLabel("Member to swap with").selectOption(BAO);
  await sign(amara, "Ask bao to swap");
  await bao.reload();
  await expect(bao.getByText("amara (turn 1) wants to swap with you (turn 2).")).toBeVisible();
  await sign(bao, "Accept the swap");
  await expect(bao.locator(".order li").first()).toContainText("bao", { timeout: 30_000 });
  await expect(bao.locator(".round .big")).toHaveText("🎁 The pot goes to bao");

  // Cross-chain pay is shown, disabled and labelled, on testnet.
  await expect(bao.getByRole("button", { name: "Pay from another chain" })).toBeDisabled();
  await expect(bao.getByText("Mainnet only")).toBeVisible();
  expect(await noSideScroll(bao)).toBe(true);
  await bao.screenshot({ path: "test-results/round-1.png", fullPage: true });

  for (const round of [1, 2]) {
    for (const p of [bao, amara]) {
      await p.reload();
      await expect(p.locator(".round h2")).toHaveText(`Round ${round} of 2`, { timeout: 60_000 });
      await sign(p, "Pay 1 USDC now");
      await expect(p.getByText("You've paid this round.")).toBeVisible({ timeout: 30_000 });
    }
    // A successful payout moves the circle on, which replaces the button; check the result instead.
    await amara.reload();
    await amara.getByRole("button", { name: `Pay out round ${round} now` }).click();
    if (round === 1) await expect(amara.locator(".round h2")).toHaveText("Round 2 of 2", { timeout: 90_000 });
  }
  await expect(amara.locator(".chip")).toHaveText("Finished", { timeout: 90_000 });
  const paidOut = amara.locator(".rounds li");
  await expect(paidOut).toHaveCount(2);
  await expect(paidOut.nth(0)).toContainText("Round 1: bao received 2 USDC.");
  await expect(paidOut.nth(1)).toContainText("Round 2: amara received 2 USDC.");
  await amara.screenshot({ path: "test-results/finished.png", fullPage: true });
});

test("the /link page signs the bot's message with the member's wallet (NEP-413)", async ({ browser }) => {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  const amara = await pageAs(browser, AMARA);
  await amara.goto(`/link?${new URLSearchParams({ tg: "424242", account: AMARA, nonce })}`);
  await expect(amara.locator(".message")).toHaveText(`Link Telegram user 424242 to NEAR account ${AMARA} in Rota`);
  await amara.getByRole("button", { name: `Connect ${AMARA}` }).click();
  await amara.getByRole("button", { name: "Sign the message" }).click();
  const command = (await amara.locator("pre.command").innerText()).trim();
  const [, publicKey, signature] = command.split(" ");
  expect(command.startsWith("/verify ed25519:")).toBe(true);

  // The same check the bot runs: a valid signature by a full-access key of the account, on chain.
  await verifyMessage({
    signerAccountId: AMARA,
    signerPublicKey: publicKey,
    signature: Buffer.from(signature, "base64"),
    payload: { message: `Link Telegram user 424242 to NEAR account ${AMARA} in Rota`, recipient: "rota-bot", nonce: Buffer.from(nonce, "base64") },
    provider: new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" }),
  });

  // A wallet connected as someone else is told so instead of signing.
  const wrong = await pageAs(browser, AMARA);
  await wrong.goto(`/link?${new URLSearchParams({ tg: "424242", account: BAO, nonce })}`);
  await wrong.getByRole("button", { name: `Connect ${BAO}` }).click();
  await expect(wrong.getByText(`Your wallet is connected as ${AMARA}, but the link is for ${BAO}.`)).toBeVisible();
  await expect(wrong.getByRole("button", { name: "Sign the message" })).toHaveCount(0);
});
