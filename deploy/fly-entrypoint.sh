#!/bin/sh
# Entrypoint of the Fly.io image (Dockerfile stage "fly"). Fly mounts the
# volume at /data owned by root, so this starts as root, hands /data to the
# node user, takes in a state file uploaded by deploy/fly-deploy.sh, and runs
# the bot as node.
set -eu
chown -R node:node /data
if [ -f /data/import-state.json ]; then
  mv /data/import-state.json /data/state.json
  echo "imported the bot state uploaded by fly-deploy.sh"
fi
exec setpriv --reuid=node --regid=node --init-groups -- "$@"
