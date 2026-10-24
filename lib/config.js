// Shared settings for every scenario.
// Point at another host with:  k6 run -e BASE_URL=http://host:port scenarios/<file>.js

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Think time between user actions, in seconds. Real users pause; scripts that never pause
// measure a firehose, not a user. Set THINK_TIME=0 for raw-throughput experiments.
export const THINK_TIME = Number(__ENV.THINK_TIME ?? 1);

// Every run uses its own usernames, so runs never collide on the shared database.
export const RUN_ID = __ENV.RUN_ID || `${Date.now().toString(36)}`;

export const PASSWORD = 'k6-Perf-Passw0rd!';
