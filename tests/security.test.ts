import { afterEach, describe, expect, it } from 'vitest'
import nacl from 'tweetnacl'
import { Keypair } from '@solana/web3.js'
import { createStore, type Store } from '../lib/repositories/store'
import { createContributors, validateAllocations } from '../lib/contributors/service'
import { canManage, GitHub, parseRepository } from '../lib/github/api'
import { createAuth, safeNext } from '../lib/github/auth'
import type { IncomingMessage, ServerResponse } from 'node:http'

const stores: Store[] = []
function memory() { const store = createStore(':memory:'); stores.push(store); return store }
afterEach(() => stores.splice(0).forEach(store => store.db.close()))
describe('GitHub repository authority', () => {
  it('requires active public repositories and actual manage permissions', () => {
    const repo = { private: false, archived: false, disabled: false, permissions: { admin: true } }
    expect(canManage(repo)).toBe(true)
    expect(canManage({ ...repo, permissions: { maintain: true } })).toBe(true)
    expect(canManage({ ...repo, permissions: {} })).toBe(false)
    expect(canManage({ ...repo, permissions: undefined })).toBe(false)
    for (const key of ['private', 'archived', 'disabled'] as const) expect(canManage({ ...repo, [key]: true })).toBe(false)
  })
  it('checks the GitHub repository ID and never trusts client-supplied permissions', async () => {
    const github = new GitHub(async () => new Response(JSON.stringify({ id: 9, private: false, archived: false, disabled: false, permissions: { admin: true } }), { status: 200 }))
    await expect(github.verify(8, 'fixture-token')).rejects.toThrow('permission')
    await expect(github.verify(-1, 'fixture-token')).rejects.toThrow('repository')
  })
  it('parses owner/name or GitHub URLs and rejects anything else', () => {
    for (const input of ['builder/software', ' github.com/builder/software ', 'https://github.com/builder/software.git', 'https://www.github.com/builder/software/tree/main/src?x=1', 'http://github.com/builder/software#readme'])
      expect(parseRepository(input)).toEqual({ owner: 'builder', name: 'software' })
    expect(parseRepository('some-org/repo.name_2')).toEqual({ owner: 'some-org', name: 'repo.name_2' })
    for (const input of ['software', 'https://gitlab.com/builder/software', '-bad/owner', 'builder/..', 'builder/', 42, null, 'a'.repeat(301)])
      expect(() => parseRepository(input)).toThrow('owner/name')
  })
  it('keeps claims for archived repositories but never launches them', async () => {
    const archived = { id: 7, owner: { login: 'o', avatar_url: '' }, name: 'r', html_url: 'https://github.com/o/r', private: false, archived: true, disabled: false, permissions: { admin: true } }
    const github = new GitHub(async () => new Response(JSON.stringify(archived), { status: 200 }))
    expect((await github.verify(7, 't', { forClaims: true })).id).toBe(7)
    await expect(github.verify(7, 't')).rejects.toThrow('permission')
    await expect(github.launchable(7, 't')).rejects.toThrow('public')
  })
  it('follows renamed repositories without breaking the listing', () => {
    const store = memory(), coin = (m: string) => ({ mint: m }) as never
    const repo = (id: number, owner: string, name: string) => ({ id, owner, name, url: `https://github.com/${owner}/${name}`, avatar: '' }) as never
    store.publish({ repo: repo(1, 'alice', 'tool'), coin: coin('m1') } as never)
    // alice/tool was renamed to alice/tool-old, and a new alice/tool was launched
    store.publish({ repo: repo(2, 'alice', 'tool'), coin: coin('m2') } as never)
    expect(store.bySlug('alice', 'tool')!.repo.id).toBe(2)
    store.renamed(repo(1, 'alice', 'tool-old'))
    expect(store.bySlug('alice', 'tool-old')!.repo.id).toBe(1)
    expect(store.projects()).toHaveLength(2)
  })
  it('labels forks with the project they came from', async () => {
    const base = { id: 5, owner: { login: 'forker', avatar_url: '' }, name: 'react', html_url: 'https://github.com/forker/react', private: false, archived: false, disabled: false, permissions: { admin: true } }
    const origin = { name: 'react', owner: { login: 'facebook' }, html_url: 'https://github.com/facebook/react' }
    const forked = await new GitHub(async () => new Response(JSON.stringify({ ...base, fork: true, parent: { ...origin, owner: { login: 'mid' } }, source: origin }), { status: 200 })).launchable(5, 't')
    expect(forked.repo).toMatchObject({ forked: true, parent: { owner: 'facebook', name: 'react', url: 'https://github.com/facebook/react' } })
    expect(forked.maintainer).toBe(true)
    const original = await new GitHub(async () => new Response(JSON.stringify(base), { status: 200 })).launchable(5, 't')
    expect(original.repo).toMatchObject({ forked: false, parent: null })
  })
  it('lets anyone launch an active public repository but records maintainer status from GitHub', async () => {
    let body: Record<string, unknown> = { id: 9, owner: { login: 'o', avatar_url: '' }, name: 'r', html_url: 'https://github.com/o/r', private: false, archived: false, disabled: false, permissions: { pull: true } }
    const github = new GitHub(async () => new Response(JSON.stringify(body), { status: 200 }))
    expect((await github.launchable('o/r', 't')).maintainer).toBe(false)
    body = { ...body, permissions: { maintain: true } }
    expect((await github.launchable(9, 't')).maintainer).toBe(true)
    await expect(github.launchable(8, 't')).rejects.toThrow('different repository')
    for (const key of ['private', 'archived', 'disabled']) { body = { ...body, [key]: true }; await expect(github.launchable('o/r', 't')).rejects.toThrow('public'); body = { ...body, [key]: false } }
    const missing = new GitHub(async () => new Response('{}', { status: 404 }))
    await expect(missing.launchable('o/nope', 't')).rejects.toThrow('No public GitHub repository found at o/nope')
  })
  it('only returns to same-site paths after sign-in', () => {
    for (const ok of ['/payouts', '/create', '/builder/software', '/dashboard/builder/software']) expect(safeNext(ok)).toBe(ok)
    for (const bad of ['//evil.example', 'https://evil.example', '/a/../b', '/\\evil', '/x?y=1', 'payouts', '', null, undefined, '/' + 'a'.repeat(250)]) expect(safeNext(bad)).toBeNull()
  })
  it('rejects mismatched OAuth state before exchanging any code', async () => {
    let requests = 0
    const auth = createAuth(memory(), new GitHub(), { origin: 'https://commit.example', clientId: 'test', clientSecret: 'test', encryptionKey: 'ab'.repeat(32) }, async () => { requests++; throw Error('Should not run') })
    await expect(auth.callback({ headers: { cookie: 'commit_oauth=expected' } } as IncomingMessage, {} as ServerResponse, new URL('https://commit.example/api/auth/callback?code=code&state=attacker'))).rejects.toThrow('state mismatch')
    expect(requests).toBe(0)
  })
})
describe('Verified contributor wallet mappings', () => {
  it('requires an exact wallet signature and consumes successful challenges once', () => {
    const store = memory(), service = createContributors(store, 'https://commit.example'), wallet = Keypair.generate(), user = { id: 42, login: 'builder', avatar: '' }
    const challenge = service.challenge(user, wallet.publicKey.toBase58())
    const signature = Buffer.from(nacl.sign.detached(Buffer.from(challenge.message), wallet.secretKey)).toString('base64')
    expect(service.verify(user, challenge.id, signature).wallet).toBe(wallet.publicKey.toBase58())
    expect(store.wallet(user.id)).toBe(wallet.publicKey.toBase58())
    expect(() => service.verify(user, challenge.id, signature)).toThrow('expired')
  })
  it('rejects substituted identities, wrong signatures, and wallet reuse across accounts', () => {
    const store = memory(), service = createContributors(store, 'https://commit.example'), wallet = Keypair.generate(), user = { id: 1, login: 'alice', avatar: '' }, other = { id: 2, login: 'bob', avatar: '' }
    let challenge = service.challenge(user, wallet.publicKey.toBase58())
    const sign = (message: string) => Buffer.from(nacl.sign.detached(Buffer.from(message), wallet.secretKey)).toString('base64')
    expect(() => service.verify(other, challenge.id, sign(challenge.message))).toThrow('expired')
    expect(() => service.verify(user, challenge.id, Buffer.alloc(64).toString('base64'))).toThrow('Invalid')
    challenge = service.challenge(user, wallet.publicKey.toBase58()); service.verify(user, challenge.id, sign(challenge.message))
    challenge = service.challenge(other, wallet.publicKey.toBase58())
    expect(() => service.verify(other, challenge.id, sign(challenge.message))).toThrow('already linked')
  })
  it('does not turn commit counts into rewards and enforces a complete allocation', () => {
    expect(validateAllocations({ treasury: 7000, maintainers: 2000, contributors: 1000, platform: 0 })).toEqual({ treasury: 7000, maintainers: 2000, contributors: 1000, platform: 0 })
    for (const input of [{ treasury: 10001, maintainers: -1, contributors: 0, platform: 0 }, { treasury: 7000, maintainers: 0, contributors: 0, platform: 0 }, { commits: 10000 }, { treasury: 9999.5, maintainers: .5, contributors: 0, platform: 0 }]) expect(() => validateAllocations(input)).toThrow()
  })
})
