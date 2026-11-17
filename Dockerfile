FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY drizzle ./drizzle
COPY src ./src
USER node
CMD ["node", "src/index.ts"]
