import { createContext, useContext } from 'react'
import type { useSolanaWallet, Recovery, Plan } from '../packages/pump-core/client'
import type { User } from '../lib/types'
export type AppState = {
  wallet: ReturnType<typeof useSolanaWallet>; connect: () => void; user: User | null; githubConfigured: boolean; payoutAdmin: boolean;
  /** false until /api/commit/session has answered: pages show a loading state instead of the signed-out view. */
  sessionLoaded: boolean;
  refreshSession: () => Promise<void>; navigate: (path: string) => void; pending: Recovery | null; activity: Plan | null;
  onPending: (record: Recovery, plan: Plan) => void; onActivity: (plan: Plan) => void
}
export const AppContext = createContext<AppState>(null!)
export const useApp = () => useContext(AppContext)
