import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@cyflow/shared";
import { smtpApp } from "../src/index";

const h = vi.hoisted(() => {
  const sendMail = vi.fn(async (opts: { to: string }) => ({ messageId: "<abc@smtp>", accepted: [opts.to], rejected: [] }));
  const verify = vi.fn(async () => true);
  const createTransport = vi.fn((_opts: unknown) => ({ sendMail, verify }));
  return { sendMail, verify, createTransport };
});
vi.mock("nodemailer", () => ({ createTransport: h.createTransport, default: { createTransport: h.createTransport } }));

const ctx = (connection: Record<string, unknown>): ExecutionContext => ({ connection } as unknown as ExecutionContext);

describe("SMTP (mocked nodemailer)", () => {
  it("send_email builds mail options + returns the messageId", async () => {
    const out = await smtpApp.modules.send_email.run(
      {},
      { from: "a@x.com", to: "b@y.com", subject: "Hi", text: "Body" },
      ctx({ host: "smtp.x.com", port: "587", username: "u", password: "p" }),
    );
    expect(h.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.x.com", port: 587, secure: false, auth: { user: "u", pass: "p" } }));
    expect(h.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "a@x.com", to: "b@y.com", subject: "Hi", text: "Body" }));
    expect(out[0]).toMatchObject({ messageId: "<abc@smtp>", accepted: ["b@y.com"] });
  });

  it("uses implicit TLS on port 465", async () => {
    await smtpApp.modules.send_email.run({}, { from: "a@x.com", to: "b@y.com", subject: "Hi", text: "x" }, ctx({ host: "smtp.x.com", port: "465", username: "u", password: "p" }));
    expect(h.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ port: 465, secure: true }));
  });

  it("testConnection verifies the transport", async () => {
    const r = await smtpApp.testConnection!({ host: "smtp.x.com", port: "587", username: "u", password: "p" });
    expect(h.verify).toHaveBeenCalled();
    expect(r).toEqual({ ok: true, message: "Connected to smtp.x.com:587" });
  });
});
