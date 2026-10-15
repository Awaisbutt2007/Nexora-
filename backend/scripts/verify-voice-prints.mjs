import { getDb } from '../src/db/index.js'
const db = getDb()
console.log('voice tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'voice%'").all())
console.log('columns:', db.prepare('PRAGMA table_info(voice_prints)').all().map((c) => `${c.name} ${c.type}`).join(', '))
console.log('indexes:', db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%voice%'").all().map((r) => r.name).join(', '))
