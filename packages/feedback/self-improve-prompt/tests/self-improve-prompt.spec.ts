/**
 * The guidance section: which advice each flag mounts, and that a composition
 * mounting no guidance contributes nothing rather than an empty heading.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as SelfImprovePrompt from '../src/index.ts'

const ALL = {
  showReflectionGuidance: true,
  showRestatementGuidance: true,
  showRecallGuidance: true,
}

const NONE = {
  showReflectionGuidance: false,
  showRestatementGuidance: false,
  showRecallGuidance: false,
}

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('getPromptSection', () => {
  it('mounts every block when the deployment asks for all of them', () => {
    const text = SelfImprovePrompt.getPromptSection(ALL)
    expect(text).toContain('# Recording lessons')
    expect(text).toContain('# Restating lessons')
    expect(text).toContain('# Searching past lessons')
  })

  it('mounts only the reflection block', () => {
    const text = SelfImprovePrompt.getPromptSection({ ...NONE, showReflectionGuidance: true })
    expect(text).toContain('# Recording lessons')
    expect(text).not.toContain('# Restating lessons')
  })

  it('mounts only the restatement block', () => {
    const text = SelfImprovePrompt.getPromptSection({ ...NONE, showRestatementGuidance: true })
    expect(text).toContain('# Restating lessons')
    expect(text).not.toContain('# Recording lessons')
  })

  it('mounts only the recall block', () => {
    const text = SelfImprovePrompt.getPromptSection({ ...NONE, showRecallGuidance: true })
    expect(text).toContain('# Searching past lessons')
    expect(text).not.toContain('# Recording lessons')
  })

  it('contributes nothing when every block is off', () => {
    expect(SelfImprovePrompt.getPromptSection(NONE)).toBe('')
  })

  it('states the evidence rule, which is what the capture tool enforces', () => {
    expect(SelfImprovePrompt.getPromptSection(ALL)).toContain('cite the session')
  })
})

describe('the mounted section', () => {
  it('contributes its guidance to an assembly', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SelfImprovePrompt, ALL)
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(entry => entry.name === 'self-improvement')
    expect(section?.text).toContain('# Recording lessons')
  })

  it('sits immediately after the digest it explains', () => {
    expect(SelfImprovePrompt.SELF_IMPROVE_SECTION_ORDER).toBeGreaterThan(-50)
    expect(SelfImprovePrompt.SELF_IMPROVE_SECTION_ORDER).toBeLessThan(-40)
  })

  it('removes its section when the plugin is disposed', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    const fiber = await ctx.plugin(SelfImprovePrompt, ALL)
    await fiber.dispose()
    await expect(ctx.plugin(SelfImprovePrompt, ALL).await()).resolves.toBeDefined()
  })
})
