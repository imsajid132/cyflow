/**
 * src/services/aiStudio/claudeClient.js
 *
 * Minimal, dependency-free client for Claude via an Anthropic-compatible endpoint
 * (default: AgentRouter). Server-side only — the key NEVER reaches the browser and
 * is NEVER logged. Reads config from env:
 *
 *   AI_API_KEY   required   sent as Bearer
 *   AI_BASE_URL  default "https://agentrouter.org" (no trailing /v1)
 *   AI_MODEL     default "claude-opus-4-8"
 *
 * Two jobs: design (text-out, an HTML poster) and vision (image-in, a caption).
 */

import { readAiConfigFile } from './aiConfigFile.js';

const DEFAULT_BASE = 'https://agentrouter.org';
const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * Read the first of several environment names that carries a value.
 *
 * WHY MORE THAN ONE NAME. The production host's control panel silently refuses
 * to store `AI_API_KEY` and `AI_STUDIO_MODE` — every other `AI_*` name in the
 * same list saves fine, these two vanish on save and are dropped even by a bulk
 * .env import, most likely because the host reserves them for its own AI
 * product. The app cannot win that argument, so it answers to a second,
 * host-safe name as well. `AI_*` remains the documented primary name and is what
 * local development and the tests use; `CYFLOW_STUDIO_*` exists so a machine
 * whose panel rejects the primary name can still be configured.
 */
function fromEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  /*
   * Nothing in the environment: fall back to the settings file. The production
   * host's control panel will not store these two values at all (see
   * aiConfigFile.js), so without this the feature cannot be turned on there.
   * Environment always wins — this only fills a gap.
   */
  const fromFile = readAiConfigFile();
  for (const name of names) {
    const value = fromFile[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** The key, under either accepted name. */
export function readApiKey() {
  return fromEnv('AI_API_KEY', 'CYFLOW_STUDIO_KEY');
}

export function isClaudeConfigured() {
  return Boolean(readApiKey());
}

function readConfig() {
  return {
    apiKey: readApiKey(),
    baseUrl: (fromEnv('AI_BASE_URL', 'CYFLOW_STUDIO_BASE_URL') || DEFAULT_BASE).replace(/\/+$/, ''),
    model: fromEnv('AI_MODEL', 'CYFLOW_STUDIO_MODEL') || DEFAULT_MODEL,
    // "anthropic" (Claude /v1/messages) or "openai" (GPT /v1/chat/completions).
    provider: (fromEnv('AI_PROVIDER', 'CYFLOW_STUDIO_PROVIDER') || 'anthropic').toLowerCase() === 'openai'
      ? 'openai'
      : 'anthropic',
  };
}

const AR_UA = 'claude-cli/1.0.0 (external, cli)';

/**
 * fetch with automatic retry on transient failures. AgentRouter (and any proxy)
 * intermittently returns 5xx / 429 / 504 or drops the connection; a daily post
 * must survive a flaky moment, so we retry with a short backoff. Non-5xx
 * responses (200, 4xx) return immediately so the caller handles them normally.
 */
async function fetchWithRetry(url, options, attempts = 4) {
  let lastRes = null;
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, options); // eslint-disable-line no-await-in-loop
      if (res.status < 500 && res.status !== 429) return res;
      lastRes = res;
    } catch (err) {
      lastErr = err;
    }
    // eslint-disable-next-line no-await-in-loop
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  if (lastRes) return lastRes;
  throw lastErr || new Error('AI request failed after retries');
}

/**
 * Single-turn multimodal prompt (system + one user message that may carry images).
 * Returns the model's text. Throws a safe Error on failure (never includes the key).
 *
 * @param {{ system:string, userText:string, images?:{mediaType:string,dataBase64:string}[], maxTokens?:number }} opts
 * @returns {Promise<string>}
 */
export async function askClaude({ system, userText, images = [], maxTokens = 4000 }) {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error('AI is not configured (missing AI_API_KEY).');
  if (cfg.provider === 'openai') return askOpenAI(cfg, { system, userText, images, maxTokens });
  return askAnthropic(cfg, { system, userText, images, maxTokens });
}

/** Anthropic Messages format (/v1/messages) — Claude models. */
async function askAnthropic(cfg, { system, userText, images, maxTokens }) {
  const content = [];
  for (const img of images) {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.dataBase64 } });
  }
  content.push({ type: 'text', text: userText });

  let res;
  try {
    res = await fetchWithRetry(`${cfg.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        'anthropic-version': '2023-06-01',
        'user-agent': AR_UA,
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
    });
  } catch {
    throw new Error('AI request failed (network).');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI request failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  const text = Array.isArray(data?.content)
    ? data.content.filter((b) => b?.type === 'text').map((b) => b.text || '').join('')
    : '';
  if (!text) throw new Error('AI returned an empty response.');
  return text;
}

/** OpenAI Chat Completions format (/v1/chat/completions) — GPT models (e.g. cheap gpt-4o-mini). */
async function askOpenAI(cfg, { system, userText, images, maxTokens }) {
  const userContent = [{ type: 'text', text: userText }];
  for (const img of images) {
    userContent.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.dataBase64}` } });
  }
  let res;
  try {
    res = await fetchWithRetry(`${cfg.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        'user-agent': AR_UA,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
    });
  } catch {
    throw new Error('AI request failed (network).');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI request failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('AI returned an empty response.');
  return text;
}

/** Strip code fences / stray prose so we're left with a raw HTML document. */
export function extractHtml(text) {
  let s = (text || '').trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/<!doctype html>|<html[\s>]/i);
  if (start > 0) s = s.slice(start);
  return s.trim();
}

/**
 * Pull the FIRST complete JSON object out of a model response, tolerating code
 * fences and any prose the model adds before or after (e.g. a stray "correcting
 * to..." note). Scans for balanced braces, string-aware, so trailing text can't
 * break the parse.
 */
export function parseJsonFromModel(text) {
  let s = (text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start === -1) throw new Error('No JSON object in the model response.');
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  // Fallback: first "{" to last "}".
  return JSON.parse(s.slice(start, s.lastIndexOf('}') + 1));
}
