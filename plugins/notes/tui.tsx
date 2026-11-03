// Project notes for pasode, kept in Trilium: small "fix this" or "build that" notes per project, each a title plus the
// prompt you'll eventually give an agent. Enter starts a new chat in the project with the note's prompt and marks the
// note done. Notes live in Trilium (not in the project), so they never end up in git.
//
// ctrl+x a (or /notes) lists the current chat's project's notes; on the home screen it asks for the project first.
// ctrl+x k (or /note) writes a new note in $EDITOR: the first line is the title, the rest is the prompt.
// In the list: enter starts the chat ("New note…" writes one); ctrl+e edit; ctrl+d delete (press twice); ctrl+o open in Trilium;
// tab another project.
//
// Options (cli.json: ["~/pasode-plugins/plugins/notes", { "projects": "Work/Projects" }]):
//   projects        Trilium note ID or title path whose children are your project notes (required).
//   folder          child of each project note that holds its notes (default "Notes"; "" = the project note itself).
//   noteLabel       label on notes this plugin creates; with folder "" only these are listed (default "pasodeNote").
//   doneLabel       label for notes already sent to a chat (default "done").
//   pathLabel       label that remembers which daemon folder a project note belongs to (default "paseoPath").
//   createProjects  offer "Create project note" when none matches (default true).
//   url             ETAPI URL (default $TRILIUM_URL), e.g. https://notes.example.com/etapi.
//   tokenEnv        environment variable holding the ETAPI token (default "TRILIUM_TOKEN").
//   keys            { "list": "<leader>a", "add": "<leader>k" }.
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSignal } from "solid-js"
import type { PasodePlugin } from "@pasode/host"
import { formatEditorText, noteRows, parseEditorText, readOptions, webUrl, type DaemonProject, type NoteItem } from "./model"
import { createNotes, push } from "./notes"
import { createTrilium } from "./trilium"

/** Paseo's bypass modes, as pasode's own new sessions use them unless session.permissions is "prompt". */
const BYPASS: Record<string, string> = { claude: "bypassPermissions", codex: "full-access" }

type Project = DaemonProject & { noteId: string }

