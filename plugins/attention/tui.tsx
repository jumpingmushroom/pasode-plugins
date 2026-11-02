// "Needs you" line for pasode: one line under the usage bar, shown only when another chat needs you or waits on an
// automatic resume, e.g.
//   ⚠ 3 need you  shader error · home-monitor finished +1    ⏸ webapp resumes 14:00    ⚙ 3 subagents  webapp 2 · shader 1    ctrl+x j
// Subagents: running Paseo child agents and provider subagents (Claude Task/Agent calls) across all chats.
// Needs you: the daemon's own attention flags (finished, error, waiting for permission) on every live chat except
// the one on screen; opening a chat clears its flag, as in the Paseo apps. Resumes: the Paseo plugin
// "usage-auto-resume" (RPC auto-resume.list), every 30 s; that part is hidden when the plugin isn't installed.
//
// Commands: ctrl+x j (/next-attention) opens the most urgent chat; /dismiss-all clears every flag, after a confirm
// (flags are shared, so that clears them in the desktop and phone apps too).
//
// Options (cli.json: ["~/pasode-plugins/plugins/attention", { ... }]):
//   session  show in chats (default true).   home  short form in the home screen's bottom row (default true).
//   names    chats named before "+N" (default 2).
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { PasodePlugin } from "@pasode/host"
import { attentionItems, parentOf, resumeItems, runningSubagents, subagentSummary, summary, worst, type AttentionAgent, type ResumeJob } from "./model"

const RESUME_POLL_MS = 30_000
/** Provider subagents come as pushed updates; a periodic re-list of running chats catches anything missed. */
const SUBAGENT_RELIST_MS = 60_000

