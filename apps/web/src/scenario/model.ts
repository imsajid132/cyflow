import type { Blueprint, ModuleNode } from "@cyflow/shared";

/** A blueprint module prepared for the canvas: its node + display metadata. */
export interface UiModule {
  node: ModuleNode;
  /** 1-based position in the chain (the "module number" Make shows). */
  number: number;
  /** Short title under the bubble + in the panel head. */
  label: string;
  /** One-line role under the bubble. */
  sub: string;
}

/** Display names per (app.operation); falls back to the raw keys. */
const META: Record<string, { label: string; sub: string }> = {
  "webhook.custom_webhook": { label: "Webhook", sub: "Watch requests" },
  "flow.iterator": { label: "Iterator", sub: "Split array" },
  "flow.array_aggregator": { label: "Aggregator", sub: "Collect array" },
  "flow.text_aggregator": { label: "Text aggregator", sub: "Join values" },
  "flow.numeric_aggregator": { label: "Numeric aggregator", sub: "Reduce" },
  "http.make_request": { label: "HTTP", sub: "Enrich lead" },
  "core.sleep": { label: "Sleep", sub: "Wait" },
  "telegram.send_message": { label: "Telegram", sub: "Send message" },
  "openai.create_completion": { label: "OpenAI", sub: "Chat completion" },
  "slack.send_message": { label: "Slack", sub: "Send message" },
  "gmail.send_email": { label: "Gmail", sub: "Send email" },
  "sheets.append_row": { label: "Google Sheets", sub: "Append row" },
  "datastore.get_record": { label: "Data store", sub: "Get record" },
  "datastore.set_record": { label: "Data store", sub: "Set record" },
  "flow.router": { label: "Router", sub: "Branch routes" },
};

function metaFor(node: ModuleNode): { label: string; sub: string } {
  return META[`${node.app}.${node.operation}`] ?? { label: node.app, sub: node.operation };
}

/** Walk the blueprint's `next` chain into an ordered list of UI modules. */
export function deriveModules(blueprint: Blueprint): UiModule[] {
  const byId = new Map<string, ModuleNode>(blueprint.modules.map((m) => [m.id, m]));
  const out: UiModule[] = [];
  const seen = new Set<string>();
  let current: ModuleNode | undefined = blueprint.modules[0];
  let number = 1;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const { label, sub } = metaFor(current);
    out.push({ node: current, number, label, sub });
    number += 1;
    current = current.next ? byId.get(current.next) : undefined;
  }
  return out;
}
