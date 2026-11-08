# The PWA, built and served by Caddy together with the API behind one origin (OS-224).
# Build from the repository root: docker build -f apps/web/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
# Manifests first, so code changes reuse the dependencies layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile-poc/package.json apps/mobile-poc/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile --filter @zankup/web...
COPY packages/core packages/core
COPY apps/web apps/web
RUN pnpm --filter @zankup/web build

FROM caddy:2.10-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
