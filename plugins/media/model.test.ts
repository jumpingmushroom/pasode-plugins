import { expect, test } from "bun:test"
import { artSource, clock, FORMAT, filled, parseLine, pick, seekSeconds, sourceLabel, track, type Player } from "./model"

const SEP = "\u001f"
const line = (...fields: string[]) => fields.join(SEP)

test("FORMAT asks playerctl for the fields parseLine reads, in order", () => {
  expect(FORMAT.split(SEP)).toEqual([
    "{{playerInstance}}",
    "{{status}}",
    "{{mpris:length}}",
    "{{position}}",
    "{{mpris:artUrl}}",
    "{{xesam:url}}",
    "{{artist}}",
    "{{title}}",
  ])
})

test("parseLine reads one followed line; microseconds become seconds; a missing length is undefined", () => {
  expect(parseLine(line("firefox.instance_1_55", "Playing", "776000000", "169500000", "file:///a.png", "https://www.youtube.com/watch?v=x", "wolf397", "The Strange Holes of Gaming"))).toEqual({
    player: "firefox.instance_1_55",
    status: "Playing",
    length: 776,
    position: 169.5,
    art: "file:///a.png",
    url: "https://www.youtube.com/watch?v=x",
    artist: "wolf397",
    title: "The Strange Holes of Gaming",
  })
  expect(parseLine(line("p", "Paused", "", "28", "", "", "", "Ad"))).toMatchObject({ length: undefined, position: 0.000028, art: undefined, url: undefined, artist: "" })
  // A title may itself contain the separator-free text "|" and tabs; only SEP splits.
  expect(parseLine(line("p", "Playing", "1", "0", "", "", "a\tb", "x | y"))!.title).toBe("x | y")
})

test("parseLine ignores blank lines and lines with too few fields; a stopped player still parses, so it can be dropped", () => {
  expect(parseLine("")).toBeUndefined()
  expect(parseLine("just text")).toBeUndefined()
  expect(parseLine(line("p", "Stopped", "", "", "", "", "", ""))).toMatchObject({ player: "p", status: "Stopped" })
})

const player = (name: string, status: "Playing" | "Paused" | "Stopped", since: number): Player => ({
  track: { player: name, status, position: 0, title: name, artist: "" },
  since,
})

test("pick: the player that most recently started playing; else the one paused most recently", () => {
  expect(pick([player("a", "Playing", 1), player("b", "Playing", 5), player("c", "Paused", 9)])?.track.player).toBe("b")
  expect(pick([player("a", "Paused", 1), player("c", "Paused", 9)])?.track.player).toBe("c")
  expect(pick([])).toBeUndefined()
  expect(pick([player("s", "Stopped", 99)])).toBeUndefined()
})

test("track: a status change moves `since`; a position tick keeps it", () => {
  const playing = { player: "a", status: "Playing" as const, position: 1, title: "t", artist: "" }
  const first = track(undefined, playing, 100)
  expect(first.since).toBe(100)
  expect(track(first, { ...playing, position: 2 }, 200).since).toBe(100)
  expect(track(first, { ...playing, status: "Paused" }, 300).since).toBe(300)
})

test("clock: m:ss under an hour, h:mm:ss above", () => {
  expect(clock(0)).toBe("0:00")
  expect(clock(169.9)).toBe("2:49")
  expect(clock(776)).toBe("12:56")
  expect(clock(3725)).toBe("1:02:05")
})

test("sourceLabel: YouTube Music, YouTube, else the site's host, else the player's name", () => {
  expect(sourceLabel({ url: "https://music.youtube.com/watch?v=x", player: "firefox.instance_1" })).toBe("YouTube Music")
  expect(sourceLabel({ url: "https://www.youtube.com/watch?v=x", player: "firefox.instance_1" })).toBe("YouTube")
  expect(sourceLabel({ url: "https://soundcloud.com/a", player: "firefox.instance_1" })).toBe("soundcloud.com")
  expect(sourceLabel({ player: "spotify" })).toBe("Spotify")
  expect(sourceLabel({ player: "firefox.instance_1_55" })).toBe("Firefox")
})

test("filled: how many of `width` bar cells are played; nothing without a length", () => {
  expect(filled(26, 169, 776)).toBe(6)
  expect(filled(26, 776, 776)).toBe(26)
  expect(filled(26, 900, 776)).toBe(26)
  expect(filled(26, 10, undefined)).toBe(0)
})

test("seekSeconds: a click on bar cell x jumps to that share of the track", () => {
  expect(seekSeconds(0, 26, 260)).toBe(0)
  expect(seekSeconds(13, 26, 260)).toBe(130)
  expect(seekSeconds(30, 26, 260)).toBe(260)
  expect(seekSeconds(5, 26, undefined)).toBeUndefined()
})

test("artSource: a file URL becomes its path, an http(s) URL stays, anything else gives no cover", () => {
  expect(artSource("file:///home/u/.zen/firefox-mpris/7128_334.png")).toBe("/home/u/.zen/firefox-mpris/7128_334.png")
  expect(artSource("file:///tmp/a%20b.png")).toBe("/tmp/a b.png")
  expect(artSource("https://i.ytimg.com/vi/x/hq.jpg")).toBe("https://i.ytimg.com/vi/x/hq.jpg")
  expect(artSource(undefined)).toBeUndefined()
  expect(artSource("data:xyz")).toBeUndefined()
})
