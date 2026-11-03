// Projects picker for pasode, like the Paseo desktop sidebar's per-project "+":
// ctrl+x p (or /projects) lists pinned chats (Paseo's workspace pins) and the daemon's projects; pick one to open one of its chats, start a new one, start one in a new git worktree,
// or create a new project / add an existing folder / clone one from GitHub. on a project, ctrl+r renames it and ctrl+d twice removes it from Paseo (its folder stays); in a project's chats, ctrl+f pins, ctrl+r renames, and ctrl+d twice archives a chat, then deletes it for good. Paths are the daemon's (e.g. /srv/projects/<name>),
// so this works with a remote daemon whose folders don't exist on this machine.
//
// Options (cli.json: ["~/pasode-plugins/plugins/projects", { "root": "/srv/projects" }]):
//   root      where new projects and clones go; default = the folder most existing projects sit in.
//   autoOpen  false stops the picker opening on launch outside a known project (default true).
//   cloneProtocol  "https" (default) or "ssh" for owner/repo clones; a pasted URL keeps its own protocol.
//   openAfterArchive  false stops the picker opening when archiving the open chat sends you home (default true).
import { createEffect, createSignal, on, type JSX } from "solid-js"
import type { KeyEvent } from "@opentui/core"
import type { PasodePlugin } from "@pasode/host"
import { ago, chatKeys, pickerKeys, pinTitle, addableFolders, canPin, cleanup, folderPath, projectName, removedProjectMessage, renameTo, leftByArchive, chatFooter, clonePath, cloneProtocol, pinnedRows, inferRoot, insideProject, parseRepo, projectChats, projectRows, shortPath, validProjectName, type Chat, type ChatAgent, type Cleanup, type ChatWorkspace, type Project, type ProjectRow } from "./model"

type Pick =
  | { kind: "project"; row: ProjectRow }
  | { kind: "new" }
  | { kind: "existing" }
  | { kind: "clone" }
  | { kind: "pinned"; id: string }
  | { kind: "remove"; row: ProjectRow }
  | { kind: "rename"; row: ProjectRow }
  | { kind: "unpin"; id: string }

type Choice = "chat" | "worktree" | "back" | { open: string; archived: boolean } | { startIn: string } | { act: ChatAct; chat: Chat }

type ChatAct = "pin" | "rename" | "cleanup"

type Data = {
  rows: ProjectRow[]
  workspaces: ChatWorkspace[]
  root?: string
  /** Every top-level session, archived ones included: the live list leaves those out. Loaded in the background. */
  history: Promise<ChatAgent[]>
}

/** Pages of 200 (the daemon's maximum); a few pages cover hundreds of sessions in well under a second. */
const HISTORY_PAGES = 10

