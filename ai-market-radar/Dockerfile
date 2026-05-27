# AI Market Radar — single image used for app, worker and migrations.
FROM node:22-slim

WORKDIR /app

# Prisma needs openssl at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies (incl. dev: prisma CLI + tsx are needed at runtime).
COPY package.json package-lock.json ./
RUN npm ci

# App source + Prisma client + production build.
COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Default: serve the Next app. Compose overrides the command for worker/migrate.
CMD ["npm", "run", "start"]
