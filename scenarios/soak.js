// Soak test: normal load for a long time. Looks for what only shows up with time:
// memory growth, slow leaks, a database that gets slower as it fills, connection exhaustion.
//   k6 run scenarios/soak.js                     # 10 minutes
//   k6 run -e DURATION=1h scenarios/soak.js      # the real thing

import { createUserPool, taskJourney } from '../lib/journey.js';
import { thresholds } from '../lib/slo.js';

const USERS = 15;

export const options = {
  scenarios: {
    soak: { executor: 'constant-vus', vus: USERS, duration: __ENV.DURATION || '10m' },
  },
  thresholds: thresholds(),
};

export function setup() {
  return createUserPool(USERS);
}

export default function (data) {
  taskJourney(data);
}
