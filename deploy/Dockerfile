# One stage per service, not one image for all of them.
#
# The previous single runtime copied the whole build stage into every image: 2.96 GB each, of
# which the API executed 324 kB. Every image carried the toolchain of all eleven workspaces
# and, worse, each other's dependencies - the API and the worker both shipped Next.js and its
# 250 MB of platform binaries, which neither of them loads.
#
# Each service now gets its own runtime with its own production dependency closure.

FROM node:26.7-alpine AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
# Node 25 removed corepack from the distribution, so the package manager this image builds with
# has to be fetched rather than switched on. The version is read from `packageManager` rather than
# written again here: two places naming the pnpm that builds our images is one place to get it
# wrong, which is the same reasoning as `apps/api/src/version.ts`.
#
# `--ignore-scripts` is the part that matters. Fetching a package is the moment a lifecycle script
# would run, and a build stage is a bad place to run somebody else's. It reaches no runtime stage
# in any case: those start from a clean `node` and never see a package manager.
RUN npm install -g --ignore-scripts "pnpm@$(node -p 'require("./package.json").packageManager.split("@")[1]')"
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
# Which build this is, when several share a version number. Declared here rather than in a runtime
# stage because it is stamped into the bundle by tsup, not read at boot: the runtime carries no
# manifest and no git. Absent on a plain `docker compose build`, and `src/version.ts` reports
# `development` for that rather than guessing.
ARG CONTROL_HUB_BUILD=""
ENV CONTROL_HUB_BUILD=$CONTROL_HUB_BUILD
# Where the web tier reaches the API, and it has to be here rather than only on the running
# container. `apps/web/next.config.ts` proxies `/api` and `/health` through a Next rewrite, and a
# rewrite destination is resolved when the bundle is compiled: whatever this says is written into
# the route manifest and no environment variable changes it afterwards. Supplying it only at
# runtime reaches `apps/web/src/lib/api.ts`, which is a different code path -- server-side fetches
# worked, which is exactly why this took a real installation to find.
#
# Built without it, the image fell back to `http://127.0.0.1:4000` and proxied every browser
# request to `/api` at itself. It matches `compose.yaml`, and `scripts/container-secrets.test.mjs`
# holds the two together.
ENV API_INTERNAL_URL=http://api:4000
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

FROM node:26.7-alpine AS runtime
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
COPY --chmod=0555 --chown=node:node deploy/load-secret-and-exec.sh /usr/local/bin/load-secret-and-exec
CMD ["load-secret-and-exec", "MIGRATION_DATABASE_URL", "node", "dist/migrate.js"]

FROM runtime AS web
# Next's standalone output already carries the only dependencies it needs.
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone/. ./
ENV HOSTNAME=0.0.0.0
ENV PORT=3001
CMD ["node", "apps/web/server.js"]
