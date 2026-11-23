#!/usr/bin/env bash
# Construit le jeu et l'envoie dans /var/www/wipeout sur le serveur.
# Usage : DEPLOY_HOST=utilisateur@serveur ./deploy/deploy.sh
set -euo pipefail

HOST="${DEPLOY_HOST:?Définir DEPLOY_HOST, par exemple DEPLOY_HOST=pilou@wipeout.pilou.online}"
TARGET=/var/www/wipeout

cd "$(dirname "$0")/.."
npm run build

tar -czf /tmp/wipeout-dist.tgz -C dist .
scp /tmp/wipeout-dist.tgz "$HOST:/tmp/wipeout-dist.tgz"
ssh "$HOST" "set -e
  mkdir -p $TARGET
  find $TARGET -mindepth 1 -delete
  tar -xzf /tmp/wipeout-dist.tgz -C $TARGET
  rm /tmp/wipeout-dist.tgz
  ls -la $TARGET"
rm /tmp/wipeout-dist.tgz
echo "Déployé : https://wipeout.pilou.online"
