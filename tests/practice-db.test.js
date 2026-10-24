// Regression tests for the P1 CLI/packaging hardening wave:
// - practice-db argument validation (G7/G8), safe backup (G11/G12) and DB
//   lifecycle on failures (G10);
// - status attempt history through AttemptStore, newest-first (G9);
// - a static guard that the CLI scripts keep every import used (G1);
// - the default test runner excluding the live vault suite (H2);
// - packaging metadata (H1/H3), .gitignore hygiene (H4/H5/H6) and the
//   cordis.patch.yml description (F8);
// - search-cli whitespace-query guard (G21) and the no-process.exit rule
//   (G5/G10/G16).
//
// Every spawned CLI uses a temporary database and state directory, so the real
// vault, code/.state and the developer's learning DB are never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { collectTestFiles } from "../scripts/run-tests.mjs";

const CODE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRACTICE_DB = join(CODE_DIR, "scripts", "practice-db.mjs");

const QUESTION = {
  questionId: "q-1",
  version: 1,
  type: "concept",
  topic: "间隔重复",
  prompt: "What is spaced repetition?",
  reference: "wiki/concepts/间隔重复.md",
};
const ANSWER = {
  questionId: "q-1",
  questionVersion: 1,
  phase: "first",
  correct: true,
  result: "correct",
  score: 8,
  answerSummary: "Explained the interval growth.",
  modelRating: 8,
  feedback: "Good.",
  errorAnalysis: null,
  suggestions: null,
  concepts: [{ name: "间隔重复", level: 0.6, source: "model_rating" }],
};

function makeTempPaths(t) {
  const dir = mkdtempSync(join(tmpdir(), "dsh-practice-db-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = { dir, dbPath: join(dir, "learning.db"), stateDir: join(dir, "state") };
  return paths;
}

function runCli(args, paths) {
  return spawnSync(process.execPath, [PRACTICE_DB, ...args], {
    cwd: CODE_DIR,
    encoding: "utf8",
    // Pin the database and state dir to the temp workspace for every call.
    env: { ...process.env, OBSIDIAN_LEARNING_DB: paths.dbPath, OBSIDIAN_STATE_DIR: paths.stateDir },
  });
}

function questionArg(overrides = {}) {
  return JSON.stringify({ ...QUESTION, ...overrides });
}

test("check reports integrity and closes the database cleanly", (t) => {
  const paths = makeTempPaths(t);
  const result = runCli(["check"], paths);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.integrity, "ok");
  assert.ok(report.schemaVersion >= 2, "check must report the stored schema version");
  assert.ok(existsSync(paths.dbPath));
  // close() checkpoints and removes the WAL sidecars; leftovers mean it was skipped.
  assert.equal(existsSync(`${paths.dbPath}-wal`), false);
  assert.equal(existsSync(`${paths.dbPath}-shm`), false);
});

test("usage errors exit 2 and never create or bind the database", (t) => {
  const paths = makeTempPaths(t);
  const cases = [
    [["question", "{not json"], /not valid JSON/],
    [["question", JSON.stringify({ version: 1, type: "concept", topic: "t", prompt: "p" })], /questionId/],
    [["question", questionArg({ version: 0 })], /version/],
    [["question", questionArg({ prompt: "   " })], /prompt/],
    [["question", '["not", "an", "object"]'], /must be a JSON object/],
    [["answer", JSON.stringify({ questionId: "q-1", correct: true, result: "correct" })], /questionVersion/],
    [["answer", JSON.stringify({ ...ANSWER, result: "bogus" })], /result/],
    [["answer", JSON.stringify({ ...ANSWER, correct: false })], /contradicts/],
    [["status"], /status needs a questionId/],
    [["status", "   "], /status needs a questionId/],
    [["nope"], /unknown command/],
  ];
  for (const [args, pattern] of cases) {
    const result = runCli(args, paths);
    assert.equal(result.status, 2, `${args[0]}: expected usage exit 2, stderr=${result.stderr}`);
    assert.match(result.stderr, pattern, `${args[0]}: ${result.stderr}`);
    assert.match(result.stderr, /^practice-db: /, "usage errors must be concise");
    assert.equal(existsSync(paths.dbPath), false, `${args[0]} must not create the database`);
  }
});

test("question, answer and status round-trip through SQLite", (t) => {
  const paths = makeTempPaths(t);
  const recorded = runCli(["question", questionArg()], paths);
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.match(recorded.stdout, /question recorded: q-1/);

  const answered = runCli(["answer", JSON.stringify(ANSWER)], paths);
  assert.equal(answered.status, 0, answered.stderr);
  assert.match(answered.stdout, /answer recorded: attempt_/);

  const status = runCli(["status", "q-1"], paths);
  assert.equal(status.status, 0, status.stderr);
  const report = JSON.parse(status.stdout);
  assert.equal(report.question.question_id, "q-1");
  assert.equal(report.attempts.length, 1);
  assert.equal(report.attempts[0].result, "correct");
  assert.equal(report.review.correct_streak, 1);
  assert.equal(report.mastery.length, 1);
  assert.equal(report.mastery[0].source, "model_rating");
});

test("status lists attempts newest-first through the attempt store projection", (t) => {
  const paths = makeTempPaths(t);
  assert.equal(runCli(["question", questionArg()], paths).status, 0);

  // Two answers so ordering is observable: the wrong one comes first.
  const wrong = { ...ANSWER, correct: false, result: "incorrect", score: 3, answerSummary: "Missed the interval growth." };
  const first = runCli(["answer", JSON.stringify(wrong)], paths);
  assert.equal(first.status, 0, first.stderr);
  const second = runCli(["answer", JSON.stringify({ ...ANSWER, phase: "correction" })], paths);
  assert.equal(second.status, 0, second.stderr);

  const status = runCli(["status", "q-1"], paths);
  assert.equal(status.status, 0, status.stderr);
  const report = JSON.parse(status.stdout);
  assert.equal(report.attempts.length, 2);
  // AttemptStore returns the history newest-first; reverting to the old ad-hoc
  // `ORDER BY id` (oldest first) SELECT would put the first answer first.
  assert.equal(report.attempts[0].result, "correct", "status must list the latest attempt first");
  assert.equal(report.attempts[1].result, "incorrect");
  // These keys only exist because the row comes from the store projection;
  // the old four-column SELECT dropped attempt_id/question_version/answer_summary.
  assert.match(report.attempts[0].attempt_id, /^attempt_/);
  assert.equal(report.attempts[0].question_version, 1);
  assert.equal(report.attempts[0].answer_summary, "Explained the interval growth.");
  assert.equal(report.attempts[1].answer_summary, "Missed the interval growth.");
});

test("an invalid answer is rejected before any write", (t) => {
  const paths = makeTempPaths(t);
  assert.equal(runCli(["question", questionArg()], paths).status, 0);

  const rejected = runCli(["answer", JSON.stringify({ ...ANSWER, correct: false })], paths);
  assert.equal(rejected.status, 2, rejected.stderr);

  const status = runCli(["status", "q-1"], paths);
  assert.equal(JSON.parse(status.stdout).attempts.length, 0, "no partial answer may be stored");
});

test("runtime failures exit 1 with concise stderr and still close the database", (t) => {
  const paths = makeTempPaths(t);
  assert.equal(runCli(["question", questionArg()], paths).status, 0);

  // Answering a question that was never recorded violates the foreign key.
  const result = runCli(["answer", JSON.stringify({ ...ANSWER, questionId: "q-missing" })], paths);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /^practice-db: /);
  assert.doesNotMatch(result.stderr, /\n\s+at /, "failures must not print a raw stack trace");
  assert.equal(existsSync(`${paths.dbPath}-wal`), false, "the database must be closed on failure");
  assert.equal(existsSync(`${paths.dbPath}-shm`), false, "the database must be closed on failure");
});

