# attention

A line under the usage bar that appears only when something else needs you:

```
⚠ 3 need you  shader error · home-monitor finished +1    ⏸ webapp resumes 14:00    ⚙ 3 subagents  webapp 2 · shader 1    ctrl+x j
```

| Part | Shows |
| --- | --- |
| `⚠ N need you` | Chats the daemon flags: waiting for a permission or an answer, failed, or finished and not yet viewed. The chat on screen isn't counted. |
| `⏸` | Chats waiting on an automatic resume after a usage limit, from the Paseo daemon plugin [usage-auto-resume](https://github.com/babo-jeonguk/paseo-usage-auto-resume). |
| `⚙ N subagents` | Running subagents across all chats: Paseo child agents and provider subagents, such as Claude's Task and Agent calls and Codex child threads. |

The `⚠` part sorts by urgency (waiting for you, then errors, then finished), oldest first, and takes the color of the most urgent item. Names are each chat's project folder.

The home screen's bottom row shows a short form, such as `⚠ 3  ⏸ 1  ⚙ 2`.

## Use

| Command | Key | Does |
| --- | --- | --- |
| `/next-attention` | `ctrl+x j` | Opens the most urgent chat. Opening a chat clears its flag, as in the Paseo apps. |
| `/dismiss-all` | | Clears every flag after a confirmation. Flags are shared, so this also clears them in the Paseo desktop and phone apps. Chats waiting for a permission keep waiting. |

## Requirements

- Flags and subagents come from the Paseo daemon.
- The `⏸` part needs usage-auto-resume. Without it, that part stays hidden.

## Refresh

- Flags and Paseo child agents update live.
- Provider subagents update live from the daemon's subagent events, with a full re-check of running chats every 60 seconds. A subagent counts only while its parent chat runs, so a missed update can't leave a stale count.
- Automatic resumes refresh every 30 seconds.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `session` | `true` | Shows the line in chats. |
| `home` | `true` | Shows the short form on the home screen. |
| `names` | `2` | How many chats to name before `+N`. `0` shows counts only. |

```jsonc
["~/pasode-plugins/plugins/attention", { "names": 3 }]
```
