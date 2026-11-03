# projects

A project picker for pasode, like the per-project **+** in the Paseo app's sidebar.

pasode starts a new chat in the folder pasode was launched from. With a remote daemon that folder usually doesn't exist on the daemon, so the chat starts in the wrong place. This plugin lists the daemon's own projects and starts chats in their folders.

## Use

Press `ctrl+x p`, or run `/projects`. The picker also opens on launch when pasode starts outside every known project folder.

The picker has three sections:

- **Add**: **New project…** creates an empty folder in the projects root. **Clone from GitHub…** clones `owner/repo` or a GitHub URL into the projects root.
- **Pinned**: your pinned chats, the same ones as the **Pinned** group in pasode's session switcher (`ctrl+x l`). Pins are Paseo's own, so they match the desktop and phone apps. Enter opens the chat.
- **Projects**: every project, most recently used first, with its chat count.

Pick a project to see:

- **← All projects**, which returns to the list. `esc` does the same; a second `esc` closes the picker.
- **New chat**, which starts a chat in the project's folder.
- **New chat in a git worktree**, for git projects, which asks for a branch name and base.
- **Chats**: every chat in the project, newest first. An archived chat is restored when you open it, and an empty workspace starts a new chat in its folder.

To start a chat after picking, type your message. The home screen shows the project's folder.

When you archive the chat you're in, pasode sends you to the home screen, and the picker opens there, so another pinned chat or project is one key away. Esc closes it and leaves you on the home screen. This also works when you archive the chat you're in from the session switcher (`ctrl+x l`): the switcher closes, and the picker opens instead. Archiving another chat from the switcher keeps you in the switcher. The picker doesn't open when you go home without archiving. To turn this off, set `openAfterArchive` to `false`.

| Command | Key | Does |
| --- | --- | --- |
| `/projects` | `ctrl+x p` | Opens the picker. |
| `/new-project` | | Creates a project. |
| `/clone` | | Clones a GitHub repository as a project. |

## Options

| Option | Default | Description |
| --- | --- | --- |
| `root` | The folder that most project folders sit in | Where **New project…** and **Clone from GitHub…** put new projects. |
| `autoOpen` | `true` | Opens the picker on launch outside a known project. `false` turns this off. |
| `cloneProtocol` | `"https"` | How **Clone from GitHub…** clones `owner/repo`: `"https"` or `"ssh"`. A pasted `git@…` or `ssh://` address always clones over SSH, and an `https://` URL over HTTPS. |
| `openAfterArchive` | `true` | Opens the picker when archiving the chat you're in sends you to the home screen. `false` turns this off. |

```jsonc
["~/pasode-plugins/plugins/projects", { "root": "/srv/projects", "autoOpen": true, "cloneProtocol": "https" }]
```

## Notes

- The daemon clones, not the machine that runs pasode. A private repository over HTTPS needs GitHub credentials on the daemon's host, and one over SSH needs an SSH key there that GitHub accepts.
- To find archived chats, the picker loads the daemon's session history in the background when it opens. A few hundred sessions take well under a second.
- In Paseo a chat is a workspace with one top-level session. Paseo child agents (labelled `paseo.parent-agent-id`) don't appear as chats.
- On the home screen, pasode's `ctrl+x n` clears the picked project. Inside a chat, it starts a new chat in the same project.
