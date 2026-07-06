import { z } from "zod";
import type { App } from "engine";
import type { OperationRunner } from "@cyflow/shared";
import { requireCredential, postJson } from "./util";

/** URL-safe base64 for a raw email message. */
function base64Url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Gmail (scaffold) — Send an email. Auth: oauth2 (access token). */
const sendEmail: OperationRunner = async (_input, params, ctx) => {
  const accessToken = requireCredential(ctx, ["access_token", "accessToken", "token"], "Gmail");
  const p = params as { to?: unknown; subject?: unknown; body?: unknown };

  const raw = base64Url(
    `To: ${String(p.to)}\r\nSubject: ${String(p.subject)}\r\n\r\n${String(p.body ?? "")}`,
  );
  const { ok, status, json } = await postJson(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    { raw },
    { authorization: `Bearer ${accessToken}` },
  );
  if (!ok) {
    const error = json.error as { message?: string } | undefined;
    throw new Error(`Gmail error: ${error?.message ?? status}`);
  }
  return [{ id: json.id, threadId: json.threadId, to: p.to, subject: p.subject }];
};

export const gmailApp: App = {
  key: "gmail",
  name: "Gmail",
  auth: { type: "oauth2" },
  modules: {
    send_email: {
      key: "send_email",
      name: "Send an email",
      kind: "action",
      params: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
      run: sendEmail,
    },
  },
};
