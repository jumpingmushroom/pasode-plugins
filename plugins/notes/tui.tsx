// Project notes for pasode, kept in Trilium: small "fix this" or "build that" notes per project, each a title plus the
// prompt you'll eventually give an agent. Enter starts a new chat in the project with the note's prompt and marks the
// note done. Notes live in Trilium (not in the project), so they never end up in git.
//
// ctrl+x a (or /notes) lists the current chat's project's notes; on the home screen it asks for the project first.
// ctrl+x k (or /note) writes a new note in $EDITOR from a template: the title after "title:", the prompt below "---".
// In the list: enter starts the chat ("New note…" writes one); ctrl+e edit; ctrl+d delete (press twice); ctrl+o open in Trilium;
// tab another project. The sidebar lists the open chat's project's notes; click one to open it in the list.
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
//   sidebar         false hides the Notes section in pasode's sidebar (default true).
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { PasodePlugin } from "@pasode/host"
import { formatEditorText, noteRows, parseEditorText, readOptions, sameNote, sidebarRows, webUrl, type DaemonProject, type NoteItem } from "./model"
import { createNotes, push } from "./notes"
import { createTrilium } from "./trilium"

/** Paseo's bypass modes, as pasode's own new sessions use them unless session.permissions is "prompt". */
const BYPASS: Record<string, string> = { claude: "bypassPermissions", codex: "full-access" }

type Project = DaemonProject & { noteId: string }
type ChatAgent = { id: string; workspaceId?: string | null }
type SidebarState = { kind: "none" } | { kind: "unlinked" } | { kind: "error" } | { kind: "ok"; project: Project; notes: NoteItem[] }

/** Notes shown in the sidebar before "+N more". */
const SIDEBAR_MAX = 8
const SIDEBAR_REFRESH_MS = 60_000

