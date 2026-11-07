# End-to-end test

Runs the TV page, host page and the players' phones in headless Chromium
against a local stand-in for Firebase (`server.js` + `mock-db.js`), so the real
database is never touched. Phone B's clock is 7s fast and the host's 90s slow,
to check that timing doesn't depend on device clocks.

Covers: Cat 3 auction (draws, gates, deadlines, duplicates, one confirm
button), score undo, Cat 6 step-by-step reveal and shared judging, Cat 7-8
team cards, Cat 9 QR hiding and timer.

```sh
node tests/e2e/server.js . 8765 &      # from the repo root
node tests/e2e/test.js
```

Needs Node 18+ and Playwright (`PLAYWRIGHT_PATH` / `CHROME_PATH` env vars can
point to an existing install).
