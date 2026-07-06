import { z } from "zod";
import type { App } from "../app";
import {
  getRecord,
  setRecord,
  deleteRecord,
  listRecords,
  incrementRecord,
} from "../modules/datastore";

/**
 * Built-in key-value Data Store app (Phase 8). Modules read/write the run's
 * `ctx.dataStore` (in-memory for tests / browser, Prisma-backed in the worker).
 */
export const dataStoreApp: App = {
  key: "datastore",
  name: "Data store",
  auth: { type: "none" },
  modules: {
    get_record: {
      key: "get_record",
      name: "Get record",
      kind: "search",
      params: z.object({ key: z.string() }),
      run: getRecord,
    },
    set_record: {
      key: "set_record",
      name: "Set record",
      kind: "action",
      params: z.object({ key: z.string(), value: z.any() }),
      run: setRecord,
    },
    delete_record: {
      key: "delete_record",
      name: "Delete record",
      kind: "action",
      params: z.object({ key: z.string() }),
      run: deleteRecord,
    },
    list_records: {
      key: "list_records",
      name: "List records",
      kind: "search",
      params: z.object({ prefix: z.string().optional() }),
      run: listRecords,
    },
    increment: {
      key: "increment",
      name: "Increment value",
      kind: "action",
      params: z.object({ key: z.string(), by: z.number().optional() }),
      run: incrementRecord,
    },
  },
};
