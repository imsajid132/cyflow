import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { InMemoryApiStore } from "../src/store";

const app = () => createApp(new InMemoryApiStore());

describe("cyflow API", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /scenarios lists the seeded scenario", async () => {
    const res = await request(app()).get("/scenarios");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("blueprint");
  });

  it("creates, reads, updates and deletes a scenario", async () => {
    const a = app();
    const created = await request(a)
      .post("/scenarios")
      .send({ name: "My scenario", blueprint: { modules: [] } });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(created.body.name).toBe("My scenario");

    const got = await request(a).get(`/scenarios/${id}`);
    expect(got.status).toBe(200);

    const updated = await request(a).put(`/scenarios/${id}`).send({ status: "ACTIVE" });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe("ACTIVE");

    const del = await request(a).delete(`/scenarios/${id}`);
    expect(del.status).toBe(204);

    const gone = await request(a).get(`/scenarios/${id}`);
    expect(gone.status).toBe(404);
  });

  it("returns 404 for unknown scenario", async () => {
    expect((await request(app()).get("/scenarios/nope")).status).toBe(404);
    expect((await request(app()).put("/scenarios/nope").send({})).status).toBe(404);
    expect((await request(app()).delete("/scenarios/nope")).status).toBe(404);
    expect((await request(app()).post("/scenarios/nope/run-once").send({})).status).toBe(404);
  });

  it("runs a scenario once through the real engine and records it", async () => {
    const a = app();
    const list = await request(a).get("/scenarios");
    const id = list.body[0].id as string;

    const run = await request(a).post(`/scenarios/${id}/run-once`).send({});
    expect(run.status).toBe(200);
    expect(run.body.executionId).toBeTruthy();
    expect(run.body.status).toBe("SUCCESS");
    expect(run.body.execution.steps.length).toBeGreaterThan(0);

    const execs = await request(a).get("/executions");
    expect(execs.body.length).toBeGreaterThan(0);
    expect(execs.body[0].scenarioId).toBe(id);

    const one = await request(a).get(`/executions/${run.body.executionId}`);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe(run.body.executionId);
  });

  it("runs a run-once with an ad-hoc blueprint from the request body", async () => {
    const a = app();
    const list = await request(a).get("/scenarios");
    const id = list.body[0].id as string;
    const run = await request(a)
      .post(`/scenarios/${id}/run-once`)
      .send({ blueprint: { modules: [{ id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: null }] } });
    expect(run.status).toBe(200);
    expect(run.body.status).toBe("SUCCESS");
  });

  it("lists connections and data stores", async () => {
    const a = app();
    const conns = await request(a).get("/connections");
    expect(conns.status).toBe(200);
    expect(Array.isArray(conns.body)).toBe(true);

    const stores = await request(a).get("/data-stores");
    expect(stores.status).toBe(200);
    expect(stores.body[0]).toHaveProperty("records");
  });

  it("lists apps and their auth schemas", async () => {
    const a = app();
    const apps = await request(a).get("/apps");
    expect(apps.status).toBe(200);
    const telegram = apps.body.find((x: { key: string }) => x.key === "telegram");
    expect(telegram).toMatchObject({ key: "telegram", auth: "api_key", hasAuth: true });

    const auth = await request(a).get("/apps/telegram/auth");
    expect(auth.status).toBe(200);
    expect(auth.body.auth.type).toBe("api_key");
    expect(auth.body.auth.fields[0].key).toBe("token");

    expect((await request(a).get("/apps/nope/auth")).status).toBe(404);
  });

  it("creates, updates and deletes a connection without ever exposing secrets", async () => {
    const a = app();
    const created = await request(a)
      .post("/connections")
      .send({ appKey: "telegram", name: "My bot", credentials: { token: "super-secret-123" } });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    // The create response is a redacted summary — no secret fields.
    expect(created.body).toMatchObject({ appKey: "telegram", name: "My bot" });
    expect(JSON.stringify(created.body)).not.toContain("super-secret-123");
    expect(created.body).not.toHaveProperty("credentials");
    expect(created.body).not.toHaveProperty("token");

    // List never leaks the secret either.
    const list = await request(a).get("/connections");
    expect(JSON.stringify(list.body)).not.toContain("super-secret-123");
    expect(list.body.some((c: { id: string }) => c.id === id)).toBe(true);

    const updated = await request(a).put(`/connections/${id}`).send({ name: "Renamed bot" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Renamed bot");

    const del = await request(a).delete(`/connections/${id}`);
    expect(del.status).toBe(204);
    expect((await request(a).put(`/connections/${id}`).send({ name: "x" })).status).toBe(404);
    expect((await request(a).delete(`/connections/${id}`)).status).toBe(404);
  });

  it("rejects a connection whose credentials fail the app's auth schema", async () => {
    const a = app();
    const res = await request(a).post("/connections").send({ appKey: "telegram", name: "Bad", credentials: {} });
    expect(res.status).toBe(400);
    const missing = await request(a).post("/connections").send({ name: "no app" });
    expect(missing.status).toBe(400);
  });

  it("reports OAuth setup required when the provider env is missing", async () => {
    const a = app();
    const start = await request(a).get("/oauth/gmail/start");
    expect(start.status).toBe(200);
    expect(start.body.configured).toBe(false);
    expect(start.body.message).toMatch(/setup required/i);

    const cb = await request(a).get("/oauth/gmail/callback?code=abc");
    expect(cb.status).toBe(200);
    expect(cb.body.ok).toBe(false);
  });
});

