// Pure decisions for the prompts plugin: which prompts become buttons, how /prompt finds one, and when a click sends.

/** A library entry as Paseo Prompt Manager's prompts.list returns it (content omitted). */
export type PromptSummary = { id: string; title: string; tags: string[]; description?: string; folder?: string; archived?: boolean; updatedAt?: string; revision?: string }

/**
 * The button row: the prompts named in `buttons` (in that order) when given; else those tagged `tag`; else, while no
 * prompt has the tag, every prompt. Archived prompts never show.
 */
export function buttonPrompts(prompts: PromptSummary[], options: { buttons?: string[]; tag: string }): PromptSummary[] {
  const live = prompts.filter((prompt) => !prompt.archived)
  if (options.buttons?.length) return options.buttons.flatMap((name) => live.filter((prompt) => prompt.id === normalizeId(name)))
  const tagged = live.filter((prompt) => prompt.tags.some((tag) => tag.toLowerCase() === options.tag.toLowerCase()))
  return tagged.length ? tagged : live
}

/** "code-review.md", "/code-review" and " code-review " all name the id "code-review". */
export const normalizeId = (name: string) => name.trim().replace(/^\/+/, "").replace(/\.md$/i, "")

/**
 * What `/prompt <name>` refers to: an exact id, else a case-insensitive id or title, else the one id that starts with
 * it. Returns the id, or a message saying why there's no single match.
 */
export function resolvePrompt(prompts: PromptSummary[], name: string): { id: string } | { error: string } {
  const wanted = normalizeId(name)
  if (!wanted) return { error: "Name a prompt, for example /prompt code-review. /prompts lists them." }
  const live = prompts.filter((prompt) => !prompt.archived)
  const exact = live.find((prompt) => prompt.id === wanted)
  if (exact) return { id: exact.id }
  const lower = wanted.toLowerCase()
  const loose = live.find((prompt) => prompt.id.toLowerCase() === lower || prompt.title.toLowerCase() === lower)
  if (loose) return { id: loose.id }
  const prefixed = live.filter((prompt) => prompt.id.toLowerCase().startsWith(lower))
  if (prefixed.length === 1) return { id: prefixed[0]!.id }
  if (prefixed.length > 1) return { error: `"${wanted}" matches ${prefixed.map((prompt) => prompt.id).join(", ")}.` }
  return { error: `No prompt named "${wanted}". /prompts lists them.` }
}

/** A second click on the same button within this window sends while the chat is working. */
export const ARM_MS = 4000

/**
 * What a button click does. While the chat is idle (or waiting on you) a click sends. While a turn runs, the first click
 * arms the button and a second click on it within ARM_MS sends, steering the turn, so a stray click can't.
 */
export function clickAction(input: { id: string; running: boolean; armed?: { id: string; at: number }; now: number }): "send" | "arm" {
  if (!input.running) return "send"
  return input.armed && input.armed.id === input.id && input.now - input.armed.at < ARM_MS ? "send" : "arm"
}

// ── Sorting and the row limit ──

export type SortMode = "used" | "recent" | "title" | "library"
export const SORT_MODES: SortMode[] = ["used", "recent", "title", "library"]

/** Sends per prompt, kept by the plugin (Prompt Manager doesn't count them). */
export type Usage = Record<string, { count: number; last: string }>

/** One more send of `id` at `now`. */
export function recordUse(usage: Usage, id: string, now: string): Usage {
  return { ...usage, [id]: { count: (usage[id]?.count ?? 0) + 1, last: now } }
}

/**
 * used: most sent first (then most recently sent, then title), so prompts never sent sort by title. recent: last edited
 * first. title: alphabetical. library: Prompt Manager's own order.
 */
export function sortPrompts(prompts: PromptSummary[], mode: SortMode, usage: Usage = {}): PromptSummary[] {
  const byTitle = (a: PromptSummary, b: PromptSummary) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  if (mode === "library") return [...prompts]
  if (mode === "title") return prompts.toSorted(byTitle)
  if (mode === "recent") return prompts.toSorted((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || byTitle(a, b))
  return prompts.toSorted((a, b) =>
    (usage[b.id]?.count ?? 0) - (usage[a.id]?.count ?? 0) || (usage[b.id]?.last ?? "").localeCompare(usage[a.id]?.last ?? "") || byTitle(a, b))
}

/** The buttons that fit `max`, and how many more qualify (shown as "+N", which opens the picker). */
export function rowLayout(prompts: PromptSummary[], max: number): { shown: PromptSummary[]; more: number } {
  const limit = Math.max(0, Math.floor(max))
  return { shown: prompts.slice(0, limit), more: Math.max(0, prompts.length - limit) }
}

// ── The editor file: a small metadata header, a "---" line, then the prompt's Markdown ──

export type Editable = { description: string; tags: string[]; content: string }

const HEADER_HELP = "# Lines above --- are details: description and comma-separated tags (\"quick\" puts it on the button row)."

export function serializeEditable(prompt: Editable): string {
  return `${HEADER_HELP}\ndescription: ${prompt.description}\ntags: ${prompt.tags.join(", ")}\n---\n${prompt.content}`
}

/**
 * Reads the editor file back. Without a "---" line the whole file is the content and the details stay as they were
 * (undefined). Lines starting with "#" in the header are comments; unknown keys are ignored.
 */
export function parseEditable(text: string): { description?: string; tags?: string[]; content: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const divider = lines.findIndex((line) => line.trim() === "---")
  if (divider < 0) return { content: text }
  const header = lines.slice(0, divider)
  // A header holds only comments, blank lines and "key: value" lines; anything else means the "---" is the content's.
  if (header.some((line) => line.trim() && !line.trim().startsWith("#") && !/^[A-Za-z]+\s*:/.test(line))) return { content: text }
  // ...and at least one "key: value" line, so a prompt that opens with "# Title" and a "---" rule stays whole.
  if (!header.some((line) => /^[A-Za-z]+\s*:/.test(line.trim()))) return { content: text }
  let description: string | undefined
  let tags: string[] | undefined
  for (const line of header) {
    const match = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(line.trim())
    if (!match) continue
    const key = match[1]!.toLowerCase()
    if (key === "description") description = match[2]!.trim()
    if (key === "tags") tags = match[2]!.split(",").map((tag) => tag.trim()).filter(Boolean)
  }
  return { description, tags, content: lines.slice(divider + 1).join("\n") }
}

/** Adds or removes `tag` (case-insensitive), keeping the other tags in order. */
export function toggleTag(tags: string[], tag: string): string[] {
  const has = tags.some((t) => t.toLowerCase() === tag.toLowerCase())
  return has ? tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...tags, tag]
}
