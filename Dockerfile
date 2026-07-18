FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts/datahub-upload-child.cjs ./scripts/datahub-upload-child.cjs
# The child uploader resolves the SDK at runtime, outside Next's file tracer.
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "server.js"]