describe("single-admin protection", () => {
  const secured = () => createApp(new InMemoryApiStore(), { adminToken: "s3cret" });

  it("leaves /health public", async () => {
    expect((await request(secured()).get("/health")).status).toBe(200);
  });

  it("401s protected routes without a token", async () => {
    expect((await request(secured()).get("/scenarios")).status).toBe(401);
    expect((await request(secured()).get("/connections")).status).toBe(401);
    expect((await request(secured()).post("/scenarios").send({ name: "x" })).status).toBe(401);
  });

  it("allows protected routes with a valid Bearer or x-admin-token", async () => {
    expect((await request(secured()).get("/scenarios").set("authorization", "Bearer s3cret")).status).toBe(200);
    expect((await request(secured()).get("/scenarios").set("x-admin-token", "s3cret")).status).toBe(200);
  });

  it("rejects a wrong token", async () => {
    expect((await request(secured()).get("/scenarios").set("authorization", "Bearer nope")).status).toBe(401);
  });

  it("keeps webhooks public even when protected", async () => {
    const res = await request(secured()).post("/hooks/scn_demo").send({ hello: "world" });
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
  });

  it("open mode (no token) requires nothing", async () => {
    expect((await request(createApp(new InMemoryApiStore())).get("/scenarios")).status).toBe(200);
  });
});

describe("webhook trigger", () => {
  it("runs the scenario and records an execution with the request body in the trigger bundle", async () => {
    const a = createApp(new InMemoryApiStore());
    const run = await request(a).post("/hooks/scn_demo").send({ order: 42 });
    expect(run.status).toBe(202);
    expect(run.body.executionId).toBeTruthy();
    expect(run.body.status).toBe("SUCCESS");

    const exec = await request(a).get(`/executions/${run.body.executionId}`);
    expect(exec.status).toBe(200);
    expect(JSON.stringify(exec.body.steps[0].input)).toContain("42");
  });

  it("404s an unknown scenario", async () => {
    expect((await request(createApp(new InMemoryApiStore())).post("/hooks/nope").send({})).status).toBe(404);
  });

  it("skips an inactive scenario", async () => {
    const a = createApp(new InMemoryApiStore());
    const created = await request(a)
      .post("/scenarios")
      .send({ name: "off", status: "PAUSED", blueprint: { modules: [{ id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: null }] } });
    const res = await request(a).post(`/hooks/${created.body.id}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });

  it("strips authorization/cookie headers so they never reach the execution snapshot", async () => {
    const a = createApp(new InMemoryApiStore());
    const run = await request(a)
      .post("/hooks/scn_demo")
      .set("authorization", "Bearer leak-me")
      .set("cookie", "session=leak")
      .send({ ok: 1 });
    const exec = await request(a).get(`/executions/${run.body.executionId}`);
    const dump = JSON.stringify(exec.body);
    expect(dump).not.toContain("leak-me");
    expect(dump).not.toContain("session=leak");
  });
});
