// SQLite client for learning state (S2). Opens a DatabaseSync connection,
// applies migrations, and enforces the invariants (WAL, busy timeout, foreign
// keys). Initialization failures must not leak the underlying connection.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './schema.js';

const BUSY_TIMEOUT_MS = 5000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Apply the connection invariants after the database is open. Exported so the
// non-WAL failure branch can be unit-tested without a filesystem that refuses
// WAL journaling.
export function applyConnectionInvariants(db: DatabaseSync, filePath: string): void {
  // Reading the PRAGMA result (instead of a fire-and-forget exec) is what turns
  // "WAL silently not enabled" into a startup error instead of SQLITE_BUSY
  // surprises later when the practice CLI writes concurrently.
  const row = db.prepare('PRAGMA journal_mode = WAL;').get() as { journal_mode?: string } | undefined;
  const journalMode = String(row?.journal_mode ?? '').toLowerCase();
  // In-memory databases legitimately report "memory" instead of "wal".
  if (filePath !== ':memory:' && journalMode !== 'wal') {
    throw new Error(`learning database "${filePath}" could not enable WAL journal mode (got "${journalMode || 'unknown'}")`);
  }
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  db.exec('PRAGMA foreign_keys = ON;');
}

export class LearningDb {
  readonly db: DatabaseSync;
  readonly filePath: string;
  private closed = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    if (filePath !== ':memory:') {
      const directory = dirname(filePath);
      try {
        mkdirSync(directory, { recursive: true });
      } catch (err) {
        // Keep the EACCES/ENOTDIR/... root cause instead of letting the later
        // "unable to open database file" error hide it.
        throw new Error(`cannot create learning database directory "${directory}": ${errorMessage(err)}`, { cause: err });
      }
    }
    this.db = new DatabaseSync(filePath);
    try {
      applyConnectionInvariants(this.db, filePath);
      migrate(this.db);
    } catch (err) {
      // Post-open failure: close before rethrowing so no file descriptor or WAL
      // lock is left behind (and the original error is what the caller sees).
      try { this.close(); } catch { /* keep the original initialization error */ }
      throw err;
    }
  }

  // Version actually stored in the database (not the compile-time constant):
  // this is what integrity/`practice-db check` output must report.
  schemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  }

  // Run fn inside an explicit write transaction. Used by multi-store writes
  // (e.g. PracticeSession.recordAnswer) so a failure rolls every store back.
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;');
    let committed = false;
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      committed = true;
      return result;
    } finally {
      if (!committed) {
        try { this.db.exec('ROLLBACK;'); } catch { /* transaction already rolled back */ }
      }
    }
  }

  // Idempotent: DatabaseSync.close() throws when called twice, which used to
  // mask the real error when both a hook and a finally block closed the DB.
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
