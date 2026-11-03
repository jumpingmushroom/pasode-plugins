import { expect, test } from "bun:test"
import { createTrilium, EtapiError, labelsOf, type TNote } from "./trilium"

const URL = "https://n.example/etapi"

function fake(responses: (Response | Error)[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = []
  const fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body as string | undefined })
    const next = responses.shift()
    if (!next) throw new Error("no response queued")
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof globalThis.fetch
  return { calls, trilium: createTrilium({ url: URL, token: "tok", fetch }) }
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })
const note = (noteId: string, title = noteId, attributes: TNote["attributes"] = []): TNote => ({ noteId, title, type: "text", utcDateCreated: "2026-11-03 08:11:05.372Z", childNoteIds: [], attributes })

test("note sends GET with the token as Authorization", async () => {
  const { calls, trilium } = fake([json(note("abc"))])
  expect((await trilium.note("abc")).noteId).toBe("abc")
  expect(calls[0]).toMatchObject({ url: `${URL}/notes/abc`, method: "GET" })
  expect(calls[0]!.headers.Authorization).toBe("tok")
})

test("children searches direct children, with a default search", async () => {
  const { calls, trilium } = fake([json({ results: [note("a")] }), json({ results: [] })])
  expect((await trilium.children("p", "#!done")).map((n) => n.noteId)).toEqual(["a"])
  expect(calls[0]!.url).toBe(`${URL}/notes?search=%23!done&ancestorNoteId=p&ancestorDepth=eq1`)
  await trilium.children("p")
  expect(new globalThis.URL(calls[1]!.url).searchParams.get("search")).toBe("note.noteId != ''")
})

test("create posts the note, then one attribute per label", async () => {
  const { calls, trilium } = fake([json({ note: note("new", "T") }, 201), json({}, 201)])
  const created = await trilium.create("p", "T", "<p>x</p>", { pasodeNote: "" })
  expect(created.noteId).toBe("new")
  expect(calls[0]).toMatchObject({ url: `${URL}/create-note`, method: "POST" })
  expect(JSON.parse(calls[0]!.body!)).toEqual({ parentNoteId: "p", title: "T", type: "text", content: "<p>x</p>" })
  expect(calls[1]).toMatchObject({ url: `${URL}/attributes`, method: "POST" })
  expect(JSON.parse(calls[1]!.body!)).toEqual({ noteId: "new", type: "label", name: "pasodeNote", value: "" })
})

test("content, setContent, rename and remove use the matching endpoints", async () => {
  const { calls, trilium } = fake([new Response("<p>x</p>"), new Response(null, { status: 204 }), json(note("a")), new Response(null, { status: 204 })])
  expect(await trilium.content("a")).toBe("<p>x</p>")
  await trilium.setContent("a", "<p>y</p>")
  await trilium.rename("a", "New")
  await trilium.remove("a")
  expect(calls.map((c) => `${c.method} ${c.url.slice(URL.length)}`)).toEqual(["GET /notes/a/content", "PUT /notes/a/content", "PATCH /notes/a", "DELETE /notes/a"])
  expect(calls[1]!.body).toBe("<p>y</p>")
  expect(calls[1]!.headers["Content-Type"]).toBe("text/plain")
  expect(JSON.parse(calls[2]!.body!)).toEqual({ title: "New" })
})

test("a 401 becomes an EtapiError naming Trilium and the code", async () => {
  const { trilium } = fake([json({ status: 401, code: "NOT_AUTHENTICATED", message: "Not authenticated" }, 401)])
  const error = await trilium.note("a").catch((e) => e)
  expect(error).toBeInstanceOf(EtapiError)
  expect(error.status).toBe(401)
  expect(error.message).toContain("Trilium")
  expect(error.message).toContain("NOT_AUTHENTICATED")
})

test("a network failure names the Trilium URL", async () => {
  const { trilium } = fake([new TypeError("fetch failed")])
  await expect(trilium.note("a")).rejects.toThrow(`Trilium unreachable at ${URL}: fetch failed`)
})

test("resolve: an ID is checked with note()", async () => {
  const { calls, trilium } = fake([json(note("abcDEF123456"))])
  expect(await trilium.resolve("abcDEF123456")).toBe("abcDEF123456")
  expect(calls[0]!.url).toBe(`${URL}/notes/abcDEF123456`)
})

test("resolve: a title path walks from root, escaping quotes", async () => {
  const { calls, trilium } = fake([json({ results: [note("w", "Work")] }), json({ results: [note("p", "Bob's Projects")] })])
  expect(await trilium.resolve("Work/Bob's Projects")).toBe("p")
  const params = calls.map((c) => new globalThis.URL(c.url).searchParams)
  expect([params[0]!.get("ancestorNoteId"), params[0]!.get("search")]).toEqual(["root", "note.title = 'Work'"])
  expect([params[1]!.get("ancestorNoteId"), params[1]!.get("search")]).toEqual(["w", "note.title = 'Bob\\'s Projects'"])
})

test("resolve: a missing segment names it and its parent", async () => {
  const { trilium } = fake([json({ results: [note("w", "Work")] }), json({ results: [] })])
  await expect(trilium.resolve("Work/Projects")).rejects.toThrow('No Trilium note "Projects" under "Work"')
})

test("resolve: a one-word title that isn't an ID falls back to a path walk on 404", async () => {
  const { trilium } = fake([json({ status: 404, code: "NOTE_NOT_FOUND", message: "x" }, 404), json({ results: [note("pr", "Projects")] })])
  expect(await trilium.resolve("Projects")).toBe("pr")
})

test("labelsOf keeps labels only", () => {
  const n = note("a", "a", [
    { attributeId: "1", type: "label", name: "paseoPath", value: "/srv/projects/foo" },
    { attributeId: "2", type: "relation", name: "template", value: "x" },
  ])
  expect(labelsOf(n)).toEqual({ paseoPath: "/srv/projects/foo" })
})
