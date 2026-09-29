import type { Coin, CoinFeeStats, QuoteAsset } from '../packages/pump-core/client'
export type User = { id: number; login: string; avatar: string; wallet?: string }
export type Repository = {
  id: number; owner: string; name: string; description: string; stars: number; forks: number;
  language: string | null; url: string; avatar: string; updatedAt: string; verifiedAt: string; topics: string[]
  // forks are labelled so a fork's maintainer is never mistaken for the original project's
  forked?: boolean; parent?: { owner: string; name: string; url: string } | null
}
export type Development = {
  repository: Repository;
  contributors: { id: number; login: string; avatar_url: string; html_url: string }[]; contributorCount: number;
  releases: { name: string; tag_name: string; html_url: string; published_at: string }[];
  pulls: { number: number; title: string; html_url: string; merged_at: string; user: { login: string } }[];
  events: { id: string; type: string; created_at: string; actor: { login: string }; payload: { size?: number } }[];
  fetchedAt: string
}
export const categories = ['AI', 'Developer Tools', 'Infrastructure', 'Games', 'Crypto', 'Open Source'] as const
export type Category = typeof categories[number]
export type Allocation = { treasury: number; maintainers: number; contributors: number; platform: number }
export type MetricPoint = { time: number; volume24h: number | null; holders: number | null; revenue: number | null }
// 'maintainer': launched by someone with admin/maintain permission on the repository.
// 'community': launched by anyone else; the repository's maintainers still own the fee claims.
export type LaunchType = 'maintainer' | 'community'
export type Project = { repo: Repository; coin: Coin; treasury: string; category: Category; allocations: Allocation; launchUser: number; launch?: LaunchType; launchedBy?: string; main?: boolean; claimedAt?: string; claimedBy?: string; hidden?: { at: string; reason: string }; maintainerWallets: string[]; fundingMode?: 'manual-v1'; discovery?: { contributors: number | null; volume24h: number | null; revenue: number | null; measuredAt: number | null } }
export type Eligibility = { userId: number; login: string; wallet: string | null; approved: boolean; reason: string; evidence: string[]; approvedBy: number; updatedAt: string }
export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled'
export type PayoutRequest = { id: string; repositoryId: number; userId: number; login: string; wallet: string; quoteMint: string; amount: string; status: PayoutStatus; note: string; decisionNote: string; createdAt: number; updatedAt: number; decidedBy: number | null; signature: string | null; paidAt: number | null }
export type TreasurySummary = { repositoryId: number; collector: string; quote: QuoteAsset; fees: CoinFeeStats; paid: string; reserved: string; available: string | null; canRequest: boolean; reason: string; wallet: string | null; requests: PayoutRequest[]; fundingMode: 'manual-v1' | 'direct' }
export type AdminPayout = PayoutRequest & { repository: string; symbol: string; quote: QuoteAsset; tokenMint: string }
export type MyPayout = { project: Project; role: 'maintainer' | 'contributor'; treasury: TreasurySummary }
export const reportReasons = ['impersonation', 'trademark', 'copyright', 'scam', 'other'] as const
export const reportRelationships = ['maintainer', 'owner', 'holder', 'other'] as const
export type Report = { id: string; target: string; repositoryId: number | null; reason: typeof reportReasons[number]; relationship: typeof reportRelationships[number]; details: string; contact: string; status: 'open' | 'resolved' | 'dismissed'; note: string; createdAt: number; updatedAt: number }
