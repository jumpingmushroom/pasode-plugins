# notes

Project notes for pasode, kept in [TriliumNext](https://github.com/TriliumNext/Trilium).

Each note is a small "fix this" or "build that" for one project: a title, plus the prompt you'll eventually give an agent. When you pick a note, the plugin starts a new chat in the project's folder with the note's prompt as the first message, then marks the note done. The notes live in Trilium, not in the project, so they never end up in git.

## Set up Trilium

1. In Trilium, choose or create a **projects note**: a note whose children are one note per project, such as `Work/Projects`. The plugin creates project notes there when it can't find one.
2. In Trilium, under **Options → ETAPI**, create an ETAPI token.
3. In the environment that runs pasode, set the ETAPI URL and the token:

   ```sh
   export TRILIUM_URL=https://notes.example.com/etapi
   export TRILIUM_TOKEN=<your ETAPI token>
   ```

4. In `cli.json`, add the plugin with the `projects` option:

   ```jsonc
   ["~/pasode-plugins/plugins/notes", { "projects": "Work/Projects" }]
   ```

The token never goes in `cli.json`. To read it from another variable, set `tokenEnv`.

## Use

| Command | Key | Does |
| --- | --- | --- |
| `/notes` | `ctrl+x a` | Lists the notes of the open chat's project. On the home screen, asks for the project first. |
| `/note` | `ctrl+x k` | Writes a new note for the open chat's project in `$EDITOR`. |

In the editor, the first line is the title and the rest is the prompt. To cancel, save an empty file.

In the notes list:

- **Enter** starts a new chat in the project with the note's prompt, sends it, names the chat after the note, and marks the note done. Done notes leave the list but stay in Trilium.
- **New note…** writes a note in your editor.
- `ctrl+e` edits the note in your editor. Saving an edit stores the note as plain paragraphs, so it drops formatting such as links and tables that you added in Trilium. If you change nothing, the note stays as it was.
- `ctrl+d` deletes the note. Press it twice.
- `ctrl+o` opens the note in Trilium's web app.
- `tab` switches to another project.

The chat uses the provider and model on pasode's home screen and pasode's `session.permissions` setting, the same as a chat you start yourself.

## How notes are stored

A chat's project maps to a Trilium project note as follows:

1. The plugin looks for a child of the projects note with a `paseoPath` label that equals the project's folder on the daemon.
2. If no child has the label, the plugin compares the project's name and folder name with the titles of children that have no `paseoPath` label yet, ignoring case, spaces, hyphens, and underscores. It uses a match only when exactly one child matches.
3. If nothing matches, the plugin asks you to pick a child or create a project note.
4. When you pick or create a note in step 3, the plugin saves your choice as the `paseoPath` label, so later lookups skip steps 2 and 3.

Notes go in a child of the project note named by `folder` (`Notes` by default). The plugin creates that child the first time you use a project. To keep notes directly under the project note, set `folder` to `""`. The plugin then lists only the notes it labeled `pasodeNote`, so other children, such as documentation, stay out of the list.

A note is a Trilium text note. Notes you write in Trilium's web editor work too: headings, lists, and code blocks become plain text in the prompt.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `projects` | None, required | Note ID or title path, such as `Work/Projects`, of the note whose children are your project notes. |
| `folder` | `"Notes"` | Child of each project note that holds its notes. `""` keeps notes directly under the project note. |
| `noteLabel` | `"pasodeNote"` | Label on the notes the plugin creates. With `folder: ""`, only notes with this label are listed. |
| `doneLabel` | `"done"` | Label for notes already sent to a chat. |
| `pathLabel` | `"paseoPath"` | Label that remembers which daemon folder a project note belongs to. |
| `createProjects` | `true` | Offers **Create project note** when no project note matches. |
| `url` | `$TRILIUM_URL` | ETAPI URL, such as `https://notes.example.com/etapi`. |
| `tokenEnv` | `"TRILIUM_TOKEN"` | Environment variable that holds the ETAPI token. |
| `keys` | `{ "list": "<leader>a", "add": "<leader>k" }` | Keys for the two commands. |

## Troubleshooting

- If the URL or token is missing, the commands show an error and do nothing else.
- If Trilium is unreachable or rejects the token, the commands show the error, and the rest of pasode keeps working.
- If the chat fails to start, the note stays open. If the chat starts but marking the note done fails, you get a warning, and the note stays in the list.
