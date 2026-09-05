import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import {
  FileSystem, FsError, FsTargetKey, FsVersion,
  type FsDirEntry, type FsEditOutcome, type FsInfo, type FsPathInfo, type FsTarget,
  type FsWriteIntent, type FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import SessionStore from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { createSessionTestRemote } from './test-remote.ts'

/** One in-memory node of the workspace the file Remotes read and write. */
type Node =
  | { readonly type: 'file'; content: string; version: string; binary?: boolean; size?: number }
  | { readonly type: 'directory' }

/**
 * Path-keyed filesystem double. Directories are explicit nodes and children are
 * derived from key prefixes, so a listing reflects exactly what a test wrote.
 */
class MapFileSystem extends FileSystem {
  readonly nodes = new Map<string, Node>()

  override async resolve(path: string): Promise<FsTarget> {
    return { targetKey: FsTargetKey(path), displayPath: path }
  }

  override processPath(target: FsTarget): string {
    return target.displayPath
  }

  override fileUrl(target: FsTarget): string {
    return `file://${target.displayPath}`
  }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    return child.displayPath.startsWith(`${parent.displayPath}/`)
  }

  override async stat(target: FsTarget): Promise<FsInfo | undefined> {
    const node = this.nodes.get(target.displayPath)
    if (node === undefined) return undefined
    if (node.type !== 'file') return { version: FsVersion('dir'), type: node.type }
    return {
      version: FsVersion(node.version),
      type: 'file',
      size: node.size ?? node.content.length,
    }
  }

  override async lstat(): Promise<FsPathInfo | undefined> {
    throw new Error('lstat is not exercised by the Session file Remotes')
  }

  override async readText(target: FsTarget): Promise<string> {
    const node = this.nodes.get(target.displayPath)
    if (node?.type !== 'file') throw new FsError('read failed', 'FS_NOT_FOUND')
    if (node.binary === true) throw new FsError('binary file', 'FS_NOT_TEXT')
    return node.content
  }

  override async streamText(): Promise<AsyncIterable<string>> {
    throw new Error('streamText is not exercised by the Session file Remotes')
  }

  override async readBytes(): Promise<Uint8Array> {
    throw new Error('readBytes is not exercised by the Session file Remotes')
  }

  override async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    const prefix = `${target.displayPath}/`
    const entries: FsDirEntry[] = []
    for (const [path, node] of this.nodes) {
      if (!path.startsWith(prefix)) continue
      const name = path.slice(prefix.length)
      if (name.includes('/')) continue
      entries.push({ name, type: node.type, target: { targetKey: FsTargetKey(path), displayPath: path } })
    }
    return entries.sort((left, right) => left.name.localeCompare(right.name))
  }

  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
  ): Promise<FsWriteOutcome> {
    const previous = this.nodes.get(target.displayPath)
    const existed = previous?.type === 'file'
    if (expected?.kind === 'replaceIfVersion') {
      if (!existed || previous.version !== String(expected.version)) {
        throw new FsError('stale version', 'FS_STALE_VERSION')
      }
    }
    const version = String(Number(existed ? previous.version : '0') + 1)
    this.nodes.set(target.displayPath, { type: 'file', content, version })
    return { operation: existed ? 'update' : 'create', version: FsVersion(version), before: null, after: content }
  }

  override async editText(): Promise<FsEditOutcome> {
    throw new Error('editText is not exercised by the Session file Remotes')
  }
}

async function workspace(): Promise<{ ctx: Context; fs: MapFileSystem }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const fs = new MapFileSystem(ctx)
  return { ctx, fs }
}

function remoteOf(ctx: Context): ReturnType<typeof createSessionTestRemote> {
  return createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: '/workspace',
  })
}

