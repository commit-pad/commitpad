import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { createStore, type Store } from '../lib/repositories/store'
import { createPayoutLedger, createPayouts, validatePayoutReceipt, type PayoutReceipt } from '../lib/contributors/payouts'
import { COMMIT_FEE_RECIPIENT, MICROSOFT_ASSET } from '../lib/pump/policy'
import { creatorFee } from '../../pawn-solana/server/pairs'
import { HttpError } from '../packages/pump-core/server'
import type { Auth } from '../lib/github/auth'
import type { GitHub } from '../lib/github/api'
import type { Project, User, PayoutRequest } from '../lib/types'
import type { CoinFeeStats } from '../packages/pump-core/client'

let store: Store
const wallet = Keypair.generate().publicKey.toBase58(), wallet2 = Keypair.generate().publicKey.toBase58()
const user: User = { id: 2, login: 'builder', avatar: '' }, second: User = { id: 3, login: 'contributor', avatar: '' }
const project: Project = { repo: { id: 123, owner: 'builder', name: 'software', description: '', stars: 0, forks: 0, language: null, url: 'https://github.com/builder/software', avatar: '', updatedAt: '', verifiedAt: '', topics: [] }, coin: { mint: Keypair.generate().publicKey.toBase58(), owner: wallet, name: 'Software', symbol: 'CODE', description: '', image: '', website: '', twitter: '', telegram: '', uri: '', signature: '', createdAt: Date.now(), quote: MICROSOFT_ASSET, feeRecipient: COMMIT_FEE_RECIPIENT, creatorTaxBps: 200 }, treasury: COMMIT_FEE_RECIPIENT, category: 'Developer Tools', allocations: { treasury: 10000, maintainers: 0, contributors: 0, platform: 0 }, launchUser: 2, maintainerWallets: [], fundingMode: 'manual-v1' }
beforeEach(() => { store = createStore(':memory:'); store.publish(project) })
afterEach(() => { store.db.close(); vi.unstubAllEnvs() })

it('allows an explicit 2% server policy while preserving Pawns’ default 3% requirement and protocol cap', () => {
  expect(creatorFee('2', MICROSOFT_ASSET.mint, true, 300, 200)).toBe(200)
  expect(() => creatorFee('2', MICROSOFT_ASSET.mint, true, 300)).toThrow('fixed 3%')
  expect(() => creatorFee('3', MICROSOFT_ASSET.mint, true, 300, 200)).toThrow('fixed 2%')
  expect(() => creatorFee('2', MICROSOFT_ASSET.mint, true, 100, 200)).toThrow('maximum')
  expect(() => creatorFee('2', MICROSOFT_ASSET.mint, false, 300, 200)).toThrow('maximum')
})

it('reserves exact base units per coin, rejects duplicate/overdrawn claims, and releases only pending claims', () => {
  const ledger = createPayoutLedger(store)
  const first = ledger.request(project, user, wallet, 80000000n, 100000000n, 'Accepted work')
  expect(ledger.totals(123)).toEqual({ paid: 0n, reserved: 80000000n })
  expect(() => ledger.request(project, user, wallet, 1n, 100000000n, '')).toThrow('already have')
  expect(() => ledger.request(project, second, wallet2, 30000000n, 100000000n, '')).toThrow('exceeds')
  expect(() => ledger.cancel(first.id, second.id)).toThrow('not found')
  ledger.cancel(first.id, user.id)
  expect(ledger.totals(123).reserved).toBe(0n)
  const next = ledger.request(project, second, wallet2, 100000000n, 100000000n, '')
  ledger.decide(next.id, 1, 'approve', '')
  expect(() => ledger.cancel(next.id, second.id)).toThrow('pending')
  expect(() => ledger.decide(next.id, 1, 'reject', 'Changed mind')).toThrow('no longer pending')
  const otherProject = { ...project, repo: { ...project.repo, id: 456, name: 'other' }, coin: { ...project.coin, mint: Keypair.generate().publicKey.toBase58() } }
  store.publish(otherProject)
  expect(ledger.request(otherProject, user, wallet, 1n, 1n, '').amount).toBe('1')
})

it('deduplicates settlement receipts and moves reserves to paid without resetting lifetime earnings', () => {
  const ledger = createPayoutLedger(store), first = ledger.request(project, user, wallet, 200n, 1000n, '')
  ledger.decide(first.id, 1, 'approve', '')
  ledger.paid(first.id, 1, 'receipt-one', Date.now())
  expect(ledger.paid(first.id, 1, 'receipt-one', Date.now()).status).toBe('paid')
  expect(ledger.totals(123)).toEqual({ paid: 200n, reserved: 0n })
  const next = ledger.request(project, second, wallet2, 100n, 1000n, '')
  ledger.decide(next.id, 1, 'approve', '')
  expect(() => ledger.paid(next.id, 1, 'receipt-one', Date.now())).toThrow('already been used')
  expect(ledger.totals(123)).toEqual({ paid: 200n, reserved: 100n })
})

