#!/usr/bin/env bash
# Puts Rota's treasurer bot on Fly.io, or updates it. Run from the repo root:
#
#   bash deploy/fly-deploy.sh
#
# First run: logs in to Fly (opens the browser), creates the app and a 1 GB
# volume in Amsterdam, copies the bot's settings from .env into Fly secrets
# (only what the bot reads; see scripts/fly-secrets.ts), stops the bot running
# on this computer so Telegram doesn't get two copies, deploys (built on Fly's
# servers; no local Docker needed) and moves the bot's state (followed
# groups, linked accounts) to the volume.
#
# Later runs: refresh the secrets from .env and redeploy. The state on Fly is
# kept. Cost: one shared-cpu-1x machine with 512 MB plus the 1 GB volume.

set -euo pipefail
cd "$(dirname "$0")/.."

FLY=${FLYCTL:-$(command -v flyctl || command -v fly || echo "$HOME/.fly/bin/flyctl")}
REGION=ams
VOLUME=rota_data
APP_FILE=deploy/.fly-app

if [ ! -x "$FLY" ]; then
  echo "flyctl not found. Install it from https://fly.io/docs/flyctl/install/ and run this again." >&2
  exit 1
fi
[ -f .env ] || { echo ".env not found in $(pwd)" >&2; exit 1; }

say() { printf '\n== %s\n' "$*"; }

say "Fly account"
"$FLY" auth whoami 2>/dev/null || "$FLY" auth login
"$FLY" auth whoami

# App names are global on Fly, so the first run picks a random suffix and
# remembers it here (gitignored).
if [ -f "$APP_FILE" ]; then
  APP=$(cat "$APP_FILE")
else
  APP="rota-bot-$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
  echo "$APP" >"$APP_FILE"
fi

say "App $APP"
first_run=no
if ! "$FLY" status -a "$APP" >/dev/null 2>&1; then
  "$FLY" apps create "$APP"
fi
if ! "$FLY" volumes list -a "$APP" --json | grep -q "\"$VOLUME\""; then
  "$FLY" volumes create "$VOLUME" --size 1 --region "$REGION" --yes -a "$APP"
  first_run=yes
fi

say "Settings (from .env, values not shown)"
grep -q '^MAINNET_TREASURER_FC_PRIVATE_KEY=.' .env || echo "Note: no mainnet treasurer in .env yet; /circle … mainnet will say 'launching soon'. Run this again after the mainnet deploy."
grep -q '^WEB_URL=.' .env || echo "Note: WEB_URL isn't set in .env, so /link can't send the signing page yet. Add it and run this again."
node scripts/fly-secrets.ts | "$FLY" secrets import --stage -a "$APP"

if [ "$first_run" = yes ]; then
  pids=$(pgrep -f '^node (bot/)?src/main\.ts$' || true)
  if [ -n "$pids" ]; then
    say "Stopping the bot running on this computer (pid $pids)"
    kill $pids
    sleep 3
  fi
fi

say "Deploying (built on Fly's servers)"
"$FLY" deploy -a "$APP" --remote-only --ha=false --now

if [ "$first_run" = yes ] && [ -f bot/data/state.json ]; then
  say "Moving the bot's state to Fly"
  "$FLY" ssh sftp put bot/data/state.json /data/import-state.json -a "$APP"
  "$FLY" apps restart "$APP"
  sleep 15
fi

say "Startup log"
"$FLY" logs -a "$APP" --no-tail | tail -n 15
echo
echo "Done. The bot runs on Fly as $APP. Logs: $FLY logs -a $APP"
