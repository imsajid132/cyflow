import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { requireCredential } from "./util";

/** SMTP (email) connector (production). Auth: host/port/user/pass. Driver: nodemailer (lazy). */

interface SmtpCreds {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
}

function readCreds(ctx: ExecutionContext): SmtpCreds {
  const conn = (ctx.connection ?? {}) as Record<string, unknown>;
  const port = Number(conn.port ?? 587) || 587;
  return {
    host: requireCredential(ctx, ["host"], "SMTP"),
    port,
    user: requireCredential(ctx, ["username", "user"], "SMTP"),
    pass: requireCredential(ctx, ["password", "pass"], "SMTP"),
    // Port 465 is implicit TLS; 587/25 use STARTTLS. Honour an explicit override.
    secure: conn.secure === undefined || conn.secure === "" ? port === 465 : conn.secure === true || conn.secure === "true",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function makeTransport(c: SmtpCreds): Promise<any> {
  const nodemailer = await import("nodemailer");
  return nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass } });
}

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const host = credentials.host as string | undefined;
  const user = (credentials.username ?? credentials.user) as string | undefined;
  const pass = (credentials.password ?? credentials.pass) as string | undefined;
  if (!host || !user || !pass) return { ok: false, message: "Missing host, username, or password." };
  const port = Number(credentials.port ?? 587) || 587;
  try {
    const transport = await makeTransport({ host, port, user, pass, secure: port === 465 });
    await transport.verify();
    return { ok: true, message: `Connected to ${host}:${port}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const smtpApp: App = {
  key: "smtp",
  name: "Email (SMTP)",
  auth: {
    type: "custom",
    fields: [
      { key: "host", label: "SMTP host", type: "text", required: true },
      { key: "port", label: "Port", type: "text", required: false },
      { key: "username", label: "Username", type: "text", required: true },
      { key: "password", label: "Password", type: "password", required: true },
      { key: "secure", label: "Use TLS (true/false)", type: "text", required: false },
    ],
  },
  modules: {
    send_email: m(
      "send_email",
      "Send an email",
      "action",
      z.object({ from: z.string(), to: z.string(), subject: z.string(), text: z.string().optional(), html: z.string().optional(), cc: z.string().optional(), bcc: z.string().optional() }),
      async (_i, params, ctx) => {
        const p = params as { from: string; to: string; subject: string; text?: string; html?: string; cc?: string; bcc?: string };
        const transport = await makeTransport(readCreds(ctx));
        const info = (await transport.sendMail({
          from: p.from,
          to: p.to,
          cc: p.cc || undefined,
          bcc: p.bcc || undefined,
          subject: p.subject,
          text: p.text,
          html: p.html,
        })) as { messageId?: string; accepted?: string[]; rejected?: string[] };
        return [{ messageId: info.messageId, accepted: info.accepted ?? [], rejected: info.rejected ?? [] } as Bundle];
      },
    ),
  },
  testConnection,
};
