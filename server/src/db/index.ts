import Database from 'better-sqlite3';
import path from 'path';
import { initializeSchema } from './schema';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'apex.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    console.log(`[DB] Connected to ${DB_PATH}`);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Connection closed');
  }
}
