/**
 * Details-panel browser for the Session workspace: lists a directory, opens a
 * file, and edits it in place through the FileEditor primitive. Every read,
 * write, and listing goes through the injected Session Remote callbacks.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileEditor, type FileEditorLine } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DetailsBrowserComponentProps, FileBrowserEntry } from './contract/slots.ts'
import css from './DetailsBrowser.module.css'

/** Grammar hints for the extensions the workspace browser opens most. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: 'c',
  cpp: 'cpp',
  css: 'css',
  go: 'go',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  yaml: 'yaml',
  yml: 'yaml',
}

/**
 * Resolve the grammar hint for one path.
 * @param path - the opened file path.
 * @returns the highlighter language id, or undefined for an unmapped extension.
 */
function languageOf(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase()
  return extension === undefined ? undefined : LANGUAGE_BY_EXTENSION[extension]
}

/**
 * Split file content into the editor's numbered lines.
 * @param content - the full file content.
 * @returns one entry per line, numbered from 1.
 */
function linesOf(content: string): FileEditorLine[] {
  return content.split('\n').map((text, index) => ({ number: index + 1, text }))
}

/** The file currently open for viewing and editing. */
interface OpenFile {
  readonly path: string
  readonly content: string
}

/**
 * Details-panel workspace browser.
 * @param props - owner root, injected Remote callbacks, and the locale seat.
 * @returns the browser element tree.
 */
export function DetailsBrowser({
  root,
  listDirectory,
  readFile,
  writeFile,
  openFilePath,
  t,
}: DetailsBrowserComponentProps) {
  // The trail is the browsing history from the owner's root down: its last
  // element is the listed directory, and its length is what makes "up"
  // possible. It resets whenever the owner hands over a different root.
  const [trail, setTrail] = useState<readonly string[]>(root === undefined ? [] : [root])
  const [entries, setEntries] = useState<readonly FileBrowserEntry[]>([])
  const [open, setOpen] = useState<OpenFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTrail(root === undefined ? [] : [root])
    setOpen(null)
  }, [root])

  const directory = trail.at(-1)

  useEffect(() => {
    if (directory === undefined || open !== null) return
    let current = true
    setLoading(true)
    void listDirectory(directory).then((listed) => {
      if (!current) return
      setLoading(false)
      if (listed === null) {
        setEntries([])
        setError(t('fileBrowser.listError'))
        return
      }
      setEntries(listed)
      setError(null)
    })
    return () => { current = false }
  }, [directory, open, listDirectory, t])

  const openEntry = useCallback((entry: FileBrowserEntry) => {
    if (entry.type === 'directory') {
      setTrail(previous => [...previous, entry.path])
      return
    }
    setLoading(true)
    void readFile(entry.path).then((content) => {
      setLoading(false)
      if (content === null) {
        setError(t('fileBrowser.readError'))
        return
      }
      setOpen({ path: entry.path, content })
      setError(null)
    })
  }, [readFile, t])

  const goBack = useCallback(() => {
    if (open !== null) {
      setOpen(null)
      return
    }
    setTrail(previous => (previous.length > 1 ? previous.slice(0, -1) : previous))
  }, [open])

  const save = useCallback(async (content: string): Promise<boolean> => {
    if (open === null) return false
    const written = await writeFile(open.path, content)
    if (!written) {
      setError(t('fileBrowser.writeError'))
      return false
    }
    setOpen({ path: open.path, content })
    setError(null)
    return true
  }, [open, writeFile, t])

  const lines = useMemo(() => (open === null ? [] : linesOf(open.content)), [open])

  if (directory === undefined) {
    return <div className={css.emptyState}>{t('fileBrowser.noWorkspace')}</div>
  }

  const canGoBack = open !== null || trail.length > 1

  return (
    <div className={css.browser}>
      <div className={css.banner}>
        {canGoBack && (
          <button
            type="button" className={css.backButton}
            onClick={goBack} aria-label={t('fileBrowser.back')}
          >
            {t('fileBrowser.back')}
          </button>
        )}
        <div className={css.path}>{open?.path ?? directory}</div>
        {open !== null && (
          <div className={css.actions}>
            <button
              type="button" className={css.editButton}
              onClick={() => { void openFilePath(open.path) }}
            >
              {t('fileBrowser.openInDesktop')}
            </button>
          </div>
        )}
      </div>
      {error !== null && <div className={css.errorBanner}>{error}</div>}
      {loading && <div className={css.loadingState}>{t('fileBrowser.loading')}</div>}
      {open !== null
        ? (
          <FileEditor
            label={open.path}
            labels={{
              copy: t('copy'),
              copied: t('fileBrowser.saved'),
              edit: t('fileBrowser.edit'),
              save: t('fileBrowser.save'),
              saving: t('fileBrowser.saving'),
              cancel: t('fileBrowser.cancel'),
              editing: t('fileBrowser.editing'),
              editAria: t('fileBrowser.editAria'),
              saveAria: t('fileBrowser.saveAria'),
              cancelAria: t('fileBrowser.cancelAria'),
            }}
            lines={lines}
            totalLines={lines.length}
            lang={languageOf(open.path)}
            fullFile
            onSave={save}
            className={css.fileEditor}
          />
        )
        : entries.length === 0 && !loading
          ? <div className={css.emptyState}>{t('fileBrowser.emptyDir')}</div>
          : (
            <ul className={css.entryList}>
              {entries.map(entry => (
                // Keyed by name, not path: a symlinked child resolves to its
                // target's path, which can repeat a sibling's within one listing.
                <li key={entry.name}>
                  <button
                    type="button" className={css.entryItem}
                    onClick={() => { openEntry(entry) }}
                  >
                    <span className={css.entryName}>
                      {entry.type === 'directory' ? `${entry.name}/` : entry.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
    </div>
  )
}
