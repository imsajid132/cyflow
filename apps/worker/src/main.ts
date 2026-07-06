/**
 * Production worker bootstrap: wires the Prisma repositories + the built-in App
 * registry into a BullMQ worker listening on the executions queue.
 *
 *   pnpm --filter @cyflow/worker start
 *
 * Needs Postgres + Redis (see docker-compose.yml) and DATABASE_URL / REDIS_URL.
 */
import { createDefaultRegistry } from "engine";
import { connectorApps } from "@cyflow/connectors";
import { createPrismaRepositories, PrismaConnectionStore, PrismaDataStore, prisma } from "@cyflow/db";
import { ConnectionService, encryptionFromEnv } from "@cyflow/connections";
import { createExecutionsQueue, createExecutionWorker, enqueueRun, EXECUTIONS_QUEUE } from "./queue";
import { createScheduler, type SchedulerScenario } from "./scheduler";

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  };
}

function main(): void {
  const { scenarios, executions } = createPrismaRepositories();
  const registry = createDefaultRegistry();
  // Register the Phase 9 connectors (Telegram, OpenAI, Gmail, Sheets, Slack).
  for (const app of connectorApps) registry.registerApp(app);

  // Connections vault: decrypts a module's credentials at run time only.
  const connections = new ConnectionService(new PrismaConnectionStore(prisma), encryptionFromEnv());

  const worker = createExecutionWorker(redisConnection(), {
    scenarios,
    executions,
    registry,
    getConnection: connections.toGetConnection(),
    dataStore: new PrismaDataStore(prisma),
  });

  worker.on("completed", (job) => {
    console.log(`[worker] execution completed for scenario ${job.data.scenarioId}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker] execution failed for scenario ${job?.data.scenarioId}:`, err.message);
  });

  // Interval schedule runner: enqueue "every X minutes" scenarios when due.
  const queue = createExecutionsQueue(redisConnection());
  const scheduler = createScheduler({
    tickMs: Number(process.env.SCHEDULER_TICK_MS ?? 60_000),
    load: async (): Promise<SchedulerScenario[]> => {
      const rows = await prisma.scenario.findMany({ where: { status: "ACTIVE" }, select: { id: true, schedule: true } });
      const out: SchedulerScenario[] = [];
      for (const r of rows) {
        const last = await prisma.execution.findFirst({
          where: { scenarioId: r.id },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true },
        });
        out.push({ id: r.id, schedule: r.schedule, lastRunAt: last?.startedAt ?? null });
      }
      return out;
    },
    enqueue: async (scenarioId) => {
      await enqueueRun(queue, { scenarioId, triggerBundles: [{ trigger: "schedule", at: new Date().toISOString() }] });
      console.log(`[scheduler] enqueued scheduled run for scenario ${scenarioId}`);
    },
  });
  scheduler.start();

  console.log(`[worker] listening on queue "${EXECUTIONS_QUEUE}" (+ interval scheduler)`);
}

main();
