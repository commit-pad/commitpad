// Transactionally consistent online copy of a SQLite database (safe with WAL and a running server),
// followed by an integrity check of the copy. Usage: node sqlite-snapshot.cjs <source.sqlite> <dest.sqlite>
const { DatabaseSync } = require('node:sqlite')
const [source, dest] = process.argv.slice(2)
if (!source || !dest) { console.error('usage: sqlite-snapshot.cjs <source> <dest>'); process.exit(2) }
const db = new DatabaseSync(source, { readOnly: true })
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
db.close()
const copy = new DatabaseSync(dest, { readOnly: true })
const result = copy.prepare('PRAGMA integrity_check').get()
copy.close()
if (Object.values(result)[0] !== 'ok') { console.error('snapshot integrity check failed', result); process.exit(1) }
