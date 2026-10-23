// Learning-state snapshot export (S2): full, deterministic JSON of the SQLite
// learning data for viewing/backing up outside the runtime.
export function buildSnapshot(ldb) {
    const count = (t) => ldb.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    const all = (sql) => ldb.db.prepare(sql).all();
    return {
        schemaVersion: ldb.schemaVersion(),
        counts: {
            questions: count('questions'),
            attempts: count('attempts'),
            ratings: count('ratings'),
            concepts: count('concepts'),
            masteryEvents: count('mastery_history'),
            reviewEntries: count('review_schedule'),
        },
        questions: all('SELECT * FROM questions ORDER BY id'),
        attempts: all('SELECT * FROM attempts ORDER BY id'),
        ratings: all('SELECT * FROM ratings ORDER BY id'),
        mastery: all('SELECT * FROM mastery_history ORDER BY id'),
        review: all('SELECT * FROM review_schedule ORDER BY question_id'),
    };
}
