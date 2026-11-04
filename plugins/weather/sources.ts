// Where the weather plugin gets its data: MET Norway's forecast API, OpenStreetMap's place search, and GeoClue.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { coordsKey, parseForecast, parseWhereAmI, type Coords, type Hour } from "./model"

/** MET Norway and OpenStreetMap both require an identifying User-Agent. */
const USER_AGENT = "pasode-plugins-weather/1.0 github.com/jumpingmushroom/pasode-plugins"

/** The place's coordinates from OpenStreetMap's place search (Nominatim), or undefined when it finds nothing. */
export async function geocode(place: string): Promise<Coords | undefined> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } })
  if (!response.ok) throw new Error(`place search answered ${response.status}`)
  const [hit] = (await response.json()) as { lat: string; lon: string }[]
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : undefined
}

export type Fetched = { hours: Hour[]; lastModified: string | null; expires: string | null } | { unchanged: true; expires: string | null }

/** yr's hourly forecast for `coords`. With `lastModified` from an earlier fetch, an unchanged forecast isn't sent again. */
export async function fetchForecast(coords: Coords, lastModified?: string | null): Promise<Fetched> {
  const [lat, lon] = coordsKey(coords).split(",")
  const headers: Record<string, string> = { "User-Agent": USER_AGENT }
  if (lastModified) headers["If-Modified-Since"] = lastModified
  const response = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`, { headers })
  const expires = response.headers.get("expires")
  if (response.status === 304) return { unchanged: true, expires }
  if (!response.ok) throw new Error(`yr answered ${response.status}`)
  return { hours: parseForecast(await response.json()), lastModified: response.headers.get("last-modified"), expires }
}

/** GeoClue's demo client; Arch and Fedora put it in /usr/lib, Debian and Ubuntu in /usr/libexec. */
const WHERE_AM_I = ["/usr/lib/geoclue-2.0/demos/where-am-i", "/usr/libexec/geoclue-2.0/demos/where-am-i"]
/** Give up on GeoClue after this long; the plugin then uses the set place. */
const LOCATE_SECONDS = 30

/** The laptop's location from GeoClue (from nearby Wi-Fi networks), or undefined when GeoClue isn't there or can't tell. */
export function locate(): Promise<Coords | undefined> {
  const bin = WHERE_AM_I.find((path) => existsSync(path))
  if (!bin) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    // Accuracy level 6 (street) makes GeoClue use Wi-Fi rather than only the internet address.
    const proc = spawn(bin, ["-t", String(LOCATE_SECONDS), "-a", "6"], { stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, LC_ALL: "C" } })
    let output = ""
    let done = false
    const finish = (coords: Coords | undefined) => {
      if (done) return
      done = true
      clearTimeout(timer)
      proc.kill()
      resolve(coords)
    }
    const timer = setTimeout(() => finish(undefined), (LOCATE_SECONDS + 5) * 1000)
    proc.stdout!.on("data", (chunk) => {
      output += chunk
      const coords = parseWhereAmI(output)
      if (coords) finish(coords)
    })
    proc.on("error", () => finish(undefined))
    proc.on("exit", () => finish(parseWhereAmI(output)))
  })
}
