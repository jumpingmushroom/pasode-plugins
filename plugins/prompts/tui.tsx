// Saved prompts for pasode, from the Paseo daemon plugin Prompt Manager (paseo-prompt-manager): a row of buttons at the
// top of each chat, a picker that also creates and edits prompts, and one slash command per prompt. Choosing a prompt
// fills in its {{ variables }} (one box each, prefilled with the default) and sends it to the chat, as the Paseo apps'
// "Send to agent" does.
//
//   Prompt Manager:  approved   yes   continue   complete-code-review   +2
//
// While the chat is idle or waiting on you, a click sends. While a turn runs, the first click arms the button ("click
// again") and a second click within 4 s sends it, steering the turn; a stray click does nothing.
//
// Picker (ctrl+x i, /prompts, or the row's "+"): enter sends; ctrl+n new prompt; ctrl+e edit in $EDITOR; ctrl+f toggle
// the quick tag (on/off the button row); ctrl+d twice archives. Edits go through Prompt Manager, which keeps version
// history and refuses a save when the prompt changed elsewhere since it was opened (the draft file is kept then).
//
// Commands: /prompts, /prompt-new, and /p:<id> per prompt (e.g. /p:approved). There's no "/prompt <id>" because pasode
// sends a slash command with arguments to the agent as text.
//
// Options (cli.json: ["~/pasode-plugins/plugins/prompts", { ... }]):
//   label     text before the buttons (default "Prompt Manager:"; "" hides it).
//   sort      button and picker order: "used" (default), "recent", "title", or "library".
//   max       buttons shown before "+N" (default 6).
//   tag       prompts with this tag become buttons; while none has it, all do. Default "quick".
//   buttons   prompt ids to show as buttons, in this order; overrides tag and sort.
//   row       false hides the button row (default true).
//   commands  false skips the /p:<id> commands (default true).
//   prefix    the per-prompt command prefix (default "p:").
//   plugin    the Prompt Manager plugin id on the daemon (default "paseo-prompt-manager").
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSignal, For, onCleanup, Show } from "solid-js"
import type { PasodePlugin } from "@pasode/host"
import {
  buttonPrompts, clickAction, parseEditable, recordUse, rowLayout, serializeEditable, SORT_MODES, sortPrompts, toggleTag,
  type PromptSummary, type SortMode, type Usage,
} from "./model"
import { fillTemplate, parseVariables } from "./templates"

const REFRESH_MS = 60_000
const stateFile = path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "pasode", "prompts.json")

type Prompt = PromptSummary & { content: string; description: string; folder: string; revision: string }
type Pick = { kind: "new" } | { kind: "prompt"; id: string }

