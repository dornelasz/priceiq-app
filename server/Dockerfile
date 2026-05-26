# ─── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install --include=dev

COPY . .
RUN npm run build

# ─── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Only production deps + compiled output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/db ./db
COPY package*.json ./

ENV NODE_ENV=production
# Fly.io injects PORT; server reads it from config (default 3001 in dev).
EXPOSE 8080

# Run compiled migrate-cli then start server
CMD ["sh", "-c", "node dist/db/migrate-cli.js && node dist/index.js"]
