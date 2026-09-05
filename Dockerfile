# ─── Stage 1: build the Vite frontend ────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install all deps (incl. dev) for the build step. `.npmrc` carries
# `legacy-peer-deps=true` to work around the eslint v10 vs
# eslint-plugin-react-hooks peer-dep mismatch (lint-only, unused at build/runtime).
COPY package*.json .npmrc ./
RUN npm ci

COPY . .

# Skip Puppeteer's bundled Chromium download in the builder — we don't need a
# browser at build time and it cuts ~150 MB off the layer.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN npm run build

# Prune to production-only modules for the runtime stage.
RUN npm prune --omit=dev


# ─── Stage 2: slim runtime with system Chromium ──────────────────────────────
FROM node:20-slim AS runtime

# Chromium + minimum dependency set required by puppeteer-extra-stealth.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      ca-certificates \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

WORKDIR /app

# Copy production deps + built artefacts + server sources.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

ENV NODE_ENV=production
ENV PORT=8080
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Cloud Run mounts /tmp as tmpfs; let Chromium use it for shared memory.
ENV CHROMIUM_FLAGS="--no-sandbox --disable-dev-shm-usage"

# Run as the unprivileged "node" user that ships with the base image.
RUN chown -R node:node /app
USER node

EXPOSE 8080

# `tsx` is shipped as a runtime dep (see package.json) so we can execute the
# TypeScript entrypoint without a separate compile step for the server.
CMD ["npx", "--no", "tsx", "server.ts"]
