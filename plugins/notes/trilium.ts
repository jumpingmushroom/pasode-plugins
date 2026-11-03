// A small TriliumNext ETAPI client: only the calls the notes plugin needs. `fetch` is injectable for tests.

export type TNote = {
  noteId: string
  title: string
  type: string
  utcDateCreated: string
  childNoteIds: string[]
  attributes: { attributeId: string; type: "label" | "relation"; name: string; value: string }[]
}

export class EtapiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export type Trilium = {
  note(id: string): Promise<TNote>
  children(parentId: string, search?: string): Promise<TNote[]>
  content(id: string): Promise<string>
  setContent(id: string, html: string): Promise<void>
  create(parentId: string, title: string, html: string, labels?: Record<string, string>): Promise<TNote>
  rename(id: string, title: string): Promise<void>
  remove(id: string): Promise<void>
  addLabel(id: string, name: string, value?: string): Promise<void>
  /** A note ID, or a title path from the tree root such as "Work/Projects", to a note ID. */
  resolve(ref: string): Promise<string>
}

export const labelsOf = (note: TNote) => Object.fromEntries(note.attributes.filter((a) => a.type === "label").map((a) => [a.name, a.value]))

export const quote = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`

export function createTrilium(config: { url: string; token: string; fetch?: typeof fetch }): Trilium {
  const base = config.url.replace(/\/+$/, "")
  const doFetch = config.fetch ?? fetch

  async function call(method: string, path: string, body?: { json: unknown } | { text: string }): Promise<Response> {
    const headers: Record<string, string> = { Authorization: config.token }
    let payload: string | undefined
    if (body && "json" in body) {
      headers["Content-Type"] = "application/json"
      payload = JSON.stringify(body.json)
    } else if (body) {
      headers["Content-Type"] = "text/plain"
      payload = body.text
    }
    let response: Response
    try {
      response = await doFetch(`${base}${path}`, { method, headers, body: payload })
    } catch (error) {
      throw new Error(`Trilium unreachable at ${base}: ${error instanceof Error ? error.message : error}`)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      let detail = response.statusText || `HTTP ${response.status}`
      try {
        const parsed = JSON.parse(text)
        if (parsed?.code) detail = `${parsed.code}: ${parsed.message ?? ""}`.trim()
      } catch {}
      throw new EtapiError(response.status, `Trilium ${method} ${path.split("?")[0]} failed (${response.status}) ${detail}`)
    }
    return response
  }

  const children = async (parentId: string, search = "note.noteId != ''") => {
    const query = `search=${encodeURIComponent(search)}&ancestorNoteId=${encodeURIComponent(parentId)}&ancestorDepth=eq1`
    const result = (await (await call("GET", `/notes?${query}`)).json()) as { results?: TNote[] }
    return result.results ?? []
  }

  const note = async (id: string) => (await (await call("GET", `/notes/${encodeURIComponent(id)}`)).json()) as TNote

  async function addLabel(id: string, name: string, value = "") {
    await call("POST", "/attributes", { json: { noteId: id, type: "label", name, value } })
  }

  async function walk(path: string) {
    let id = "root"
    let parent = "the tree root"
    for (const segment of path.split("/").map((s) => s.trim()).filter(Boolean)) {
      const found = await children(id, `note.title = ${quote(segment)}`)
      if (!found[0]) throw new Error(`No Trilium note "${segment}" under "${parent}"`)
      id = found[0].noteId
      parent = segment
    }
    return id
  }

  return {
    note,
    children,
    async content(id) {
      return (await call("GET", `/notes/${encodeURIComponent(id)}/content`)).text()
    },
    async setContent(id, html) {
      await call("PUT", `/notes/${encodeURIComponent(id)}/content`, { text: html })
    },
    async create(parentId, title, html, labels = {}) {
      const result = (await (await call("POST", "/create-note", { json: { parentNoteId: parentId, title, type: "text", content: html } })).json()) as { note: TNote }
      for (const [name, value] of Object.entries(labels)) await addLabel(result.note.noteId, name, value)
      return result.note
    },
    async rename(id, title) {
      await call("PATCH", `/notes/${encodeURIComponent(id)}`, { json: { title } })
    },
    async remove(id) {
      await call("DELETE", `/notes/${encodeURIComponent(id)}`)
    },
    addLabel,
    async resolve(ref) {
      const value = ref.trim()
      if (!value.includes("/") && /^[A-Za-z0-9_]{4,}$/.test(value)) {
        try {
          return (await note(value)).noteId
        } catch (error) {
          if (!(error instanceof EtapiError && error.status === 404)) throw error
        }
      }
      return walk(value)
    },
  }
}
