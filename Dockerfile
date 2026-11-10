# Override if Docker Hub is unreachable, e.g.
#   docker build --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-alpine .
ARG NODE_IMAGE=node:22-alpine

# ---- build the web client ----
FROM ${NODE_IMAGE} AS client
WORKDIR /app
COPY shared ./shared
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci --no-audit --no-fund
COPY client ./client
RUN cd client && npm run build

# ---- runtime ----
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    STATIC_DIR=/app/public \
    PUID=1000 \
    PGID=1000
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY shared ./shared
COPY server/src ./server/src
COPY scripts ./scripts
COPY --from=client /app/client/dist ./public

VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

# Starts as root only to hand /data to PUID:PGID, then drops privileges (see server/src/privileges.js).
CMD ["node", "/app/server/src/index.js"]
