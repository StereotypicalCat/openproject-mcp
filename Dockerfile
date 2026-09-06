# Stage 1: Dependency resolution and production prune
FROM oven/bun:1-slim AS builder
WORKDIR /app

# Copy dependency manifests
COPY package.json bun.lock ./

# Install production dependencies only with strict lockfile
RUN bun install --frozen-lockfile --production

# Stage 2: Minimal runtime image
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy installed production node_modules from builder
COPY --chown=bun:bun --from=builder /app/node_modules ./node_modules

# Copy application configuration and source code
COPY --chown=bun:bun package.json tsconfig.json ./
COPY --chown=bun:bun src ./src

# Drop root privileges
USER bun

# Standard MCP stdio communication
ENTRYPOINT ["bun", "run", "src/index.ts"]
