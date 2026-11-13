# Universal Checkout — Cloud Run (HTTPS *.run.app). Web + settlement worker via `pnpm start`.
FROM node:22-bookworm-slim AS base
RUN apt-get update -qq && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json .nvmrc ./
COPY apps/web apps/web
COPY packages packages
COPY services/settlement services/settlement
COPY scripts scripts
COPY contracts/artifacts contracts/artifacts
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @uc/db exec prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @uc/web build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=8080
# Litestream keeps the SQLite database across deploys (see scripts/cloudrun-entrypoint.sh, docs/gcp-cloud-run.md).
ARG LITESTREAM_VERSION=0.3.13
ARG TARGETARCH=amd64
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${TARGETARCH}.tar.gz /tmp/litestream.tgz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tgz litestream && rm /tmp/litestream.tgz && litestream version
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p .uc
EXPOSE 8080
CMD ["sh", "/app/scripts/cloudrun-entrypoint.sh"]
