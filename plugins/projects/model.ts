// Pure helpers for the projects plugin: no daemon, no UI, so `bun test` covers them.

export type Project = {
  projectId: string
  projectDisplayName: string
  projectCustomName?: string | null
  projectRootPath: string
  projectKind: "git" | "directory" | "non_git"
}

export type Workspace = { projectId: string; activityAt?: string | null; lastUserMessageAt?: string | null; createdAt?: string | null }

export type ProjectRow = { id: string; name: string; root: string; git: boolean; chats: number; lastActive?: string }

export const projectName = (project: Project) => project.projectCustomName || project.projectDisplayName

/** Projects with their chat count and latest activity, most recently used first, then by name. */
export function projectRows(projects: Project[], workspaces: Workspace[]): ProjectRow[] {
  const stats = new Map<string, { chats: number; last?: string }>()
  for (const ws of workspaces) {
    const entry = stats.get(ws.projectId) ?? { chats: 0 }
    entry.chats++
    const at = ws.lastUserMessageAt ?? ws.activityAt ?? ws.createdAt ?? undefined
    if (at && (!entry.last || at > entry.last)) entry.last = at
    stats.set(ws.projectId, entry)
  }
  return projects
    .map((project) => ({
      id: project.projectId,
      name: projectName(project),
      root: project.projectRootPath,
      git: project.projectKind === "git",
      chats: stats.get(project.projectId)?.chats ?? 0,
      lastActive: stats.get(project.projectId)?.last,
    }))
    .sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? "") || a.name.localeCompare(b.name))
}

/** The directory most project roots sit directly in (where new projects go), e.g. /srv/projects. */
export function inferRoot(projects: Project[]): string | undefined {
  const counts = new Map<string, number>()
  for (const { projectRootPath } of projects) {
    const parent = projectRootPath.replace(/\/+$/, "").replace(/\/[^/]+$/, "")
    if (parent) counts.set(parent, (counts.get(parent) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0]
}

/** Path shown under a project: relative to the projects root when inside it. */
export function shortPath(root: string, base?: string) {
  if (base && root.startsWith(base + "/")) return root.slice(base.length + 1)
  return root
}

export function ago(iso: string | undefined, now = Date.now()) {
  if (!iso) return "no chats"
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 60 ? `${days}d ago` : new Date(iso).toISOString().slice(0, 10)
}

export type ChatWorkspace = Workspace & { id: string; title?: string | null; name?: string | null; workspaceDirectory?: string | null }
export type ChatAgent = { id: string; workspaceId?: string | null; parentAgentId?: string | null; labels?: Record<string, string> | null; status?: string; updatedAt?: string; lastUserMessageAt?: string | null; pendingPermissions?: unknown[] | null; title?: string | null; archivedAt?: string | null }
/**
 * One chat per workspace, like the desktop sidebar. `agentId` is its top-level session; an archived one is restored
 * when opened. A workspace with no session at all (e.g. a project's default workspace) has `directory` instead:
 * opening it starts a new chat there.
 */
export type Chat = { title: string; state: "running" | "needs input" | "idle" | "archived" | "empty"; at?: string } &
  ({ agentId: string; directory?: undefined } | { agentId?: undefined; directory: string })

/** A project's chats, newest first. `agents` may mix the live list and archived history; live entries win. */
export function projectChats(projectId: string, workspaces: ChatWorkspace[], agents: ChatAgent[], root?: string): Chat[] {
  const byWorkspace = new Map<string, ChatAgent>()
  for (const agent of agents) {
    // Paseo marks a child agent with a "paseo.parent-agent-id" label (snapshots have no parentAgentId field).
    if (!agent.workspaceId || agent.parentAgentId || agent.labels?.["paseo.parent-agent-id"]) continue
    const seen = byWorkspace.get(agent.workspaceId)
    // Prefer a live (unarchived) session, then the most recently updated.
    const better = !seen || (!!seen.archivedAt && !agent.archivedAt) ||
      (!!seen.archivedAt === !!agent.archivedAt && (agent.updatedAt ?? "") > (seen.updatedAt ?? ""))
    if (better) byWorkspace.set(agent.workspaceId, agent)
  }
  const chats: Chat[] = []
  for (const ws of workspaces) {
    if (ws.projectId !== projectId) continue
    const agent = byWorkspace.get(ws.id)
    const title = ws.title || agent?.title || ws.name || "Untitled"
    if (!agent) {
      const directory = ws.workspaceDirectory ?? root
      if (directory) chats.push({ title, state: "empty", at: ws.activityAt ?? ws.createdAt ?? undefined, directory })
      continue
    }
    chats.push({
      agentId: agent.id,
      title,
      state: agent.archivedAt ? "archived" : agent.pendingPermissions?.length ? "needs input" : agent.status === "running" ? "running" : "idle",
      at: ws.lastUserMessageAt ?? agent.lastUserMessageAt ?? ws.activityAt ?? agent.updatedAt ?? undefined,
    })
  }
  return chats.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
}

/** The row footer for a chat: live state, or its age (archived/empty say so). */
export function chatFooter(chat: Chat, now = Date.now()) {
  if (chat.state === "running" || chat.state === "needs input") return chat.state
  if (chat.state === "archived") return `archived · ${ago(chat.at, now)}`
  if (chat.state === "empty") return "no messages"
  return ago(chat.at, now)
}

/** True when `cwd` is a project root or inside one (the daemon can start a chat there as-is). */
export function insideProject(cwd: string, roots: string[]) {
  const dir = cwd.replace(/\/+$/, "") || "/"
  return roots.some((root) => {
    const r = root.replace(/\/+$/, "") || "/"
    return dir === r || dir.startsWith(r === "/" ? "/" : r + "/")
  })
}

/** A folder name the daemon can create: letters, digits, dot, dash, underscore; no leading dot. */
export function validProjectName(name: string) {
  return /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/.test(name)
}

/** owner/repo from "owner/repo", "github.com/owner/repo", an https URL, or git@github.com:owner/repo(.git). */
export function parseRepo(input: string): string | undefined {
  const match = input.trim().match(/^(?:(?:https?:\/\/)?(?:www\.)?github\.com[/:]|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return match ? `${match[1]}/${match[2]}` : undefined
}

// ── Pinned chats (Paseo's workspace pins, shared with the desktop and phone apps) ──

/** A pinned chat as the plugin gathers it from pasode's live stores (same rules as the session switcher). */
export type PinnedCandidate = {
  id: string
  title: string
  cwd: string
  updatedAt: string
  running: boolean
  /** Waiting on a running subagent (pasode's "Waiting" group). */
  waiting: boolean
  needsInput: boolean
}
export type PinnedRow = { id: string; title: string; footer: string }

/** Like pasode's session switcher: running first, then waiting, then most recently updated. */
export function pinnedRows(candidates: PinnedCandidate[], now = Date.now()): PinnedRow[] {
  const rank = (c: PinnedCandidate) => (c.running ? 2 : c.waiting ? 1 : 0)
  return candidates
    .toSorted((a, b) => rank(b) - rank(a) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((c) => {
      const project = c.cwd.replace(/\/+$/, "").split("/").pop() || c.cwd
      const state = c.needsInput ? "needs input" : c.running ? "running" : c.waiting ? "waiting" : ago(c.updatedAt, now)
      return { id: c.id, title: c.title || "Untitled", footer: `${project} · ${state}` }
    })
}
