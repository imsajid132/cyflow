#!/usr/bin/env node
/**
 * Cyflow personal-production smoke test. Hits a DEPLOYED API and exercises the
 * full path: health → connections (vault + redaction) → scenario → run once →
 * execution history/replay → public webhook. It creates real records against
 * your API; run it after a fresh deploy.
 *
 *   API_URL=https://cyflow-api.onrender.com \
 *   ADMIN_TOKEN=<your token> \
 *   node scripts/smoke-test.mjs
 *
 * Optional real creds make the OpenAI/Telegram steps actually send:
 *   OPENAI_KEY=sk-...  TELEGRAM_TOKEN=123:abc  TELEGRAM_CHAT_ID=@you
 */
const API = (process.env.API_URL || process.argv[2] || "").replace(/\/$/, "");
const TOKEN = process.env.ADMIN_TOKEN || process.argv[3] || "";
if (!API) {
  console.error("Usage: API_URL=https://... ADMIN_TOKEN=... node scripts/smoke-test.mjs");
  process.exit(2);
}

const H = { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) };
let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  cond ? pass++ : fail++;
  return cond;
};
async function call(method, path, body, headers = H) {
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

console.log(`\nCyflow smoke test → ${API}\n`);

// 1. Health + config status
console.log("[1] Health");
const health = await call("GET", "/health");
ok(health.status === 200, "GET /health → 200");
const cfg = health.data.config ?? {};
ok(cfg.vault === true, `vault configured (${cfg.vault})`);
ok(cfg.database === true, `database connected (${cfg.database})`);
ok(cfg.persistence === "postgres", `persistence = ${cfg.persistence}`);
console.log(`    redis=${cfg.redis} adminProtected=${cfg.adminProtected} oauth=${JSON.stringify(cfg.oauth)} webhookBase=${cfg.webhookBaseUrl}`);

// 2. Connections — api key (Telegram) + bearer (OpenAI); verify creation
console.log("[2] Connections (create + vault)");
const tg = await call("POST", "/connections", { appKey: "telegram", name: "Smoke Telegram", credentials: { token: process.env.TELEGRAM_TOKEN || "123456:placeholder" } });
ok(tg.status < 300 && tg.data.id, `created Telegram connection (${tg.data.id})`);
const oa = await call("POST", "/connections", { appKey: "openai", name: "Smoke OpenAI", credentials: { token: process.env.OPENAI_KEY || "sk-placeholder" } });
ok(oa.status < 300 && oa.data.id, `created OpenAI connection (${oa.data.id})`);

// 3. Redaction — the list must never contain secret values
console.log("[3] Redaction");
const list = await call("GET", "/connections");
const listStr = JSON.stringify(list.data);
ok(Array.isArray(list.data) && list.data.length >= 2, `list returns ${list.data.length ?? 0} connections`);
ok(!listStr.includes("placeholder") && !/"token"|"credentials"|"secret"/i.test(listStr), "no token/credential/secret in the connections list");

// 4. Scenario: Webhook → OpenAI → Telegram
console.log("[4] Scenario (Webhook → OpenAI → Telegram)");
const blueprint = {
  modules: [
    { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
    { id: "2", app: "openai", operation: "create_completion", kind: "action", params: { model: "gpt-4o-mini", prompt: "Say hi to {{1.body.name}}" }, connectionId: oa.data.id, next: "3" },
    { id: "3", app: "telegram", operation: "send_message", kind: "action", params: { chatId: process.env.TELEGRAM_CHAT_ID || "123", text: "{{2.content}}" }, connectionId: tg.data.id, next: null },
  ],
};
const scn = await call("POST", "/scenarios", { name: "Smoke: Webhook → OpenAI → Telegram", status: "ACTIVE", schedule: { type: "manual" }, blueprint });
const scenarioId = scn.data.id;
ok(scn.status < 300 && scenarioId, `created scenario (${scenarioId})`);

// 5. Run once → execution recorded with steps (drives replay)
console.log("[5] Run once + history + replay");
const run = await call("POST", `/scenarios/${scenarioId}/run-once`, { blueprint });
const exec = run.data.execution ?? run.data;
ok(run.status < 300 && exec?.id, `run-once returned an execution (${exec?.id}, status=${exec?.status})`);
ok(Array.isArray(exec?.steps) && exec.steps.length >= 1, `execution has ${exec?.steps?.length ?? 0} steps (replay data)`);
console.log(`    (a placeholder OpenAI/Telegram key makes step 2/3 fail — the execution is still recorded; pass real creds to send for real)`);
const execs = await call("GET", "/executions");
ok(Array.isArray(execs.data) && execs.data.some((e) => (e.execution?.id ?? e.id) === exec?.id), "execution appears in history");

// 6. Public webhook — POST /hooks/:id runs the scenario (no admin token needed)
console.log("[6] Public webhook");
const webhookBase = cfg.webhookBaseUrl || `${API}/hooks`;
console.log(`    webhook URL: ${webhookBase}/${scenarioId}`);
const hook = await call("POST", `/hooks/${scenarioId}`, { name: "Ada" }, { "content-type": "application/json" });
ok(hook.status === 202 || hook.status === 200, `POST /hooks/${scenarioId} accepted (${hook.status})`);

console.log(`\n${fail === 0 ? "✅ SMOKE TEST PASSED" : `❌ ${fail} check(s) failed`} — ${pass} passed, ${fail} failed.\n`);
process.exit(fail === 0 ? 0 : 1);
