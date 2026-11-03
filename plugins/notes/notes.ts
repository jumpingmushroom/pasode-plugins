// Note operations on the configured Trilium layout: projects note → project note → notes folder (or the project note itself).
import { htmlToText, matchProject, textToHtml, type Candidate, type DaemonProject, type NoteItem, type NotesOptions } from "./model"
import { labelsOf, quote, type Trilium } from "./trilium"

/** Trilium's "2026-11-03 08:11:05.372Z" as ISO. */
const iso = (utc: string) => {
  const value = utc.trim().replace(" ", "T")
  return /(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
}

export function createNotes(trilium: Trilium, options: NotesOptions) {
  let projectsRoot: Promise<string> | undefined

  function root() {
    if (!options.projects) return Promise.reject(new Error(`Set the notes plugin's "projects" option to a Trilium note ID or title path`))
    projectsRoot ??= trilium.resolve(options.projects)
    // A failed lookup (Trilium down, a typo fixed in Trilium) is retried next time.
    projectsRoot.catch(() => (projectsRoot = undefined))
    return projectsRoot
  }

  async function folder(projectNoteId: string) {
    if (options.folder === "") return projectNoteId
    const found = await trilium.children(projectNoteId, `note.title = ${quote(options.folder)}`)
    if (found[0]) return found[0].noteId
    return (await trilium.create(projectNoteId, options.folder, "")).noteId
  }

  return {
    async projectNote(project: DaemonProject): Promise<{ noteId: string } | { choices: Candidate[] }> {
      const children = await trilium.children(await root())
      return matchProject(project, children.map((n) => ({ noteId: n.noteId, title: n.title, labels: labelsOf(n) })), options.pathLabel)
    },
    async linkProject(project: DaemonProject, noteId: string) {
      await trilium.addLabel(noteId, options.pathLabel, project.root)
    },
    async createProject(project: DaemonProject) {
      return (await trilium.create(await root(), project.name, "", { [options.pathLabel]: project.root })).noteId
    },
    async list(projectNoteId: string): Promise<NoteItem[]> {
      const search = options.folder === "" ? `#${options.noteLabel} #!${options.doneLabel}` : `#!${options.doneLabel}`
      const found = await trilium.children(await folder(projectNoteId), search)
      return Promise.all(
        found.map(async (n) => ({ noteId: n.noteId, title: n.title, body: htmlToText(await trilium.content(n.noteId)), created: iso(n.utcDateCreated) })),
      )
    },
    async add(projectNoteId: string, note: { title: string; body: string }) {
      return (await trilium.create(await folder(projectNoteId), note.title, textToHtml(note.body), { [options.noteLabel]: "" })).noteId
    },
    async update(noteId: string, note: { title: string; body: string }) {
      await trilium.rename(noteId, note.title)
      await trilium.setContent(noteId, textToHtml(note.body))
    },
    async markDone(noteId: string) {
      await trilium.addLabel(noteId, options.doneLabel)
    },
    async remove(noteId: string) {
      await trilium.remove(noteId)
    },
  }
}

/** Starts the chat first and marks the note done only after that, so a failure never loses a note or starts two chats. */
export async function push(deps: { start(): Promise<string>; markDone(): Promise<void> }, note: NoteItem): Promise<{ chatId: string; warning?: string }> {
  if (note.body.trim() === "") throw new Error("This note has no prompt. Edit it first (ctrl+e).")
  const chatId = await deps.start()
  try {
    await deps.markDone()
    return { chatId }
  } catch (error) {
    return { chatId, warning: `Chat started, but marking the note done failed: ${error instanceof Error ? error.message : error}` }
  }
}
