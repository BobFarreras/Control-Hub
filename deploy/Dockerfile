# One stage per service, not one image for all of them.
#
# The previous single runtime copied the whole build stage into every image: 2.96 GB each, of
# which the API executed 324 kB. Every image carried the toolchain of all eleven workspaces
# and, worse, each other's dependencies - the API and the worker both shipped Next.js and its
# 250 MB of platform binaries, which neither of them loads.
#
# Each service now gets its own runtime with its own production dependency closure.

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
# The standalone output expects the static assets beside it rather than in .next.
RUN cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

# Production-only trees, one per service, so no runtime carries a dev dependency.
#
# `pnpm deploy` flattens a package and its production closure into a single node_modules,
# which is what a runtime needs: pnpm's workspace layout puts each project's dependencies in
# its own directory and links them back to a shared store, and those links do not survive
# being copied into a different path.
#
# It does copy more of the store than the filter implies, which is why the API image is still
# larger than its own closure. Documented in docs/phase-5-preflight-audit.md.
FROM builder AS pruned
RUN pnpm deploy --filter @control-hub/api --prod --legacy /out/api   && pnpm deploy --filter @control-hub/worker --prod --legacy /out/worker   && pnpm deploy --filter @control-hub/database --prod --legacy /out/database

FROM node:22.16-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
USER node

# Services start with plain `node`. Going through a package manager meant corepack tried to
# download one on boot, which needs network access and a writable HOME while the containers
# run read-only, so the image had never started at all.

FROM runtime AS api
COPY --from=pruned --chown=node:node /out/api/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/api/dist ./dist
CMD ["node", "dist/server.js"]

FROM runtime AS worker
COPY --from=pruned --chown=node:node /out/worker/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/worker/dist ./dist
CMD ["node", "dist/index.js"]

FROM runtime AS migrate
COPY --from=pruned --chown=node:node /out/database/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages/database/dist ./dist
# migrate.js resolves the directory relative to itself, so it must sit beside dist.
COPY --from=builder --chown=node:node /app/packages/database/migrations ./migrations
CMD ["node", "dist/migrate.js"]

FROM runtime AS web
# Next's standalone output already carries the only dependencies it needs.
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone/. ./
ENV HOSTNAME=0.0.0.0
ENV PORT=3001
CMD ["node", "apps/web/server.js"]
