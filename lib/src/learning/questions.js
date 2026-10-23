// Question records (S2): generated questions are persisted (with version) so
// attempts link to the exact version answered. Questions are generated on
// demand, NOT maintained as a static question bank. A question id may exist in
// several versions; (question_id, version) is unique.
import { safeLimit } from './limits.js';
// Default bound for topic listings; keeps the learning summary compact even
// when a topic accumulates many questions over time.
export const DEFAULT_TOPIC_QUESTIONS_LIMIT = 20;
function requireText(operation, field, value) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${operation} requires a non-empty ${field}`);
    }
    return value;
}
function requireVersion(value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new Error(`question.create requires a positive integer version, got ${String(value)}`);
    }
    return value;
}
export class QuestionStore {
    ldb;
    constructor(ldb) {
        this.ldb = ldb;
    }
    create(q) {
        const questionId = requireText('question.create', 'questionId', q.questionId);
        const type = requireText('question.create', 'type', q.type);
        const topic = requireText('question.create', 'topic', q.topic);
        const prompt = requireText('question.create', 'prompt', q.prompt);
        const version = requireVersion(q.version);
        // An omitted reference is "no reference answer", not a binding error.
        const reference = q.reference === undefined ? null : q.reference;
        if (reference !== null && typeof reference !== 'string') {
            throw new Error('question.create requires reference to be a string or null');
        }
        this.ldb.db
            .prepare('INSERT INTO questions (question_id, version, type, topic, prompt, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(questionId, version, type, topic, prompt, reference, new Date().toISOString());
    }
    // Questions generated for a topic (for learning-state summaries). Returns the
    // newest `limit` rows so an old topic cannot make the summary unbounded.
    byTopic(topic, limit = DEFAULT_TOPIC_QUESTIONS_LIMIT) {
        const t = requireText('question.byTopic', 'topic', topic);
        const rows = this.ldb.db
            .prepare('SELECT question_id, version, type FROM questions WHERE topic = ? ORDER BY id DESC LIMIT ?')
            .all(t, safeLimit(limit, DEFAULT_TOPIC_QUESTIONS_LIMIT));
        return rows.map((r) => ({ questionId: r.question_id, version: r.version, type: r.type }));
    }
    // Read one question. Without `version` the latest stored version is returned
    // (that is what "show me this question" means); with `version` the exact
    // version an attempt was answered against is returned.
    get(questionId, version) {
        if (version === undefined) {
            return this.ldb.db
                .prepare('SELECT * FROM questions WHERE question_id = ? ORDER BY version DESC LIMIT 1')
                .get(questionId);
        }
        return this.ldb.db
            .prepare('SELECT * FROM questions WHERE question_id = ? AND version = ?')
            .get(questionId, version);
    }
}
