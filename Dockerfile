# SEKISHO — Cloud Run 用イメージ
FROM node:22-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runner
WORKDIR /app
ENV NODE_ENV=production
# Cloud RunはPORT環境変数を渡す。Next standaloneはPORTを読む
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
