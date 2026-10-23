// Compact learning-state summary for a knowledge node (S3, T2).
import { QuestionStore } from './questions.js';
import { MasteryStore } from './mastery.js';
export function learningSummaryFor(ldb, topic) {
    const questions = new QuestionStore(ldb).byTopic(topic);
    const ids = questions.map((x) => x.questionId);
    const byResult = {};
    let total = 0;
    if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        const rows = ldb.db
            .prepare("SELECT result, COUNT(*) AS n FROM attempts WHERE question_id IN (" + placeholders + ") GROUP BY result")
            .all(...ids);
        for (const r of rows) {
            byResult[r.result] = r.n;
            total += r.n;
        }
    }
    const concept = ldb.db.prepare("SELECT id FROM concepts WHERE name = ?").get(topic);
    const mastery = concept ? new MasteryStore(ldb).recentLevels(concept.id, 3) : [];
    const firstId = ids[0];
    const review = firstId ? ldb.db.prepare("SELECT * FROM review_schedule WHERE question_id = ?").get(firstId) : null;
    return { questions, attempts: { total, byResult }, review, mastery };
}
