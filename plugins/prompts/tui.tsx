// Saved prompts for pasode, from the Paseo daemon plugin Prompt Manager (paseo-prompt-manager): a row of buttons at the
// top of each chat, a picker, and one slash command per prompt. Choosing a prompt fills in its {{ variables }} (one
// box each, prefilled with the default) and sends it to the chat, as the Paseo apps' "Send to agent" does.
//
//   approved   yes   continue   complete-code-review   +
//
// While the chat is idle or waiting on you, a click sends. While a turn runs, the first click arms the button ("click
// again") and a second click within 4 s sends it, steering the turn; a stray click does nothing.
//
// Commands: /prompts or ctrl+x i opens the picker; /p:<id> sends that prompt (e.g. /p:approved). There's no
// "/prompt <id>" because pasode sends a slash command with arguments to the agent as text.
//
// Options (cli.json: ["~/pasode-plugins/plugins/prompts", { ... }]):
//   tag       prompts with this tag become buttons; while none has it, all do. Default "quick".
//   buttons   prompt ids to show as buttons, in order; overrides the tag.
//   row       false hides the button row (default true).
//   commands  false skips the /p:<id> commands (default true).
//   prefix    the per-prompt command prefix (default "p:").
//   plugin    the Prompt Manager plugin id on the daemon (default "paseo-prompt-manager").
import { createSignal, For, onCleanup, Show } from "solid-js"
import type { PasodePlugin } from "@pasode/host"
import { buttonPrompts, clickAction, type PromptSummary } from "./model"
import { fillTemplate, parseVariables } from "./templates"

const REFRESH_MS = 60_000

type Prompt = PromptSummary & { content: string }

