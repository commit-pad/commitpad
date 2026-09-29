import type { IncomingMessage } from 'node:http'
import { address, HttpError, type LaunchIntegration, type createSolanaApi } from '../../packages/pump-core/server'
import { COMMIT_POLICY, COMMIT_FEE_RECIPIENT, COMMIT_CREATOR_FEE_BPS, COMMIT_MAIN_POLICY, COMMIT_MAIN_WALLET, MICROSOFT_ASSET, SOL_MINT } from '../pump/policy'
import type { Auth } from '../github/auth'
import type { GitHub } from '../github/api'
import type { Store } from './store'
import { categories, type Category, type User } from '../types'

type Plan = Parameters<LaunchIntegration['prepared']>[0]
/** Every launch follows the Microsoft / 2% / collection-wallet policy, except Commit's single main coin. */
const matchesPolicy = (plan: Plan, main: boolean) => main
  ? plan.feeRecipient === COMMIT_MAIN_WALLET && plan.owner === COMMIT_MAIN_WALLET && plan.quote?.mint === SOL_MINT && plan.creatorTaxBps === 0
  : plan.feeRecipient === COMMIT_FEE_RECIPIENT && plan.creatorTaxBps === COMMIT_CREATOR_FEE_BPS && plan.quote?.mint === MICROSOFT_ASSET.mint

