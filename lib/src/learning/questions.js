// Question records (S2): generated questions are persisted (with version) so
// attempts link to the exact version answered. Questions are generated on
// demand, NOT maintained as a static question bank. A question id may exist in
// several versions; (question_id, version) is unique.
export class QuestionStore {
    ldb;
    constructor(ldb) {
        this.ldb = ldb;
    }
    create(q) {
        this.ldb.db
            .prepare('INSERT INTO questions (question_id, version, type, topic, prompt, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(q.questionId, q.version, q.type, q.topic, q.prompt, q.reference, new Date().toISOString());
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
