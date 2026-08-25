FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    curl \
    git \
    jq \
    postgresql-client \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

USER node
RUN corepack enable
