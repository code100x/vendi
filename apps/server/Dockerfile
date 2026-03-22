# ---- Base ----
FROM oven/bun:1 AS base
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps

# Copy workspace root files
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Install all dependencies (including devDependencies for prisma generate)
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

# Copy workspace structure for resolution
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Copy built artifacts
COPY --from=shared-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/node_modules/.prisma ./apps/server/node_modules/.prisma
COPY apps/server/prisma ./apps/server/prisma

EXPOSE 4000

CMD ["bun", "apps/server/dist/index.js"]
