import type { ModuleNode, StoredExecutionStep } from "@cyflow/shared";

const STATIC: Record<string, string[]> = {
  "webhook.custom_webhook": ["body", "body.name", "body.email", "body.leads", "body.items"],
  "flow.iterator": ["value", "index", "total"],
  "flow.array_aggregator": ["array"],
  "flow.text_aggregator": ["text"],
  "flow.numeric_aggregator": ["result"],
  "http.make_request": ["statusCode", "headers", "data"],
  "telegram.send_message": ["ok", "messageId"],
  "slack.send_message": ["ok", "channel", "ts"],
  "openai.create_completion": ["content", "model"],
  "gmail.send_email": ["id", "threadId"],
  "sheets.append_row": ["updatedRange", "updatedRows"],
  "datastore.get_record": ["key", "value", "found"],
  "datastore.set_record": ["key", "value"],
  "datastore.delete_record": ["key", "deleted"],
  "datastore.list_records": ["key", "value"],
  "datastore.increment": ["key", "value"],
  "core.sleep": [],
};

function flatten(obj: unknown, prefix: string, depth: number, out: string[]): void {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push(path);
    if (depth > 0 && v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, depth - 1, out);
  }
}

/** Parse a Manual trigger's sample JSON to its first bundle (for field hints). */
function manualSample(node: ModuleNode): Record<string, unknown> | null {
  const sample = (node.params as { sample?: unknown }).sample;
  if (typeof sample !== "string" || !sample.trim()) return null;
  try {
    const parsed = JSON.parse(sample);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Available output field paths for a module (from a real run, else its shape). */
export function outputFields(node: ModuleNode, step?: StoredExecutionStep): string[] {
  if (step && step.output.length > 0) {
    const out: string[] = [];
    flatten(step.output[0], "", 1, out);
    if (out.length > 0) return out.slice(0, 12);
  }
  // A Manual trigger's fields come from its sample JSON, before any run.
  if (node.app === "manual") {
    const sample = manualSample(node);
    if (sample) {
      const out: string[] = [];
      flatten(sample, "", 1, out);
      if (out.length > 0) return out.slice(0, 12);
    }
  }
  return STATIC[`${node.app}.${node.operation}`] ?? [];
}

export { manualSample };
