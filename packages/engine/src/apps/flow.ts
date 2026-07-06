import { z } from "zod";
import type { App } from "../app";
import {
  router,
  iterator,
  arrayAggregator,
  textAggregator,
  numericAggregator,
} from "../modules/flow";

/**
 * Flow-control app (Phase 5): Make's Iterator + Aggregators. Filters are a
 * property of the link (blueprint `ModuleNode.filter`), not a module, so they
 * are handled by the walker rather than exposed here.
 */
export const flowApp: App = {
  key: "flow",
  name: "Flow control",
  auth: { type: "none" },
  modules: {
    router: {
      key: "router",
      name: "Router",
      kind: "router",
      params: z.object({}),
      run: router,
    },
    iterator: {
      key: "iterator",
      name: "Iterator",
      kind: "iterator",
      params: z.object({ array: z.any() }),
      run: iterator,
    },
    array_aggregator: {
      key: "array_aggregator",
      name: "Array aggregator",
      kind: "aggregator",
      params: z.object({ field: z.string().optional() }),
      run: arrayAggregator,
    },
    text_aggregator: {
      key: "text_aggregator",
      name: "Text aggregator",
      kind: "aggregator",
      params: z.object({
        value: z.string(),
        separator: z.string().optional().default(", "),
      }),
      run: textAggregator,
    },
    numeric_aggregator: {
      key: "numeric_aggregator",
      name: "Numeric aggregator",
      kind: "aggregator",
      params: z.object({
        value: z.string().optional(),
        operation: z.enum(["sum", "average", "min", "max", "count"]).default("count"),
      }),
      run: numericAggregator,
    },
  },
};
