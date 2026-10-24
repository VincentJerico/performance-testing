#!/usr/bin/env bash
# Self-test for the performance gate.
#
# A gate that can't fail isn't a gate. This runs the smoke test with SLOs no real run can meet
# and passes only if k6 exits with code 99 ("thresholds crossed"). If someone breaks the
# thresholds (a typo in a metric name, a tag that no longer matches), k6 silently evaluates
# nothing, exits 0, and this test fails.
set -uo pipefail

k6 run --quiet --summary-mode disabled -e SELFTEST_IMPOSSIBLE_SLO=1 scenarios/smoke.js >/dev/null 2>&1
code=$?

if [ "$code" -eq 99 ]; then
  echo "PASS: the performance gate fails when the SLOs are broken (k6 exit code 99)"
  exit 0
fi
echo "FAIL: expected k6 to exit with 99 (thresholds crossed), got $code" >&2
exit 1
