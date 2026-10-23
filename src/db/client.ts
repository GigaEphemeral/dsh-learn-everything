// SQLite client for learning state (S2). Opens a DatabaseSync connection,
// applies migrations, and enforces the invariants (WAL, foreign keys).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate, SCHEMA_VERSION } from './schema.js';

export class LearningDb {
  readonly db: DatabaseSync;
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (filePath !== ':memory:') {
      try { mkdirSync(dirname(filePath), { recursive: true }); } catch { /* memory db */ }
    }
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    migrate(this.db);
  }

  schemaVersion(): number {
    return SCHEMA_VERSION;
  }

  close(): void {
    this.db.close();
  }
}
