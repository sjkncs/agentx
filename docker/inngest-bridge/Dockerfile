FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund --silent \
 && npx --yes tsc

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    POLL_INTERVAL_MS=800 \
    BATCH_SIZE=5 \
    HTTP_TIMEOUT_MS=5000
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
RUN apk add --no-cache tini \
 && addgroup -S bridge && adduser -S bridge -G bridge \
 && chown -R bridge:bridge /app
USER bridge
ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","--enable-source-maps","dist/worker.js"]