describe('session/file.list', () => {
  it('lists the direct children of a directory in stable name order', async () => {
    const { ctx, fs } = await workspace()
    fs.nodes.set('/workspace', { type: 'directory' })
    fs.nodes.set('/workspace/src', { type: 'directory' })
    fs.nodes.set('/workspace/README.md', { type: 'file', content: '# hi', version: '1' })
    fs.nodes.set('/workspace/src/deep.ts', { type: 'file', content: 'deep', version: '1' })

    await expect(remoteOf(ctx).fileList({ path: '/workspace' })).resolves.toEqual({
      ok: true,
      value: {
        path: '/workspace',
        entries: [
          { name: 'README.md', path: '/workspace/README.md', type: 'file' },
          { name: 'src', path: '/workspace/src', type: 'directory' },
        ],
      },
    })
  })

  it('reports an absent directory as file-not-found', async () => {
    const { ctx } = await workspace()

    await expect(remoteOf(ctx).fileList({ path: '/workspace/gone' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/file-not-found' },
    })
  })

  it('refuses a path that is not a directory', async () => {
    const { ctx, fs } = await workspace()
    fs.nodes.set('/workspace/README.md', { type: 'file', content: '# hi', version: '1' })

    await expect(remoteOf(ctx).fileList({ path: '/workspace/README.md' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/not-a-directory', details: { type: 'file' } },
    })
  })
})

describe('session file Remotes without a filesystem provider', () => {
  it('refuse every file operation as unsupported', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const remote = remoteOf(ctx)

    await expect(remote.fileList({ path: '/workspace' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/filesystem-unsupported' },
    })
    await expect(remote.fileRead({ path: '/workspace/a.ts' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/filesystem-unsupported' },
    })
    await expect(remote.fileWrite({ path: '/workspace/a.ts', content: '' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/filesystem-unsupported' },
    })
  })
})

describe('session/file.read', () => {
  it('returns the decoded content of a regular file', async () => {
    const { ctx, fs } = await workspace()
    fs.nodes.set('/workspace/a.ts', { type: 'file', content: 'export const a = 1\n', version: '7' })

    await expect(remoteOf(ctx).fileRead({ path: '/workspace/a.ts' })).resolves.toEqual({
      ok: true,
      value: { content: 'export const a = 1\n', version: '7' },
    })
  })

  it('reports an absent file as file-not-found', async () => {
    const { ctx } = await workspace()

    await expect(remoteOf(ctx).fileRead({ path: '/workspace/gone.ts' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/file-not-found' },
    })
  })

  it('refuses a path that is not a regular file', async () => {
    const { ctx, fs } = await workspace()
    fs.nodes.set('/workspace/src', { type: 'directory' })

    await expect(remoteOf(ctx).fileRead({ path: '/workspace/src' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/not-a-file', details: { type: 'directory' } },
    })
  })
})

describe('session file guards', () => {
  it('refuses a file over the configured read ceiling before decoding it', async () => {
    const { ctx, fs } = await workspace()
    fs.nodes.set('/workspace/big.log', { type: 'file', content: 'x', version: '1', size: 5_000_000 })

    await expect(remoteOf(ctx).fileRead({ path: '/workspace/big.log' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/file-too-large', details: { size: 5_000_000 } },
    })
  })

  it('refuses a file the backend reports as binary', async () => {
    const { ctx, fs } = await workspace()
    fs.nodes.set('/workspace/logo.png', { type: 'file', content: 'PNG', version: '1', binary: true })

    await expect(remoteOf(ctx).fileRead({ path: '/workspace/logo.png' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'session/file-not-text' },
    })
  })

  it('applies a guarded write while the version still matches', async () => {
    const { ctx, fs } = await workspace()
    fs.nodes.set('/workspace/a.ts', { type: 'file', content: 'first', version: '3' })
    const remote = remoteOf(ctx)

    const read = await remote.fileRead({ path: '/workspace/a.ts' })
    if (!read.ok) throw new Error('read failed')

    await expect(remote.fileWrite({
      path: '/workspace/a.ts', content: 'second', expectedVersion: read.value.version,
    })).resolves.toMatchObject({ ok: true, value: { operation: 'update' } })
    expect(fs.nodes.get('/workspace/a.ts')).toMatchObject({ content: 'second' })
  })

  it('refuses a guarded write whose file moved on, leaving the newer content', async () => {
    const { ctx, fs } = await workspace()
    fs.nodes.set('/workspace/a.ts', { type: 'file', content: 'first', version: '3' })
    const remote = remoteOf(ctx)

    const read = await remote.fileRead({ path: '/workspace/a.ts' })
    if (!read.ok) throw new Error('read failed')
    // Somebody else — the agent, an editor — writes between read and save.
    fs.nodes.set('/workspace/a.ts', { type: 'file', content: 'theirs', version: '4' })

    await expect(remote.fileWrite({
      path: '/workspace/a.ts', content: 'mine', expectedVersion: read.value.version,
    })).resolves.toMatchObject({ ok: false, error: { code: 'session/file-stale-version' } })
    expect(fs.nodes.get('/workspace/a.ts')).toMatchObject({ content: 'theirs' })
  })

  it('still overwrites unconditionally when no version is supplied', async () => {
    const { ctx, fs } = await workspace()
    fs.nodes.set('/workspace/a.ts', { type: 'file', content: 'theirs', version: '9' })

    await expect(remoteOf(ctx).fileWrite({ path: '/workspace/a.ts', content: 'mine' }))
      .resolves.toMatchObject({ ok: true, value: { operation: 'update' } })
    expect(fs.nodes.get('/workspace/a.ts')).toMatchObject({ content: 'mine' })
  })
})

describe('session/file.write', () => {
  it('reports whether the write created or replaced the file', async () => {
    const { ctx, fs } = await workspace()
    const remote = remoteOf(ctx)

    await expect(remote.fileWrite({ path: '/workspace/new.ts', content: 'first' })).resolves.toEqual({
      ok: true,
      value: { operation: 'create', version: '1' },
    })
    await expect(remote.fileWrite({ path: '/workspace/new.ts', content: 'second' })).resolves.toEqual({
      ok: true,
      value: { operation: 'update', version: '2' },
    })
    expect(fs.nodes.get('/workspace/new.ts')).toMatchObject({ type: 'file', content: 'second' })
  })
})
