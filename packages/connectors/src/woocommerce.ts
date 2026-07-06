import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, basicAuth, buildUrl, requireCredential } from "./util";

/** WooCommerce connector (production). Auth: store URL + consumer key/secret (Basic). */

const base = (ctx: ExecutionContext) => `${requireCredential(ctx, ["storeUrl", "url"], "WooCommerce").replace(/\/$/, "")}/wp-json/wc/v3`;
const headers = (ctx: ExecutionContext) => ({ authorization: basicAuth(requireCredential(ctx, ["consumerKey"], "WooCommerce"), requireCredential(ctx, ["consumerSecret"], "WooCommerce")) });

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const url = credentials.storeUrl as string | undefined;
  const ck = credentials.consumerKey as string | undefined;
  const cs = credentials.consumerSecret as string | undefined;
  if (!url || !ck || !cs) return { ok: false, message: "Missing store URL or consumer key/secret." };
  try {
    await apiJson({ method: "GET", url: buildUrl(`${url.replace(/\/$/, "")}/wp-json/wc/v3/products`, { per_page: 1 }), headers: { authorization: basicAuth(ck, cs) } });
    return { ok: true, message: "Connected to WooCommerce store" };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const woocommerceApp: App = {
  key: "woocommerce",
  name: "WooCommerce",
  auth: {
    type: "custom",
    fields: [
      { key: "storeUrl", label: "Store URL", type: "text", required: true },
      { key: "consumerKey", label: "Consumer key", type: "text", required: true },
      { key: "consumerSecret", label: "Consumer secret", type: "password", required: true },
    ],
  },
  modules: {
    list_products: m("list_products", "List products", "search", z.object({ perPage: z.number().optional(), page: z.number().optional(), search: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { perPage?: number; page?: number; search?: string };
      const json = await apiJson<unknown[]>({ method: "GET", url: buildUrl(`${base(ctx)}/products`, { per_page: q.perPage ?? 20, page: q.page, search: q.search }), headers: headers(ctx) });
      return [{ products: json } as Bundle];
    }),
    get_product: m("get_product", "Get a product", "search", z.object({ productId: z.string() }), async (_i, p, ctx) => {
      const { productId } = p as { productId: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${base(ctx)}/products/${productId}`, headers: headers(ctx) })];
    }),
    create_product: m("create_product", "Create a product", "action", z.object({ product: z.any() }), async (_i, p, ctx) => {
      const { product } = p as { product: Record<string, unknown> };
      return [await apiJson<Bundle>({ method: "POST", url: `${base(ctx)}/products`, headers: headers(ctx), body: product })];
    }),
    list_orders: m("list_orders", "List orders", "search", z.object({ status: z.string().optional(), perPage: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { status?: string; perPage?: number };
      const json = await apiJson<unknown[]>({ method: "GET", url: buildUrl(`${base(ctx)}/orders`, { status: q.status, per_page: q.perPage ?? 20 }), headers: headers(ctx) });
      return [{ orders: json } as Bundle];
    }),
    get_order: m("get_order", "Get an order", "search", z.object({ orderId: z.string() }), async (_i, p, ctx) => {
      const { orderId } = p as { orderId: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${base(ctx)}/orders/${orderId}`, headers: headers(ctx) })];
    }),
    update_order: m("update_order", "Update an order", "action", z.object({ orderId: z.string(), fields: z.any() }), async (_i, p, ctx) => {
      const q = p as { orderId: string; fields: Record<string, unknown> };
      return [await apiJson<Bundle>({ method: "PUT", url: `${base(ctx)}/orders/${q.orderId}`, headers: headers(ctx), body: q.fields })];
    }),
    list_customers: m("list_customers", "List customers", "search", z.object({ perPage: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { perPage?: number };
      const json = await apiJson<unknown[]>({ method: "GET", url: buildUrl(`${base(ctx)}/customers`, { per_page: q.perPage ?? 20 }), headers: headers(ctx) });
      return [{ customers: json } as Bundle];
    }),
  },
  testConnection,
};
