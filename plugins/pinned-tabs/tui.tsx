// Pinned chats as the tab bar at the top of pasode's chats. The tabs are the chats you pinned in Paseo (in any app),
// in the order you pinned them, plus the chat on screen as a temporary tab at the end when it isn't pinned.
// Pin or unpin in the desktop app, on the phone, or in pasode's chat switcher, and the bar follows.
//
// Replaces pasode's own tab bar, which lists every chat opened in this pasode: turn that off with "Session tabs"
// in the settings (ctrl+p, "Open settings"). Until then this plugin stays hidden, so the two bars and their keys don't clash.
//
// Keys: ctrl+x 1–9 opens pinned chat 1–9; ctrl+x . and ctrl+x , open the next and previous pinned chat.
import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import type { PasodePlugin } from "@pasode/host"
import { barTabs, cycle, pinnedChats, tabLayout, TAB_BAR_MIN_COLUMNS, type Chat, type Tab } from "./model"

/** Above the other session_header rows, right where pasode's own bar sits. */
const ORDER = -100

export default {
  id: "pinned-tabs",
  setup(ctx) {
    const { theme } = ctx
    const { agents, workspacePins, ownWorkspace, sessionTitle, agentId, navigate } = ctx.paseo
    const { Spinner, truncate } = ctx.ui.components
    const on = () => !ctx.state.prefs.tabs

    const pinned = createMemo(() => pinnedChats(agents as Record<string, Chat>, workspacePins, (agent) => ownWorkspace(agents[agent.id]!)))
    const tabs = createMemo(() => barTabs(pinned(), agentId()))

    const step = (direction: 1 | -1) => () => {
      const id = cycle(pinned(), agentId(), direction)
      if (id) navigate(id)
    }
    const many = () => on() && pinned().length > 0 && tabs().length > 1
    onCleanup(
      ctx.commands.register([
        { id: "pinned-tabs.next", title: "Next pinned chat", category: "Session", keybind: "<leader>.", enabled: many, run: step(1) },
        { id: "pinned-tabs.previous", title: "Previous pinned chat", category: "Session", keybind: "<leader>,", enabled: many, run: step(-1) },
        ...Array.from({ length: 9 }, (_, index) => ({
          id: `pinned-tabs.select.${index + 1}`,
          title: `Open pinned chat ${index + 1}`,
          category: "Session",
          keybind: `<leader>${index + 1}`,
          hidden: true,
          enabled: () => on() && !!pinned()[index],
          run: () => navigate(pinned()[index]),
        })),
      ]),
    )

    type Marker = "permission" | "running" | "error" | "unread"

    function TabView(props: { tab: Tab; width: number }) {
      const active = () => props.tab.id === agentId()
      const marker = createMemo((): Marker | undefined => {
        const agent = agents[props.tab.id]
        if (agent?.pendingPermissions?.length) return "permission"
        if (agent?.status === "running") return "running"
        if (agent?.status === "error") return "error"
        if (agent?.requiresAttention && !active()) return "unread"
      })
      const prefix = () => (props.tab.number ? `${props.tab.number} ` : "")
      const title = () => truncate((agents[props.tab.id] && sessionTitle(agents[props.tab.id]!)) || "Untitled", props.width - 3 - prefix().length)
      const attributes = () => (active() ? TextAttributes.BOLD : 0) | (props.tab.temporary ? TextAttributes.ITALIC : 0)
      return (
        <box width={props.width} height={1} flexShrink={0} flexDirection="row" paddingLeft={1} backgroundColor={active() ? theme.backgroundElement : undefined} onMouseUp={() => navigate(props.tab.id)}>
          <text flexGrow={1} wrapMode="none" fg={active() ? theme.text : theme.textMuted} attributes={attributes() || undefined}>
            {prefix()}
            {title()}
          </text>
          <box width={2} flexShrink={0} paddingRight={1}>
            <Switch>
              <Match when={marker() === "permission"}>
                <text fg={theme.warning}>△</text>
              </Match>
              <Match when={marker() === "running"}>
                <Spinner color={theme.primary} />
              </Match>
              <Match when={marker() === "error"}>
                <text fg={theme.error}>✕</text>
              </Match>
              <Match when={marker() === "unread"}>
                <text fg={theme.success}>●</text>
              </Match>
            </Switch>
          </box>
        </box>
      )
    }

    function Bar() {
      const [width, setWidth] = createSignal(0)
      let start = 0
      // Like pasode's bar: hidden when it would only show the chat on screen.
      const shown = () => on() && width() >= TAB_BAR_MIN_COLUMNS && tabs().length > 1
      const layout = createMemo(() => {
        const list = tabs()
        const result = tabLayout(list.length, list.findIndex((tab) => tab.id === agentId()), width(), start)
        start = result.start
        return result
      })
      const visible = createMemo(() => tabs().slice(layout().start, layout().start + layout().shown))
      return (
        <box width="100%" height={shown() ? 1 : 0} flexShrink={0} flexDirection="row" overflow="hidden" onSizeChange={function () { setWidth(this.width) }}>
          <Show when={shown()}>
            <Show when={layout().before}>
              <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>{`‹${layout().before} `}</text>
            </Show>
            <For each={visible()}>{(tab) => <TabView tab={tab} width={layout().width} />}</For>
            <Show when={layout().after}>
              <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>{` ${layout().after}›`}</text>
            </Show>
          </Show>
        </box>
      )
    }

    onCleanup(ctx.ui.slot("session_header", () => <Bar />, ORDER))
  },
} satisfies PasodePlugin
