# syntax=docker/dockerfile:1
#
# Assenの本番用Dockerfile。既定ターゲットは`runtime`（MCPサーバー本体）。
# マイグレーション実行用に`migrator`ターゲットも用意する（Cloud Run Jobs等でCMDを差し替えて使う想定）。
# ビルド例:
#   docker build --target runtime -t assen:latest .
#   docker build --target migrator -t assen-migrator:latest .
#   docker build --target outbox-worker -t assen-outbox-worker:latest .
#
# Production Dockerfile for Assen. The default target is `runtime` (the MCP server itself).
# `migrator` and `outbox-worker` targets are also provided (intended for Cloud Run Jobs/services with CMD overridden).
# Build examples:
#   docker build --target runtime -t assen:latest .
#   docker build --target migrator -t assen-migrator:latest .
#   docker build --target outbox-worker -t assen-outbox-worker:latest .
#
# Dockerfile produksi untuk Assen. Target default adalah `runtime` (server MCP itu sendiri).
# Target `migrator` dan `outbox-worker` juga disediakan (untuk Cloud Run Jobs/services dengan CMD di-override).
# Contoh build:
#   docker build --target runtime -t assen:latest .
#   docker build --target migrator -t assen-migrator:latest .
#   docker build --target outbox-worker -t assen-outbox-worker:latest .

# ---- deps: 全依存関係をインストール（ビルド・マイグレーションに使う） / Install all dependencies (used for building and migrations) / Instal semua dependency (digunakan untuk build dan migrasi) ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: TypeScriptをコンパイルしてdist/を生成 / Compile TypeScript into dist/ / Kompilasi TypeScript menjadi dist/ ----
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY legal ./legal
COPY test ./test
RUN pnpm run build

# ---- prod-deps: devDependenciesを含まない軽量node_modules（runtime専用） / Lean node_modules without devDependencies (runtime only) / node_modules ringan tanpa devDependencies (khusus runtime) ----
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# ---- runtime: Assen MCPサーバーの本番実行イメージ（既定ターゲット） / Assen MCP server production runtime image (default target) / Image runtime produksi server MCP Assen (target default) ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S assen && adduser -S assen -G assen
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# legal/はJSON/テキストのデータファイルでtscに変換されないため、distとは別にそのまま配置する
# legal/ holds JSON/text data files that tsc does not transform, so it's placed alongside dist rather than inside it
# legal/ berisi file data JSON/teks yang tidak diubah oleh tsc, sehingga ditempatkan bersama dist, bukan di dalamnya
COPY --from=build /app/legal ./legal
COPY package.json ./
USER assen
EXPOSE 8080
CMD ["node", "dist/src/server.js"]

# ---- migrator: `pnpm run db:migrate`専用イメージ（tsx・srcを含む。Cloud Run JobsでCMDを差し替えて使う） / Image dedicated to `pnpm run db:migrate` (includes tsx/src; override CMD for Cloud Run Jobs) / Image khusus untuk `pnpm run db:migrate` (menyertakan tsx/src; override CMD untuk Cloud Run Jobs) ----
FROM deps AS migrator
ENV NODE_ENV=production
COPY src ./src
COPY legal ./legal
CMD ["pnpm", "run", "db:migrate"]

# ---- outbox-worker: transactional outboxの常駐ポーリングworker。legal/は不要（documents/templatesを扱わないため）。
# ⚠️ M1時点ではeventType handlerが未登録。M2でhandlerを登録するまで本番スケジューラへ接続しないこと（src/services/outbox-worker/run.ts参照）
# ---- outbox-worker: long-running poller for the transactional outbox. legal/ is not needed (does not handle documents/templates).
# ⚠️ As of M1 no eventType handlers are registered. Do not wire this into a production scheduler until M2 registers handlers (see src/services/outbox-worker/run.ts)
# ---- outbox-worker: poller yang berjalan terus untuk transactional outbox. legal/ tidak diperlukan (tidak menangani documents/templates).
# ⚠️ Pada M1 belum ada handler eventType yang terdaftar. Jangan hubungkan ini ke scheduler produksi sampai M2 mendaftarkan handler (lihat src/services/outbox-worker/run.ts)
FROM node:20-alpine AS outbox-worker
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S assen && adduser -S assen -G assen
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER assen
CMD ["node", "dist/src/services/outbox-worker/run.js"]
