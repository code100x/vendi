# ---- Base ----
FROM oven/bun:1 AS base
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps

# Copy all workspace package.json files so lockfile matches
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

RUN bun install --frozen-lockfile

# ---- Build shared package ----
FROM deps AS shared-build
COPY packages/shared ./packages/shared
COPY tsconfig.base.json ./
RUN cd packages/shared && bun run build

# ---- Generate Prisma client & build server ----
FROM shared-build AS build
COPY apps/server ./apps/server
RUN cd apps/server && bunx prisma generate
RUN cd apps/server && bun run build

# ---- Production ----
FROM base AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=shared-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/node_modules/.prisma ./apps/server/node_modules/.prisma
COPY apps/server/prisma ./apps/server/prisma
COPY apps/server/package.json ./apps/server/
COPY package.json ./

EXPOSE 4000

CMD ["bun", "apps/server/dist/index.js"]
