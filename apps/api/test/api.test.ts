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
});
