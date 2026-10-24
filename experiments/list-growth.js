// Experiment: how does GET /api/tasks scale with the number of tasks a user has?
//
// Hypothesis: the endpoint has no pagination. It selects and serialises every task the user
// owns on every call, so its latency and payload should grow roughly linearly with list size,
// and a heavy user's board will eventually break the 200 ms budget on its own.
//
// Design: setup() creates three users holding SIZES tasks each (default 10, 1,000 and 10,000).
// Each user's list is then read at the same steady rate, one size after another.
//
//   k6 run experiments/list-growth.js
//   k6 run -e SIZES=10,2000,10000 experiments/list-growth.js

import http from 'k6/http';
import { fail } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, JSON_HEADERS, RUN_ID } from '../lib/config.js';
import { register, login, listTasks } from '../lib/taskflow.js';
import { table, expose, commas } from '../lib/report.js';

const SIZES = (__ENV.SIZES || '10,1000,10000').split(',').map(Number);
const PHASE = 20; // seconds of reads per size

const listLatency = new Trend('list_latency', true);
const listBytes = new Trend('list_bytes');

const scenarios = {};
SIZES.forEach((size, i) => {
  scenarios[`list_${size}`] = {
    executor: 'constant-arrival-rate',
    rate: 10,
    timeUnit: '1s',
    duration: `${PHASE}s`,
    startTime: `${i * (PHASE + 2)}s`,
    preAllocatedVUs: 10,
    maxVUs: 100,
    exec: 'readList',
    env: { SIZE_INDEX: String(i) },
    tags: { size: String(size) },
  };
});

export const options = {
  setupTimeout: '5m',
  scenarios,
  thresholds: {
    ...expose(
      'list_latency',
      SIZES.map((s) => `size:${s}`),
    ),
    ...expose(
      'list_bytes',
      SIZES.map((s) => `size:${s}`),
    ),
  },
};

export function setup() {
  const tokens = [];
  for (const size of SIZES) {
    const username = `k6-${RUN_ID}-list-${size}`;
    register(username);
    const token = login(username);
    if (!token) fail(`setup: could not sign in ${username}`);

    // Create the tasks in batches of 100 parallel requests to keep setup quick.
    const headers = { ...JSON_HEADERS, Authorization: `Bearer ${token}` };
    for (let made = 0; made < size; made += 100) {
      const batch = [];
      for (let j = made; j < Math.min(made + 100, size); j++) {
        batch.push([
          'POST',
          `${BASE_URL}/api/tasks`,
          JSON.stringify({ title: `seed task ${j}`, status: 'todo', due_date: '2026-12-31' }),
          { headers, tags: { name: 'seed' } },
        ]);
      }
      const failed = http.batch(batch).filter((r) => r.status !== 201).length;
      if (failed) fail(`setup: ${failed} seed tasks failed for size ${size}`);
    }
    tokens.push(token);
  }
  return { tokens };
}

export function readList(data) {
  const res = listTasks(data.tokens[Number(__ENV.SIZE_INDEX)]);
  listLatency.add(res.timings.duration);
  listBytes.add(res.body ? res.body.length : 0);
}

export function handleSummary(data) {
  const latency = SIZES.map((s) => ({
    label: `${commas(s)} tasks`,
    metric: `list_latency{size:${s}}`,
  }));
  const bytes = SIZES.map((s) => ({
    label: `${commas(s)} tasks`,
    metric: `list_bytes{size:${s}}`,
  }));
  const md = [
    '## List growth: GET /api/tasks latency by list size (10 reads/s)',
    '',
    table(data, latency),
    '',
    '### Response size',
    '',
    table(data, bytes, { unit: 'bytes', stats: ['med'] }),
    '',
  ].join('\n');
  return {
    stdout: `\n${md}\n`,
    'reports/list-growth.md': md,
    'reports/list-growth.json': JSON.stringify(data, null, 2),
  };
}
