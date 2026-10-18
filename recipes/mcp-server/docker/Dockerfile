# Build from the repository root: the server compiles the app's shared note model (src/lib/model).
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS builder

WORKDIR /app

COPY recipes/mcp-server/package.json recipes/mcp-server/package-lock.json ./
RUN npm ci

COPY recipes/mcp-server/tsconfig.json recipes/mcp-server/
COPY recipes/mcp-server/src/ recipes/mcp-server/src/
COPY src/lib/model/ src/lib/model/
RUN npx tsc -p recipes/mcp-server

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY recipes/mcp-server/package.json recipes/mcp-server/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/recipes/mcp-server/dist/ ./dist/

EXPOSE 3001

USER node

CMD ["node", "dist/recipes/mcp-server/src/index.js"]