export default {
  id: "prompts",
  setup(ctx) {
    const options = ctx.options as {
      label?: string; sort?: string; max?: number; tag?: string; buttons?: string[]; row?: boolean; commands?: boolean; prefix?: string; plugin?: string
    }
    const pluginId = options.plugin ?? "paseo-prompt-manager"
    const tag = options.tag ?? "quick"
    const prefix = options.prefix ?? "p:"
    const label = options.label ?? "Prompt Manager:"
    const sort: SortMode = SORT_MODES.includes(options.sort as SortMode) ? (options.sort as SortMode) : "used"
    const max = typeof options.max === "number" ? options.max : 6
    const rpc = <T,>(method: string, input: Record<string, unknown>) => ctx.paseo.daemon.invokePluginRpc(pluginId, method, input) as Promise<T>
    const { dialog } = ctx.ui
    const { DialogSelect } = ctx.ui.components

    const [library, setLibrary] = createSignal<PromptSummary[]>([])
    const [armed, setArmed] = createSignal<{ id: string; at: number }>()
    const [hover, setHover] = createSignal<string>()
    const [usage, setUsage] = createSignal<Usage>((() => {
      try { return JSON.parse(readFileSync(stateFile, "utf8")).usage ?? {} } catch { return {} }
    })())
    const remember = (id: string) => {
      const next = recordUse(usage(), id, new Date().toISOString())
      setUsage(next)
      try { mkdirSync(path.dirname(stateFile), { recursive: true }); writeFileSync(stateFile, JSON.stringify({ usage: next })) } catch {}
    }
    const sorted = () => sortPrompts(library().filter((p) => !p.archived), sort, usage())

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

    // ── Sending ──

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
        const value = await dialog.prompt({
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
        remember(id)
      } catch (error) {
        ctx.state.showError(error)
      }
    }

    // ── Editing (through Prompt Manager, which versions every save) ──

    /** Opens `text` in $VISUAL/$EDITOR like pasode's ctrl+x e. Returns the result and the file (kept until `done`). */
    async function editInEditor(text: string) {
      const directory = await mkdtemp(path.join(os.tmpdir(), "pasode-prompt-"))
      const file = path.join(directory, "prompt.md")
      await writeFile(file, text, { mode: 0o600 })
      const renderer = ctx.renderer
      renderer.suspend()
      renderer.currentRenderBuffer.clear()
      try {
        await new Promise<void>((resolve, reject) => {
          // The shell handles quoted editor paths and flags; the file is passed as $1, not interpolated.
          const child = spawn(process.env.SHELL || "/bin/sh", ["-c", `${process.env.VISUAL || process.env.EDITOR || "vi"} "$1"`, "pasode-prompt", file], { stdio: "inherit" })
          child.on("error", reject)
          child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Editor exited with ${signal || code}`)))
        })
        return { text: await readFile(file, "utf8"), file, done: () => rm(directory, { recursive: true, force: true }) }
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : error}; draft kept at ${file}`)
      } finally {
        renderer.currentRenderBuffer.clear()
        renderer.resume()
        renderer.requestRender()
      }
    }

    /** Saves through Prompt Manager; on failure the draft file stays and the error says where. */
    async function save(input: Record<string, unknown>, draft: { file: string; done: () => Promise<void> }, verb: string) {
      try {
        const saved = await rpc<Prompt>("prompts.save", input)
        await draft.done()
        ctx.ui.toast(`${verb} "${saved.title}"`, "success")
        await refresh()
      } catch (error) {
        ctx.state.showError(`${error instanceof Error ? error.message : error} Your draft is at ${draft.file}`)
      }
    }

    async function newPrompt() {
      const name = (await dialog.prompt({ title: "New prompt", description: "File name, e.g. code-review (letters, digits, - and _)", placeholder: "code-review" }))?.trim()
      if (!name) return
      let edited
      try {
        edited = await editInEditor(serializeEditable({ description: "", tags: [], content: `# ${name}\n\n` }))
      } catch (error) {
        return ctx.state.showError(error)
      }
      const parsed = parseEditable(edited.text)
      const body = parsed.content.replace(/^#[^\n]*\n?/, "").trim() // a lone heading isn't a prompt yet
      if (!body) {
        await edited.done()
        return ctx.ui.toast("Empty prompt, nothing saved", "info")
      }
      await save({ name, content: parsed.content, revision: null, description: parsed.description ?? "", tags: parsed.tags ?? [] }, edited, "Saved")
    }

    async function editPrompt(id: string) {
      let prompt: Prompt
      try {
        prompt = await rpc<Prompt>("prompts.read", { id })
      } catch (error) {
        return ctx.state.showError(error)
      }
      const original = serializeEditable({ description: prompt.description ?? "", tags: prompt.tags, content: prompt.content })
      let edited
      try {
        edited = await editInEditor(original)
      } catch (error) {
        return ctx.state.showError(error)
      }
      if (edited.text === original) {
        await edited.done()
        return ctx.ui.toast("No changes", "info")
      }
      const parsed = parseEditable(edited.text)
      if (!parsed.content.trim()) {
        return ctx.state.showError(`An empty prompt isn't saved; archive it instead (ctrl+d twice). Your draft is at ${edited.file}`)
      }
      // The revision read above makes Prompt Manager refuse the save if the prompt changed elsewhere meanwhile.
      await save({
        id, name: id.split("/").pop(), folder: prompt.folder, content: parsed.content, revision: prompt.revision,
        description: parsed.description ?? prompt.description ?? "", tags: parsed.tags ?? prompt.tags,
      }, edited, "Saved")
    }

    async function toggleQuick(id: string) {
      try {
        const prompt = await rpc<Prompt>("prompts.read", { id })
        const tags = toggleTag(prompt.tags, tag)
        await rpc("prompts.save", { id, name: id.split("/").pop(), folder: prompt.folder, content: prompt.content, revision: prompt.revision, description: prompt.description, tags })
        ctx.ui.toast(tags.includes(tag) ? `"${prompt.title}" is on the button row` : `"${prompt.title}" left the button row`, "success")
        await refresh()
      } catch (error) {
        ctx.state.showError(error)
      }
    }

    async function archive(id: string) {
      try {
        const prompt = await rpc<Prompt>("prompts.read", { id })
        await rpc("prompts.archive", { id, revision: prompt.revision })
        ctx.ui.toast(`Archived "${prompt.title}" (restore it in Prompt Manager)`, "success")
        await refresh()
      } catch (error) {
        ctx.state.showError(error)
      }
    }

    // ── Picker ──

    function Picker() {
      const [confirm, setConfirm] = createSignal<string>()
      const reopen = () => void openPicker(false)
      const run = (work: () => Promise<unknown>) => { dialog.clear(); void work().finally(reopen) }
      return (
        <DialogSelect<Pick>
          title="Prompts"
          placeholder="Search prompts"
          emptyText={`No saved prompts (is ${pluginId} installed on the daemon?)`}
          options={[
            { title: "New prompt…", description: "write it in your editor", category: "Add", value: { kind: "new" } },
            ...sorted().map((prompt) => ({
              title: confirm() === prompt.id ? "Press ctrl+d again to archive" : prompt.title,
              bg: confirm() === prompt.id ? ctx.theme.error : undefined,
              description: prompt.description || undefined,
              footer: prompt.tags.map((t) => `#${t}`).join(" "),
              category: "Prompts",
              value: { kind: "prompt", id: prompt.id } as Pick,
            })),
          ]}
          onMove={() => setConfirm(undefined)}
          onSelect={(option) => {
            dialog.clear()
            if (option.value.kind === "new") return void newPrompt().finally(reopen)
            void use(option.value.id)
          }}
          actions={[
            { label: "ctrl+n", title: "new", global: true, match: (key) => key.ctrl && key.name === "n", run: () => run(newPrompt) },
            { label: "ctrl+e", title: "edit", match: (key) => key.ctrl && key.name === "e", run: (option) => option.value.kind === "prompt" && run(() => editPrompt((option.value as { id: string }).id)) },
            { label: "ctrl+f", title: "quick", match: (key) => key.ctrl && key.name === "f", run: (option) => option.value.kind === "prompt" && run(() => toggleQuick((option.value as { id: string }).id)) },
            {
              label: "ctrl+d", title: "archive", match: (key) => key.ctrl && key.name === "d",
              run: (option) => {
                if (option.value.kind !== "prompt") return
                const id = option.value.id
                if (confirm() !== id) return setConfirm(id)
                run(() => archive(id))
              },
            },
          ]}
        />
      )
    }

    async function openPicker(reload = true) {
      if (reload) await refresh()
      dialog.replace(() => <Picker />, "large")
    }

    // ── Button row ──

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
        // An explicit buttons list keeps its own order; otherwise tag, then sort, then the max.
        const row = () => {
          const chosen = buttonPrompts(library(), { buttons: options.buttons, tag })
          return rowLayout(options.buttons?.length ? chosen : sortPrompts(chosen, sort, usage()), max)
        }
        return (
          <Show when={row().shown.length || row().more}>
            <box flexDirection="row" flexShrink={0} gap={1} paddingLeft={1} paddingBottom={1} overflow="hidden">
              <Show when={label}>
                <text fg={ctx.theme.textMuted} wrapMode="none" flexShrink={0}><b>{label}</b></text>
              </Show>
              <For each={row().shown}>{(prompt) => <Button id={prompt.id} label={prompt.title} onClick={() => click(prompt.id)} />}</For>
              <Button id="+" label={row().more ? `+${row().more}` : "+"} onClick={() => void openPicker()} />
            </box>
          </Show>
        )
      }, 300))
    }

    ctx.commands.register([
      { id: "prompts.open", title: "Saved prompts", category: "Prompts", keybind: "<leader>i", slash: "prompts", run: () => void openPicker() },
      { id: "prompts.new", title: "New saved prompt", category: "Prompts", slash: "prompt-new", run: () => void newPrompt() },
    ])
  },
} satisfies PasodePlugin
