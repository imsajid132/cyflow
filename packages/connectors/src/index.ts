import type { App } from "engine";
import { telegramApp } from "./telegram";
import { openaiApp } from "./openai";
import { gmailApp } from "./gmail";
import { sheetsApp } from "./sheets";
import { driveApp } from "./drive";
import { calendarApp } from "./calendar";
import { slackApp } from "./slack";
import { discordApp } from "./discord";
import { notionApp } from "./notion";
import { airtableApp } from "./airtable";
import { githubApp } from "./github";
import { gitlabApp } from "./gitlab";
import { dropboxApp } from "./dropbox";
import { cloudflareApp } from "./cloudflare";
import { supabaseApp } from "./supabase";
import { trelloApp } from "./trello";
import { asanaApp } from "./asana";
import { hubspotApp } from "./hubspot";
import { clickupApp } from "./clickup";
import { calendlyApp } from "./calendly";
import { twilioApp } from "./twilio";
import { stripeApp } from "./stripe";
import { shopifyApp } from "./shopify";
import { woocommerceApp } from "./woocommerce";
import { rssApp } from "./rss";
import { whatsappApp } from "./whatsapp";
import { twitterApp } from "./twitter";
import { utilsApp } from "./utils";

export { telegramApp } from "./telegram";
export { openaiApp } from "./openai";
export { gmailApp } from "./gmail";
export { sheetsApp } from "./sheets";
export { driveApp } from "./drive";
export { calendarApp } from "./calendar";
export { slackApp } from "./slack";
export { discordApp } from "./discord";
export { notionApp } from "./notion";
export { airtableApp } from "./airtable";
export { githubApp } from "./github";
export { gitlabApp } from "./gitlab";
export { dropboxApp } from "./dropbox";
export { cloudflareApp } from "./cloudflare";
export { supabaseApp } from "./supabase";
export { trelloApp } from "./trello";
export { asanaApp } from "./asana";
export { hubspotApp } from "./hubspot";
export { clickupApp } from "./clickup";
export { calendlyApp } from "./calendly";
export { twilioApp } from "./twilio";
export { stripeApp } from "./stripe";
export { shopifyApp } from "./shopify";
export { woocommerceApp } from "./woocommerce";
export { rssApp, parseFeed } from "./rss";
export { whatsappApp } from "./whatsapp";
export { twitterApp } from "./twitter";
export { utilsApp, parseCsv, toCsv } from "./utils";

/**
 * All Cyflow connectors registered into the engine registry (API + worker).
 * Telegram is a full production Bot API; OpenAI/Slack make real calls + support
 * test-connection; Gmail/Sheets/Drive/Calendar run on real Google OAuth (Phase
 * B); JSON/CSV utilities are pure transforms. See CONNECTOR-AUDIT.md.
 */
export const connectorApps: App[] = [
  telegramApp,
  openaiApp,
  gmailApp,
  sheetsApp,
  driveApp,
  calendarApp,
  slackApp,
  discordApp,
  notionApp,
  airtableApp,
  githubApp,
  gitlabApp,
  dropboxApp,
  cloudflareApp,
  supabaseApp,
  trelloApp,
  asanaApp,
  hubspotApp,
  clickupApp,
  calendlyApp,
  twilioApp,
  stripeApp,
  shopifyApp,
  woocommerceApp,
  rssApp,
  whatsappApp,
  twitterApp,
  utilsApp,
];
