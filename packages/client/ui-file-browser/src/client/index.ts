/**
 * File browser client plugin: sidebar footer action + details-panel overlay
 * for opening and editing arbitrary workspace files.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { DetailsBrowser } from './DetailsBrowser.tsx'
import { FileBrowserSidebar } from './FileBrowser.tsx'
import { en, zh } from './locale.ts'
import type { DetailsBrowserInjected, FileBrowserSidebarInjected } from './contract/slots.ts'

export { DetailsBrowser } from './DetailsBrowser.tsx'
export { FileBrowserSidebar } from './FileBrowser.tsx'
export type {
  DetailsBrowserComponentProps, DetailsBrowserInjected, FileBrowserEntry,
  FileBrowserSidebarInjected, FileBrowserSidebarProps,
} from './contract/slots.ts'
export type { FileBrowserKey } from './locale.ts'

const NS = 'fileBrowser'

/** Required services. */
export const inject = ['slots', 'layout', 'locale', 'remote', 'remote.session']

/**
 * Register the file browser sidebar action and the details-panel overlay
 * the chat details panel declares as `conversation.details.browser`.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'file-browser: dictionaries')

  // A failed workspace operation resolves to null or false: the browser owns
  // the message a user sees, so a Remote failure never escapes as a rejection
  // into the details panel's render.
  const makeInjectDetails = (remote: ClientRemote): DetailsBrowserInjected => ({
    listDirectory: async (path: string) => {
      const result = await remote.session['file.list']({ path })
      return result.ok ? result.value.entries : null
    },
    readFile: async (path: string) => {
      const result = await remote.session['file.read']({ path })
      return result.ok ? result.value.content : null
    },
    writeFile: async (path: string, content: string) => {
      const result = await remote.session['file.write']({ path, content })
      return result.ok
    },
    openFilePath: async (path: string) => {
      await remote.session.openWorkspacePath({ path })
    },
  })

  ctx.slots.inject('conversation.details.browser', () => ctx.slots.register({
    name: 'conversation.details.browser',
    locale: NS,
    inject: () => makeInjectDetails(ctx.get('remote') as ClientRemote),
  }, DetailsBrowser))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'file-browser',
    locale: NS,
    inject: (): FileBrowserSidebarInjected => ({ browseFiles: () => { ctx.layout.openDetails() } }),
  }, FileBrowserSidebar))
}
