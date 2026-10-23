// Compact learning-state summary for a knowledge node (S3, T2).
import { QuestionStore } from './questions.js';
import { AttemptStore } from './attempts.js';
import { MasteryStore } from './mastery.js';
import { ReviewStore } from './review.js';
// Recent mastery evidence shown per topic. Named because it is a policy default.
export const DEFAULT_MASTERY_HISTORY_DEPTH = 3;
// Pick the schedule that needs attention first across every question of the
// topic. Using the oldest question id would report an arbitrary schedule (or
// null when only a later question was answered). ReviewStore.get() is the one
// place that validates next_review and returns the typed projection.
function earliestReview(ldb, questionIds) {
    const store = new ReviewStore(ldb);
    let earliest = null;
    for (const questionId of questionIds) {
        const schedule = store.get(questionId);
        if (!schedule)
            continue;
        // Canonical ISO strings compare correctly lexicographically (enforced by
        // ReviewStore on read).
        if (earliest === null || schedule.next_review < earliest.next_review) {
            earliest = schedule;
        }
    }
    return earliest;
}
export function learningSummaryFor(ldb, topic) {
    const questions = new QuestionStore(ldb).byTopic(topic);
    // A question id can appear several times when it has multiple versions; the
    // aggregate queries below only need the distinct ids.
    const ids = [...new Set(questions.map((question) => question.questionId))];
    const attempts = new AttemptStore(ldb).countByResult(ids);
    const concept = ldb.db.prepare('SELECT id FROM concepts WHERE name = ?').get(topic);
    const mastery = concept
        ? new MasteryStore(ldb).recentLevels(concept.id, DEFAULT_MASTERY_HISTORY_DEPTH)
        : [];
    return {
        questions,
        attempts,
        review: earliestReview(ldb, ids),
        mastery,
    };
}
