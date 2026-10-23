// SQLite client for learning state (S2). Opens a DatabaseSync connection,
// applies migrations, and enforces the invariants (WAL, foreign keys).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './schema.js';
export class LearningDb {
    db;
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
        if (filePath !== ':memory:') {
            try {
                mkdirSync(dirname(filePath), { recursive: true });
            }
            catch { /* memory db */ }
        }
        this.db = new DatabaseSync(filePath);
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA foreign_keys = ON;');
        migrate(this.db);
    }
    // Version actually stored in the database (not the compile-time constant):
    // this is what integrity/`practice-db check` output must report.
    schemaVersion() {
        const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get();
        return row?.version ?? 0;
    }
    // Run fn inside an explicit write transaction. Used by multi-store writes
    // (e.g. PracticeSession.recordAnswer) so a failure rolls every store back.
    transaction(fn) {
        this.db.exec('BEGIN IMMEDIATE;');
        let committed = false;
        try {
            const result = fn();
            this.db.exec('COMMIT;');
            committed = true;
            return result;
        }
        finally {
            if (!committed) {
                try {
                    this.db.exec('ROLLBACK;');
                }
                catch { /* transaction already rolled back */ }
            }
        }
    }
    close() {
        this.db.close();
    }
}
