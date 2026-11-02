// Claude usage bar for pasode: a one-line strip with the plan's 5-hour and weekly windows and, on the right, the
// daemon host's load, e.g.
//   Claude  5h ▉░░░░░░░░░ 9% · 2h48m   wk █▏░░░░░░░░ 11% · 2d14h          Unraid  cpu 12% · mem 25% · /config 83%
// shown at the top of every chat (under the tab bar) and in the home screen's bottom row.
// Usage: the daemon's usage reports (the same ones the usage-sidebar plugin reads), refreshed every 60 s.
// Host: the Paseo plugin "host-monitor" (RPC host.stats), every 5 s; hidden when that plugin isn't installed.
//
// Options (cli.json: ["~/pasode-plugins/plugins/usage-bar", { ... }]):
//   providers  which providers to show, in order; default ["claude"] (add "codex" for both).
//   session    show in chats (default true).   home  show on the home screen (default true).
//   barWidth   cells per bar on wide terminals (default 10); narrow terminals drop the bars, then the countdowns.
//   host       false hides the host part (default true).
//   hostDisks  mounts to show, e.g. ["/config"]; default: only the fullest disk.
//   hostLabel  name shown before the host stats; default "Unraid" on Unraid, else the daemon's hostname.
import { createSignal, For, onCleanup, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { PasodePlugin } from "@pasode/host"
import { bar, hostName, hostSegments, segments, type HostStats, type Level } from "./model"

const NAMES: Record<string, string> = { claude: "Claude", codex: "Codex" }
const HOST_POLL_MS = 5_000

export default {
  id: "usage-bar",
  setup(ctx) {
    const providers = Array.isArray(ctx.options.providers) ? (ctx.options.providers as string[]) : ["claude"]
    const barWidth = typeof ctx.options.barWidth === "number" ? Math.max(3, Math.min(30, ctx.options.barWidth)) : 10
    const hostDisks = Array.isArray(ctx.options.hostDisks) ? (ctx.options.hostDisks as string[]) : undefined
    const hostLabel = typeof ctx.options.hostLabel === "string" ? ctx.options.hostLabel : undefined
    const [now, setNow] = createSignal(Date.now())
    const [host, setHost] = createSignal<HostStats>()

    // One poll for both placements. A failed refresh keeps the last reports (the host marks them stale).
    let busy = false
    const refresh = async () => {
      setNow(Date.now())
      if (busy) return
      busy = true
      try { await ctx.paseo.refreshUsage() } catch {} finally { busy = false }
    }
    void refresh()
    const poll = setInterval(refresh, 60_000)
    const tick = setInterval(() => setNow(Date.now()), 30_000) // countdowns move between polls
    onCleanup(() => { clearInterval(poll); clearInterval(tick) })

    if (ctx.options.host !== false) {
      // Without host-monitor (or while the daemon restarts) the call fails and the host part stays hidden.
      const readHost = async () => {
        const stats = await ctx.paseo.daemon.invokePluginRpc("host-monitor", "host.stats", {}).catch(() => undefined) as HostStats | undefined
        setHost(stats?.current && Array.isArray(stats.disks) ? stats : undefined)
      }
      void readHost()
      const hostPoll = setInterval(readHost, HOST_POLL_MS)
      onCleanup(() => clearInterval(hostPoll))
    }

    const color = (level: Level, stale = false) =>
      stale ? ctx.theme.textMuted : level === "high" ? ctx.theme.error : level === "warn" ? ctx.theme.warning : ctx.theme.success

    function Host(props: { compact: boolean }) {
      return (
        <Show when={host()}>
          {(stats) => (
            <box flexDirection="row" flexShrink={0} gap={2}>
              <Show when={!props.compact}>
                <text fg={ctx.theme.text} wrapMode="none"><b>{hostLabel ?? hostName(stats())}</b></text>
              </Show>
              <text fg={ctx.theme.textMuted} wrapMode="none">
                <For each={hostSegments(stats(), hostDisks)}>
                  {(seg, index) => (
                    <>
                      {index() > 0 ? " · " : ""}{seg.label} <span style={{ fg: color(seg.level) }}>{Math.round(seg.percent)}%</span>
                    </>
                  )}
                </For>
              </text>
            </box>
          )}
        </Show>
      )
    }

    function Bar(props: { inSession: boolean }) {
      const dimensions = useTerminalDimensions()
      // Full: label, bar, percent, countdown. Medium: no bars. Narrow: percents only.
      const mode = () => (dimensions().width >= 100 ? "full" : dimensions().width >= 64 ? "compact" : "tiny")
      // The host part needs ~40 columns: wide chats get it on the right; the home row (shared with MCP and the
      // version) and narrower chats keep only usage.
      const showHost = () => props.inSession && dimensions().width >= 130
      return (
        <box flexDirection="row" flexShrink={0} gap={3} width={props.inSession ? "100%" : undefined}>
          <For each={providers}>
            {(provider) => {
              const list = () => segments(ctx.paseo.usage() as any, provider, now())
              return (
                <box flexDirection="row" flexShrink={0} gap={2}>
                  <text fg={ctx.theme.text} wrapMode="none"><b>{NAMES[provider] ?? provider}</b></text>
                  <Show when={list().length} fallback={<text fg={ctx.theme.textMuted} wrapMode="none">—</text>}>
                    <For each={list()}>
                      {(seg) => {
                        const fg = () => color(seg.level, seg.stale)
                        const cells = () => bar(seg.used, barWidth)
                        return (
                          <text fg={ctx.theme.textMuted} wrapMode="none">
                            {seg.label}{" "}
                            <Show when={mode() === "full"}>
                              <span style={{ fg: fg() }}>{cells().filled}</span>
                              <span style={{ fg: ctx.theme.border }}>{cells().empty}</span>{" "}
                            </Show>
                            <span style={{ fg: fg() }}>{Math.round(seg.used)}%</span>
                            <Show when={mode() !== "tiny" && seg.countdown}>{` · ${seg.countdown}`}</Show>
                          </text>
                        )
                      }}
                    </For>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={showHost()}>
            <box flexGrow={1} />
            <Host compact={false} />
          </Show>
        </box>
      )
    }

    if (ctx.options.session !== false) {
      onCleanup(ctx.ui.slot("session_header", () => (
        <box flexShrink={0} paddingLeft={1} paddingRight={2} paddingTop={1} paddingBottom={1}><Bar inSession /></box>
      ), 100))
    }
    if (ctx.options.home !== false) onCleanup(ctx.ui.slot("home_bottom", () => <Bar inSession={false} />, 100))
  },
} satisfies PasodePlugin
