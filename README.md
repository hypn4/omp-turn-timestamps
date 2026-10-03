# OMP Turn Timestamps

A native [Oh My Pi](https://omp.sh) plugin that records timing at the OMP turn boundary and can optionally record each tool execution from `tool_call` to `tool_result`.

Timing is added to OMP's existing tool cards instead of creating a separate card. The compact row keeps the date once, puts the turn range first, and adds the optional tool range second:

```text
Bash  printf 'hello\n'
  …
  ◷ 2026-10-03 · turn 21:47:10–21:47:12 (2s) · tool 21:47:12.103–21:47:12.792
  ⟨Wall: 0.69s | Timeout: 300s⟩
```

`showTurnTiming` is enabled by default. On a tool-bearing turn, the turn range and its elapsed time are attached to the last completed tool card. `showToolTiming` is optional and adds the tool's absolute start/end clock to that tool's own card. OMP already renders the tool elapsed duration, so the plugin deliberately does not repeat the tool duration.

The plugin patches only the presentation layer. It does not modify the actual tool output or inject timing text into provider context. A terminal turn with no tool card has nowhere to attach its timestamp, so that case alone falls back to a small transcript timing card after the agent settles.

Structured timing records are also stored as session metadata and are used to restore in-card timing after session resume:

- `omp-turn-timestamps.turn`
- `omp-turn-timestamps.tool` when tool timing is enabled

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
