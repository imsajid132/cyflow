import type { App } from "engine";
import { telegramApp } from "./telegram";
import { openaiApp } from "./openai";
import { gmailApp } from "./gmail";
import { sheetsApp } from "./sheets";
import { slackApp } from "./slack";
import { utilsApp } from "./utils";

export { telegramApp } from "./telegram";
export { openaiApp } from "./openai";
export { gmailApp } from "./gmail";
export { sheetsApp } from "./sheets";
export { slackApp } from "./slack";
export { utilsApp, parseCsv, toCsv } from "./utils";

/**
 * All Cyflow connectors registered into the engine registry (API + worker).
 * Telegram is a full production Bot API; OpenAI/Slack make real calls + support
 * test-connection; JSON/CSV utilities are pure transforms. Gmail/Sheets are
 * OAuth apps pending the Phase B auth flow. See CONNECTOR-AUDIT.md.
 */
export const connectorApps: App[] = [telegramApp, openaiApp, gmailApp, sheetsApp, slackApp, utilsApp];
