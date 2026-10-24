// Experiment: does login traffic slow down everyone else?
//
// Hypothesis: TaskFlow hashes passwords with crypto.scryptSync, which runs on Node's single
// main thread. While one login is hashing, the server can't answer any other request, so a
// burst of logins should delay unrelated, cheap reads.
//
// Design: readers request GET /api/tasks at a fixed rate for 60s. From 20s to 40s, a second
// scenario adds LOGIN_RATE logins per second. Reader latency is compared across the three
// phases: baseline (0-20s), during logins (20-40s), after (40-60s).
//
//   k6 run experiments/auth-contention.js
//   k6 run -e LOGIN_RATE=5 experiments/auth-contention.js

import exec from 'k6/execution';
import { Trend } from 'k6/metrics';
import { createUserPool, tokenFor } from '../lib/journey.js';
import { listTasks, login } from '../lib/taskflow.js';
import { table, expose } from '../lib/report.js';

const LOGIN_RATE = Number(__ENV.LOGIN_RATE || 10);
const READ_RATE = Number(__ENV.READ_RATE || 40);

const readerLatency = new Trend('reader_latency', true);

export const options = {
  scenarios: {
    readers: {
      executor: 'constant-arrival-rate',
      rate: READ_RATE,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 20,
      maxVUs: 200,
      exec: 'reader',
    },
    logins: {
      executor: 'constant-arrival-rate',
      rate: LOGIN_RATE,
      timeUnit: '1s',
      startTime: '20s',
      duration: '20s',
      preAllocatedVUs: 10,
      maxVUs: 100,
      exec: 'signIn',
    },
  },
  thresholds: {
    ...expose('reader_latency', ['phase:baseline', 'phase:during-logins', 'phase:after']),
    ...expose('http_req_duration', ['name:POST /api/auth/login']),
  },
};

export function setup() {
  return createUserPool(20);
}

function phase() {
  const elapsed = Date.now() - exec.scenario.startTime;
  if (elapsed < 20000) return 'baseline';
  if (elapsed < 40000) return 'during-logins';
  return 'after';
}

export function reader(data) {
  const p = phase();
  const res = listTasks(tokenFor(data), { phase: p });
  readerLatency.add(res.timings.duration, { phase: p });
}

export function signIn(data) {
  login(data.usernames[__ITER % data.usernames.length]);
}

export function handleSummary(data) {
  const md = [
    `## Auth contention: GET /api/tasks latency while logins run (${LOGIN_RATE} logins/s)`,
    '',
    table(data, [
      { label: 'Readers, baseline (0-20s)', metric: 'reader_latency{phase:baseline}' },
      { label: 'Readers, during logins (20-40s)', metric: 'reader_latency{phase:during-logins}' },
      { label: 'Readers, after logins (40-60s)', metric: 'reader_latency{phase:after}' },
      {
        label: 'POST /api/auth/login itself',
        metric: 'http_req_duration{name:POST /api/auth/login}',
      },
    ]),
    '',
  ].join('\n');
  return {
    stdout: `\n${md}\n`,
    'reports/auth-contention.md': md,
    'reports/auth-contention.json': JSON.stringify(data, null, 2),
  };
}
