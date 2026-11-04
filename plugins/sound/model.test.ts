import { expect, test } from "bun:test"
import { createGate, DEDUPE_MS, kindOf, MIN_GAP_MS, platformDefaults, playerArgs, tabsFrom, volumeArg, wants, type Situation } from "./model"

const base: Situation = {
  agentId: "a",
  kind: "finished",
  tabs: new Set(["a", "b"]),
  currentId: "b",
  focused: true,
  muted: false,
  enabled: new Set(["finished", "question", "permission", "error"]),
}

test("tabsFrom reads pasode's kv.json tabs; anything odd means none", () => {
  expect([...tabsFrom('{"tabs":["x","y",3],"prefs":{}}')]).toEqual(["x", "y"])
  expect(tabsFrom('{"prefs":{}}').size).toBe(0)
  expect(tabsFrom("not json").size).toBe(0)
  expect(tabsFrom(undefined).size).toBe(0)
})

test("only chats open as tabs make a sound", () => {
  expect(wants(base)).toBe(true)
  expect(wants({ ...base, agentId: "watcher-run" })).toBe(false)
})

test("the chat on screen is quiet while the terminal has focus, and dings when it doesn't", () => {
  expect(wants({ ...base, agentId: "b" })).toBe(false)
  expect(wants({ ...base, agentId: "b", focused: false })).toBe(true)
  // A chat opened but not yet in the saved tabs still counts once it's on screen.
  expect(wants({ ...base, agentId: "new", currentId: "new", focused: false, tabs: new Set() })).toBe(true)
})

test("mute and per-reason switches silence it", () => {
  expect(wants({ ...base, muted: true })).toBe(false)
  expect(wants({ ...base, kind: "error", enabled: new Set(["finished"]) })).toBe(false)
})

test("gate: one alert per chat+reason within the dedupe window, at most one sound per gap", () => {
  const gate = createGate()
  expect(gate.check("a", "finished", 0)).toBe("sound")
  expect(gate.check("a", "finished", 100)).toBe("duplicate") // the daemon's second copy
  expect(gate.check("a", "permission", 200)).toBe("quiet") // a different alert, but too close to the last sound
  expect(gate.check("b", "finished", MIN_GAP_MS + 300)).toBe("sound")
  expect(gate.check("a", "finished", DEDUPE_MS + 1)).toBe("sound") // the same chat finishing again later
})

test("volume is clamped to pw-play's 0–1 range", () => {
  expect(volumeArg(0.5)).toBe("0.50")
  expect(volumeArg(3)).toBe("1.00")
  expect(volumeArg(-1)).toBe("0.00")
  expect(volumeArg("loud")).toBeUndefined()
})

test("kindOf: questions and plans to approve are questions; tool, mode and other requests are permissions", () => {
  expect(kindOf("finished")).toBe("finished")
  expect(kindOf("error", ["question"])).toBe("error")
  expect(kindOf("permission", ["question"])).toBe("question")
  expect(kindOf("permission", ["plan"])).toBe("question")
  expect(kindOf("permission", ["tool", "question"])).toBe("question")
  expect(kindOf("permission", ["tool"])).toBe("permission")
  expect(kindOf("permission", ["mode"])).toBe("permission")
  expect(kindOf("permission", [])).toBe("permission") // details not arrived: the general permission sound
})

test("platform defaults: freedesktop sounds with pw-play then paplay; macOS system sounds with afplay", () => {
  expect(platformDefaults("linux").players).toEqual(["pw-play", "paplay"])
  expect(platformDefaults("linux").sounds.finished).toEndWith("message.oga")
  expect(platformDefaults("darwin").players).toEqual(["afplay"])
  expect(platformDefaults("darwin").sounds.error).toBe("/System/Library/Sounds/Basso.aiff")
})

test("player args: volume flag only for players with a 0–1 volume", () => {
  expect(playerArgs("pw-play", "a.oga", "0.50")).toEqual(["--volume", "0.50", "a.oga"])
  expect(playerArgs("/usr/bin/afplay", "a.aiff", "0.50")).toEqual(["-v", "0.50", "a.aiff"])
  expect(playerArgs("paplay", "a.oga", "0.50")).toEqual(["a.oga"])
  expect(playerArgs("pw-play", "a.oga")).toEqual(["a.oga"])
})
