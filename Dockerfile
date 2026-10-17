# Nagma: one container serving the editor and the sync server on a single port.

# Build the editor.
FROM node:26-alpine AS web
WORKDIR /app/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

# Run the sync server, which also serves the built editor.
FROM node:26-alpine
WORKDIR /app/server
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci --omit=dev
COPY apps/server/*.mjs ./
COPY --from=web /app/web/dist /app/web/dist
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    STATIC_DIR=/app/web/dist
# Shared files live here; mount a persistent volume so they survive restarts and deploys.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
