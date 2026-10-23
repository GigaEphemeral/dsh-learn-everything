// Unit tests for practice selection (S2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LearningDb } from '../src/db/client.js';
import { QuestionStore } from '../src/learning/questions.js';
import { ReviewStore } from '../src/learning/review.js';
import { PracticeSelector } from '../src/learning/selection.js';
import { PracticeSession } from '../src/learning/practice.js';
test("overdue questions score higher than fresh ones", () => {
    const ldb = new LearningDb(':memory:');
    const questions = new QuestionStore(ldb);
    questions.create({ questionId: "q_due", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    questions.create({ questionId: "q_fresh", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    const review = new ReviewStore(ldb);
    review.applyAttempt("q_due", false);
    ldb.db.prepare('UPDATE review_schedule SET next_review = ? WHERE question_id = ?').run('2020-01-01T00:00:00Z', 'q_due');
    const sel = new PracticeSelector(ldb);
    const now = new Date("2020-01-02T00:00:00Z");
    assert.ok(sel.score("q_due", { now }) > sel.score("q_fresh", { now }));
    ldb.close();
});
test("weakness reflects recent incorrect history, not only last result", () => {
    const ldb = new LearningDb(':memory:');
    const questions = new QuestionStore(ldb);
    questions.create({ questionId: "q_weak2", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    questions.create({ questionId: "q_ok2", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    const ps = new PracticeSession(ldb);
    ps.recordAnswer({ questionId: "q_weak2", questionVersion: 1, phase: "first", correct: false, result: "incorrect", score: 1, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [] });
    ps.recordAnswer({ questionId: "q_weak2", questionVersion: 1, phase: "correction", correct: false, result: "incorrect", score: 2, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [] });
    ps.recordAnswer({ questionId: "q_ok2", questionVersion: 1, phase: "first", correct: true, result: "correct", score: 4, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [] });
    const sel = new PracticeSelector(ldb);
    assert.ok(sel.score("q_weak2") > sel.score("q_ok2"));
    ldb.close();
});
test("selectCandidates ranks by score and respects the limit", () => {
    const ldb = new LearningDb(':memory:');
    const ps = new PracticeSession(ldb);
    ps.startQuestion({ questionId: "a", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    ps.startQuestion({ questionId: "b", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    ps.recordAnswer({ questionId: "a", questionVersion: 1, phase: "first", correct: false, result: "incorrect", score: 1, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [] });
    const sel = new PracticeSelector(ldb);
    const picked = sel.selectCandidates([{ questionId: "a", topicCount: 2, attemptedCount: 1 }, { questionId: "b", topicCount: 2, attemptedCount: 0 }], 1);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].questionId, "a"); // weak+attempted beats fresh
    ldb.close();
});
test("selection sees history across question versions (A6/A8 integration)", () => {
    const ldb = new LearningDb(':memory:');
    const ps = new PracticeSession(ldb);
    ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "v1", reference: null });
    ps.startQuestion({ questionId: "q1", version: 2, type: "concept", topic: "t", prompt: "v2", reference: null });
    // The latest stored version is what a reader gets back ...
    assert.equal(new QuestionStore(ldb).get("q1")?.version, 2);
    // ... while each attempt keeps the version it actually answered.
    ps.recordAnswer({ questionId: "q1", questionVersion: 1, phase: "first", correct: false, result: "incorrect", score: 1, answerSummary: null, concepts: [] });
    ps.recordAnswer({ questionId: "q1", questionVersion: 2, phase: "correction", correct: true, result: "correct", score: 4, answerSummary: null, concepts: [] });
    const attempts = ldb.db.prepare("SELECT question_version, result FROM attempts WHERE question_id = ? ORDER BY id").all("q1");
    assert.deepEqual(attempts.map((a) => [a.question_version, a.result]), [[1, "incorrect"], [2, "correct"]]);
    // Review state is per question id and reflects the latest answer.
    const rev = new ReviewStore(ldb).get("q1");
    assert.equal(rev.last_result, "correct");
    assert.equal(rev.correct_streak, 1);
    // Weakness history spans versions, so selection can still rank the question.
    const sel = new PracticeSelector(ldb);
    assert.ok(sel.score("q1") > 0);
    ldb.close();
});
test("coverage is clamped to 0..1 and non-finite inputs do not poison the score (A38)", () => {
    const ldb = new LearningDb(':memory:');
    const sel = new PracticeSelector(ldb, { overdue: 0, weakness: 0, coverage: 1, novelty: 0 });
    // topicCount 2 with 5 attempts would be 2.5 without clamping.
    assert.equal(sel.score("q", { attemptedCount: 5, topicCount: 2 }), 1);
    // Negative coverage would invert the ranking without clamping.
    assert.equal(sel.score("q", { attemptedCount: -3, topicCount: 2 }), 0);
    assert.equal(sel.score("q", { attemptedCount: Number.NaN, topicCount: 2 }), 0);
    assert.equal(sel.score("q", { attemptedCount: 1, topicCount: 2 }), 0.5);
    ldb.close();
});
test("invalid next_review timestamps neither crash nor produce NaN scores (A39)", () => {
    const ldb = new LearningDb(':memory:');
    const review = new ReviewStore(ldb);
    review.applyAttempt("q_bad", false);
    ldb.db.prepare("UPDATE review_schedule SET next_review = 'not-a-date' WHERE question_id = 'q_bad'").run();
    const sel = new PracticeSelector(ldb, { overdue: 1, weakness: 0, coverage: 0, novelty: 0 });
    const score = sel.score("q_bad", { now: new Date("2026-01-01T00:00:00Z") });
    assert.ok(Number.isFinite(score));
    assert.equal(score, 0); // corrupt timestamp is not "overdue"
    // A valid overdue timestamp still earns the full overdue weight.
    ldb.db.prepare("UPDATE review_schedule SET next_review = '2020-01-01T00:00:00.000Z' WHERE question_id = 'q_bad'").run();
    assert.equal(sel.score("q_bad", { now: new Date("2020-01-02T00:00:00Z") }), 1);
    ldb.close();
});
test("partial weight overrides merge over defaults (A40)", () => {
    const ldb = new LearningDb(':memory:');
    const sel = new PracticeSelector(ldb, { coverage: 1 });
    // Default novelty 0.3 + overridden coverage 1 * 0.5 = 0.8; the other default
    // weights (overdue/weakness) stay 1.0/0.8 for the untouched dimensions.
    const score = sel.score("q_fresh", { attemptedCount: 1, topicCount: 2 });
    assert.ok(Math.abs(score - 0.8) < 1e-9, `expected 0.8, got ${score}`);
    ldb.close();
});
test("weights resolve per instance from env and must be non-negative finite (A40/A41)", () => {
    const ldb = new LearningDb(':memory:');
    const previous = process.env.OBSIDIAN_REVIEW_W_NOVELTY;
    try {
        process.env.OBSIDIAN_REVIEW_W_NOVELTY = "1";
        // Read at construction time, not at module load (module loaded earlier).
        assert.equal(new PracticeSelector(ldb).score("q_fresh"), 1);
        process.env.OBSIDIAN_REVIEW_W_NOVELTY = "-2";
        assert.throws(() => new PracticeSelector(ldb), /non-negative/);
    }
    finally {
        if (previous === undefined)
            delete process.env.OBSIDIAN_REVIEW_W_NOVELTY;
        else
            process.env.OBSIDIAN_REVIEW_W_NOVELTY = previous;
    }
    assert.throws(() => new PracticeSelector(ldb, { overdue: -1 }), /non-negative/);
    assert.throws(() => new PracticeSelector(ldb, { overdue: Number.NaN }), /finite number/);
    ldb.close();
});
test("score projects only next_review from review_schedule (A37)", () => {
    const ldb = new LearningDb(':memory:');
    new ReviewStore(ldb).applyAttempt("q1", false);
    const prepared = [];
    const realPrepare = ldb.db.prepare.bind(ldb.db);
    ldb.db.prepare = ((sql) => {
        prepared.push(sql);
        return realPrepare(sql);
    });
    new PracticeSelector(ldb, { overdue: 1, weakness: 0, coverage: 0, novelty: 0 }).score("q1");
    ldb.db.prepare = realPrepare;
    const projection = prepared.find((sql) => /FROM review_schedule/.test(sql));
    assert.ok(projection, "expected the schedule projection to be prepared");
    // last_result is unused by selection; projecting it invites the false
    // assumption that the last answer drives weakness.
    assert.match(projection, /SELECT next_review FROM review_schedule/);
    assert.doesNotMatch(projection, /last_result/);
    ldb.close();
});
test("weakness window is read per instance from OBSIDIAN_REVIEW_WEAKNESS_WINDOW (A42)", () => {
    const ldb = new LearningDb(':memory:');
    const ps = new PracticeSession(ldb);
    ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    const answer = (result) => {
        ps.recordAnswer({ questionId: "q1", questionVersion: 1, result, score: 1, answerSummary: null });
    };
    // Newest first: incorrect, correct, incorrect => default window 3 scores 2/3.
    answer("incorrect");
    answer("correct");
    answer("incorrect");
    const weights = { overdue: 0, weakness: 1, coverage: 0, novelty: 0 };
    const previous = process.env.OBSIDIAN_REVIEW_WEAKNESS_WINDOW;
    try {
        delete process.env.OBSIDIAN_REVIEW_WEAKNESS_WINDOW;
        const defaultWindow = new PracticeSelector(ldb, weights);
        assert.ok(Math.abs(defaultWindow.score("q1") - 2 / 3) < 1e-9);
        // Read at construction, not at module load: changing the env afterwards
        // affects only new selectors.
        process.env.OBSIDIAN_REVIEW_WEAKNESS_WINDOW = "2";
        assert.ok(Math.abs(defaultWindow.score("q1") - 2 / 3) < 1e-9);
        // Window 2 looks only at the newest incorrect + correct => 1/2.
        assert.ok(Math.abs(new PracticeSelector(ldb, weights).score("q1") - 0.5) < 1e-9);
        process.env.OBSIDIAN_REVIEW_WEAKNESS_WINDOW = "0";
        assert.throws(() => new PracticeSelector(ldb), /positive integer/);
        process.env.OBSIDIAN_REVIEW_WEAKNESS_WINDOW = "2.5";
        assert.throws(() => new PracticeSelector(ldb), /positive integer/);
        process.env.OBSIDIAN_REVIEW_WEAKNESS_WINDOW = "many";
        assert.throws(() => new PracticeSelector(ldb), /positive integer/);
    }
    finally {
        if (previous === undefined)
            delete process.env.OBSIDIAN_REVIEW_WEAKNESS_WINDOW;
        else
            process.env.OBSIDIAN_REVIEW_WEAKNESS_WINDOW = previous;
    }
    ldb.close();
});
test("weakness counts partial answers as half incorrect (A44)", () => {
    const ldb = new LearningDb(':memory:');
    const ps = new PracticeSession(ldb);
    ps.startQuestion({ questionId: "q_partial_only", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    ps.startQuestion({ questionId: "q_mixed", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    ps.recordAnswer({ questionId: "q_partial_only", questionVersion: 1, result: "partial", score: 1, answerSummary: null });
    ps.recordAnswer({ questionId: "q_mixed", questionVersion: 1, result: "partial", score: 1, answerSummary: null });
    ps.recordAnswer({ questionId: "q_mixed", questionVersion: 1, result: "correct", score: 1, answerSummary: null });
    const sel = new PracticeSelector(ldb, { overdue: 0, weakness: 1, coverage: 0, novelty: 0 });
    // A partial-only window is half evidence of a gap, not zero.
    assert.equal(sel.score("q_partial_only"), 0.5);
    // Mixed window: (0.5 + 0) / 2, which the old incorrect-only counting scored 0.
    assert.equal(sel.score("q_mixed"), 0.25);
    ldb.close();
});
test("selectCandidates returns the score with each ranked item (A43)", () => {
    const ldb = new LearningDb(':memory:');
    const ps = new PracticeSession(ldb);
    ps.startQuestion({ questionId: "a", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    ps.startQuestion({ questionId: "b", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    ps.recordAnswer({ questionId: "a", questionVersion: 1, phase: "first", correct: false, result: "incorrect", score: 1, answerSummary: null, concepts: [] });
    const sel = new PracticeSelector(ldb);
    // Type-level: the declaration must expose `score`, so this annotation fails
    // to compile if selectCandidates goes back to a plain Candidate[] return.
    const picked = sel.selectCandidates([{ questionId: "a", topicCount: 2, attemptedCount: 1 }, { questionId: "b", topicCount: 2, attemptedCount: 0 }]);
    assert.equal(picked.length, 2);
    assert.equal(typeof picked[0].score, "number");
    assert.equal(typeof picked[1].score, "number");
    assert.ok(picked[0].score >= picked[1].score);
    ldb.close();
});
