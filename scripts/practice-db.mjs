// Practice persistence CLI (S2). The daily-practice skill calls this to record
// generated questions and answers into SQLite (decision B).
//
// Usage (from code/):
//   node scripts/practice-db.mjs question '<json>'
//   node scripts/practice-db.mjs answer '<json>'
//   node scripts/practice-db.mjs status <questionId>
//   node scripts/practice-db.mjs backup <absolute-path>
//   node scripts/practice-db.mjs check
//   node scripts/practice-db.mjs export
//
// `status` prints the 50 most recent attempts newest-first, read through
// AttemptStore (the store owns attempt ordering and projection).
//
// Exit codes: 0 success, 2 usage error (nothing was written), 1 operational
// error. Usage is validated before the database is opened, so a typo never
// creates or binds a database.

import { copyFileSync, existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LearningDb } from "../lib/src/db/client.js";
import { PracticeSession } from "../lib/src/learning/practice.js";
import { AttemptStore } from "../lib/src/learning/attempts.js";
import { QuestionStore } from "../lib/src/learning/questions.js";
import { ReviewStore } from "../lib/src/learning/review.js";
import { MasteryStore } from "../lib/src/learning/mastery.js";
import { buildSnapshot } from "../lib/src/learning/export.js";
import { resolveStateDir } from "../src/ingest/state-dir.js";

const EXIT_USAGE = 2;
const RESULTS = ["correct", "incorrect", "partial"];
const PHASES = ["first", "correction", "variant"];
// Bounded history for `status`: enough to show the recent trend without
// dumping an unbounded attempt log.
const STATUS_ATTEMPT_LIMIT = 50;
const USAGE = [
  "usage: node scripts/practice-db.mjs <command>",
  "  question '<json>'    record a generated question",
  "  answer '<json>'      record an answer with its rating/review update",
  "  status <questionId>  print the question, review schedule, recent attempts (newest first) and mastery",
  "  backup <path>        copy the live database to an absolute path (WAL-safe)",
  "  check                run PRAGMA integrity_check and report the schema version",
].join("\n");

class UsageError extends Error {}

function usage(message) {
  throw new UsageError(message);
}

function requireNonEmptyString(value, field, label) {
  if (typeof value !== "string" || value.trim() === "") {
    usage(`${label} requires a non-empty "${field}" string`);
  }
  return value;
}

function requirePositiveInteger(value, field, label) {
  if (!Number.isInteger(value) || value < 1) {
    usage(`${label} requires a positive integer "${field}"`);
  }
  return value;
}

function requireOneOf(value, field, allowed, label) {
  if (!allowed.includes(value)) {
    usage(`${label} "${field}" must be one of ${allowed.join("|")}, got ${JSON.stringify(value)}`);
  }
  return value;
}