export function createIntegration(store: Store, auth: Auth, github: GitHub, core: () => ReturnType<typeof createSolanaApi>, isOperator: (user: User) => boolean = () => false): LaunchIntegration {
  // Anyone signed in with GitHub may launch any active public repository. Maintainer powers (settings,
  // contributor approval, fee claims) are never derived from the launch; they are re-verified with GitHub.
  const verify = async (req: IncomingMessage, id: unknown) => { const session = auth.requireSession(req); return { session, ...await github.launchable(Number(id), session.token) } }
  const OPEN_LAUNCH_LIMIT = 3
  const mainTaken = (repoId: number) => store.projects().some(p => p.main) || store.intents().some(i => i.main && i.repo.id !== repoId && !store.project(i.repo.id))
  return {
    async metadata(req, input) {
      const { repo, maintainer, session } = await verify(req, input.repositoryId)
      const main = input.commitPolicy === COMMIT_MAIN_POLICY
      if (main && !isOperator(session.user)) throw new HttpError(403, 'Only the Commit operator can launch the main coin.')
      return {
        github: { id: repo.id, owner: repo.owner, name: repo.name, url: repo.url, verifiedAt: repo.verifiedAt },
        commitLaunch: { type: maintainer ? 'maintainer' : 'community', launchedBy: session.user.login, main, feeClaims: main ? 'Pump.fun creator fees to the main wallet' : 'repository maintainers and the contributors they approve' },
        commitFunding: main
          ? { policy: COMMIT_MAIN_POLICY, quoteMint: SOL_MINT, creatorFee: 'Pump.fun standard', feeRecipient: COMMIT_MAIN_WALLET, payouts: 'direct' }
          : { policy: COMMIT_POLICY, quoteMint: MICROSOFT_ASSET.mint, creatorFeeBps: COMMIT_CREATOR_FEE_BPS, feeRecipient: COMMIT_FEE_RECIPIENT, payouts: 'manual requests' },
      }
    },
    async authorize(req, input, metadata) {
      const { repo, session, maintainer } = await verify(req, input.repositoryId)
      const link = metadata.github as { id?: number; url?: string } | undefined
      if (link?.id !== repo.id || link.url !== repo.url) throw new HttpError(400, 'Upload metadata for the selected repository again.')
      const main = input.commitPolicy === COMMIT_MAIN_POLICY
      // The published metadata names the launcher and launch type: it must be this user's, for this launch.
      const launch = metadata.commitLaunch as { type?: string; launchedBy?: string; main?: boolean } | undefined
      if (launch?.launchedBy !== session.user.login || launch.type !== (maintainer ? 'maintainer' : 'community') || !!launch.main !== main) throw new HttpError(400, 'Upload the token metadata again from your own account.')
      const funding = metadata.commitFunding as { policy?: string } | undefined
      const mint = address(input.mint).toBase58(), owner = address(input.owner).toBase58()
      if (main) {
        // The one exception: operator session AND the main wallet as signer, standard SOL pair, fees to that wallet, only once.
        if (!isOperator(session.user)) throw new HttpError(403, 'Only the Commit operator can launch the main coin.')
        if (owner !== COMMIT_MAIN_WALLET) throw new HttpError(403, 'Connect Commit’s main wallet to launch the main coin.')
        if (input.quoteMint !== SOL_MINT || input.creatorTax !== '0' || input.treasury !== COMMIT_MAIN_WALLET || funding?.policy !== COMMIT_MAIN_POLICY) throw new HttpError(400, 'The main coin is a standard SOL-paired Pump.fun launch with creator fees to the main wallet. Refresh the launch page.')
        if (mainTaken(repo.id)) throw new HttpError(409, 'Commit already has a main coin.')
      } else {
        if (input.quoteMint !== MICROSOFT_ASSET.mint || input.creatorTax !== '2' || input.commitPolicy !== COMMIT_POLICY || input.treasury !== COMMIT_FEE_RECIPIENT) throw new HttpError(400, 'All Commit launches require Microsoft xStock (MSFTx), a 2% creator fee, and the designated fee-collection wallet. Refresh the launch page.')
        if (funding?.policy !== COMMIT_POLICY) throw new HttpError(400, 'Publish metadata with the current Commit funding policy.')
      }
      const treasury = main ? COMMIT_MAIN_WALLET : COMMIT_FEE_RECIPIENT
      if (!categories.includes(input.category as Category)) throw new HttpError(400, 'Choose a project category.')
      if (!Array.isArray(input.maintainerWallets) || input.maintainerWallets.length > 20) throw new HttpError(400, 'Provide at most 20 maintainer wallets.')
      const maintainerWallets = [...new Set(input.maintainerWallets.map(value => address(value).toBase58()))]
      if (store.project(repo.id)) throw new HttpError(409, 'This repository already has a token.')
      // Other launches this user has open. Failed, expired, or abandoned ones are released rather than counted.
      for (const other of store.intents().filter(i => i.userId === session.user.id && i.repo.id !== repo.id && !store.project(i.repo.id))) {
        const plan = other.planId ? await core().status(other.planId).catch(() => null) : null
        if (other.planId ? !plan || plan.status === 'failed' || plan.status === 'expired' : other.createdAt < Date.now() - 10 * 60000) store.release(other.mint)
      }
      const old = store.intent(repo.id)
      if (old) {
        const previous = await core().planForMint(old.mint)
        const checked = previous && await core().status(previous.id)
        if (checked?.status === 'failed' || checked?.status === 'expired' || (!previous && old.createdAt < Date.now() - 10 * 60000)) store.release(old.mint)
        else throw new HttpError(409, 'This repository already has a launch review or pending transaction. Resolve it before creating another.')
      }
      // Counted with no await before reserve(), so parallel requests can't both slip under the limits.
      const open = store.intents().filter(i => i.userId === session.user.id && i.repo.id !== repo.id && !store.project(i.repo.id))
      if (open.length >= OPEN_LAUNCH_LIMIT) throw new HttpError(429, `You have ${OPEN_LAUNCH_LIMIT} launches in review. Finish one, or wait for an unsigned review to expire (about 10 minutes).`)
      if (main && mainTaken(repo.id)) throw new HttpError(409, 'Commit already has a main coin.')
      try { store.reserve({ repo, mint, owner, treasury, userId: session.user.id, launch: maintainer ? 'maintainer' : 'community', launchedBy: session.user.login, main, createdAt: Date.now(), category: input.category as Category, maintainerWallets, fundingMode: main ? undefined : 'manual-v1', launchPolicy: main ? COMMIT_MAIN_POLICY : COMMIT_POLICY }) }
      catch { throw new HttpError(409, 'Another launch reserved this repository. Check its status first.') }
      // A plain recipient keeps Pump.fun's standard fee schedule (SOL pair); otherwise the fixed 2% is required.
      return main ? COMMIT_MAIN_WALLET : { feeRecipient: treasury, requiredCreatorFeeBps: COMMIT_CREATOR_FEE_BPS }
    },
    async prepared(plan) { const intent = store.intentByMint(plan.mint); if (!intent || plan.owner !== intent.owner || !matchesPolicy(plan, intent.launchPolicy === COMMIT_MAIN_POLICY)) throw new HttpError(403, 'Pair, fee, or recipient differs from the approved repository launch.'); store.prepared(plan.mint, plan.id) },
    async failed(mint) { store.release(mint) },
    async submit(req, plan) {
      const intent = store.intentByMint(plan.mint)
      if (!intent || plan.feeRecipient !== intent.treasury || plan.owner !== intent.owner) throw new HttpError(403, 'Repository launch authorization is missing.')
      const main = intent.launchPolicy === COMMIT_MAIN_POLICY
      if ((!main && intent.launchPolicy !== COMMIT_POLICY) || !matchesPolicy(plan, main)) throw new HttpError(403, main ? 'Main coin policy changed. Review the launch again.' : 'Launch policy changed. A Microsoft / 2% review is required.')
      const { session } = await verify(req, intent.repo.id)
      if (session.user.id !== intent.userId) throw new HttpError(403, 'Sign in with the GitHub account that reviewed this launch.')
      if (main && !isOperator(session.user)) throw new HttpError(403, 'Only the Commit operator can launch the main coin.')
    },
  }
}
