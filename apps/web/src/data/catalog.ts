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
  auth?: "api_key" | "bearer_token" | "basic_auth" | "oauth2" | "custom";
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
  "Developer",
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
  {
    key: "discord",
    name: "Discord",
    category: "Communication",
    auth: "api_key",
    modules: [
      { operation: "send_message", name: "Send a message", kind: "action", params: [
        { key: "channelId", label: "Channel ID", type: "text", mappable: true },
        { key: "content", label: "Message", type: "textarea", mappable: true },
      ] },
      { operation: "edit_message", name: "Edit a message", kind: "action", params: [
        { key: "channelId", label: "Channel ID", type: "text", mappable: true },
        { key: "messageId", label: "Message ID", type: "text", mappable: true },
        { key: "content", label: "Message", type: "textarea", mappable: true },
      ] },
      { operation: "delete_message", name: "Delete a message", kind: "action", params: [
        { key: "channelId", label: "Channel ID", type: "text", mappable: true },
        { key: "messageId", label: "Message ID", type: "text", mappable: true },
      ] },
      { operation: "get_channel", name: "Get a channel", kind: "search", params: [{ key: "channelId", label: "Channel ID", type: "text", mappable: true }] },
      { operation: "list_messages", name: "List messages", kind: "search", params: [
        { key: "channelId", label: "Channel ID", type: "text", mappable: true },
        { key: "limit", label: "Limit", type: "number" },
      ] },
      { operation: "add_reaction", name: "Add a reaction", kind: "action", params: [
        { key: "channelId", label: "Channel ID", type: "text", mappable: true },
        { key: "messageId", label: "Message ID", type: "text", mappable: true },
        { key: "emoji", label: "Emoji", type: "text", mappable: true },
      ] },
    ],
  },
  {
    key: "notion",
    name: "Notion",
    category: "Productivity",
    auth: "api_key",
    modules: [
      { operation: "query_database", name: "Query a database", kind: "search", params: [
        { key: "databaseId", label: "Database ID", type: "text", mappable: true },
        { key: "filter", label: "Filter (map an object)", type: "text", mappable: true },
      ] },
      { operation: "get_page", name: "Get a page", kind: "search", params: [{ key: "pageId", label: "Page ID", type: "text", mappable: true }] },
      { operation: "create_page", name: "Create a page", kind: "action", params: [
        { key: "databaseId", label: "Database ID", type: "text", mappable: true },
        { key: "properties", label: "Properties (map an object)", type: "text", mappable: true },
      ] },
      { operation: "update_page", name: "Update a page", kind: "action", params: [
        { key: "pageId", label: "Page ID", type: "text", mappable: true },
        { key: "properties", label: "Properties (map an object)", type: "text", mappable: true },
      ] },
      { operation: "search", name: "Search", kind: "search", params: [{ key: "query", label: "Query", type: "text", mappable: true }] },
      { operation: "get_block_children", name: "Get block children", kind: "search", params: [{ key: "blockId", label: "Block/Page ID", type: "text", mappable: true }] },
    ],
  },
  {
    key: "airtable",
    name: "Airtable",
    category: "Data",
    auth: "api_key",
    modules: [
      { operation: "list_records", name: "List records", kind: "search", params: [
        { key: "baseId", label: "Base ID", type: "text", mappable: true },
        { key: "tableId", label: "Table name/ID", type: "text", mappable: true },
        { key: "filterByFormula", label: "Filter formula", type: "text", mappable: true },
        { key: "maxRecords", label: "Max records", type: "number" },
      ] },
      { operation: "get_record", name: "Get a record", kind: "search", params: [
        { key: "baseId", label: "Base ID", type: "text", mappable: true },
        { key: "tableId", label: "Table name/ID", type: "text", mappable: true },
        { key: "recordId", label: "Record ID", type: "text", mappable: true },
      ] },
      { operation: "create_record", name: "Create a record", kind: "action", params: [
        { key: "baseId", label: "Base ID", type: "text", mappable: true },
        { key: "tableId", label: "Table name/ID", type: "text", mappable: true },
        { key: "fields", label: "Fields (map an object)", type: "text", mappable: true },
      ] },
      { operation: "update_record", name: "Update a record", kind: "action", params: [
        { key: "baseId", label: "Base ID", type: "text", mappable: true },
        { key: "tableId", label: "Table name/ID", type: "text", mappable: true },
        { key: "recordId", label: "Record ID", type: "text", mappable: true },
        { key: "fields", label: "Fields (map an object)", type: "text", mappable: true },
      ] },
      { operation: "delete_record", name: "Delete a record", kind: "action", params: [
        { key: "baseId", label: "Base ID", type: "text", mappable: true },
        { key: "tableId", label: "Table name/ID", type: "text", mappable: true },
        { key: "recordId", label: "Record ID", type: "text", mappable: true },
      ] },
    ],
  },
  {
    key: "github",
    name: "GitHub",
    category: "Developer",
    auth: "api_key",
    modules: [
      { operation: "get_repo", name: "Get a repository", kind: "search", params: [
        { key: "owner", label: "Owner", type: "text", mappable: true },
        { key: "repo", label: "Repo", type: "text", mappable: true },
      ] },
      { operation: "list_issues", name: "List issues", kind: "search", params: [
        { key: "owner", label: "Owner", type: "text", mappable: true },
        { key: "repo", label: "Repo", type: "text", mappable: true },
        { key: "state", label: "State", type: "select", options: ["open", "closed", "all"] },
      ] },
      { operation: "get_issue", name: "Get an issue", kind: "search", params: [
        { key: "owner", label: "Owner", type: "text", mappable: true },
        { key: "repo", label: "Repo", type: "text", mappable: true },
        { key: "number", label: "Issue number", type: "number", mappable: true },
      ] },
      { operation: "create_issue", name: "Create an issue", kind: "action", params: [
        { key: "owner", label: "Owner", type: "text", mappable: true },
        { key: "repo", label: "Repo", type: "text", mappable: true },
        { key: "title", label: "Title", type: "text", mappable: true },
        { key: "body", label: "Body", type: "textarea", mappable: true },
      ] },
      { operation: "create_comment", name: "Comment on an issue", kind: "action", params: [
        { key: "owner", label: "Owner", type: "text", mappable: true },
        { key: "repo", label: "Repo", type: "text", mappable: true },
        { key: "number", label: "Issue number", type: "number", mappable: true },
        { key: "body", label: "Comment", type: "textarea", mappable: true },
      ] },
      { operation: "list_pull_requests", name: "List pull requests", kind: "search", params: [
        { key: "owner", label: "Owner", type: "text", mappable: true },
        { key: "repo", label: "Repo", type: "text", mappable: true },
        { key: "state", label: "State", type: "select", options: ["open", "closed", "all"] },
      ] },
      { operation: "list_commits", name: "List commits", kind: "search", params: [
        { key: "owner", label: "Owner", type: "text", mappable: true },
        { key: "repo", label: "Repo", type: "text", mappable: true },
      ] },
      { operation: "search_issues", name: "Search issues & PRs", kind: "search", params: [{ key: "query", label: "Query", type: "text", mappable: true }] },
      { operation: "create_release", name: "Create a release", kind: "action", params: [
        { key: "owner", label: "Owner", type: "text", mappable: true },
        { key: "repo", label: "Repo", type: "text", mappable: true },
        { key: "tagName", label: "Tag", type: "text", mappable: true },
        { key: "name", label: "Name", type: "text", mappable: true },
      ] },
    ],
  },
  {
    key: "gitlab",
    name: "GitLab",
    category: "Developer",
    auth: "api_key",
    modules: [
      { operation: "get_project", name: "Get a project", kind: "search", params: [{ key: "projectId", label: "Project ID or path", type: "text", mappable: true }] },
      { operation: "list_issues", name: "List issues", kind: "search", params: [
        { key: "projectId", label: "Project ID or path", type: "text", mappable: true },
        { key: "state", label: "State", type: "select", options: ["opened", "closed"] },
      ] },
      { operation: "create_issue", name: "Create an issue", kind: "action", params: [
        { key: "projectId", label: "Project ID or path", type: "text", mappable: true },
        { key: "title", label: "Title", type: "text", mappable: true },
        { key: "description", label: "Description", type: "textarea", mappable: true },
      ] },
      { operation: "create_note", name: "Comment on an issue", kind: "action", params: [
        { key: "projectId", label: "Project ID or path", type: "text", mappable: true },
        { key: "issueIid", label: "Issue IID", type: "number", mappable: true },
        { key: "body", label: "Comment", type: "textarea", mappable: true },
      ] },
      { operation: "list_merge_requests", name: "List merge requests", kind: "search", params: [
        { key: "projectId", label: "Project ID or path", type: "text", mappable: true },
        { key: "state", label: "State", type: "select", options: ["opened", "closed", "merged", "all"] },
      ] },
      { operation: "list_pipelines", name: "List pipelines", kind: "search", params: [{ key: "projectId", label: "Project ID or path", type: "text", mappable: true }] },
    ],
  },
  {
    key: "dropbox",
    name: "Dropbox",
    category: "Productivity",
    auth: "api_key",
    modules: [
      { operation: "list_folder", name: "List a folder", kind: "search", params: [{ key: "path", label: "Path", type: "text", mappable: true, placeholder: "/" }] },
      { operation: "get_metadata", name: "Get metadata", kind: "search", params: [{ key: "path", label: "Path", type: "text", mappable: true }] },
      { operation: "create_folder", name: "Create a folder", kind: "action", params: [{ key: "path", label: "Path", type: "text", mappable: true }] },
      { operation: "upload_file", name: "Upload a file", kind: "action", params: [
        { key: "path", label: "Path", type: "text", mappable: true },
        { key: "content", label: "Content", type: "textarea", mappable: true },
        { key: "mode", label: "Mode", type: "select", options: ["overwrite", "add"] },
      ] },
      { operation: "download_file", name: "Download a file", kind: "search", params: [{ key: "path", label: "Path", type: "text", mappable: true }] },
      { operation: "move_file", name: "Move a file", kind: "action", params: [
        { key: "fromPath", label: "From path", type: "text", mappable: true },
        { key: "toPath", label: "To path", type: "text", mappable: true },
      ] },
      { operation: "delete_file", name: "Delete a file/folder", kind: "action", params: [{ key: "path", label: "Path", type: "text", mappable: true }] },
    ],
  },
  {
    key: "cloudflare",
    name: "Cloudflare",
    category: "Developer",
    auth: "api_key",
    modules: [
      { operation: "list_zones", name: "List zones", kind: "search", params: [{ key: "name", label: "Name filter", type: "text", mappable: true }] },
      { operation: "list_dns_records", name: "List DNS records", kind: "search", params: [
        { key: "zoneId", label: "Zone ID", type: "text", mappable: true },
        { key: "type", label: "Type", type: "text", placeholder: "A" },
      ] },
      { operation: "create_dns_record", name: "Create a DNS record", kind: "action", params: [
        { key: "zoneId", label: "Zone ID", type: "text", mappable: true },
        { key: "type", label: "Type", type: "text", placeholder: "A" },
        { key: "name", label: "Name", type: "text", mappable: true },
        { key: "content", label: "Content", type: "text", mappable: true },
        { key: "ttl", label: "TTL", type: "number" },
      ] },
      { operation: "update_dns_record", name: "Update a DNS record", kind: "action", params: [
        { key: "zoneId", label: "Zone ID", type: "text", mappable: true },
        { key: "recordId", label: "Record ID", type: "text", mappable: true },
        { key: "type", label: "Type", type: "text" },
        { key: "name", label: "Name", type: "text", mappable: true },
        { key: "content", label: "Content", type: "text", mappable: true },
      ] },
      { operation: "delete_dns_record", name: "Delete a DNS record", kind: "action", params: [
        { key: "zoneId", label: "Zone ID", type: "text", mappable: true },
        { key: "recordId", label: "Record ID", type: "text", mappable: true },
      ] },
      { operation: "purge_cache", name: "Purge cache", kind: "action", params: [{ key: "zoneId", label: "Zone ID", type: "text", mappable: true }] },
    ],
  },
  {
    key: "supabase",
    name: "Supabase",
    category: "Data",
    auth: "custom",
    modules: [
      { operation: "select", name: "Select rows", kind: "search", params: [
        { key: "table", label: "Table", type: "text", mappable: true },
        { key: "select", label: "Columns", type: "text", placeholder: "*" },
        { key: "filter", label: "Filter (PostgREST)", type: "text", mappable: true, placeholder: "status=eq.active" },
        { key: "order", label: "Order", type: "text", placeholder: "created_at.desc" },
        { key: "limit", label: "Limit", type: "number" },
      ] },
      { operation: "insert", name: "Insert rows", kind: "action", params: [
        { key: "table", label: "Table", type: "text", mappable: true },
        { key: "rows", label: "Rows (map an object/array)", type: "text", mappable: true },
      ] },
      { operation: "update", name: "Update rows", kind: "action", params: [
        { key: "table", label: "Table", type: "text", mappable: true },
        { key: "filter", label: "Filter (PostgREST)", type: "text", mappable: true },
        { key: "values", label: "Values (map an object)", type: "text", mappable: true },
      ] },
      { operation: "delete_rows", name: "Delete rows", kind: "action", params: [
        { key: "table", label: "Table", type: "text", mappable: true },
        { key: "filter", label: "Filter (PostgREST)", type: "text", mappable: true },
      ] },
      { operation: "rpc", name: "Call a function", kind: "action", params: [
        { key: "fn", label: "Function name", type: "text", mappable: true },
        { key: "args", label: "Args (map an object)", type: "text", mappable: true },
      ] },
    ],
  },
  {
    key: "trello",
    name: "Trello",
    category: "Productivity",
    auth: "custom",
    modules: [
      { operation: "get_board", name: "Get a board", kind: "search", params: [{ key: "boardId", label: "Board ID", type: "text", mappable: true }] },
      { operation: "list_lists", name: "List lists", kind: "search", params: [{ key: "boardId", label: "Board ID", type: "text", mappable: true }] },
      { operation: "list_cards", name: "List cards", kind: "search", params: [{ key: "listId", label: "List ID", type: "text", mappable: true }] },
      { operation: "create_card", name: "Create a card", kind: "action", params: [
        { key: "listId", label: "List ID", type: "text", mappable: true },
        { key: "name", label: "Name", type: "text", mappable: true },
        { key: "desc", label: "Description", type: "textarea", mappable: true },
      ] },
      { operation: "update_card", name: "Update a card", kind: "action", params: [
        { key: "cardId", label: "Card ID", type: "text", mappable: true },
        { key: "name", label: "Name", type: "text", mappable: true },
        { key: "desc", label: "Description", type: "textarea", mappable: true },
      ] },
      { operation: "move_card", name: "Move a card", kind: "action", params: [
        { key: "cardId", label: "Card ID", type: "text", mappable: true },
        { key: "listId", label: "Destination list ID", type: "text", mappable: true },
      ] },
      { operation: "add_comment", name: "Comment on a card", kind: "action", params: [
        { key: "cardId", label: "Card ID", type: "text", mappable: true },
        { key: "text", label: "Comment", type: "textarea", mappable: true },
      ] },
    ],
  },
  {
    key: "asana",
    name: "Asana",
    category: "Productivity",
    auth: "api_key",
    modules: [
      { operation: "list_workspaces", name: "List workspaces", kind: "search", params: [] },
      { operation: "list_projects", name: "List projects", kind: "search", params: [{ key: "workspace", label: "Workspace GID", type: "text", mappable: true }] },
      { operation: "list_tasks", name: "List tasks", kind: "search", params: [{ key: "project", label: "Project GID", type: "text", mappable: true }] },
      { operation: "get_task", name: "Get a task", kind: "search", params: [{ key: "taskGid", label: "Task GID", type: "text", mappable: true }] },
      { operation: "create_task", name: "Create a task", kind: "action", params: [
        { key: "name", label: "Name", type: "text", mappable: true },
        { key: "notes", label: "Notes", type: "textarea", mappable: true },
        { key: "workspace", label: "Workspace GID", type: "text", mappable: true },
      ] },
      { operation: "update_task", name: "Update a task", kind: "action", params: [
        { key: "taskGid", label: "Task GID", type: "text", mappable: true },
        { key: "name", label: "Name", type: "text", mappable: true },
      ] },
      { operation: "add_comment", name: "Comment on a task", kind: "action", params: [
        { key: "taskGid", label: "Task GID", type: "text", mappable: true },
        { key: "text", label: "Comment", type: "textarea", mappable: true },
      ] },
    ],
  },
  {
    key: "hubspot",
    name: "HubSpot",
    category: "Productivity",
    auth: "api_key",
    modules: [
      { operation: "list_contacts", name: "List contacts", kind: "search", params: [{ key: "limit", label: "Limit", type: "number" }] },
      { operation: "get_contact", name: "Get a contact", kind: "search", params: [{ key: "contactId", label: "Contact ID", type: "text", mappable: true }] },
      { operation: "create_contact", name: "Create a contact", kind: "action", params: [{ key: "properties", label: "Properties (map an object)", type: "text", mappable: true }] },
      { operation: "update_contact", name: "Update a contact", kind: "action", params: [
        { key: "contactId", label: "Contact ID", type: "text", mappable: true },
        { key: "properties", label: "Properties (map an object)", type: "text", mappable: true },
      ] },
      { operation: "search_contacts", name: "Search contacts", kind: "search", params: [{ key: "query", label: "Query", type: "text", mappable: true }] },
      { operation: "create_deal", name: "Create a deal", kind: "action", params: [{ key: "properties", label: "Properties (map an object)", type: "text", mappable: true }] },
      { operation: "create_company", name: "Create a company", kind: "action", params: [{ key: "properties", label: "Properties (map an object)", type: "text", mappable: true }] },
    ],
  },
  {
    key: "clickup",
    name: "ClickUp",
    category: "Productivity",
    auth: "api_key",
    modules: [
      { operation: "list_spaces", name: "List spaces", kind: "search", params: [{ key: "teamId", label: "Team ID", type: "text", mappable: true }] },
      { operation: "list_tasks", name: "List tasks", kind: "search", params: [{ key: "listId", label: "List ID", type: "text", mappable: true }] },
      { operation: "get_task", name: "Get a task", kind: "search", params: [{ key: "taskId", label: "Task ID", type: "text", mappable: true }] },
      { operation: "create_task", name: "Create a task", kind: "action", params: [
        { key: "listId", label: "List ID", type: "text", mappable: true },
        { key: "name", label: "Name", type: "text", mappable: true },
        { key: "description", label: "Description", type: "textarea", mappable: true },
      ] },
      { operation: "update_task", name: "Update a task", kind: "action", params: [
        { key: "taskId", label: "Task ID", type: "text", mappable: true },
        { key: "name", label: "Name", type: "text", mappable: true },
        { key: "status", label: "Status", type: "text", mappable: true },
      ] },
      { operation: "create_comment", name: "Comment on a task", kind: "action", params: [
        { key: "taskId", label: "Task ID", type: "text", mappable: true },
        { key: "commentText", label: "Comment", type: "textarea", mappable: true },
      ] },
    ],
  },
  {
    key: "calendly",
    name: "Calendly",
    category: "Productivity",
    auth: "api_key",
    modules: [
      { operation: "get_current_user", name: "Get current user", kind: "search", params: [] },
      { operation: "list_events", name: "List scheduled events", kind: "search", params: [
        { key: "user", label: "User URI", type: "text", mappable: true },
        { key: "status", label: "Status", type: "select", options: ["active", "canceled"] },
      ] },
      { operation: "get_event", name: "Get an event", kind: "search", params: [{ key: "eventUuid", label: "Event UUID", type: "text", mappable: true }] },
      { operation: "list_invitees", name: "List invitees", kind: "search", params: [{ key: "eventUuid", label: "Event UUID", type: "text", mappable: true }] },
      { operation: "list_event_types", name: "List event types", kind: "search", params: [{ key: "user", label: "User URI", type: "text", mappable: true }] },
    ],
  },
  {
    key: "twilio",
    name: "Twilio",
    category: "Communication",
    auth: "custom",
    modules: [
      { operation: "send_sms", name: "Send an SMS", kind: "action", params: [
        { key: "from", label: "From number", type: "text", mappable: true },
        { key: "to", label: "To number", type: "text", mappable: true },
        { key: "body", label: "Message", type: "textarea", mappable: true },
      ] },
      { operation: "list_messages", name: "List messages", kind: "search", params: [
        { key: "to", label: "To number", type: "text", mappable: true },
        { key: "from", label: "From number", type: "text", mappable: true },
      ] },
      { operation: "get_message", name: "Get a message", kind: "search", params: [{ key: "messageSid", label: "Message SID", type: "text", mappable: true }] },
      { operation: "make_call", name: "Make a call", kind: "action", params: [
        { key: "from", label: "From number", type: "text", mappable: true },
        { key: "to", label: "To number", type: "text", mappable: true },
        { key: "url", label: "TwiML URL", type: "text", mappable: true },
      ] },
    ],
  },
  {
    key: "stripe",
    name: "Stripe",
    category: "Data",
    auth: "api_key",
    modules: [
      { operation: "list_customers", name: "List customers", kind: "search", params: [
        { key: "email", label: "Email filter", type: "text", mappable: true },
        { key: "limit", label: "Limit", type: "number" },
      ] },
      { operation: "get_customer", name: "Get a customer", kind: "search", params: [{ key: "customerId", label: "Customer ID", type: "text", mappable: true }] },
      { operation: "create_customer", name: "Create a customer", kind: "action", params: [
        { key: "email", label: "Email", type: "text", mappable: true },
        { key: "name", label: "Name", type: "text", mappable: true },
        { key: "description", label: "Description", type: "text", mappable: true },
      ] },
      { operation: "create_payment_intent", name: "Create a payment intent", kind: "action", params: [
        { key: "amount", label: "Amount (cents)", type: "number", mappable: true },
        { key: "currency", label: "Currency", type: "text", placeholder: "usd" },
        { key: "customer", label: "Customer ID", type: "text", mappable: true },
      ] },
      { operation: "list_payment_intents", name: "List payment intents", kind: "search", params: [{ key: "customer", label: "Customer ID", type: "text", mappable: true }] },
      { operation: "create_refund", name: "Refund a payment", kind: "action", params: [
        { key: "paymentIntent", label: "Payment intent ID", type: "text", mappable: true },
        { key: "amount", label: "Amount (cents)", type: "number", mappable: true },
      ] },
    ],
  },
  {
    key: "shopify",
    name: "Shopify",
    category: "Data",
    auth: "custom",
    modules: [
      { operation: "list_products", name: "List products", kind: "search", params: [{ key: "limit", label: "Limit", type: "number" }] },
      { operation: "get_product", name: "Get a product", kind: "search", params: [{ key: "productId", label: "Product ID", type: "text", mappable: true }] },
      { operation: "create_product", name: "Create a product", kind: "action", params: [{ key: "product", label: "Product (map an object)", type: "text", mappable: true }] },
      { operation: "list_orders", name: "List orders", kind: "search", params: [{ key: "status", label: "Status", type: "text", placeholder: "any" }] },
      { operation: "get_order", name: "Get an order", kind: "search", params: [{ key: "orderId", label: "Order ID", type: "text", mappable: true }] },
      { operation: "list_customers", name: "List customers", kind: "search", params: [{ key: "limit", label: "Limit", type: "number" }] },
      { operation: "create_customer", name: "Create a customer", kind: "action", params: [{ key: "customer", label: "Customer (map an object)", type: "text", mappable: true }] },
    ],
  },
  {
    key: "woocommerce",
    name: "WooCommerce",
    category: "Data",
    auth: "custom",
    modules: [
      { operation: "list_products", name: "List products", kind: "search", params: [
        { key: "search", label: "Search", type: "text", mappable: true },
        { key: "perPage", label: "Per page", type: "number" },
      ] },
      { operation: "get_product", name: "Get a product", kind: "search", params: [{ key: "productId", label: "Product ID", type: "text", mappable: true }] },
      { operation: "create_product", name: "Create a product", kind: "action", params: [{ key: "product", label: "Product (map an object)", type: "text", mappable: true }] },
      { operation: "list_orders", name: "List orders", kind: "search", params: [{ key: "status", label: "Status", type: "text", mappable: true }] },
      { operation: "get_order", name: "Get an order", kind: "search", params: [{ key: "orderId", label: "Order ID", type: "text", mappable: true }] },
      { operation: "update_order", name: "Update an order", kind: "action", params: [
        { key: "orderId", label: "Order ID", type: "text", mappable: true },
        { key: "fields", label: "Fields (map an object)", type: "text", mappable: true },
      ] },
      { operation: "list_customers", name: "List customers", kind: "search", params: [{ key: "perPage", label: "Per page", type: "number" }] },
    ],
  },
  {
    key: "rss",
    name: "RSS",
    category: "Data",
    modules: [
      { operation: "read_feed", name: "Read a feed", kind: "search", params: [
        { key: "url", label: "Feed URL", type: "text", mappable: true },
        { key: "limit", label: "Max items", type: "number" },
      ] },
    ],
  },
  {
    key: "whatsapp",
    name: "WhatsApp",
    category: "Communication",
    auth: "custom",
    modules: [
      { operation: "send_message", name: "Send a text message", kind: "action", params: [
        { key: "to", label: "To (E.164)", type: "text", mappable: true },
        { key: "body", label: "Message", type: "textarea", mappable: true },
      ] },
      { operation: "send_template", name: "Send a template", kind: "action", params: [
        { key: "to", label: "To (E.164)", type: "text", mappable: true },
        { key: "templateName", label: "Template name", type: "text", mappable: true },
        { key: "languageCode", label: "Language code", type: "text", placeholder: "en_US" },
      ] },
      { operation: "mark_read", name: "Mark as read", kind: "action", params: [{ key: "messageId", label: "Message ID", type: "text", mappable: true }] },
    ],
  },
  {
    key: "twitter",
    name: "X (Twitter)",
    category: "Communication",
    auth: "api_key",
    modules: [
      { operation: "post_tweet", name: "Post a tweet", kind: "action", params: [
        { key: "text", label: "Text", type: "textarea", mappable: true },
        { key: "replyToTweetId", label: "Reply to tweet ID", type: "text", mappable: true },
      ] },
      { operation: "delete_tweet", name: "Delete a tweet", kind: "action", params: [{ key: "tweetId", label: "Tweet ID", type: "text", mappable: true }] },
      { operation: "get_tweet", name: "Get a tweet", kind: "search", params: [{ key: "tweetId", label: "Tweet ID", type: "text", mappable: true }] },
      { operation: "get_user_by_username", name: "Get a user", kind: "search", params: [{ key: "username", label: "Username", type: "text", mappable: true }] },
      { operation: "search_recent", name: "Search recent tweets", kind: "search", params: [
        { key: "query", label: "Query", type: "text", mappable: true },
        { key: "maxResults", label: "Max results", type: "number" },
      ] },
    ],
  },
  {
    key: "contacts",
    name: "Google Contacts",
    category: "Productivity",
    auth: "oauth2",
    modules: [
      { operation: "list_contacts", name: "List contacts", kind: "search", params: [{ key: "pageSize", label: "Page size", type: "number" }] },
      { operation: "get_contact", name: "Get a contact", kind: "search", params: [{ key: "resourceName", label: "Resource name", type: "text", mappable: true, placeholder: "people/c123" }] },
      { operation: "search_contacts", name: "Search contacts", kind: "search", params: [{ key: "query", label: "Query", type: "text", mappable: true }] },
      { operation: "create_contact", name: "Create a contact", kind: "action", params: [
        { key: "givenName", label: "First name", type: "text", mappable: true },
        { key: "familyName", label: "Last name", type: "text", mappable: true },
        { key: "email", label: "Email", type: "text", mappable: true },
        { key: "phone", label: "Phone", type: "text", mappable: true },
      ] },
      { operation: "delete_contact", name: "Delete a contact", kind: "action", params: [{ key: "resourceName", label: "Resource name", type: "text", mappable: true }] },
    ],
  },
  {
    key: "tasks",
    name: "Google Tasks",
    category: "Productivity",
    auth: "oauth2",
    modules: [
      { operation: "list_tasklists", name: "List task lists", kind: "search", params: [] },
      { operation: "list_tasks", name: "List tasks", kind: "search", params: [{ key: "tasklist", label: "Task list ID", type: "text", mappable: true }] },
      { operation: "get_task", name: "Get a task", kind: "search", params: [
        { key: "tasklist", label: "Task list ID", type: "text", mappable: true },
        { key: "task", label: "Task ID", type: "text", mappable: true },
      ] },
      { operation: "create_task", name: "Create a task", kind: "action", params: [
        { key: "tasklist", label: "Task list ID", type: "text", mappable: true },
        { key: "title", label: "Title", type: "text", mappable: true },
        { key: "notes", label: "Notes", type: "textarea", mappable: true },
        { key: "due", label: "Due (RFC3339)", type: "text", mappable: true },
      ] },
      { operation: "update_task", name: "Update a task", kind: "action", params: [
        { key: "tasklist", label: "Task list ID", type: "text", mappable: true },
        { key: "task", label: "Task ID", type: "text", mappable: true },
        { key: "status", label: "Status", type: "select", options: ["needsAction", "completed"] },
      ] },
      { operation: "delete_task", name: "Delete a task", kind: "action", params: [
        { key: "tasklist", label: "Task list ID", type: "text", mappable: true },
        { key: "task", label: "Task ID", type: "text", mappable: true },
      ] },
    ],
  },
  {
    key: "youtube",
    name: "YouTube",
    category: "Communication",
    auth: "oauth2",
    modules: [
      { operation: "search", name: "Search", kind: "search", params: [
        { key: "query", label: "Query", type: "text", mappable: true },
        { key: "type", label: "Type", type: "select", options: ["video", "channel", "playlist"] },
        { key: "maxResults", label: "Max results", type: "number" },
      ] },
      { operation: "get_video", name: "Get a video", kind: "search", params: [{ key: "videoId", label: "Video ID", type: "text", mappable: true }] },
      { operation: "get_channel", name: "Get a channel", kind: "search", params: [
        { key: "channelId", label: "Channel ID", type: "text", mappable: true },
        { key: "forUsername", label: "Username", type: "text", mappable: true },
      ] },
      { operation: "list_my_playlists", name: "List my playlists", kind: "search", params: [{ key: "maxResults", label: "Max results", type: "number" }] },
      { operation: "list_playlist_items", name: "List playlist items", kind: "search", params: [{ key: "playlistId", label: "Playlist ID", type: "text", mappable: true }] },
    ],
  },
];

export function findApp(appKey: string): CatalogApp | undefined {
  return CATALOG.find((a) => a.key === appKey);
}

export function findModule(appKey: string, operation: string): CatalogModule | undefined {
  return findApp(appKey)?.modules.find((m) => m.operation === operation);
}
