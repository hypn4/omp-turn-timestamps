# OMP Turn Timestamps

A native [Oh My Pi](https://omp.sh) plugin that records when each user-prompt agent loop started, when it finally settled, and the total elapsed time.

```text
◷ 2026-10-03 20:31:14 → 20:43:55 · 12m 41s
```

The plugin measures the full `agent_start` → terminal `agent_end` interval. Automatic continuations stay inside the same measurement, so retries and continuation work are not reported as separate user turns.

Timing breadcrumbs are persisted in the session transcript with ISO start/end timestamps and `elapsedMs`, but are filtered from future LLM context so they do not consume model context or affect behavior.

## Install

Install directly from GitHub:

```bash
omp plugin install github:hypn4/omp-turn-timestamps
```

Then restart OMP sessions that were already running before installation. New sessions discover installed plugins automatically.

For OMP's built-in per-turn usage row, also enable:

```yaml
display:
  showTokenUsage: true
  showTurnTime: true
```

or:

```bash
omp config set display.showTokenUsage true
omp config set display.showTurnTime true
```

## Development

```bash
bun test
```

For local plugin development from this repository:

```bash
omp plugin link .
```

## License

MIT
