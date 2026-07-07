# Cyflow API — build from the repo root:
#   docker build -f apps/api/Dockerfile -t cyflow-api .
# Runs via tsx (no compile step). Applies DB migrations on boot, then serves.
FROM node:20-slim

RUN corepack enable
WORKDIR /app

# Install the whole workspace (api needs engine, connectors, connections, db).
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @cyflow/db generate

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Apply migrations (idempotent) then start the API. In-memory mode if DATABASE_URL is unset.
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then pnpm --filter @cyflow/db deploy; fi && pnpm --filter @cyflow/api start"]
