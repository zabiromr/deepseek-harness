import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { writeClipboard } from './clipboard.ts'
import {
  grammarLoadCount,
  highlightLines,
  subscribeGrammarLoaded,
  type HighlightSpan,
} from './markdown/highlight.ts'
import css from './FileEditor.module.css'

/** One line of the read window: its file line number and its text (no trailing newline). */
export interface FileEditorLine {
  /** 1-based line number in the file (a window past an offset keeps the file's own numbering). */
  number: number
  /** The line's text, already truncated to the read tool's per-line cap. */
  text: string
}

/** Editor mode: read-only or editable. */
export type FileEditorMode = 'view' | 'edit'

export interface FileEditorProps {
  /** Banner label (the file path); omitted draws no label. */
  label?: string | undefined
  /** Initial lines to display before the user edits. */
  lines: readonly FileEditorLine[]
  /** Exact total line count in the file, for the "showing N of M" note. */
  totalLines: number
  /** Grammar hint (a file-extension-derived language id); unknown or absent = plain monospace. */
  lang?: string | undefined
  /** Whether the lines are the complete file. */
  fullFile?: boolean
  /** Extra class merged onto the wrapper. */
  className?: string | undefined
  /** Localized chrome supplied by the owning render site. */
  labels: FileEditorLabels
  /**
   * Persist edited content. Omitting it makes the editor read-only: no edit
   * affordance appears, because nothing could receive the result.
   * @param content - the full edited buffer.
   * @returns whether the write succeeded; a false result keeps the buffer in edit mode.
   */
  onSave?: ((content: string) => Promise<boolean>) | undefined
}

/** Localized chrome for {@link FileEditor}. */
export interface FileEditorLabels {
  /** "Copy" button label. */
  copy: string
  /** "Copied" label shown after a successful clipboard write. */
  copied: string
  /** "Edit" button label. */
  edit: string
  /** "Save" button label. */
  save: string
  /** "Saving..." label shown during save. */
  saving: string
  /** "Cancel" button label to discard edits. */
  cancel: string
  /** Status label when in edit mode. */
  editing: string
  /** ARIA label for the edit button. */
  editAria: string
  /** ARIA label for the save button. */
  saveAria: string
  /** ARIA label for the cancel button. */
  cancelAria: string
}

/**
 * Render a file viewer that supports editing and saving.
 * @param props - see {@link FileEditorProps}.
 * @returns the editor element.
 */
export function FileEditor({
  label,
  labels,
  lines,
  totalLines,
  lang,
  fullFile = false,
  className,
  onSave,
}: FileEditorProps) {
  const raw = useMemo(() => lines.map(line => line.text).join('\n'), [lines])

  // Re-render when a lazy grammar finishes loading, so a read card that showed
  // plain text while its language's grammar imported picks up highlighting.
  const loaded = useSyncExternalStore(
    subscribeGrammarLoaded,
    grammarLoadCount,
    grammarLoadCount,
  )
  const highlighted = useMemo<HighlightSpan[][] | undefined>(() => highlightLines(raw, lang), [raw, lang, loaded])

  const [mode, setMode] = useState<FileEditorMode>('view')
  const [content, setContent] = useState(raw)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    const textToCopy = mode === 'edit' ? content : raw
    void writeClipboard(textToCopy).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, content, raw, mode])

  const onEdit = useCallback(() => {
    setContent(raw)
    setMode('edit')
  }, [raw])

  const onChange = useCallback((value: string) => {
    setContent(value)
  }, [])

  const commit = useCallback(() => {
    if (onSave === undefined) return
    setSaving(true)
    void onSave(content).then((ok) => {
      setSaving(false)
      if (ok) setMode('view')
    })
  }, [content, onSave])

  const onCancel = useCallback(() => {
    setContent(raw)
    setMode('view')
  }, [raw])

  // fullFile determines whether we show the full file or a windowed excerpt
  const windowed = lines.length < totalLines

  // View mode: render like a ReadBlock (with collapse/expand).
  if (mode === 'view') {
    return (
      <div className={clsx(css.block, className)} data-file-editor="view" data-full-file={fullFile ? 'true' : undefined}>
        <div className={css.banner}>
          <div className={css.label}>{label ?? ''}</div>
          <div className={css.action}>
            {windowed && (
              <span className={css.count}>{`${lines.length}/${totalLines}`}</span>
            )}
            <span className={css.lang}>{lang ?? ''}</span>
            {lines.length > 0 && (
              <button type="button" className={css.copyButton} onClick={onCopy}>
                {copied ? labels.copied : labels.copy}
              </button>
            )}
            {onSave !== undefined && (
              <button type="button" className={css.editButton} onClick={onEdit} aria-label={labels.editAria}>
                {labels.edit}
              </button>
            )}
          </div>
        </div>
        <div className={css.body}>
          {lines.map((line, index) => (
            <div key={line.number} className={css.line}>
              <span className={css.gutter} aria-hidden>{line.number}</span>
              <span className={css.content}>
                {highlighted?.[index]
                  ? highlighted[index].map((span, i) => <span key={i} style={span.style}>{span.text}</span>)
                  : line.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Edit mode: show the full content in an editable textarea.
  return (
    <div className={clsx(css.block, className)} data-file-editor="edit">
      <div className={css.banner}>
        <div className={css.label}>{label ?? ''}</div>
        <div className={css.action}>
          <span className={css.status}>{labels.editing}</span>
          {saving
            ? <span className={css.saving}>{labels.saving}</span>
            : (
              <>
                <button
                  type="button"
                  className={css.saveButton}
                  onClick={commit}
                  aria-label={labels.saveAria}
                >
                  {labels.save}
                </button>
                <button
                  type="button"
                  className={css.cancelButton}
                  onClick={onCancel}
                  aria-label={labels.cancelAria}
                >
                  {labels.cancel}
                </button>
              </>
            )}
        </div>
      </div>
      <div className={css.editBody}>
        <textarea
          className={css.textarea}
          value={content}
          onChange={(event) => { onChange(event.target.value) }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
    </div>
  )
}
