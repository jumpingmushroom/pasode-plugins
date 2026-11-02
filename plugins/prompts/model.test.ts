import { expect, test } from "bun:test"
import { ARM_MS, buttonPrompts, clickAction, normalizeId, resolvePrompt, type PromptSummary } from "./model"
import { fillTemplate, parseVariables } from "./templates"

const library: PromptSummary[] = [
  { id: "approved", title: "approved", tags: [] },
  { id: "complete-code-review", title: "Complete code review", tags: ["review", "code"] },
  { id: "continue", title: "continue", tags: ["Quick"] },
  { id: "yes", title: "yes", tags: ["quick"] },
  { id: "old", title: "old", tags: ["quick"], archived: true },
]

test("buttons: named list in order, else the tag, else everything; never archived", () => {
  expect(buttonPrompts(library, { tag: "quick" }).map((p) => p.id)).toEqual(["continue", "yes"])
  expect(buttonPrompts(library, { tag: "missing" }).map((p) => p.id)).toEqual(["approved", "complete-code-review", "continue", "yes"])
  expect(buttonPrompts(library, { tag: "quick", buttons: ["yes", "approved.md", "nope", "old"] }).map((p) => p.id)).toEqual(["yes", "approved"])
})

test("normalizeId strips slashes, .md and spaces", () => {
  expect(normalizeId(" /code-review.md ")).toBe("code-review")
  expect(normalizeId("engineering/security/review")).toBe("engineering/security/review")
})

test("resolvePrompt: exact id, then loose id or title, then a unique prefix", () => {
  expect(resolvePrompt(library, "yes")).toEqual({ id: "yes" })
  expect(resolvePrompt(library, "complete code review")).toEqual({ id: "complete-code-review" })
  expect(resolvePrompt(library, "APPROVED.md")).toEqual({ id: "approved" })
  expect(resolvePrompt(library, "comp")).toEqual({ id: "complete-code-review" })
  expect(resolvePrompt(library, "co")).toEqual({ error: '"co" matches complete-code-review, continue.' })
  expect(resolvePrompt(library, "old")).toEqual({ error: 'No prompt named "old". /prompts lists them.' })
  expect("error" in resolvePrompt(library, "  ")).toBe(true)
})

test("clicks: idle sends; while running the first click arms and a quick second click sends", () => {
  expect(clickAction({ id: "yes", running: false, now: 0 })).toBe("send")
  expect(clickAction({ id: "yes", running: true, now: 0 })).toBe("arm")
  expect(clickAction({ id: "yes", running: true, armed: { id: "yes", at: 0 }, now: 1000 })).toBe("send")
  expect(clickAction({ id: "yes", running: true, armed: { id: "approved", at: 0 }, now: 1000 })).toBe("arm")
  expect(clickAction({ id: "yes", running: true, armed: { id: "yes", at: 0 }, now: ARM_MS })).toBe("arm")
})

test("variables: names and defaults outside code, filled in like Prompt Manager", () => {
  const content = "Look at {{ module }} and assign {{ person | me }}.\n\n`style={{ flex: 1 }}` stays, \\{{ literal }} too.\n\n```\n{{ inside }}\n```\n"
  expect(parseVariables(content)).toEqual([{ name: "module" }, { name: "person", fallback: "me" }])
  expect(fillTemplate(content, { module: "auth" })).toBe("Look at auth and assign me.\n\n`style={{ flex: 1 }}` stays, {{ literal }} too.\n\n```\n{{ inside }}\n```\n")
  expect(() => fillTemplate("Fix {{ module }}", {})).toThrow('Enter a value for "module".')
  expect(fillTemplate("plain text", {})).toBe("plain text")
})

import { parseEditable, recordUse, rowLayout, serializeEditable, sortPrompts, toggleTag } from "./model"

const lib: PromptSummary[] = [
  { id: "yes", title: "yes", tags: [], updatedAt: "2026-11-01T00:00:00Z" },
  { id: "approved", title: "approved", tags: [], updatedAt: "2026-10-01T00:00:00Z" },
  { id: "continue", title: "Continue", tags: [], updatedAt: "2026-11-02T00:00:00Z" },
]

test("sorting: used, then recent, title and library", () => {
  let usage = recordUse({}, "yes", "2026-11-02T10:00:00Z")
  usage = recordUse(usage, "yes", "2026-11-02T11:00:00Z")
  usage = recordUse(usage, "continue", "2026-11-02T12:00:00Z")
  expect(usage.yes).toEqual({ count: 2, last: "2026-11-02T11:00:00Z" })
  expect(sortPrompts(lib, "used", usage).map((p) => p.id)).toEqual(["yes", "continue", "approved"])
  expect(sortPrompts(lib, "used", {}).map((p) => p.id)).toEqual(["approved", "continue", "yes"]) // no history: by title
  expect(sortPrompts(lib, "recent").map((p) => p.id)).toEqual(["continue", "yes", "approved"])
  expect(sortPrompts(lib, "title").map((p) => p.id)).toEqual(["approved", "continue", "yes"])
  expect(sortPrompts(lib, "library").map((p) => p.id)).toEqual(["yes", "approved", "continue"])
})

test("row layout: the first max, and how many more", () => {
  expect(rowLayout(lib, 2)).toEqual({ shown: lib.slice(0, 2), more: 1 })
  expect(rowLayout(lib, 6)).toEqual({ shown: lib, more: 0 })
  expect(rowLayout(lib, 0)).toEqual({ shown: [], more: 3 })
})

test("editor file round-trips details and content", () => {
  const text = serializeEditable({ description: "When the agent needs approval", tags: ["quick", "review"], content: "# approved\n\nLooks good, go ahead.\n" })
  expect(text.split("\n").slice(1, 4)).toEqual(["description: When the agent needs approval", "tags: quick, review", "---"])
  expect(parseEditable(text)).toEqual({ description: "When the agent needs approval", tags: ["quick", "review"], content: "# approved\n\nLooks good, go ahead.\n" })
  expect(parseEditable(text.replace("tags: quick, review", "tags:"))).toMatchObject({ tags: [] })
})

test("editor file: no header, or a --- that belongs to the content, keeps everything as content", () => {
  expect(parseEditable("Just a prompt")).toEqual({ content: "Just a prompt" })
  const ruled = "# Title\n\nAbove\n---\nBelow"
  expect(parseEditable(ruled)).toEqual({ content: ruled })
  const titled = "# Title\n---\nBody" // a heading straight above a rule is content, not a header comment
  expect(parseEditable(titled)).toEqual({ content: titled })
})

test("toggleTag adds and removes case-insensitively", () => {
  expect(toggleTag(["review"], "quick")).toEqual(["review", "quick"])
  expect(toggleTag(["Quick", "review"], "quick")).toEqual(["review"])
})
