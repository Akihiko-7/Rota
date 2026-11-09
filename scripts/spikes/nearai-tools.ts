// Phase 0 spike: does a NEAR AI Cloud model do OpenAI-style tool calling?
//
// 1. Lists models (public endpoint) and shows the ones that report `tools`.
// 2. Sends one question with a `get_circle_status` tool and expects a tool call.
// 3. Returns a fake tool result and expects a final answer that uses it.
// If step 2 yields no tool call, retries in JSON mode (the fallback plan).
//
// Run: NEARAI_API_KEY=... [NEARAI_MODEL=...] node scripts/spikes/nearai-tools.ts

const BASE = process.env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1";
const KEY = process.env.NEARAI_API_KEY;

const models = (await (await fetch(`${BASE}/models`)).json()) as any;
if (!models.data) throw new Error(`model list failed: ${JSON.stringify(models)}`);
const withTools = models.data.filter((m: any) => (m.supported_features ?? []).includes("tools"));
console.log(`${models.data.length} models, ${withTools.length} report tool support:`);
for (const m of withTools) console.log(`  ${m.id}  (${m.name ?? ""})`);

if (!KEY) {
  console.log("\nNEARAI_API_KEY not set; stopping after the model list.");
  process.exit(0);
}
const model = process.env.NEARAI_MODEL ?? withTools[0]?.id;
console.log(`\nUsing ${model}`);

const tools = [
  {
    type: "function",
    function: {
      name: "get_circle_status",
      description: "Read a savings circle's current round, who has paid, and the next recipient.",
      parameters: {
        type: "object",
        properties: { circle_id: { type: "string" } },
        required: ["circle_id"],
      },
    },
  },
];

async function chat(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 400, ...body }),
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const messages: any[] = [
  { role: "system", content: "You are the treasurer of a savings circle. Use tools to read state; never guess." },
  { role: "user", content: "Who still has to pay in circle 7?" },
];

const first = await chat({ messages, tools, tool_choice: "auto" });
const call = first.choices[0].message.tool_calls?.[0];
if (call) {
  console.log("tool call:", call.function.name, call.function.arguments);
  messages.push(first.choices[0].message, {
    role: "tool",
    tool_call_id: call.id,
    content: JSON.stringify({ round: 2, unpaid: ["bola.testnet"], next_recipient: "chidi.testnet" }),
  });
  const second = await chat({ messages, tools });
  console.log("final answer:", second.choices[0].message.content);
  console.log("RESULT: native tool calling works");
} else {
  console.log("no tool call; reply was:", first.choices[0].message.content);
  const json = await chat({
    messages: [
      ...messages.slice(0, 1),
      { role: "user", content: 'Reply only with JSON {"tool": "get_circle_status", "circle_id": "..."} for: Who still has to pay in circle 7?' },
    ],
    response_format: { type: "json_object" },
  });
  console.log("JSON mode reply:", json.choices[0].message.content);
  console.log("RESULT: fall back to JSON mode");
}
