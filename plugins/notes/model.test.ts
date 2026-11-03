import { expect, test } from "bun:test"
import { formatEditorText, htmlToText, matchProject, noteRows, parseEditorText, readOptions, sameNote, textToHtml, webUrl } from "./model"

test("readOptions: defaults, env url and token, bad types fall back", () => {
  const o = readOptions({ projects: "Work/Projects", folder: 3 }, { TRILIUM_URL: "https://notes.example.com/etapi/", TRILIUM_TOKEN: "t" })
  expect(o).toEqual({
    projects: "Work/Projects",
    folder: "Notes",
    noteLabel: "pasodeNote",
    doneLabel: "done",
    pathLabel: "paseoPath",
    createProjects: true,
    url: "https://notes.example.com/etapi",
    token: "t",
    keys: { list: "<leader>a", add: "<leader>k" },
  })
  expect(readOptions({ tokenEnv: "MY_TOKEN", folder: "" }, { MY_TOKEN: "x" })).toMatchObject({ token: "x", folder: "" })
})

test("parseEditorText: first non-empty line is the title, CRLF and blank lines trimmed", () => {
  expect(parseEditorText("\r\n\r\nSidebar notes\r\n\r\nLine one\r\nLine two\r\n\r\n")).toEqual({ title: "Sidebar notes", body: "Line one\nLine two" })
  expect(parseEditorText("Title only\n")).toEqual({ title: "Title only", body: "" })
  expect(parseEditorText("  \n\n")).toBeUndefined()
})

test("formatEditorText round-trips through parseEditorText", () => {
  const note = { title: "Gitea clone", body: "Para one\n\n```ts\nconst a = 1\n```" }
  expect(parseEditorText(formatEditorText(note))).toEqual(note)
  expect(formatEditorText({ title: "T", body: "" })).toBe("T\n")
})

test("textToHtml and htmlToText round-trip paragraphs, line breaks, code fences and special characters", () => {
  const text = "First line\nsecond line\n\n- a & b <c>\n- d\n\n```ts\nif (a < b) {}\n```"
  expect(htmlToText(textToHtml(text))).toBe(text)
})

test("htmlToText reads Trilium web-editor HTML", () => {
  const html =
    '<h2>Plan</h2><p>Use&nbsp;the <strong>API</strong> &amp; tests.</p><ul><li><p>one</p></li><li>two</li></ul><ol><li>first</li></ol><pre><code class="language-ts">x &lt; 1</code></pre>'
  expect(htmlToText(html)).toBe("## Plan\n\nUse the API & tests.\n\n- one\n- two\n\n1. first\n\n```ts\nx < 1\n```")
})

test("matchProject: path label first, then a unique loose title match, else choices", () => {
  const c = (noteId: string, title: string, labels: Record<string, string> = {}) => ({ noteId, title, labels })
  const p = { root: "/srv/projects/foo-bar", name: "foo-bar" }
  expect(matchProject(p, [c("a", "Foo Bar"), c("b", "x", { paseoPath: "/srv/projects/foo-bar" })], "paseoPath")).toEqual({ noteId: "b" })
  expect(matchProject(p, [c("a", "Foo_Bar"), c("z", "other")], "paseoPath")).toEqual({ noteId: "a" })
  const ambiguous = matchProject(p, [c("a", "foo bar"), c("z", "other"), c("b", "FooBar")], "paseoPath")
  expect(ambiguous).toEqual({ choices: [c("a", "foo bar"), c("b", "FooBar"), c("z", "other")] })
  expect(matchProject(p, [c("z", "other")], "paseoPath")).toEqual({ choices: [c("z", "other")] })
})

test("matchProject also matches the root's basename when the display name differs", () => {
  const p = { root: "/srv/projects/foo", name: "Foo App" }
  expect(matchProject(p, [{ noteId: "a", title: "foo", labels: {} }], "paseoPath")).toEqual({ noteId: "a" })
})

test("noteRows: newest first, description is the first non-empty body line", () => {
  const now = Date.parse("2026-11-03T12:00:00Z")
  const rows = noteRows(
    [
      { noteId: "old", title: "Old", body: "", created: "2026-10-20T12:00:00Z" },
      { noteId: "new", title: "New", body: "\nFirst line\nsecond", created: "2026-11-03T10:00:00Z" },
    ],
    now,
  )
  expect(rows.map((r) => r.noteId)).toEqual(["new", "old"])
  expect(rows[0]!).toEqual({ noteId: "new", title: "New", description: "First line", footer: "2h ago" })
  expect(rows[1]!.description).toBe("")
})

test("webUrl strips /etapi", () => {
  expect(webUrl("https://notes.example.com/etapi", "abc123")).toBe("https://notes.example.com/#root/abc123")
})

test("htmlToText keeps nested lists, multi-paragraph items, links, inline code and tables", () => {
  expect(htmlToText("<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>")).toBe("- a\n  - b\n  - c\n- d")
  expect(htmlToText("<ol><li><p>two</p><p>more</p></li></ol>")).toBe("1. two\n   more")
  expect(htmlToText('<p>See <a href="https://x.dev/issue/4?a=1&amp;b=2">the issue</a> and <a href="https://x.dev">https://x.dev</a>.</p>')).toBe(
    "See the issue (https://x.dev/issue/4?a=1&b=2) and https://x.dev.",
  )
  expect(htmlToText("<p>Run <code>bun test</code> first.</p>")).toBe("Run `bun test` first.")
  expect(htmlToText("<table><tbody><tr><td>a</td><td><p>b</p></td></tr><tr><td>c</td><td>d</td></tr></tbody></table>")).toBe("a | b\nc | d")
})

test("htmlToText leaves an out-of-range numeric entity as is", () => {
  expect(htmlToText("<p>&#99999999; ok</p>")).toBe("&#99999999; ok")
})

test("sameNote ignores trailing whitespace and line-ending differences", () => {
  expect(sameNote({ title: "T", body: "a\nb" }, { title: "T ", body: "a\r\nb\n" })).toBe(true)
  expect(sameNote({ title: "T", body: "a" }, { title: "T", body: "b" })).toBe(false)
})

test("matchProject doesn't title-match a note already linked to another folder", () => {
  const p = { root: "/srv/b/api", name: "api" }
  const linked = { noteId: "a", title: "api", labels: { paseoPath: "/srv/a/api" } }
  expect(matchProject(p, [linked], "paseoPath")).toEqual({ choices: [linked] })
})
