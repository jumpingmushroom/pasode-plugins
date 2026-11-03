// Media player for pasode's sidebar: what your browser or music app is playing, with cover, progress and controls.
// It reads and controls players through Linux's media controls (MPRIS) with `playerctl`, so it works with Zen,
// Firefox, Chrome, Spotify, mpv and anything else that shows up in `playerctl -l`.
//
// The section sits at the bottom of the sidebar, right above the "Paseo" line, and hides while nothing plays.
// ctrl+x f plays or pauses; the palette has "Next track" and "Previous track"; click ⏮ ▶ ⏭ or the bar to seek.
//
// Options (cli.json: ["~/pasode-plugins/plugins/media", { "keys": { "playPause": "<leader>f" } }]):
//   keys   { playPause, next, previous }: keybinds; next and previous have none by default.
//   cover  false hides the cover image (default true).
import type { MouseEvent, Renderable } from "@opentui/core"
import { execFile, spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { PasodePlugin } from "@pasode/host"
import { artSource, clock, filled, FORMAT, seekSeconds, sourceLabel, type Track } from "./model"
import { createPlayers } from "./players"

/** How often the list of players is refreshed, to drop ones that closed. */
const PRUNE_MS = 15_000
/** Wait before restarting playerctl after it exits. */
const RESTART_MS = 5_000

export default {
  id: "media",
  setup(ctx) {
    const { theme } = ctx
    const raw = (ctx.options.keys ?? {}) as Record<string, unknown>
    const key = (name: string, fallback?: string) => (typeof raw[name] === "string" ? (raw[name] as string) : fallback)
    const showCover = ctx.options.cover !== false

    const players = createPlayers()
    const [version, setVersion] = createSignal(0)
    const bump = () => setVersion((v) => v + 1)
    const current = createMemo((): Track | undefined => (version(), players.current()))

    let child: ChildProcess | undefined
    let stopped = false
    let missing = false

    function prune() {
      execFile("playerctl", ["-l"], (error, stdout) => {
        // No players at all makes playerctl -l exit non-zero with "No players found".
        players.keep(error ? [] : stdout.split("\n").map((s) => s.trim()).filter(Boolean))
        bump()
      })
    }

    function follow() {
      if (stopped || missing) return
      const proc = spawn("playerctl", ["-a", "-F", "metadata", "--format", FORMAT], { stdio: ["ignore", "pipe", "ignore"] })
      child = proc
      proc.on("error", (error: NodeJS.ErrnoException) => {
        // Without playerctl the section just never shows; say why once.
        if (error.code === "ENOENT") {
          missing = true
          ctx.ui.toast("The media plugin needs playerctl. Install it, then restart pasode.", "warning")
        }
      })
      createInterface({ input: proc.stdout! }).on("line", (line) => {
        // playerctl prints an empty line when a player goes away.
        if (players.apply(line)) bump()
        else if (!line.trim()) prune()
      })
      proc.on("exit", () => {
        child = undefined
        if (!stopped && !missing) setTimeout(follow, RESTART_MS)
      })
    }

    follow()
    const pruner = setInterval(prune, PRUNE_MS)
    onCleanup(() => {
      stopped = true
      clearInterval(pruner)
      child?.kill()
    })

    function control(...args: string[]) {
      const track = current()
      if (!track) return ctx.ui.toast("Nothing is playing", "info")
      execFile("playerctl", ["-p", track.player, ...args], (error) => error && ctx.state.showError(`playerctl ${args[0]} failed: ${error.message}`))
    }
    const playPause = () => control("play-pause")
    const next = () => control("next")
    const previous = () => control("previous")

    function Button(props: { glyph: string; accent?: boolean; onPress: () => void }) {
      return (
        <box width={3} flexShrink={0} alignItems="center" onMouseUp={props.onPress}>
          <text fg={props.accent ? theme.primary : theme.text}>{props.glyph}</text>
        </box>
      )
    }

    function Media() {
      const [width, setWidth] = createSignal(0)
      const [coverFailed, setCoverFailed] = createSignal<string>()
      let bar: Renderable | undefined
      const cover = () => {
        const source = showCover ? artSource(current()?.art) : undefined
        return source && source !== coverFailed() ? source : undefined
      }
      const played = () => filled(width(), current()?.position ?? 0, current()?.length)
      function seek(event: MouseEvent) {
        const track = current()
        const seconds = bar && seekSeconds(event.x - bar.screenX, width(), track?.length)
        if (track && seconds !== undefined) control("position", String(seconds))
      }
      return (
        <Show when={current()}>
          {(track) => (
            <box flexDirection="column" flexShrink={0} onSizeChange={function () { setWidth(this.width) }}>
              <text wrapMode="none" truncate>
                <b>Now playing</b>
                <span style={{ fg: theme.textMuted }}> · {sourceLabel(track())}</span>
              </text>
              <box flexDirection="row" gap={1} height={cover() ? 3 : undefined}>
                <Show when={cover()}>
                  {(source) => (
                    <box width={8} height={3} flexShrink={0}>
                      <image source={source()} fit="cover" protocol="auto" width="100%" height="100%" onError={() => setCoverFailed(source())} />
                    </box>
                  )}
                </Show>
                <box flexDirection="column" flexGrow={1} minWidth={0}>
                  <text wrapMode="none" truncate>{track().title || "Untitled"}</text>
                  <Show when={track().artist}>
                    <text fg={theme.textMuted} wrapMode="none" truncate>{track().artist}</text>
                  </Show>
                </box>
              </box>
              <text ref={(r: Renderable) => (bar = r)} wrapMode="none" onMouseUp={seek}>
                <span style={{ fg: theme.primary }}>{"━".repeat(played())}</span>
                <span style={{ fg: theme.textMuted }}>{"━".repeat(Math.max(0, width() - played()))}</span>
              </text>
              <box flexDirection="row">
                <text fg={theme.textMuted} flexShrink={0}>{clock(track().position)}</text>
                <box flexGrow={1} />
                <Button glyph="⏮" onPress={previous} />
                <Button glyph={track().status === "Playing" ? "⏸" : "▶"} accent onPress={playPause} />
                <Button glyph="⏭" onPress={next} />
                <box flexGrow={1} />
                <text fg={theme.textMuted} flexShrink={0}>{track().length ? clock(track().length!) : "live"}</text>
              </box>
            </box>
          )}
        </Show>
      )
    }

    /** pasode's own footer line (src/sidebar/footer/tui.tsx): the daemon's version and connection status. */
    function PaseoLine() {
      const { daemon } = ctx.paseo
      const [status, setStatus] = createSignal(daemon.getConnectionState().status)
      const [version, setVersion] = createSignal(daemon.getLastServerInfoMessage()?.version)
      onCleanup(
        daemon.subscribeConnectionStatus((state) => {
          setStatus(state.status)
          setVersion(daemon.getLastServerInfoMessage()?.version)
        }),
      )
      onCleanup(
        daemon.on((event) => {
          if (event.type === "status" && event.payload.status === "server_info") setVersion(daemon.getLastServerInfoMessage()?.version)
        }),
      )
      return (
        <text fg={theme.textMuted}>
          <span style={{ fg: status() === "connected" ? theme.success : theme.textMuted }}>•</span> <span style={{ fg: theme.text }}><b>Paseo</b></span> {version() ?? "—"} {status()}
        </text>
      )
    }

    // The footer slot shows only the highest-order plugin, which would hide pasode's own footer line (order 100),
    // so the player outranks it and draws that line again below itself.
    onCleanup(
      ctx.ui.slot(
        "sidebar_footer",
        () => (
          <box flexDirection="column" gap={1}>
            <Media />
            <PaseoLine />
          </box>
        ),
        101,
      ),
    )

    const has = () => !!current()
    ctx.commands.register([
      { id: "media.playPause", title: "Play / pause", category: "Media", keybind: key("playPause", "<leader>f"), enabled: has, run: playPause },
      { id: "media.next", title: "Next track", category: "Media", keybind: key("next"), enabled: has, run: next },
      { id: "media.previous", title: "Previous track", category: "Media", keybind: key("previous"), enabled: has, run: previous },
    ])
  },
} satisfies PasodePlugin
