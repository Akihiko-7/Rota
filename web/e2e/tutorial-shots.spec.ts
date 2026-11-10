// Captures the screenshots used on the tutorial pages (public/tutorial/).
// Creates one small test circle on testnet. Run: SHOTS=1 npx playwright test tutorial-shots
import { expect, test, type Page } from "@playwright/test";
import { AMARA, BAO, connect, pageAs, sign } from "./helpers";

const OUT = "public/tutorial";

async function shoot(page: Page, selector: string, name: string) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: `${OUT}/${name}` });
}

test("tutorial screenshots", async ({ browser }) => {
  const amara = await pageAs(browser, AMARA);
  await amara.setViewportSize({ width: 1100, height: 900 });
  await amara.goto("/testnet/start");
  await connect(amara);
  await expect(amara.locator(".testwallet dd").nth(1)).not.toHaveText("…");
  await shoot(amara, ".testwallet", "test-wallet.png");

  await amara.goto("/testnet/new");
  await amara.getByLabel("Name").fill("Friday friends");
  await amara.getByLabel("Other members' NEAR accounts").fill(BAO);
  await amara.getByLabel(/Amount each member pays per round/).fill("5");
  await amara.getByLabel("Deposit for an early turn (USDC, 0 for none)").fill("5");
  await shoot(amara, ".form-grid", "new-circle.png");
  await amara.getByRole("button", { name: "Create the circle" }).click();
  await amara.waitForURL(/\/testnet\/c\/\d+$/, { timeout: 90_000 });
  const id = /\/c\/(\d+)$/.exec(amara.url())![1];

  const bao = await pageAs(browser, BAO);
  await bao.setViewportSize({ width: 1100, height: 900 });
  await bao.goto(`/testnet/c/${id}`);
  await connect(bao);
  await expect(bao.getByRole("button", { name: "Join the circle" })).toBeVisible();
  await shoot(bao, ".dash-main .card", "join.png");
  await sign(bao, "Join the circle");
  await sign(amara, "Join the circle");
  await sign(amara, "Start the circle");
  await bao.reload();
  await expect(bao.locator(".round h2")).toHaveText("Round 1 of 2", { timeout: 60_000 });
  await shoot(bao, ".round", "pay.png");

  await bao.goto("/testnet/c/5");
  await expect(bao.locator(".rounds .note")).toBeVisible();
  await shoot(bao, ".dash-main .card", "missed.png");

  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
  await amara.goto(`/testnet/link?${new URLSearchParams({ tg: "424242", account: AMARA, nonce })}`);
  await amara.getByRole("button", { name: "Sign the message" }).click();
  await expect(amara.locator("pre.command")).toBeVisible();
  await shoot(amara, "main .card", "link.png");
});

test("wallet chooser screenshots (NEAR Connect, no test signer)", async ({ browser }) => {
  // The dev server for e2e uses the test signer, so this one opens the production build.
  test.skip(!process.env.PREVIEW_URL, "set PREVIEW_URL to a production build");
  for (const [net, name] of [
    ["testnet", "wallet-choice-testnet.png"],
    ["mainnet", "wallet-choice.png"],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("rota-mainnet-warning-seen", "1"));
    const page = await context.newPage();
    await page.goto(`${process.env.PREVIEW_URL}/${net}`);
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/${name}` });
    await context.close();
  }
});
