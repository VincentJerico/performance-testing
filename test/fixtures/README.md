# Test fixtures

Real CI output, so the gate tests run against numbers the suite actually produced.

| File                               | Source                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-contention-old-build.json`   | Nightly run [42125961430](https://github.com/VincentJerico/performance-testing/actions/runs/42125961430), TaskFlow `8b0d564` (scryptSync) |
| `auth-contention-fixed-build.json` | Deep run [40154014010](https://github.com/VincentJerico/performance-testing/actions/runs/40154014010), TaskFlow `e9012be` (async scrypt)  |
| `soak-rss-nightly.csv`             | Nightly run [40587755617](https://github.com/VincentJerico/performance-testing/actions/runs/40587755617), the soak with the most growth   |
| `soak-rss-short.csv`               | The first 11 samples of `soak-rss-nightly.csv`                                                                                            |
| `soak-rss-leak.csv`                | `soak-rss-nightly.csv` plus 1 MB per minute after the 300 s warm-up: a synthetic leak                                                     |

The leak file was made with:

```bash
node -e '
const fs = require("fs");
const rows = fs.readFileSync("test/fixtures/soak-rss-nightly.csv", "utf8").trim().split("\n");
const out = [rows[0], ...rows.slice(1).map((l) => {
  const [s, mb] = l.split(",").map(Number);
  return `${s},${s >= 300 ? mb + Math.round((s - 300) / 60) : mb}`;
})];
fs.writeFileSync("test/fixtures/soak-rss-leak.csv", out.join("\n") + "\n");'
```
