FROM node:24.12.0-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
RUN npm install --global pnpm@10.32.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/sources/package.json ./packages/sources/package.json
COPY packages/public-tools/package.json ./packages/public-tools/package.json
COPY apps/marketing/package.json ./apps/marketing/package.json
RUN pnpm install --frozen-lockfile --filter @sf/marketing... --filter signalframe-mvp-app
RUN pnpm exec playwright install --with-deps chromium
COPY packages/contracts/src ./packages/contracts/src
COPY packages/sources/src ./packages/sources/src
COPY packages/public-tools/src ./packages/public-tools/src
COPY apps/marketing/src/lib/geo-tools/citability-*.ts ./apps/marketing/src/lib/geo-tools/
COPY apps/marketing/scripts/citability-renderer*.ts ./apps/marketing/scripts/
COPY vitest.config.ts tsconfig.base.json ./
USER 1000:1000
ENV NODE_ENV=production
ENV CITABILITY_RENDERER_HOST=0.0.0.0
EXPOSE 4318
CMD ["pnpm", "exec", "tsx", "apps/marketing/scripts/citability-renderer.ts"]
