import { z } from "zod";
import type { App } from "../app";
import { customWebhook } from "../modules/webhook";

/**
 * Webhook app — the instant trigger. Its output IS the incoming trigger
 * bundles (the walker special-cases triggers). Params are open: a webhook can
 * carry any shape, so we validate loosely and pass through.
 */
export const webhookApp: App = {
  key: "webhook",
  name: "Webhook",
  auth: { type: "none" },
  modules: {
    custom_webhook: {
      key: "custom_webhook",
      name: "Custom webhook",
      kind: "trigger",
      triggerKind: "webhook",
      params: z.object({}).passthrough(),
      run: customWebhook,
    },
  },
};
