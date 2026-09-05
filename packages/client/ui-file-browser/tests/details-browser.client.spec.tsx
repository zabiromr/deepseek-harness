// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionFileVersion } from '@deepseek-ai/dsh-api-session-controller/client'
import { DetailsBrowser } from '../src/client/DetailsBrowser.tsx'
import type { DetailsBrowserComponentProps, FileBrowserEntry } from '../src/client/contract/slots.ts'
import { zh } from '../src/client/locale.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as DetailsBrowserComponentProps['t']

const ROOT = '/w'

const TREE: Record<string, readonly FileBrowserEntry[]> = {
  '/w': [
    { name: 'src', path: '/w/src', type: 'directory' },
    { name: 'README.md', path: '/w/README.md', type: 'file' },
    // A symlink resolves to a sibling's path: two rows, one path.
    { name: 'CLAUDE.md', path: '/w/README.md', type: 'file' },
  ],
  '/w/src': [{ name: 'a.ts', path: '/w/src/a.ts', type: 'file' }],
}

/**
 * Render the browser over an in-memory tree.
 * @param overrides - callbacks replacing the defaults built from TREE.
 * @returns the render result plus the spies the assertions read.
 */
function renderBrowser(overrides: Partial<DetailsBrowserComponentProps> = {}) {
  const listDirectory = vi.fn(async (path: string) => TREE[path] ?? null)
  const readFile = vi.fn(async (path: string) => ({
    content: `content of ${path}`, version: 'v1' as SessionFileVersion,
  }))
  const writeFile = vi.fn(async () => ({ kind: 'written', version: 'v2' as SessionFileVersion }))
  const openFilePath = vi.fn(async () => {})
  const props: DetailsBrowserComponentProps = {
    root: ROOT, listDirectory, readFile, writeFile, openFilePath, t, ...overrides,
  } as DetailsBrowserComponentProps
  return { ...render(<DetailsBrowser {...props} />), listDirectory, readFile, writeFile, openFilePath }
}

/** Let the pending listing or read promise settle into React state. */
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

describe('details file browser', () => {
  it('lists the workspace root and keeps rows whose paths collide', async () => {
    renderBrowser()
    await settle()

    expect(screen.getByText('src/')).toBeDefined()
    expect(screen.getAllByText('README.md')).toHaveLength(1)
    expect(screen.getByText('CLAUDE.md')).toBeDefined()
  })

  it('walks into a directory and back up to the root', async () => {
    const { listDirectory } = renderBrowser()
    await settle()

    fireEvent.click(screen.getByText('src/'))
    await settle()
    expect(screen.getByText('a.ts')).toBeDefined()

    fireEvent.click(screen.getByLabelText(zh['fileBrowser.back']))
    await settle()
    expect(screen.getByText('src/')).toBeDefined()
    expect(listDirectory.mock.calls.map(call => call[0])).toEqual(['/w', '/w/src', '/w'])
  })

  it('opens a file and writes an edited buffer back through the Remote', async () => {
    const { readFile, writeFile } = renderBrowser()
    await settle()

    fireEvent.click(screen.getByText('README.md'))
    await settle()
    expect(readFile).toHaveBeenCalledWith('/w/README.md')

    fireEvent.click(screen.getByLabelText(zh['fileBrowser.editAria']))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited' } })
    fireEvent.click(screen.getByLabelText(zh['fileBrowser.saveAria']))
    await settle()

    expect(writeFile).toHaveBeenCalledWith('/w/README.md', 'edited', 'v1')
  })

  it('reports a failed listing instead of an empty directory', async () => {
    renderBrowser({ listDirectory: vi.fn(async () => null) })
    await settle()

    expect(screen.getByText(zh['fileBrowser.listError'])).toBeDefined()
  })

  it('reports a failed read and stays on the listing', async () => {
    renderBrowser({ readFile: vi.fn(async () => null) })
    await settle()

    fireEvent.click(screen.getByText('README.md'))
    await settle()

    expect(screen.getByText(zh['fileBrowser.readError'])).toBeDefined()
    expect(screen.getByText('src/')).toBeDefined()
  })

  it('reports a refused write and keeps the buffer in edit mode', async () => {
    renderBrowser({ writeFile: vi.fn(async () => ({ kind: 'failed' as const })) })
    await settle()

    fireEvent.click(screen.getByText('README.md'))
    await settle()
    fireEvent.click(screen.getByLabelText(zh['fileBrowser.editAria']))
    fireEvent.click(screen.getByLabelText(zh['fileBrowser.saveAria']))
    await settle()

    expect(screen.getByText(zh['fileBrowser.writeError'])).toBeDefined()
    expect(screen.getByRole('textbox')).toBeDefined()
  })

  it('refuses to overwrite a file that changed since it was opened', async () => {
    const readFile = vi.fn(async (path: string) => ({
      content: `content of ${path}`, version: 'v1' as SessionFileVersion,
    }))
    renderBrowser({ writeFile: vi.fn(async () => ({ kind: 'stale' as const })), readFile })
    await settle()

    fireEvent.click(screen.getByText('README.md'))
    await settle()
    fireEvent.click(screen.getByLabelText(zh['fileBrowser.editAria']))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mine' } })
    fireEvent.click(screen.getByLabelText(zh['fileBrowser.saveAria']))
    await settle()

    // The edit survives: the user still owns the buffer, and the banner
    // offers the one action that resolves the conflict.
    expect(screen.getByText(zh['fileBrowser.conflict'])).toBeDefined()
    expect(screen.getByRole('textbox')).toBeDefined()

    readFile.mockClear()
    readFile.mockResolvedValueOnce({ content: 'theirs', version: 'v2' as SessionFileVersion })
    fireEvent.click(screen.getByText(zh['fileBrowser.reload']))
    await settle()

    // Reload must replace what the user is looking at: the editor owns its
    // buffer, so a stale one would survive the refresh and read as a no-op.
    expect(readFile).toHaveBeenCalledWith('/w/README.md')
    expect(screen.queryByText(zh['fileBrowser.conflict'])).toBeNull()
    expect(screen.getByText('theirs')).toBeDefined()
  })

  it('hands the open path to the Host opener', async () => {
    const { openFilePath } = renderBrowser()
    await settle()

    fireEvent.click(screen.getByText('README.md'))
    await settle()
    fireEvent.click(screen.getByText(zh['fileBrowser.openInDesktop']))

    expect(openFilePath).toHaveBeenCalledWith('/w/README.md')
  })

  it('opens an owner-supplied path directly instead of listing the root', async () => {
    const { readFile } = renderBrowser({ openPath: '/w/src/a.ts' })
    await settle()

    expect(readFile).toHaveBeenCalledWith('/w/src/a.ts')
    // The editor is mounted on that file rather than the root listing; its
    // body is highlighted per line, so the banner path is what identifies it.
    expect(document.querySelector('[data-file-editor]')).not.toBeNull()
    expect(screen.queryByText('src/')).toBeNull()
  })

  it('says so when the Session reports no workspace root', () => {
    renderBrowser({ root: undefined })

    expect(screen.getByText(zh['fileBrowser.noWorkspace'])).toBeDefined()
  })
})
