import { expect, test } from "@playwright/test";
import { noSideScroll, pageAs } from "./helpers";

test("anyone can check the proof and the finished demo circle without a wallet", async ({ browser }) => {
  const page = await pageAs(browser);
  await page.goto("/");
  const checks = page.locator(".checks li");
  await expect(checks).toHaveCount(3);
  await expect(checks.nth(0)).toContainText("✅Nobody holds a key to the circle contract");
  await expect(checks.nth(1)).toContainText("✅The code it runs is exactly the code published in our repository");
  await expect(checks.nth(2)).toContainText("✅The AI treasurer holds exactly one key");
  await checks.nth(2).locator("summary").click();
  await expect(checks.nth(2).locator("pre")).toContainText("can only call [settle] on circle-v2.rota-nearhack.testnet, allowance unlimited");

  const demo = page.locator(".demo");
  await expect(demo.locator(".rounds li")).toHaveCount(4);
  await expect(demo).toContainText("Round 2: amara received 40 USDC.");
  await expect(demo).toContainText("dara didn't pay. 10 USDC was taken from their deposit");
  await expect(demo.getByRole("link", { name: /Payout transaction/ })).toHaveCount(4);
  await expect(page.getByText("No AI runs on this website.")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.screenshot({ path: "test-results/home.png", fullPage: true });

  await demo.getByRole("link", { name: "Open circle 5" }).click();
  await expect(page.locator(".chip")).toHaveText("Finished");
  await expect(page.locator(".order li")).toHaveCount(4);
  expect(await noSideScroll(page)).toBe(true);
  await page.screenshot({ path: "test-results/circle-5.png", fullPage: true });
});
