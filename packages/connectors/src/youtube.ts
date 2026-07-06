import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { accessToken, gapi, googleTestConnection, withQuery } from "./google-common";

/** YouTube connector (production, Data API v3). Auth: Google OAuth2. */

const BASE = "https://www.googleapis.com/youtube/v3";
const tok = (ctx: ExecutionContext) => accessToken(ctx, "YouTube");

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

export const youtubeApp: App = {
  key: "youtube",
  name: "YouTube",
  auth: { type: "oauth2" },
  modules: {
    search: m("search", "Search", "search", z.object({ query: z.string(), type: z.string().optional(), maxResults: z.number().optional(), pageToken: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { query: string; type?: string; maxResults?: number; pageToken?: string };
      const json = await gapi<{ items?: unknown[]; nextPageToken?: string }>({ method: "GET", url: withQuery(`${BASE}/search`, { part: "snippet", q: q.query, type: q.type ?? "video", maxResults: q.maxResults ?? 10, pageToken: q.pageToken }), token: tok(ctx) });
      return [{ items: json.items ?? [], nextPageToken: json.nextPageToken } as Bundle];
    }),
    get_video: m("get_video", "Get a video", "search", z.object({ videoId: z.string() }), async (_i, p, ctx) => {
      const { videoId } = p as { videoId: string };
      const json = await gapi<{ items?: unknown[] }>({ method: "GET", url: withQuery(`${BASE}/videos`, { part: "snippet,statistics,contentDetails", id: videoId }), token: tok(ctx) });
      return [{ video: (json.items ?? [])[0] } as Bundle];
    }),
    get_channel: m("get_channel", "Get a channel", "search", z.object({ channelId: z.string().optional(), forUsername: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { channelId?: string; forUsername?: string };
      const json = await gapi<{ items?: unknown[] }>({ method: "GET", url: withQuery(`${BASE}/channels`, { part: "snippet,statistics", id: q.channelId, forUsername: q.forUsername }), token: tok(ctx) });
      return [{ channel: (json.items ?? [])[0] } as Bundle];
    }),
    list_my_playlists: m("list_my_playlists", "List my playlists", "search", z.object({ maxResults: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { maxResults?: number };
      const json = await gapi<{ items?: unknown[] }>({ method: "GET", url: withQuery(`${BASE}/playlists`, { part: "snippet,contentDetails", mine: "true", maxResults: q.maxResults ?? 25 }), token: tok(ctx) });
      return [{ playlists: json.items ?? [] } as Bundle];
    }),
    list_playlist_items: m("list_playlist_items", "List playlist items", "search", z.object({ playlistId: z.string(), maxResults: z.number().optional(), pageToken: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { playlistId: string; maxResults?: number; pageToken?: string };
      const json = await gapi<{ items?: unknown[]; nextPageToken?: string }>({ method: "GET", url: withQuery(`${BASE}/playlistItems`, { part: "snippet,contentDetails", playlistId: q.playlistId, maxResults: q.maxResults ?? 25, pageToken: q.pageToken }), token: tok(ctx) });
      return [{ items: json.items ?? [], nextPageToken: json.nextPageToken } as Bundle];
    }),
  },
  testConnection: googleTestConnection,
};
