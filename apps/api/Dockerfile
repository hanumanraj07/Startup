# Built from the REPO ROOT, not this directory:
#   docker build -f apps/api/Dockerfile -t onsite-api .
# Needed because this is a pnpm workspace: apps/api depends on packages/*
# (types, validation, money, utils) by workspace reference, so pnpm install
# must see the whole monorepo, not just this app.
#
# One image serves both processes described in docs/05-system-architecture.md
# — ROLE=api for the HTTP/WebSocket process, ROLE=worker for the BullMQ
# consumers and sweeper — selected at container start, not at build time, so
# there is exactly one image to build, scan and promote through environments.

FROM node:22-alpine AS base
# Prisma's query engine needs OpenSSL; alpine does not ship it by default.
RUN apk add --no-cache openssl
RUN corepack enable

# ─── deps: install once, reused by both the build and (via prune) runtime stages ───
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/money/package.json packages/money/package.json
COPY packages/utils/package.json packages/utils/package.json
COPY packages/config/package.json packages/config/package.json
# Matches pnpm-workspace.yaml's onlyBuiltDependencies allow-list — this is a
# non-interactive build, so approval must be granted explicitly rather than
# through the interactive prompt `pnpm approve-builds` would otherwise show.
RUN pnpm install --frozen-lockfile

# ─── build: compile the API and the workspace packages it depends on ───
FROM deps AS build
WORKDIR /repo
COPY packages ./packages
COPY apps/api ./apps/api
# MUST run before `nest build`, not after — found by actually building this
# image, not by inspection. `@prisma/client`'s own postinstall already ran
# once, back in the `deps` stage, but at that point only package.json files
# existed in this image (deliberately, so the dependency-install layer stays
# cached across source-only changes) — no prisma/schema.prisma yet — so it
# silently generated an empty stub client with no `User`, `Task`, `Prisma.sql`,
# or any other real type. `nest build` run against that stub failed with 76
# unrelated-looking TypeScript errors (implicit `any` everywhere a Prisma
# result was destructured, missing exports) that have nothing to do with the
# application code and everything to do with generating against the real
# schema, which only exists from this COPY onward.
RUN pnpm --filter @onsite/api exec prisma generate
RUN pnpm --filter @onsite/api... run build

# ─── runtime: only what running the compiled output needs ───
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json

WORKDIR /repo/apps/api
# Runs as node, never root — this stage installs nothing further.
USER node

# Overridden to `worker` for the background-process deployment; see
# docs/05-system-architecture.md's two-process split.
ENV ROLE=api
EXPOSE 4000

# Liveness only (no dependency checks) per docs/20's health-check split —
# readiness (/health/ready) is what should gate traffic/rollout, checked by
# the orchestrator's own readiness probe against this same port, not here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/main.js"]
