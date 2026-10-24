// Service-level objectives, written once and used as k6 thresholds by every scenario.
// A crossed threshold makes k6 exit with code 99, which fails the CI job: the SLOs are the gate.
//
// Self-test: SELFTEST_IMPOSSIBLE_SLO=1 swaps in limits no real run can meet. CI runs the smoke
// test that way and expects exit code 99, which proves the gate can actually fail
// (see selftest/gate-must-fail.sh).

const IMPOSSIBLE = __ENV.SELFTEST_IMPOSSIBLE_SLO === '1';

// p95 latency budgets per endpoint, in milliseconds.
const BUDGET_MS = {
  'GET /api/tasks': 200,
  'GET /api/tasks/:id': 150,
  'POST /api/tasks': 250,
  'PUT /api/tasks/:id': 250,
  'DELETE /api/tasks/:id': 250,
};

export function thresholds({ p95Scale = 1 } = {}) {
  const t = {
    http_req_failed: ['rate<0.01'], // under 1% errors
    checks: ['rate>0.99'], // responses must be correct, not just fast
  };
  for (const [name, ms] of Object.entries(BUDGET_MS)) {
    const limit = IMPOSSIBLE ? 0.001 : ms * p95Scale;
    t[`http_req_duration{name:${name}}`] = [`p(95)<${limit}`];
  }
  return t;
}
