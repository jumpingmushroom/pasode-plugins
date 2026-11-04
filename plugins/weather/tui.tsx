// Today's weather in pasode's sidebar, right under the clock: the place with sunrise and sunset, the temperature
// now with today's high and low, and when it rains. Forecasts come from yr (MET Norway); the place follows the laptop through GeoClue when it can.
//
// Options (cli.json: ["~/pasode-plugins/plugins/weather", { "place": "Torød" }]):
//   place   a place name, looked up once on OpenStreetMap (default "Oslo").
//   lat/lon coordinates instead of a place name.
//   follow  false always uses the set place; true (default) uses GeoClue's location when GeoClue is running.
//   locale  "nb-NO" (default) for Norwegian text, or for example "en-GB" for English.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { PasodePlugin } from "@pasode/host"
import { coordsKey, nextFetchMs, placeLine, readOptions, summarize, sunLine, sunTimes, weatherLines, type Coords, type Hour } from "./model"
import { fetchForecast, geocode, locate, placeAt } from "./sources"

/** Sorts right after the clock (-1000), so the weather sits under the date. */
const ORDER = -999
/** Wait before trying again after a failed fetch or lookup. */
const RETRY_MS = 10 * 60_000
/** A forecast older than this shows when it was fetched. */
const STALE_MS = 90 * 60_000

const stateFile = path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "pasode", "weather.json")

/** What survives restarts and is shared between pasode windows: looked-up places and the last forecast. */
type Saved = {
  places?: Record<string, Coords>
  /** Place names by rounded coordinates, from reverse lookups. */
  names?: Record<string, string>
  forecast?: { key: string; hours: { time: string; temp: number; rain: number; symbol: string }[]; lastModified: string | null; expires: string | null; fetchedAt: number }
}

function load(): Saved {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8")) as Saved
  } catch {
    return {}
  }
}

function save(change: (saved: Saved) => void) {
  const saved = load()
  change(saved)
  try {
    mkdirSync(path.dirname(stateFile), { recursive: true })
    writeFileSync(`${stateFile}.tmp`, JSON.stringify(saved))
    renameSync(`${stateFile}.tmp`, stateFile)
  } catch {
    // The cache only saves requests; the weather still shows without it.
  }
}

export default {
  id: "weather",
  setup(ctx) {
    const options = readOptions(ctx.options)
    const { theme } = ctx

    const [hours, setHours] = createSignal<Hour[]>([])
    const [fetchedAt, setFetchedAt] = createSignal(0)
    const [now, setNow] = createSignal(new Date())
    const [place, setPlace] = createSignal<string>()
    const [coords, setCoords] = createSignal<Coords>()

    // The current hour, the rest of the day and "stale" all move with the clock, so re-check every minute.
    const minute = setInterval(() => setNow(new Date()), 60_000)

    /** The name for coordinates that came without one, looked up once per kilometre square and cached. */
    async function nameFor(coords: Coords) {
      const key = coordsKey(coords)
      const known = load().names?.[key]
      if (known) return known
      const name = await placeAt(coords).catch(() => undefined)
      if (name) save((s) => (s.names = { ...s.names, [key]: name }))
      return name
    }

    async function where(): Promise<{ coords: Coords; name?: string; located: boolean } | undefined> {
      if (options.follow) {
        const here = await locate()
        if (here) return { coords: here, name: await nameFor(here), located: true }
      }
      if (options.coords) return { coords: options.coords, name: await nameFor(options.coords), located: false }
      const known = load().places?.[options.place]
      if (known) return { coords: known, name: options.place, located: false }
      const found = await geocode(options.place)
      if (found) save((s) => (s.places = { ...s.places, [options.place]: found }))
      else ctx.ui.toast(`Weather: no place called "${options.place}" found. Set "place" or "lat" and "lon".`, "warning")
      return found && { coords: found, name: options.place, located: false }
    }

    function show(forecast: NonNullable<Saved["forecast"]>) {
      setHours(forecast.hours.map((h) => ({ ...h, time: new Date(h.time) })))
      setFetchedAt(forecast.fetchedAt)
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const later = (ms: number) => {
      if (!stopped) timer = setTimeout(refresh, ms)
    }

    async function refresh() {
      try {
        const spot = await where()
        if (!spot) return later(RETRY_MS)
        const { coords } = spot
        setPlace(spot.name ? placeLine(spot.name, spot.located) : undefined)
        setCoords(coords)
        const key = coordsKey(coords)
        const cached = load().forecast
        const same = cached?.key === key ? cached : undefined

        // Another pasode window may have fetched it already.
        if (same && same.expires && Date.parse(same.expires) > Date.now()) {
          show(same)
          return later(nextFetchMs(same.expires, new Date()))
        }

        const result = await fetchForecast(coords, same?.lastModified)
        const forecast =
          "unchanged" in result
            ? { ...same!, expires: result.expires, fetchedAt: Date.now() }
            : { key, hours: result.hours.map((h) => ({ ...h, time: h.time.toISOString() })), lastModified: result.lastModified, expires: result.expires, fetchedAt: Date.now() }
        save((s) => (s.forecast = forecast))
        show(forecast)
        later(nextFetchMs(result.expires, new Date()))
      } catch {
        // Offline: keep showing the last forecast, which now says how old it is.
        if (!hours().length) {
          const cached = load().forecast
          if (cached) show(cached)
        }
        later(RETRY_MS)
      }
    }

    refresh()
    onCleanup(() => {
      stopped = true
      clearTimeout(timer)
      clearInterval(minute)
    })

    const summary = createMemo(() => summarize(hours(), now()))
    // Tomorrow's sunrise and sunset once the rest of the section has moved to tomorrow.
    const sun = createMemo(() => {
      const at = coords()
      if (!at) return undefined
      const day = new Date(now())
      if (summary()?.tomorrow) day.setDate(day.getDate() + 1)
      return sunLine(sunTimes(day, at), options.locale)
    })
    const stale = () => {
      const at = fetchedAt()
      return at && now().getTime() - at > STALE_MS ? new Date(at).toLocaleTimeString(options.locale, { hour: "2-digit", minute: "2-digit" }) : undefined
    }

    function Weather() {
      return (
        <Show when={summary()}>
          {(s) => {
            const lines = () => weatherLines(s(), options.locale)
            return (
              <box flexDirection="column" flexShrink={0}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted} wrapMode="none" truncate flexShrink={1} minWidth={0}>{place() ?? ""}</text>
                  <box flexGrow={1} />
                  <Show when={sun()}>{(line) => <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>{line()}</text>}</Show>
                </box>
                <box flexDirection="row">
                  <text wrapMode="none" flexShrink={0}>
                    <b>{lines().now}</b>
                    <Show when={stale()}>{(at) => <span style={{ fg: theme.textMuted }}> ({at()})</span>}</Show>
                  </text>
                  <box flexGrow={1} />
                  <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>{lines().range}</text>
                </box>
                <text fg={s().rain.length ? theme.text : theme.textMuted} wrapMode="none" truncate>{lines().detail}</text>
              </box>
            )
          }}
        </Show>
      )
    }

    onCleanup(ctx.ui.slot("sidebar_content", () => <Weather />, ORDER))
  },
} satisfies PasodePlugin
