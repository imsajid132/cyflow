import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, compact, requireCredential, toForm } from "./util";

/** Stripe connector (production). Auth: secret key (bearer, form-encoded bodies). */

const BASE = "https://api.stripe.com/v1";
const FORM = "application/x-www-form-urlencoded";
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "secretKey", "apiKey"], "Stripe");
const headers = (token: string, form = false) => ({ authorization: `Bearer ${token}`, ...(form ? { "content-type": FORM } : {}) });

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = (credentials.token ?? credentials.secretKey) as string | undefined;
  if (!token) return { ok: false, message: "Missing secret key." };
  try {
    await apiJson({ method: "GET", url: buildUrl(`${BASE}/customers`, { limit: 1 }), headers: headers(token) });
    return { ok: true, message: "Connected to Stripe" };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const stripeApp: App = {
  key: "stripe",
  name: "Stripe",
  auth: { type: "api_key", fields: [{ key: "token", label: "Secret key", type: "password", required: true }] },
  modules: {
    list_customers: m("list_customers", "List customers", "search", z.object({ email: z.string().optional(), limit: z.number().optional(), startingAfter: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { email?: string; limit?: number; startingAfter?: string };
      const json = await apiJson<{ data?: unknown[]; has_more?: boolean }>({ method: "GET", url: buildUrl(`${BASE}/customers`, compact({ email: q.email, limit: q.limit ?? 20, starting_after: q.startingAfter })), headers: headers(tok(ctx)) });
      return [{ customers: json.data ?? [], hasMore: json.has_more ?? false } as Bundle];
    }),
    get_customer: m("get_customer", "Get a customer", "search", z.object({ customerId: z.string() }), async (_i, p, ctx) => {
      const { customerId } = p as { customerId: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${BASE}/customers/${customerId}`, headers: headers(tok(ctx)) })];
    }),
    create_customer: m("create_customer", "Create a customer", "action", z.object({ email: z.string().optional(), name: z.string().optional(), description: z.string().optional(), phone: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { email?: string; name?: string; description?: string; phone?: string };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/customers`, headers: headers(tok(ctx), true), body: toForm({ email: q.email, name: q.name, description: q.description, phone: q.phone }) })];
    }),
    create_payment_intent: m("create_payment_intent", "Create a payment intent", "action", z.object({ amount: z.number(), currency: z.string(), customer: z.string().optional(), description: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { amount: number; currency: string; customer?: string; description?: string };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/payment_intents`, headers: headers(tok(ctx), true), body: toForm({ amount: q.amount, currency: q.currency, customer: q.customer, description: q.description }) })];
    }),
    list_payment_intents: m("list_payment_intents", "List payment intents", "search", z.object({ customer: z.string().optional(), limit: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { customer?: string; limit?: number };
      const json = await apiJson<{ data?: unknown[] }>({ method: "GET", url: buildUrl(`${BASE}/payment_intents`, compact({ customer: q.customer, limit: q.limit ?? 20 })), headers: headers(tok(ctx)) });
      return [{ paymentIntents: json.data ?? [] } as Bundle];
    }),
    create_refund: m("create_refund", "Refund a payment", "action", z.object({ paymentIntent: z.string(), amount: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { paymentIntent: string; amount?: number };
      return [await apiJson<Bundle>({ method: "POST", url: `${BASE}/refunds`, headers: headers(tok(ctx), true), body: toForm({ payment_intent: q.paymentIntent, amount: q.amount }) })];
    }),
  },
  testConnection,
};
