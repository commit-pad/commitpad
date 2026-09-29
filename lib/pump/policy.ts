import type { QuoteAsset } from '../../packages/pump-core/client'

export const COMMIT_POLICY = 'commit-msftx-2-manual-v1'
export const COMMIT_CREATOR_FEE_BPS = 200
export const COMMIT_FEE_RECIPIENT = 'GDKuQbSr9v6AzC5ZWzXvnkQFkWULB7eWmovgS451J6Ya'
export const MICROSOFT_ASSET: QuoteAsset = {
  mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX',
  name: 'Microsoft xStock', symbol: 'MSFTx', decimals: 8, native: false,
  tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
}
export type CommitLaunchPolicy = { quote: QuoteAsset; creatorFeeBps: number; feeRecipient: string; version: string; checkedAt: number }
/**
 * Commit's own main coin: the one exception to the Microsoft / 2% policy. Only the Commit operator, signing with
 * this wallet, can launch it; it is a standard SOL-paired Pump.fun coin whose creator fees go to this wallet, and
 * it is pinned as the main coin. There is only ever one.
 */
export const COMMIT_MAIN_WALLET = '78DuBUzNxoDQTVXFsBFWgtyNvCySsLQXLLiLn4uyvUw1'
export const COMMIT_MAIN_POLICY = 'commit-main-sol-v1'
export const SOL_MINT = 'So11111111111111111111111111111111111111112'
