// Breakpoint test: keep raising the arrival rate until the system breaks its SLO, then stop.
// The rate at which it aborts is the capacity of this deployment.
// Uses an arrival-rate executor: new journeys start on schedule whether or not the server keeps
// up, so a slow server shows up as latency instead of quietly lowering the load (as it would
// with a fixed number of VUs).
//   k6 run scenarios/breakpoint.js

import { createUserPool, taskJourney } from '../lib/journey.js';

export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s', // journeys started per second (each journey is 6 requests)
      preAllocatedVUs: 50,
      maxVUs: 600,
      stages: [{ duration: __ENV.DURATION || '3m', target: Number(__ENV.MAX_RATE || 2500) }],
    },
  },
  thresholds: {
    // Abort as soon as the SLO breaks (after a 10s grace period, so one slow burst
    // doesn't end the test).
    http_req_duration: [{ threshold: 'p(95)<500', abortOnFail: true, delayAbortEval: '10s' }],
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '10s' }],
  },
};

export function setup() {
  return createUserPool(50);
}

export default function (data) {
  taskJourney(data, 0); // no think time: this measures raw capacity
}
