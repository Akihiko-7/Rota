# Rota's treasurer bot, for running 24/7.
#
#   docker build -t rota-bot .
#   docker run -d --name rota-bot --restart unless-stopped \
#     --env-file bot/bot.env -v rota-bot:/data rota-bot
#
# On Fly.io: bash deploy/fly-deploy.sh (builds the "fly" stage).
#
# bot/bot.env holds only the variables in bot/bot.env.example. The one NEAR
# key in it is the treasurer's settle-only function-call key; the bot checks
# that on chain at startup and refuses any other key.

FROM node:24.14.1-bookworm-slim AS base

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY bot/package.json bot/
COPY scripts/package.json scripts/
RUN npm ci --omit=dev --workspace bot --workspace scripts && npm cache clean --force

COPY scripts/lib scripts/lib
COPY bot/src bot/src

RUN mkdir /data && chown node:node /data
ENV BOT_STATE_PATH=/data/state.json
CMD ["node", "bot/src/main.ts"]

# Fly.io (fly.toml builds this stage). Fly mounts the volume owned by root, so
# the entrypoint starts as root, gives /data to node and runs the bot as node.
FROM base AS fly
COPY deploy/fly-entrypoint.sh /usr/local/bin/fly-entrypoint.sh
ENTRYPOINT ["sh", "/usr/local/bin/fly-entrypoint.sh"]
CMD ["node", "bot/src/main.ts"]

# Default: plain Docker, running as node from the start.
FROM base
USER node
VOLUME /data
