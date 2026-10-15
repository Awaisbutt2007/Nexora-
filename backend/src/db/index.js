import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../config.js'

let db

export function getDb() {
  if (db) return db

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })
  db = new DatabaseSync(config.dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      phone TEXT,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      credits_remaining INTEGER NOT NULL DEFAULT 5000,
      is_premium INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New chat',
      model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tool_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      input_json TEXT NOT NULL,
      output_json TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS voice_prints (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT,
      embedding BLOB NOT NULL,
      sample_path TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_tool_runs_user ON tool_runs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_voice_prints_user ON voice_prints(user_id, created_at DESC);
  `)

  // Lightweight column migrations for existing databases
  const userColumns = database.prepare('PRAGMA table_info(users)').all().map((col) => col.name)
  if (!userColumns.includes('avatar')) {
    database.exec('ALTER TABLE users ADD COLUMN avatar TEXT')
  }
  if (!userColumns.includes('google_sub')) {
    database.exec('ALTER TABLE users ADD COLUMN google_sub TEXT')
  }

  // Voice enrollment: CREATE TABLE IF NOT EXISTS above covers fresh and existing
  // databases alike — existing users' prints simply start accumulating on enroll.
  const voicePrintColumns = database.prepare('PRAGMA table_info(voice_prints)').all().map((col) => col.name)
  if (!voicePrintColumns.includes('label')) {
    database.exec('ALTER TABLE voice_prints ADD COLUMN label TEXT')
  }
}

export function nowIso() {
  return new Date().toISOString()
}
