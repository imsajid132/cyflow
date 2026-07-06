import { Prisma, type PrismaClient, type ScenarioStatus } from "@prisma/client";
import type {
  Blueprint,
  CreateScenarioInput,
  ScenarioRepository,
  StoredScenario,
} from "@cyflow/shared";

/** Prisma-backed scenario persistence. */
export class PrismaScenarioRepository implements ScenarioRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateScenarioInput): Promise<StoredScenario> {
    if (!input.userId) {
      throw new Error("PrismaScenarioRepository.create requires a userId");
    }

    // Mirror the blueprint's nodes into Module rows (canonical source stays the
    // blueprint JSON) so they can be queried/rendered without parsing JSON.
    const moduleRows = input.blueprint.modules.map((m, index) => ({
      nodeId: m.id,
      app: m.app,
      operation: m.operation,
      kind: m.kind,
      params: (m.params ?? {}) as Prisma.InputJsonValue,
      connectionId: m.connectionId ?? null,
      next: m.next ?? null,
      position: index,
    }));

    const created = await this.prisma.scenario.create({
      data: {
        id: input.id,
        userId: input.userId,
        name: input.name,
        status: (input.status as ScenarioStatus | undefined) ?? "DRAFT",
        blueprint: input.blueprint as unknown as Prisma.InputJsonValue,
        schedule:
          input.schedule === undefined
            ? Prisma.JsonNull
            : (input.schedule as Prisma.InputJsonValue),
        modules: { create: moduleRows },
      },
    });

    return this.toStored(created);
  }

  async findById(id: string): Promise<StoredScenario | null> {
    const row = await this.prisma.scenario.findUnique({ where: { id } });
    return row ? this.toStored(row) : null;
  }

  private toStored(row: {
    id: string;
    userId: string;
    name: string;
    status: ScenarioStatus;
    schedule: Prisma.JsonValue;
    blueprint: Prisma.JsonValue;
  }): StoredScenario {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      status: row.status,
      schedule: row.schedule ?? undefined,
      blueprint: row.blueprint as unknown as Blueprint,
    };
  }
}
