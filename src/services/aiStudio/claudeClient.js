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

const DEFAULT_BASE = 'https://agentrouter.org';
const DEFAULT_MODEL = 'claude-opus-4-8';

export function isClaudeConfigured() {
  return Boolean(process.env.AI_API_KEY);
}

function readConfig() {
  return {
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: (process.env.AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, ''),
    model: process.env.AI_MODEL || DEFAULT_MODEL,
    // "anthropic" (Claude /v1/messages) or "openai" (GPT /v1/chat/completions).
    provider: (process.env.AI_PROVIDER || 'anthropic').toLowerCase() === 'openai' ? 'openai' : 'anthropic',
  };
}

const AR_UA = 'claude-cli/1.0.0 (external, cli)';

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
    res = await fetch(`${cfg.baseUrl}/v1/messages`, {
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
    res = await fetch(`${cfg.baseUrl}/v1/chat/completions`, {
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
