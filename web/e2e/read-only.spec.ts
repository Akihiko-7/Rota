import { expect, test } from "@playwright/test";
import { noSideScroll, pageAs } from "./helpers";

test("anyone can check the proof and the finished demo circle without a wallet", async ({ browser }) => {
  const page = await pageAs(browser);
  await page.goto("/testnet");
  const checks = page.locator(".checks li");
  await expect(checks).toHaveCount(3);
  await expect(checks.nth(0)).toContainText("Nobody holds a key to the circle contract");
  await expect(checks.nth(1)).toContainText("The code it runs is exactly the code published in our repository");
  await expect(checks.nth(2)).toContainText("The AI treasurer holds exactly one key");
  await expect(page.locator(".checks .mark.yes")).toHaveCount(3);
  await checks.nth(2).locator("summary").click();
  await expect(checks.nth(2).locator("pre")).toContainText("can only call [settle] on circle-v2.rota-nearhack.testnet, allowance unlimited");

  const demo = page.locator(".demo");
  await expect(demo.locator(".rounds li")).toHaveCount(4);
  await expect(demo).toContainText("Round 2: amara received 40 USDC.");
  await expect(demo).toContainText("dara didn't pay. 10 USDC was taken from their deposit");
  await expect(demo.getByRole("link", { name: /Payout transaction/ })).toHaveCount(4);
  await expect(page.getByText("No AI runs on this website.")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);

  await demo.getByRole("link", { name: "Open circle 5" }).click();
  await expect(page).toHaveURL(/\/testnet\/c\/5$/);
  await expect(page.locator(".chip")).toHaveText("Finished");
  await expect(page.locator(".order li")).toHaveCount(4);
  expect(await noSideScroll(page)).toBe(true);
});

test("the network switch changes everything, warns once before real money, and is remembered", async ({ browser }) => {
  const page = await pageAs(browser);
  await page.goto("/c/5");
  await expect(page).toHaveURL(/\/testnet\/c\/5$/, { timeout: 10_000 });
  await expect(page.getByRole("button", { name: /Testnet/ })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /Mainnet/ }).click();
  const warning = page.getByRole("dialog");
  await expect(warning).toContainText("You're switching to real money");
  await warning.getByRole("button", { name: "Stay on testnet" }).click();
  await expect(page).toHaveURL(/\/testnet\/c\/5$/);

  await page.getByRole("button", { name: /Mainnet/ }).click();
  await page.getByRole("button", { name: "I understand, switch to mainnet" }).click();
  await expect(page).toHaveURL(/\/mainnet\/c\/5$/);
  await expect(page.locator(".banner")).toContainText("Mainnet is launching soon");
  await expect(page.getByRole("heading", { name: "Launching soon on mainnet" })).toBeVisible();

  await page.goto("/mainnet");
  await expect(page.locator(".proof")).toContainText("These checks will run live against the mainnet contract once it's deployed");
  await expect(page.locator(".checks")).toHaveCount(0);
  await page.goto("/mainnet/new");
  await expect(page.getByRole("heading", { name: "Launching soon on mainnet" })).toBeVisible();

  // Remembered, and no second warning.
  await page.goto("/");
  await expect(page).toHaveURL(/\/mainnet$/);
  await page.getByRole("button", { name: /Testnet/ }).click();
  await page.getByRole("button", { name: /Mainnet/ }).click();
  await expect(page).toHaveURL(/\/mainnet$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("tutorials and payment records, at phone, tablet and desktop widths", async ({ browser }) => {
  for (const [width, height] of [
    [390, 844],
    [820, 1180],
    [1440, 900],
  ]) {
    const context = await browser.newContext({ baseURL: "http://localhost:5199", viewport: { width, height } });
    await context.addInitScript(() => localStorage.setItem("rota-mainnet-warning-seen", "1"));
    const page = await context.newPage();

    await page.goto("/testnet/start");
    await expect(page.getByRole("heading", { name: "Try Rota for free" })).toBeVisible();
    await expect(page.getByRole("link", { name: "NEAR testnet faucet" }).first()).toHaveAttribute("href", "https://docs.near.org/getting-started/faucet");
    expect(await noSideScroll(page), `testnet start at ${width}`).toBe(true);

    await page.goto("/mainnet/start");
    await expect(page.getByRole("heading", { name: "Get started with Rota" })).toBeVisible();
    await expect(page.getByText("Never share your secret phrase")).toBeVisible();
    expect(await noSideScroll(page), `mainnet start at ${width}`).toBe(true);

    await page.goto("/testnet/rep/dara.rota-nearhack.testnet");
    await expect(page.getByRole("heading", { name: "dara" })).toBeVisible();
    await expect(page.locator(".stats div").filter({ hasText: "Defaults" }).locator("dd")).not.toHaveText("0");
    expect(await noSideScroll(page), `record at ${width}`).toBe(true);

    await page.goto("/testnet");
    await expect(page.locator(".checks li")).toHaveCount(3);
    expect(await noSideScroll(page), `home at ${width}`).toBe(true);
    await page.screenshot({ path: `test-results/home-${width}.png`, fullPage: true });
    await context.close();
  }
});
