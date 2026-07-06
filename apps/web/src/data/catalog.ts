import type { ModuleKind } from "@cyflow/shared";

export interface ParamField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select";
  options?: string[];
  placeholder?: string;
  /** Whether the field commonly holds {{ }} mappings. */
  mappable?: boolean;
}

export interface CatalogModule {
  operation: string;
  name: string;
  kind: ModuleKind;
  params: ParamField[];
  /** Default params applied when the module is added. */
  defaults?: Record<string, unknown>;
}

export interface CatalogApp {
  key: string;
  name: string;
  category: string;
  /** Whether this app needs a connection (drives the config connection selector). */
  auth?: "api_key" | "bearer_token" | "basic_auth" | "oauth2";
  modules: CatalogModule[];
}

export const CATEGORIES = [
  "Triggers",
  "Core",
  "Flow control",
  "Data",
  "Communication",
  "AI",
  "Productivity",
] as const;

export const CATALOG: CatalogApp[] = [
  {
    key: "webhook",
    name: "Webhook",
    category: "Triggers",
    modules: [
      {
        operation: "custom_webhook",
        name: "Custom webhook",
        kind: "trigger",
        params: [{ key: "name", label: "Hook name", type: "text", placeholder: "New lead" }],
      },
    ],
  },
  {
    key: "http",
    name: "HTTP",
    category: "Core",
    modules: [
      {
        operation: "make_request",
        name: "Make a request",
        kind: "action",
        defaults: { method: "GET" },
        params: [
          { key: "method", label: "Method", type: "select", options: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          { key: "url", label: "URL", type: "text", placeholder: "https://api.example.com", mappable: true },
          { key: "body", label: "Body", type: "textarea", mappable: true },
        ],
      },
    ],
  },
  {
    key: "core",
    name: "Tools",
    category: "Core",
    modules: [
      {
        operation: "sleep",
        name: "Sleep",
        kind: "action",
        defaults: { seconds: 1 },
        params: [{ key: "seconds", label: "Seconds", type: "number" }],
      },
    ],
  },
  {
    key: "flow",
    name: "Flow control",
    category: "Flow control",
    modules: [
      { operation: "router", name: "Router", kind: "router", params: [] },
      {
        operation: "iterator",
        name: "Iterator",
        kind: "iterator",
        params: [{ key: "array", label: "Array", type: "text", placeholder: "{{1.items}}", mappable: true }],
      },
      { operation: "array_aggregator", name: "Array aggregator", kind: "aggregator", params: [{ key: "field", label: "Field", type: "text", mappable: true }] },
      { operation: "text_aggregator", name: "Text aggregator", kind: "aggregator", params: [{ key: "value", label: "Value field", type: "text", mappable: true }, { key: "separator", label: "Separator", type: "text" }] },
      { operation: "numeric_aggregator", name: "Numeric aggregator", kind: "aggregator", params: [{ key: "value", label: "Value field", type: "text" }, { key: "operation", label: "Operation", type: "select", options: ["sum", "average", "min", "max", "count"] }] },
    ],
  },
  {
    key: "datastore",
    name: "Data store",
    category: "Data",
    modules: [
      { operation: "get_record", name: "Get a record", kind: "search", params: [{ key: "key", label: "Key", type: "text", mappable: true }] },
      { operation: "set_record", name: "Set a record", kind: "action", params: [{ key: "key", label: "Key", type: "text", mappable: true }, { key: "value", label: "Value", type: "textarea", mappable: true }] },
      { operation: "delete_record", name: "Delete a record", kind: "action", params: [{ key: "key", label: "Key", type: "text", mappable: true }] },
      { operation: "list_records", name: "List records", kind: "search", params: [{ key: "prefix", label: "Prefix", type: "text" }] },
      { operation: "increment", name: "Increment a value", kind: "action", defaults: { by: 1 }, params: [{ key: "key", label: "Key", type: "text", mappable: true }, { key: "by", label: "By", type: "number" }] },
    ],
  },
  {
    key: "telegram",
    name: "Telegram",
    category: "Communication",
    auth: "api_key",
    modules: [
      {
        operation: "send_message",
        name: "Send a message",
        kind: "action",
        params: [
          { key: "chatId", label: "Chat ID", type: "text", mappable: true },
          { key: "text", label: "Message text", type: "textarea", mappable: true },
        ],
      },
    ],
  },
  {
    key: "slack",
    name: "Slack",
    category: "Communication",
    auth: "bearer_token",
    modules: [
      {
        operation: "send_message",
        name: "Send a message",
        kind: "action",
        params: [
          { key: "channel", label: "Channel", type: "text", mappable: true },
          { key: "text", label: "Message text", type: "textarea", mappable: true },
        ],
      },
    ],
  },
  {
    key: "gmail",
    name: "Gmail",
    category: "Communication",
    auth: "oauth2",
    modules: [
      {
        operation: "send_email",
        name: "Send an email",
        kind: "action",
        params: [
          { key: "to", label: "To", type: "text", mappable: true },
          { key: "subject", label: "Subject", type: "text", mappable: true },
          { key: "body", label: "Body", type: "textarea", mappable: true },
        ],
      },
    ],
  },
  {
    key: "openai",
    name: "OpenAI",
    category: "AI",
    auth: "bearer_token",
    modules: [
      {
        operation: "create_completion",
        name: "Create a completion",
        kind: "action",
        defaults: { model: "gpt-4o-mini" },
        params: [
          { key: "model", label: "Model", type: "text" },
          { key: "prompt", label: "Prompt", type: "textarea", mappable: true },
        ],
      },
    ],
  },
  {
    key: "sheets",
    name: "Google Sheets",
    category: "Productivity",
    auth: "oauth2",
    modules: [
      {
        operation: "append_row",
        name: "Append a row",
        kind: "action",
        params: [
          { key: "spreadsheetId", label: "Spreadsheet ID", type: "text", mappable: true },
          { key: "range", label: "Range", type: "text", placeholder: "Sheet1!A1" },
        ],
      },
    ],
  },
];

export function findApp(appKey: string): CatalogApp | undefined {
  return CATALOG.find((a) => a.key === appKey);
}

export function findModule(appKey: string, operation: string): CatalogModule | undefined {
  return findApp(appKey)?.modules.find((m) => m.operation === operation);
}
