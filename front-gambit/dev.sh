#!/usr/bin/env bash
# Bundle the web game into web/dist for local testing (serve web/dist over http).
set -e
cd "$(dirname "$0")"
npx esbuild web/src/main.js --bundle --minify --format=iife --target=es2019 --outfile=web/dist/game.js --log-level=warning
cp web/index.html web/style.css web/dist/
rm -rf web/dist/assets && cp -r web/assets web/dist/assets
