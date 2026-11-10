# Rota's treasurer bot, for running 24/7.
#
#   docker build -t rota-bot .
#   docker run -d --name rota-bot --restart unless-stopped \
#     --env-file bot/bot.env -v rota-bot:/data rota-bot
#
# bot/bot.env holds only the variables in bot/bot.env.example. The one NEAR
# key in it is the treasurer's settle-only function-call key; the bot checks
# that on chain at startup and refuses any other key.

FROM node:24.14.1-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY bot/package.json bot/
COPY scripts/package.json scripts/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace bot --workspace scripts && npm cache clean --force

COPY scripts/lib scripts/lib
COPY bot/src bot/src

RUN mkdir /data && chown node:node /data
USER node
ENV BOT_STATE_PATH=/data/state.json
VOLUME /data

CMD ["node", "bot/src/main.ts"]
