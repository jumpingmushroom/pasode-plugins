// Pure helpers for the weather plugin: no network, no timers, no UI, so `bun test` covers them.

/** One hour of yr's forecast: the temperature at the start of the hour, and the rain and symbol for the hour. */
export type Hour = { time: Date; temp: number; rain: number; symbol: string }

/** The hourly entries of a MET Norway locationforecast/2.0 response. Entries with only 6-hour blocks are left out. */
export function parseForecast(json: unknown): Hour[] {
  const series = (json as { properties?: { timeseries?: unknown[] } } | null)?.properties?.timeseries
  if (!Array.isArray(series)) return []
  const hours: Hour[] = []
  for (const entry of series as any[]) {
    const temp = entry?.data?.instant?.details?.air_temperature
    const next = entry?.data?.next_1_hours
    const symbol = next?.summary?.symbol_code
    if (typeof temp !== "number" || typeof symbol !== "string") continue
    hours.push({ time: new Date(entry.time), temp, rain: next?.details?.precipitation_amount ?? 0, symbol })
  }
  return hours
}

/** Hours with at least this much rain count as rain. */
const RAIN_MM = 0.1
/** From this hour on, the summary covers tomorrow instead of the rest of today. */
const TOMORROW_FROM = 21

/** A run of rainy hours, as clock hours: `from` 14 and `to` 16 is 14:00–16:00. */
export type RainWindow = { from: number; to: number }

export type Summary = {
  temp: number
  symbol: string
  high: number
  low: number
  rain: RainWindow[]
  /** Total rain in mm over the day. */
  mm: number
  /** Every rainy hour is snow. */
  snow: boolean
  /** The high, low and rain are for tomorrow. */
  tomorrow: boolean
}

const startOfHour = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours())
const startOfDay = (at: Date, plusDays = 0) => new Date(at.getFullYear(), at.getMonth(), at.getDate() + plusDays)

/** The weather now, and the high, low and rain from now until midnight (or for tomorrow after 21:00). */
export function summarize(forecast: Hour[], now: Date): Summary | undefined {
  const hour = startOfHour(now).getTime()
  const current = forecast.find((h) => h.time.getTime() === hour)
  if (!current) return undefined

  const tomorrow = now.getHours() >= TOMORROW_FROM
  const from = tomorrow ? startOfDay(now, 1).getTime() : hour
  const to = startOfDay(now, tomorrow ? 2 : 1).getTime()
  const day = forecast.filter((h) => h.time.getTime() >= from && h.time.getTime() < to)
  if (!day.length) return undefined

  const rain: RainWindow[] = []
  let mm = 0
  const wet = day.filter((h) => h.rain >= RAIN_MM)
  for (const h of wet) {
    mm += h.rain
    const start = h.time.getHours()
    const last = rain.at(-1)
    if (last && last.to === start) last.to = start + 1
    else rain.push({ from: start, to: start + 1 })
  }

  const temps = day.map((h) => h.temp)
  return {
    temp: Math.round(current.temp),
    symbol: current.symbol,
    high: Math.round(Math.max(...temps)),
    low: Math.round(Math.min(...temps)),
    rain,
    mm: Math.round(mm * 100) / 100,
    snow: wet.length > 0 && wet.every((h) => symbolGlyph(h.symbol) === "❄"),
    tomorrow,
  }
}

/** yr's symbol code (such as "lightrainshowers_day") as a glyph one column wide. */
export function symbolGlyph(code: string) {
  const [base = "", time] = code.split("_")
  if (base.includes("thunder")) return "ϟ"
  if (base.includes("snow")) return "❄"
  if (base.includes("rain") || base.includes("sleet")) return "☂"
  if (base === "fog") return "≡"
  if (base === "clearsky" || base === "fair") return time === "night" ? "☾" : "☀"
  if (base === "partlycloudy" || base === "cloudy") return "☁"
  return "·"
}

const WORDS = {
  no: { rain: "Regn", snow: "Snø", dry: "Opphold", tomorrow: "I morgen", polarNight: "Mørketid", midnightSun: "Midnattssol" },
  en: { rain: "Rain", snow: "Snow", dry: "Dry", tomorrow: "Tomorrow", polarNight: "Polar night", midnightSun: "Midnight sun" },
}

/** Norwegian for nb, nn and no locales; English for everything else. */
const words = (locale: string) => (/^(nb|nn|no)\b/i.test(locale) ? WORDS.no : WORDS.en)
/** Whole degrees, never "-0°". */
const degrees = (n: number) => `${Math.round(n) || 0}°`
const hh = (n: number) => String(n).padStart(2, "0")

/** The two lines under the clock: "☁ 7°" with "↑ 9°  ↓ 4°" on the right, then "Regn 14–18, 3 mm" or "Opphold". */
export function weatherLines(summary: Summary, locale: string) {
  const w = words(locale)
  const range = `↑ ${degrees(summary.high)}  ↓ ${degrees(summary.low)}`
  let detail = w.dry
  if (summary.rain.length) {
    const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: summary.mm < 1 ? 1 : 0 }).format(summary.mm)
    const windows = summary.rain.map((r) => `${hh(r.from)}–${hh(r.to)}`).join(", ")
    detail = `${summary.snow ? w.snow : w.rain} ${windows}, ${amount} mm`
  }
  return {
    now: `${symbolGlyph(summary.symbol)} ${degrees(summary.temp)}`,
    range: summary.tomorrow ? `${w.tomorrow}: ${range}` : range,
    detail,
  }
}

