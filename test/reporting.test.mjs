// Tests for the results pipeline: artifacts -> record -> LATEST.md and the trend page.
// The fixture is the real artifact set of nightly run 42125961430 (JSON and CSV only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRun } from '../scripts/extract-run.mjs';
import { renderResults } from '../scripts/render-results.mjs';
import { buildTrends } from '../scripts/build-trends.mjs';

const RUN = fileURLToPath(new URL('./fixtures/nightly-run', import.meta.url));
const META = {
  runId: '42125961430',
  date: '2026-11-05T22:58:49Z',
  commit: '23e44ed7a4f4b7c9e2f1b0a1c3d5e7f9a1b3c5d7',
  taskflowRef: '8b0d564ca225877e7d0b05d11f7305da975d9bc3',
  event: 'schedule',
};
const raw = (path) => JSON.parse(readFileSync(join(RUN, path), 'utf8'));

test('a record carries the numbers from the artifacts, not new ones', () => {
  const r = extractRun(RUN, META);
  const load = raw('gate-reports/load-summary.json').metrics;
  assert.equal(r.load.p95Ms, Number(load.http_req_duration['p(95)'].toFixed(2)));
  assert.equal(r.load.requests, load.http_reqs.count);
  const list = raw('list-growth-reports/list-growth.json').metrics;
  assert.equal(r.listGrowth['10000'].bytes, list['list_bytes{size:10000}'].values.med);
  assert.equal(r.authContention['10'].gate, 'fail'); // old scryptSync build
  assert.equal(r.soak.gate, 'pass');
  assert.equal(
    r.runUrl,
    'https://github.com/VincentJerico/performance-testing/actions/runs/42125961430',
  );
});

test('a missing artifact leaves its field out instead of guessing', () => {
  const r = extractRun(join(RUN, 'does-not-exist'), META);
  for (const key of ['load', 'soak', 'breakpoint', 'listGrowth', 'authContention']) {
    assert.equal(r[key], undefined, key);
  }
  assert.equal(r.runId, META.runId);
});

test('per-rate auth-contention artifacts are read by rate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'perf-run-'));
  cpSync(RUN, dir, { recursive: true });
  renameSync(join(dir, 'auth-contention-reports'), join(dir, 'auth-contention-30-reports'));
  const r = extractRun(dir, META);
  assert.deepEqual(Object.keys(r.authContention), ['30']);
});

test('LATEST.md shows the latest run, its gates and recent runs', () => {
  const older = {
    ...extractRun(RUN, META),
    runId: '1',
    date: '2026-11-04T22:00:00Z',
    runUrl: 'https://x/1',
  };
  const md = renderResults([extractRun(RUN, META), older]);
  assert.match(
    md,
    /\[42125961430\]\(https:\/\/github\.com\/VincentJerico\/performance-testing\/actions\/runs\/42125961430\)/,
  );
  assert.match(md, /PERF-001 at 10 logins\/s .* \*\*FAIL\*\*/);
  assert.match(md, /Soak memory \(OBS-002\) .* pass/);
  assert.match(md, /## Last 2 runs/);
  assert.doesNotMatch(md, /undefined|NaN/);
});

test('the trend page has one chart per series with data and no broken values', () => {
  const html = buildTrends([extractRun(RUN, META)]);
  for (const id of ['auth-10', 'soak-slope', 'load-p95', 'breakpoint-rps', 'list-10000']) {
    assert.match(html, new RegExp(`<section class="card" id="${id}">`), id);
  }
  assert.doesNotMatch(html, /id="auth-30"/); // no data at 30/s in this run
  assert.doesNotMatch(html, /undefined|NaN/);
  assert.doesNotMatch(html, /<script src=|<link rel="stylesheet"/); // self-contained
});

test('60 logins/s is measured, never drawn as a gate failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'perf-run-'));
  cpSync(RUN, dir, { recursive: true });
  // The fixture's auth run is the old build, so its verdict is "fail" at any rate.
  renameSync(join(dir, 'auth-contention-reports'), join(dir, 'auth-contention-60-reports'));
  const record = extractRun(dir, META);
  assert.equal(record.authContention['60'].gate, 'fail');
  const html = buildTrends([record]);
  const card = html.slice(
    html.indexOf('id="auth-60"'),
    html.indexOf('</section>', html.indexOf('id="auth-60"')),
  );
  assert.match(card, /measured, not gated/);
  assert.doesNotMatch(card, /class="mark fail"|gate failed|FAIL/);
  assert.match(
    renderResults([record]),
    /PERF-001 at 60 logins\/s \(measured\) .* not gated \(would fail\)/,
  );
});
