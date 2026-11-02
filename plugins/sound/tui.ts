// Audible alerts for pasode: when a chat you have open as a tab finishes, fails, asks a question
// (or a plan to approve), or waits for a permission, play that kind's sound (pw-play, falling back to paplay) and, while the terminal is in the background, ring the
// terminal bell so the window manager marks the window urgent (kitty: window_alert_on_bell; the tab shows its bell).
// Events are the daemon's attention events, heard whichever client the daemon picks to notify. Chats that aren't
// tabs (scheduled watcher runs, chats only opened on the desktop or phone) stay quiet, as does the chat on screen
// while the terminal has focus.
//
// Commands: /mute, /unmute (remembered), /sound-test (plays each kind in turn).
// Options (cli.json: ["~/pasode-plugins/plugins/sound", { ... }]):
//   sounds   per-kind files, e.g. { "finished": "/path/ding.oga" }; kinds: finished, question, permission, error.
//            Defaults are freedesktop theme sounds.
//   reasons  which kinds sound, default all four.
//   volume   0–1 (pw-play and afplay; default: full).
//   player   players to try in order, e.g. ["pw-play", "paplay"] (Linux default) or ["afplay"] (macOS default).
//   bell     false: no terminal bell (default true). Linux only: elsewhere pasode draws on another thread.
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync, writeSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { PasodePlugin } from "@pasode/host"
import { createGate, KINDS, kindOf, platformDefaults, playerArgs, tabsFrom, volumeArg, wants, type Kind, type Reason } from "./model"

const stateDir = path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "pasode")
const kvFile = path.join(stateDir, "kv.json") // pasode writes its open tabs here on every change
const muteFile = path.join(stateDir, "sound.json")

const readText = (file: string) => { try { return readFileSync(file, "utf8") } catch { return undefined } }

export default {
  id: "sound",
  setup(ctx) {
    const { daemon } = ctx.paseo
    const options = ctx.options as { sounds?: Partial<Record<Kind, string>>; reasons?: string[]; volume?: number; bell?: boolean; player?: string[] | string }
    const defaults = platformDefaults(process.platform)
    const sounds = { ...defaults.sounds, ...(options.sounds ?? {}) }
    const players = typeof options.player === "string" ? [options.player] : Array.isArray(options.player) && options.player.length ? options.player : defaults.players
    const enabled = new Set<Kind>(Array.isArray(options.reasons) ? KINDS.filter((k) => options.reasons!.includes(k)) : KINDS)
    const volume = volumeArg(options.volume)
    const gate = createGate()

    let muted = (() => { try { return JSON.parse(readText(muteFile) ?? "{}").muted === true } catch { return false } })()
    const setMuted = (value: boolean) => {
      if (muted === value) return ctx.ui.toast(muted ? "Sounds are already muted" : "Sounds are already on", "info")
      muted = value
      try { mkdirSync(stateDir, { recursive: true }); writeFileSync(muteFile, JSON.stringify({ muted })) } catch {}
      ctx.ui.toast(muted ? "Sounds muted (/unmute)" : "Sounds on", "info")
    }

    // The app tracks focus the same way; a terminal that never reports focus counts as focused.
    let focused = true
    const onFocus = () => { focused = true }
    const onBlur = () => { focused = false }
    ctx.renderer.on("focus", onFocus)
    ctx.renderer.on("blur", onBlur)

    function play(file: string, index = 0) {
      const player = players[index]
      if (!player) return
      const child = spawn(player, playerArgs(player, file, volume), { stdio: "ignore" })
      child.on("error", () => play(file, index + 1)) // not installed: try the next player
      child.unref()
    }

    function bell() {
      // On Linux OpenTUI renders on this thread, so a synchronous one-byte write can't land inside a frame.
      if (options.bell === false || focused || ctx.renderer.isDestroyed || process.platform !== "linux") return
      try { writeSync(1, "\x07") } catch {}
    }

    const events = daemon.observeEvents(["agent_attention_required"], { notifications: true })
    events.ready.catch(() => {})
    /** What a chat waits for: its pending requests' kinds (question, plan, tool, mode, other). */
    const pendingKinds = (agentId: string) =>
      ((ctx.paseo.agents[agentId]?.pendingPermissions ?? []) as { kind?: string }[]).map((request) => request.kind ?? "")

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const off = daemon.onAgentAttentionRequired(async (event) => {
      const reason = event.reason as Reason
      // The agent update carrying the request can land just after the attention event: wait briefly for it.
      let kinds = pendingKinds(event.agentId)
      if (reason === "permission" && !kinds.length) {
        await sleep(400)
        kinds = pendingKinds(event.agentId)
      }
      const kind = kindOf(reason, kinds)
      const situation = { agentId: event.agentId, kind, tabs: tabsFrom(readText(kvFile)), currentId: ctx.paseo.agentId(), focused, muted, enabled }
      if (!wants(situation)) return
      // Deduped on the daemon's reason, not the kind: the two copies of an event may see different request details.
      const verdict = gate.check(event.agentId, reason, Date.now())
      if (verdict === "duplicate") return
      if (verdict === "sound") play(sounds[kind])
      bell()
    })

    async function testSounds() {
      const labels: Record<Kind, string> = { finished: "Finished", question: "Question / plan", permission: "Permission", error: "Error" }
      for (const kind of KINDS) {
        ctx.ui.toast(`${labels[kind]}${enabled.has(kind) ? "" : " (turned off in options)"}`, "info", "Sound test")
        play(sounds[kind])
        await sleep(1600)
      }
    }

    // Plugins have no unload hook yet (the host keeps them for the session), so this runs only if one is added.
    const dispose = () => {
      off()
      void events.release().catch(() => {})
      ctx.renderer.off("focus", onFocus)
      ctx.renderer.off("blur", onBlur)
    }
    ctx.renderer.once("destroy", dispose)

    ctx.commands.register([
      // Always enabled: pasode doesn't re-check enabled() after a plain variable changes, and a disabled slash
      // command typed in a chat is sent to the agent as a message.
      { id: "sound.mute", title: "Mute sounds", category: "System", slash: "mute", run: () => setMuted(true) },
      { id: "sound.unmute", title: "Unmute sounds", category: "System", slash: "unmute", run: () => setMuted(false) },
      { id: "sound.test", title: "Test the alert sounds", category: "System", slash: "sound-test", run: () => void testSounds() },
    ])
  },
} satisfies PasodePlugin
