import { randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'
import { PublicKey } from '@solana/web3.js'
import { HttpError } from '../../packages/pump-core/server'
import type { Store } from '../repositories/store'
import type { User, Allocation } from '../types'
export function validateAllocations(input: unknown): Allocation {
  const value = input as Allocation
  const keys = ['treasury', 'maintainers', 'contributors', 'platform'] as const
  if (!value || keys.some(key => !Number.isInteger(value[key]) || value[key] < 0 || value[key] > 10000) || keys.reduce((sum, key) => sum + value[key], 0) !== 10000) throw new HttpError(400, 'Allocation basis points must be non-negative integers totaling 10,000 (100%).')
  return Object.fromEntries(keys.map(key => [key, value[key]])) as Allocation
}
export function createContributors(store: Store, origin: string) {
  return {
    challenge(user: User, wallet: string) {
      const key = new PublicKey(wallet)
      if (key.toBase58() !== wallet || !PublicKey.isOnCurve(key.toBytes())) throw new HttpError(400, 'Choose a valid signing wallet.')
      store.cleanup()
      const id = randomBytes(32).toString('hex'), expires = Date.now() + 300000
      const message = `Commit wallet verification\nOrigin: ${origin}\nGitHub: ${user.login} (${user.id})\nWallet: ${wallet}\nNonce: ${id}\nExpires: ${new Date(expires).toISOString()}\n\nThis signature links your wallet to GitHub. It authorizes no transaction.`
      store.db.prepare('DELETE FROM challenges WHERE user_id=?').run(user.id)
      store.db.prepare('INSERT INTO challenges(id,user_id,wallet,message,expires) VALUES(?,?,?,?,?)').run(id, user.id, wallet, message, expires)
      return { id, message, expires }
    },
    verify(user: User, id: string, signature: string) {
      const challenge = store.db.prepare('DELETE FROM challenges WHERE id=? AND user_id=? RETURNING wallet,message,expires').get(id, user.id) as { wallet: string; message: string; expires: number } | undefined
      if (!challenge || challenge.expires < Date.now()) throw new HttpError(400, 'Wallet verification expired. Request a new signature.')
      const bytes = Buffer.from(signature, 'base64')
      if (bytes.length !== 64 || !nacl.sign.detached.verify(Buffer.from(challenge.message), bytes, new PublicKey(challenge.wallet).toBytes())) throw new HttpError(403, 'Invalid wallet verification signature.')
      const occupied = store.db.prepare('SELECT user_id FROM wallets WHERE wallet=?').get(challenge.wallet) as { user_id: number } | undefined
      if (occupied && occupied.user_id !== user.id) throw new HttpError(409, 'This wallet is already linked to another GitHub account.')
      store.db.prepare('INSERT INTO wallets(user_id,login,wallet) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET login=excluded.login,wallet=excluded.wallet').run(user.id, user.login, challenge.wallet)
      store.audit(user.id, 'wallet.link', null, { wallet: challenge.wallet })
      return { wallet: challenge.wallet }
    },
  }
}
