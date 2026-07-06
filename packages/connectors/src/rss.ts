import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle } from "@cyflow/shared";

/** RSS / Atom connector (production, no auth). Fetches + parses a feed. */

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}
function tagOf(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeEntities(stripCdata(match[1].trim())) : undefined;
}
function linkOf(block: string): string | undefined {
  const rss = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (rss && rss[1].trim()) return decodeEntities(rss[1].trim());
  const atom = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return atom?.[1];
}

interface FeedItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  guid?: string;
}

export function parseFeed(xml: string): { title?: string; items: FeedItem[] } {
  const channelTitle = tagOf(xml.replace(/<item[\s\S]*/i, "").replace(/<entry[\s\S]*/i, ""), "title");
  const blocks = [...xml.matchAll(/<(item|entry)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  const items = blocks.map((b) => ({
    title: tagOf(b, "title"),
    link: linkOf(b),
    description: tagOf(b, "description") ?? tagOf(b, "summary") ?? tagOf(b, "content"),
    pubDate: tagOf(b, "pubDate") ?? tagOf(b, "published") ?? tagOf(b, "updated"),
    guid: tagOf(b, "guid") ?? tagOf(b, "id"),
  }));
  return { title: channelTitle, items };
}

const readFeed: ModuleDef["run"] = async (_i, params) => {
  const p = params as { url: string; limit?: number };
  const res = await fetch(p.url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const feed = parseFeed(xml);
  const items = typeof p.limit === "number" ? feed.items.slice(0, p.limit) : feed.items;
  return [{ title: feed.title, items, count: items.length } as Bundle];
};

export const rssApp: App = {
  key: "rss",
  name: "RSS",
  auth: { type: "none" },
  modules: {
    read_feed: {
      key: "read_feed",
      name: "Read a feed",
      kind: "search",
      params: z.object({ url: z.string(), limit: z.number().optional() }),
      run: readFeed,
    },
  },
};
