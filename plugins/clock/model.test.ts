import { expect, test } from "bun:test"
import { bigText, clockParts, dateLine, msToNextTick, readOptions } from "./model"

test("bigText draws digits 3 lines tall, 3 columns each, one column apart; the colon is 1 column", () => {
  expect(bigText("14:37")).toEqual([
    "▀█  █ █ ▄ ▀▀█ ▀▀█",
    " █  ▀▀█ ▄  ▀█   █",
    "▄█▄   █   ▄▄█   █",
  ])
  for (const row of bigText("08:59")) expect(row.length).toBe(17)
})

test("bigText draws every digit with three equal-width rows", () => {
  for (const digit of "0123456789") {
    const rows = bigText(digit)
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.length).toBe(3)
  }
})

test("clockParts: 24-hour HH:MM, optional seconds, 12-hour with AM/PM", () => {
  const at = new Date(2026, 10, 3, 14, 37, 42)
  expect(clockParts(at, { hour12: false, seconds: false })).toEqual({ big: "14:37" })
  expect(clockParts(new Date(2026, 10, 3, 8, 5, 9), { hour12: false, seconds: true })).toEqual({ big: "08:05", small: ":09" })
  expect(clockParts(at, { hour12: true, seconds: false })).toEqual({ big: "2:37", suffix: "PM" })
  expect(clockParts(new Date(2026, 10, 3, 0, 1), { hour12: true, seconds: false })).toEqual({ big: "12:01", suffix: "AM" })
})

test("dateLine: weekday, day and month in the locale", () => {
  const at = new Date(2026, 10, 3, 14, 37)
  expect(dateLine(at, "nb-NO")).toBe("tirsdag 3. november")
  expect(dateLine(at, "en-GB")).toBe("Tuesday 3 November")
})

test("msToNextTick: until the next minute, or the next second with seconds on", () => {
  expect(msToNextTick(new Date(2026, 10, 3, 14, 37, 42, 500), false)).toBe(17_500)
  expect(msToNextTick(new Date(2026, 10, 3, 14, 37, 42, 500), true)).toBe(500)
})

test("readOptions: defaults, and bad types fall back", () => {
  expect(readOptions({})).toEqual({ seconds: false, date: true, hour12: false, locale: "nb-NO" })
  expect(readOptions({ seconds: true, date: false, hour12: "yes", locale: 3 })).toEqual({ seconds: true, date: false, hour12: false, locale: "nb-NO" })
  expect(readOptions({ locale: "en-GB" }).locale).toBe("en-GB")
})
