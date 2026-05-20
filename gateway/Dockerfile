FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=optional --no-audit --no-fund

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

# Session and media dirs are mounted as volumes in compose
RUN mkdir -p /app/.wa-session /app/.wa-media

EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
