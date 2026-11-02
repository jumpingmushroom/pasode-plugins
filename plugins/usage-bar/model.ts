// Pure helpers for the usage bar: which windows to show and how to draw them. No UI, no daemon.

/** The parts of a Paseo usage window this plugin reads (listUsageReports / listProviderUsage). */
export type UsageWindow = {
  id: string
  label: string
  shortLabel?: string | null
  summary?: boolean | null
  usedPct?: number | null
  remainingPct?: number | null
  resetsAt?: string | null
}
type Report = { status: string; windows?: UsageWindow[] | null }
export type UsageEntry = { sourceId: string; report: Report; lastSuccessful?: { report: Report } | null }

export type Level = "ok" | "warn" | "high"
export type Segment = { label: string; used: number; countdown?: string; level: Level; stale: boolean }

/** Thresholds for the color: below warn is ok, below high is warn, else high. */
export const LEVELS = { warn: 50, high: 80 }

export function level(used: number): Level {
  return used >= LEVELS.high ? "high" : used >= LEVELS.warn ? "warn" : "ok"
}

/** "2h48m", or "2d14h" from a day up. Adapted from pasode's custom-plugins/usage-sidebar (MIT, ragokan). */
export function formatReset(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  return minutes >= 1440 ? `${Math.floor(minutes / 1440)}d${Math.floor(minutes / 60) % 24}h` : `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

/**
 * The summary windows (5h session, weekly) of a provider's first usage report. Per-model extras such as
 * "Weekly · Fable" are skipped. While the latest poll fails, the last good reading is used and marked stale.
 */
export function segments(entries: UsageEntry[] | undefined, provider: string, now = Date.now()): Segment[] {
  const entry = entries?.find((e) => e.sourceId === provider)
  if (!entry) return []
  let report: Report | undefined = entry.report
  let stale = false
  if (report.status !== "available") {
    report = entry.lastSuccessful?.report
    stale = true
  }
  if (report?.status !== "available") return []
  const windows = report.windows ?? []
  const picked = windows.some((w) => w.summary) ? windows.filter((w) => w.summary) : windows.filter((w) => !/fable/i.test(w.label))
  return picked.flatMap((w) => {
    let used = w.usedPct ?? (w.remainingPct == null ? undefined : 100 - w.remainingPct)
    if (used == null || !Number.isFinite(used)) return []
    const reset = Date.parse(w.resetsAt ?? "")
    if (Number.isFinite(reset) && reset <= now) used = 0 // the window rolled over since the reading
    used = Math.max(0, Math.min(100, used))
    return [{
      label: w.shortLabel || w.label,
      used,
      countdown: Number.isFinite(reset) && reset > now ? formatReset(reset - now) : undefined,
      level: level(used),
      stale,
    }]
  })
}

const PARTIAL = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]

/** A `width`-cell bar: filled part in eighth-blocks, the rest returned separately so it can be dimmed. */
export function bar(used: number, width: number): { filled: string; empty: string } {
  const eighths = Math.round((Math.max(0, Math.min(100, used)) / 100) * width * 8)
  const full = Math.floor(eighths / 8)
  const partial = PARTIAL[eighths % 8] ?? ""
  const filled = "█".repeat(full) + partial
  return { filled, empty: "░".repeat(Math.max(0, width - full - (partial ? 1 : 0))) }
}

// ── Daemon host (the Paseo plugin "host-monitor", RPC host.stats) ──

/** The parts of host-monitor's host.stats reply this plugin reads. */
export type HostStats = {
  hostname: string
  platform: string
  current: { cpuPercent: number; memoryPercent: number }
  disks: { mount: string; totalBytes: number; usedBytes: number; availableBytes: number }[]
}
export type HostSegment = { label: string; percent: number; level: Level }

/** Host thresholds: CPU and memory get busy later than a disk gets full. */
export const HOST_LEVELS = { cpu: { warn: 70, high: 90 }, mem: { warn: 75, high: 90 }, disk: { warn: 80, high: 90 } }

const hostLevel = (percent: number, at: { warn: number; high: number }): Level =>
  percent >= at.high ? "high" : percent >= at.warn ? "warn" : "ok"

/** Used share of a disk as `df` counts it: used / (used + available), so root-reserved blocks don't hide a full disk. */
export function diskPercent(disk: HostStats["disks"][number]) {
  const usable = disk.usedBytes + disk.availableBytes
  return usable > 0 ? (disk.usedBytes / usable) * 100 : 0
}

/** "Unraid" when the daemon runs on Unraid, else its hostname. */
export function hostName(stats: Pick<HostStats, "hostname" | "platform">) {
  return /unraid/i.test(stats.platform) ? "Unraid" : stats.hostname
}

/**
 * CPU, memory, and disks: the listed mounts when `mounts` is given, else only the fullest disk (the one to watch).
 */
export function hostSegments(stats: HostStats, mounts?: string[]): HostSegment[] {
  const cpu = Math.max(0, Math.min(100, stats.current.cpuPercent))
  const mem = Math.max(0, Math.min(100, stats.current.memoryPercent))
  const segments: HostSegment[] = [
    { label: "cpu", percent: cpu, level: hostLevel(cpu, HOST_LEVELS.cpu) },
    { label: "mem", percent: mem, level: hostLevel(mem, HOST_LEVELS.mem) },
  ]
  const disks = mounts?.length
    ? mounts.flatMap((mount) => stats.disks.filter((d) => d.mount === mount))
    : stats.disks.toSorted((a, b) => diskPercent(b) - diskPercent(a)).slice(0, 1)
  for (const disk of disks) {
    const percent = diskPercent(disk)
    segments.push({ label: disk.mount, percent, level: hostLevel(percent, HOST_LEVELS.disk) })
  }
  return segments
}