function receipt(row: PayoutRequest, signature: string): PayoutReceipt {
  return { blockTime: Math.floor(Date.now() / 1000), transaction: { signatures: [signature], message: { accountKeys: [{ pubkey: COMMIT_FEE_RECIPIENT, signer: true }, { pubkey: wallet, signer: false }] } }, meta: { err: null, preTokenBalances: [{ accountIndex: 1, mint: MICROSOFT_ASSET.mint, owner: COMMIT_FEE_RECIPIENT, uiTokenAmount: { amount: '100000000', decimals: 8 } }], postTokenBalances: [{ accountIndex: 1, mint: MICROSOFT_ASSET.mint, owner: COMMIT_FEE_RECIPIENT, uiTokenAmount: { amount: (100000000n - BigInt(row.amount)).toString(), decimals: 8 } }, { accountIndex: 2, mint: MICROSOFT_ASSET.mint, owner: row.wallet, uiTokenAmount: { amount: row.amount, decimals: 8 } }] } }
}
it('requires the finalized receipt’s exact asset, receiver, amount, collection-wallet signer, and time', () => {
  const row = createPayoutLedger(store).request(project, user, wallet, 20000000n, 100000000n, ''), signature = bs58.encode(new Uint8Array(64).fill(7))
  expect(validatePayoutReceipt(receipt(row, signature), row, signature)).toBeGreaterThan(0)
  expect(() => validatePayoutReceipt(null, row, signature)).toThrow('finalized')
  const mutations: ((tx: PayoutReceipt) => void)[] = [
    tx => { tx.meta!.err = { failed: true } },
    tx => { tx.transaction.message.accountKeys[0].signer = false },
    tx => { tx.transaction.message.accountKeys[0].pubkey = wallet2 },
    tx => { tx.meta!.postTokenBalances![1].owner = wallet2 },
    tx => { tx.meta!.postTokenBalances![1].uiTokenAmount.amount = '1' },
    tx => { tx.meta!.postTokenBalances![1].mint = wallet2 },
    tx => { tx.blockTime = Math.floor(row.createdAt / 1000) - 120 },
    tx => { tx.transaction.signatures[0] = 'different' },
  ]
  for (const mutate of mutations) { const tx = receipt(row, signature); mutate(tx); expect(() => validatePayoutReceipt(tx, row, signature)).toThrow() }
})

it('enforces verified wallets, maintainer/contributor eligibility, fresh fees, and operator-only settlement', async () => {
  vi.stubEnv('COMMIT_PAYOUT_ADMIN_IDS', '1')
  let current = user, manage = false
  let fee: CoinFeeStats = { amount: '100000000', trades: 1, status: 'complete', updatedAt: Date.now() }
  let proof: PayoutReceipt | null = null
  const auth = { session: () => ({ user: current, token: 'fixture' }), requireSession: () => ({ user: current, token: 'fixture' }) } as unknown as Auth
  const github = { verify: async () => { if (!manage) throw new HttpError(403, 'No permission'); return project.repo } } as unknown as GitHub
  const service = createPayouts(store, auth, github, async () => fee, async () => proof), req = {} as IncomingMessage
  expect(service.isAdmin(user)).toBe(false)
  expect(() => service.requireAdmin(req)).toThrow('operator')
  // Not a maintainer and not approved: told who can claim before anything about wallets.
  await expect(service.request(req, project, { amount: '0.2', note: '' })).rejects.toThrow('Only maintainers of builder/software')
  store.approve(123, { userId: user.id, login: user.login, wallet: null, approved: true, reason: 'Accepted contribution', evidence: ['https://github.com/builder/software/pull/1'], approvedBy: 1, updatedAt: new Date().toISOString() })
  await expect(service.request(req, project, { amount: '0.2', note: '' })).rejects.toThrow('Verify a payout wallet')
  store.db.prepare('INSERT INTO wallets(user_id,login,wallet) VALUES(?,?,?)').run(user.id, user.login, wallet)
  fee = { ...fee, status: 'indexing' }
  await expect(service.request(req, project, { amount: '0.2', note: '' })).rejects.toThrow('complete fee indexing')
  fee = { ...fee, status: 'complete', updatedAt: Date.now() - 400000 }
  expect((await service.summary(req, project)).available).toBeNull()
  fee = { ...fee, updatedAt: Date.now() }
  const row = await service.request(req, project, { amount: '0.2', note: '', wallet: wallet2 })
  expect(row.wallet).toBe(wallet)
  expect(row.amount).toBe('20000000')
  expect((await service.summary(req, project)).canRequest).toBe(false)
  const signature = bs58.encode(new Uint8Array(64).fill(7))
  await expect(service.settle(req, row.id, signature)).rejects.toThrow('operator')
  current = { id: 1, login: 'operator', avatar: '' }; manage = true
  service.ledger.decide(row.id, current.id, 'approve', '')
  await expect(service.settle(req, row.id, signature)).rejects.toThrow('finalized')
  expect(service.ledger.get(row.id)?.status).toBe('approved')
  proof = receipt(row, signature)
  expect((await service.settle(req, row.id, signature)).status).toBe('paid')
  expect(service.ledger.totals(123)).toEqual({ paid: 20000000n, reserved: 0n })
})
