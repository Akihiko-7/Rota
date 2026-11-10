import { readFileSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";

const keys = JSON.parse(readFileSync(new URL("../../credentials/testnet.json", import.meta.url), "utf8")) as Record<string, string>;
export const AMARA = "amara.rota-nearhack.testnet";
export const BAO = "bao.rota-nearhack.testnet";

/** A fresh phone-sized page whose dev signer holds `accountId`'s testnet key (or no key). */
export async function pageAs(browser: Browser, accountId?: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:5199", viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  if (accountId) {
    await context.addInitScript((dev) => {
      (window as unknown as { __ROTA_DEV_SIGNER__: unknown }).__ROTA_DEV_SIGNER__ = dev;
    }, { accountId, privateKey: keys[accountId] });
  }
  return context.newPage();
}

export async function connect(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.locator(".pill").waitFor();
}

/** Clicks a transaction button and waits for the page's result notice; throws if it reports an error. */
export async function sign(page: Page, name: string | RegExp): Promise<void> {
  const notice = page.locator(".notice");
  const before = Number((await notice.getAttribute("data-seq", { timeout: 1 }).catch(() => null)) ?? 0);
  await page.getByRole("button", { name }).click();
  await expect(notice).toHaveAttribute("data-seq", String(before + 1), { timeout: 90_000 });
  if (await notice.evaluate((n) => n.classList.contains("bad"))) throw new Error(`${name}: ${await notice.innerText()}`);
}

export async function noSideScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}
