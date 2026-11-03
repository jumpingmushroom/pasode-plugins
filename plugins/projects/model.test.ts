import { expect, test } from "bun:test"
import { ago, chatFooter, pinnedRows, inferRoot, insideProject, parseRepo, projectChats, projectRows, shortPath, validProjectName, type Project, cloneProtocol, clonePath } from "./model"

test("projectChats lists every workspace: live, archived, and empty ones, newest first", () => {
  const chats = projectChats(
    "p1",
    [
      { id: "w1", projectId: "p1", title: "Old chat", lastUserMessageAt: "2026-10-01T00:00:00Z" },
      { id: "w2", projectId: "p1", title: null, name: "named", activityAt: "2026-10-05T00:00:00Z" },
      { id: "w3", projectId: "p1", title: "Archived chat", lastUserMessageAt: "2026-10-03T00:00:00Z" },
      { id: "w5", projectId: "p1", title: null, name: "shop", workspaceDirectory: "/w/shop", activityAt: "2026-09-01T00:00:00Z" },
      { id: "w4", projectId: "p2", title: "Other project" },
    ],
    [
      { id: "a1", workspaceId: "w1", status: "idle", updatedAt: "2026-10-01T00:00:00Z" },
      { id: "a2", workspaceId: "w2", status: "running", updatedAt: "2026-10-05T00:00:00Z" },
      { id: "a2-child", workspaceId: "w2", parentAgentId: "a2", status: "running", updatedAt: "2026-10-06T00:00:00Z" },
      { id: "a3", workspaceId: "w3", status: "closed", archivedAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z" },
      { id: "a4", workspaceId: "w4", status: "idle" },
      // An older archived session in w1 never beats the live one.
      { id: "a1-old", workspaceId: "w1", status: "closed", archivedAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z" },
    ],
  )
  expect(chats).toEqual([
    { agentId: "a2", title: "named", state: "running", at: "2026-10-05T00:00:00Z" },
    { agentId: "a3", title: "Archived chat", state: "archived", at: "2026-10-03T00:00:00Z" },
    { agentId: "a1", title: "Old chat", state: "idle", at: "2026-10-01T00:00:00Z" },
    { directory: "/w/shop", title: "shop", state: "empty", at: "2026-09-01T00:00:00Z" },
  ])
})

test("needs input wins over idle, and an empty workspace without a directory falls back to the project root", () => {
  const chats = projectChats("p", [{ id: "w1", projectId: "p" }, { id: "w2", projectId: "p", name: "default" }],
    [{ id: "a", workspaceId: "w1", status: "idle", pendingPermissions: [{}] }], "/w/p")
  expect(chats.map((c) => [c.state, c.agentId ?? c.directory])).toEqual([["needs input", "a"], ["empty", "/w/p"]])
})

test("chatFooter shows live state, archive age, or no messages", () => {
  const now = Date.parse("2026-11-02T12:00:00Z")
  expect(chatFooter({ agentId: "a", title: "t", state: "running" }, now)).toBe("running")
  expect(chatFooter({ agentId: "a", title: "t", state: "archived", at: "2026-11-01T15:00:00Z" }, now)).toBe("archived · 21h ago")
  expect(chatFooter({ directory: "/w", title: "t", state: "empty" }, now)).toBe("no messages")
  expect(chatFooter({ agentId: "a", title: "t", state: "idle", at: "2026-11-02T11:00:00Z" }, now)).toBe("1h ago")
})

test("insideProject matches roots and subfolders, not name prefixes", () => {
  const roots = ["/srv/projects/webapp", "/srv/projects/games/mods/"]
  expect(insideProject("/srv/projects/webapp", roots)).toBe(true)
  expect(insideProject("/srv/projects/webapp/src/", roots)).toBe(true)
  expect(insideProject("/srv/projects/games/mods/shader", roots)).toBe(true)
  expect(insideProject("/srv/projects/webappOld", roots)).toBe(false)
  expect(insideProject("/home/me", roots)).toBe(false)
  expect(insideProject("/home/me", [])).toBe(false)
})

const p = (id: string, root: string, extra: Partial<Project> = {}): Project => ({
  projectId: id, projectDisplayName: root.split("/").pop()!, projectRootPath: root, projectKind: "git", ...extra,
})

test("rows sort by latest activity, count chats, prefer custom names", () => {
  const rows = projectRows(
    [p("a", "/w/alpha"), p("b", "/w/beta", { projectCustomName: "Beta!" }), p("c", "/w/gamma", { projectKind: "directory" })],
    [
      { projectId: "a", activityAt: "2026-10-01T00:00:00Z" },
      { projectId: "b", activityAt: "2026-10-05T00:00:00Z" },
      { projectId: "b", lastUserMessageAt: "2026-10-06T00:00:00Z" },
    ],
  )
  expect(rows.map((r) => r.name)).toEqual(["Beta!", "alpha", "gamma"])
  expect(rows[0]).toMatchObject({ chats: 2, lastActive: "2026-10-06T00:00:00Z", git: true })
  expect(rows[2]).toMatchObject({ chats: 0, lastActive: undefined, git: false })
})

test("inferRoot picks the most common parent", () => {
  expect(inferRoot([p("a", "/srv/projects/x"), p("b", "/srv/projects/y"), p("c", "/srv/projects/games/z")]))
    .toBe("/srv/projects")
  expect(inferRoot([])).toBeUndefined()
})

test("shortPath strips the projects root only when inside it", () => {
  expect(shortPath("/w/games/z", "/w")).toBe("games/z")
  expect(shortPath("/other/z", "/w")).toBe("/other/z")
  expect(shortPath("/w", "/w")).toBe("/w")
})

test("ago formats minutes, hours, days, then a date", () => {
  const now = Date.parse("2026-11-02T12:00:00Z")
  expect(ago(undefined, now)).toBe("no chats")
  expect(ago("2026-11-02T11:55:00Z", now)).toBe("5m ago")
  expect(ago("2026-11-02T06:00:00Z", now)).toBe("6h ago")
  expect(ago("2026-10-28T12:00:00Z", now)).toBe("5d ago")
  expect(ago("2026-01-01T00:00:00Z", now)).toBe("2026-01-01")
})

test("validProjectName rejects paths and dotfiles", () => {
  expect(validProjectName("api-server")).toBe(true)
  expect(validProjectName("my-app_2.0")).toBe(true)
  for (const bad of ["", ".hidden", "a/b", "..", "has space", "x".repeat(101)]) expect(validProjectName(bad)).toBe(false)
})

test("parseRepo accepts common GitHub spellings", () => {
  for (const input of ["octocat/Hello-World", "github.com/octocat/Hello-World", "https://github.com/octocat/Hello-World.git", "git@github.com:octocat/Hello-World.git", " octocat/Hello-World/ "]) {
    expect(parseRepo(input)).toBe("octocat/Hello-World")
  }
  expect(parseRepo("not a repo")).toBeUndefined()
  expect(parseRepo("https://gitlab.com/a/b")).toBeUndefined()
})

test("a labelled child agent is never a workspace's chat, even when it's newer", () => {
  const chats = projectChats("p", [{ id: "w", projectId: "p", title: "Main" }], [
    { id: "main", workspaceId: "w", status: "idle", updatedAt: "2026-10-01T00:00:00Z" },
    { id: "child", workspaceId: "w", status: "running", updatedAt: "2026-10-09T00:00:00Z", labels: { "paseo.parent-agent-id": "main" } },
  ])
  expect(chats.map((c) => c.agentId)).toEqual(["main"])
})

test("pinned rows: running, then waiting, then most recent; footer is project and state", () => {
  const now = Date.parse("2026-11-02T12:00:00Z")
  const base = { running: false, waiting: false, needsInput: false }
  const rows = pinnedRows([
    { ...base, id: "old", title: "Build api-server", cwd: "/w/api-server", updatedAt: "2026-10-26T12:00:00Z" },
    { ...base, id: "recent", title: "Speaker music", cwd: "/w/speaker/", updatedAt: "2026-11-02T09:00:00Z" },
    { ...base, id: "run", title: "Webapp release", cwd: "/w/webapp", updatedAt: "2026-10-01T00:00:00Z", running: true },
    { ...base, id: "wait", title: "", cwd: "/w/gallery", updatedAt: "2026-10-01T00:00:00Z", waiting: true },
    { ...base, id: "ask", title: "Shop sales", cwd: "/w/shop", updatedAt: "2026-11-02T11:00:00Z", needsInput: true },
  ], now)
  expect(rows).toEqual([
    { id: "run", title: "Webapp release", footer: "webapp · running" },
    { id: "wait", title: "Untitled", footer: "gallery · waiting" },
    { id: "ask", title: "Shop sales", footer: "shop · needs input" },
    { id: "recent", title: "Speaker music", footer: "speaker · 3h ago" },
    { id: "old", title: "Build api-server", footer: "api-server · 7d ago" },
  ])
})

test("cloneProtocol: ssh for git@ and ssh:// input, else the option, else https", () => {
  expect(cloneProtocol("git@github.com:owner/repo.git")).toBe("ssh")
  expect(cloneProtocol("ssh://git@github.com/owner/repo")).toBe("ssh")
  expect(cloneProtocol("https://github.com/owner/repo")).toBe("https")
  expect(cloneProtocol("owner/repo")).toBe("https")
  expect(cloneProtocol("owner/repo", "ssh")).toBe("ssh")
  expect(cloneProtocol("https://github.com/owner/repo", "ssh")).toBe("https")
  expect(cloneProtocol("owner/repo", "ftp")).toBe("https")
})

test("clonePath: the repository's own folder inside the projects root", () => {
  expect(clonePath("/srv/projects", "owner/repo")).toBe("/srv/projects/repo")
  expect(clonePath("/srv/projects/", "owner/my.repo")).toBe("/srv/projects/my.repo")
})
