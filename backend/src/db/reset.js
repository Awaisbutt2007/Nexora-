import fs from 'node:fs'
import { config } from '../config.js'

for (const file of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) {
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

console.log('Database reset. Run the server to recreate tables.')
