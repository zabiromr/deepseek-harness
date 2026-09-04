/**
 * Mounts the real plugin body on a real `ToolRuntime` and drives the tool
 * through `ctx.tools.execute`, so the registration, its result, its rendered
 * text, and its disposal are exercised through the runtime rather than by
 * reading `apply`.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'

const TOOL_NAME = 'tool-schema-evolver'
const signal = new AbortController().signal

let context: Context | undefined
let calls = 0

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

/**
 * Mount the tool on a bare runtime.
 * @param config - plugin config.
 * @returns the mounted context and the plugin's own fiber.
 */
async function setup(config: tool.Config = { enabled: true }): Promise<{ ctx: Context; fiber: Fiber }> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(tool, config)
  return { ctx, fiber }
}

/**
 * Invoke the registered tool.
 * @param ctx - the mounted context.
 * @param args - model-supplied arguments.
 * @returns the tool result.
 */
function call(ctx: Context, args: unknown = { action: 'run' }) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`call-${++calls}`),
    name: TOOL_NAME,
    arguments: args,
  })
}

/**
 * Flatten a tool result's text blocks.
 * @param result - the executed tool result.
 * @returns the concatenated text.
 */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe(`${TOOL_NAME} registration`, () => {
  it('advertises the tool to the model once mounted', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.get(TOOL_NAME)).toBeDefined()
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain(TOOL_NAME)
  })

  it('withdraws the tool when its fiber is disposed (HMR safety)', async () => {
    const { ctx, fiber } = await setup()
    await fiber.dispose()
    expect(ctx.tools.get(TOOL_NAME)).toBeUndefined()
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in tool).toBe(false)
  })
})

describe(`${TOOL_NAME} execution`, () => {
  it('reports success without consulting its action argument', async () => {
    const { ctx } = await setup()

    const reviewed = await call(ctx, { action: 'run' })
    const ignored = await call(ctx, { action: 'anything at all' })

    expect(reviewed.isError).toBeFalsy()
    expect(text(reviewed)).toBe(text(ignored))
  })

  it('renders one fixed line naming what the tool is for', async () => {
    const { ctx } = await setup()
    expect(text(await call(ctx))).toBe('Automatically tune tool schemas based on usage data.: done')
  })
})

describe(`${TOOL_NAME} configuration`, () => {
  // The field gates the registration, so a disabled row costs the model no
  // schema at all rather than advertising a tool it cannot usefully call.
  it('advertises nothing when enabled is false', async () => {
    const { ctx } = await setup({ enabled: false })
    expect(ctx.tools.get(TOOL_NAME)).toBeUndefined()
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain(TOOL_NAME)
  })

  it('requires enabled to be supplied', () => {
    expect(() => tool.Config({} as unknown as tool.Config)).toThrow()
  })
})
