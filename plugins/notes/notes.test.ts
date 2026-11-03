import { expect, test } from "bun:test"
import { readOptions } from "./model"
import { createNotes, push } from "./notes"
import type { TNote, Trilium } from "./trilium"

type Stored = { note: TNote; parent: string; html: string }

/** In-memory Trilium that understands the searches the plugin sends. */
function memory() {
  const notes = new Map<string, Stored>()
  const log: string[] = []
  let next = 0
  const add = (parent: string, title: string, html = "", labels: Record<string, string> = {}) => {
    const noteId = `n${next++}`
    const attributes = Object.entries(labels).map(([name, value], i) => ({ attributeId: `${noteId}a${i}`, type: "label" as const, name, value }))
    notes.set(noteId, { note: { noteId, title, type: "text", utcDateCreated: `2026-11-03 08:00:0${next % 10}.000Z`, childNoteIds: [], attributes }, parent, html })
    return noteId
  }
  const matches = (n: TNote, search: string) => {
    const title = /^note\.title = '(.*)'$/.exec(search)
    if (title) return n.title === title[1]!.replace(/\\'/g, "'")
    if (search === "note.noteId != ''") return true
    return search.split(/\s+/).every((token) => {
      const has = n.attributes.some((a) => a.type === "label" && a.name === token.replace(/^#!?/, ""))
      return token.startsWith("#!") ? !has : has
    })
  }
  const trilium: Trilium = {
    async note(id) {
      return notes.get(id)!.note
    },
    async children(parent, search = "note.noteId != ''") {
      log.push(`children ${parent} ${search}`)
      return [...notes.values()].filter((s) => s.parent === parent && matches(s.note, search)).map((s) => s.note)
    },
    async content(id) {
      return notes.get(id)!.html
    },
    async setContent(id, html) {
      notes.get(id)!.html = html
    },
    async create(parent, title, html, labels = {}) {
      log.push(`create ${parent} ${title}`)
      return notes.get(add(parent, title, html, labels))!.note
    },
    async rename(id, title) {
      notes.get(id)!.note.title = title
    },
    async remove(id) {
      notes.delete(id)
    },
    async addLabel(id, name, value = "") {
      notes.get(id)!.note.attributes.push({ attributeId: `${id}x${name}`, type: "label", name, value })
    },
    async resolve(ref) {
      return ref
    },
  }
  return { notes, log, add, trilium }
}

const options = (raw: Record<string, unknown> = {}) => readOptions({ projects: "projects", ...raw }, {})

test("folder mode: the first list creates one Notes child, later lists reuse it", async () => {
  const m = memory()
  const project = m.add("projects", "foo")
  const notes = createNotes(m.trilium, options())
  expect(await notes.list(project)).toEqual([])
  expect(await notes.list(project)).toEqual([])
  expect(m.log.filter((line) => line.startsWith("create"))).toEqual([`create ${project} Notes`])
})

test("folder mode: list hides done notes and converts bodies to text", async () => {
  const m = memory()
  const project = m.add("projects", "foo")
  const folder = m.add(project, "Notes")
  m.add(folder, "Open", "<p>a<br>b</p>")
  m.add(folder, "Finished", "<p>x</p>", { done: "" })
  const list = await createNotes(m.trilium, options()).list(project)
  expect(list.map((n) => [n.title, n.body])).toEqual([["Open", "a\nb"]])
  expect(list[0]!.created).toMatch(/^2026-11-03T08:00:0\d\.000Z$/)
})

test("flat mode: only labelled, open notes; siblings like Documentation stay out", async () => {
  const m = memory()
  const project = m.add("projects", "foo")
  m.add(project, "Documentation")
  m.add(project, "Idea", "<p>x</p>", { pasodeNote: "" })
  m.add(project, "Old idea", "<p>y</p>", { pasodeNote: "", done: "" })
  const list = await createNotes(m.trilium, options({ folder: "" })).list(project)
  expect(list.map((n) => n.title)).toEqual(["Idea"])
  expect(m.log.some((line) => line.startsWith("create"))).toBe(false)
})

test("add then list returns the same title and body", async () => {
  const m = memory()
  const project = m.add("projects", "foo")
  const notes = createNotes(m.trilium, options())
  const id = await notes.add(project, { title: "Sidebar notes", body: "Line one\nLine two\n\n- a & b" })
  const list = await notes.list(project)
  expect(list).toHaveLength(1)
  expect(list[0]!).toMatchObject({ noteId: id, title: "Sidebar notes", body: "Line one\nLine two\n\n- a & b" })
})

test("update, markDone and remove change the note", async () => {
  const m = memory()
  const project = m.add("projects", "foo")
  const notes = createNotes(m.trilium, options())
  const id = await notes.add(project, { title: "A", body: "x" })
  await notes.update(id, { title: "B", body: "y" })
  expect((await notes.list(project))[0]!).toMatchObject({ title: "B", body: "y" })
  await notes.markDone(id)
  expect(await notes.list(project)).toEqual([])
  await notes.remove(id)
  expect(m.notes.has(id)).toBe(false)
})

test("projectNote matches children of the projects note; linkProject and createProject label them", async () => {
  const m = memory()
  m.add("projects", "Foo")
  m.add("projects", "Other")
  const notes = createNotes(m.trilium, options())
  const foo = { root: "/srv/projects/foo", name: "foo" }
  const matched = await notes.projectNote(foo)
  expect("noteId" in matched).toBe(true)
  const bar = { root: "/srv/projects/bar", name: "bar" }
  const choices = await notes.projectNote(bar)
  expect("choices" in choices && choices.choices.map((c) => c.title)).toEqual(["Foo", "Other"])
  const created = await notes.createProject(bar)
  expect(m.notes.get(created)!.note.title).toBe("bar")
  expect(await notes.projectNote(bar)).toEqual({ noteId: created })
  const other = [...m.notes.values()].find((s) => s.note.title === "Other")!.note.noteId
  const baz = { root: "/srv/projects/baz", name: "baz" }
  await notes.linkProject(baz, other)
  expect(await notes.projectNote(baz)).toEqual({ noteId: other })
})

test("projectNote without the projects option rejects with a message naming it", async () => {
  const notes = createNotes(memory().trilium, readOptions({}, {}))
  await expect(notes.projectNote({ root: "/srv/projects/foo", name: "foo" })).rejects.toThrow(
    `Set the notes plugin's "projects" option to a Trilium note ID or title path`,
  )
})

const item = (body: string) => ({ noteId: "n", title: "T", body, created: "2026-11-03T08:00:00Z" })

test("push refuses an empty prompt before starting a chat", async () => {
  let started = 0
  await expect(push({ start: async () => (started++, "c"), markDone: async () => {} }, item("  \n"))).rejects.toThrow("This note has no prompt. Edit it first (ctrl+e).")
  expect(started).toBe(0)
})

test("push: a failed start leaves the note open", async () => {
  let done = 0
  await expect(push({ start: async () => Promise.reject(new Error("daemon down")), markDone: async () => void done++ }, item("x"))).rejects.toThrow("daemon down")
  expect(done).toBe(0)
})

test("push: a failed markDone after the chat started is a warning, not an error", async () => {
  let started = 0
  const result = await push({ start: async () => (started++, "chat1"), markDone: async () => Promise.reject(new Error("401")) }, item("x"))
  expect(result).toEqual({ chatId: "chat1", warning: "Chat started, but marking the note done failed: 401" })
  expect(started).toBe(1)
})

test("push: success starts once, then marks done once", async () => {
  const order: string[] = []
  const result = await push({ start: async () => (order.push("start"), "chat1"), markDone: async () => void order.push("done") }, item("x"))
  expect(result).toEqual({ chatId: "chat1" })
  expect(order).toEqual(["start", "done"])
})
