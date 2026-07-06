import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, requireCredential } from "./util";

/** Shopify connector (production). Auth: shop domain + Admin API access token. */

const VERSION = "2024-01";
function hostFor(shop: string): string {
  const s = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return s.includes(".") ? s : `${s}.myshopify.com`;
}
const base = (ctx: ExecutionContext) => `https://${hostFor(requireCredential(ctx, ["shop", "storeUrl"], "Shopify"))}/admin/api/${VERSION}`;
const headers = (ctx: ExecutionContext) => ({ "x-shopify-access-token": requireCredential(ctx, ["accessToken", "token"], "Shopify") });

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const shop = (credentials.shop ?? credentials.storeUrl) as string | undefined;
  const token = (credentials.accessToken ?? credentials.token) as string | undefined;
  if (!shop || !token) return { ok: false, message: "Missing shop domain or access token." };
  try {
    const json = await apiJson<{ shop?: { name?: string } }>({ method: "GET", url: `https://${hostFor(shop)}/admin/api/${VERSION}/shop.json`, headers: { "x-shopify-access-token": token } });
    return { ok: true, message: `Connected: ${json.shop?.name ?? shop}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const shopifyApp: App = {
  key: "shopify",
  name: "Shopify",
  auth: {
    type: "custom",
    fields: [
      { key: "shop", label: "Shop (mystore or mystore.myshopify.com)", type: "text", required: true },
      { key: "accessToken", label: "Admin API access token", type: "password", required: true },
    ],
  },
  modules: {
    list_products: m("list_products", "List products", "search", z.object({ limit: z.number().optional(), sinceId: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { limit?: number; sinceId?: string };
      const json = await apiJson<{ products?: unknown[] }>({ method: "GET", url: buildUrl(`${base(ctx)}/products.json`, { limit: q.limit ?? 50, since_id: q.sinceId }), headers: headers(ctx) });
      return [{ products: json.products ?? [] } as Bundle];
    }),
    get_product: m("get_product", "Get a product", "search", z.object({ productId: z.string() }), async (_i, p, ctx) => {
      const { productId } = p as { productId: string };
      const json = await apiJson<{ product?: Bundle }>({ method: "GET", url: `${base(ctx)}/products/${productId}.json`, headers: headers(ctx) });
      return [(json.product ?? {}) as Bundle];
    }),
    create_product: m("create_product", "Create a product", "action", z.object({ product: z.any() }), async (_i, p, ctx) => {
      const { product } = p as { product: unknown };
      const json = await apiJson<{ product?: Bundle }>({ method: "POST", url: `${base(ctx)}/products.json`, headers: headers(ctx), body: { product } });
      return [(json.product ?? {}) as Bundle];
    }),
    list_orders: m("list_orders", "List orders", "search", z.object({ status: z.string().optional(), limit: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { status?: string; limit?: number };
      const json = await apiJson<{ orders?: unknown[] }>({ method: "GET", url: buildUrl(`${base(ctx)}/orders.json`, { status: q.status ?? "any", limit: q.limit ?? 50 }), headers: headers(ctx) });
      return [{ orders: json.orders ?? [] } as Bundle];
    }),
    get_order: m("get_order", "Get an order", "search", z.object({ orderId: z.string() }), async (_i, p, ctx) => {
      const { orderId } = p as { orderId: string };
      const json = await apiJson<{ order?: Bundle }>({ method: "GET", url: `${base(ctx)}/orders/${orderId}.json`, headers: headers(ctx) });
      return [(json.order ?? {}) as Bundle];
    }),
    list_customers: m("list_customers", "List customers", "search", z.object({ limit: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { limit?: number };
      const json = await apiJson<{ customers?: unknown[] }>({ method: "GET", url: buildUrl(`${base(ctx)}/customers.json`, { limit: q.limit ?? 50 }), headers: headers(ctx) });
      return [{ customers: json.customers ?? [] } as Bundle];
    }),
    create_customer: m("create_customer", "Create a customer", "action", z.object({ customer: z.any() }), async (_i, p, ctx) => {
      const { customer } = p as { customer: unknown };
      const json = await apiJson<{ customer?: Bundle }>({ method: "POST", url: `${base(ctx)}/customers.json`, headers: headers(ctx), body: { customer } });
      return [(json.customer ?? {}) as Bundle];
    }),
  },
  testConnection,
};
