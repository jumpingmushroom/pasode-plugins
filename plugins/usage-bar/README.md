# usage-bar

A one-line bar at the top of every chat and in the home screen's bottom row:

```
Claude  5h ▉░░░░░░░░░ 9% · 2h48m   wk █▏░░░░░░░░ 11% · 2d14h          Unraid  cpu 12% · mem 25% · /config 83%
```

- **Usage**: your plan's 5-hour and weekly windows, with the percentage used and the time until each resets. The bar fills in eighths of a cell, so small amounts still show. Per-model windows, such as a separate weekly limit for one model, are left out.
- **Host**: the daemon host's CPU, memory, and fullest disk.

Colors turn from green to yellow to red as each value rises.

| Part | Yellow from | Red from |
| --- | --- | --- |
| Usage | 50% | 80% |
| CPU | 70% | 90% |
| Memory | 75% | 90% |
| Disk | 80% | 90% |

When a usage reading fails, the bar keeps the last good one and grays it out.

## Requirements

- Usage comes from the Paseo daemon's usage reports, which pasode's own sidebar also reads.
- Host stats need the Paseo daemon plugin [host-monitor](https://github.com/a31521424/paseo-kit/tree/main/plugins/host-monitor). Without it, the host part stays hidden.

Host-monitor reports what the daemon's environment sees. In a container, CPU and memory are usually the host's, while disks are the container's mounts, each listed once under its shortest mount point.

## Narrow terminals

| Width | Shows |
| --- | --- |
| 130 columns or more (in a chat) | Usage bars and host stats. |
| 100 columns or more | Usage bars, percentages, and countdowns. |
| 64 columns or more | Percentages and countdowns. |
| Narrower | Percentages only. |

The home screen's bottom row shares its space with pasode's MCP status and version, so it never shows host stats.

## Refresh

| Data | Refresh |
| --- | --- |
| Usage | Every 60 seconds; countdowns every 30 seconds. |
| Host CPU and memory | Every 5 seconds. host-monitor samples every 2 seconds. |
| Host disks | Every 5 seconds. host-monitor reads disks every 30 seconds. |

## Options

| Option | Default | Description |
| --- | --- | --- |
| `providers` | `["claude"]` | Providers to show, in order. Add `"codex"` to show both. |
| `barWidth` | `10` | Cells per usage bar on wide terminals (3–30). |
| `session` | `true` | Shows the bar in chats. |
| `home` | `true` | Shows the bar on the home screen. |
| `host` | `true` | Shows host stats. `false` hides them. |
| `hostDisks` | The fullest disk only | Mounts to show, for example `["/config", "/"]`. |
| `hostLabel` | `"Unraid"` on Unraid, else the daemon's hostname | The name before the host stats. |

```jsonc
["~/pasode-plugins/plugins/usage-bar", { "providers": ["claude", "codex"], "hostDisks": ["/config"] }]
```