export default {
  id: "prompts",
  setup(ctx) {
    const options = ctx.options as { tag?: string; buttons?: string[]; row?: boolean; commands?: boolean; prefix?: string; plugin?: string }
    const pluginId = options.plugin ?? "paseo-prompt-manager"
    const tag = options.tag ?? "quick"
    const prefix = options.prefix ?? "p:"
    const rpc = <T,>(method: string, input: Record<string, unknown>) => ctx.paseo.daemon.invokePluginRpc(pluginId, method, input) as Promise<T>

    const [library, setLibrary] = createSignal<PromptSummary[]>([])
    const [armed, setArmed] = createSignal<{ id: string; at: number }>()
    const [hover, setHover] = createSignal<string>()

    // Per-prompt slash commands follow the library; ids with "/" (folders) use "." since "/" ends a slash command.
    let unregister: (() => void) | undefined
    const registerPromptCommands = (list: PromptSummary[]) => {
      unregister?.()
      if (options.commands === false) return
      unregister = ctx.commands.register(list.filter((p) => !p.archived).map((prompt) => ({
        id: `prompts.send.${prompt.id}`,
        title: `Send prompt: ${prompt.title}`,
        category: "Prompts",
        slash: `${prefix}${prompt.id.replaceAll("/", ".")}`,
        hidden: true, // in the "/" completion, not the palette (the picker covers that)
        run: () => void use(prompt.id),
      })))
    }

    async function refresh() {
      const list = await rpc<PromptSummary[]>("prompts.list", { query: "", archived: false }).catch(() => undefined)
      if (!list) return // Prompt Manager missing or the daemon away: keep what we had
      setLibrary(list)
      registerPromptCommands(list)
    }
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    onCleanup(() => { clearInterval(timer); unregister?.() })

    /** Reads the prompt, asks for its variables, and sends it to the chat on screen. */
    async function use(id: string) {
      const agent = ctx.paseo.current()
      if (!agent) return ctx.ui.toast("Open a chat first: prompts are sent to the chat on screen", "warning")
      let prompt: Prompt
      try {
        prompt = await rpc<Prompt>("prompts.read", { id })
      } catch (error) {
        return ctx.state.showError(error)
      }
      if (prompt.archived) return ctx.ui.toast(`"${prompt.title}" is archived: restore it in Prompt Manager first`, "warning")
      const values: Record<string, string> = {}
      for (const variable of parseVariables(prompt.content)) {
        const value = await ctx.ui.dialog.prompt({
          title: prompt.title,
          description: `{{ ${variable.name} }}${variable.fallback !== undefined ? "  (enter keeps the default)" : ""}`,
          value: variable.fallback ?? "",
        })
        if (value === undefined) return // esc cancels the whole prompt
        if (!value.trim() && variable.fallback === undefined) return ctx.ui.toast(`"${variable.name}" needs a value`, "warning")
        values[variable.name] = value
      }
      let text: string
      try {
        text = fillTemplate(prompt.content, values)
      } catch (error) {
        return ctx.state.showError(error)
      }
      // The same send as pasode's own: mid-turn it steers the running turn instead of interrupting it.
      const running = ctx.paseo.current()?.id === agent.id && ctx.paseo.current()?.status === "running"
      try {
        await ctx.paseo.api.agents.ref(agent.id).send(text, { messageId: crypto.randomUUID(), ...(running ? { activeTurnBehavior: "steer" as const } : {}) })
      } catch (error) {
        ctx.state.showError(error)
      }
    }

    async function openPicker() {
      await refresh()
      const list = library().filter((p) => !p.archived)
      if (!list.length) return ctx.ui.toast(`No saved prompts (is ${pluginId} installed on the daemon?)`, "warning")
      const id = await ctx.ui.dialog.select<string>({
        title: "Prompts",
        placeholder: "Search prompts",
        size: "large",
        options: list.map((prompt) => ({
          title: prompt.title,
          description: prompt.description || undefined,
          footer: [prompt.folder, ...prompt.tags.map((t) => `#${t}`)].filter(Boolean).join(" "),
          category: prompt.folder || undefined,
          value: prompt.id,
        })),
      })
      if (id) void use(id)
    }

    function click(id: string) {
      const running = ctx.paseo.current()?.status === "running"
      const action = clickAction({ id, running, armed: armed(), now: Date.now() })
      if (action === "arm") {
        setArmed({ id, at: Date.now() })
        setTimeout(() => { if (armed()?.id === id) setArmed(undefined) }, 4000)
        return
      }
      setArmed(undefined)
      void use(id)
    }

    function Button(props: { id: string; label: string; onClick: () => void }) {
      const isArmed = () => armed()?.id === props.id
      return (
        <box
          flexShrink={0}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={isArmed() ? ctx.theme.warning : hover() === props.id ? ctx.theme.backgroundElement : ctx.theme.backgroundPanel}
          onMouseOver={() => setHover(props.id)}
          onMouseOut={() => hover() === props.id && setHover(undefined)}
          onMouseUp={props.onClick}
        >
          <text fg={isArmed() ? ctx.theme.background : hover() === props.id ? ctx.theme.text : ctx.theme.textMuted} wrapMode="none">
            {isArmed() ? `${props.label}: click again` : props.label}
          </text>
        </box>
      )
    }

    if (options.row !== false) {
      onCleanup(ctx.ui.slot("session_header", () => {
        const buttons = () => buttonPrompts(library(), { buttons: options.buttons, tag })
        return (
          <Show when={buttons().length}>
            <box flexDirection="row" flexShrink={0} gap={1} paddingLeft={1} paddingBottom={1} overflow="hidden">
              <For each={buttons()}>{(prompt) => <Button id={prompt.id} label={prompt.title} onClick={() => click(prompt.id)} />}</For>
              <Button id="+" label="+" onClick={() => void openPicker()} />
            </box>
          </Show>
        )
      }, 300))
    }

    ctx.commands.register([
      { id: "prompts.open", title: "Saved prompts", category: "Prompts", keybind: "<leader>i", slash: "prompts", run: () => void openPicker() },
    ])
  },
} satisfies PasodePlugin
