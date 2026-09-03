/** Session Remote owner: cold reads, explicit Agent commands, and live control state. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { canOpenNativePath, openNativePath } from '@deepseek-ai/dsh-native-command'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { FsError, type FileSystem, type FsTarget, type FsVersion } from '@deepseek-ai/dsh-fs'
import {
  ApiSessionAgentController,
  inspectApiSession,
  type ApiSessionAgentResult,
} from './agent.ts'
import { SessionCommandController } from './commands.ts'
import { SessionControlController } from './control.ts'
import { SessionHistoryController } from './history.ts'
import { SessionFileReferences } from './file-references.ts'
import { ApiSessionList, DEFAULT_COLD_BLANK_PROBE_MAX_BYTES } from './list.ts'
import { buildModelCatalog } from './catalog.ts'
import { installModelSelectionProjection } from './model-selection-projection.ts'
import { SessionSkillCatalog } from './skill-catalog.ts'
import type {
  ModelCatalog,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  SessionFileListRequest,
  SessionFileListValue,
  SessionFileVersion,
  SessionFileReadRequest,
  SessionFileReadValue,
  SessionFileWriteRequest,
  SessionFileWriteValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionForkRequest,
  SessionForkValue,
  SessionListRequest,
  SessionListValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionPage,
  SessionPageRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from './types.ts'

export type * from './types.ts'
export { ApiSessionNotFound } from './agent.ts'
export { SessionFileReferences } from './file-references.ts'
export { SessionSkillCatalog } from './skill-catalog.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Session business API and Remote namespace owner. */
    sessionController: SessionController
  }
}

/** Session Controller deployment policy. */
export interface Config {
  /** Maximum cold Session artifact size eligible for one full projection observation. */
  readonly coldBlankProbeMaxBytes?: number
  /** Exclusive byte ceiling on one `file.read`; a larger file is refused rather than loaded. */
  readonly fileReadMaxBytes?: number
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
}

/** Host integrations replaceable by direct unit tests. */
export interface SessionControllerInternals {
  /** Native default-application handoff. */
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native handoff availability probe. */
  readonly canOpenPath?: () => boolean
}

/**
 * Byte ceiling on one `file.read`. A browser holds the whole response in
 * memory and renders it as text, so the default keeps a stray large or
 * generated file from being loaded in full; deployments editing bigger files
 * raise `fileReadMaxBytes`.
 */
const DEFAULT_FILE_READ_MAX_BYTES = 2 * 1024 * 1024

/** Host service backing the generated `ctx.remote.session` namespace. */
export class SessionController extends TypertRemoteService {
  static inject = [
    'agentDefaultModel',
    'agents',
    'attachments',
    'llm',
    'sessions',
    'sessionProjections',
    'sessionQuery',
    'typert',
    'workspaceRegistry',
  ]

  static Config: z<Config> = z.object({
    coldBlankProbeMaxBytes: z.natural().default(DEFAULT_COLD_BLANK_PROBE_MAX_BYTES),
    fileReadMaxBytes: z.natural().default(DEFAULT_FILE_READ_MAX_BYTES),
    nativeOpen: z.boolean(),
  })

  private readonly agents: ApiSessionAgentController
  private readonly commands: SessionCommandController
  private readonly controlState: SessionControlController
  private readonly history: SessionHistoryController
  private readonly listState: ApiSessionList
  private readonly openPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly canOpenPath: () => boolean
  private readonly fileReadMaxBytes: number
  private readonly promotions = new Set<Promise<void>>()

