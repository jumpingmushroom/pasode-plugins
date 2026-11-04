# sound

Plays a sound when a chat you have open finishes, asks a question, waits for a permission, or fails. While the terminal is in the background, it also rings the terminal bell, so the window manager can mark the window as urgent.

| Event | Linux sound | macOS sound |
| --- | --- | --- |
| Finished | `message.oga` | `Glass.aiff` |
| Question, or a plan to approve | `window-question.oga` | `Purr.aiff` |
| Permission (a tool or mode request) | `message-new-instant.oga` | `Ping.aiff` |
| Error | `dialog-error.oga` | `Basso.aiff` |

Linux sounds come from the freedesktop sound theme (`/usr/share/sounds/freedesktop/stereo/`). macOS sounds come from `/System/Library/Sounds/`.

## Which chats make a sound

- Only chats open as tabs in pasode. Scheduled runs and chats opened only in the desktop or phone app stay quiet. To silence a chat, close its tab with `/close-tab`.
- The chat on screen stays quiet while the terminal has focus.
- The daemon sends some events twice, so one chat and event sounds at most once in 3 seconds. Several chats finishing together play at most one sound per second.

The plugin hears the daemon's events directly, so it works whichever client the daemon picks for notifications.

## Use

| Command | Does |
| --- | --- |
| `/mute` | Mutes sounds. The setting survives restarts. |
| `/unmute` | Turns sounds back on. |
| `/sound-test` | Plays each sound in turn. |

## Requirements

- **Linux**: `pw-play` (PipeWire) or `paplay` (PulseAudio), and the freedesktop sound theme (package `sound-theme-freedesktop` on most distributions).
- **macOS**: `afplay`, which ships with macOS. The macOS defaults are untested.

## Terminal bell

The bell rings only on Linux, only while the terminal is unfocused, and never for the chat you're looking at. In kitty, the bell requests window attention (`window_alert_on_bell`, on by default) and can mark the tab. To keep kitty from beeping on top of the plugin's sound, add this to `kitty.conf`:

```
enable_audio_bell no
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `sounds` | The platform's defaults above | Sound files per event: `finished`, `question`, `permission`, `error`. |
| `reasons` | All four | Events that make a sound, for example `["question", "permission", "error"]`. |
| `volume` | Full | 0–1. Works with `pw-play` and `afplay`. |
| `player` | `["pw-play", "paplay"]` on Linux, `["afplay"]` on macOS | Players to try in order until one starts. |
| `bell` | `true` | `false` turns off the terminal bell. |

```jsonc
["~/pasode-plugins/plugins/sound", {
  "volume": 0.6,
  "sounds": { "finished": "/usr/share/sounds/freedesktop/stereo/bell.oga" }
}]
```

## Notes

The plugin reads pasode's open tabs from `$XDG_STATE_HOME/pasode/kv.json` (default `~/.local/state/pasode/kv.json`) and stores the mute setting next to it in `sound.json`.
