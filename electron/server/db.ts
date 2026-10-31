import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let dbInstance: Database.Database | null = null;
let stickersDirPath: string | null = null;

export function initDb(userDataPath: string): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dataDir = path.join(userDataPath, 'data');
  const stickersDir = path.join(dataDir, 'stickers');
  fs.mkdirSync(stickersDir, { recursive: true });
  stickersDirPath = stickersDir;

  const dbPath = path.join(dataDir, 'db.sqlite');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS stickers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      thumb_path TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS widgets (
      id TEXT PRIMARY KEY,
      sticker_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('2d', '3d')),
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      monitor_id TEXT NOT NULL,
      opacity REAL NOT NULL DEFAULT 1.0,
      locked INTEGER NOT NULL DEFAULT 0,
      click_through INTEGER NOT NULL DEFAULT 0,
      always_on_top INTEGER NOT NULL DEFAULT 1,
      settings_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (sticker_id) REFERENCES stickers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // One-time migration: widgets should float above other applications by default.
  // Users can still turn "Always on Top" off per widget from its context menu.
  const migrationCheck = db
    .prepare("SELECT value FROM settings WHERE key = 'widgets_always_on_top_v2'")
    .get() as { value: string } | undefined;

  if (!migrationCheck) {
    db.exec('UPDATE widgets SET always_on_top = 1 WHERE active = 1;');
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('widgets_always_on_top_v2', 'true')"
    ).run();
  }

  dbInstance = db;
  return db;
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    throw new Error('Database has not been initialized. Call initDb() first.');
  }
  return dbInstance;
}

export function getStickersDir(): string {
  if (!stickersDirPath) {
    throw new Error('Stickers directory not initialized. Call initDb() first.');
  }
  return stickersDirPath;
}
