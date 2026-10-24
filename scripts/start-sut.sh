#!/usr/bin/env bash
# Start TaskFlow (the system under test) on a fresh, empty database and wait until it's healthy.
#
#   SUT_DIR    where taskflow-under-test is checked out   (default: ../taskflow-under-test)
#   PORT       port to listen on                           (default: 3000)
#   SUT_LOG    server log file                             (default: reports/taskflow.log)
#
# The server keeps running after this script exits; stop it with scripts/stop-sut.sh.
set -euo pipefail

SUT_DIR="${SUT_DIR:-../taskflow-under-test}"
PORT="${PORT:-3000}"
mkdir -p reports
SUT_LOG="${SUT_LOG:-$PWD/reports/taskflow.log}"
DB_DIR="$(mktemp -d)"

if [ ! -f "$SUT_DIR/src/server.js" ]; then
  echo "TaskFlow not found at $SUT_DIR. Clone it next to this repo:" >&2
  echo "  git clone https://github.com/VincentJerico/taskflow-under-test.git ../taskflow-under-test" >&2
  exit 1
fi
if [ ! -d "$SUT_DIR/node_modules" ]; then
  (cd "$SUT_DIR" && npm ci --omit=dev --no-audit --no-fund)
fi

ROOT="$PWD"
cd "$SUT_DIR"
DATABASE_PATH="$DB_DIR/taskflow.db" PORT="$PORT" nohup node src/server.js >"$SUT_LOG" 2>&1 &
echo $! >"$ROOT/reports/taskflow.pid"
cd "$ROOT"

for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1; then
    echo "TaskFlow is up on http://localhost:$PORT (fresh database in $DB_DIR)"
    exit 0
  fi
  sleep 1
done

echo "TaskFlow did not become healthy within 30s. Server log:" >&2
cat "$SUT_LOG" >&2
exit 1
