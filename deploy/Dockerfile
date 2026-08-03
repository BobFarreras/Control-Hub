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

FROM node:22.16-alpine AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY --from=builder --chown=node:node /app /app
USER node
ARG APP
ENV CONTROL_HUB_APP=$APP
CMD ["sh", "-c", "if [ \"$CONTROL_HUB_APP\" = web ]; then HOSTNAME=0.0.0.0 PORT=3001 node apps/web/.next/standalone/apps/web/server.js; else pnpm --filter @control-hub/$CONTROL_HUB_APP start; fi"]
