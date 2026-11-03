#!/usr/bin/env bash
# Dev helper: stop any running compiled API, rebuild, start on $PORT (default 4000).
set -e
cd "$(dirname "$0")/.."
for pid in $(ps -eo pid,args | awk '$2=="node" && $0 ~ /dist\/src\/main\.js/ {print $1}'); do kill "$pid" 2>/dev/null || true; done
npx tsc -p tsconfig.build.json
NODE_ENV=${NODE_ENV_OVERRIDE:-development} PORT=${API_PORT:-4000} NODE_USE_ENV_PROXY=1 nohup node --env-file-if-exists=.env dist/src/main.js > "${API_LOG:-/tmp/vyra-api.log}" 2>&1 &
for i in $(seq 1 30); do curl -sf "localhost:${API_PORT:-4000}/api/v1/health" >/dev/null && { echo "API up on ${API_PORT:-4000}"; exit 0; }; sleep 1; done
echo "API failed to start; see ${API_LOG:-/tmp/vyra-api.log}"; exit 1
