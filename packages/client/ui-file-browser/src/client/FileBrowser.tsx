/**
 * Sidebar footer action that opens the details panel on the workspace file
 * browser. The panel shows the browser whenever no Tool call is selected, so
 * this action only has to open the panel.
 */
import { IconFolderOpenOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileBrowserSidebarProps } from './contract/slots.ts'
import css from './FileBrowser.module.css'

/**
 * File browser sidebar button rendered in the sidebar footer.
 * @param props - sidebar column state, the injected panel opener, and the locale seat.
 * @returns the footer action element.
 */
export function FileBrowserSidebar({ wide, browseFiles, t }: FileBrowserSidebarProps) {
  return (
    <div className={css.root}>
      <Tooltip label={t('fileBrowser.title')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.actionButton}
          aria-label={t('fileBrowser.title')}
          onClick={() => { browseFiles() }}
        >
          <IconFolderOpenOutline16 size={wide ? 14 : 18} />
        </button>
      </Tooltip>
    </div>
  )
}
