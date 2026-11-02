// Pure decisions for the prompts plugin: which prompts become buttons, how /prompt finds one, and when a click sends.

/** A library entry as Paseo Prompt Manager's prompts.list returns it (content omitted). */
export type PromptSummary = { id: string; title: string; tags: string[]; description?: string; folder?: string; archived?: boolean }

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
