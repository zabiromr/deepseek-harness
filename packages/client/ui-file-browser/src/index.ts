/**
 * File browser plugin, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration.
 *
 * Only types cross this edge. The browser components import stylesheets, so
 * re-exporting them here would pull CSS into the node bundle.
 */

export type { FileBrowserKey } from './client/locale.ts'
export type {
  DetailsBrowserInjected, FileBrowserEntry, FileBrowserSidebarInjected,
} from './client/contract/slots.ts'

/** Host plugin body — this package contributes browser presentation only. */
export function apply(): void {}
