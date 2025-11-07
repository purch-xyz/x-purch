# syntax=docker/dockerfile:1

### Dependency layers -------------------------------------------------------
FROM oven/bun:1-alpine AS base
WORKDIR /app
COPY bun.lock package.json ./

# Full dependency set (dev + prod) for builds/tests
FROM base AS deps
RUN bun install --frozen-lockfile

# Production-only dependencies for the runtime image
FROM deps AS prod-deps
RUN bun install --frozen-lockfile --production

### Build layer -------------------------------------------------------------
FROM deps AS builder
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
# Bundle TypeScript to optimized JavaScript output
RUN bun build src/index.ts --outdir=dist --target=bun

### Runtime -----------------------------------------------------------------
FROM oven/bun:1-alpine AS runtime
WORKDIR /app

# Install runtime tooling
RUN apk add --no-cache dumb-init curl

# Non-root user for better container security
RUN addgroup -g 1001 -S app && adduser -S app -G app -u 1001

# Copy production dependencies and compiled app
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=prod-deps --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/dist ./dist

USER app

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:${PORT:-8080}/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["bun", "dist/index.js"]
