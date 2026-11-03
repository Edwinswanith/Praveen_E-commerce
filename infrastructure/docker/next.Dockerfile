# syntax=docker/dockerfile:1.7
# Builds either Next.js app (ARG APP=storefront|admin) using standalone output.
FROM node:22-bookworm-slim AS build
ARG APP
ARG API_URL=http://api:4000
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json ./
COPY packages ./packages
COPY apps/$APP ./apps/$APP
RUN pnpm install --frozen-lockfile --filter @vyra/$APP...
RUN pnpm --filter @vyra/shared build && pnpm --filter @vyra/$APP build

FROM node:22-bookworm-slim AS runtime
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/$APP/.next/standalone ./
COPY --from=build /repo/apps/$APP/.next/static ./apps/$APP/.next/static
COPY --from=build /repo/apps/$APP/public* ./apps/$APP/public/
ENV APP_DIR=apps/$APP
USER node
CMD ["sh", "-c", "node $APP_DIR/server.js"]
