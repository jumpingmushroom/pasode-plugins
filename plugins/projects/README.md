# projects

A project picker for pasode, like the per-project **+** in the Paseo app's sidebar.

pasode starts a new chat in the folder pasode was launched from. With a remote daemon that folder usually doesn't exist on the daemon, so the chat starts in the wrong place. This plugin lists the daemon's own projects and starts chats in their folders.

## Use

Press `ctrl+x p`, or run `/projects`. The picker also opens on launch when pasode starts outside every known project folder.

The picker has three sections:

- **Add**: **New project…** creates an empty folder in the projects root. **Add existing folder…** adds a folder that's already on the daemon: pick one of the projects root's folders that isn't a project yet, or pick **Type a path…** and enter an absolute path, or one relative to the projects root. **Clone from GitHub…** clones `owner/repo` or a GitHub URL into the projects root.
- **Pinned**: your pinned chats, the same ones as the **Pinned** group in pasode's session switcher (`ctrl+x l`). Pins are Paseo's own, so they match the desktop and phone apps. Enter opens the chat.
- **Projects**: every project, most recently used first, with its chat count.

To rename a project, select it in **Projects** and press `ctrl+r`. The new name shows in every Paseo app. To go back to the folder's name, clear the field and press Enter. Renaming doesn't change the folder or its path.

To remove a project from Paseo, select it in **Projects** and press `ctrl+d` twice. Paseo archives the project's workspaces and drops the project from its list, in every Paseo app. The project's folder stays on disk, so its files are kept.

Pick a project to see:

- **← All projects**, which returns to the list. `esc` does the same; a second `esc` closes the picker.
- **New chat**, which starts a chat in the project's folder.
- **New chat in a git worktree**, for git projects, which asks for a branch name and base.
- **Chats**: every chat in the project, newest first. An archived chat is restored when you open it, and an empty workspace starts a new chat in its folder.

In a project's chats:

- `ctrl+f` pins or unpins a chat. Pinned chats show under **Pinned** in this picker and in the session switcher, and in the Paseo apps. Only live chats can be pinned.
- `ctrl+r` renames a chat. Every Paseo app shows the new name.
- `ctrl+d` pressed twice cleans up one step at a time. On a live chat, it archives the chat. On an archived chat, it deletes the chat for good and archives its workspace, so the row leaves the list. On a **no messages** row, a workspace without a chat, it removes the workspace from the list. Workspace folders stay on disk. Deleting can't be undone.

Archiving only hides a chat: it stays on the daemon and in this list, and opening it restores it.

To start a chat after picking, type your message. The home screen shows the project's folder.

When you archive the chat you're in, pasode sends you to the home screen, and the picker opens there, so another pinned chat or project is one key away. Esc closes it and leaves you on the home screen. This also works when you archive the chat you're in from the session switcher (`ctrl+x l`): the switcher closes, and the picker opens instead. Archiving another chat from the switcher keeps you in the switcher. The picker doesn't open when you go home without archiving. To turn this off, set `openAfterArchive` to `false`.

| Command | Key | Does |
| --- | --- | --- |
| `/projects` | `ctrl+x p` | Opens the picker. |
| `/new-project` | | Creates a project. |
| `/add-project` | | Adds an existing folder as a project. |
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
