// Pure decisions for the sound plugin: which attention events make a sound, and which sound.

/** The daemon's attention reasons. */
export type Reason = "finished" | "error" | "permission"
/** What makes a sound: the reasons, with "permission" split into a question (or plan to approve) and the rest. */
export type Kind = "finished" | "question" | "permission" | "error"
export const KINDS: Kind[] = ["finished", "question", "permission", "error"]

/** Linux: the freedesktop sound theme (package sound-theme-freedesktop on most distributions). */
export const DEFAULT_SOUNDS: Record<Kind, string> = {
  finished: "/usr/share/sounds/freedesktop/stereo/complete.oga",
  question: "/usr/share/sounds/freedesktop/stereo/window-question.oga",
  permission: "/usr/share/sounds/freedesktop/stereo/message-new-instant.oga",
  error: "/usr/share/sounds/freedesktop/stereo/dialog-error.oga",
}

/** macOS: the built-in system sounds. */
export const MACOS_SOUNDS: Record<Kind, string> = {
  finished: "/System/Library/Sounds/Glass.aiff",
  question: "/System/Library/Sounds/Purr.aiff",
  permission: "/System/Library/Sounds/Ping.aiff",
  error: "/System/Library/Sounds/Basso.aiff",
}

/** Default sounds and players (tried in order until one starts) for a platform. */
export function platformDefaults(platform: string): { sounds: Record<Kind, string>; players: string[] } {
  return platform === "darwin"
    ? { sounds: MACOS_SOUNDS, players: ["afplay"] }
    : { sounds: DEFAULT_SOUNDS, players: ["pw-play", "paplay"] }
}

/** Command-line arguments for a player: its volume flag when it has a 0–1 one, then the file. */
export function playerArgs(player: string, file: string, volume?: string): string[] {
  const name = player.split("/").pop()
  if (volume && name === "pw-play") return ["--volume", volume, file]
  if (volume && name === "afplay") return ["-v", volume, file]
  return [file]
}

/**
 * The sound kind for an event. A permission event is a question when what the chat waits for is a question or a plan
 * to approve (the request kinds from the agent's pendingPermissions); tool, mode and other requests are permissions.
 */
export function kindOf(reason: Reason, pendingKinds: readonly string[] = []): Kind {
  if (reason !== "permission") return reason
  return pendingKinds.some((kind) => kind === "question" || kind === "plan") ? "question" : "permission"
}

/** The same chat and reason within this window is one alert (the daemon sends a session's events twice). */
export const DEDUPE_MS = 3000
/** At most one sound this often, so several chats finishing together don't stack up. */
export const MIN_GAP_MS = 1000

/** The open tabs from pasode's kv.json ("tabs": session ids); anything unreadable means none. */
export function tabsFrom(kvText: string | undefined): Set<string> {
  try {
    const tabs = JSON.parse(kvText ?? "")?.tabs
    return new Set(Array.isArray(tabs) ? tabs.filter((id): id is string => typeof id === "string") : [])
  } catch {
    return new Set()
  }
}

export type Situation = {
  agentId: string
  kind: Kind
  /** Sessions open as tabs in pasode: only these make a sound. */
  tabs: Set<string>
  /** The session on screen, and whether the terminal has focus: that one is quiet while you're looking at it. */
  currentId?: string
  focused: boolean
  muted: boolean
  /** Kinds that make a sound. */
  enabled: Set<Kind>
}

/** Whether an event deserves an alert at all (before dedupe and rate limiting). */
export function wants(s: Situation): boolean {
  if (s.muted || !s.enabled.has(s.kind)) return false
  if (!s.tabs.has(s.agentId) && s.agentId !== s.currentId) return false
  if (s.focused && s.agentId === s.currentId) return false
  return true
}

/** Dedupe per chat+reason and a global gap between sounds; `now` is injected for tests. */
export function createGate() {
  const seen = new Map<string, number>()
  let lastSound = -Infinity
  return {
    /** "sound": play it; "quiet": a fresh alert, but too soon after the last sound; "duplicate": already alerted. */
    check(agentId: string, kind: Kind, now: number): "sound" | "quiet" | "duplicate" {
      const key = `${agentId}:${kind}`
      const previous = seen.get(key)
      if (previous !== undefined && now - previous < DEDUPE_MS) return "duplicate"
      seen.set(key, now)
      for (const [k, at] of seen) if (now - at >= DEDUPE_MS) seen.delete(k) // keep the map small
      if (now - lastSound < MIN_GAP_MS) return "quiet"
      lastSound = now
      return "sound"
    },
  }
}

/** pw-play's --volume and afplay's -v are linear 0.0–1.0; clamp whatever the config says. */
export function volumeArg(volume: unknown): string | undefined {
  if (typeof volume !== "number" || !Number.isFinite(volume)) return undefined
  return Math.max(0, Math.min(1, volume)).toFixed(2)
}
