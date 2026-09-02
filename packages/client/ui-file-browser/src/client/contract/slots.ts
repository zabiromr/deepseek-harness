/**
 * File browser slot contract: the composed props of the details-panel
 * registrant. The `conversation.details.browser` slot itself is declared by
 * the details panel (ui-chat), which owns when the overlay renders.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// The sidebar footer action this package registers into is declared by ui-sidebar.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { FileBrowserKey } from '../locale.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar action, listing states, and editor chrome. */
    fileBrowser: FileBrowserKey
  }
}

/** One direct child of a listed workspace directory. */
export interface FileBrowserEntry {
  /** Basename inside the listed directory. */
  readonly name: string
  /** Host path, ready for a follow-up listing or read. */
  readonly path: string
  /** Whether the child is a regular file, a directory, or something else. */
  readonly type: 'file' | 'directory' | 'other'
}

/** Full props of the sidebar footer action. */
export type FileBrowserSidebarProps =
  PropsRuntime<'sidebar.footer.action'>
  & InjectFace<FileBrowserSidebarInjected>
  & PropsLocale<'fileBrowser'>

/** Injected callback opening the details panel on the browser. */
export interface FileBrowserSidebarInjected {
  /** Open the details panel, where the browser renders with no Tool call selected. */
  browseFiles: () => void
}

/** Full props of the details-panel file browser. */
export type DetailsBrowserComponentProps =
  PropsRuntime<'conversation.details.browser'>
  & InjectFace<DetailsBrowserInjected>
  & PropsLocale<'fileBrowser'>

/**
 * Session Remote callbacks the registering entry supplies with its own
 * authority. Each resolves to null or false rather than throwing, so one
 * failed workspace operation leaves the browser mounted on its error banner.
 */
export interface DetailsBrowserInjected {
  /**
   * List the direct children of one workspace directory.
   * @param path - the directory to list.
   * @returns the children in the Host's stable name order, or null when the listing failed.
   */
  listDirectory: (path: string) => Promise<readonly FileBrowserEntry[] | null>
  /**
   * Resolve the full content of one workspace file.
   * @param path - the file to read.
   * @returns the decoded content, or null when the read failed.
   */
  readFile: (path: string) => Promise<string | null>
  /**
   * Write full content to one workspace file.
   * @param path - the file to write.
   * @param content - the complete new content.
   * @returns whether the write succeeded.
   */
  writeFile: (path: string, content: string) => Promise<boolean>
  /**
   * Open one workspace path in the Host desktop editor.
   * @param path - the file to hand to the Host opener.
   * @returns when the Host opener has accepted or rejected the path.
   */
  openFilePath: (path: string) => Promise<void>
}