export default {
  id: "notes",
  setup(ctx) {
    const options = readOptions(ctx.options, process.env)
    const { dialog } = ctx.ui
    const { DialogSelect } = ctx.ui.components
    const { daemon } = ctx.paseo
    const { showError, notify } = ctx.state
    const store = options.url && options.token ? createNotes(createTrilium({ url: options.url, token: options.token }), options) : undefined

    function ready() {
      if (store) return store
      notify("Set TRILIUM_URL and TRILIUM_TOKEN (or the notes plugin's url and tokenEnv options)", "error")
    }

    // ── Projects ──

    type DaemonEntry = { projectId: string; projectRootPath: string; projectDisplayName: string; projectCustomName?: string | null }
    const toProject = (p: DaemonEntry): DaemonProject => ({ root: p.projectRootPath, name: p.projectCustomName || p.projectDisplayName })

    async function daemonProjects() {
      return ((await daemon.listProjects()).projects ?? []) as DaemonEntry[]
    }

    /** The open chat's project, through its workspace, so worktree chats map to the project root. */
    async function currentProject(): Promise<DaemonProject | undefined> {
      const agent = ctx.paseo.current()
      if (!agent?.workspaceId) return undefined
      const [projects, workspaces] = await Promise.all([daemonProjects(), daemon.fetchWorkspaces({})])
      const workspace = ((workspaces.entries ?? []) as { id: string; projectId: string }[]).find((w) => w.id === agent.workspaceId)
      const project = workspace && projects.find((p) => p.projectId === workspace.projectId)
      return project ? toProject(project) : undefined
    }

    async function pickDaemonProject(): Promise<DaemonProject | undefined> {
      const projects = (await daemonProjects()).map(toProject).toSorted((a, b) => a.name.localeCompare(b.name))
      return dialog.select<DaemonProject>({
        title: "Notes · pick a project",
        placeholder: "Search projects",
        size: "large",
        options: projects.map((p) => ({ title: p.name, footer: p.root, value: p })),
      })
    }

    /** The project's Trilium note: matched, or picked (and remembered) when the match isn't certain. */
    async function withNote(project: DaemonProject): Promise<Project | undefined> {
      const notes = ready()!
      const found = await notes.projectNote(project)
      if ("noteId" in found) return { ...project, noteId: found.noteId }
      const create = { noteId: "" }
      const picked = await dialog.select<{ noteId: string }>({
        title: `Trilium note for ${project.name}`,
        placeholder: "Search notes",
        size: "large",
        options: [
          ...(options.createProjects ? [{ title: `Create project note "${project.name}"`, category: "New", value: create }] : []),
          ...found.choices.map((c) => ({ title: c.title, category: "Existing", value: { noteId: c.noteId } })),
        ],
      })
      if (!picked) return undefined
      if (picked === create) return { ...project, noteId: await notes.createProject(project) }
      await notes.linkProject(project, picked.noteId)
      return { ...project, noteId: picked.noteId }
    }

    async function resolveProject(pick: boolean): Promise<Project | undefined> {
      const project = (!pick && (await currentProject().catch(() => undefined))) || (await pickDaemonProject())
      return project && withNote(project)
    }

    // ── Editor ──

    /** Opens `text` in $VISUAL/$EDITOR like pasode's ctrl+x e. Returns the result and the file (kept until `done`). */
    async function editInEditor(text: string) {
      const directory = await mkdtemp(path.join(os.tmpdir(), "pasode-note-"))
      const file = path.join(directory, "note.md")
      await writeFile(file, text, { mode: 0o600 })
      const renderer = ctx.renderer
      renderer.suspend()
      renderer.currentRenderBuffer.clear()
      try {
        await new Promise<void>((resolve, reject) => {
          // The shell handles quoted editor paths and flags; the file is passed as $1, not interpolated.
          const child = spawn(process.env.SHELL || "/bin/sh", ["-c", `${process.env.VISUAL || process.env.EDITOR || "vi"} "$1"`, "pasode-note", file], { stdio: "inherit" })
          child.on("error", reject)
          child.on("exit", (code, signal) => (code === 0 ? resolve() : reject(new Error(`Editor exited with ${signal || code}`))))
        })
        return { text: await readFile(file, "utf8"), file, done: () => rm(directory, { recursive: true, force: true }) }
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : error}; draft kept at ${file}`)
      } finally {
        renderer.currentRenderBuffer.clear()
        renderer.resume()
        renderer.requestRender()
      }
    }

    /** Edits in $EDITOR and saves; on failure the draft file stays and the error says where. */
    async function write(start: string, save: (note: { title: string; body: string }) => Promise<unknown>, verb: string) {
      const draft = await editInEditor(start)
      const note = parseEditorText(draft.text)
      if (!note) {
        await draft.done()
        return notify("Empty note, nothing saved", "warning")
      }
      try {
        await save(note)
        await draft.done()
        notify(`${verb} "${note.title}"`, "success")
      } catch (error) {
        showError(`${error instanceof Error ? error.message : error} Your draft is at ${draft.file}`)
      }
    }

    const addNote = (project: Project) => write("", (note) => ready()!.add(project.noteId, note), "Saved")
    const editNote = (note: NoteItem) => write(formatEditorText(note), (next) => ready()!.update(note.noteId, next), "Saved")

    // ── Chat ──

    async function startChat(project: Project, note: NoteItem) {
      const provider = ctx.state.draft().provider
      let model = ctx.state.draft().model
      if (!model) {
        const models = (await ctx.paseo.api.providers.listModels(provider)).models ?? []
        model = (models.find((m) => m.isDefault) ?? models[0])?.id
      }
      if (!model) throw new Error(`No ${provider} models available on the daemon`)
      const mode = ctx.state.prefs.permissions !== "prompt" && BYPASS[provider] ? { modeId: BYPASS[provider] } : {}
      const handle = await ctx.paseo.api.agents.create({
        config: { provider: `${provider}/${model}`, ...mode },
        cwd: project.root,
        prompt: note.body,
        title: note.title,
        clientMessageId: crypto.randomUUID(),
      })
      await nameChat(handle.id, note.title)
      return handle.id
    }

    /**
     * Paseo names a chat after its first message, so the create call's title doesn't stick. This renames it the way
     * pasode's ctrl+r does: the agent, plus its workspace when the chat is alone there (a shared one keeps its name).
     * A failure here only costs the title, so it's a warning.
     */
    async function nameChat(id: string, title: string) {
      try {
        let agent = ctx.paseo.agents[id]
        for (let i = 0; !agent && i < 50; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          agent = ctx.paseo.agents[id]
        }
        await daemon.updateAgent(id, { name: title })
        const workspace = agent && ctx.paseo.ownWorkspace(agent)
        if (workspace) await daemon.setWorkspaceTitle(workspace, title)
      } catch (error) {
        notify(`Chat started, but naming it failed: ${error instanceof Error ? error.message : error}`, "warning")
      }
    }

    async function send(project: Project, note: NoteItem) {
      const notes = ready()!
      try {
        const result = await push({ start: () => startChat(project, note), markDone: () => notes.markDone(note.noteId) }, note)
        ctx.state.navigate(result.chatId)
        if (result.warning) notify(result.warning, "warning")
        else notify(`Started "${note.title}"`, "success")
      } catch (error) {
        showError(error)
        void openList(project)
      }
    }

    function openInTrilium(noteId: string) {
      const opener = process.platform === "darwin" ? "open" : "xdg-open"
      const child = spawn(opener, [webUrl(options.url!, noteId)], { detached: true, stdio: "ignore" })
      child.on("error", (error) => showError(error))
      child.unref()
    }

    // ── List ──

    /** The "New note…" row's value; pasode's lists take ctrl+n for moving down, so adding is a row, as in the other pickers. */
    const NEW = "\u0000new"

    function List(props: { project: Project; notes: NoteItem[] }) {
      const [confirm, setConfirm] = createSignal<string>()
      const byId = new Map(props.notes.map((n) => [n.noteId, n]))
      const reopen = () => void openList(props.project)
      const run = (work: () => Promise<unknown>) => {
        dialog.clear()
        void work()
          .catch(showError)
          .finally(reopen)
      }
      return (
        <DialogSelect<string>
          title={`Notes · ${props.project.name}`}
          placeholder="Search notes"
          options={[
            { title: "New note…", description: "write it in your editor", category: "Add", value: NEW },
            ...noteRows(props.notes).map((row) => ({
            // The title stays as is while a delete is armed, so a search filter keeps matching the row.
            title: row.title,
            bg: confirm() === row.noteId ? ctx.theme.error : undefined,
            description: row.description || undefined,
            footer: confirm() === row.noteId ? "ctrl+d again to delete" : row.footer,
            category: "Notes",
            value: row.noteId,
          })),
          ]}
          onMove={() => setConfirm(undefined)}
          onSelect={(option) => {
            if (option.value === NEW) return run(() => addNote(props.project))
            dialog.clear()
            void send(props.project, byId.get(option.value)!)
          }}
          actions={[
            { label: "ctrl+e", title: "edit", match: (key) => key.ctrl && key.name === "e", run: (option) => option.value !== NEW && run(() => editNote(byId.get(option.value)!)) },
            {
              label: "ctrl+d",
              title: "delete",
              match: (key) => key.ctrl && key.name === "d",
              run: (option) => {
                if (option.value === NEW) return
                if (confirm() !== option.value) return setConfirm(option.value)
                run(async () => {
                  await ready()!.remove(option.value)
                  notify(`Deleted "${byId.get(option.value)!.title}"`, "success")
                })
              },
            },
            { label: "ctrl+o", title: "Trilium", match: (key) => key.ctrl && key.name === "o", run: (option) => option.value !== NEW && openInTrilium(option.value) },
            {
              label: "tab",
              title: "project",
              global: true,
              match: (key) => key.name === "tab",
              run: () => {
                dialog.clear()
                void resolveProject(true)
                  .then((project) => project && openList(project))
                  .catch(showError)
              },
            },
          ]}
        />
      )
    }

    async function openList(project: Project) {
      const notes = await ready()!.list(project.noteId)
      dialog.replace(() => <List project={project} notes={notes} />, "large")
    }

    async function listCommand() {
      if (!ready()) return
      try {
        const project = await resolveProject(false)
        if (project) await openList(project)
      } catch (error) {
        showError(error)
      }
    }

    async function addCommand() {
      if (!ready()) return
      try {
        const project = await resolveProject(false)
        if (project) await addNote(project)
      } catch (error) {
        showError(error)
      }
    }

    ctx.commands.register([
      { id: "notes.list", title: "Project notes", category: "Notes", keybind: options.keys.list, slash: "notes", run: () => void listCommand() },
      { id: "notes.add", title: "New project note", category: "Notes", keybind: options.keys.add, slash: "note", run: () => void addCommand() },
    ])
  },
} satisfies PasodePlugin
