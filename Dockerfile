# --- builder ---
FROM node:20-alpine AS builder
WORKDIR /app

# Install all workspace deps (server + web)
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspaces --include-workspace-root

# Copy sources and build
COPY tsconfig*.json ./
COPY server server
COPY web web
RUN npm run build

# Drop dev deps for runtime
RUN npm prune --omit=dev --workspaces --include-workspace-root

# --- runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Tini for proper signal handling
RUN apk add --no-cache tini

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/web/dist ./web/dist

# Token storage volume mount point
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/dist/index.js"]
