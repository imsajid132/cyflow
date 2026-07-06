import type { OperationRunner } from "@cyflow/shared";

/**
 * webhook.custom_webhook — the trigger.
 *
 * The walker special-cases triggers (their output IS the incoming trigger
 * bundles, not the result of an invocation), so this runner is a straight
 * passthrough. It's still registered to keep the registry uniform and to let
 * tests invoke it directly.
 */
export const customWebhook: OperationRunner = async (inputBundle) => [inputBundle];
