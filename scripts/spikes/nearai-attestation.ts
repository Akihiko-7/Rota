// Phase 0 spike: fetch the NEAR AI Cloud attestation report for a model.
//
// Public endpoint, no API key needed. Follows
// https://docs.near.ai/cloud/verification/cloud-api/model-attestations.md:
// fresh nonce, provider=near, x-no-aliasing so the model ID is not rewritten.
//
// This only checks the nonce echo and prints the evidence. Full verification
// (Intel DCAP quote, RTMR3 event-log replay, app_compose hash, GPU evidence)
// is done by @nearai/inference-sdk or the NEAR AI Verification Center.
//
// Run: node scripts/spikes/nearai-attestation.ts <model-id>

import { randomBytes } from "node:crypto";

const BASE = process.env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1";
const model = process.argv[2] ?? process.env.NEARAI_MODEL;
if (!model) throw new Error("usage: node scripts/spikes/nearai-attestation.ts <model-id>");

const nonce = randomBytes(32).toString("hex");
const url = new URL(`${BASE}/attestation/report`);
url.search = new URLSearchParams({
  model,
  provider: "near",
  include_tls_fingerprint: "false",
  signing_algo: "ecdsa",
  nonce,
}).toString();

const res = await fetch(url, { headers: { Accept: "application/json", "x-no-aliasing": "true" } });
const report = (await res.json()) as any;
if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(report)}`);

const gw = report.gateway_attestation;
console.log("gateway signer:", gw?.signing_address, gw?.signing_algo);
console.log("gateway app:", gw?.info?.app_name, "compose_hash", gw?.info?.compose_hash);

const candidates: any[] = report.model_attestations ?? [];
console.log(`\n${candidates.length} model attestation candidate(s) for ${model}`);
for (const c of candidates) {
  console.log({
    signing_address: c.signing_address,
    signing_algo: c.signing_algo,
    nonce_echoed: c.request_nonce === nonce,
    has_intel_quote: Boolean(c.intel_quote),
    has_gpu_evidence: Boolean(c.nvidia_payload),
  });
}
if (candidates.length === 0) console.log("No NEAR model evidence: treat this model as unverified.");
