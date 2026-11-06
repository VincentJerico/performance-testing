// Shared by render-results.mjs and build-trends.mjs: reading history.jsonl and the tracked series.
import { readFileSync } from 'node:fs';

/** Oldest first. Both renderers call this, so callers can pass records in any order. */
export const byDate = (records) => [...records].sort((a, b) => a.date.localeCompare(b.date));

export function readHistory(file) {
  return byDate(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line)),
  );
}

/**
 * The series the trend page charts and the results doc tabulates. `value` reads a record and
 * returns undefined when that run didn't produce the number; `gate` (optional) returns
 * 'pass' / 'fail' for runs a gate judged.
 */
export const SERIES = [
  ...['10', '30', '60'].map((rate) => ({
    id: `auth-${rate}`,
    title: `PERF-001: readers p95 during logins, ${rate} logins/s`,
    unit: 'ms',
    value: (r) => r.authContention?.[rate]?.duringP95Ms,
    gate: (r) => r.authContention?.[rate]?.gate,
    note: (r) => {
      const a = r.authContention?.[rate];
      return a ? `baseline ${a.baselineP95Ms} ms, limit ${a.limitMs} ms` : undefined;
    },
  })),
  {
    id: 'soak-slope',
    title: 'Soak memory: second-half RSS slope',
    unit: 'MB/min',
    value: (r) => r.soak?.slopeMbPerMin,
    gate: (r) => r.soak?.gate,
    limit: { value: 0.5, label: 'gate limit 0.5' },
    note: (r) => (r.soak ? `${r.soak.afterWarmupMb} to ${r.soak.endMb} MB` : undefined),
  },
  {
    id: 'load-p95',
    title: 'Load test: p95 across all endpoints',
    unit: 'ms',
    value: (r) => r.load?.p95Ms,
  },
  {
    id: 'breakpoint-rps',
    title: 'Breakpoint: average throughput over the run',
    unit: 'req/s',
    value: (r) => r.breakpoint?.rps,
  },
  {
    id: 'list-10000',
    title: 'List growth: GET /api/tasks p95 at 10,000 tasks',
    unit: 'ms',
    value: (r) => r.listGrowth?.['10000']?.p95Ms,
  },
];

export const short = (sha) => (sha ? sha.slice(0, 7) : 'unknown');
export const day = (iso) => iso.slice(0, 10);
