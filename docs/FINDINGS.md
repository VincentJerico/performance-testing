# Findings

Performance findings for [TaskFlow](https://github.com/VincentJerico/taskflow-under-test) at commit
`8b0d564`. Every number here comes from a run in
[results/RESULTS-2026-10-24.md](results/RESULTS-2026-10-24.md), and every finding has a script
that reproduces it.

| ID       | Finding                                                                             | Severity | Status |
| -------- | ----------------------------------------------------------------------------------- | -------- | ------ |
| PERF-001 | Password hashing blocks the event loop, so login traffic stalls every other request | High     | Open   |
| PERF-002 | `GET /api/tasks` has no pagination; the response grows with every task              | Low      | Open   |
| OBS-001  | Task CRUD is not the bottleneck: over 7,000 req/s without breaking the SLO          | Info     | -      |
| OBS-002  | Server memory during a short soak: inconclusive, needs the 30-minute run            | Info     | Open   |

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

A 150-second soak sanity run (15 users) recorded the server's memory every 30 seconds:

| Time   |  0s | 30s | 60s | 90s | 120s | 150s |
| ------ | --: | --: | --: | --: | ---: | ---: |
| RSS MB |  64 | 111 | 118 | 119 |  122 |  123 |

The jump in the first 30 seconds is warm-up. After that, memory still grew by about 12 MB in
two minutes. That's too short to tell a leak from normal heap growth before garbage collection
settles. The nightly CI run does a 30-minute soak and records memory in
`reports/soak-rss.csv`; that run decides this one.
