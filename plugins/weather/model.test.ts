import { expect, test } from "bun:test"
import { coordsKey, nextFetchMs, parseForecast, parseWhereAmI, readOptions, summarize, symbolGlyph, weatherLines, type Hour } from "./model"

/** Hourly forecast in local time from `start`: one entry per item, [temperature, rain mm, symbol]. */
function hours(start: Date, items: [number, number, string?][]): Hour[] {
  return items.map(([temp, rain, symbol], i) => ({
    time: new Date(start.getTime() + i * 3_600_000),
    temp,
    rain,
    symbol: symbol ?? (rain >= 0.1 ? "rain" : "cloudy"),
  }))
}

test("parseForecast keeps the hourly entries with temperature, rain and symbol", () => {
  const json = {
    properties: {
      timeseries: [
        { time: "2026-11-04T07:00:00Z", data: { instant: { details: { air_temperature: 1.8 } }, next_1_hours: { summary: { symbol_code: "fog" }, details: { precipitation_amount: 0 } } } },
        { time: "2026-11-04T08:00:00Z", data: { instant: { details: { air_temperature: 2.5 } }, next_1_hours: { summary: { symbol_code: "lightrain" }, details: { precipitation_amount: 0.4 } } } },
        // Far ahead, the API only has 6-hour blocks: not hourly, so left out.
        { time: "2026-11-07T00:00:00Z", data: { instant: { details: { air_temperature: 5 } }, next_6_hours: { summary: { symbol_code: "rain" }, details: { precipitation_amount: 3 } } } },
      ],
    },
  }
  expect(parseForecast(json)).toEqual([
    { time: new Date("2026-11-04T07:00:00Z"), temp: 1.8, rain: 0, symbol: "fog" },
    { time: new Date("2026-11-04T08:00:00Z"), temp: 2.5, rain: 0.4, symbol: "lightrain" },
  ])
  expect(parseForecast({})).toEqual([])
  expect(parseForecast(null)).toEqual([])
})

test("summarize: now, the high and low until midnight, and the rain windows", () => {
  const now = new Date(2026, 10, 4, 12, 20)
  const forecast = hours(new Date(2026, 10, 4, 11), [
    [5, 0, "fair_day"], // 11, already past
    [7.4, 0, "cloudy"], // 12: the current hour
    [9.2, 0],
    [8, 0.5], // 14
    [6, 1.2],
    [5, 0.05], // 16: under 0.1 mm counts as dry
    [4, 0.8], // 17
    [3.6, 0], // 18 ... 23
    [3, 0], [2, 0], [2, 0], [1, 0], [0.4, 0],
    [-3, 0], // 00 next day: not today
  ])
  expect(summarize(forecast, now)).toEqual({
    temp: 7,
    symbol: "cloudy",
    high: 9,
    low: 0,
    rain: [{ from: 14, to: 16 }, { from: 17, to: 18 }],
    mm: 2.5,
    snow: false,
    tomorrow: false,
  })
})

test("summarize: after 21:00 the day is tomorrow, the current reading stays now", () => {
  const now = new Date(2026, 10, 4, 21, 5)
  const forecast = hours(new Date(2026, 10, 4, 21), [
    [2, 0, "clearsky_night"], [1, 0], [0, 0], // 21–23
    ...Array.from({ length: 24 }, (_, h): [number, number, string?] => [h === 14 ? 9 : 4, h >= 8 && h < 10 ? 0.6 : 0, h >= 8 && h < 10 ? "snow" : undefined]),
    [-5, 0], // 00 the day after
  ])
  const summary = summarize(forecast, now)!
  expect(summary).toMatchObject({ temp: 2, symbol: "clearsky_night", high: 9, low: 4, rain: [{ from: 8, to: 10 }], mm: 1.2, snow: true, tomorrow: true })
})

test("summarize: nothing to say without a forecast for the current hour", () => {
  expect(summarize([], new Date())).toBeUndefined()
  expect(summarize(hours(new Date(2026, 10, 4, 15), [[3, 0]]), new Date(2026, 10, 4, 18))).toBeUndefined()
})

