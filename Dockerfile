# Multi-stage: the builder carries the C++ toolchain to compile better-sqlite3's
# native addon; the runtime stage copies the built node_modules, staying lean.
FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# --omit=dev drops @atproto/crypto (smoke-test only). Install scripts run so
# better-sqlite3 compiles its native binary against this Node ABI.
RUN npm ci --omit=dev

FROM node:24-bookworm-slim

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js sqlite-db.js ./

ENV NODE_ENV=production
ENV PORT=3000
# The sqlite file lives on a mounted volume so operations survive redeploys.
ENV PLC_DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "server.js"]
