// Question records (S2): generated questions are persisted (with version) so
// attempts link to the exact version answered. Questions are generated on
// demand, NOT maintained as a static question bank.
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
    get(questionId) {
        return this.ldb.db.prepare('SELECT * FROM questions WHERE question_id = ?').get(questionId);
    }
}
