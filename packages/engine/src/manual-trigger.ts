import type { Blueprint, Bundle } from "@cyflow/shared";

/**
 * Derive the "Run once" trigger bundles for a scenario. If it starts with a
 * Manual trigger, the bundle(s) come from that module's `sample` JSON param
 * (an array becomes many bundles; an object becomes one). Otherwise the given
 * fallback is used (e.g. a webhook's sample payload).
 */
export function manualTriggerBundles(blueprint: Blueprint, fallback: Bundle[]): Bundle[] {
  const trigger = blueprint.modules.find((m) => m.kind === "trigger");
  if (trigger?.app !== "manual") return fallback;
  const sample = (trigger.params as { sample?: unknown }).sample;
  if (typeof sample === "string" && sample.trim()) {
    try {
      const parsed = JSON.parse(sample);
      return Array.isArray(parsed) ? (parsed as Bundle[]) : [parsed as Bundle];
    } catch {
      // Not valid JSON — treat the raw text as a single { sample } bundle.
      return [{ sample } as Bundle];
    }
  }
  return [{}];
}
