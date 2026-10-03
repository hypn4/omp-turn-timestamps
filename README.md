# OMP Turn Timestamps

A native [Oh My Pi](https://omp.sh) plugin that records timing at the OMP turn boundary and can optionally record each tool execution from `tool_call` to `tool_result`.

Timing is added to OMP's existing tool cards instead of creating a separate card. At normal widths it stays compact:

```text
Bash  printf 'hello\n'
  …
  ◷ 2026-10-03 · turn 21:47:10–21:47:12 (2s) · tool 21:47:12.103–21:47:12.792
  ⟨Wall: 0.69s | Timeout: 300s⟩
```

When the pane gets narrower, the presentation layer automatically reflows at semantic boundaries instead of truncating timestamps:

```text
  ◷ 2026-10-03 · turn 21:47:10–21:47:12 (2s)
  tool 21:47:12.103–21:47:12.792
```

At very narrow widths it can expand to separate date, turn, and tool rows; if even one semantic row is too wide, that row word-wraps and finally hard-wraps rather than losing the end of the timestamp.

`showTurnTiming` is enabled by default. On a tool-bearing turn, the turn range and its elapsed time are attached to the last completed tool card. `showToolTiming` is optional and adds the tool's absolute start/end clock to that tool's own card. OMP already renders the tool elapsed duration, so the plugin deliberately does not repeat the tool duration unless `showToolDuration` is enabled.

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

Tool timestamps use millisecond precision by default. Toggle it independently:

```bash
omp plugin config set omp-turn-timestamps showToolMilliseconds true
omp plugin config set omp-turn-timestamps showToolMilliseconds false
```

Tool elapsed duration is hidden by default because OMP already shows `Wall`. Enable the explicit parenthesized duration when desired:

```bash
omp plugin config set omp-turn-timestamps showToolDuration true
omp plugin config set omp-turn-timestamps showToolDuration false
```

With both options enabled, the tool portion renders like:

```text
tool 21:47:12.103–21:47:12.792 (689ms)
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
