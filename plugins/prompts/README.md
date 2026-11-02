# prompts

Your saved prompts from [Paseo Prompt Manager](https://github.com/yannelli/paseo-prompt-manager), usable from pasode: a row of buttons at the top of each chat, a searchable picker, and one slash command per prompt.

```
 approved   complete-code-review   continue   yes   +
```

Choosing a prompt sends it to the chat on screen, as **Send to agent** does in the Paseo apps. If the prompt has variables, such as `{{ module }}` or `{{ person | me }}`, pasode first asks for each one in a box prefilled with its default. Enter keeps the default, and `esc` cancels.

## Use

| Action | How |
| --- | --- |
| Send a prompt with the mouse | Click its button. `+` opens the picker. |
| Pick from the whole library | `ctrl+x i`, or run `/prompts`. Search covers titles. |
| Send a prompt by name | Type `/p:` and choose from the completion list, for example `/p:approved`. |

While the chat is idle or waiting on you, a click sends at once. While a turn runs, the first click turns the button into **click again**, and a second click within 4 seconds sends the prompt. Sending mid-turn steers the running turn, as typing a message does, so it never interrupts it.

Prompts go to the chat on screen. On the home screen, pasode asks you to open a chat first.

### Why `/p:approved` and not `/prompt approved`

pasode runs slash commands from the completion list, without arguments. Text such as `/prompt approved` reaches the agent as an ordinary message. A command per prompt keeps everything in the completion list, so nothing is sent by accident. Prompts in folders use `.` for `/`, for example `/p:engineering.security.code-review`.

## Choose the buttons

By default, prompts tagged `quick` become buttons. Until any prompt has that tag, every prompt does. To tag a prompt, open **Details** in Prompt Manager's editor. Alternatively, list the buttons yourself with the `buttons` option. Buttons that don't fit the width are cut off; `+` still reaches every prompt through the picker.

## Requirements

The Paseo daemon plugin [Prompt Manager](https://github.com/yannelli/paseo-prompt-manager) (`paseo-prompt-manager`). The library refreshes every 60 seconds and whenever the picker opens. Without the plugin, the row stays hidden and the picker says so.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `tag` | `"quick"` | Prompts with this tag become buttons. While none has it, all prompts do. |
| `buttons` | | Prompt ids to show as buttons, in order. Overrides `tag`. |
| `row` | `true` | `false` hides the button row. |
| `commands` | `true` | `false` skips the `/p:<id>` commands. |
| `prefix` | `"p:"` | The prefix of the per-prompt commands. |
| `plugin` | `"paseo-prompt-manager"` | Prompt Manager's plugin id on the daemon. |

```jsonc
["~/pasode-plugins/plugins/prompts", { "buttons": ["approved", "yes", "continue"] }]
```

## Credits

`templates.ts` is ported from Prompt Manager (MIT, Copyright (c) 2026 Ryan Yannelli), so variables fill in exactly as in the Paseo apps.
