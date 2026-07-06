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
    key: "utils",
    name: "JSON / CSV",
    category: "Data",
    modules: [
      { operation: "parse_json", name: "Parse JSON", kind: "action", params: [{ key: "text", label: "JSON text", type: "textarea", mappable: true }] },
      { operation: "to_json", name: "Create JSON", kind: "action", params: [{ key: "value", label: "Value (map a field)", type: "text", mappable: true, placeholder: "{{1.body}}" }] },
      { operation: "parse_csv", name: "Parse CSV", kind: "action", params: [
        { key: "text", label: "CSV text", type: "textarea", mappable: true },
        { key: "delimiter", label: "Delimiter", type: "text", placeholder: "," },
      ] },
      { operation: "to_csv", name: "Create CSV", kind: "action", params: [{ key: "rows", label: "Rows (map an array)", type: "text", mappable: true, placeholder: "{{2.rows}}" }] },
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
          { key: "chatId", label: "Chat ID", type: "text", mappable: true, placeholder: "@channel or -100…" },
          { key: "text", label: "Message text", type: "textarea", mappable: true },
          { key: "parseMode", label: "Parse mode", type: "select", options: ["", "Markdown", "MarkdownV2", "HTML"] },
        ],
      },
      { operation: "send_photo", name: "Send a photo", kind: "action", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
        { key: "photo", label: "Photo (URL or file_id)", type: "text", mappable: true },
        { key: "caption", label: "Caption", type: "textarea", mappable: true },
      ] },
      { operation: "send_document", name: "Send a document", kind: "action", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
        { key: "document", label: "Document (URL or file_id)", type: "text", mappable: true },
        { key: "caption", label: "Caption", type: "textarea", mappable: true },
      ] },
      { operation: "send_video", name: "Send a video", kind: "action", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
        { key: "video", label: "Video (URL or file_id)", type: "text", mappable: true },
        { key: "caption", label: "Caption", type: "textarea", mappable: true },
      ] },
      { operation: "send_location", name: "Send a location", kind: "action", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
        { key: "latitude", label: "Latitude", type: "number", mappable: true },
        { key: "longitude", label: "Longitude", type: "number", mappable: true },
      ] },
      { operation: "send_poll", name: "Send a poll", kind: "action", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
        { key: "question", label: "Question", type: "text", mappable: true },
        { key: "options", label: "Options (map an array)", type: "text", mappable: true, placeholder: "{{2.options}}" },
      ] },
      { operation: "edit_message_text", name: "Edit a message", kind: "action", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
        { key: "messageId", label: "Message ID", type: "number", mappable: true },
        { key: "text", label: "New text", type: "textarea", mappable: true },
        { key: "parseMode", label: "Parse mode", type: "select", options: ["", "Markdown", "MarkdownV2", "HTML"] },
      ] },
      { operation: "delete_message", name: "Delete a message", kind: "action", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
        { key: "messageId", label: "Message ID", type: "number", mappable: true },
      ] },
      { operation: "forward_message", name: "Forward a message", kind: "action", params: [
        { key: "chatId", label: "To chat ID", type: "text", mappable: true },
        { key: "fromChatId", label: "From chat ID", type: "text", mappable: true },
        { key: "messageId", label: "Message ID", type: "number", mappable: true },
      ] },
      { operation: "copy_message", name: "Copy a message", kind: "action", params: [
        { key: "chatId", label: "To chat ID", type: "text", mappable: true },
        { key: "fromChatId", label: "From chat ID", type: "text", mappable: true },
        { key: "messageId", label: "Message ID", type: "number", mappable: true },
      ] },
      { operation: "answer_callback_query", name: "Answer a callback query", kind: "action", params: [
        { key: "callbackQueryId", label: "Callback query ID", type: "text", mappable: true },
        { key: "text", label: "Text", type: "text", mappable: true },
      ] },
      { operation: "pin_message", name: "Pin a message", kind: "action", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
        { key: "messageId", label: "Message ID", type: "number", mappable: true },
      ] },
      { operation: "unpin_message", name: "Unpin a message", kind: "action", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
        { key: "messageId", label: "Message ID (optional)", type: "number", mappable: true },
      ] },
      { operation: "create_invite_link", name: "Create an invite link", kind: "action", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
        { key: "memberLimit", label: "Member limit", type: "number" },
      ] },
      { operation: "get_chat", name: "Get a chat", kind: "search", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
      ] },
      { operation: "get_chat_member", name: "Get a chat member", kind: "search", params: [
        { key: "chatId", label: "Chat ID", type: "text", mappable: true },
        { key: "userId", label: "User ID", type: "number", mappable: true },
      ] },
      { operation: "get_file", name: "Get a file (download link)", kind: "search", params: [
        { key: "fileId", label: "File ID", type: "text", mappable: true },
      ] },
      { operation: "get_updates", name: "Get updates (polling)", kind: "search", params: [
        { key: "offset", label: "Offset", type: "number" },
        { key: "limit", label: "Limit", type: "number" },
      ] },
      { operation: "set_webhook", name: "Set webhook", kind: "action", params: [
        { key: "url", label: "Webhook URL", type: "text", mappable: true, placeholder: "https://api…/hooks/scn_id" },
      ] },
      { operation: "delete_webhook", name: "Delete webhook", kind: "action", params: [] },
      { operation: "get_webhook_info", name: "Get webhook info", kind: "search", params: [] },
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
      { operation: "search_emails", name: "Search emails", kind: "search", params: [
        { key: "query", label: "Gmail query", type: "text", mappable: true, placeholder: "from:ada is:unread" },
        { key: "maxResults", label: "Max results", type: "number", placeholder: "20" },
      ] },
      { operation: "read_email", name: "Read an email", kind: "search", params: [{ key: "messageId", label: "Message ID", type: "text", mappable: true }] },
      { operation: "send_email", name: "Send an email", kind: "action", params: [
        { key: "to", label: "To", type: "text", mappable: true },
        { key: "cc", label: "Cc", type: "text", mappable: true },
        { key: "subject", label: "Subject", type: "text", mappable: true },
        { key: "body", label: "Body", type: "textarea", mappable: true },
      ] },
      { operation: "reply_email", name: "Reply to an email", kind: "action", params: [
        { key: "threadId", label: "Thread ID", type: "text", mappable: true },
        { key: "to", label: "To", type: "text", mappable: true },
        { key: "subject", label: "Subject", type: "text", mappable: true },
        { key: "body", label: "Body", type: "textarea", mappable: true },
      ] },
      { operation: "create_draft", name: "Create a draft", kind: "action", params: [
        { key: "to", label: "To", type: "text", mappable: true },
        { key: "subject", label: "Subject", type: "text", mappable: true },
        { key: "body", label: "Body", type: "textarea", mappable: true },
      ] },
      { operation: "list_labels", name: "List labels", kind: "search", params: [] },
      { operation: "add_label", name: "Add a label", kind: "action", params: [
        { key: "messageId", label: "Message ID", type: "text", mappable: true },
        { key: "labelId", label: "Label ID", type: "text", mappable: true },
      ] },
      { operation: "remove_label", name: "Remove a label", kind: "action", params: [
        { key: "messageId", label: "Message ID", type: "text", mappable: true },
        { key: "labelId", label: "Label ID", type: "text", mappable: true },
      ] },
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
      { operation: "list_spreadsheets", name: "List spreadsheets", kind: "search", params: [{ key: "query", label: "Name contains", type: "text", mappable: true }] },
      { operation: "list_sheets", name: "List sheets", kind: "search", params: [{ key: "spreadsheetId", label: "Spreadsheet ID", type: "text", mappable: true }] },
      { operation: "read_range", name: "Read a range", kind: "search", params: [
        { key: "spreadsheetId", label: "Spreadsheet ID", type: "text", mappable: true },
        { key: "range", label: "Range", type: "text", placeholder: "Sheet1!A1:C10", mappable: true },
      ] },
      { operation: "append_row", name: "Append a row", kind: "action", params: [
        { key: "spreadsheetId", label: "Spreadsheet ID", type: "text", mappable: true },
        { key: "range", label: "Range", type: "text", placeholder: "Sheet1!A1" },
        { key: "values", label: "Row values (map an array)", type: "text", mappable: true, placeholder: "{{2.rows}}" },
      ] },
      { operation: "update_range", name: "Update a range", kind: "action", params: [
        { key: "spreadsheetId", label: "Spreadsheet ID", type: "text", mappable: true },
        { key: "range", label: "Range", type: "text", placeholder: "Sheet1!A1:B2" },
        { key: "values", label: "Values (map a 2-D array)", type: "text", mappable: true },
      ] },
      { operation: "search_rows", name: "Search rows", kind: "search", params: [
        { key: "spreadsheetId", label: "Spreadsheet ID", type: "text", mappable: true },
        { key: "range", label: "Range", type: "text", placeholder: "Sheet1!A:C" },
        { key: "column", label: "Column index (0-based)", type: "number" },
        { key: "value", label: "Match value", type: "text", mappable: true },
      ] },
    ],
  },
  {
    key: "drive",
    name: "Google Drive",
    category: "Productivity",
    auth: "oauth2",
    modules: [
      { operation: "search_files", name: "Search files", kind: "search", params: [
        { key: "query", label: "Drive query", type: "text", mappable: true, placeholder: "name contains 'report'" },
        { key: "pageSize", label: "Page size", type: "number" },
      ] },
      { operation: "get_file", name: "Get a file", kind: "search", params: [{ key: "fileId", label: "File ID", type: "text", mappable: true }] },
      { operation: "upload_file", name: "Upload a file", kind: "action", params: [
        { key: "name", label: "File name", type: "text", mappable: true },
        { key: "content", label: "Content", type: "textarea", mappable: true },
        { key: "mimeType", label: "MIME type", type: "text", placeholder: "text/plain" },
        { key: "parents", label: "Parent folder ID", type: "text", mappable: true },
      ] },
      { operation: "download_file", name: "Download a file", kind: "search", params: [{ key: "fileId", label: "File ID", type: "text", mappable: true }] },
      { operation: "create_folder", name: "Create a folder", kind: "action", params: [
        { key: "name", label: "Folder name", type: "text", mappable: true },
        { key: "parents", label: "Parent folder ID", type: "text", mappable: true },
      ] },
      { operation: "move_file", name: "Move a file", kind: "action", params: [
        { key: "fileId", label: "File ID", type: "text", mappable: true },
        { key: "destinationFolderId", label: "Destination folder ID", type: "text", mappable: true },
      ] },
      { operation: "copy_file", name: "Copy a file", kind: "action", params: [
        { key: "fileId", label: "File ID", type: "text", mappable: true },
        { key: "name", label: "New name", type: "text", mappable: true },
      ] },
      { operation: "delete_file", name: "Delete a file", kind: "action", params: [{ key: "fileId", label: "File ID", type: "text", mappable: true }] },
    ],
  },
  {
    key: "calendar",
    name: "Google Calendar",
    category: "Productivity",
    auth: "oauth2",
    modules: [
      { operation: "list_calendars", name: "List calendars", kind: "search", params: [] },
      { operation: "list_events", name: "List events", kind: "search", params: [
        { key: "calendarId", label: "Calendar ID", type: "text", mappable: true, placeholder: "primary" },
        { key: "timeMin", label: "Time min (RFC3339)", type: "text", mappable: true },
        { key: "timeMax", label: "Time max (RFC3339)", type: "text", mappable: true },
      ] },
      { operation: "create_event", name: "Create an event", kind: "action", params: [
        { key: "calendarId", label: "Calendar ID", type: "text", placeholder: "primary" },
        { key: "summary", label: "Title", type: "text", mappable: true },
        { key: "description", label: "Description", type: "textarea", mappable: true },
        { key: "start", label: "Start (map { dateTime })", type: "text", mappable: true, placeholder: "{{1.start}}" },
        { key: "end", label: "End (map { dateTime })", type: "text", mappable: true, placeholder: "{{1.end}}" },
      ] },
      { operation: "update_event", name: "Update an event", kind: "action", params: [
        { key: "calendarId", label: "Calendar ID", type: "text", placeholder: "primary" },
        { key: "eventId", label: "Event ID", type: "text", mappable: true },
        { key: "summary", label: "Title", type: "text", mappable: true },
      ] },
      { operation: "delete_event", name: "Delete an event", kind: "action", params: [
        { key: "calendarId", label: "Calendar ID", type: "text", placeholder: "primary" },
        { key: "eventId", label: "Event ID", type: "text", mappable: true },
      ] },
    ],
  },
];

export function findApp(appKey: string): CatalogApp | undefined {
  return CATALOG.find((a) => a.key === appKey);
}

export function findModule(appKey: string, operation: string): CatalogModule | undefined {
  return findApp(appKey)?.modules.find((m) => m.operation === operation);
}
