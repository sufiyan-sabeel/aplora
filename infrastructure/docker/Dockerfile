# Multi-stage build for the whole monorepo. Every service uses the same image and
# differs only in the command it runs.
FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=development

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
COPY infrastructure ./infrastructure

RUN npm install --no-audit --no-fund

# ---------------------------------------------------------------- build stage
FROM base AS build
ENV NODE_ENV=production
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
RUN npm run build --workspace @aplora/api && npm run build --workspace @aplora/worker
RUN npm run build:pages

# -------------------------------------------------------------- runtime stage
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 aplora

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services
COPY --from=build /app/apps ./apps
COPY --from=build /app/infrastructure ./infrastructure

RUN mkdir -p /data/storage && chown -R aplora:aplora /data
USER aplora

EXPOSE 4000
CMD ["node", "services/api/dist/server.js"]
