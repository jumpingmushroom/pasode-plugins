// Pure helpers for the attention line: which chats need you, and which wait on an automatic resume.

/** The agent fields this plugin reads (Paseo agent snapshots, live from the daemon). */
export type AttentionAgent = {
  id: string
  cwd: string
  title?: string | null
  status?: string
  requiresAttention?: boolean | null
  attentionReason?: string | null
  attentionTimestamp?: string | null
  pendingPermissions?: unknown[] | null
  archivedAt?: string | null
  parentAgentId?: string | null
  labels?: Record<string, string> | null
  updatedAt?: string
}

/** Paseo labels a child agent with its parent ("paseo.parent-agent-id"); snapshots carry no parentAgentId field. */
export const PARENT_LABEL = "paseo.parent-agent-id"
export const parentOf = (agent: Pick<AttentionAgent, "parentAgentId" | "labels">) =>
  agent.labels?.[PARENT_LABEL] || agent.parentAgentId || undefined

export type Reason = "needs input" | "error" | "finished"
export type AttentionItem = { id: string; name: string; reason: Reason; at: string }

const RANK: Record<Reason, number> = { "needs input": 0, error: 1, finished: 2 }

/** The last folder of a path: the project a chat runs in (e.g. /srv/projects/games/mods/shader → shader). */
export const projectOf = (cwd: string) => cwd.replace(/\/+$/, "").split("/").pop() || cwd

/**
 * Chats that need you, most urgent first (waiting for permission, then errors, then finished), oldest first within
 * each. The chat on screen is left out: you're already looking at it. Subagents roll up to their parent.
 */
export function attentionItems(agents: AttentionAgent[], currentId?: string): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const agent of agents) {
    if (agent.archivedAt || parentOf(agent) || agent.id === currentId) continue
    const waiting = !!agent.pendingPermissions?.length
    if (!waiting && !agent.requiresAttention) continue
    const reason: Reason = waiting || agent.attentionReason === "permission" ? "needs input" : agent.attentionReason === "error" ? "error" : "finished"
    items.push({ id: agent.id, name: projectOf(agent.cwd), reason, at: agent.attentionTimestamp ?? agent.updatedAt ?? "" })
  }
  return items.sort((a, b) => RANK[a.reason] - RANK[b.reason] || a.at.localeCompare(b.at))
}

/** "shader error · home-monitor finished +1": the first `names` items, then how many more. */
export function summary(items: AttentionItem[], names = 2) {
  const shown = items.slice(0, names).map((item) => `${item.name} ${item.reason}`)
  const more = items.length - shown.length
  return shown.join(" · ") + (more > 0 ? ` +${more}` : "")
}

/** The worst reason present, which sets the line's color. */
export function worst(items: AttentionItem[]): Reason | undefined {
  return items[0]?.reason // items are sorted most urgent first
}

// ── Automatic resumes (the Paseo plugin "usage-auto-resume", RPC auto-resume.list) ──

export type ResumeJob = {
  agentId: string
  title: string | null
  projectName: string | null
  dueAt: string
  enabled: boolean
  sending: boolean
  waiting?: "auth" | "usage"
}
export type ResumeItem = { id: string; name: string; label: string; dueAt: string }

/** "14:00" today, "Tue 14:00" within a week, else "2026-11-12 14:00" (local time). */
export function clock(iso: string, now = Date.now()) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "?"
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  const today = new Date(now)
  if (date.toDateString() === today.toDateString()) return time
  if (Math.abs(date.getTime() - now) < 6 * 86_400_000) return `${date.toLocaleDateString("en-GB", { weekday: "short" })} ${time}`
  return `${date.toLocaleDateString("sv-SE")} ${time}` // sv-SE formats as YYYY-MM-DD
}

/** Chats waiting on an automatic resume, soonest first. */
export function resumeItems(jobs: ResumeJob[], now = Date.now()): ResumeItem[] {
  return jobs
    .map((job) => ({
      id: job.agentId,
      name: job.projectName || job.title || "chat",
      dueAt: job.dueAt,
      label: job.sending ? "resuming now"
        : !job.enabled ? "paused, auto-resume off"
        : job.waiting === "usage" ? `checks usage ${clock(job.dueAt, now)}`
        : job.waiting === "auth" ? `checks sign-in ${clock(job.dueAt, now)}`
        : `resumes ${clock(job.dueAt, now)}`,
    }))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
}

// ── Running subagents: Paseo child agents plus provider subagents (Claude Task/Agent calls, Codex child threads) ──

export type SubagentGroup = { parentId: string; name: string; count: number }

/**
 * Running subagents per parent chat, busiest first. `native` maps a parent chat to its provider subagents' statuses
 * (kept from the daemon's provider_subagents updates); those count only while the parent itself runs, so a missed
 * "completed" update can't leave a phantom.
 */
export function runningSubagents(agents: AttentionAgent[], native: ReadonlyMap<string, ReadonlyMap<string, string>>): SubagentGroup[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const counts = new Map<string, number>()
  for (const agent of agents) {
    const parent = parentOf(agent)
    if (parent && agent.status === "running" && !agent.archivedAt) counts.set(parent, (counts.get(parent) ?? 0) + 1)
  }
  for (const [parentId, subagents] of native) {
    if (byId.get(parentId)?.status !== "running") continue
    let running = 0
    for (const status of subagents.values()) if (status === "running") running++
    if (running) counts.set(parentId, (counts.get(parentId) ?? 0) + running)
  }
  return [...counts]
    .map(([parentId, count]) => ({ parentId, count, name: byId.has(parentId) ? projectOf(byId.get(parentId)!.cwd) : "chat" }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** "3 subagents  webapp 2 · shader 1": the total, then the first `names` chats. */
export function subagentSummary(groups: SubagentGroup[], names = 2) {
  const total = groups.reduce((sum, group) => sum + group.count, 0)
  if (!total) return ""
  const shown = groups.slice(0, names).map((group) => `${group.name} ${group.count}`)
  const more = groups.length - shown.length
  return `${total} subagent${total === 1 ? "" : "s"}  ${shown.join(" · ")}${more > 0 ? ` +${more}` : ""}`
}
