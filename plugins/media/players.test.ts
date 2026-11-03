import { expect, test } from "bun:test"
import { createPlayers } from "./players"

const SEP = "\u001f"
const line = (player: string, status: string, position = "0", title = "t") => [player, status, "100000000", position, "", "", "a", title].join(SEP)

test("follows lines per player and shows the one that started playing last", () => {
  let now = 0
  const players = createPlayers(() => now)
  now = 1
  players.apply(line("a", "Playing"))
  now = 2
  players.apply(line("b", "Playing"))
  expect(players.current()?.player).toBe("b")
  now = 3
  players.apply(line("b", "Paused"))
  expect(players.current()?.player).toBe("a")
})

test("position ticks update the shown track without changing which player is shown", () => {
  let now = 0
  const players = createPlayers(() => now)
  players.apply(line("a", "Playing", "1000000"))
  now = 5
  players.apply(line("b", "Paused"))
  now = 6
  players.apply(line("a", "Playing", "2000000"))
  expect(players.current()).toMatchObject({ player: "a", position: 2 })
})

test("keep drops players that closed; a stopped player is not shown", () => {
  const players = createPlayers(() => 0)
  players.apply(line("a", "Paused"))
  players.apply(line("b", "Playing"))
  players.keep(["a"])
  expect(players.current()?.player).toBe("a")
  players.apply(line("a", "Stopped"))
  expect(players.current()).toBeUndefined()
})

test("malformed lines are ignored, and apply says whether anything changed", () => {
  const players = createPlayers(() => 0)
  expect(players.apply("")).toBe(false)
  expect(players.apply(line("a", "Playing"))).toBe(true)
  expect(players.current()?.player).toBe("a")
})
