import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import { runScenarioJob, type RunJob, type WorkerDeps } from "./processor";

export const EXECUTIONS_QUEUE = "cyflow-executions";

/** Create the executions queue (producer side). */
export function createExecutionsQueue(connection: ConnectionOptions): Queue<RunJob> {
  return new Queue<RunJob>(EXECUTIONS_QUEUE, { connection });
}

/**
 * Producer: enqueue a run-once execution (the manual "Run once" button or an
 * instant webhook). Retries with exponential backoff (Phase 3 auto-retry).
 */
export function enqueueRun(queue: Queue<RunJob>, job: RunJob) {
  return queue.add("run-once", job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

/**
 * Basic interval scheduler: a repeatable job every N minutes for a scenario
 * (Make's "every X min"). A stable jobId keeps one schedule per scenario.
 */
export function scheduleInterval(queue: Queue<RunJob>, job: RunJob, everyMinutes: number) {
  return queue.add("interval", job, {
    repeat: { every: everyMinutes * 60_000 },
    jobId: `interval:${job.scenarioId}`,
  });
}

/**
 * The consumer: a BullMQ worker that runs each job through the engine via
 * `runScenarioJob`. All business logic lives in the processor; this is transport.
 */
export function createExecutionWorker(connection: ConnectionOptions, deps: WorkerDeps): Worker<RunJob> {
  return new Worker<RunJob>(
    EXECUTIONS_QUEUE,
    async (job: Job<RunJob>) => {
      await runScenarioJob(job.data, deps);
    },
    { connection },
  );
}
