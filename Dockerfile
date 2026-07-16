FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    SEZZLE_ENV=sandbox \
    SEZZLE_READ_ONLY=true \
    SEZZLE_REQUIRE_CONFIRMATION=true \
    MCP_TRANSPORT=stdio

WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data

USER node
ENTRYPOINT ["node", "dist/index.js"]