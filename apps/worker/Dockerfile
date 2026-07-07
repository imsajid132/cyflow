# Cyflow Worker — build from the repo root:
#   docker build -f apps/worker/Dockerfile -t cyflow-worker .
# Runs scheduled scenarios + the BullMQ execution queue. Needs DATABASE_URL,
# REDIS_URL, CYFLOW_ENCRYPTION_KEY. Migrations are owned by the API service.
FROM node:20-slim

RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @cyflow/db generate

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@cyflow/worker", "start"]
