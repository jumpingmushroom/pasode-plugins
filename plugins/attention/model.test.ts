import { expect, test } from "bun:test"
import { attentionItems, clock, parentOf, projectOf, resumeItems, runningSubagents, subagentSummary, summary, worst, type AttentionAgent } from "./model"

const agent = (id: string, extra: Partial<AttentionAgent> = {}): AttentionAgent => ({ id, cwd: `/srv/projects/${id}`, ...extra })

test("projectOf takes the last folder", () => {
  expect(projectOf("/srv/projects/games/mods/shader")).toBe("shader")
  expect(projectOf("/srv/projects/webapp/")).toBe("webapp")
})

test("attention: permission, then error, then finished; oldest first; skips current, archived, subagents, quiet ones", () => {
  const items = attentionItems([
    agent("quiet", { requiresAttention: false }),
    agent("done-new", { requiresAttention: true, attentionReason: "finished", attentionTimestamp: "2026-11-02T10:00:00Z" }),
    agent("done-old", { requiresAttention: true, attentionReason: "finished", attentionTimestamp: "2026-11-01T10:00:00Z" }),
    agent("shader", { requiresAttention: true, attentionReason: "error", attentionTimestamp: "2026-10-31T12:00:00Z" }),
    agent("asks", { pendingPermissions: [{}], attentionTimestamp: "2026-11-02T11:00:00Z" }),
    agent("asks-flag", { requiresAttention: true, attentionReason: "permission", attentionTimestamp: "2026-11-02T09:00:00Z" }),
    agent("open-now", { requiresAttention: true, attentionReason: "finished" }),
    agent("gone", { requiresAttention: true, archivedAt: "2026-11-01T00:00:00Z" }),
    agent("child", { requiresAttention: true, parentAgentId: "x" }),
  ], "open-now")
  expect(items.map((i) => `${i.name}:${i.reason}`)).toEqual([
    "asks-flag:needs input", "asks:needs input", "shader:error", "done-old:finished", "done-new:finished",
  ])
  expect(worst(items)).toBe("needs input")
  expect(worst([])).toBeUndefined()
})

test("summary names the first two, then counts the rest", () => {
  const items = attentionItems([
    agent("shader", { requiresAttention: true, attentionReason: "error", attentionTimestamp: "1" }),
    agent("home-monitor", { requiresAttention: true, attentionReason: "finished", attentionTimestamp: "2" }),
    agent("webapp", { requiresAttention: true, attentionReason: "finished", attentionTimestamp: "3" }),
  ])
  expect(summary(items)).toBe("shader error · home-monitor finished +1")
  expect(summary(items.slice(0, 1))).toBe("shader error")
  expect(summary([])).toBe("")
})

test("clock: time today, weekday this week, date further out", () => {
  const now = new Date(2026, 10, 2, 12, 0).getTime() // local 2 Nov 2026 12:00
  expect(clock(new Date(2026, 10, 2, 14, 0).toISOString(), now)).toBe("14:00")
  expect(clock(new Date(2026, 10, 3, 9, 5).toISOString(), now)).toBe("Tue 09:05")
  expect(clock(new Date(2026, 10, 12, 8, 0).toISOString(), now)).toBe("2026-11-12 08:00")
  expect(clock("nonsense", now)).toBe("?")
})

test("resume items: soonest first, with sending, off, and waiting states", () => {
  const now = new Date(2026, 10, 2, 12, 0).getTime()
  const at = (h: number) => new Date(2026, 10, 2, h, 0).toISOString()
  const items = resumeItems([
    { agentId: "a", title: "Fix it", projectName: "webapp", dueAt: at(15), enabled: true, sending: false },
    { agentId: "b", title: "Long title", projectName: null, dueAt: at(13), enabled: true, sending: false, waiting: "usage" },
    { agentId: "c", title: null, projectName: "shader", dueAt: at(14), enabled: false, sending: false },
    { agentId: "d", title: null, projectName: null, dueAt: at(12), enabled: true, sending: true },
  ], now)
  expect(items.map((i) => `${i.name}: ${i.label}`)).toEqual([
    "chat: resuming now", "Long title: checks usage 13:00", "shader: paused, auto-resume off", "webapp: resumes 15:00",
  ])
})

test("parentOf reads Paseo's parent label (snapshots have no parentAgentId)", () => {
  expect(parentOf({ labels: { "paseo.parent-agent-id": "p" } })).toBe("p")
  expect(parentOf({ parentAgentId: "q" })).toBe("q")
  expect(parentOf({ labels: {} })).toBeUndefined()
})

test("labelled child agents don't count as chats that need you", () => {
  const items = attentionItems([
    agent("webapp", { requiresAttention: true, attentionReason: "finished" }),
    agent("child", { requiresAttention: true, attentionReason: "finished", labels: { "paseo.parent-agent-id": "webapp" } }),
  ])
  expect(items.map((i) => i.id)).toEqual(["webapp"])
})

test("running subagents: child agents plus provider subagents of running chats, busiest first", () => {
  const agents = [
    agent("webapp", { status: "running" }),
    agent("shader", { status: "running" }),
    agent("idle", { status: "idle" }),
    agent("c1", { status: "running", labels: { "paseo.parent-agent-id": "shader" } }),
    agent("c2", { status: "idle", labels: { "paseo.parent-agent-id": "shader" } }),
  ]
  const native = new Map([
    ["webapp", new Map([["t1", "running"], ["t2", "running"], ["t3", "completed"]])],
    ["idle", new Map([["stale", "running"]])], // parent no longer runs: ignored
  ])
  const groups = runningSubagents(agents, native)
  expect(groups).toEqual([{ parentId: "webapp", name: "webapp", count: 2 }, { parentId: "shader", name: "shader", count: 1 }])
  expect(subagentSummary(groups)).toBe("3 subagents  webapp 2 · shader 1")
  expect(subagentSummary(groups, 1)).toBe("3 subagents  webapp 2 +1")
  expect(subagentSummary([])).toBe("")
})