export default {
  id: "attention",
  setup(ctx) {
    const names = typeof ctx.options.names === "number" ? Math.max(0, ctx.options.names) : 2
    const [jobs, setJobs] = createSignal<ResumeJob[]>([])
    const [now, setNow] = createSignal(Date.now())

    const readJobs = async () => {
      setNow(Date.now())
      const result = await ctx.paseo.daemon.invokePluginRpc("usage-auto-resume", "auto-resume.list", {}).catch(() => undefined) as { jobs?: ResumeJob[] } | undefined
      setJobs(Array.isArray(result?.jobs) ? result.jobs : [])
    }
    void readJobs()
    const poll = setInterval(readJobs, RESUME_POLL_MS)
    onCleanup(() => clearInterval(poll))

    // The live agent store updates as the daemon reports changes, so this follows flags as they're raised and cleared.
    const items = createMemo(() => attentionItems(Object.values(ctx.paseo.agents) as AttentionAgent[], ctx.paseo.agentId()))
    const resumes = createMemo(() => resumeItems(jobs().filter((job) => job.agentId !== ctx.paseo.agentId()), now()))

    // Provider subagents (Claude Task/Agent calls, Codex child threads) of every chat: parent → subagent → status.
    const [native, setNative] = createSignal<ReadonlyMap<string, ReadonlyMap<string, string>>>(new Map())
    const putList = (parentId: string, list: { id: string; status: string }[]) =>
      setNative((current) => new Map(current).set(parentId, new Map(list.map((item) => [item.id, item.status]))))
    const relist = async () => {
      const running = (Object.values(ctx.paseo.agents) as AttentionAgent[]).filter((agent) => agent.status === "running" && !parentOf(agent))
      for (const agent of running) {
        const result = await ctx.paseo.daemon.listProviderSubagents(agent.id).catch(() => undefined)
        if (result) putList(agent.id, result.subagents as { id: string; status: string }[])
      }
    }
    const feed = ctx.paseo.daemon.observeEvents(["agent.provider_subagents.update"])
    feed.subscribe({
      snapshot: () => void relist(), // updates aren't replayed across a reconnect
      update(message: any) {
        if (message.type !== "agent.provider_subagents.update") return
        const update = message.payload
        if (update.kind === "timeline") return
        const parentId = update.kind === "upsert" ? update.subagent.parentAgentId : update.parentAgentId
        setNative((current) => {
          const next = new Map(current)
          const list = new Map(next.get(parentId) ?? [])
          if (update.kind === "remove") list.delete(update.subagentId)
          else list.set(update.subagent.id, update.subagent.status)
          return next.set(parentId, list)
        })
      },
    })
    void relist()
    const relistTimer = setInterval(() => void relist(), SUBAGENT_RELIST_MS)
    onCleanup(() => clearInterval(relistTimer))
    const subagents = createMemo(() => runningSubagents(Object.values(ctx.paseo.agents) as AttentionAgent[], native()))
    const subagentTotal = () => subagents().reduce((sum, group) => sum + group.count, 0)
    const anything = () => items().length || resumes().length || subagentTotal()

    const reasonColor = () => {
      const reason = worst(items())
      return reason === "needs input" ? ctx.theme.warning : reason === "error" ? ctx.theme.error : ctx.theme.success
    }

    function Line() {
      return (
        <Show when={anything()}>
          <box flexDirection="row" flexShrink={0} gap={4}>
            <Show when={items().length}>
              <text fg={ctx.theme.textMuted} wrapMode="none">
                <span style={{ fg: reasonColor() }}><b>⚠ {items().length} need{items().length === 1 ? "s" : ""} you</b></span>
                {names > 0 ? `  ${summary(items(), names)}` : ""}
              </text>
            </Show>
            <Show when={resumes().length}>
              <text fg={ctx.theme.textMuted} wrapMode="none">
                <span style={{ fg: ctx.theme.info }}>⏸</span> {resumes()[0]!.name} {resumes()[0]!.label}
                {resumes().length > 1 ? ` +${resumes().length - 1}` : ""}
              </text>
            </Show>
            <Show when={subagentTotal()}>
              <text fg={ctx.theme.textMuted} wrapMode="none">
                <span style={{ fg: ctx.theme.accent }}>⚙</span> {subagentSummary(subagents(), names)}
              </text>
            </Show>
            <Show when={items().length}>
              <text fg={ctx.theme.textMuted} wrapMode="none">{"ctrl+x j"}</text>
            </Show>
          </box>
        </Show>
      )
    }

    // Home's bottom row is shared with MCP status, usage and the version: counts only.
    function Short() {
      return (
        <Show when={anything()}>
          <text fg={ctx.theme.textMuted} wrapMode="none">
            {[
              items().length ? <span style={{ fg: reasonColor() }}>⚠ {items().length}</span> : null,
              resumes().length ? <span style={{ fg: ctx.theme.info }}>⏸ {resumes().length}</span> : null,
              subagentTotal() ? <span style={{ fg: ctx.theme.accent }}>⚙ {subagentTotal()}</span> : null,
            ].filter(Boolean).flatMap((part, index) => (index ? ["  ", part] : [part]))}
          </text>
        </Show>
      )
    }

    if (ctx.options.session !== false) {
      onCleanup(ctx.ui.slot("session_header", () => (
        <Show when={anything()}>
          <box flexShrink={0} paddingLeft={1} paddingBottom={1}><Line /></box>
        </Show>
      ), 200))
    }
    if (ctx.options.home !== false) onCleanup(ctx.ui.slot("home_bottom", () => <Short />, 200))

    function next() {
      const target = items()[0] ?? resumes()[0]
      if (!target) return ctx.ui.toast("Nothing needs you", "info")
      ctx.paseo.navigate(target.id)
    }

    async function dismissAll() {
      const ids = items().map((item) => item.id)
      if (!ids.length) return ctx.ui.toast("Nothing to dismiss", "info")
      const ok = await ctx.ui.dialog.confirm(
        "Dismiss all",
        `Clear the "needs you" flag on ${ids.length} chat${ids.length === 1 ? "" : "s"}? Flags are shared, so this clears them in the Paseo desktop and phone apps too. Chats waiting for permission keep waiting.`,
        "Dismiss",
      )
      if (!ok) return
      try {
        await ctx.paseo.daemon.clearAgentAttention(ids)
        ctx.ui.toast(`Dismissed ${ids.length}`, "success")
      } catch (error) {
        ctx.state.showError(error)
      }
    }

    ctx.commands.register([
      { id: "attention.next", title: "Next chat that needs you", category: "Session", keybind: "<leader>j", slash: "next-attention", run: next },
      { id: "attention.dismiss", title: "Dismiss all \"needs you\" flags", category: "Session", slash: "dismiss-all", run: () => void dismissAll() },
    ])
  },
} satisfies PasodePlugin
