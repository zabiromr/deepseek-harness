// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
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
  const readFile = vi.fn(async (path: string) => `content of ${path}`)
  const writeFile = vi.fn(async () => true)
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

    expect(writeFile).toHaveBeenCalledWith('/w/README.md', 'edited')
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
    renderBrowser({ writeFile: vi.fn(async () => false) })
    await settle()

    fireEvent.click(screen.getByText('README.md'))
    await settle()
    fireEvent.click(screen.getByLabelText(zh['fileBrowser.editAria']))
    fireEvent.click(screen.getByLabelText(zh['fileBrowser.saveAria']))
    await settle()

    expect(screen.getByText(zh['fileBrowser.writeError'])).toBeDefined()
    expect(screen.getByRole('textbox')).toBeDefined()
  })

  it('hands the open path to the Host opener', async () => {
    const { openFilePath } = renderBrowser()
    await settle()

    fireEvent.click(screen.getByText('README.md'))
    await settle()
    fireEvent.click(screen.getByText(zh['fileBrowser.openInDesktop']))

    expect(openFilePath).toHaveBeenCalledWith('/w/README.md')
  })

  it('says so when the Session reports no workspace root', () => {
    renderBrowser({ root: undefined })

    expect(screen.getByText(zh['fileBrowser.noWorkspace'])).toBeDefined()
  })
})
