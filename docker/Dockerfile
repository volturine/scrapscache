# syntax=docker/dockerfile:1

# Base images are pinned by digest (multi-arch index) as well as tag, so a
# rebuild cannot pick up a different image. Bump the tag and digest together.

# Compile JS on the native builder. Vite/Rolldown SIGILL under QEMU arm64 (CI exit 132).
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json vite.config.ts ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a AS runtime

COPY --from=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 /usr/local/bin/node /usr/local/bin/node

# BODY_SIZE_LIMIT: the largest request the app accepts is one sync round, capped at
# 17,000,000 bytes (a 16 MB envelope plus 1 MB of JSON, src/routes/api/sync/v2/delta).
# 18M is 18,874,368 bytes: just above that, so the app's own cap decides.
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	BODY_SIZE_LIMIT=18M

WORKDIR /app

COPY --from=build --chown=node:node /app/build ./build
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
RUN apk add --no-cache libstdc++ libgcc \
	&& addgroup -g 1000 -S node \
	&& adduser -S -D -H -u 1000 -G node node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/health/ready`).then(response => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]

USER node
CMD ["node", "build"]