test("backup writes a WAL-safe copy that is itself a valid database", (t) => {
  const paths = makeTempPaths(t);
  assert.equal(runCli(["question", questionArg()], paths).status, 0);
  const target = join(paths.dir, "backup.db");

  const result = runCli(["backup", target], paths);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /backup written:/);
  assert.ok(existsSync(target));

  // Open the copy through the CLI: a torn/uncheckpointed copy fails integrity.
  const check = spawnSync(process.execPath, [PRACTICE_DB, "check"], {
    cwd: CODE_DIR,
    encoding: "utf8",
    env: { ...process.env, OBSIDIAN_LEARNING_DB: target, OBSIDIAN_STATE_DIR: paths.stateDir },
  });
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).integrity, "ok");
  assert.equal(JSON.parse(check.stdout).schemaVersion, 2);
});

test("backup refuses overwrites, the live database, WAL sidecars and bad paths", (t) => {
  const paths = makeTempPaths(t);
  assert.equal(runCli(["question", questionArg()], paths).status, 0);

  const existing = join(paths.dir, "existing.db");
  writeFileSync(existing, "keep-me");
  const cases = [
    [["backup", existing], /refusing to overwrite/],
    [["backup", paths.dbPath], /live database/],
    [["backup", `${paths.dbPath}-wal`], /WAL sidecar/],
    [["backup", `${paths.dbPath}-shm`], /WAL sidecar/],
    [["backup", "relative-backup.db"], /absolute path/],
    [["backup", join(paths.dir, "missing", "x.db")], /directory does not exist/],
  ];
  for (const [args, pattern] of cases) {
    const result = runCli(args, paths);
    assert.equal(result.status, 2, `${args[1]}: expected exit 2, stderr=${result.stderr}`);
    assert.match(result.stderr, pattern, `${args[1]}: ${result.stderr}`);
  }
  assert.equal(readFileSync(existing, "utf8"), "keep-me", "an existing backup target must be untouched");
  assert.equal(runCli(["check"], paths).status, 0, "the live database survives refused backups");
});