export default {
  id: "notes",
  setup(ctx) {
    const options = readOptions(ctx.options, process.env)
    const { dialog } = ctx.ui
    const { DialogSelect } = ctx.ui.components
    const { daemon } = ctx.paseo
    const { showError, notify } = ctx.state
    const store = options.url && options.token ? createNotes(createTrilium({ url: options.url, token: options.token }), options) : undefined

    // Bumped after every change the plugin makes (and on a timer), so the sidebar reloads.
    const [version, setVersion] = createSignal(0)
    const changed = () => setVersion((v) => v + 1)
    // Project notes already matched, by daemon folder, so the sidebar's refreshes don't search Trilium each time.
    const linked = new Map<string, string>()

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

    /** A chat's project, through its workspace, so worktree chats map to the project root. */
    async function projectOf(agent: ChatAgent | undefined): Promise<DaemonProject | undefined> {
      if (!agent?.workspaceId) return undefined
      const [projects, workspaces] = await Promise.all([daemonProjects(), daemon.fetchWorkspaces({})])
      const workspace = ((workspaces.entries ?? []) as { id: string; projectId: string }[]).find((w) => w.id === agent.workspaceId)
      const project = workspace && projects.find((p) => p.projectId === workspace.projectId)
      return project ? toProject(project) : undefined
    }

    const currentProject = () => projectOf(ctx.paseo.current())

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
      if ("noteId" in found) return linked.set(project.root, found.noteId), { ...project, noteId: found.noteId }
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
      const noteId = picked === create ? await notes.createProject(project) : (await notes.linkProject(project, picked.noteId), picked.noteId)
      linked.set(project.root, noteId)
      changed()
      return { ...project, noteId }
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
    async function write(start: string, save: (note: { title: string; body: string }) => Promise<unknown>, verb: string, original?: { title: string; body: string }) {
      const draft = await editInEditor(start)
      const note = parseEditorText(draft.text)
      if (!note) {
        await draft.done()
        return notify("Empty note, nothing saved", "warning")
      }
      // Saving rewrites the note as plain paragraphs, so an untouched note keeps the formatting it has in Trilium.
      if (original && sameNote(note, original)) {
        await draft.done()
        return notify("No changes", "info")
      }
      try {
        await save(note)
        changed()
        await draft.done()
        notify(`${verb} "${note.title}"`, "success")
      } catch (error) {
        showError(`${error instanceof Error ? error.message : error} Your draft is at ${draft.file}`)
      }
    }

    const addNote = (project: Project) => write(formatEditorText({ title: "", body: "" }), (note) => ready()!.add(project.noteId, note), "Saved")
    const editNote = (note: NoteItem) => write(formatEditorText(note), (next) => ready()!.update(note.noteId, next), "Saved", note)

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
        changed()
        ctx.state.navigate(result.chatId)
        if (result.warning) notify(result.warning, "warning")
        else notify(`Started "${note.title}"`, "success")
      } catch (error) {
        showError(error)
        void openList(project).catch(showError)
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

    function List(props: { project: Project; notes: NoteItem[]; current?: string }) {
      const [confirm, setConfirm] = createSignal<string>()
      const byId = new Map(props.notes.map((n) => [n.noteId, n]))
      const reopen = () => void openList(props.project).catch(showError)
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
          current={props.current}
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
                  changed()
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

    async function openList(project: Project, current?: string) {
      const notes = await ready()!.list(project.noteId)
      dialog.replace(() => <List project={project} notes={notes} current={current} />, "large")
    }

    // ── Sidebar ──

    /** Read-only: never prompts and never creates anything, so an unlinked project only gets a hint. */
    async function sidebarState(agent: ChatAgent): Promise<SidebarState> {
      const project = await projectOf(agent)
      if (!project) return { kind: "none" }
      let noteId = linked.get(project.root)
      if (!noteId) {
        const found = await store!.projectNote(project)
        if (!("noteId" in found)) return { kind: "unlinked" }
        noteId = found.noteId
        linked.set(project.root, noteId)
      }
      return { kind: "ok", project: { ...project, noteId }, notes: await store!.peek(noteId) }
    }

    // Clicks act on mouse-up: a dialog opened on mouse-down would close at once, since its backdrop closes on mouse-up.
    function SidebarNotes(props: { agent?: ChatAgent }) {
      const [state, setState] = createSignal<SidebarState>({ kind: "none" })
      let shownFor: string | undefined
      createEffect(
        on([() => props.agent?.id, () => props.agent?.workspaceId, version], () => {
          const agent = props.agent
          // A different chat clears the section; a refresh of the same chat keeps it until the new list arrives.
          if (agent?.id !== shownFor) setState({ kind: "none" })
          shownFor = agent?.id
          if (!agent) return
          let stale = false
          onCleanup(() => (stale = true))
          sidebarState(agent).then(
            (next) => !stale && setState(next),
            () => !stale && setState({ kind: "error" }),
          )
        }),
      )
      const width = () => Math.max(8, ctx.state.prefs.sidebarWidth - 5)
      const open = (project: Project, current?: string) => void openList(project, current).catch(showError)
      return (
        <Show when={state().kind !== "none"}>
          <box>
            <box flexDirection="row" justifyContent="space-between" onMouseUp={() => void listCommand()}>
              <text fg={ctx.theme.text}>
                <b>Notes</b>
              </text>
              <Show when={state().kind === "ok" && (state() as { notes: NoteItem[] }).notes.length}>{(count) => <text fg={ctx.theme.textMuted}>{count()}</text>}</Show>
            </box>
            <Show when={state().kind === "unlinked"}>
              <text fg={ctx.theme.textMuted}>click to set up</text>
            </Show>
            <Show when={state().kind === "error"}>
              <text fg={ctx.theme.textMuted}>Trilium unavailable</text>
            </Show>
            <Show when={state().kind === "ok" ? (state() as Extract<SidebarState, { kind: "ok" }>) : undefined}>
              {(ok) => {
                const view = () => sidebarRows(ok().notes, SIDEBAR_MAX)
                return (
                  <>
                    <For each={view().rows}>
                      {(row) => (
                        <box onMouseUp={() => open(ok().project, row.noteId)}>
                          <text fg={ctx.theme.textMuted} wrapMode="none">
                            {ctx.ui.components.truncate(row.title, width())}
                          </text>
                        </box>
                      )}
                    </For>
                    <Show when={view().more}>
                      <box onMouseUp={() => open(ok().project)}>
                        <text fg={ctx.theme.textMuted}>+{view().more} more</text>
                      </box>
                    </Show>
                    <box onMouseUp={() => void addNote(ok().project).catch(showError)}>
                      <text fg={ctx.theme.textMuted}>+ new note</text>
                    </box>
                  </>
                )
              }}
            </Show>
          </box>
        </Show>
      )
    }

    if (store && options.sidebar) {
      const timer = setInterval(changed, SIDEBAR_REFRESH_MS)
      onCleanup(() => clearInterval(timer))
      // After pasode's own sections (metrics, the last of them, is order 700).
      onCleanup(ctx.ui.slot("sidebar_content", (props) => <SidebarNotes agent={props.agent} />, 800))
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
