# Build from the repository root: the server compiles the app's shared note model (src/lib/model).
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder

WORKDIR /app

COPY recipes/mcp-server/package.json recipes/mcp-server/package-lock.json ./
RUN npm ci

COPY recipes/mcp-server/tsconfig.json recipes/mcp-server/
COPY recipes/mcp-server/src/ recipes/mcp-server/src/
COPY src/lib/model/ src/lib/model/
RUN npx tsc -p recipes/mcp-server

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY recipes/mcp-server/package.json recipes/mcp-server/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/recipes/mcp-server/dist/ ./dist/

EXPOSE 3001

USER node

CMD ["node", "dist/recipes/mcp-server/src/index.js"]
