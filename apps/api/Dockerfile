# Сборка из корня репозитория: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
# Манифесты всех пакетов workspace нужны, чтобы lockfile совпал (--frozen-lockfile).
# .npmrc (node-linker=hoisted для Expo) не копируем: с ним pnpm ставит в образ и
# зависимости мобильного приложения.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @blinkcode/api
COPY apps/api apps/api
RUN pnpm --filter @blinkcode/api build

FROM base AS runtime
ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod --filter @blinkcode/api && rm -rf /root/.local/share/pnpm /root/.cache
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
WORKDIR /app/apps/api
USER node
EXPOSE 3000
# Миграции идемпотентны и защищены advisory lock — безопасно запускать при каждом старте.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/server.js"]
