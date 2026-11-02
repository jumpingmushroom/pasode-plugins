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
