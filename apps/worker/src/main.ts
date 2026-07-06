/**
 * Production worker bootstrap: wires the Prisma repositories + the built-in App
 * registry into a BullMQ worker listening on the executions queue.
 *
 *   pnpm --filter @cyflow/worker start
 *
 * Needs Postgres + Redis (see docker-compose.yml) and DATABASE_URL / REDIS_URL.
 */
import { createDefaultRegistry } from "engine";
import { createPrismaRepositories, PrismaConnectionStore, PrismaDataStore, prisma } from "@cyflow/db";
import { ConnectionService, encryptionFromEnv } from "@cyflow/connections";
import { createExecutionWorker, EXECUTIONS_QUEUE } from "./queue";

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

  console.log(`[worker] listening on queue "${EXECUTIONS_QUEUE}"`);
}

main();
