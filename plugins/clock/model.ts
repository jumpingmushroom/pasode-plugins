// Pure helpers for the clock plugin: no timers, no UI, so `bun test` covers them.

/** Digits 3 columns wide and 3 lines tall, drawn with half blocks so each line holds two "pixels". */
const GLYPHS: Record<string, [string, string, string]> = {
  "0": ["█▀█", "█ █", "█▄█"],
  "1": ["▀█ ", " █ ", "▄█▄"],
  "2": ["▀▀█", "█▀▀", "█▄▄"],
  "3": ["▀▀█", " ▀█", "▄▄█"],
  "4": ["█ █", "▀▀█", "  █"],
  "5": ["█▀▀", "▀▀█", "▄▄█"],
  "6": ["█▀▀", "█▀█", "█▄█"],
  "7": ["▀▀█", "  █", "  █"],
  "8": ["█▀█", "█▀█", "█▄█"],
  "9": ["█▀█", "▀▀█", "▄▄█"],
  ":": ["▄", "▄", " "],
}

/** The three lines of `text` (digits and ":") in big digits, one column between characters. */
export function bigText(text: string): [string, string, string] {
  const glyphs = [...text].map((char) => GLYPHS[char] ?? [" ", " ", " "])
  return [0, 1, 2].map((row) => glyphs.map((glyph) => glyph[row]).join(" ")) as [string, string, string]
}

export type ClockOptions = { seconds: boolean; date: boolean; hour12: boolean; locale: string }

export function readOptions(raw: Record<string, unknown>): ClockOptions {
  return {
    seconds: raw.seconds === true,
    date: raw.date !== false,
    hour12: raw.hour12 === true,
    locale: typeof raw.locale === "string" && raw.locale ? raw.locale : "nb-NO",
  }
}

const two = (n: number) => String(n).padStart(2, "0")

/** The big HH:MM, plus the small seconds and the AM/PM suffix when those are on. */
export function clockParts(at: Date, options: Pick<ClockOptions, "hour12" | "seconds">): { big: string; small?: string; suffix?: string } {
  const hours = at.getHours()
  const minutes = two(at.getMinutes())
  const parts: { big: string; small?: string; suffix?: string } = options.hour12
    ? { big: `${hours % 12 || 12}:${minutes}`, suffix: hours < 12 ? "AM" : "PM" }
    : { big: `${two(hours)}:${minutes}` }
  if (options.seconds) parts.small = `:${two(at.getSeconds())}`
  return parts
}

/** "tirsdag 3. november" (nb-NO), "Tuesday 3 November" (en-GB). */
export function dateLine(at: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(at).replace(",", "")
}

/** Milliseconds until the clock next changes: the next minute, or the next second with seconds on. */
export function msToNextTick(at: Date, seconds: boolean) {
  const ms = at.getMilliseconds()
  return seconds ? 1000 - ms : (60 - at.getSeconds()) * 1000 - ms
}
