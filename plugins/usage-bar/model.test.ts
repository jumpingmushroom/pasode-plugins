import { expect, test } from "bun:test"
import { bar, formatReset, level, segments, type UsageEntry } from "./model"

const now = Date.parse("2026-11-02T11:12:00Z")
const claude = (status = "available", lastGood?: UsageEntry["report"]): UsageEntry => ({
  sourceId: "claude",
  report: {
    status,
    windows: [
      { id: "five_hour", label: "Session", shortLabel: "5h", summary: true, usedPct: 9, resetsAt: "2026-11-02T14:00:00Z" },
      { id: "weekly", label: "Weekly", shortLabel: "wk", summary: true, usedPct: 11, resetsAt: "2026-11-05T02:00:00Z" },
      { id: "weekly_model_fable", label: "Weekly · Fable", shortLabel: "wk Fable", usedPct: 0, resetsAt: "2026-11-05T02:00:00Z" },
    ],
  },
  ...(lastGood ? { lastSuccessful: { report: lastGood } } : {}),
})

test("summary windows only, with countdowns and levels", () => {
  expect(segments([claude()], "claude", now)).toEqual([
    { label: "5h", used: 9, countdown: "2h48m", level: "ok", stale: false },
    { label: "wk", used: 11, countdown: "2d14h", level: "ok", stale: false },
  ])
})

test("unknown provider or no report gives nothing", () => {
  expect(segments([claude()], "codex", now)).toEqual([])
  expect(segments(undefined, "claude", now)).toEqual([])
})

test("failed poll falls back to the last good reading, marked stale", () => {
  const good = claude().report
  const result = segments([claude("error", good)], "claude", now)
  expect(result.map((s) => s.stale)).toEqual([true, true])
  expect(segments([claude("error")], "claude", now)).toEqual([])
})

test("an expired window reads 0% with no countdown; remainingPct works without usedPct", () => {
  const entry: UsageEntry = { sourceId: "claude", report: { status: "available", windows: [
    { id: "a", label: "Old", shortLabel: "5h", summary: true, usedPct: 70, resetsAt: "2026-11-02T10:00:00Z" },
    { id: "b", label: "Weekly", shortLabel: "wk", summary: true, remainingPct: 15, resetsAt: null },
  ] } }
  expect(segments([entry], "claude", now)).toEqual([
    { label: "5h", used: 0, countdown: undefined, level: "ok", stale: false },
    { label: "wk", used: 85, countdown: undefined, level: "high", stale: false },
  ])
})

test("without summary flags, per-model Fable windows are dropped", () => {
  const entry: UsageEntry = { sourceId: "claude", report: { status: "available", windows: [
    { id: "w", label: "Weekly", usedPct: 40 },
    { id: "f", label: "Weekly · Fable", usedPct: 99 },
  ] } }
  expect(segments([entry], "claude", now).map((s) => s.label)).toEqual(["Weekly"])
})

test("levels and reset formatting", () => {
  expect([level(0), level(49.9), level(50), level(79), level(80), level(100)]).toEqual(["ok", "ok", "warn", "warn", "high", "high"])
  expect(formatReset(5 * 60_000)).toBe("0h5m")
  expect(formatReset(26 * 3600_000)).toBe("1d2h")
})

test("bar keeps its width and uses eighth-blocks", () => {
  for (const used of [0, 9, 11, 50, 99, 100]) {
    const b = bar(used, 10)
    expect(b.filled.length + b.empty.length).toBe(10)
  }
  expect(bar(0, 10)).toEqual({ filled: "", empty: "░".repeat(10) })
  expect(bar(100, 10)).toEqual({ filled: "█".repeat(10), empty: "" })
  expect(bar(50, 10)).toEqual({ filled: "█████", empty: "░░░░░" })
  expect(bar(9, 10).filled).toBe("▉") // 9% of 10 cells = 0.9 cell ≈ 7/8
  expect(bar(5, 10).filled).toBe("▌") // 0.5 cell = 4/8
})

import { diskPercent, hostName, hostSegments, type HostStats } from "./model"

const stats: HostStats = {
  hostname: "paseo",
  platform: "Linux 6.18.38-Unraid",
  current: { cpuPercent: 11.7, memoryPercent: 25.2 },
  disks: [
    { mount: "/", totalBytes: 214748364800, usedBytes: 122485506048, availableBytes: 88663080960 },
    { mount: "/config", totalBytes: 1000203837440, usedBytes: 832530407424, availableBytes: 165733425152 },
  ],
}

test("host name: Unraid by platform, else the hostname", () => {
  expect(hostName(stats)).toBe("Unraid")
  expect(hostName({ hostname: "box", platform: "Linux 6.1" })).toBe("box")
})

test("disk percent counts reserved blocks as unavailable, like df", () => {
  expect(Math.round(diskPercent(stats.disks[1]!))).toBe(83)
  expect(diskPercent({ mount: "/x", totalBytes: 0, usedBytes: 0, availableBytes: 0 })).toBe(0)
})

test("host segments: cpu, mem, then the fullest disk by default, or the listed mounts", () => {
  expect(hostSegments(stats).map((s) => [s.label, Math.round(s.percent), s.level])).toEqual([
    ["cpu", 12, "ok"], ["mem", 25, "ok"], ["/config", 83, "warn"],
  ])
  expect(hostSegments(stats, ["/", "/missing"]).map((s) => s.label)).toEqual(["cpu", "mem", "/"])
  const busy = { ...stats, current: { cpuPercent: 95, memoryPercent: 80 } }
  expect(hostSegments(busy).slice(0, 2).map((s) => s.level)).toEqual(["high", "warn"])
})
