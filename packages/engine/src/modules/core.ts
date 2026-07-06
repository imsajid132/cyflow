import type { Bundle, OperationRunner } from "@cyflow/shared";

/** Clamp to a sane max so a bad blueprint can't hang the worker (or tests). */
export const MAX_SLEEP_SECONDS = 300;

/**
 * core.sleep — wait `params.seconds`, then emit one empty bundle so the chain
 * continues. Non-numeric / negative values clamp to 0; anything over the max
 * clamps down to MAX_SLEEP_SECONDS.
 */
export const sleep: OperationRunner = async (_inputBundle, params): Promise<Bundle[]> => {
  const raw = Number((params as { seconds?: unknown }).seconds ?? 0);
  const seconds = Math.min(Math.max(Number.isFinite(raw) ? raw : 0, 0), MAX_SLEEP_SECONDS);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  return [{}];
};
