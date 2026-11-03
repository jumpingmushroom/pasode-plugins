// Pure helpers for the notes plugin: no Trilium, no daemon, no UI, so `bun test` covers them.

export type NotesOptions = {
  projects?: string
  folder: string
  noteLabel: string
  doneLabel: string
  pathLabel: string
  createProjects: boolean
  url?: string
  token?: string
  keys: { list: string; add: string }
}

const str = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback)

/** Plugin options from cli.json, with the ETAPI URL and token from the environment. */
export function readOptions(raw: Record<string, unknown>, env: Record<string, string | undefined>): NotesOptions {
  const keys = (raw.keys && typeof raw.keys === "object" ? raw.keys : {}) as Record<string, unknown>
  const url = typeof raw.url === "string" ? raw.url : env.TRILIUM_URL
  return {
    projects: typeof raw.projects === "string" && raw.projects.trim() ? raw.projects.trim() : undefined,
    folder: str(raw.folder, "Notes"),
    noteLabel: str(raw.noteLabel, "pasodeNote"),
    doneLabel: str(raw.doneLabel, "done"),
    pathLabel: str(raw.pathLabel, "paseoPath"),
    createProjects: typeof raw.createProjects === "boolean" ? raw.createProjects : true,
    url: url ? url.replace(/\/+$/, "") : undefined,
    token: env[str(raw.tokenEnv, "TRILIUM_TOKEN")] || undefined,
    keys: { list: str(keys.list, "<leader>a"), add: str(keys.add, "<leader>k") },
  }
}

// ── Editor file: line 1 is the title, the rest is the prompt ──

export function parseEditorText(text: string): { title: string; body: string } | undefined {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const at = lines.findIndex((line) => line.trim() !== "")
  if (at < 0) return undefined
  const body = lines
    .slice(at + 1)
    .join("\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd()
  return { title: (lines[at] ?? "").trim(), body }
}

export function formatEditorText(note: { title: string; body: string }) {
  return note.body ? `${note.title}\n\n${note.body}\n` : `${note.title}\n`
}

// ── Trilium HTML ⇄ plain text ──

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

function decodeEntities(value: string) {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      return ENTITIES[name.toLowerCase()] ?? whole
    })
    .replace(/ /g, " ")
}

/** Paragraphs (single newlines as <br>) and fenced code blocks, the shape Trilium's editor stores. */
export function textToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const out: string[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(escapeHtml).join("<br>")}</p>`)
    paragraph = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""
    const fence = /^```\s*([\w+#.-]*)\s*$/.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) code.push(lines[i] ?? "")
      const lang = fence[1] ? ` class="language-${fence[1]}"` : ""
      out.push(`<pre><code${lang}>${escapeHtml(code.join("\n"))}</code></pre>`)
    } else if (line.trim() === "") flush()
    else paragraph.push(line)
  }
  flush()
  return out.join("")
}

const stripTags = (value: string) => value.replace(/<[^>]*>/g, "")

/** Readable prompt text from a Trilium text note, including notes written in its web editor. */
export function htmlToText(html: string): string {
  const code: string[] = []
  let text = html.replace(/<pre[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, attrs: string, body: string) => {
    const lang = /language-([\w+#.-]+)/.exec(attrs)?.[1] ?? ""
    code.push("```" + lang + "\n" + decodeEntities(stripTags(body.replace(/<br\s*\/?>/gi, "\n"))).replace(/\n$/, "") + "\n```")
    return `\n\n\u0000${code.length - 1}\u0000\n\n`
  })
  text = text
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${stripTags(inner).trim()}\n\n`)
    .replace(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi, (_, kind: string, inner: string) => {
      const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m, i) => `${kind.toLowerCase() === "ol" ? `${i + 1}.` : "-"} ${stripTags((m[1] ?? "").replace(/<br\s*\/?>/gi, " ")).trim()}`)
      return `\n\n${items.join("\n")}\n\n`
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|blockquote)>/gi, "\n\n")
  text = decodeEntities(stripTags(text))
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text.replace(/\u0000(\d+)\u0000/g, (_, i: string) => code[Number(i)] ?? "")
}

// ── Projects ──

export type Candidate = { noteId: string; title: string; labels: Record<string, string> }
export type DaemonProject = { root: string; name: string }

const loose = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, "")

/** The project's Trilium note: by its path label, else one unambiguous title match; otherwise the user picks. */
export function matchProject(project: DaemonProject, candidates: Candidate[], pathLabel: string): { noteId: string } | { choices: Candidate[] } {
  const labelled = candidates.find((c) => c.labels[pathLabel] === project.root)
  if (labelled) return { noteId: labelled.noteId }
  const names = new Set([loose(project.name), loose(project.root.replace(/\/+$/, "").split("/").pop() ?? "")].filter(Boolean))
  const matches = candidates.filter((c) => names.has(loose(c.title)))
  const [only] = matches
  if (only && matches.length === 1) return { noteId: only.noteId }
  return { choices: [...matches, ...candidates.filter((c) => !matches.includes(c))] }
}

// ── List rows ──

export type NoteItem = { noteId: string; title: string; body: string; created: string }

export function ago(iso: string | undefined, now = Date.now()) {
  if (!iso) return ""
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 60 ? `${days}d ago` : new Date(iso).toISOString().slice(0, 10)
}

export function noteRows(notes: NoteItem[], now = Date.now()) {
  return notes
    .toSorted((a, b) => b.created.localeCompare(a.created))
    .map((note) => ({
      noteId: note.noteId,
      title: note.title,
      description: note.body.split("\n").find((line) => line.trim() !== "")?.trim() ?? "",
      footer: ago(note.created, now),
    }))
}

/** The note in Trilium's web app: the ETAPI URL without its /etapi suffix. */
export function webUrl(etapiUrl: string, noteId: string) {
  return `${etapiUrl.replace(/\/+$/, "").replace(/\/etapi$/, "")}/#root/${noteId}`
}
