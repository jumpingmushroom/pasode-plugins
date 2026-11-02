# prompts

Your saved prompts from [Paseo Prompt Manager](https://github.com/yannelli/paseo-prompt-manager), usable from pasode: a row of buttons at the top of each chat, a picker that also creates and edits prompts, and one slash command per prompt.

```
 Prompt Manager:  approved   yes   continue   complete-code-review   +2
```

Choosing a prompt sends it to the chat on screen, as **Send to agent** does in the Paseo apps. If the prompt has variables, such as `{{ module }}` or `{{ person | me }}`, pasode first asks for each one in a box prefilled with its default. Enter keeps the default, and `esc` cancels.

## Send prompts

| Action | How |
| --- | --- |
| Send with the mouse | Click a button. `+` (or `+N` when more prompts qualify) opens the picker. |
| Pick from the whole library | `ctrl+x i`, or run `/prompts`. Enter sends the selected prompt. |
| Send by name | Type `/p:` and choose from the completion list, for example `/p:approved`. |

While the chat is idle or waiting on you, a click sends at once. While a turn runs, the first click turns the button into **click again**, and a second click within 4 seconds sends the prompt. Sending mid-turn steers the running turn, as typing a message does, so it never interrupts it.

Prompts go to the chat on screen. On the home screen, pasode asks you to open a chat first.

### Why `/p:approved` and not `/prompt approved`

pasode runs slash commands from the completion list, without arguments. Text such as `/prompt approved` reaches the agent as an ordinary message. A command per prompt keeps everything in the completion list, so nothing is sent by accident. Prompts in folders use `.` for `/`, for example `/p:engineering.security.code-review`.

## Create and edit prompts

In the picker:

| Key | Does |
| --- | --- |
| `ctrl+n` | Creates a prompt: asks for a file name, then opens your editor. Also **New prompt…** in the list, or `/prompt-new`. |
| `ctrl+e` | Opens the selected prompt in your editor. |
| `ctrl+f` | Adds or removes the `quick` tag, which puts the prompt on the button row or takes it off. |
| `ctrl+d` twice | Archives the prompt. Restore archived prompts in Prompt Manager. |

The editor is `$VISUAL` or `$EDITOR`, as for pasode's `ctrl+x e`. The file starts with the prompt's details, then a `---` line, then the prompt itself:

```
# Lines above --- are details: description and comma-separated tags ("quick" puts it on the button row).
description: When the agent needs your approval
tags: quick
---
# approved

Looks good, go ahead.
```

Save and quit to store the prompt; quit without changes to leave it as it was. The prompt's title is its first Markdown heading, as in Prompt Manager. If you remove the details lines, the details stay as they were.

Every change goes through Prompt Manager, so the desktop and phone apps see it at once, and Prompt Manager keeps a version for each save. If the prompt changed elsewhere after you opened it, Prompt Manager refuses the save instead of overwriting the other change. The plugin then keeps your edited file and shows its path. Version history, folders, and Git sync stay in the Paseo apps.

## Choose and order the buttons

- **Which prompts**: those tagged `quick` (toggle with `ctrl+f`). Until any prompt has the tag, all prompts qualify. The `buttons` option lists them yourself instead.
- **Order**: by `sort`. The default, `used`, puts the prompts you send most often first. The plugin counts sends itself, because Prompt Manager doesn't, so until you have sent some, prompts appear alphabetically. The picker uses the same order.
- **How many**: up to `max` buttons. When more qualify, the last button shows `+N` and opens the picker.

## Requirements

The Paseo daemon plugin [Prompt Manager](https://github.com/yannelli/paseo-prompt-manager) (`paseo-prompt-manager`). The library refreshes every 60 seconds, whenever the picker opens, and after every change. Without the plugin, the row stays hidden and the picker says so.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `label` | `"Prompt Manager:"` | Text before the buttons. `""` hides it. |
| `sort` | `"used"` | Button and picker order: `"used"` (most sent first), `"recent"` (last edited first), `"title"`, or `"library"` (Prompt Manager's own order). |
| `max` | `6` | Buttons shown before `+N`. |
| `tag` | `"quick"` | Prompts with this tag become buttons. While none has it, all prompts do. |
| `buttons` | | Prompt ids to show as buttons, in this order. Overrides `tag` and `sort`. |
| `row` | `true` | `false` hides the button row. |
| `commands` | `true` | `false` skips the `/p:<id>` commands. |
| `prefix` | `"p:"` | The prefix of the per-prompt commands. |
| `plugin` | `"paseo-prompt-manager"` | Prompt Manager's plugin id on the daemon. |

```jsonc
["~/pasode-plugins/plugins/prompts", { "label": "Prompts:", "sort": "recent", "max": 4 }]
```

The send counts for `"used"` live in `$XDG_STATE_HOME/pasode/prompts.json` (default `~/.local/state/pasode/prompts.json`).

## Credits

`templates.ts` is ported from Prompt Manager (MIT, Copyright (c) 2026 Ryan Yannelli), so variables fill in exactly as in the Paseo apps.
