// Projects picker for pasode, like the Paseo desktop sidebar's per-project "+":
// ctrl+x p (or /projects) lists pinned chats (Paseo's workspace pins) and the daemon's projects; pick one to open one of its chats, start a new one, start one in a new git worktree,
// or create a new project / clone one from GitHub. Paths are the daemon's (e.g. /srv/projects/<name>),
// so this works with a remote daemon whose folders don't exist on this machine.
//
// Options (cli.json: ["~/pasode-plugins/plugins/projects", { "root": "/srv/projects" }]):
//   root      where new projects and clones go; default = the folder most existing projects sit in.
//   autoOpen  false stops the picker opening on launch outside a known project (default true).
import type { PasodePlugin } from "@pasode/host"
import { ago, chatFooter, pinnedRows, inferRoot, insideProject, parseRepo, projectChats, projectRows, shortPath, validProjectName, type ChatAgent, type ChatWorkspace, type Project, type ProjectRow } from "./model"

type Pick =
  | { kind: "project"; row: ProjectRow }
  | { kind: "new" }
  | { kind: "clone" }
  | { kind: "pinned"; id: string }

type Choice = "chat" | "worktree" | "back" | { open: string; archived: boolean } | { startIn: string }

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

    async function openProjects(data?: Data, from?: ProjectRow) {
      data ??= await load().catch((error) => void showError(error))
      if (!data) return
      const { rows, root } = data
      // DialogSelect matches `current` by identity, so the rows' option values are built once per load.
      const picks = new Map(rows.map((row) => [row.id, { kind: "project", row } as Pick]))
      const picked = await dialog.select<Pick>({
        title: "Projects",
        placeholder: "Search pinned chats and projects",
        size: "large",
        current: from ? picks.get(from.id) : undefined,
        options: [
          { title: "New project…", description: root ? `empty folder in ${root}` : "empty folder", category: "Add", value: { kind: "new" } },
          { title: "Clone from GitHub…", description: root ? `into ${root}` : undefined, category: "Add", value: { kind: "clone" } },
          ...pinned().map((chat) => ({ title: chat.title, footer: chat.footer, category: "Pinned", value: { kind: "pinned", id: chat.id } as Pick })),
          ...rows.map((row) => ({
            title: row.name,
            // Only show the folder when it says something the name doesn't.
            description: shortPath(row.root, root) === row.name ? undefined : shortPath(row.root, root),
            footer: `${row.chats ? `${row.chats} chat${row.chats === 1 ? "" : "s"} · ` : ""}${ago(row.lastActive)}`,
            category: "Projects",
            value: picks.get(row.id)!,
          })),
        ],
      })
      if (!picked) return
      if (picked.kind === "new") return void newProject(root)
      if (picked.kind === "clone") return void cloneProject(root)
      if (picked.kind === "pinned") return ctx.paseo.navigate(picked.id)
      return void projectMenu(picked.row, data)
    }

    async function projectMenu(row: ProjectRow, data: Data) {
      const history = await data.history.catch((error) => {
        showError(`Archived chats not loaded: ${error instanceof Error ? error.message : error}`)
        return [] as ChatAgent[]
      })
      // Live sessions first: they carry current status; history adds the archived ones the live list leaves out.
      const chats = projectChats(row.id, data.workspaces, [...Object.values(ctx.paseo.agents), ...history], row.root)
      const choice = await dialog.select<Choice>({
        title: row.name,
        placeholder: "Search chats · esc goes back",
        size: "large",
        options: [
          { title: "← All projects", value: "back" as const },
          { title: "New chat", category: "New", value: "chat" as const },
          ...(row.git ? [{ title: "New chat in a git worktree", description: "branch + base", category: "New", value: "worktree" as const }] : []),
          ...chats.map((chat) => ({
            title: chat.title,
            footer: chatFooter(chat),
            category: "Chats",
            value: (chat.directory !== undefined ? { startIn: chat.directory } : { open: chat.agentId, archived: chat.state === "archived" }) as Choice,
          })),
        ],
      })
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

    async function cloneProject(root: string | undefined) {
      if (!root) return showError("No projects root: set the plugin's \"root\" option in cli.json")
      const input = await dialog.prompt({ title: "Clone from GitHub", description: `owner/repo or a GitHub URL, cloned into ${root}`, placeholder: "owner/repo" })
      if (!input?.trim()) return
      const repo = parseRepo(input)
      if (!repo) return showError(`"${input.trim()}" doesn't look like a GitHub repository`)
      notify(`Cloning ${repo}…`)
      const result = await daemon.cloneGithubProject({ repo, targetDirectory: root }).catch(showError)
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

    ctx.commands.register([
      { id: "projects.open", title: "Projects", category: "Session", description: "Start a chat in a project, or add one", keybind: "<leader>p", slash: "projects", run: () => void openProjects() },
      { id: "projects.new", title: "New project", category: "Session", slash: "new-project", run: () => void load().then(({ root }) => newProject(root)).catch(showError) },
      { id: "projects.clone", title: "Clone project from GitHub", category: "Session", slash: "clone", run: () => void load().then(({ root }) => cloneProject(root)).catch(showError) },
    ])
  },
} satisfies PasodePlugin