export type Coords = { lat: number; lon: number }
export type WeatherOptions = { place: string; coords?: Coords; follow: boolean; locale: string }

export function readOptions(raw: Record<string, unknown>): WeatherOptions {
  const options: WeatherOptions = {
    place: typeof raw.place === "string" && raw.place.trim() ? raw.place.trim() : "Oslo",
    follow: raw.follow !== false,
    locale: typeof raw.locale === "string" && raw.locale ? raw.locale : "nb-NO",
  }
  if (typeof raw.lat === "number" && typeof raw.lon === "number") options.coords = { lat: raw.lat, lon: raw.lon }
  return options
}

/** The location in GeoClue's `where-am-i` demo output, if it found one. */
export function parseWhereAmI(output: string): Coords | undefined {
  const lat = output.match(/Latitude:\s*(-?\d+(?:\.\d+)?)/)
  const lon = output.match(/Longitude:\s*(-?\d+(?:\.\d+)?)/)
  return lat && lon ? { lat: Number(lat[1]), lon: Number(lon[1]) } : undefined
}

/** Coordinates rounded to 2 decimals (about a kilometre): what the forecast is fetched for, and when it changes. */
export function coordsKey(coords: Coords) {
  return `${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}`
}

const MINUTE = 60_000

/** Milliseconds until the next forecast fetch: when the API says it expires, kept between 10 and 60 minutes. */
export function nextFetchMs(expires: string | null, now: Date) {
  const at = expires ? Date.parse(expires) : NaN
  if (Number.isNaN(at)) return 30 * MINUTE
  return Math.min(60 * MINUTE, Math.max(10 * MINUTE, at - now.getTime()))
}

/** The most useful name in an OpenStreetMap address: the village, town or city rather than a farm or quarter. */
export function placeName(address: Record<string, string> | undefined) {
  if (!address) return undefined
  for (const field of ["village", "town", "city", "hamlet", "suburb", "municipality"]) if (address[field]) return address[field]
  return undefined
}

/** The name line above the weather; ⌖ marks a place GeoClue found, as opposed to the one in the config. */
export function placeLine(name: string, located: boolean) {
  return located ? `⌖ ${name}` : name
}

/** Sunrise and sunset on a day, or which polar case it is when the sun doesn't rise or set. */
export type Sun = { rise: Date; set: Date } | { polar: "night" | "day" }

const RAD = Math.PI / 180
const DAY_MS = 86_400_000

/** The sun's declination (radians) and the equation of time (minutes) at `ms`, from NOAA's solar calculator. */
function solar(ms: number) {
  const t = (ms / DAY_MS + 2440587.5 - 2451545) / 36525
  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
  const anomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const m = anomaly * RAD
  const centre = Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m) * (0.019993 - 0.000101 * t) + Math.sin(3 * m) * 0.000289
  const node = (125.04 - 1934.136 * t) * RAD
  const apparent = (meanLong + centre - 0.00569 - 0.00478 * Math.sin(node)) * RAD
  const obliquity = (23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(node)) * RAD
  const y = Math.tan(obliquity / 2) ** 2
  const l0 = meanLong * RAD
  const equation =
    y * Math.sin(2 * l0) - 2 * ecc * Math.sin(m) + 4 * ecc * y * Math.sin(m) * Math.cos(2 * l0) - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * ecc * ecc * Math.sin(2 * m)
  return { declination: Math.asin(Math.sin(obliquity) * Math.sin(apparent)), equation: (4 * equation) / RAD }
}

/** Sunrise (-1) or sunset (+1) in ms near `guess`, or the polar case when the sun stays down or up. */
function sunEvent(guess: number, midnight: number, { lat, lon }: Coords, side: -1 | 1): number | "night" | "day" {
  const { declination, equation } = solar(guess)
  // 90.833° allows for the sun's radius and the air bending its light.
  const cosHour = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(declination)) - Math.tan(lat * RAD) * Math.tan(declination)
  if (cosHour > 1) return "night"
  if (cosHour < -1) return "day"
  const minutes = 720 - 4 * lon - equation + side * 4 * (Math.acos(cosHour) / RAD)
  return midnight + minutes * 60_000
}

/** Sunrise and sunset on the local calendar day of `day`, within about a minute of MET Norway's times. */
export function sunTimes(day: Date, coords: Coords): Sun {
  const midnight = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())
  const times: number[] = []
  for (const side of [-1, 1] as const) {
    // Once from noon, then again at the first answer, since the sun's position moves during the day.
    let at: number | "night" | "day" = midnight + 12 * 3_600_000
    for (let pass = 0; pass < 2 && typeof at === "number"; pass++) at = sunEvent(at, midnight, coords, side)
    if (typeof at !== "number") return { polar: at }
    times.push(at)
  }
  return { rise: new Date(times[0]!), set: new Date(times[1]!) }
}

const hhmm = (at: Date) => `${hh(at.getHours())}:${hh(at.getMinutes())}`

/** "☀ 07:44 – 16:18", or "☾ Mørketid" and "☀ Midnattssol" for days without a sunrise or a sunset. */
export function sunLine(sun: Sun, locale: string) {
  const w = words(locale)
  if ("polar" in sun) return sun.polar === "night" ? `☾ ${w.polarNight}` : `☀ ${w.midnightSun}`
  return `☀ ${hhmm(sun.rise)} – ${hhmm(sun.set)}`
}
