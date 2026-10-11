# Build from the monorepo root:
#   docker build -f artifacts/api-server/Dockerfile -t creditsea-api .
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.3 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json artifacts/api-server/
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.34.3 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json artifacts/api-server/
COPY lib ./lib
COPY --from=build /app/artifacts/api-server/dist ./artifacts/api-server/dist
RUN pnpm install --frozen-lockfile --prod --filter @workspace/api-server...
WORKDIR /app/artifacts/api-server
EXPOSE 8080
ENV PORT=8080
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
