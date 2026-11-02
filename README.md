# pasode-plugins

Plugins for [pasode](https://github.com/ragokan/pasode), the terminal client for the [Paseo](https://paseo.sh) daemon. They use only pasode's plugin API, so they work with a stock pasode binary and need no fork.

| Plugin | What it adds |
| --- | --- |
| [projects](plugins/projects) | A project picker like the Paseo app's sidebar: pinned chats, every project with its chats (archived ones too), new chats and worktrees, new projects, and GitHub clones. Opens on launch outside a known project. |
| [usage-bar](plugins/usage-bar) | A one-line bar with your Claude 5-hour and weekly usage, plus the daemon host's CPU, memory, and fullest disk. |
| [attention](plugins/attention) | A line that appears when other chats need you, wait on an automatic resume, or run subagents, with a key to jump to the next one. |
| [prompts](plugins/prompts) | Your Prompt Manager library: clickable buttons at the top of each chat, a picker that also creates and edits prompts in your editor, and a `/p:<name>` command per prompt, with variables filled in before sending. |
| [sound](plugins/sound) | A sound when a chat you have open finishes, asks a question, waits for a permission, or fails, plus a terminal bell for window urgency. |

The plugins suit a remote daemon especially well: the projects picker starts chats in the daemon's folders, which don't exist on the machine that runs pasode.

## Requirements

- pasode 0.4.1 or later. The plugins load from source, so a pasode binary installed with `install.sh` works.
- A Paseo daemon (tested with 0.14.0).
- Optional Paseo daemon plugins, for extra parts of the bars. Without them those parts stay hidden:
  - [host-monitor](https://github.com/a31521424/paseo-kit/tree/main/plugins/host-monitor) for the host stats in usage-bar.
  - [usage-auto-resume](https://github.com/babo-jeonguk/paseo-usage-auto-resume) for automatic resumes in attention.
  - [Prompt Manager](https://github.com/yannelli/paseo-prompt-manager), which the prompts plugin needs for its library.

## Install

1. Clone the repository:

   ```sh
   git clone https://github.com/jumpingmushroom/pasode-plugins ~/pasode-plugins
   ```

2. In `~/.config/pasode/cli.json`, add the plugins you want to the `plugins` list. Each entry is a path, or a path and an options object:

   ```jsonc
   {
     "plugins": [
       "~/pasode-plugins/plugins/projects",
       "~/pasode-plugins/plugins/usage-bar",
       "~/pasode-plugins/plugins/attention",
       ["~/pasode-plugins/plugins/sound", { "volume": 0.6 }],
       "~/pasode-plugins/plugins/prompts"
     ]
   }
   ```

3. Restart pasode. To confirm the plugins loaded, run `/status`.

No build or install step is needed: pasode loads the TypeScript directly and supplies Solid and OpenTUI.

To update, run `git pull` in the clone and restart pasode.

## Configure

Each plugin reads its options from its entry in `cli.json`, the plugin configuration file that pasode provides. Every option has a default, so a bare path works. [examples/cli.jsonc](examples/cli.jsonc) lists every option with its default value, and each plugin's README explains them.

## Develop

- Run the tests (no dependencies needed):

  ```sh
  bun test
  ```

- Type-check against pasode's own types. This needs a pasode source checkout with its dependencies installed:

  ```sh
  git clone https://github.com/ragokan/pasode ~/src/pasode && (cd ~/src/pasode && bun install)
  PASODE_SRC=~/src/pasode scripts/typecheck.sh
  ```

Each plugin keeps its decisions in a `model.ts` with no UI or daemon code, covered by `model.test.ts`. The `tui.ts` or `tui.tsx` file connects that model to pasode.

## License

MIT. See [LICENSE](LICENSE). The countdown format in usage-bar is adapted from pasode's `usage-sidebar` plugin (MIT). The prompt variable parser in prompts is ported from Paseo Prompt Manager (MIT, Ryan Yannelli).
