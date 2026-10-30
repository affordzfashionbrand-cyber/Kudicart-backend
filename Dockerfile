# ==========================================
# KudiCart Backend Multi-Stage Production Dockerfile
# Satisfies Go-Live Checklist Item 1, 4 & AWS App Runner / Beanstalk (D-024)
# ==========================================

# Stage 1: Build & Compile
FROM node:20-alpine AS builder

WORKDIR /app

# Install system utilities needed for native compilation
RUN apk add --no-cache libc6-compat openssl

COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies including devDependencies for build
RUN npm ci

# Copy full source
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build NestJS distribution
RUN npm run build

# Prune devDependencies to keep image lean
RUN npm prune --production

# ==========================================
# Stage 2: Minimal Production Runtime
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Ensure security patches and openssl for Prisma runtime
RUN apk add --no-cache curl openssl

ENV NODE_ENV=production
ENV PORT=3001

# Run as non-root user for security compliance (ASVS / SOC 2)
USER node

# Copy runtime assets and dependencies from builder
COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/prisma ./prisma

EXPOSE 3001

# Healthcheck to AWS App Runner / ALB standards (Item 20)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/main"]
