import type { App } from "engine";
import { telegramApp } from "./telegram";
import { openaiApp } from "./openai";
import { gmailApp } from "./gmail";
import { sheetsApp } from "./sheets";
import { driveApp } from "./drive";
import { calendarApp } from "./calendar";
import { slackApp } from "./slack";
import { utilsApp } from "./utils";

export { telegramApp } from "./telegram";
export { openaiApp } from "./openai";
export { gmailApp } from "./gmail";
export { sheetsApp } from "./sheets";
export { driveApp } from "./drive";
export { calendarApp } from "./calendar";
export { slackApp } from "./slack";
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
  utilsApp,
];
