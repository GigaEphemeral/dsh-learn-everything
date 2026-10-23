// SQLite schema and migrations for learning state (S2, decision B).
// Learning data (questions/attempts/ratings/mastery/review) lives ONLY here,
// never in Obsidian notes.
// Each entry is an idempotent migration; version = index + 1.
const MIGRATIONS = [
    // v1: initial learning-state schema
    [
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
        "CREATE TABLE IF NOT EXISTS concepts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, wiki_path TEXT, created_at TEXT NOT NULL);",
        "CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, topic TEXT NOT NULL, prompt TEXT NOT NULL, reference TEXT, created_at TEXT NOT NULL);",
        "CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL UNIQUE, question_id TEXT NOT NULL REFERENCES questions(question_id), question_version INTEGER NOT NULL, answered_at TEXT NOT NULL, result TEXT NOT NULL, score REAL, answer_summary TEXT, phase TEXT NOT NULL DEFAULT 'first');",
        "CREATE TABLE IF NOT EXISTS ratings (id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id), model_rating REAL, feedback TEXT, error_analysis TEXT, suggestions TEXT, rated_at TEXT NOT NULL);",
        "CREATE TABLE IF NOT EXISTS mastery_history (id INTEGER PRIMARY KEY AUTOINCREMENT, concept_id INTEGER NOT NULL REFERENCES concepts(id), level REAL NOT NULL, source TEXT NOT NULL, recorded_at TEXT NOT NULL);",
        "CREATE TABLE IF NOT EXISTS review_schedule (question_id TEXT PRIMARY KEY REFERENCES questions(question_id), interval_days INTEGER NOT NULL DEFAULT 1, correct_streak INTEGER NOT NULL DEFAULT 0, last_result TEXT, next_review TEXT NOT NULL, updated_at TEXT NOT NULL);",
    ].join("\n"),
];
export function migrate(db) {
    const applied = new Set();
    try {
        const rows = db.prepare('SELECT version FROM schema_version').all();
        for (const r of rows)
            applied.add(r.version);
    }
    catch {
        // schema_version does not exist yet (first run); migrate from scratch.
    }
    for (let i = 0; i < MIGRATIONS.length; i += 1) {
        const version = i + 1;
        if (applied.has(version))
            continue;
        db.exec(MIGRATIONS[i]);
        db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
    }
}
export const SCHEMA_VERSION = MIGRATIONS.length;
