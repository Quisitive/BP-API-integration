# ---------------------------------------------------------------------------
# Multi-stage Dockerfile — Unified SOC Dashboard
# ---------------------------------------------------------------------------
# Stage 1: Build React SPA (Vite) + Backend (TypeScript)
# Stage 2: Production runtime (Node.js only, no devDeps)
# ---------------------------------------------------------------------------

# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY public/ ./public/
COPY src/ ./src/
COPY config/ ./config/

# Build frontend (Vite → dist/) and backend (tsc → dist-server/)
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy build artifacts from builder
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/dist-server/ ./dist-server/
COPY config/ ./config/

# Legacy server preserved for backward compat
COPY server.js ./
COPY build/ ./build/

EXPOSE 7071
CMD ["node", "dist-server/backend/server.js"]
