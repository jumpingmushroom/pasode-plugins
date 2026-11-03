# media

A media player in pasode's sidebar. It shows what your browser or music app is playing, with the cover, a progress bar, and controls, so you can pause a video or skip a song without leaving pasode.

```
Now playing · YouTube Music
▓▓▓▓▓▓▓▓ Midnight City
▓▓▓▓▓▓▓▓ M83
▓▓▓▓▓▓▓▓
━━━━━━━━━━━━━━━━━━━━━━━━━━
2:31      ⏮  ⏸  ⏭      4:03
```

The plugin reads and controls players through Linux's media controls (MPRIS) with `playerctl`. It works with any player that shows up in `playerctl -l`, such as Zen, Firefox, Chrome, Spotify, or mpv. Browsers report YouTube and YouTube Music there by default.

## Use

The section sits at the bottom of the sidebar, right above the **Paseo** line. It hides while nothing is playing or paused. Like the rest of the sidebar, it shows in chats, not on the home screen.

- Click ⏮, ▶ or ⏸, or ⏭ to go back, play or pause, or skip.
- Click the progress bar to jump to that spot.

| Command | Key | Does |
| --- | --- | --- |
| Play / pause | `ctrl+x f` | Plays or pauses. |
| Next track | | Skips to the next track or video. |
| Previous track | | Goes back to the previous track or video. |

Run the commands from the palette (`ctrl+p`). Your keyboard's media keys control the same players, in pasode and everywhere else.

With several players open, such as two YouTube tabs, the section follows the one that most recently started playing. With none playing, it follows the one you paused last.

The cover shows as an image in terminals that support images, such as kitty. Other terminals show it with block characters. When a player reports no length, for example for a live stream or an ad, the end time reads **live** and clicking the bar does nothing.

## Requirements

- Linux with `playerctl`. On Arch Linux, install the `playerctl` package. Without it, the plugin shows a warning once and stays hidden.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `keys` | `{ "playPause": "<leader>f" }` | Keys for `playPause`, `next`, and `previous`. `next` and `previous` have none by default. |
| `cover` | `true` | Shows the cover. `false` hides it, and the title takes the full width. |

```jsonc
["~/pasode-plugins/plugins/media", { "keys": { "playPause": "<leader>f", "next": "<leader>z" } }]
```

The plugin draws pasode's sidebar footer and keeps pasode's own footer line, with the Paseo daemon's version and connection status, under the player. It replaces the footer of any other plugin that also draws one.
