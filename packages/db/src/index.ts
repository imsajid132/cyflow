import type { ExecutionRepository, ScenarioRepository } from "@cyflow/shared";
import { prisma, PrismaClient } from "./client";
import { PrismaScenarioRepository } from "./repositories/scenario";
import { PrismaExecutionRepository } from "./repositories/execution";

export { prisma, PrismaClient } from "./client";
export { PrismaScenarioRepository } from "./repositories/scenario";
export { PrismaExecutionRepository } from "./repositories/execution";

export interface Repositories {
  scenarios: ScenarioRepository;
  executions: ExecutionRepository;
}

/** Build the Prisma-backed repository set the worker injects into the engine. */
export function createPrismaRepositories(client: PrismaClient = prisma): Repositories {
  return {
    scenarios: new PrismaScenarioRepository(client),
    executions: new PrismaExecutionRepository(client),
  };
}
