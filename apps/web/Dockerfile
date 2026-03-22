# ---- Base ----
FROM oven/bun:1 AS base
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps

# Copy workspace root files
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN bun install

# ---- Build shared package ----
FROM deps AS shared-build
COPY packages/shared ./packages/shared
COPY tsconfig.base.json ./
RUN cd packages/shared && bun run build

# ---- Build web app ----
FROM shared-build AS build

COPY apps/web ./apps/web

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN cd apps/web && bun run build

# ---- Production: serve static files ----
FROM oven/bun:1-alpine AS production
WORKDIR /app

RUN bun add serve

COPY --from=build /app/apps/web/dist ./dist

EXPOSE 3000

CMD ["bunx", "serve", "dist", "-s", "-l", "3000"]
