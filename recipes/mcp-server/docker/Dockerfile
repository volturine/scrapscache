FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
RUN npx tsc

FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist/ ./dist/

EXPOSE 3001

CMD ["node", "dist/index.js"]
