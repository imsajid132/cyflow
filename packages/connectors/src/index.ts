import type { App } from "engine";
import { telegramApp } from "./telegram";
import { openaiApp } from "./openai";
import { gmailApp } from "./gmail";
import { sheetsApp } from "./sheets";
import { slackApp } from "./slack";

export { telegramApp } from "./telegram";
export { openaiApp } from "./openai";
export { gmailApp } from "./gmail";
export { sheetsApp } from "./sheets";
export { slackApp } from "./slack";

/**
 * All Cyflow connectors. The worker registers these into its engine registry
 * (they are not bundled into the browser). Telegram + OpenAI are
 * production-shaped; Gmail, Google Sheets, and Slack are scaffolds.
 */
export const connectorApps: App[] = [telegramApp, openaiApp, gmailApp, sheetsApp, slackApp];
