// Pure helpers for the media plugin: no processes, no UI, so `bun test` covers them.

/** playerctl's status values; a Stopped player has nothing to show. */
export type Status = "Playing" | "Paused" | "Stopped"

/** One player's state as playerctl reports it. Seconds, not microseconds. */
export type Track = {
  player: string
  status: Status
  title: string
  artist: string
  /** Undefined when the player doesn't know it (a live stream, an ad). */
  length?: number
  position: number
  art?: string
  url?: string
}

/** A player plus when its status last changed: the most recent change decides which player the sidebar follows. */
export type Player = { track: Track; since: number }

/** Separates fields in a followed line; never appears in titles. */
const SEP = "\u001f"

/** `playerctl -a -F metadata --format FORMAT`: one line per player per change, and about once a second while playing. */
export const FORMAT = ["{{playerInstance}}", "{{status}}", "{{mpris:length}}", "{{position}}", "{{mpris:artUrl}}", "{{xesam:url}}", "{{artist}}", "{{title}}"].join(SEP)

const micro = (value: string) => (value.trim() === "" || Number.isNaN(Number(value)) ? undefined : Number(value) / 1_000_000)

/** Parses one line of FORMAT output; undefined for blank or malformed lines. */
export function parseLine(line: string): Track | undefined {
  const fields = line.split(SEP)
  if (fields.length < 8) return undefined
  const [player, status, length, position, art, url, artist, ...title] = fields as [string, string, string, string, string, string, string, ...string[]]
  if (!player || (status !== "Playing" && status !== "Paused" && status !== "Stopped")) return undefined
  return {
    player,
    status,
    length: micro(length) || undefined,
    position: micro(position) ?? 0,
    art: art || undefined,
    url: url || undefined,
    artist,
    title: title.join(SEP),
  }
}

/** The updated player for a new line: `since` moves only when the status changes, not on position ticks. */
export function track(previous: Player | undefined, next: Track, now: number): Player {
  return { track: next, since: previous && previous.track.status === next.status ? previous.since : now }
}

/** The player to show: the one that most recently started playing; with none playing, the one paused most recently. */
export function pick(players: Player[]): Player | undefined {
  const live = players.filter((p) => p.track.status !== "Stopped")
  const latest = (list: Player[]) => list.reduce<Player | undefined>((best, p) => (!best || p.since > best.since ? p : best), undefined)
  return latest(live.filter((p) => p.track.status === "Playing")) ?? latest(live)
}

/** 169 → "2:49"; an hour or more → "1:02:05". */
export function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const s = String(total % 60).padStart(2, "0")
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

/** "YouTube Music", "YouTube", the site's host, or the player's name ("firefox.instance_1" → "Firefox"). */
export function sourceLabel(track: { url?: string; player: string }) {
  try {
    const host = track.url ? new URL(track.url).hostname.replace(/^www\./, "") : ""
    if (host === "music.youtube.com") return "YouTube Music"
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") return "YouTube"
    if (host) return host
  } catch {}
  const name = track.player.split(".")[0] ?? track.player
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** How many of `width` bar cells are played. */
export function filled(width: number, position: number, length: number | undefined) {
  if (!length) return 0
  return Math.max(0, Math.min(width, Math.round((position / length) * width)))
}

/** The position a click on bar cell `x` (0-based, of `width`) jumps to; undefined without a length. */
export function seekSeconds(x: number, width: number, length: number | undefined) {
  if (!length || width <= 0) return undefined
  return Math.round(Math.max(0, Math.min(1, x / width)) * length)
}

/** The cover for the image element: a file URL's path, or an http(s) URL as is. */
export function artSource(art: string | undefined) {
  if (!art) return undefined
  if (art.startsWith("file://")) return decodeURIComponent(new URL(art).pathname)
  if (/^https?:\/\//.test(art)) return art
  return undefined
}
