import type { Blueprint, Bundle } from "@cyflow/shared";

/**
 * The sample scenario the canvas loads:
 *   Webhook → Iterator → HTTP → Array Aggregator → Telegram (mock)
 *
 * A webhook receives a batch of leads; the iterator fans them out; HTTP enriches
 * each one; the array aggregator collapses the enriched names into a single
 * bundle; Telegram sends one summary message. This exercises fan-out (HTTP runs
 * 3×) and a collapse (aggregator 3 → 1) so the replay + operation counting are
 * meaningful.
 */
export const sampleBlueprint: Blueprint = {
  modules: [
    {
      id: "1",
      app: "webhook",
      operation: "custom_webhook",
      kind: "trigger",
      params: {},
      next: "2",
    },
    {
      id: "2",
      app: "flow",
      operation: "iterator",
      kind: "iterator",
      params: { array: "{{1.body.leads}}" },
      next: "3",
    },
    {
      id: "3",
      app: "http",
      operation: "make_request",
      kind: "action",
      params: {
        method: "GET",
        url: "https://api.example.com/enrich",
        query: { email: "{{2.value.email}}" },
      },
      next: "4",
    },
    {
      id: "4",
      app: "flow",
      operation: "array_aggregator",
      kind: "aggregator",
      params: { field: "data.name" },
      next: "5",
    },
    {
      id: "5",
      app: "telegram",
      operation: "send_message",
      kind: "action",
      params: { chatId: "-100234598812", text: "New leads enriched: {{4.array}}" },
      next: null,
    },
  ],
};

/** The trigger bundle that starts the run — a batch of three leads. */
export const sampleTrigger: Bundle[] = [
  {
    body: {
      leads: [
        { email: "ada@lovelace.dev" },
        { email: "grace@hopper.dev" },
        { email: "kay@johnson.dev" },
      ],
    },
  },
];
