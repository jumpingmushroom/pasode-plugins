// Pure helpers for the pinned-tabs bar: which chats get a tab, their numbers, cycling, and how many fit.

/** The parts of a Paseo agent this plugin reads. */
export type Chat = { id: string; workspaceId?: string | null; archivedAt?: string | null }

/** A tab in the bar. Pinned tabs 1–9 get a number for ctrl+x 1–9; the temporary tab has none. */
export type Tab = { id: string; number: number | undefined; temporary: boolean }

/**
 * Chats in pinned workspaces, in the order you pinned them (oldest first, so new pins go on the right).
 * Only a workspace's own chat counts, as in pasode's chat switcher: `own` returns the workspace id for a chat that
 * has its workspace to itself, else undefined.
 */
export function pinnedChats(
  agents: Record<string, Chat | undefined>,
  pins: Record<string, string | null | undefined>,
  own: (agent: Chat) => string | null | undefined,
): string[] {
  return Object.values(agents)
    .filter((agent): agent is Chat => !!agent && !agent.archivedAt && !!agent.workspaceId && !!pins[agent.workspaceId] && !!own(agent))
    .map((agent) => ({ id: agent.id, at: Date.parse(pins[agent.workspaceId!]!) }))
    .toSorted((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .map((entry) => entry.id)
}

/** The bar: the pinned chats, then the open chat as a temporary tab when it isn't pinned. */
export function barTabs(pinned: readonly string[], current: string | undefined): Tab[] {
  const tabs = pinned.map((id, index): Tab => ({ id, number: index < 9 ? index + 1 : undefined, temporary: false }))
  if (current && !pinned.includes(current)) tabs.push({ id: current, number: undefined, temporary: true })
  return tabs
}

/** The pinned chat `direction` steps from `current`, wrapping; from a temporary tab, the first (or last) one. */
export function cycle(pinned: readonly string[], current: string | undefined, direction: 1 | -1) {
  if (!pinned.length) return undefined
  const index = pinned.indexOf(current!)
  if (index === -1) return direction === 1 ? pinned[0] : pinned.at(-1)
  return pinned[(index + direction + pinned.length) % pinned.length]
}

// The layout below is pasode's own tab layout (src/tabs-model.ts, from OpenCode, MIT), so the bar looks the same.
export const TAB_MIN_WIDTH = 10
export const TAB_MAX_WIDTH = 24
/** The bar hides below this terminal width. */
export const TAB_BAR_MIN_COLUMNS = 40

/** Cells an overflow marker takes, such as "‹12 " and " 12›". */
const overflowWidth = (count: number) => String(count).length + 2

/**
 * Which tabs fit in `available` cells: a window of tabs at least TAB_MIN_WIDTH wide that keeps `active` in view,
 * scrolling from `previousStart` only as far as needed, with room for the "‹n" and "n›" overflow markers.
 */
export function tabLayout(total: number, active: number, available: number, previousStart = 0) {
  const fit = (room: number) => Math.min(total, Math.max(1, Math.floor(room / TAB_MIN_WIDTH)))
  let shown = fit(available)
  let start = 0
  let markers = 0
  // The markers take room, which can shrink the window, which can move the markers; settle in a few passes.
  for (let pass = 0; pass < 3; pass++) {
    start = Math.min(Math.max(0, previousStart), total - shown)
    if (active >= 0) start = active < start ? active : active >= start + shown ? active - shown + 1 : start
    markers = (start > 0 ? overflowWidth(start) : 0) + (start + shown < total ? overflowWidth(total - start - shown) : 0)
    const next = fit(available - markers)
    if (next === shown) break
    shown = next
  }
  const width = Math.min(TAB_MAX_WIDTH, Math.max(TAB_MIN_WIDTH, Math.floor((available - markers) / shown)))
  return { start, shown, before: start, after: total - start - shown, width }
}
