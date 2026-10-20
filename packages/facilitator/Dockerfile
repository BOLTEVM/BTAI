# syntax=docker/dockerfile:1
# Dark Star Rail x402 facilitator (Node + tsx, quais.js on QUAI). Settles the signed
# escrow authorizations the talent API challenges for. The build context is the REPO
# ROOT (the facilitator is a pnpm workspace package):
#
#   docker build -f packages/facilitator/Dockerfile .
#
FROM node:22-slim

# Pin the same pnpm the repo CI uses; a global npm install keeps the binary
# executable for the non-root runtime user (a corepack cache is per-user).
RUN npm install -g pnpm@10.29.3

WORKDIR /repo

# Whole workspace: --frozen-lockfile verifies every importer in pnpm-lock.yaml,
# so a partial copy would fail the install. .dockerignore keeps the context slim.
COPY . .
RUN pnpm install --frozen-lockfile --filter facilitator...

RUN useradd --uid 10001 --create-home btai \
    && mkdir -p /data \
    && chown -R btai:btai /data
USER btai

# nonce registry lives on a mounted volume so restarts cannot replay
ENV NONCE_DB_PATH=/data/facilitator-nonces.db \
    FACILITATOR_PORT=3402

EXPOSE 3402

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.FACILITATOR_PORT||3402)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "facilitator", "start"]
