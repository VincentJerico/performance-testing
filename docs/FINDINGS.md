# Findings

Performance findings for [TaskFlow](https://github.com/VincentJerico/taskflow-under-test) at commit
`8b0d564`. Every number here comes from a run in
[results/RESULTS-2026-10-24.md](results/RESULTS-2026-10-24.md), and every finding has a script
that reproduces it.

| ID       | Finding                                                                                     | Severity | Status |
| -------- | ------------------------------------------------------------------------------------------- | -------- | ------ |
| PERF-001 | Password hashing blocks the event loop, so login traffic stalls every other request         | High     | Fixed  |
| PERF-002 | `GET /api/tasks` has no pagination; the response grows with every task                      | Low      | Open   |
| OBS-001  | Task CRUD is not the bottleneck: over 7,000 req/s without breaking the SLO                  | Info     | -      |
| OBS-002  | Server memory over 30-minute soaks: flattens after warm-up, no leak in 14 runs              | Info     | Closed |
| OBS-003  | At 60 logins/s the fixed build is CPU-bound on a CI runner, so slow reads follow the runner | Info     | Open   |

---

## PERF-001: Login traffic stalls every other request

**Severity:** High. **Reproduce:** `k6 run -e LOGIN_RATE=60 experiments/auth-contention.js`

### What happens

Readers call `GET /api/tasks` at a steady 40 requests per second for 60 seconds. Between 20s and
40s, a second group of users signs in. The readers never touch the login endpoint, yet their
latency follows the login rate:

| Login rate  | Readers p95, before | Readers p95, during logins | Readers max, during |  Login p95 |
| ----------- | ------------------: | -------------------------: | ------------------: | ---------: |
| 10 logins/s |              2.0 ms |                    29.0 ms |             30.3 ms |    29.4 ms |
| 30 logins/s |              2.1 ms |                    21.0 ms |             36.8 ms |    22.2 ms |
| 60 logins/s |              2.3 ms |            **12,181.9 ms** |     **15,841.2 ms** | 8,838.3 ms |

At 60 logins per second, a request that normally takes 2 ms took over 12 seconds at p95. The
server didn't return errors; it just stopped keeping up. k6 also ran out of virtual users for the
login scenario (100), so the server received fewer than 60 logins per second and still collapsed.
Once the logins stopped, reads recovered within seconds.

### Why

`src/auth.js` hashes passwords with `crypto.scryptSync`. The `Sync` version runs on Node's single
main thread, and on the test machine one hash takes about **21 ms**. While a hash runs, the server
can't answer anything else, so a cheap read that arrives during a login waits for the hash to
finish. That's why at 10 logins/s the readers' p95 (29.0 ms) almost exactly equals the login time
(29.4 ms).

It also sets a hard ceiling: at 21 ms per hash, one process can do at most about **48 hashes per
second**. Above that, work arrives faster than it can be done and the queue grows without limit.
That's the collapse at 60 logins/s. `POST /api/auth/register` hashes too, so sign-ups count
against the same budget.

### Why it matters

- A login burst (Monday morning, everyone signing in again after a deploy) slows the whole API,
  not just login.
- It's a cheap denial-of-service: about 50 bad login attempts per second, with no valid account,
  freezes the API for everyone. There's no rate limiting on `/api/auth/*`.

### Recommendation

1. Use the async `crypto.scrypt` (promise or callback). It runs on libuv's thread pool, so hashes
   stop blocking requests and can run in parallel.
2. Rate-limit `/api/auth/login` and `/api/auth/register` per IP and per username.
3. Re-run `experiments/auth-contention.js` after the fix. Pass condition: readers' p95 during
   logins stays within 2x the baseline at 30 logins/s.

### Fix and re-test

Fixed in [taskflow-under-test#18](https://github.com/VincentJerico/taskflow-under-test/pull/18)
(merged as `e9012be`), which switches to the async `crypto.scrypt` and adds a per-IP limit of 20
requests per minute on login and register.
The experiment was re-run before and after the fix on the same machine (Apple M5 Pro), with the
rate limit off so it measures the hashing change. Readers' p95 during logins:

| Login rate  | Before (`scryptSync`) | After (async `scrypt`) | Baseline, after |
| ----------- | --------------------: | ---------------------: | --------------: |
| 10 logins/s |               27.7 ms |                 0.4 ms |          0.8 ms |
| 30 logins/s |               20.7 ms |                 0.3 ms |          0.8 ms |
| 60 logins/s |              768.7 ms |                 0.3 ms |          0.8 ms |

Pass condition met: at 30 logins/s, readers' p95 during logins (0.3 ms) is below the baseline
(0.8 ms), against 12.9x the baseline before the fix. Logins themselves still take about 20 to
30 ms each, but they no longer hold up other requests. Full tables:
[RESULTS-2026-10-25.md](results/RESULTS-2026-10-25.md).

These numbers come from a faster machine than the original Linux VM, which is why the old build's
collapse at 60 logins/s is smaller here (768.7 ms rather than 12,181.9 ms).

CI confirms it on Linux at 10 logins/s (the rate the deep job runs). On the same GitHub Actions
runner image, readers' p95 during logins went from 43.9 ms before the fix to 0.9 ms after, against
baselines of 2.2 ms and 0.7 ms.

### Gated nightly

`scripts/check-auth-contention.mjs` now gates the experiment nightly at 10 and 30 logins/s. It also
runs at 60 logins/s, measured only (see OBS-003). It fails when readers' p95 during logins is above
2x the baseline **and** above baseline + 5 ms. The second bound is there because CI baselines are
about 1 ms, where 2x is jitter: in the first gated run, 60 logins/s gave 1.22 ms against a 0.46 ms
baseline (2.6x) on the fixed build.

First gated run, [42224679001](https://github.com/VincentJerico/performance-testing/actions/runs/42224679001)
(GitHub Actions, 0% failed requests in every job):

| TaskFlow          | Logins/s | Readers p95, baseline | Readers p95, during logins |   Login p95 | Gate            |
| ----------------- | -------: | --------------------: | -------------------------: | ----------: | --------------- |
| `e9012be` (fixed) |       10 |               1.09 ms |                    1.38 ms |    26.83 ms | pass            |
| `e9012be` (fixed) |       30 |               1.22 ms |                    1.52 ms |    46.18 ms | pass            |
| `e9012be` (fixed) |       60 |               0.46 ms |                    1.22 ms |    30.91 ms | pass (measured) |
| `8b0d564` (old)   |       30 |               1.04 ms |                7,629.92 ms | 3,398.37 ms | fail            |

The last row is the gate's self-test: the same run starts the old `scryptSync` TaskFlow and passes
only if the gate fails. On this runner the old build collapsed at 30 logins/s, and k6 dropped 123
login iterations.

---

## PERF-002: The task list has no pagination

**Severity:** Low (watch). **Reproduce:** `k6 run experiments/list-growth.js`

`GET /api/tasks` returns every task the user owns, every time. Reading the list at 10 requests
per second for users with different list sizes:

| Tasks in the list | p95 latency | Response size |
| ----------------: | ----------: | ------------: |
|                10 |      3.0 ms |        1.2 KB |
|             1,000 |      4.0 ms |        122 KB |
|            10,000 |     11.0 ms |       1.24 MB |

Server time grows slowly and stays well inside the 200 ms budget, so this isn't a problem on the
server today. The payload is the risk: 1.24 MB per board load is about a full second of download
on a 10 Mbps mobile connection, before the browser renders 10,000 rows.

**Recommendation:** add `limit` and `offset` (or a cursor) with a sensible default, and let the
client filter by `status`. Keep this experiment as a regression check.

---

## OBS-001: Task CRUD is fast; capacity depends on the traffic mix

`scenarios/breakpoint.js` raises the arrival rate of the full task journey (list, create, get,
update, list, delete) until the SLO breaks. It never broke: the run averaged **7,003 requests
per second** (1,167 journeys per second) with a p95 of 38 ms and zero errors. The limit came from
the test machine instead: k6 and TaskFlow shared the same 4 CPUs, and k6 ran out of virtual users
(400) and started dropping iterations.

Taken with PERF-001, this means the capacity of this deployment isn't a single number. Task
traffic scales to thousands of requests per second; about 50 logins per second takes it down.

The stress (up to 150 users) and spike (5 to 200 users in 5 seconds) tests passed for the same
reason: their users signed in during setup, so the spike was task traffic only. A spike of new
users who all sign in at once is the PERF-001 scenario.

---

## OBS-002: Server memory during the soak test

**Status:** Closed, no leak found. **Gated nightly** by `scripts/check-soak-rss.mjs`.

A 150-second sanity run (15 users) first showed memory growing by about 12 MB in two minutes
after warm-up, which was too short to tell a leak from normal heap growth. The nightly CI job then
ran a 30-minute soak (15 users) every night, recording the server's RSS every 30 seconds in
`reports/soak-rss.csv`. Fourteen of those runs, 2026-10-24 to 2026-11-05:

| Run                                                                                          | Date       | TaskFlow  | RSS after warm-up | RSS at 30 min | Second-half slope | Gate |
| -------------------------------------------------------------------------------------------- | ---------- | --------- | ----------------: | ------------: | ----------------: | ---- |
| [40127501364](https://github.com/VincentJerico/performance-testing/actions/runs/40127501364) | 2026-10-24 | `8b0d564` |            137 MB |        139 MB |      0.105 MB/min | pass |
| [40154014010](https://github.com/VincentJerico/performance-testing/actions/runs/40154014010) | 2026-10-25 | `e9012be` |            171 MB |        177 MB |      0.088 MB/min | pass |
| [40229160923](https://github.com/VincentJerico/performance-testing/actions/runs/40229160923) | 2026-10-25 | `8b0d564` |            124 MB |        135 MB |      0.203 MB/min | pass |
| [40409035743](https://github.com/VincentJerico/performance-testing/actions/runs/40409035743) | 2026-10-26 | `8b0d564` |            133 MB |        136 MB |      0.109 MB/min | pass |
| [40587755617](https://github.com/VincentJerico/performance-testing/actions/runs/40587755617) | 2026-10-27 | `8b0d564` |            127 MB |        139 MB |      0.247 MB/min | pass |
| [40776178943](https://github.com/VincentJerico/performance-testing/actions/runs/40776178943) | 2026-10-28 | `8b0d564` |            126 MB |        134 MB |      0.287 MB/min | pass |
| [40963584419](https://github.com/VincentJerico/performance-testing/actions/runs/40963584419) | 2026-10-29 | `8b0d564` |            124 MB |        134 MB |      0.115 MB/min | pass |
| [41133348684](https://github.com/VincentJerico/performance-testing/actions/runs/41133348684) | 2026-10-30 | `8b0d564` |            135 MB |        136 MB |      0.000 MB/min | pass |
| [41240366146](https://github.com/VincentJerico/performance-testing/actions/runs/41240366146) | 2026-10-31 | `8b0d564` |            124 MB |        134 MB |      0.147 MB/min | pass |
| [41352038145](https://github.com/VincentJerico/performance-testing/actions/runs/41352038145) | 2026-11-01 | `8b0d564` |            127 MB |        135 MB |      0.072 MB/min | pass |
| [41550717138](https://github.com/VincentJerico/performance-testing/actions/runs/41550717138) | 2026-11-03 | `8b0d564` |            132 MB |        134 MB |      0.000 MB/min | pass |
| [41732643130](https://github.com/VincentJerico/performance-testing/actions/runs/41732643130) | 2026-11-03 | `8b0d564` |            130 MB |        137 MB |      0.111 MB/min | pass |
| [41929789902](https://github.com/VincentJerico/performance-testing/actions/runs/41929789902) | 2026-11-04 | `8b0d564` |            130 MB |        134 MB |      0.113 MB/min | pass |
| [42125961430](https://github.com/VincentJerico/performance-testing/actions/runs/42125961430) | 2026-11-05 | `8b0d564` |            130 MB |        139 MB |      0.095 MB/min | pass |

The first 5 minutes are warm-up (RSS goes from 66-88 MB at start to 124-171 MB). After that, memory
grows by 1 to 12 MB over the remaining 25 minutes and flattens: the slope of the second half of
those samples was at most 0.287 MB/min, and 0.000 in two runs. A leak keeps climbing at a steady
rate instead.

**The gate:** the nightly soak now fails if that second-half slope is above 0.5 MB/min, which is
clear of every run above. Its self-test (`npm test`) feeds it a real soak with 1 MB per minute
added after warm-up and expects a failure. With fewer than 10 samples over 10 minutes after
warm-up, it exits 2 (nothing checked) rather than passing.

**Watch:** both soaks on the fixed TaskFlow (`e9012be`, PERF-001) sat about 40 MB higher than the
old build for the whole run, though just as flat: 171 to 177 MB in run 40154014010, and 169 to
173 MB (slope 0.257 MB/min) in the first gated run, 42224679001. Two runs agree, but they don't say
why. Once `TASKFLOW_REF` points at `e9012be`, every nightly soak will add a data point.

---

## OBS-003: At 60 logins/s, the fixed build runs out of CPU on a CI runner

**Status:** Open (watch). **Measured nightly**, not gated.

With async `crypto.scrypt`, hashing no longer blocks the event loop (PERF-001 is fixed), but it
still costs CPU. At 60 logins/s, two deep runs of the same code on GitHub Actions gave very
different results for readers:

| Run                                                                                          | Login median (about one hash) | Readers p95, baseline | Readers p95, during logins | Readers median, during logins |
| -------------------------------------------------------------------------------------------- | ----------------------------: | --------------------: | -------------------------: | ----------------------------: |
| [42224679001](https://github.com/VincentJerico/performance-testing/actions/runs/42224679001) |                       25.6 ms |               0.46 ms |                    1.22 ms |                       0.85 ms |
| [42229552873](https://github.com/VincentJerico/performance-testing/actions/runs/42229552873) |                       45.1 ms |               0.73 ms |                   47.82 ms |                       1.00 ms |

Both used TaskFlow `e9012be`, with 0% failed requests. In the second run everything on the runner
was slower, and a single hash took almost twice as long. At 60 logins/s and about 45 ms per hash,
hashing needs roughly 2.7 CPU cores, on a 4-vCPU runner that is also running k6. The median read
stayed near 1 ms, so the event loop isn't blocked: the machine is short of CPU, and the slowest
reads wait for it.

At 10 and 30 logins/s, readers stayed between 1.28 and 1.52 ms p95 in both runs, even though hash
time varied from 24.6 to 48.2 ms between runners. That's why the gate covers those rates.

**What it means:** one TaskFlow process tops out somewhere around 60 logins/s on 4 vCPUs. The auth
rate limit (20 requests per minute per IP) keeps any single client far below that; many clients
signing in at once could still reach it. The 60/s result is recorded every night on the trend page,
so a trend will show even though it doesn't fail the run.
