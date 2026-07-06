import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, requireCredential } from "./util";

/**
 * X (Twitter) connector (production). Auth: OAuth2 token (bearer).
 * NOTE: reads work with an app-only bearer token; posting/deleting a tweet
 * requires an OAuth2 *user-context* token with tweet.write scope.
 */

const BASE = "https://api.twitter.com/2";
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "access_token"], "X");

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = (credentials.token ?? credentials.access_token) as string | undefined;
  if (!token) return { ok: false, message: "Missing access token." };
  try {
    await apiJson({ method: "GET", url: buildUrl(`${BASE}/users/by/username/x`, {}), headers: bearer(token) });
    return { ok: true, message: "Connected to X API" };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const twitterApp: App = {
  key: "twitter",
  name: "X (Twitter)",
  auth: { type: "api_key", fields: [{ key: "token", label: "OAuth2 token", type: "password", required: true }] },
  modules: {
    post_tweet: m("post_tweet", "Post a tweet", "action", z.object({ text: z.string(), replyToTweetId: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { text: string; replyToTweetId?: string };
      const body: Record<string, unknown> = { text: q.text };
      if (q.replyToTweetId) body.reply = { in_reply_to_tweet_id: q.replyToTweetId };
      const json = await apiJson<{ data?: { id: string; text: string } }>({ method: "POST", url: `${BASE}/tweets`, headers: bearer(tok(ctx)), body });
      return [(json.data ?? {}) as Bundle];
    }),
    delete_tweet: m("delete_tweet", "Delete a tweet", "action", z.object({ tweetId: z.string() }), async (_i, p, ctx) => {
      const { tweetId } = p as { tweetId: string };
      const json = await apiJson<{ data?: { deleted?: boolean } }>({ method: "DELETE", url: `${BASE}/tweets/${tweetId}`, headers: bearer(tok(ctx)) });
      return [{ deleted: json.data?.deleted ?? true, tweetId } as Bundle];
    }),
    get_tweet: m("get_tweet", "Get a tweet", "search", z.object({ tweetId: z.string(), tweetFields: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { tweetId: string; tweetFields?: string };
      const json = await apiJson<{ data?: Bundle }>({ method: "GET", url: buildUrl(`${BASE}/tweets/${q.tweetId}`, { "tweet.fields": q.tweetFields }), headers: bearer(tok(ctx)) });
      return [(json.data ?? {}) as Bundle];
    }),
    get_user_by_username: m("get_user_by_username", "Get a user by username", "search", z.object({ username: z.string() }), async (_i, p, ctx) => {
      const { username } = p as { username: string };
      const json = await apiJson<{ data?: Bundle }>({ method: "GET", url: `${BASE}/users/by/username/${encodeURIComponent(username)}`, headers: bearer(tok(ctx)) });
      return [(json.data ?? {}) as Bundle];
    }),
    search_recent: m("search_recent", "Search recent tweets", "search", z.object({ query: z.string(), maxResults: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { query: string; maxResults?: number };
      const json = await apiJson<{ data?: unknown[]; meta?: { result_count?: number } }>({ method: "GET", url: buildUrl(`${BASE}/tweets/search/recent`, { query: q.query, max_results: q.maxResults ?? 10 }), headers: bearer(tok(ctx)) });
      return [{ tweets: json.data ?? [], resultCount: json.meta?.result_count ?? 0 } as Bundle];
    }),
  },
  testConnection,
};
