// Turn one CI run's downloaded artifacts into one results record (a line of history.jsonl).
// Only reads what the run wrote: a missing artifact leaves its field out, never a guessed value.
//
//   node scripts/extract-run.mjs <artifactsDir> --run-id 123 --date 2026-11-06T18:00:00Z \
//     --commit <sha> --taskflow-ref <sha> --event schedule > record.json
//
// <artifactsDir> holds one folder per artifact (actions/download-artifact without a name).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { checkAuthContention } from './check-auth-contention.mjs';
import { checkSoakRss, parseRssCsv } from './check-soak-rss.mjs';

export const SCHEMA = 1;
const REPO_URL = 'https://github.com/VincentJerico/performance-testing';

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined);
const round = (n, digits = 2) => (Number.isFinite(n) ? Number(n.toFixed(digits)) : undefined);

/** p95 / rate fields from a k6 --summary-export file (flat metric objects). */
function scenario(summary) {
  if (!summary) return undefined;
  const m = summary.metrics;
  const p95 = {};
  for (const [key, v] of Object.entries(m)) {
    const name = key.match(/^http_req_duration\{name:(.+)\}$/)?.[1];
    if (name) p95[name] = round(v['p(95)']);
  }
  return {
    p95Ms: round(m.http_req_duration?.['p(95)']),
    maxMs: round(m.http_req_duration?.max),
    rps: round(m.http_reqs?.rate, 1),
    requests: m.http_reqs?.count,
    failedRate: round(m.http_req_failed?.value, 4),
    droppedIterations: m.dropped_iterations?.count ?? 0,
    ...(Object.keys(p95).length
      ? { endpointP95Ms: Object.fromEntries(Object.entries(p95).sort()) }
      : {}),
  };
}

/** Readers' latency per phase and the PERF-001 verdict from an auth-contention handleSummary dump. */
function authContention(data) {
  if (!data) return undefined;
  const p95 = (key) => round(data.metrics[key]?.values?.['p(95)']);
  const gate = checkAuthContention(data);
  return {
    baselineP95Ms: p95('reader_latency{phase:baseline}'),
    duringP95Ms: p95('reader_latency{phase:during-logins}'),
    afterP95Ms: p95('reader_latency{phase:after}'),
    loginP95Ms: p95('http_req_duration{name:POST /api/auth/login}'),
    gate: gate.status,
    limitMs: round(gate.limit),
  };
}

function listGrowth(data) {
  if (!data) return undefined;
  const out = {};
  for (const size of ['10', '1000', '10000']) {
    const latency = data.metrics[`list_latency{size:${size}}`]?.values;
    const bytes = data.metrics[`list_bytes{size:${size}}`]?.values;
    if (latency) out[size] = { p95Ms: round(latency['p(95)']), bytes: bytes?.med };
  }
  return Object.keys(out).length ? out : undefined;
}

function soak(dir) {
  const csv = join(dir, 'soak-rss.csv');
  if (!existsSync(csv)) return undefined;
  const r = checkSoakRss(parseRssCsv(readFileSync(csv, 'utf8')));
  if (r.status === 'error') return { gate: 'error' };
  return {
    afterWarmupMb: r.afterWarmupMb,
    endMb: r.endMb,
    slopeMbPerMin: round(r.slopeMbPerMin, 3),
    gate: r.status,
  };
}

export function extractRun(dir, meta) {
  const artifact = (name) => join(dir, `${name}-reports`);
  const record = {
    schema: SCHEMA,
    runId: String(meta.runId),
    runUrl: `${REPO_URL}/actions/runs/${meta.runId}`,
    date: meta.date,
    event: meta.event,
    commit: meta.commit,
    taskflowRef: meta.taskflowRef,
    smoke: scenario(readJson(join(artifact('gate'), 'smoke-summary.json'))),
    load: scenario(readJson(join(artifact('gate'), 'load-summary.json'))),
    stress: scenario(readJson(join(artifact('stress'), 'stress-summary.json'))),
    spike: scenario(readJson(join(artifact('spike'), 'spike-summary.json'))),
    breakpoint: scenario(readJson(join(artifact('breakpoint'), 'breakpoint-summary.json'))),
    listGrowth: listGrowth(readJson(join(artifact('list-growth'), 'list-growth.json'))),
    soak: soak(artifact('soak')),
  };

  // One artifact per login rate (auth-contention-30-reports). Runs before the rate matrix had a
  // single auth-contention-reports artifact at the default 10/s.
  const auth = {};
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const rate = name.match(/^auth-contention-(\d+)-reports$/)?.[1];
    if (rate) auth[rate] = authContention(readJson(join(dir, name, 'auth-contention.json')));
  }
  if (!Object.keys(auth).length) {
    const legacy = authContention(
      readJson(join(artifact('auth-contention'), 'auth-contention.json')),
    );
    if (legacy) auth['10'] = legacy;
  }
  if (Object.keys(auth).length) record.authContention = auth;

  return JSON.parse(JSON.stringify(record)); // drop undefined fields
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'run-id': { type: 'string' },
      date: { type: 'string' },
      commit: { type: 'string' },
      'taskflow-ref': { type: 'string' },
      event: { type: 'string' },
    },
  });
  const missing = ['run-id', 'date', 'commit', 'taskflow-ref', 'event'].filter((k) => !values[k]);
  if (!positionals[0] || missing.length) {
    console.error(
      `usage: extract-run.mjs <artifactsDir> (missing: ${missing.join(', ') || 'dir'})`,
    );
    process.exit(2);
  }
  const record = extractRun(positionals[0], {
    runId: values['run-id'],
    date: values.date,
    commit: values.commit,
    taskflowRef: values['taskflow-ref'],
    event: values.event,
  });
  console.log(JSON.stringify(record));
}
