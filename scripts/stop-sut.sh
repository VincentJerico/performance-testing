#!/usr/bin/env bash
# Stop the TaskFlow server started by scripts/start-sut.sh.
set -euo pipefail
if [ -f reports/taskflow.pid ]; then
  kill "$(cat reports/taskflow.pid)" 2>/dev/null || true
  rm -f reports/taskflow.pid
  echo "TaskFlow stopped"
fi
