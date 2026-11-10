import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against NEAR testnet, in the installed Chrome at phone size.
// Wallet actions use the test-only dev signer (VITE_DEV_SIGNER=1) with the demo
// members' keys from ../credentials/testnet.json; nothing here is deployed.
export default defineConfig({
  testDir: "e2e",
  timeout: 8 * 60_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { ...devices["Pixel 7"], channel: "chrome", baseURL: "http://localhost:5199", trace: "retain-on-failure" },
  webServer: {
    command: "npx vite --port 5199 --strictPort",
    env: { VITE_DEV_SIGNER: "1", E2E: "1" },
    url: "http://localhost:5199",
    reuseExistingServer: false,
  },
});
