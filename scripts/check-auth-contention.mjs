// PERF-001 regression gate: do logins slow down unrelated reads?
// Reads the JSON that experiments/auth-contention.js writes and compares readers' p95 during the
// login phase with their p95 before it.
//
//   node scripts/check-auth-contention.mjs reports/auth-contention.json
//
// Exit 0: within the limit. Exit 1: regression. Exit 2: the input is missing the metrics, so
// nothing was checked (never a silent pass).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// FINDINGS.md's pass condition is "within 2x the baseline". Baselines on CI are under 1.2 ms, where
// 2x is scheduler noise, so the limit never goes below baseline + 5 ms. The old scryptSync build's
// lowest reading in 12 nightly runs was 23.8 ms, far above either bound.
export const MAX_RATIO = 2;
export const FLOOR_MS = 5;

export function checkAuthContention(data) {
  const p95 = (phase) => data?.metrics?.[`reader_latency{phase:${phase}}`]?.values?.['p(95)'];
  const baseline = p95('baseline');
  const during = p95('during-logins');
  if (!Number.isFinite(baseline) || !Number.isFinite(during)) {
    return { status: 'error', message: 'reader_latency p95 for baseline/during-logins not found' };
  }
  const limit = Math.max(MAX_RATIO * baseline, baseline + FLOOR_MS);
  return {
    status: during <= limit ? 'pass' : 'fail',
    baseline,
    during,
    limit,
    ratio: during / baseline,
  };
}

function main(file) {
  const result = checkAuthContention(JSON.parse(readFileSync(file, 'utf8')));
  if (result.status === 'error') {
    console.log(`**PERF-001 gate: ERROR** ${result.message} in \`${file}\``);
    process.exit(2);
  }
  const f = (ms) => `${ms.toFixed(1)} ms`;
  console.log(
    `**PERF-001 gate: ${result.status.toUpperCase()}** readers p95 during logins ${f(result.during)}` +
      ` (${result.ratio.toFixed(1)}x baseline ${f(result.baseline)}), limit ${f(result.limit)}`,
  );
  process.exit(result.status === 'pass' ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2] ?? 'reports/auth-contention.json');
}
