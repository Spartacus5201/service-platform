# Service Platform container (homelab now; a starting point for the company server later).
# Data and daily backups live in the /data volume.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data/db BACKUP_DIR=/data/backups BACKUP_KEEP=14 PORT=3000
COPY --from=build /app /app
RUN useradd --system --uid 10001 app && mkdir -p /data && chown -R app /data
USER app
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx next start -p ${PORT}"]
