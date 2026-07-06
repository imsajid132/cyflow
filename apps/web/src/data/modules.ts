/**
 * The three built-in modules shown in the Phase 1 demo chain
 * (Webhook → HTTP → Telegram). `panelSub` is the descriptor shown in the
 * config-panel header when the module is selected.
 */
export type ModuleId = "webhook" | "http" | "telegram";

export interface FlowModule {
  id: ModuleId;
  /** Title under the bubble + in the panel head. */
  label: string;
  /** One-line role shown under the bubble. */
  sub: string;
  /** Descriptor shown in the config-panel header. */
  panelSub: string;
}

export const MODULES: FlowModule[] = [
  { id: "webhook", label: "Webhook", sub: "Watch requests", panelSub: "Watch requests · trigger" },
  { id: "http", label: "HTTP", sub: "Enrich lead", panelSub: "Make a request · action" },
  { id: "telegram", label: "Telegram", sub: "Send message", panelSub: "Send a message · action" },
];