  /**
   * @param ctx - Host context containing the Session capability assembly.
   * @param config - cold-list observation policy.
   */
  constructor(ctx: Context, config: Config, internals: SessionControllerInternals = {}) {
    super(ctx, 'sessionController', { namespace: 'session' })
    installModelSelectionProjection(ctx)
    this.agents = new ApiSessionAgentController(ctx)
    this.commands = new SessionCommandController(ctx, this.agents, process.cwd())
    this.controlState = new SessionControlController(ctx)
    // Registered before history so reverse-order teardown closes every
    // follower before waiting for already-admitted promotions.
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.promotions])
    }, 'session-controller.promotions')
    this.history = new SessionHistoryController(ctx, (observation) => { this.promote(observation) })
    this.listState = new ApiSessionList(
      ctx,
      config.coldBlankProbeMaxBytes ?? DEFAULT_COLD_BLANK_PROBE_MAX_BYTES,
    )
    this.fileReadMaxBytes = config.fileReadMaxBytes ?? DEFAULT_FILE_READ_MAX_BYTES
    this.openPath = internals.openPath ?? openNativePath
    this.canOpenPath = internals.canOpenPath
      ?? (() => config.nativeOpen ?? (internals.openPath !== undefined || canOpenNativePath()))
    ctx.plugin(SessionFileReferences)
    ctx.plugin(SessionSkillCatalog)

    ctx.on('session/created', (session) => {
      ctx.emit('api-session/added', this.listState.summaryFor(session))
    })
    ctx.on('session/disposed', (session) => {
      ctx.emit('api-session/removed', session.id)
    })
    ctx.on('agent/status', ({ agent, status }) => {
      ctx.emit('api-session/status', agent.id, status === 'running')
    })
    ctx.on('agent/error', ({ agent, error }) => {
      ctx.emit('api-session/error', agent.id, errorChain(error))
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'request/header') {
        const agent = ctx.agents.get(session.id)
        if (agent?.session === session) this.agents.consumeSelection(
          agent,
          event.data.header.config.provider,
          event.data.header.config.model,
          event.data.header.config.reasoningEffort,
        )
      }
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
      ctx.emit('api-session/activity', session.id, event.time)
    })
  }

  private promote(observation: SessionObservation): void {
    const sessionId = observation.header.id
    const task = (async () => {
      using ownedObservation = observation
      const result = await this.agents.resolveObservedAgent(ownedObservation)
      if ('error' in result) this.ctx.emit('api-session/error', sessionId, result.error.message)
    })().catch((error: unknown) => {
      this.ctx.logger.error(`session-controller: background activation for "${sessionId}" failed: ${errorChain(error)}`)
    })
    this.promotions.add(task)
    void task.finally(() => { this.promotions.delete(task) })
  }

  /**
   * Resolve or resume one ordinary Session for another Host API domain.
   * @param sessionId - Session identity whose Agent owns the operation.
   * @returns the live Agent or the stable Session-domain failure.
   */
  resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult> {
    return this.agents.resolveAgent(sessionId)
  }

  /**
   * Inspect one attached or persisted Session without activating its Agent.
   * @param sessionId - durable Session identity.
   * @param signal - optional caller cancellation for persistence reads.
   * @returns the current attached state or persisted header and event prefix.
   */
  inspect(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return Promise.resolve({ meta: attached.header, events: [...attached.events] })
    }
    return inspectApiSession(this.ctx, sessionId, signal)
  }

  /**
   * Read all visible Session rows without resuming an Agent.
   * @param _request - reserved empty list request.
   * @param signal - cancellation for persistence reads.
   * @returns visible Session summaries ordered by activity.
   */
  @Remote('list')
  async list(_request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> {
    return { items: await this.listState.list(signal) }
  }

  /**
   * Search visible Session content without resuming an Agent.
   * @param request - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  @Remote('search')
  search(request: SessionSearchRequest, signal: AbortSignal): Promise<SessionSearchValue> {
    return this.listState.search(request.query, signal)
  }

  /**
   * Create or idempotently adopt one ordinary Session.
   * @param request - requested identity, location, and Agent preset.
   * @returns the Session identity and resolved preset when configured.
   */
  @Remote('create')
  create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Select one Session-local model after explicitly resuming the Session.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session.
   */
  @Remote('selectModel')
  selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    return this.commands.selectModel(request)
  }

  /**
   * Describe every currently routable model for Host-generation selectors.
   * @returns provider-grouped models, the deployment default, and isolated provider failures.
   */
  @Remote('modelCatalog')
  modelCatalog(): Promise<ModelCatalog> {
    return buildModelCatalog(this.ctx)
  }

  /**
   * Report whether this deployment can hand a Session workspace path to a native desktop.
   * @returns true when the matching open operation is available.
   */
  @Remote
  canOpenWorkspacePath(): boolean {
    return this.canOpenPath()
  }

  /**
   * Open one path prepared by a Session-aware caller on the Host desktop.
   * @param request - path after best-effort Session workspace resolution.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns confirmation after the native opener accepts the path.
   * @throws TypertRemoteFailure when the request is invalid, cancelled, or the opener fails.
   */
  @Remote('openWorkspacePath')
  async openWorkspacePath(
    request: SessionOpenWorkspacePathRequest,
    signal: AbortSignal,
  ): Promise<SessionOpenWorkspacePathValue> {
    if (request.path.length === 0) {
      throw new TypertRemoteFailure({
        code: 'bad-request',
        message: 'session.openWorkspacePath requires a non-empty path',
        details: {},
      })
    }
    signal.throwIfAborted()
    try {
      await this.openPath(request.path, signal)
      return { opened: true }
    } catch (error: unknown) {
      if (signal.aborted) {
        throw new TypertRemoteFailure({
          code: 'cancelled', message: 'path open was aborted', details: {},
        })
      }
      throw new TypertRemoteFailure({
        code: 'internal',
        message: `path open failed: ${error instanceof Error ? error.message : String(error)}`,
        details: {},
      })
    }
  }

  /**
   * Rename one Session after explicitly resuming it.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  @Remote('rename')
  rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    return this.commands.rename(request)
  }

  /**
   * Fork one cold-readable completed-turn prefix into a new Session.
   * @param request - source Session and optional event anchor.
   * @returns the new Session identity.
   */
  @Remote('fork')
  fork(request: SessionForkRequest): Promise<SessionForkValue> {
    return this.commands.fork(request)
  }

  /**
   * Admit one prompt after explicitly resuming its Session.
   * @param request - Session identity, prompt content, source metadata, and delivery mode.
   * @param signal - caller cancellation before prompt admission begins.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  @Remote('prompt')
  prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> {
    signal.throwIfAborted()
    return this.commands.prompt(request)
  }

  /**
   * Read one image proven reachable from the addressed Session log.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  @Remote('attachment')
  attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    return this.commands.attachment(request)
  }

  /**
   * Mutate one still-pending queue occurrence on a live Agent.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  @Remote('updateQueue')
  updateQueue(request: SessionUpdateQueueRequest): SessionUpdateQueueValue {
    return this.commands.updateQueue(request)
  }

  /**
   * Cancel one active Agent turn without dropping its pending inbox.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  @Remote('cancel')
  cancel(request: SessionCancelRequest): SessionCancelValue {
    return this.commands.cancel(request)
  }

  /**
   * Read one cold-safe, message-aligned Session history page.
   * @param request - durable address, backward cursor, and page budget.
   * @param signal - cancellation for persistence reads.
   * @returns one chronological page.
   */
  @Remote('page')
  page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> {
    return this.history.page(request, signal)
  }

  /**
   * Follow one Session log from its opening or resume cursor.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns a complete opening snapshot followed by gap-free event frames.
   */
  @Remote({ mode: 'stream' })
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    return this.history.follow(request, signal)
  }

  /**
   * Stream a complete live-control baseline followed by replacement frames.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns one complete baseline followed by live replacement frames.
   */
  @Remote({ mode: 'stream' })
  control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    return this.controlState.control(signal)
  }

  /**
   * Read the full content of an arbitrary file within the Session workspace.
   * @param request - absolute file path within the workspace.
   * @param signal - cancellation signal for the resolve, stat, and read steps.
   * @returns decoded UTF-8 file content.
   * @throws TypertRemoteFailure when the file is absent, binary, or too large.
   */
  @Remote('file.read')
  async fileRead(request: SessionFileReadRequest, signal: AbortSignal): Promise<SessionFileReadValue> {
    const fs = this.fileSystem()
    const target = await fs.resolve(request.path, { signal })
    const info = await fs.stat(target, signal)
    if (info === undefined) {
      throw new TypertRemoteFailure({
        code: 'file-not-found',
        message: `file not found: ${request.path}`,
        details: { path: request.path },
      })
    }
    if (info.type !== 'file') {
      throw new TypertRemoteFailure({
        code: 'not-a-file',
        message: `${request.path} is not a regular file`,
        details: { path: request.path, type: info.type },
      })
    }
    // Refuse by the stat size before reading: the caller holds the whole
    // response in memory, so an oversized file must never be decoded at all.
    if (info.size !== undefined && info.size > this.fileReadMaxBytes) {
      throw new TypertRemoteFailure({
        code: 'too-large',
        message: `${request.path} is ${String(info.size)} bytes, over the ${String(this.fileReadMaxBytes)} byte read limit`,
        details: { path: request.path, size: info.size, limit: this.fileReadMaxBytes },
      })
    }
    const content = await this.readTextOrRefuse(fs, target, request.path, signal)
    return { content, version: info.version as string as SessionFileVersion }
  }

  /**
   * Read text, converting the backend's binary refusal into a Remote failure
   * a caller can present. Every other filesystem error keeps its own reporting.
   * @param fs - the mounted filesystem.
   * @param target - the resolved file.
   * @param path - the requested path, for the failure message.
   * @param signal - cancellation signal for the read.
   * @returns the decoded text.
   * @throws TypertRemoteFailure when the file is not UTF-8 text.
   */
  private async readTextOrRefuse(
    fs: FileSystem,
    target: FsTarget,
    path: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      return await fs.readText(target, signal)
    } catch (error: unknown) {
      if (error instanceof FsError && error.code === 'FS_NOT_TEXT') {
        throw new TypertRemoteFailure({
          code: 'not-text',
          message: `${path} is not UTF-8 text`,
          details: { path },
        })
      }
      throw error
    }
  }

  /**
   * The workspace filesystem backing the file Remotes. It stays an optional
   * read: a deployment that mounts no filesystem provider still serves every
   * other Session operation, and only the file Remotes refuse.
   * @returns the mounted filesystem capability.
   * @throws TypertRemoteFailure when the deployment mounts no filesystem provider.
   */
  private fileSystem(): FileSystem {
    const fs = this.ctx.get('fs')
    if (fs === undefined) {
      throw new TypertRemoteFailure({
        code: 'unsupported',
        message: 'this deployment mounts no filesystem provider',
        details: {},
      })
    }
    return fs
  }

  /**
   * List the direct children of one directory within the Session workspace.
   * @param request - directory path resolved by the Host filesystem.
   * @param signal - cancellation signal for the resolve, stat, and list steps.
   * @returns the resolved directory path and its direct children in stable name order.
   * @throws TypertRemoteFailure when the directory is absent or the path is not a directory.
   */
  @Remote('file.list')
  async fileList(request: SessionFileListRequest, signal: AbortSignal): Promise<SessionFileListValue> {
    const fs = this.fileSystem()
    const target = await fs.resolve(request.path, { signal })
    const info = await fs.stat(target, signal)
    if (info === undefined) {
      throw new TypertRemoteFailure({
        code: 'file-not-found',
        message: `directory not found: ${request.path}`,
        details: { path: request.path },
      })
    }
    if (info.type !== 'directory') {
      throw new TypertRemoteFailure({
        code: 'not-a-directory',
        message: `${request.path} is not a directory`,
        details: { path: request.path, type: info.type },
      })
    }
    const entries = await fs.listDir(target, signal)
    return {
      path: fs.processPath(target),
      entries: entries.map(entry => ({
        name: entry.name,
        path: fs.processPath(entry.target),
        type: entry.type,
      })),
    }
  }

  /**
   * Write full content to an arbitrary file within the Session workspace.
   * @param request - absolute file path and full content to write.
   * @param signal - cancellation signal for the resolve and write steps.
   * @returns confirmation of the write operation.
   * @throws TypertRemoteFailure when the path is invalid or the write fails.
   */
  @Remote('file.write')
  async fileWrite(request: SessionFileWriteRequest, signal: AbortSignal): Promise<SessionFileWriteValue> {
    const fs = this.fileSystem()
    const target = await fs.resolve(request.path, { signal })
    // An expected version makes the write conditional: the backend rejects it
    // when the file moved on since the caller read it, so a stale buffer
    // reports a conflict instead of silently replacing newer content.
    const expected = request.expectedVersion === undefined
      ? undefined
      : { kind: 'replaceIfVersion' as const, version: request.expectedVersion as string as FsVersion }
    try {
      const outcome = await fs.writeText(target, request.content, expected, signal)
      return { operation: outcome.operation, version: outcome.version as string as SessionFileVersion }
    } catch (error: unknown) {
      if (error instanceof FsError && error.code === 'FS_STALE_VERSION') {
        throw new TypertRemoteFailure({
          code: 'stale-version',
          message: `${request.path} changed since it was read`,
          details: { path: request.path },
        })
      }
      throw error
    }
  }

}

export { buildModelCatalog }
export default SessionController