test("package.json keeps the CLIs publishable and the default test run local-only", () => {
  const pkg = JSON.parse(readFileSync(join(CODE_DIR, "package.json"), "utf8"));
  assert.equal(pkg.engines.node, ">=22.6");
  assert.match(pkg.devDependencies["@types/node"], /^\^22(\.|$)/);
  for (const entry of ["lib", "tsconfig.json"]) {
    assert.ok(pkg.files.includes(entry), `files must include ${entry} for the CLIs to run after install`);
  }
  assert.equal(pkg.scripts.prepack, "npm run build && npm run build:client", "packing must build lib/ and the client bundle first");
  assert.ok(pkg.files.includes("panel"), "the graph page and its vendored library must ship");
  assert.equal(pkg.exports["./cordis.patch.yml"], "./cordis.patch.yml", "the bundle patch must stay exported");
  assert.match(pkg.scripts.test, /scripts\/run-tests\.mjs/);
  assert.doesNotMatch(pkg.scripts.test, /integration-live/, "the default test run must not include live vault tests");
  assert.match(pkg.scripts["test:live"], /integration-live/);
});

test("the default test runner lists every unit suite but never the live vault suite", () => {
  const files = collectTestFiles(CODE_DIR).map((file) => file.split(sep).join("/"));
  for (const expected of [
    "tests/practice-db.test.js",
    "tests/wiki-node-cli.test.js",
    "tests/registry.test.js",
    "lib/tests/practice.test.js",
  ]) {
    assert.ok(files.includes(expected), `default test run is missing ${expected}`);
  }
  assert.equal(
    files.some((file) => file.includes("integration-live")),
    false,
    "the live vault suite must only run through npm run test:live",
  );
});

test(".gitignore ignores secrets, databases, logs and runtime state", () => {
  const rules = new Set(
    readFileSync(join(CODE_DIR, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")),
  );
  for (const rule of [
    ".env*",
    "!.env.example",
    ".state/",
    "*.db",
    "*.db-wal",
    "*.db-shm",
    "*.log",
    "coverage/",
    ".DS_Store",
  ]) {
    assert.ok(rules.has(rule), `.gitignore must contain "${rule}"`);
  }
});

test("cordis.patch.yml describes mounting the plugin without an ordering claim", () => {
  const text = readFileSync(join(CODE_DIR, "cordis.patch.yml"), "utf8");
  assert.doesNotMatch(text, /applied after/i, "no unsupported ordering claim");
  assert.doesNotMatch(text, /dsh-base/i, "no reference to a bundle whose ordering is not enforced");
  assert.match(text, /mounts[\s\S]*plugin entry[\s\S]*registers[\s\S]*skills/i);
  assert.match(text, /^- insert:$/m);
  assert.match(text, /id: dsh-learn-everything/);
});

test("hardened CLI scripts use process.exitCode instead of process.exit", () => {
  for (const name of ["ingest-cli.mjs", "practice-db.mjs", "wiki-node-cli.mjs"]) {
    const source = readFileSync(join(CODE_DIR, "scripts", name), "utf8");
    assert.doesNotMatch(source, /process\.exit\s*\(/, `${name} must not call process.exit()`);
  }
});

test("CLI scripts keep every imported binding used", () => {
  // Static guard for G1: a leftover import (e.g. pathToFileURL for a guard that
  // no longer exists) misleads readers. Every imported local name must appear
  // again in the file body; the import specifier itself is the only allowed hit.
  for (const name of ["ingest-cli.mjs", "practice-db.mjs", "wiki-node-cli.mjs"]) {
    const source = readFileSync(join(CODE_DIR, "scripts", name), "utf8");
    const unused = [];
    for (const line of source.split("\n")) {
      const match = line.match(/^import\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))\s+from\s+["']/);
      if (!match) continue;
      const specifiers = match[2] ? [match[2]] : match[1].split(",").map((spec) => spec.trim()).filter(Boolean);
      for (const specifier of specifiers) {
        const local = specifier.split(/\s+as\s+/).pop().trim();
        const uses = source.match(new RegExp(`\\b${local.replace(/\$/g, "\\$")}\\b`, "g")) ?? [];
        if (uses.length <= 1) unused.push(local);
      }
    }
    assert.deepEqual(unused, [], `${name} imports unused bindings: ${unused.join(", ")}`);
  }
});

test("search-cli rejects a whitespace-only query before any retrieval", () => {
  const result = spawnSync(process.execPath, [join(CODE_DIR, "scripts", "search-cli.mjs"), "   "], {
    cwd: CODE_DIR,
    encoding: "utf8",
    env: { ...process.env, OBSIDIAN_API_KEY: "test-key" },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /usage:/);
  assert.doesNotMatch(result.stdout, /intent:/, "no retrieval may start for a blank query");
});

test("ingest-cli reports usage and exits non-zero without a target", () => {
  const result = spawnSync(process.execPath, [join(CODE_DIR, "scripts", "ingest-cli.mjs")], {
    cwd: CODE_DIR,
    encoding: "utf8",
    env: { ...process.env, OBSIDIAN_API_KEY: "test-key" },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /usage: OBSIDIAN_API_KEY/);
});