// Parse a JSON object argument with a friendly usage error instead of a bare
// SyntaxError, and guarantee the result is a plain object.
export function parseJsonArg(raw, label) {
  if (typeof raw !== "string" || raw.trim() === "") {
    usage(`${label} needs a JSON object argument (see usage)`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    usage(`${label} argument is not valid JSON: ${reason}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    usage(`${label} argument must be a JSON object`);
  }
  return parsed;
}

// Required fields are checked here, before any store write, so a malformed
// record fails with a usage error instead of a half-written database entry.
export function validateQuestion(q) {
  requireNonEmptyString(q.questionId, "questionId", "question");
  requirePositiveInteger(q.version, "version", "question");
  requireNonEmptyString(q.type, "type", "question");
  requireNonEmptyString(q.topic, "topic", "question");
  requireNonEmptyString(q.prompt, "prompt", "question");
  if (q.reference !== undefined && q.reference !== null && typeof q.reference !== "string") {
    usage('question "reference" must be a string or null');
  }
  return q;
}

export function validateAnswer(a) {
  requireNonEmptyString(a.questionId, "questionId", "answer");
  requirePositiveInteger(a.questionVersion, "questionVersion", "answer");
  requireOneOf(a.result, "result", RESULTS, "answer");
  if (typeof a.correct !== "boolean") {
    usage('answer requires a boolean "correct" field');
  }
  // The schedule update is driven by `correct` while attempts store `result`;
  // a contradictory pair would silently corrupt the review state.
  if (a.correct !== (a.result === "correct")) {
    usage('answer "correct" contradicts "result" (correct must be true iff result is "correct")');
  }
  if (a.phase !== undefined) {
    requireOneOf(a.phase, "phase", PHASES, "answer");
  }
  if (a.score !== undefined && a.score !== null && typeof a.score !== "number") {
    usage('answer "score" must be a number or null');
  }
  if (a.concepts !== undefined && !Array.isArray(a.concepts)) {
    usage('answer "concepts" must be an array');
  }
  return a;
}

// Validate a backup destination before the database is opened. The live
// database and its WAL sidecars are refused, the path must be absolute with an
// existing parent directory, and an existing file is never overwritten.
export function validateBackupTarget(rawTarget, dbPath) {
  if (typeof rawTarget !== "string" || rawTarget.trim() === "") {
    usage("backup needs a target path");
  }
  if (!isAbsolute(rawTarget)) {
    usage("backup target must be an absolute path");
  }
  const target = resolve(rawTarget);
  const live = resolve(dbPath);
  if (target === live) {
    usage("backup target must not be the live database file");
  }
  if (target === resolve(`${live}-wal`) || target === resolve(`${live}-shm`)) {
    usage("backup target must not be a live WAL sidecar (-wal/-shm)");
  }
  const parent = dirname(target);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    usage(`backup target directory does not exist: ${parent}`);
  }
  if (existsSync(target)) {
    usage(`refusing to overwrite existing backup target: ${target}`);
  }
  return target;
}

function resolveDbPath() {
  return process.env.OBSIDIAN_LEARNING_DB ?? join(resolveStateDir(import.meta.url), "learning.db");
}

// Parse and validate the command line. Throws UsageError without opening the
// database when the arguments are wrong.
function planCommand(argv, dbPath) {
  const [command, ...rest] = argv;
  if (!command) usage(USAGE);
  if (command === "question") {
    return { kind: "question", payload: validateQuestion(parseJsonArg(rest[0], "question")) };
  }
  if (command === "answer") {
    return { kind: "answer", payload: validateAnswer(parseJsonArg(rest[0], "answer")) };
  }
  if (command === "status") {
    const questionId = rest[0];
    if (typeof questionId !== "string" || questionId.trim() === "") {
      usage("status needs a questionId");
    }
    return { kind: "status", payload: questionId.trim() };
  }
  if (command === "backup") {
    return { kind: "backup", target: validateBackupTarget(rest[0], dbPath) };
  }
  if (command === "check") {
    return { kind: "check" };
  }
  if (command === "export") {
    return { kind: "export" };
  }
  usage(`unknown command "${command}"\n${USAGE}`);
}

function backup(ldb, dbPath, target) {
  // WAL-safe: checkpoint everything into the main file first. A busy
  // checkpoint means another connection is still writing, so copying now could
  // produce a torn backup; abort instead.
  const checkpoint = ldb.db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  if (checkpoint && Number(checkpoint.busy) !== 0) {
    throw new Error("database is busy; WAL checkpoint did not complete, refusing to write a backup");
  }
  copyFileSync(dbPath, target);
  console.log("backup written:", target);
}

function run(command, ldb, dbPath) {
  if (command.kind === "question") {
    new PracticeSession(ldb).startQuestion(command.payload);
    console.log("question recorded:", command.payload.questionId);
    return;
  }
  if (command.kind === "answer") {
    const id = new PracticeSession(ldb).recordAnswer(command.payload);
    console.log("answer recorded:", id);
    return;
  }
  if (command.kind === "status") {
    const qid = command.payload;
    const question = new QuestionStore(ldb).get(qid);
    const review = new ReviewStore(ldb).get(qid);
    // AttemptStore owns the attempt query and returns newest-first, so the ad-hoc
    // `ORDER BY id` SELECT (opposite order, bypassing the store) is gone.
    const attempts = new AttemptStore(ldb).recentFor(qid, STATUS_ATTEMPT_LIMIT);
    let mastery = [];
    if (question) {
      const concept = ldb.db.prepare("SELECT id FROM concepts WHERE name = ?").get(question.topic);
      if (concept) mastery = new MasteryStore(ldb).recentLevels(concept.id, 5);
    }
    console.log(JSON.stringify({ question: question ?? null, review: review ?? null, attempts, mastery }, null, 2));
    return;
  }
  if (command.kind === "backup") {
    backup(ldb, dbPath, command.target);
    return;
  }
  if (command.kind === "export") {
    console.log(JSON.stringify(buildSnapshot(ldb), null, 2));
    return;
  }
  const integrity = ldb.db.prepare("PRAGMA integrity_check").get();
  console.log(JSON.stringify({ integrity: integrity.integrity_check, schemaVersion: ldb.schemaVersion() }, null, 2));
}

// Run one command. The database is always closed in `finally`, including when
// the command fails, so WAL state is not left behind.
export function main(argv = process.argv.slice(2)) {
  const dbPath = resolveDbPath();
  const command = planCommand(argv, dbPath);
  const ldb = new LearningDb(dbPath);
  try {
    run(command, ldb, dbPath);
  } finally {
    ldb.close();
  }
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  try {
    main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`practice-db: ${message}`);
    process.exitCode = err instanceof UsageError ? EXIT_USAGE : 1;
  }
}
