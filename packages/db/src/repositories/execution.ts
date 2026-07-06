import { Prisma, type PrismaClient, type ExecutionStatus } from "@prisma/client";
import type {
  Bundle,
  CompleteExecutionInput,
  ExecutionRepository,
  StoredExecution,
  StoredExecutionStep,
} from "@cyflow/shared";

type ExecutionRow = {
  id: string;
  scenarioId: string;
  status: ExecutionStatus;
  operations: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

type StepRow = {
  moduleNodeId: string;
  status: string;
  operations: number;
  input: Prisma.JsonValue;
  output: Prisma.JsonValue;
  error: string | null;
  ms: number;
  order: number;
};

/** Prisma-backed execution persistence: start RUNNING, complete with steps. */
export class PrismaExecutionRepository implements ExecutionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async start(scenarioId: string): Promise<StoredExecution> {
    const row = await this.prisma.execution.create({
      data: { scenarioId, status: "RUNNING" },
    });
    return this.toStored(row, []);
  }

  async complete(executionId: string, input: CompleteExecutionInput): Promise<StoredExecution> {
    const row = await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status: input.status,
        operations: input.operations,
        error: input.error ?? null,
        finishedAt: new Date(),
        steps: {
          create: input.steps.map((s) => ({
            moduleNodeId: s.moduleNodeId,
            status: s.status,
            operations: s.operations,
            input: s.input as unknown as Prisma.InputJsonValue,
            output: s.output as unknown as Prisma.InputJsonValue,
            error: s.error ?? null,
            ms: s.ms,
            order: s.order,
          })),
        },
      },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    return this.toStored(row, row.steps);
  }

  async findById(id: string): Promise<StoredExecution | null> {
    const row = await this.prisma.execution.findUnique({
      where: { id },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    return row ? this.toStored(row, row.steps) : null;
  }

  private toStored(row: ExecutionRow, steps: StepRow[]): StoredExecution {
    return {
      id: row.id,
      scenarioId: row.scenarioId,
      status: row.status,
      operations: row.operations,
      error: row.error,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      steps: steps.map(
        (s): StoredExecutionStep => ({
          moduleNodeId: s.moduleNodeId,
          status: s.status === "error" ? "error" : "success",
          operations: s.operations,
          input: (s.input as unknown as Bundle[]) ?? [],
          output: (s.output as unknown as Bundle[]) ?? [],
          error: s.error ?? undefined,
          ms: s.ms,
          order: s.order,
        }),
      ),
    };
  }
}
