import { expect, test } from "bun:test"
import { barTabs, cycle, pinnedChats, tabLayout, type Chat } from "./model"

const chat = (id: string, workspaceId?: string, extra: Partial<Chat> = {}): Chat => ({ id, workspaceId, ...extra })
const own = (agent: Chat) => agent.workspaceId

test("pinnedChats lists chats in pinned workspaces, oldest pin first", () => {
  const agents = { a: chat("a", "w1"), b: chat("b", "w2"), c: chat("c", "w3") }
  const pins = { w1: "2026-11-03T10:00:00Z", w2: null, w3: "2026-11-01T10:00:00Z" }
  expect(pinnedChats(agents, pins, own)).toEqual(["c", "a"])
})

test("pinnedChats skips archived chats and workspaces shared by several chats", () => {
  const agents = { a: chat("a", "w1", { archivedAt: "2026-11-02T10:00:00Z" }), b: chat("b", "w2"), c: chat("c") }
  const pins = { w1: "2026-11-01T10:00:00Z", w2: "2026-11-01T11:00:00Z" }
  expect(pinnedChats(agents, pins, own)).toEqual(["b"])
  expect(pinnedChats(agents, pins, () => undefined)).toEqual([])
})

test("barTabs adds the open chat at the end as a temporary tab when it isn't pinned", () => {
  expect(barTabs(["a", "b"], "x")).toEqual([
    { id: "a", number: 1, temporary: false },
    { id: "b", number: 2, temporary: false },
    { id: "x", number: undefined, temporary: true },
  ])
  expect(barTabs(["a", "b"], "b").map((tab) => tab.id)).toEqual(["a", "b"])
  expect(barTabs(["a"], undefined).map((tab) => tab.id)).toEqual(["a"])
})

test("barTabs numbers only the first 9 pinned chats", () => {
  const ids = Array.from({ length: 11 }, (_, i) => `p${i}`)
  expect(barTabs(ids, undefined).map((tab) => tab.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, undefined, undefined])
})

test("cycle steps through pinned chats and wraps; from a temporary tab it starts at an end", () => {
  expect(cycle(["a", "b", "c"], "b", 1)).toBe("c")
  expect(cycle(["a", "b", "c"], "c", 1)).toBe("a")
  expect(cycle(["a", "b", "c"], "a", -1)).toBe("c")
  expect(cycle(["a", "b", "c"], "x", 1)).toBe("a")
  expect(cycle(["a", "b", "c"], "x", -1)).toBe("c")
  expect(cycle([], "x", 1)).toBeUndefined()
})

test("tabLayout keeps the open tab in view and reserves room for overflow markers", () => {
  // 3 tabs fit at full width.
  expect(tabLayout(3, 0, 100)).toEqual({ start: 0, shown: 3, before: 0, after: 0, width: 24 })
  // 20 tabs in 60 columns: a window around the open one, with "‹n" and "n›" markers.
  const layout = tabLayout(20, 10, 60)
  expect(layout.start).toBeLessThanOrEqual(10)
  expect(layout.start + layout.shown).toBeGreaterThan(10)
  expect(layout.before + layout.shown + layout.after).toBe(20)
  expect(layout.shown * layout.width).toBeLessThanOrEqual(60)
})
