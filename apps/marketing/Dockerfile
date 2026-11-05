# @input  -- the monorepo root as build context; four NEXT_PUBLIC_* build args
# @output -- a self-hosted gengrowth.ai image: Next standalone server on PORT (default 3001)
# @pos    -- marketing's container build for the Tencent Cloud move; Vercel builds without it
# 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
#
# Build from the repository root:
#   docker build -f apps/marketing/Dockerfile \
#     --build-arg NEXT_PUBLIC_APP_URL=... --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
#     -t gengrowth-marketing:<sha> .
# Server-side variables are runtime only (`docker run --env-file`); the build reads none.
# No `RUN --mount`, so the legacy builder and BuildKit both accept this file.

FROM node:24-bookworm-slim AS deps

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
WORKDIR /app

# Same pins as Dockerfile.worker: Corepack here, pnpm@10.32.1 in package.json.
RUN npm install --global corepack@0.34.5 && corepack enable pnpm

# Only the workspaces marketing builds from: marketing → public-tools → sources
# → contracts. pnpm accepts the full lockfile with the other importers absent,
# as the worker image already relies on.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches/ patches/
COPY apps/marketing/package.json apps/marketing/package.json
COPY packages/public-tools/package.json packages/public-tools/package.json
COPY packages/sources/package.json packages/sources/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/sources packages/sources
COPY packages/public-tools packages/public-tools
COPY apps/marketing apps/marketing

# NEXT_PUBLIC_* are inlined into the client bundle at build time; setting them
# at runtime changes nothing. An empty value would ship a bundle with no
# Supabase or Google client, so the build refuses one instead.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1
RUN for name in NEXT_PUBLIC_APP_URL NEXT_PUBLIC_GOOGLE_CLIENT_ID \
      NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY; do \
      eval "value=\${$name}"; \
      if [ -z "$value" ]; then echo "missing build arg $name" >&2; exit 1; fi; \
    done

RUN pnpm --filter @sf/marketing build

# Next's file tracing follows require() but not the dlopen() inside sharp's
# native addon, so standalone gets libvips' package.json without
# libvips-cpp.so, and /_next/image then serves every original unresized with
# no error logged. Copy sharp's platform packages whole; the glob covers
# whichever architecture this build runs on.
RUN for dir in /app/node_modules/.pnpm/@img+sharp-*; do \
      cp -a "$dir" apps/marketing/.next/standalone/node_modules/.pnpm/; \
    done

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3001
WORKDIR /app

# The tracing root is the monorepo root, so the server lands at
# apps/marketing/server.js and chdirs there. Standalone output leaves out
# static assets and public/, and the content loaders read content/ relative to
# that working directory, so all three are copied next to it. Everything is
# owned by `node` because ISR and /_next/image write under .next/cache.
COPY --from=build --chown=node:node /app/apps/marketing/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/marketing/.next/static ./apps/marketing/.next/static
COPY --from=build --chown=node:node /app/apps/marketing/public ./apps/marketing/public
COPY --from=build --chown=node:node /app/apps/marketing/content ./apps/marketing/content

# Load sharp the way Next's image optimizer does, so a missing native library
# fails the build instead of silently disabling image optimization.
RUN cd apps/marketing && node -e "require(require.resolve('sharp', { paths: [require('node:path').dirname(require.resolve('next/package.json'))] }))"

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/robots.txt').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Node is PID 1 so the container's SIGTERM reaches Next's shutdown handler.
CMD ["node", "apps/marketing/server.js"]
