// Concept mastery tracking (S2, task 3). A concept maps to a knowledge node
// (usually a wiki page). Mastery history records each evidence source
// separately (first answer / model rating / correction / variant pass) so a
// single LLM "understood" claim never proves mastery by itself.
import { safeLimit } from './limits.js';
// Evidence sources allowed to contribute mastery. Kept in sync with the v2
// CHECK constraint on mastery_history.source.
export const MASTERY_SOURCES = ['first_answer', 'model_rating', 'correction', 'variant_pass'];
export class MasteryStore {
    ldb;
    constructor(ldb) {
        this.ldb = ldb;
    }
    // Idempotent concept lookup/creation. Concept names are trimmed only (no case
    // folding: case differences may be meaningful wiki paths), and an empty name
    // is rejected instead of creating an anonymous concept. A non-null wikiPath
    // also links an already-known concept: the first answer may arrive before the
    // wiki page exists, and the page must be attachable later (A23). A null
    // wikiPath means "no page information in this call", so it never clears a
    // previously linked page.
    ensureConcept(name, wikiPath) {
        if (typeof name !== 'string' || name.trim() === '') {
            throw new Error('ensureConcept requires a non-empty concept name');
        }
        const normalized = name.trim();
        // INSERT OR IGNORE makes the create step atomic even with a second writer
        // (the practice CLI) on the same database; the read-back is checked because
        // a silently missing row would otherwise surface as a confusing TypeError.
        this.ldb.db
            .prepare('INSERT OR IGNORE INTO concepts (name, wiki_path, created_at) VALUES (?, ?, ?)')
            .run(normalized, wikiPath, new Date().toISOString());
        if (wikiPath !== null) {
            // Re-runs on the just-inserted row too (same value), which keeps creation
            // and late linking on a single code path.
            this.ldb.db.prepare('UPDATE concepts SET wiki_path = ? WHERE name = ?').run(wikiPath, normalized);
        }
        const row = this.ldb.db.prepare('SELECT id FROM concepts WHERE name = ?').get(normalized);
        if (!row || typeof row.id !== 'number') {
            throw new Error(`concept "${normalized}" is missing after insert; database may be inconsistent`);
        }
        return row.id;
    }
    // Record an evidence point; level must be a finite number in 0..1 and source
    // must be one of MASTERY_SOURCES (a single LLM rating can never be arbitrary).
    recordLevel(conceptId, level, source) {
        if (typeof level !== 'number' || !Number.isFinite(level)) {
            throw new Error(`mastery level must be a finite number, got ${String(level)}`);
        }
        if (level < 0 || level > 1) {
            throw new Error(`mastery level must be within 0..1, got ${level}`);
        }
        if (!MASTERY_SOURCES.includes(source)) {
            throw new Error(`unknown mastery source "${source}"; expected one of ${MASTERY_SOURCES.join('|')}`);
        }
        this.ldb.db
            .prepare('INSERT INTO mastery_history (concept_id, level, source, recorded_at) VALUES (?, ?, ?, ?)')
            .run(conceptId, level, source, new Date().toISOString());
    }
    recentLevels(conceptId, limit = 5) {
        return this.ldb.db
            .prepare('SELECT level, source, recorded_at FROM mastery_history WHERE concept_id = ? ORDER BY id DESC LIMIT ?')
            .all(conceptId, safeLimit(limit, 5));
    }
}
