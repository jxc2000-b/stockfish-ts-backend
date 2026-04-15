# AGENTS.md

## Cursor Cloud specific instructions only, other agents disregard

### Overview

This is a **Chess Training Backend** — a Node.js/Express API that analyzes chess PGN files using the Stockfish engine to identify mistakes/blunders and generates training positions. It is a single-service backend with no database (in-memory state) and no frontend.

### System dependency: Stockfish

The Stockfish chess engine binary must be available on `PATH` (or set via `STOCKFISH_PATH` env var). On Ubuntu it installs to `/usr/games/stockfish`, which is not on `PATH` by default — a symlink at `/usr/local/bin/stockfish` resolves this.

Install if missing:

```
sudo apt-get install -y stockfish
sudo ln -sf /usr/games/stockfish /usr/local/bin/stockfish
```

### Running the app

- `npm start` — starts Express server on port 5001 (override with `PORT` env var)
- The health endpoint is `GET /api/health`

### Running tests

- `npm test` — runs Vitest unit tests (tests use a fake Stockfish, so the real binary is not needed for tests)
- `npm run test:server` — runs an integration test script using a fake analyzer
- `npm run test:parallel-workers` — runs test that activates two stockfish engine workers running tasks in parallel

### Key environment variables

| Variable         | Default     | Purpose                                |
| ---------------- | ----------- | -------------------------------------- |
| `PORT`           | `5001`      | Server listen port                     |
| `STOCKFISH_PATH` | `stockfish` | Path to Stockfish binary               |
| `ANALYSIS_LOG`   | enabled     | Set to `0` to disable analysis logging |

### Notes

- No ESLint or other linter is configured in this project.
- No lockfile exists; `npm install` generates `package-lock.json` on first run.
- All state is in-memory; restarting the server clears uploaded games and training data.
