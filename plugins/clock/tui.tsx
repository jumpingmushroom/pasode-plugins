// A big clock at the top of pasode's sidebar, right under the chat's title: HH:MM in block digits 3 lines tall,
// with the date below. Updates on the minute (or every second with seconds on).
//
// Options (cli.json: ["~/pasode-plugins/plugins/clock", { "locale": "en-GB" }]):
//   seconds  true adds small seconds after the minutes (default false).
//   date     false hides the date line (default true).
//   hour12   true shows a 12-hour clock with AM/PM (default false).
//   locale   the date's language, such as "nb-NO" (default) or "en-GB".
import { createSignal, For, onCleanup, Show } from "solid-js"
import type { PasodePlugin } from "@pasode/host"
import { bigText, clockParts, dateLine, msToNextTick, readOptions } from "./model"

/** Sorts before every other sidebar section, so the clock sits right under the title. */
const ORDER = -1000

export default {
  id: "clock",
  setup(ctx) {
    const options = readOptions(ctx.options)
    const { theme } = ctx

    // One shared clock for every sidebar, ticking exactly when the shown time changes.
    const [now, setNow] = createSignal(new Date())
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      const at = new Date()
      setNow(at)
      timer = setTimeout(tick, msToNextTick(at, options.seconds))
    }
    timer = setTimeout(tick, msToNextTick(new Date(), options.seconds))
    onCleanup(() => clearTimeout(timer))

    function Clock() {
      const parts = () => clockParts(now(), options)
      const extra = () => [parts().small, parts().suffix].filter(Boolean).join(" ")
      return (
        <box flexDirection="column" alignItems="center" flexShrink={0}>
          <box flexDirection="row" gap={1}>
            <box flexDirection="column">
              <For each={bigText(parts().big)}>{(row) => <text fg={theme.primary} wrapMode="none">{row}</text>}</For>
            </box>
            <Show when={extra()}>
              <box flexDirection="column" justifyContent="flex-end">
                <text fg={theme.textMuted} wrapMode="none">{extra()}</text>
              </box>
            </Show>
          </box>
          <Show when={options.date}>
            <text fg={theme.textMuted} wrapMode="none" truncate>{dateLine(now(), options.locale)}</text>
          </Show>
        </box>
      )
    }

    onCleanup(ctx.ui.slot("sidebar_content", () => <Clock />, ORDER))
  },
} satisfies PasodePlugin
