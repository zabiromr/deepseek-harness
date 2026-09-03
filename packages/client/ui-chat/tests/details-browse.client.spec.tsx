// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import {
  bindSnapshotSelector, conversationSnapshot, makeTranslate, sessionSnapshot, workspaceSnapshot,
} from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DetailsPanel } from '../src/client/details/DetailsPanel.tsx'
import { createChatStore } from '../src/client/stores.ts'
import type { DetailsSlotProps, SelectionTarget } from '../src/client/index.ts'
import type { ToolResultNode } from '../src/client/contract/snapshot.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'
import { zh } from '../src/client/locale.ts'

afterEach(cleanup)

const SID = 's1' as SessionId
const CWD = '/workspace/project'
const t = makeTranslate(zh, commonZh) as DetailsSlotProps['t']

/** The Trajectory share the details panel never reads in these cases. */
const emptyTrajectory: Parameters<Parameters<DetailsSlotProps['useTrajectory']>[0]>[0] = {
  eventNodes: [],
  eventLocations: new Map(),
  requests: [],
  callSchemas: new Map(),
  partial: null,
  runningCalls: [],
}

/**
 * Mount the details panel over one selection.
 * @param selection - the selected Tool call, or null for the browse state.
 * @returns the render result plus the renderSlot spy the assertions read.
 */
function mount(selection: SelectionTarget | null) {
  // A selected call only reaches the Tool branch when the snapshot still holds
  // it; without the node the panel renders its out-of-window message instead.
  const tool: ToolResultNode = {
    kind: 'tool-result', seq: 5, time: 5_000, callId: 'c1', call: null, callTime: 4_000,
    content: [], isError: false, subCalls: [],
  }
  const chat = createChatStore().create()
  if (selection !== null) chat.actions.select(selection)
  const sessions = createSnapshotStore<SessionListState>({
    ids: [SID],
    byId: { [SID]: { id: SID, displayTitle: 'r', running: false, blank: false, updatedAt: 0, cwd: CWD } },
    current: SID,
    phase: 'ready',
    subagentsByParent: {}, jobsBySession: {},
    currentAddress: undefined,
  })
  // Occupied by nothing: every child key renders the panel's own fallback,
  // which is what a composition without those registrants shows.
  const renderSlot: DetailsSlotProps['renderSlot'] & ReturnType<typeof vi.fn> = vi.fn(
    (_key: string, _owner: object, opts?: { fallback?: ReactNode }) => <>{opts?.fallback ?? null}</>,
  )
  const view = render(
    <DetailsPanel
      renderSlot={renderSlot}
      SessionProvider={({ children }) => children}
      sessionId={SID}
      useSession={bindSnapshotSelector(createSnapshotStore(sessionSnapshot(SID)))}
      useSessions={bindSnapshotSelector(sessions)}
      useSessionPendingInteraction={bindSnapshotSelector(createSnapshotStore(new Map()))}
      useWorkspaces={bindSnapshotSelector(createSnapshotStore(workspaceSnapshot()))}
      useConversation={bindSnapshotSelector(createSnapshotStore(conversationSnapshot()))}
      useChat={bindSnapshotSelector({
        getSnapshot: () => chatSnapshotFixture({ nodes: [tool] }),
        subscribe: () => () => {},
      })}
      useTrajectory={selector => selector(emptyTrajectory)}
      useInput={() => { throw new Error('the details panel reads no input state') }}
      inputActions={{
        setDraft: () => {}, addImages: () => true, removeImage: () => {}, pruneImages: () => {}, submit: () => {},
      }}
      useProjection={() => undefined}
      useStore={bindSnapshotSelector(chat)}
      actions={chat.actions}
      closeDetails={vi.fn()}
      t={t}
    />,
  )
  return { ...view, renderSlot, chat }
}

describe('details panel browse state', () => {
  it('renders the file browser at the Session workspace root when no call is selected', () => {
    const { renderSlot } = mount(null)

    expect(renderSlot).toHaveBeenCalledWith(
      'conversation.details.browser', { root: CWD }, expect.anything(),
    )
  })

  it('keeps its empty message where no browser is registered', () => {
    const { getByText } = mount(null)

    expect(getByText(zh['details.empty'])).toBeDefined()
  })

  it('returns a selected panel to the browser by clearing the selection', () => {
    const { getByText, renderSlot, chat } = mount({ turnSeq: 10, callId: 'c1', toolName: 'bash' })
    renderSlot.mockClear()

    fireEvent.click(getByText(zh['details.fileBrowser']))

    expect(chat.getSnapshot().selection).toBeNull()
    expect(renderSlot).toHaveBeenCalledWith(
      'conversation.details.browser', { root: CWD }, expect.anything(),
    )
  })

  it('hands a Tool view path to the browser, resolved against the workspace', () => {
    const { renderSlot, chat } = mount({ turnSeq: 10, callId: 'c1', toolName: 'read' })
    const toolCall = renderSlot.mock.calls.find(call => call[0] === 'conversation.details.tool')
    const owner = toolCall?.[1] as { browseFile?: (path: string) => void }
    renderSlot.mockClear()

    act(() => { owner.browseFile?.('src/a.ts') })

    expect(chat.getSnapshot().selection).toBeNull()
    expect(renderSlot).toHaveBeenCalledWith(
      'conversation.details.browser',
      { root: CWD, openPath: `${CWD}/src/a.ts` },
      expect.anything(),
    )
  })

  it('offers no browse control while nothing is selected', () => {
    const { queryByText } = mount(null)

    expect(queryByText(zh['details.fileBrowser'])).toBeNull()
  })
})
