# web と ops の image。compose.yml の web / ops が target: runtime でビルドする。
FROM docker.io/library/node:26-alpine AS base
WORKDIR /kura

# --- deps: devDependencies を含む依存 package。SPA のビルドに使う ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- prod-deps: runtime が import する依存 package だけ ---
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# --- build: SPA の静的ビルド ---
FROM deps AS build
# デプロイ固有の設定は bundle に埋め込まれる。vite.config.ts が読む値だけを
# 受け取り、secret は渡さない。
ARG KURA_OIDC_ISSUER
ARG KURA_OIDC_CLIENT_ID
ARG KURA_S3_ENDPOINT
ARG KURA_FILE_TTL_DAYS
ARG KURA_QUOTA_DEFAULT_MB
ARG KURA_UI_ORIGIN
ARG KURA_NOINDEX
COPY . .
RUN npm run build

# --- runtime: web（SPA の配信）と ops（日次運用タスク）---
FROM base AS runtime
# どちらも node で .ts を直接実行し、npm を使わない
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# "type": "module" が scripts/*.ts を ESM として読ませる
COPY package.json ./
COPY --from=prod-deps /kura/node_modules ./node_modules
COPY --from=build /kura/build/client ./build/client
COPY scripts ./scripts
# scripts/ が import する app のファイル
COPY app/lib/s3/paginate.ts app/lib/s3/seaweedfs-compat.ts ./app/lib/s3/
COPY app/lib/crawl.ts ./app/lib/
USER node