export default {
  id: "projects",
  setup(ctx) {
    const { daemon } = ctx.paseo
    const { draft, setDraft, navigate, notify, showError } = ctx.state
    const { dialog } = ctx.ui

    function startIn(root: string, label: string) {
      // A /fork or /worktree draft would override cwd; a project pick starts a plain chat.
      setDraft({ ...draft(), cwd: root, worktree: undefined, fork: undefined })
      navigate(undefined)
      notify(`Next chat starts in ${label}`, "success")
    }

    async function loadHistory(): Promise<ChatAgent[]> {
      const all: ChatAgent[] = []
      let cursor: string | undefined
      for (let page = 0; page < HISTORY_PAGES; page++) {
        const result: any = await ctx.paseo.api.agents.list({
          filter: { includeArchived: true, includeBackground: true },
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
        })
        for (const { agent } of result.entries ?? []) if (agent.workspaceId && !agent.parentAgentId) all.push(agent)
        cursor = result.pageInfo?.hasMore ? result.pageInfo.nextCursor ?? undefined : undefined
        if (!cursor) break
      }
      return all
    }

    async function load(): Promise<Data> {
      const history = loadHistory()
      history.catch(() => {}) // reported when a project menu awaits it
      const [projects, workspaces] = await Promise.all([daemon.listProjects(), daemon.fetchWorkspaces({})])
      const list = (projects.projects ?? []) as Project[]
      const root = typeof ctx.options.root === "string" ? ctx.options.root.replace(/\/+$/, "") : inferRoot(list)
      const entries = (workspaces.entries ?? []) as ChatWorkspace[]
      return { rows: projectRows(list, entries), workspaces: entries, root, history }
    }

    /** Pinned chats, by the session switcher's rules: live sessions alone in a pinned workspace (Paseo's own pins). */
    function pinned() {
      const { agents, workspacePins, ownWorkspace, sessionTitle, active, waiting } = ctx.paseo
      return pinnedRows(
        Object.values(agents)
          .filter((agent) => !agent.archivedAt && agent.workspaceId && workspacePins[agent.workspaceId] && ownWorkspace(agent))
          .map((agent) => ({
            id: agent.id,
            title: sessionTitle(agent) || "",
            cwd: agent.cwd,
            updatedAt: agent.updatedAt,
            running: active(agent),
            waiting: waiting(agent),
            needsInput: !!agent.pendingPermissions?.length,
          })),
      )
    }

    /** Shows a dialog whose content calls `done` with the choice; esc resolves undefined. Like dialog.select, with actions. */
    function choose<T>(render: (done: (value?: T) => void) => JSX.Element) {
      return new Promise<T | undefined>((resolve) => {
        let finished = false
        const finish = (value?: T) => {
          if (finished) return
          finished = true
          resolve(value)
          dialog.clear()
        }
        dialog.replace(() => render(finish), "large", () => finish(undefined))
      })
    }

    async function openProjects(data?: Data, from?: ProjectRow) {
      data ??= await load().catch((error) => void showError(error))
      if (!data) return
      const { rows, root } = data
      const picked = await choose<Pick>((done) => <ProjectList rows={rows} root={root} from={from} onDone={done} />)
      if (!picked) return
      if (picked.kind === "new") return void newProject(root)
      if (picked.kind === "clone") return void cloneProject(root)
      if (picked.kind === "existing") return void addExisting(data)
      if (picked.kind === "pinned") return ctx.paseo.navigate(picked.id)
      if (picked.kind === "remove") return void removeProject(picked.row)
      if (picked.kind === "rename") return void renameProject(picked.row)
      if (picked.kind === "unpin") return void unpinFromList(picked.id, data)
      return void projectMenu(picked.row, data)
    }

    /** The picker's main list; on a project, ctrl+r renames it and ctrl+d twice removes it from Paseo (its folder stays). */
    function ProjectList(props: { rows: ProjectRow[]; root?: string; from?: ProjectRow; onDone: (pick?: Pick) => void }) {
      const [armed, setArmed] = createSignal<string>()
      // DialogSelect matches `current` by identity, so the rows' option values are built once per load.
      const picks = new Map(props.rows.map((row) => [row.id, { kind: "project", row } as Pick]))
      const root = props.root
      const [focused, setFocused] = createSignal<Pick | undefined>(props.from ? picks.get(props.from.id) : undefined)
      const keys = () => pickerKeys(focused()?.kind)
      return (
        <ctx.ui.components.DialogSelect<Pick>
          title="Projects"
          placeholder="Search pinned chats and projects"
          current={props.from ? picks.get(props.from.id) : undefined}
          options={[
            { title: "New project…", description: root ? `empty folder in ${root}` : "empty folder", category: "Add", value: { kind: "new" } },
            { title: "Add existing folder…", description: root ? `a folder already in ${root}` : "a folder on the daemon", category: "Add", value: { kind: "existing" } },
            { title: "Clone from GitHub…", description: root ? `into ${root}` : undefined, category: "Add", value: { kind: "clone" } },
            ...pinned().map((chat) => ({ title: chat.title, footer: chat.footer, category: "Pinned", value: { kind: "pinned", id: chat.id } as Pick })),
            ...props.rows.map((row) => ({
              title: row.name,
              bg: armed() === row.id ? ctx.theme.error : undefined,
              // Only show the folder when it says something the name doesn't.
              description: shortPath(row.root, root) === row.name ? undefined : shortPath(row.root, root),
              footer: armed() === row.id ? "ctrl+d again to remove · folder stays" : `${row.chats ? `${row.chats} chat${row.chats === 1 ? "" : "s"} · ` : ""}${ago(row.lastActive)}`,
              category: "Projects",
              value: picks.get(row.id)!,
            })),
          ]}
          onMove={(option) => (setArmed(undefined), setFocused(option.value))}
          onSelect={(option) => props.onDone(option.value)}
          actions={[
            ...(keys().includes("unpin")
              ? [{
                  label: "ctrl+f",
                  title: "unpin",
                  match: (key: KeyEvent) => key.ctrl && key.name === "f",
                  run: (option: { value: Pick }) => option.value.kind === "pinned" && props.onDone({ kind: "unpin", id: option.value.id }),
                }]
              : []),
            ...(keys().includes("rename")
              ? [{
                  label: "ctrl+r",
                  title: "rename",
                  match: (key: KeyEvent) => key.ctrl && key.name === "r",
                  run: (option: { value: Pick }) => option.value.kind === "project" && props.onDone({ kind: "rename", row: option.value.row }),
                }]
              : []),
            ...(keys().includes("remove") ? [{
              label: "ctrl+d",
              title: "remove project",
              match: (key: KeyEvent) => key.ctrl && key.name === "d",
              run: (option: { value: Pick }) => {
                if (option.value.kind !== "project") return
                const { row } = option.value
                if (armed() !== row.id) return setArmed(row.id)
                props.onDone({ kind: "remove", row })
              },
            }] : []),
          ]}
        />
      )
    }

    /** Unpins a chat from the picker's Pinned section, then shows the list again. */
    async function unpinFromList(id: string, data: Data) {
      const workspace = ctx.paseo.agents[id]?.workspaceId
      if (workspace) {
        try {
          await daemon.setWorkspacePinned(workspace, false)
          ctx.paseo.setWorkspacePins(workspace, null)
          notify("Unpinned", "success")
        } catch (error) {
          showError(error)
        }
      }
      void openProjects(data)
    }

    /** Renames a project in Paseo (every Paseo app shows the name); an empty name resets it to the folder name. */
    async function renameProject(row: ProjectRow) {
      const input = await dialog.prompt({ title: `Rename ${row.name}`, description: `Leave empty to use the folder name, ${row.folderName}`, value: row.name })
      const name = renameTo(input, row.folderName)
      if (name !== undefined) {
        try {
          await daemon.renameProject(row.id, name)
          notify(name ? `Renamed to "${name}"` : `Name reset to "${row.folderName}"`, "success")
        } catch (error) {
          showError(error)
        }
      }
      const data = await load().catch((error) => void showError(error))
      if (data) void openProjects(data, row)
    }

    /** Removes a project from Paseo: the daemon archives its workspaces and keeps the folder. Then shows the list again. */
    async function removeProject(row: ProjectRow) {
      try {
        const result = await daemon.removeProject(row.id)
        notify(removedProjectMessage(row.name, result.removedWorkspaceIds?.length ?? 0), "success")
      } catch (error) {
        showError(error)
      }
      void openProjects()
    }

    async function projectMenu(row: ProjectRow, data: Data, focus?: string) {
      const history = await data.history.catch((error) => {
        showError(`Archived chats not loaded: ${error instanceof Error ? error.message : error}`)
        return [] as ChatAgent[]
      })
      // Live sessions first: they carry current status; history adds the archived ones the live list leaves out.
      const chats = projectChats(row.id, data.workspaces, [...Object.values(ctx.paseo.agents), ...history], row.root)
      const choice = await choose<Choice>((done) => <ChatMenu row={row} chats={chats} focus={focus} onDone={done} />)
      if (typeof choice === "object" && "act" in choice) return void chatAction(choice.act, choice.chat, row, data)
      // Esc in a project returns to the list (with this project highlighted); esc there closes.
      if (!choice || choice === "back") return void openProjects(data, row)
      if (typeof choice === "object" && "open" in choice) return void openChat(choice.open, choice.archived, history)
      if (typeof choice === "object") return startIn(choice.startIn, row.name)
      if (choice === "chat") startIn(row.root, row.name)
      if (choice === "worktree") {
        // The built-in /worktree flow reads draft().cwd for the repository and its base branches.
        setDraft({ ...draft(), cwd: row.root, worktree: undefined, fork: undefined })
        ctx.commands.run("session.new.worktree")
      }
    }

    const ARMED: Record<Cleanup["kind"], string> = { archive: "ctrl+d again to archive", delete: "ctrl+d again to delete for good", remove: "ctrl+d again to remove" }

    /** A project's chats: ctrl+f pins, ctrl+r renames, ctrl+d twice archives a live chat, then deletes it (see cleanup()). */
    function ChatMenu(props: { row: ProjectRow; chats: Chat[]; focus?: string; onDone: (choice?: Choice) => void }) {
      const [armed, setArmed] = createSignal<string>()
      // DialogSelect matches `current` by identity, so each chat's value is built once.
      const values = new Map(
        props.chats.map((chat) => [chat, (chat.directory !== undefined ? { startIn: chat.directory } : { open: chat.agentId, archived: chat.state === "archived" }) as Choice]),
      )
      const chatOf = new Map(props.chats.map((chat) => [values.get(chat)!, chat]))
      const focused = props.chats.find((chat) => chat.workspaceId === props.focus)
      const [selected, setSelected] = createSignal<Chat | undefined>(focused)
      const pinnedChat = (chat?: Chat) => !!chat && canPin(chat) && !!ctx.paseo.workspacePins[chat.workspaceId]
      const keys = () => chatKeys(selected())
      const act = (name: ChatAct) => (option: { value: Choice }) => {
        const chat = chatOf.get(option.value)
        if (chat && chatKeys(chat).includes(name === "pin" ? "pin" : "rename")) props.onDone({ act: name, chat })
      }
      return (
        <ctx.ui.components.DialogSelect<Choice>
          title={props.row.name}
          placeholder="Search chats · esc goes back"
          current={focused && values.get(focused)}
          options={[
            { title: "← All projects", value: "back" as const },
            { title: "New chat", category: "New", value: "chat" as const },
            ...(props.row.git ? [{ title: "New chat in a git worktree", description: "branch + base", category: "New", value: "worktree" as const }] : []),
            ...props.chats.map((chat) => {
              const on = armed() === chat.workspaceId
              const pinned = pinnedChat(chat)
              return {
                title: chat.title,
                bg: on ? ctx.theme.error : undefined,
                footer: on ? ARMED[cleanup(chat).kind] : `${pinned ? "pinned · " : ""}${chatFooter(chat)}`,
                category: "Chats",
                value: values.get(chat)!,
              }
            }),
          ]}
          onMove={(option) => (setArmed(undefined), setSelected(chatOf.get(option.value)))}
          onSelect={(option) => props.onDone(option.value)}
          actions={[
            ...(keys().includes("pin")
              ? [{ label: "ctrl+f", title: pinTitle(pinnedChat(selected())), match: (key: KeyEvent) => key.ctrl && key.name === "f", run: act("pin") }]
              : []),
            ...(keys().includes("rename") ? [{ label: "ctrl+r", title: "rename", match: (key: KeyEvent) => key.ctrl && key.name === "r", run: act("rename") }] : []),
            ...(selected()
              ? [{
                  label: "ctrl+d",
                  title: cleanup(selected()!).kind,
                  match: (key: KeyEvent) => key.ctrl && key.name === "d",
                  run: (option: { value: Choice }) => {
                    const chat = chatOf.get(option.value)
                    if (!chat) return
                    if (armed() !== chat.workspaceId) return setArmed(chat.workspaceId)
                    props.onDone({ act: "cleanup", chat })
                  },
                }]
              : []),
          ]}
        />
      )
    }

    /** Runs a chat-list action on the daemon, then shows the project's chats again with the same chat selected. */
    async function chatAction(act: ChatAct, chat: Chat, row: ProjectRow, data: Data) {
      try {
        if (act === "pin") await pinChat(chat)
        if (act === "rename") await renameChat(chat)
        if (act === "cleanup") await cleanChat(chat)
      } catch (error) {
        showError(error)
      }
      const fresh = await load().catch((error) => void showError(error))
      if (fresh) void projectMenu(fresh.rows.find((r) => r.id === row.id) ?? row, fresh, chat.workspaceId)
      else void projectMenu(row, data, chat.workspaceId)
    }

    async function pinChat(chat: Chat) {
      if (!canPin(chat)) return notify("Only live chats can be pinned", "warning")
      const pinned = !ctx.paseo.workspacePins[chat.workspaceId]
      const { pinnedAt } = await daemon.setWorkspacePinned(chat.workspaceId, pinned)
      ctx.paseo.setWorkspacePins(chat.workspaceId, pinnedAt)
      notify(pinned ? "Pinned" : "Unpinned", "success")
    }

    /** Renames the chat's workspace (what Paseo's apps list) and, for a live chat, its session (what pasode's switcher lists). */
    async function renameChat(chat: Chat) {
      const input = await dialog.prompt({ title: "Rename chat", value: chat.title })
      const name = input?.trim()
      if (!name || name === chat.title) return
      const live = chat.agentId && chat.state !== "archived" ? chat.agentId : undefined
      await Promise.all([daemon.setWorkspaceTitle(chat.workspaceId, name), live && daemon.updateAgent(live, { name })])
      notify(`Renamed to "${name}"`, "success")
    }

    /** One ctrl+d step: archive a live chat; delete an archived one and archive its workspace; remove an empty workspace. */
    async function cleanChat(chat: Chat) {
      const step = cleanup(chat)
      if (step.kind === "archive") {
        // Archiving the chat you're in: go home without the after-archive picker; this list reopens instead.
        if (ctx.paseo.agentId() === step.agentId) {
          quiet = step.agentId
          navigate(undefined)
        }
        await daemon.archiveAgent(step.agentId)
        return notify("Chat archived. ctrl+d twice again deletes it for good.", "success")
      }
      if (step.kind === "delete") await daemon.deleteAgent(step.agentId)
      const archived = await daemon.archiveWorkspace(step.workspaceId)
      if (archived.error) throw new Error(`${step.kind === "delete" ? "Chat deleted, but its workspace stays: " : ""}${archived.error}`)
      notify(step.kind === "delete" ? "Chat deleted" : "Empty workspace removed", "success")
    }

    /** Set while this plugin archives the open chat itself, so the after-archive picker stays out of the way. */
    let quiet: string | undefined

    /** Opens a chat; an archived one is restored first, like pasode's session history (Paseo's own "Unarchive"). */
    async function openChat(id: string, archived: boolean, history: ChatAgent[]) {
      if (archived) {
        try {
          await daemon.refreshAgent(id)
        } catch (error) {
          return showError(error)
        }
        notify("Restored from the archive", "success")
        // The live list never held it; open needs it there (the daemon's update replaces this copy).
        const agent = history.find((a) => a.id === id)
        if (agent && !ctx.paseo.agents[id]) ctx.paseo.setAgents(id, { ...(agent as any), archivedAt: null })
      }
      navigate(id)
    }

    async function newProject(root: string | undefined) {
      if (!root) return showError("No projects root: set the plugin's \"root\" option in cli.json")
      const name = (await dialog.prompt({ title: "New project", description: `Folder name, created in ${root}`, placeholder: "my-project" }))?.trim()
      if (!name) return
      if (!validProjectName(name)) return showError(`"${name}" isn't a valid folder name (letters, digits, . _ -)`)
      const result = await daemon.createProjectDirectory({ parentPath: root, name }).catch(showError)
      if (!result) return
      if (result.error || !result.project) return showError(result.error ?? "The daemon didn't create the project")
      startIn(result.project.projectRootPath, result.project.projectDisplayName)
    }

    /** Adds a folder already on the daemon as a project: one from the projects root, or a typed path. */
    async function addExisting(data: Data) {
      const { root } = data
      const TYPE = "\u0000type"
      let folders: { name: string; path: string }[] = []
      if (root) {
        try {
          const listing = await daemon.listDirectory(root, ".")
          folders = addableFolders(root, listing.entries, data.rows.map((row) => row.root))
        } catch (error) {
          showError(`Folders in ${root} not listed: ${error instanceof Error ? error.message : error}`)
        }
      }
      const picked = await dialog.select<string>({
        title: "Add existing folder",
        placeholder: "Search folders",
        size: "large",
        options: [
          { title: "Type a path…", description: root ? `absolute, or relative to ${root}` : "absolute path on the daemon", value: TYPE },
          ...folders.map((folder) => ({ title: folder.name, footer: folder.path, category: root ? `Not yet projects in ${root}` : "Folders", value: folder.path })),
        ],
      })
      if (!picked) return void openProjects(data)
      let target: string | undefined = picked
      if (picked === TYPE) {
        const input = await dialog.prompt({ title: "Add existing folder", description: "Folder on the daemon to add as a project", placeholder: "/path/to/folder", value: root ? `${root}/` : "" })
        if (input === undefined) return void openProjects(data)
        target = folderPath(input, root)
        if (!target) return showError("Type an absolute path, or set the plugin's \"root\" option for relative ones")
      }
      const result = await daemon.addProject(target).catch(showError)
      if (!result) return
      if (result.error || !result.project) return showError(result.error ?? `The daemon didn't add ${target}`)
      startIn(result.project.projectRootPath, projectName(result.project as Project))
    }

    async function cloneProject(root: string | undefined) {
      if (!root) return showError("No projects root: set the plugin's \"root\" option in cli.json")
      const input = await dialog.prompt({ title: "Clone from GitHub", description: `owner/repo or a GitHub URL, cloned into ${root}`, placeholder: "owner/repo" })
      if (!input?.trim()) return
      const repo = parseRepo(input)
      if (!repo) return showError(`"${input.trim()}" doesn't look like a GitHub repository`)
      notify(`Cloning ${repo}…`)
      // The daemon needs a protocol for owner/repo; use the one the pasted address already has.
      const protocol = cloneProtocol(input, ctx.options.cloneProtocol)
      const result = await daemon.cloneGithubProject({ repo, targetDirectory: clonePath(root, repo), cloneProtocol: protocol }).catch(showError)
      if (!result) return
      if (result.error || !result.project) return showError(result.error ?? `The daemon didn't clone ${repo}`)
      startIn(result.project.projectRootPath, result.project.projectDisplayName)
    }

    // On launch, open the picker when pasode starts in a folder the daemon has no project for (e.g. the quick menu's
    // ~ on this laptop, which doesn't exist on the remote daemon). Skipped for `pasode -s <id>`, which opens a session.
    if (ctx.options.autoOpen !== false) {
      // Plugins load just before the initial session is navigated to; wait a beat so agentId() reflects it.
      setTimeout(async () => {
        if (ctx.paseo.agentId() || draft().cwd || draft().fork) return
        const projects = await daemon.listProjects().catch(() => undefined)
        const roots = ((projects?.projects ?? []) as Project[]).map((p) => p.projectRootPath)
        if (insideProject(process.cwd(), roots)) return
        // The user may have opened a session or a dialog in the meantime.
        if (ctx.paseo.agentId() || draft().cwd) return
        void openProjects()
      }, 400)
    }

    // Archiving the open chat sends pasode home; open the picker there so the next pinned chat is one key away.
    // pasode doesn't say why you went home, so it counts as an archive when the chat you left drops out of the live list.
    if (ctx.options.openAfterArchive !== false) {
      createEffect(
        on(ctx.paseo.agentId, (id, left) => {
          if (id || !left) return
          if (left === quiet) return void (quiet = undefined)
          void leftByArchive({
            live: () => !!ctx.paseo.agents[left],
            home: () => !ctx.paseo.agentId(),
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          }).then((archived) => {
            if (!archived) return
            // Archiving from the session list keeps that list open, and pasode then draws the home screen over it.
            // Closing the list first makes the picker a fresh dialog, drawn above the home screen.
            ctx.ui.dialog.clear()
            void openProjects()
          })
        }),
      )
    }

    ctx.commands.register([
      { id: "projects.open", title: "Projects", category: "Session", description: "Start a chat in a project, or add one", keybind: "<leader>p", slash: "projects", run: () => void openProjects() },
      { id: "projects.new", title: "New project", category: "Session", slash: "new-project", run: () => void load().then(({ root }) => newProject(root)).catch(showError) },
      { id: "projects.add", title: "Add existing folder as project", category: "Session", slash: "add-project", run: () => void load().then(addExisting).catch(showError) },
      { id: "projects.clone", title: "Clone project from GitHub", category: "Session", slash: "clone", run: () => void load().then(({ root }) => cloneProject(root)).catch(showError) },
    ])
  },
} satisfies PasodePlugin
