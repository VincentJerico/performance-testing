#!/usr/bin/env bash
# Run one k6 script and keep its evidence under reports/:
#   reports/<name>.html   k6's built-in web dashboard, exported as a standalone HTML report
#   reports/<name>.json   end-of-test summary (thresholds, per-endpoint percentiles)
#
#   scripts/run.sh scenarios/load.js
#   scripts/run.sh scenarios/soak.js -e DURATION=1h
set -euo pipefail

script="${1:?usage: scripts/run.sh <path/to/script.js> [extra k6 args]}"
shift
name="$(basename "$script" .js)"
mkdir -p reports

K6_WEB_DASHBOARD=true \
  K6_WEB_DASHBOARD_EXPORT="reports/${name}.html" \
  k6 run --quiet --summary-export "reports/${name}-summary.json" "$script" "$@"