test("symbolGlyph: yr's symbol codes as one-column glyphs", () => {
  expect(symbolGlyph("clearsky_day")).toBe("☀")
  expect(symbolGlyph("fair_night")).toBe("☾")
  expect(symbolGlyph("partlycloudy_day")).toBe("☁")
  expect(symbolGlyph("fog")).toBe("≡")
  expect(symbolGlyph("lightrainshowers_day")).toBe("☂")
  expect(symbolGlyph("heavysleet")).toBe("☂")
  expect(symbolGlyph("snowshowers_polartwilight")).toBe("❄")
  expect(symbolGlyph("rainandthunder")).toBe("ϟ")
  expect(symbolGlyph("something_new")).toBe("·")
})

test("weatherLines in Norwegian and English", () => {
  const base = { temp: 7, symbol: "cloudy", high: 9, low: 4, rain: [{ from: 14, to: 18 }], mm: 3.04, snow: false, tomorrow: false }
  expect(weatherLines(base, "nb-NO")).toEqual({ now: "☁ 7°", range: "↑ 9°  ↓ 4°", detail: "Regn 14–18, 3 mm" })
  expect(weatherLines(base, "en-GB").detail).toBe("Rain 14–18, 3 mm")
  expect(weatherLines({ ...base, rain: [{ from: 9, to: 11 }, { from: 15, to: 18 }], mm: 0.42 }, "nb-NO").detail).toBe("Regn 09–11, 15–18, 0,4 mm")
  expect(weatherLines({ ...base, rain: [], mm: 0 }, "nb-NO").detail).toBe("Opphold")
  expect(weatherLines({ ...base, rain: [], mm: 0 }, "en-GB").detail).toBe("Dry")
  expect(weatherLines({ ...base, snow: true }, "nb-NO").detail).toBe("Snø 14–18, 3 mm")
  expect(weatherLines({ ...base, tomorrow: true }, "nb-NO").range).toBe("I morgen: ↑ 9°  ↓ 4°")
  expect(weatherLines({ ...base, tomorrow: true }, "en-GB").range).toBe("Tomorrow: ↑ 9°  ↓ 4°")
  expect(weatherLines({ ...base, rain: [{ from: 22, to: 24 }] }, "nb-NO").detail).toBe("Regn 22–24, 3 mm")
  expect(weatherLines({ ...base, temp: -0.3, low: -0 }, "nb-NO")).toMatchObject({ now: "☁ 0°", range: "↑ 9°  ↓ 0°" })
})

test("readOptions: Oslo by default, coordinates override the place", () => {
  expect(readOptions({})).toEqual({ place: "Oslo", follow: true, locale: "nb-NO" })
  expect(readOptions({ place: "Torød", follow: false, locale: "en-GB" })).toEqual({ place: "Torød", follow: false, locale: "en-GB" })
  expect(readOptions({ lat: 59.179, lon: 10.441 })).toEqual({ place: "Oslo", coords: { lat: 59.179, lon: 10.441 }, follow: true, locale: "nb-NO" })
  expect(readOptions({ lat: "59", lon: 10, place: "", follow: "no" })).toEqual({ place: "Oslo", follow: true, locale: "nb-NO" })
})

test("parseWhereAmI reads GeoClue's demo output", () => {
  const out = "Client object: /org/freedesktop/GeoClue2/Client/1\n\nNew location:\nLatitude:    59.179001°\nLongitude:   10.441118°\nAccuracy:    40.000000 meters\n"
  expect(parseWhereAmI(out)).toEqual({ lat: 59.179001, lon: 10.441118 })
  expect(parseWhereAmI("Failed to connect to GeoClue2 service")).toBeUndefined()
})

test("coordsKey rounds to about a kilometre, so small moves keep the forecast", () => {
  expect(coordsKey({ lat: 59.179001, lon: 10.441118 })).toBe("59.18,10.44")
  expect(coordsKey({ lat: 59.1812, lon: 10.4388 })).toBe("59.18,10.44")
})

test("nextFetchMs follows the API's Expires header, within 10 and 60 minutes", () => {
  const now = new Date("2026-11-04T07:20:57Z")
  expect(nextFetchMs("Wed, 04 Nov 2026 07:52:01 GMT", now)).toBe(31 * 60_000 + 4_000)
  expect(nextFetchMs("Wed, 04 Nov 2026 07:21:00 GMT", now)).toBe(10 * 60_000)
  expect(nextFetchMs("Wed, 04 Nov 2026 12:00:00 GMT", now)).toBe(60 * 60_000)
  expect(nextFetchMs(null, now)).toBe(30 * 60_000)
})
