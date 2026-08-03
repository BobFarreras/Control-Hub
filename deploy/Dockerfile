FROM node:22.16-alpine AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
RUN pnpm build
RUN cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
# Build caches are worth gigabytes in the final image and nothing reads them at runtime.
RUN rm -rf /app/.turbo /app/apps/*/.turbo /app/packages/*/.turbo \
  /app/apps/web/.next/cache /app/node_modules/.cache

FROM node:22.16-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /app /app
USER node
ARG APP
ENV CONTROL_HUB_APP=$APP

# Every service starts with plain `node`. Going through pnpm meant corepack tried to fetch a
# package manager on boot, which needs both network access and a writable HOME; the containers
# run read-only, so the runtime image had never actually started. Everything here is already
# compiled at build time, so the package manager has no job left to do.
CMD ["sh", "-c", "case \"$CONTROL_HUB_APP\" in \
  web) exec env HOSTNAME=0.0.0.0 PORT=3001 node apps/web/.next/standalone/apps/web/server.js ;; \
  api) exec node apps/api/dist/server.js ;; \
  worker) exec node apps/worker/dist/index.js ;; \
  database) exec node packages/database/dist/migrate.js ;; \
  *) echo \"CONTROL_HUB_APP must be web, api, worker or database; got '$CONTROL_HUB_APP'\" >&2; exit 1 ;; \
  esac"]
