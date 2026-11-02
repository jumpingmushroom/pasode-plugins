// Prompt variables, ported from Paseo Prompt Manager (https://github.com/yannelli/paseo-prompt-manager),
// shared/templates.ts and the parts of shared/markdown.ts it needs, so prompts fill in exactly as in the Paseo apps:
// `{{ name }}` or `{{ name | default }}`, never inside code spans or fenced code, and `\{{ name }}` for literal braces.
//
// MIT License. Copyright (c) 2026 Ryan Yannelli.
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright
// notice and this permission notice shall be included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

export type TemplateVariable = { name: string; fallback?: string }

const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/
const headingPattern = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/
const listPattern = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/
const rulePattern = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/
const quotePattern = /^ {0,3}>\s?(.*)$/
// Both parsers require matching backtick runs and allow other runs inside a span.
// A run without a closing run is still matched whole, so no span starts inside it.
const codeSpanSource = String.raw`(?<codeFence>\`+)(?!\`)(?:((?:[^\`]|(?!\k<codeFence>(?!\`))\`+(?!\`))*?)\k<codeFence>(?!\`))?`
const codeSpanPattern = new RegExp(String.raw`\\[\s\S]|` + codeSpanSource, "g")
// Letters, digits, `_` and `-`, with single spaces between words. Code such as `{{ .Values.x }}` does not match.
const variableName = String.raw`[A-Za-z_À-￿][\wÀ-￿-]*(?: [\wÀ-￿-]+)*`
/** `{{ name }}` or `{{ name | default }}`, capturing the name and the default. */
const variableSource = String.raw`\{\{\s*(${variableName})\s*(?:\|\s*([^{}\`\n]*?)\s*)?\}\}`
// An escaped backslash, which keeps the next braces a variable, or a variable whose braces a backslash may escape.
const variablePattern = new RegExp(String.raw`\\\\|(\\)?` + variableSource, "g")

type CodeSplit = { text: string; code: boolean }

function closingFence(fence: string) {
  return new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`)
}

function startsBlock(line: string) {
  return fencePattern.test(line) || headingPattern.test(line) || rulePattern.test(line) || listPattern.test(line) || quotePattern.test(line)
}

/** The content split into code (fenced blocks, code spans) and text, joining back into the content. */
export function splitCode(content: string): CodeSplit[] {
  const parts: CodeSplit[] = []
  const add = (text: string, code: boolean) => { if (text) parts.push({ text, code }) }
  const addText = (text: string) => {
    let offset = 0
    for (const match of text.matchAll(codeSpanPattern)) {
      if (match[2] === undefined) continue
      add(text.slice(offset, match.index), false)
      add(match[0], true)
      offset = match.index! + match[0].length
    }
    add(text.slice(offset), false)
  }
  // Each line keeps its line ending, so the parts join back into the content.
  const lines = content.match(/[^\r\n]*(?:\r\n?|\n|$)/g) ?? []
  const bare = (line: string) => line.replace(/\r?\n?$/, "")
  let index = 0
  while (index < lines.length) {
    const line = bare(lines[index]!)
    const fence = line.match(fencePattern)
    if (fence) {
      const closing = closingFence(fence[1]!)
      let code = lines[index++]!
      while (index < lines.length && !closing.test(bare(lines[index]!))) code += lines[index++]
      if (index < lines.length) code += lines[index++]
      add(code, true)
      continue
    }
    let text = lines[index++]!
    if (!line.trim()) {
      add(text, false)
      continue
    }
    if (quotePattern.test(line)) {
      while (index < lines.length && quotePattern.test(bare(lines[index]!))) text += lines[index++]
    } else if (!startsBlock(line)) {
      while (index < lines.length && bare(lines[index]!).trim() && !startsBlock(bare(lines[index]!))) text += lines[index++]
    }
    addText(text)
  }
  return parts
}

/** Variables outside code, in order of first use, one per name. The first default given for a name wins. */
export function parseVariables(content: string): TemplateVariable[] {
  const variables = new Map<string, TemplateVariable>()
  for (const part of splitCode(content)) {
    if (part.code) continue
    for (const [, escaped, name, fallback] of part.text.matchAll(variablePattern)) {
      if (escaped || name === undefined) continue
      const known = variables.get(name)
      if (!known) variables.set(name, fallback === undefined ? { name } : { name, fallback })
      else if (known.fallback === undefined && fallback !== undefined) known.fallback = fallback
    }
  }
  return [...variables.values()]
}

/** Replaces each variable with its value, or its default when no value is given. Code is left as written. */
export function fillTemplate(content: string, values: Record<string, string>): string {
  const given = new Map(Object.entries(values))
  const fallbacks = new Map(parseVariables(content).map((variable) => [variable.name, variable.fallback]))
  return splitCode(content).map((part) => part.code ? part.text : part.text.replace(variablePattern, (match, escaped: string | undefined, name: string | undefined) => {
    if (name === undefined) return match
    if (escaped) return match.slice(1)
    const value = given.get(name) ?? fallbacks.get(name)
    if (value === undefined) throw new Error(`Enter a value for "${name}".`)
    return value
  })).join("")
}
