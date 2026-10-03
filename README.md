# OMP Turn Timestamps

A native [Oh My Pi](https://omp.sh) plugin that records timing at the OMP turn boundary and can optionally record each tool execution from `tool_call` to `tool_result`.

Turn timing is enabled by default:

```text
◷ turn 2026-10-03 21:47:12 → 21:47:15 · 3.2s
```

Optional tool timing keeps millisecond clock precision:

```text
◷ tool bash 2026-10-03 21:47:12.103 → 21:47:12.792 · 689ms
```

Tool-bearing turns queue their tool cards and turn card onto the continuation boundary that already exists after tool execution, so long-running Chappie/ChatGPT-driven OMP sessions do not have to wait for `agent_end` and the plugin does not create a synthetic model turn. Terminal/no-tool turns are rendered once the agent settles.

Structured timing records are also stored as session metadata:

- `omp-turn-timestamps.turn`
- `omp-turn-timestamps.tool` when tool timing is enabled

Visible timing cards are filtered from future provider context, so they do not consume model context or affect model behavior.

## Install

Install directly from GitHub:

```bash
omp plugin install github:hypn4/omp-turn-timestamps
```

Restart OMP sessions that were already running before the plugin was installed or upgraded. New sessions discover installed plugins automatically.

## Configuration

Inspect the plugin settings:

```bash
omp plugin config list omp-turn-timestamps
```

Turn timing is enabled by default:

```bash
omp plugin config set omp-turn-timestamps showTurnTiming true
```

Per-tool timing is disabled by default. Enable it with:

```bash
omp plugin config set omp-turn-timestamps showToolTiming true
```

Disable it again with:

```bash
omp plugin config set omp-turn-timestamps showToolTiming false
```

The settings are read at each `turn_start`, so a changed setting takes effect on the next turn.

OMP's built-in per-turn usage row can also be enabled independently:

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
