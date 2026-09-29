import { afterEach, describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { Keypair } from '@solana/web3.js'
import { createStore, type Store } from '../lib/repositories/store'
import { createIntegration } from '../lib/repositories/integration'
import { COMMIT_FEE_RECIPIENT, COMMIT_MAIN_POLICY, COMMIT_MAIN_WALLET, COMMIT_POLICY, MICROSOFT_ASSET, SOL_MINT } from '../lib/pump/policy'
import type { Auth } from '../lib/github/auth'
import type { GitHub } from '../lib/github/api'
import type { Project, User } from '../lib/types'

const stores: Store[] = []
afterEach(() => stores.splice(0).forEach(store => store.db.close()))
const operator: User = { id: 334859250, login: 'commit-pad', avatar: '' }, stranger: User = { id: 7, login: 'someone', avatar: '' }
const repo = (id: number) => ({ id, owner: 'commit-pad', name: `repo${id}`, description: '', stars: 0, forks: 0, language: null, url: `https://github.com/commit-pad/repo${id}`, avatar: '', updatedAt: '', verifiedAt: '', topics: [] })

function setup(user: User) {
  const store = createStore(':memory:'); stores.push(store)
  const auth = { requireSession: () => ({ user, token: 't' }) } as unknown as Auth
  const github = { launchable: async (id: number) => ({ repo: repo(id), maintainer: true }) } as unknown as GitHub
  const core = () => ({ status: async () => null, planForMint: async () => null }) as never
  const integration = createIntegration(store, auth, github, core, u => u.id === operator.id)
  const req = {} as IncomingMessage
  const metadata = (id: number, main: boolean, login = user.login) => ({ github: { id, url: repo(id).url }, commitLaunch: { type: 'maintainer', launchedBy: login, main }, commitFunding: { policy: main ? COMMIT_MAIN_POLICY : COMMIT_POLICY } })
  const mainInput = (id: number, extra: Record<string, unknown> = {}) => ({ repositoryId: id, commitPolicy: COMMIT_MAIN_POLICY, quoteMint: SOL_MINT, creatorTax: '0', treasury: COMMIT_MAIN_WALLET, owner: COMMIT_MAIN_WALLET, mint: Keypair.generate().publicKey.toBase58(), category: 'Open Source', maintainerWallets: [], ...extra })
  return { store, integration, req, metadata, mainInput }
}

describe('Commit main coin exception', () => {
  it('only the operator, signing with the main wallet, can launch it: SOL pair, standard fee, fees to the main wallet', async () => {
    const outsider = setup(stranger)
    await expect(outsider.integration.metadata(outsider.req, { repositoryId: 1, commitPolicy: COMMIT_MAIN_POLICY })).rejects.toThrow('Only the Commit operator')
    await expect(outsider.integration.authorize(outsider.req, outsider.mainInput(1), outsider.metadata(1, true))).rejects.toThrow('Only the Commit operator')

    const { store, integration, req, metadata, mainInput } = setup(operator)
    expect(await integration.metadata(req, { repositoryId: 1, commitPolicy: COMMIT_MAIN_POLICY })).toMatchObject({ commitLaunch: { main: true }, commitFunding: { policy: COMMIT_MAIN_POLICY, quoteMint: SOL_MINT, feeRecipient: COMMIT_MAIN_WALLET } })
    await expect(integration.authorize(req, mainInput(1, { owner: Keypair.generate().publicKey.toBase58() }), metadata(1, true))).rejects.toThrow('main wallet')
    await expect(integration.authorize(req, mainInput(1, { quoteMint: MICROSOFT_ASSET.mint }), metadata(1, true))).rejects.toThrow('standard SOL-paired')
    await expect(integration.authorize(req, mainInput(1, { creatorTax: '2' }), metadata(1, true))).rejects.toThrow('standard SOL-paired')
    await expect(integration.authorize(req, mainInput(1, { treasury: COMMIT_FEE_RECIPIENT }), metadata(1, true))).rejects.toThrow('standard SOL-paired')
    await expect(integration.authorize(req, mainInput(1), metadata(1, false))).rejects.toThrow('metadata again') // metadata must say main
    const input = mainInput(1)
    expect(await integration.authorize(req, input, metadata(1, true))).toBe(COMMIT_MAIN_WALLET) // plain recipient → Pump.fun standard fees
    expect(store.intent(1)).toMatchObject({ main: true, treasury: COMMIT_MAIN_WALLET, launchPolicy: COMMIT_MAIN_POLICY })
    expect(store.intent(1)!.fundingMode).toBeUndefined() // direct: no Commit payout program

    const plan = { id: 'p', mint: input.mint, owner: COMMIT_MAIN_WALLET, feeRecipient: COMMIT_MAIN_WALLET, creatorTaxBps: 0, quote: { mint: SOL_MINT } } as never
    await integration.prepared(plan)
    await expect(integration.prepared({ ...(plan as object), creatorTaxBps: 200 } as never)).rejects.toThrow('differs')
    await expect(integration.prepared({ ...(plan as object), quote: MICROSOFT_ASSET } as never)).rejects.toThrow('differs')

    // Only one main coin: a second repository is refused while the first is pending or live.
    await expect(integration.authorize(req, mainInput(2), metadata(2, true))).rejects.toThrow('already has a main coin')
    store.publish({ repo: repo(1), coin: { mint: input.mint }, main: true } as unknown as Project)
    await expect(integration.authorize(req, mainInput(3), metadata(3, true))).rejects.toThrow('already has a main coin')
  })

  it('leaves every other launch on the Microsoft / 2% / collection-wallet policy', async () => {
    const { integration, req, metadata } = setup(operator)
    const input = { repositoryId: 5, commitPolicy: COMMIT_POLICY, quoteMint: SOL_MINT, creatorTax: '0', treasury: COMMIT_FEE_RECIPIENT, owner: COMMIT_MAIN_WALLET, mint: Keypair.generate().publicKey.toBase58(), category: 'Open Source', maintainerWallets: [] }
    await expect(integration.authorize(req, input, metadata(5, false))).rejects.toThrow('Microsoft xStock')
    expect(await integration.authorize(req, { ...input, quoteMint: MICROSOFT_ASSET.mint, creatorTax: '2' }, metadata(5, false))).toEqual({ feeRecipient: COMMIT_FEE_RECIPIENT, requiredCreatorFeeBps: 200 })
  })
})
