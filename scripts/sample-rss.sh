#!/usr/bin/env bash
# Record the TaskFlow server's memory (RSS) every INTERVAL seconds while it runs.
# Used during the soak test: steady memory means no leak; a line that keeps climbing means one.
#   bash scripts/sample-rss.sh &      # writes reports/soak-rss.csv
set -euo pipefail

INTERVAL="${INTERVAL:-30}"
PID="$(cat reports/taskflow.pid)"
OUT="reports/soak-rss.csv"

echo "seconds,rss_mb" >"$OUT"
start=$(date +%s)
while kill -0 "$PID" 2>/dev/null; do
  rss_kb="$(ps -o rss= -p "$PID" | tr -d ' ')"
  echo "$(($(date +%s) - start)),$((rss_kb / 1024))" >>"$OUT"
  sleep "$INTERVAL"
done
