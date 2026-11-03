// The players playerctl follows, keyed by instance: which one the sidebar shows, updated line by line.
import { parseLine, pick, track, type Player, type Track } from "./model"

export function createPlayers(now: () => number = Date.now) {
  const players = new Map<string, Player>()
  return {
    /** Applies one followed line; true when it was a player's state. */
    apply(line: string) {
      const next = parseLine(line)
      if (!next) return false
      players.set(next.player, track(players.get(next.player), next, now()))
      return true
    },
    /** Drops players that are gone (playerctl -l lists the live ones). */
    keep(names: string[]) {
      for (const name of [...players.keys()]) if (!names.includes(name)) players.delete(name)
    },
    current(): Track | undefined {
      return pick([...players.values()])?.track
    },
  }
}
