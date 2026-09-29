import { createRequire } from 'node:module'
import { buildLaunch, connection } from '../packages/pump-core/server'
import { COMMIT_CREATOR_FEE_BPS, COMMIT_FEE_RECIPIENT, COMMIT_MAIN_WALLET, MICROSOFT_ASSET, SOL_MINT } from '../lib/pump/policy'
const require = createRequire(new URL('../../pawn-solana/package.json', import.meta.url))
const { PUMP_PROGRAM_ID } = require('@pump-fun/pump-sdk') as typeof import('../../pawn-solana/node_modules/@pump-fun/pump-sdk')
const { Keypair, PublicKey } = require('@solana/web3.js') as typeof import('../../pawn-solana/node_modules/@solana/web3.js')
try { process.loadEnvFile('.env.local') } catch { /* Host may supply RPC configuration. */ }
const rpc = connection()
let owner = ''
// Read a public funded payer for an unsigned simulation. No wallet keys, signing,
// or sendRawTransaction calls are used by this check.
for (const signature of await rpc.getSignaturesForAddress(PUMP_PROGRAM_ID, { limit: 10 })) {
  const receipt = await rpc.getTransaction(signature.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null)
  const payer = receipt?.transaction.message.staticAccountKeys[0]
  if (payer && PublicKey.isOnCurve(payer.toBytes()) && await rpc.getBalance(payer) > 100000000) { owner = payer.toBase58(); break }
}
if (!owner) throw Error('No public funded payer was available for unsigned simulation.')
for (const buy of ['0']) {
  const plan = await buildLaunch(rpc, { owner, mint: Keypair.generate().publicKey.toBase58(), name: 'Commit unsigned simulation', symbol: 'CODETEST', uri: `https://commitpad.fun/metadata/${'a'.repeat(64)}.json`, quoteMint: MICROSOFT_ASSET.mint, creatorTax: '2', buy, feeRecipient: COMMIT_FEE_RECIPIENT, requiredCreatorFeeBps: COMMIT_CREATOR_FEE_BPS })
  if (plan.feeRecipient !== COMMIT_FEE_RECIPIENT || plan.creatorTaxBps !== 200 || plan.quote.mint !== MICROSOFT_ASSET.mint || plan.quote.decimals !== 8) throw Error('Simulated Microsoft / 2% / recipient policy mismatch.')
  console.log(JSON.stringify({ simulated: true, quote: plan.quote, feeRecipient: plan.feeRecipient, creatorFeeBps: plan.creatorTaxBps, buy, bytes: Buffer.from(plan.transaction, 'base64').length, debitLamports: plan.estimatedDebitLamports, broadcast: false }))
}
// Commit's main coin: standard SOL pair, Pump.fun's standard creator fee, creator = the main wallet (also the signer).
// Simulated with the main wallet as payer; nothing is signed or sent.
{
  const plan = await buildLaunch(rpc, { owner: COMMIT_MAIN_WALLET, mint: Keypair.generate().publicKey.toBase58(), name: 'Commit main simulation', symbol: 'COMMITSIM', uri: `https://commitpad.fun/metadata/${'b'.repeat(64)}.json`, quoteMint: SOL_MINT, creatorTax: '0', buy: '0', feeRecipient: COMMIT_MAIN_WALLET })
  if (plan.feeRecipient !== COMMIT_MAIN_WALLET || plan.creatorTaxBps !== 0 || plan.quote.mint !== SOL_MINT || plan.quote.decimals !== 9) throw Error('Simulated main-coin SOL / standard fee / recipient policy mismatch.')
  console.log(JSON.stringify({ simulated: true, mainCoin: true, quote: plan.quote.symbol, feeRecipient: plan.feeRecipient, creatorFeeBps: plan.creatorTaxBps, bytes: Buffer.from(plan.transaction, 'base64').length, debitLamports: plan.estimatedDebitLamports, broadcast: false }))
}
