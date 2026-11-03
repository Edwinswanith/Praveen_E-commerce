# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @vyra/api...
RUN pnpm --filter @vyra/shared build && pnpm --filter @vyra/api build
RUN pnpm deploy --filter @vyra/api --prod --legacy /out && cp -r apps/api/dist apps/api/prisma /out/ \
 && cd /out && npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 4000
CMD ["node", "dist/src/main.js"]
