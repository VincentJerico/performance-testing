// Self-tests for the gate checkers: each must pass a real good run and fail a real (or planted) bad
// one. A checker that can only pass isn't a gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkAuthContention } from '../scripts/check-auth-contention.mjs';
import { checkSoakRss, parseRssCsv } from '../scripts/check-soak-rss.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(fixture(name));

/** Run a checker script as CI does and return its exit code. */
function exitCode(script, file) {
  try {
    execFileSync('node', [`scripts/${script}`, `test/fixtures/${file}`], { stdio: 'pipe' });
    return 0;
  } catch (err) {
    return err.status;
  }
}

test('PERF-001 gate passes the fixed build', () => {
  const r = checkAuthContention(json('auth-contention-fixed-build.json'));
  assert.equal(r.status, 'pass');
  assert.ok(r.during <= r.limit);
});

test('PERF-001 gate fails the old scryptSync build', () => {
  const r = checkAuthContention(json('auth-contention-old-build.json'));
  assert.equal(r.status, 'fail');
  assert.ok(r.ratio > 10, `old build ratio ${r.ratio}`);
});

test('PERF-001 gate reports an error, not a pass, when the metrics are missing', () => {
  assert.equal(checkAuthContention({ metrics: {} }).status, 'error');
  assert.equal(checkAuthContention(undefined).status, 'error');
});

test('PERF-001 limit never drops below baseline + 5 ms', () => {
  const data = (baseline, during) => ({
    metrics: {
      'reader_latency{phase:baseline}': { values: { 'p(95)': baseline } },
      'reader_latency{phase:during-logins}': { values: { 'p(95)': during } },
    },
  });
  assert.equal(checkAuthContention(data(0.5, 3)).status, 'pass'); // 6x, but only +2.5 ms
  assert.equal(checkAuthContention(data(0.5, 6)).status, 'fail'); // +5.5 ms
  assert.equal(checkAuthContention(data(20, 39)).status, 'pass'); // under 2x
  assert.equal(checkAuthContention(data(20, 41)).status, 'fail'); // over 2x
});

test('soak gate passes the nightly soak with the most growth', () => {
  const r = checkSoakRss(parseRssCsv(fixture('soak-rss-nightly.csv')));
  assert.equal(r.status, 'pass');
});

test('soak gate fails a planted 1 MB/min leak', () => {
  const r = checkSoakRss(parseRssCsv(fixture('soak-rss-leak.csv')));
  assert.equal(r.status, 'fail');
  // The planted 1 MB/min on top of the real run's own second-half growth.
  assert.ok(r.slopeMbPerMin >= 1, `slope ${r.slopeMbPerMin}`);
});

test('soak gate reports an error, not a pass, on too few samples', () => {
  assert.equal(checkSoakRss(parseRssCsv(fixture('soak-rss-short.csv'))).status, 'error');
  assert.equal(checkSoakRss([]).status, 'error');
});

test('CLI exit codes: 0 pass, 1 fail, 2 nothing checked', () => {
  assert.equal(exitCode('check-auth-contention.mjs', 'auth-contention-fixed-build.json'), 0);
  assert.equal(exitCode('check-auth-contention.mjs', 'auth-contention-old-build.json'), 1);
  assert.equal(exitCode('check-soak-rss.mjs', 'soak-rss-nightly.csv'), 0);
  assert.equal(exitCode('check-soak-rss.mjs', 'soak-rss-leak.csv'), 1);
  assert.equal(exitCode('check-soak-rss.mjs', 'soak-rss-short.csv'), 2);
});
