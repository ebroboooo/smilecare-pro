#!/bin/sh
set -e
cd "$(dirname "$0")"
if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
fi
npm install
npm run build
export NODE_ENV=production
npm start
