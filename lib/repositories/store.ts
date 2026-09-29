import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Project, Repository, User, Category, Allocation, Eligibility, MetricPoint, Development, LaunchType, Report } from '../types'

export type Intent = { repo: Repository; mint: string; owner: string; treasury: string; userId: number; launch?: LaunchType; launchedBy?: string; main?: boolean; createdAt: number; planId?: string; category: Category; maintainerWallets: string[]; fundingMode?: 'manual-v1'; launchPolicy?: string }
export function createStore(file: string) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(file)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user TEXT NOT NULL, token TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth (id TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS intents (repo_id INTEGER PRIMARY KEY, mint TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (repo_id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, mint TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wallets (user_id INTEGER PRIMARY KEY, login TEXT NOT NULL, wallet TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, wallet TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS eligibility (repo_id INTEGER NOT NULL REFERENCES projects(repo_id), user_id INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(repo_id,user_id));
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor INTEGER NOT NULL, action TEXT NOT NULL, repo_id INTEGER, at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metrics (repo_id INTEGER NOT NULL, time INTEGER NOT NULL, volume REAL, holders INTEGER, revenue REAL, PRIMARY KEY(repo_id,time));
    CREATE TABLE IF NOT EXISTS repository_snapshots (repo_id INTEGER PRIMARY KEY, data TEXT NOT NULL, fetched INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS metrics_by_time ON metrics(time);
    CREATE TABLE IF NOT EXISTS payout_requests (
      id TEXT PRIMARY KEY, repo_id INTEGER NOT NULL REFERENCES projects(repo_id), user_id INTEGER NOT NULL,
      login TEXT NOT NULL, wallet TEXT NOT NULL, quote_mint TEXT NOT NULL, amount TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','paid','rejected','cancelled')),
      note TEXT NOT NULL, decision_note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, decided_by INTEGER, signature TEXT UNIQUE, paid_at INTEGER,
      earned_snapshot TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS payout_one_open ON payout_requests(repo_id,user_id) WHERE status IN ('pending','approved');
    CREATE INDEX IF NOT EXISTS payout_by_repository ON payout_requests(repo_id,created_at);
    CREATE INDEX IF NOT EXISTS payout_by_status ON payout_requests(status,created_at);
    CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS reports_by_status ON reports(status,created_at);
  `)
  const decode = <T>(row: unknown): T | undefined => row ? JSON.parse((row as { data: string }).data) : undefined
  function moveAside(slug: string, owner: number) { const holder = db.prepare('SELECT repo_id FROM projects WHERE slug=?').get(slug) as { repo_id: number } | undefined; if (holder && holder.repo_id !== owner) db.prepare('UPDATE projects SET slug=? WHERE repo_id=?').run(`${slug}#${holder.repo_id}`, holder.repo_id) }
  function audit(actor: number, action: string, repo: number | null, data: unknown) { db.prepare('INSERT INTO audit(actor,action,repo_id,at,data) VALUES(?,?,?,?,?)').run(actor, action, repo, new Date().toISOString(), JSON.stringify(data)) }
  return {
    db, audit,
    cleanup() { const now = Date.now(); for (const table of ['sessions', 'oauth', 'challenges']) db.prepare(`DELETE FROM ${table} WHERE expires < ?`).run(now); db.prepare('DELETE FROM metrics WHERE time<?').run(now - 30 * 86400000); db.prepare('DELETE FROM repository_snapshots WHERE fetched<?').run(now - 7 * 86400000) },
    snapshot(id: number) { return decode<Development>(db.prepare('SELECT data FROM repository_snapshots WHERE repo_id=?').get(id)) },
    saveSnapshot(id: number, value: Development) { db.prepare('INSERT INTO repository_snapshots(repo_id,data,fetched) VALUES(?,?,?) ON CONFLICT(repo_id) DO UPDATE SET data=excluded.data,fetched=excluded.fetched').run(id, JSON.stringify(value), Date.now()) },
    observe(id: number, value: MetricPoint) { db.prepare('INSERT INTO metrics(repo_id,time,volume,holders,revenue) VALUES(?,?,?,?,?) ON CONFLICT(repo_id,time) DO UPDATE SET volume=excluded.volume,holders=excluded.holders,revenue=excluded.revenue').run(id, Math.floor(value.time / 300000) * 300000, value.volume24h, value.holders, value.revenue); db.exec('DELETE FROM metrics WHERE rowid IN (SELECT rowid FROM metrics ORDER BY time DESC LIMIT -1 OFFSET 100000)') },
    history(id: number): MetricPoint[] { return db.prepare('SELECT time,volume AS volume24h,holders,revenue FROM metrics WHERE repo_id=? ORDER BY time').all(id) as unknown as MetricPoint[] },
    latestMetrics(id: number): MetricPoint | undefined { return db.prepare('SELECT time,volume AS volume24h,holders,revenue FROM metrics WHERE repo_id=? ORDER BY time DESC LIMIT 1').get(id) as unknown as MetricPoint | undefined },
    session(id: string) { const row = db.prepare('SELECT user,token,expires FROM sessions WHERE id=? AND expires>?').get(id, Date.now()) as { user: string; token: string; expires: number } | undefined; return row && { ...row, user: JSON.parse(row.user) as User } },
    intent(repo: number) { return decode<Intent>(db.prepare('SELECT data FROM intents WHERE repo_id=?').get(repo)) },
    intentByMint(mint: string) { return decode<Intent>(db.prepare('SELECT data FROM intents WHERE mint=?').get(mint)) },
    intents() { return db.prepare('SELECT data FROM intents').all().map(row => decode<Intent>(row)!) },
    reserve(intent: Intent) { db.prepare('INSERT INTO intents(repo_id,mint,data) VALUES(?,?,?)').run(intent.repo.id, intent.mint, JSON.stringify(intent)) },
    prepared(mint: string, planId: string) { const row = this.intentByMint(mint); if (!row) throw Error('Repository launch reservation is missing.'); row.planId = planId; db.prepare('UPDATE intents SET data=? WHERE mint=?').run(JSON.stringify(row), mint) },
    release(mint: string) { db.prepare('DELETE FROM intents WHERE mint=?').run(mint) },
    project(id: number) { return decode<Project>(db.prepare('SELECT data FROM projects WHERE repo_id=?').get(id)) },
    bySlug(owner: string, name: string) { return decode<Project>(db.prepare('SELECT data FROM projects WHERE slug=?').get(`${owner}/${name}`.toLowerCase())) },
    projects() { return db.prepare('SELECT data FROM projects ORDER BY rowid DESC').all().map(row => decode<Project>(row)!) },
    publish(project: Project) {
      const slug = `${project.repo.owner}/${project.repo.name}`.toLowerCase()
      // A repository that was renamed or transferred away may still hold this name: move its slug aside
      // (it gets its current name back from the next GitHub refresh via renamed()).
      moveAside(slug, project.repo.id)
      db.prepare('INSERT INTO projects(repo_id,slug,mint,data) VALUES(?,?,?,?) ON CONFLICT(repo_id) DO NOTHING').run(project.repo.id, slug, project.coin.mint, JSON.stringify(project))
    },
    /** GitHub reports a new owner/name for a launched repository: follow it. */
    renamed(repo: Repository) {
      const project = this.project(repo.id); if (!project) return
      const slug = `${repo.owner}/${repo.name}`.toLowerCase()
      if (`${project.repo.owner}/${project.repo.name}`.toLowerCase() === slug && project.repo.url === repo.url) return
      moveAside(slug, repo.id)
      project.repo = { ...project.repo, owner: repo.owner, name: repo.name, url: repo.url, avatar: repo.avatar }
      db.prepare('UPDATE projects SET slug=?,data=? WHERE repo_id=?').run(slug, JSON.stringify(project), repo.id)
      audit(0, 'project.renamed', repo.id, { slug })
    },
    /** Read-modify-write of one project's stored JSON. */
    updateProject(id: number, change: (project: Project) => void) { const project = this.project(id); if (!project) throw Error('Project not found.'); change(project); db.prepare('UPDATE projects SET data=? WHERE repo_id=?').run(JSON.stringify(project), id); return project },
    /** First time a GitHub-verified maintainer shows up for a community launch. */
    markClaimed(id: number, login: string) { const project = this.project(id); if (!project || project.launch !== 'community' || project.claimedAt) return; this.updateProject(id, p => { p.claimedAt = new Date().toISOString(); p.claimedBy = login }); audit(0, 'project.claimed', id, { login }) },
    addReport(report: Report) { db.prepare('INSERT INTO reports(id,status,created_at,data) VALUES(?,?,?,?)').run(report.id, report.status, report.createdAt, JSON.stringify(report)) },
    openReports() { return (db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status='open'").get() as { n: number }).n },
    reports(status: Report['status']) { return db.prepare('SELECT data FROM reports WHERE status=? ORDER BY created_at DESC LIMIT 200').all(status).map(row => decode<Report>(row)!) },
    updateReport(id: string, status: Report['status'], note: string) { const row = decode<Report>(db.prepare('SELECT data FROM reports WHERE id=?').get(id)); if (!row) return undefined; const next = { ...row, status, note, updatedAt: Date.now() }; db.prepare('UPDATE reports SET status=?,data=? WHERE id=?').run(status, JSON.stringify(next), id); return next },
    settings(id: number, category: Category, allocations: Allocation) { const project = this.project(id); if (!project) throw Error('Project not found.'); project.category = category; project.allocations = allocations; db.prepare('UPDATE projects SET data=? WHERE repo_id=?').run(JSON.stringify(project), id) },
    wallet(id: number) { return (db.prepare('SELECT wallet FROM wallets WHERE user_id=?').get(id) as { wallet: string } | undefined)?.wallet },
    eligibility(id: number) { return db.prepare('SELECT data FROM eligibility WHERE repo_id=?').all(id).map(row => { const item = decode<Eligibility>(row)!; return { ...item, wallet: this.wallet(item.userId) || null } }) },
    approve(repo: number, eligibility: Eligibility) { db.prepare('INSERT INTO eligibility(repo_id,user_id,data) VALUES(?,?,?) ON CONFLICT(repo_id,user_id) DO UPDATE SET data=excluded.data').run(repo, eligibility.userId, JSON.stringify(eligibility)) },
  }
}
export type Store = ReturnType<typeof createStore>
