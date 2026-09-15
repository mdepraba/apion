# syntax=docker/dockerfile:1

# PRD 07 and 08: CI builds and pushes, the host only pulls and restarts. Nothing
# in this file is meant to run on the 1 GB target.

# Every workspace manifest, and nothing else, so editing source does not
# invalidate an install layer. Both installs below start from this.
FROM oven/bun:1 AS manifests
WORKDIR /src
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY libs/contracts/package.json libs/contracts/
COPY libs/db/package.json libs/db/
COPY libs/domain/package.json libs/domain/
COPY libs/mock-engine/package.json libs/mock-engine/
COPY libs/response-standard/package.json libs/response-standard/
COPY libs/spec-openapi/package.json libs/spec-openapi/

# What the runtime image carries: no devDependencies, no workspace sources.
FROM manifests AS prod-deps
RUN bun install --frozen-lockfile --production

# Bun installs and runs the API, but Nx, esbuild and Vite still spawn node, so
# the build stage needs both. bun ships as a single static binary, and bunx is a
# symlink to it rather than a second binary.
FROM node:24-bookworm-slim AS build
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /src

# bun links each workspace package into the *depending project's*
# node_modules, not the root one, so the install has to happen in this stage.
# Copying only the root node_modules out of another stage leaves every
# `@apion/*` import unresolvable.
COPY --from=manifests /src /src
RUN bun install --frozen-lockfile

COPY . .
RUN bunx nx run @apion/api:build:production \
 && bunx nx run @apion/api:migrate \
 && bunx nx run @apion/web:build

FROM oven/bun:1 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_PATH=/app/web \
    MIGRATIONS_FOLDER=/app/migrations

# The bundle is ESM and esbuild leaves third-party imports external, so the
# runtime carries node_modules and a manifest that marks the module type.
# Workspace libraries are bundled in and never resolved here.
COPY --from=prod-deps /src/node_modules ./node_modules
RUN echo '{"type":"module"}' > package.json

COPY --from=build /src/apps/api/dist/main.js ./main.js
COPY --from=build /src/apps/api/dist-migrate/migrate.js ./migrate.js
COPY --from=build /src/apps/web/dist ./web
COPY libs/db/migrations ./migrations

USER bun
EXPOSE 3000

# /health is unauthenticated and checks the database, which is what a restart
# gate wants to know. Run through bun rather than adding curl to the image.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["bun", "--smol", "main.js"]
