// Unit tests for the ingest pipeline orchestration, using stubbed adapter,
// registry and wiki driver so the full flow runs without network or vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import { IngestPipeline, PREFLIGHT_PROMPT, WRITE_PROMPT } from "../src/ingest/pipeline.js";
import { IngestTask } from "../src/ingest/task-state.js";
import { ObsidianError } from "../src/obsidian/obsidian-adapter.js";

function makeSource(overrides = {}) {
  return {
    sourceId: "source-id-123456",
    sourceUri: "mem://pipeline-source",
    title: "Pipeline Note",
    content: "# Pipeline Note\n\nBody",
    contentHash: "0123456789abcdef0123",
    fetchedAt: "2026-10-23T00:00:00.000Z",
    warnings: [],
    ...overrides,
  };
}

function makeAdapter({ files = [], listError = null, createError = null, readError = null, tamperRead = false } = {}) {
  const created = new Map();
  const calls = [];
  return {
    created,
    calls,
    async list(dir) {
      calls.push(["list", dir]);
      if (listError) throw listError;
      return { files };
    },
    async create(path, content) {
      calls.push(["create", path]);
      if (createError) throw createError;
      created.set(path, content);
    },
    async read(path) {
      calls.push(["read", path]);
      if (readError) throw readError;
      if (tamperRead) return "tampered content";
      return created.get(path);
    },
  };
}

function makeRegistry(records = [], { findByHashError = null, saveError = null } = {}) {
  const added = [];
  const saved = [];
  return {
    added,
    saved,
    findByHash(hash) {
      if (findByHashError) throw findByHashError;
      return records.find((record) => record.contentHash === hash);
    },
    add(record) {
      added.push(record);
      records.push(record);
      return this;
    },
    async save() {
      if (saveError) throw saveError;
      saved.push(records.map((record) => ({ ...record })));
    },
  };
}

function makeDriver({ waitError = null } = {}) {
  const calls = [];
  return {
    calls,
    async snapshotWiki() {
      calls.push("snapshotWiki");
      return { "wiki/sources": new Set() };
    },
    async openAndIngest(path) {
      calls.push(["openAndIngest", path]);
    },
    async waitForIngest({ snapshot }) {
      calls.push(["waitForIngest", snapshot]);
      if (waitError) throw waitError;
      return { created: { sources: ["wiki/sources/pipeline-note.md"] }, elapsedMs: 1 };
    },
  };
}

function makeConfirm({ task = null, answers = [], prompts = [], statesAtPrompt = [] } = {}) {
  let index = 0;
  return async (prompt) => {
    prompts.push(prompt);
    if (task) statesAtPrompt.push(task.state);
    return answers[index++] === true;
  };
}

function makeTask(id = "t-pipeline") {
  return new IngestTask({ taskId: id, source: makeSource() });
}

test("completed run writes, verifies, records and compiles in order", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry();
  const driver = makeDriver();
  const task = makeTask("t-happy");
  const prompts = [];
  const statesAtPrompt = [];
  const confirm = makeConfirm({ task, prompts, statesAtPrompt, answers: [true, true] });
  const pipeline = new IngestPipeline({ adapter, registry, driver, task });

  const report = await pipeline.run({ source: makeSource(), confirm });

  assert.equal(report.status, "completed");
  assert.equal(report.created, true);
  assert.equal(report.plan.targetPath, "Sources/pipeline-note.md");
  assert.equal(adapter.created.get("Sources/pipeline-note.md"), report.plan.content);
  assert.equal(registry.added.length, 1);
  assert.equal(registry.saved.length, 1);
  assert.deepEqual(registry.added[0], {
    contentHash: "0123456789abcdef0123",
    sourceUri: "mem://pipeline-source",
    title: "Pipeline Note",
    vaultPath: "Sources/pipeline-note.md",
  });
  assert.deepEqual(driver.calls, [
    "snapshotWiki",
    ["openAndIngest", "Sources/pipeline-note.md"],
    ["waitForIngest", { "wiki/sources": new Set() }],
  ]);
  assert.equal(task.state, "completed");
  assert.equal(prompts.length, 2);
  assert.ok(prompts[0].includes("目标: Sources/pipeline-note.md"));
  assert.ok(prompts[1].includes("Sources/pipeline-note.md"));
  assert.deepEqual(statesAtPrompt, ["awaiting_confirmation", "awaiting_write_confirmation"]);
});

test("gate 1 blocks with awaiting_confirmation persisted before the prompt", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry();
  const task = makeTask("t-cancel-1");
  const prompts = [];
  const statesAtPrompt = [];
  const confirm = makeConfirm({ task, prompts, statesAtPrompt, answers: [false] });
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task });

  const report = await pipeline.run({ source: makeSource(), confirm });

  assert.equal(report.status, "cancelled");
  assert.equal(report.stage, "confirm-preflight");
  assert.equal(task.state, "cancelled");
  assert.deepEqual(statesAtPrompt, ["awaiting_confirmation"]);
  assert.ok(!report.plan);
  assert.equal(adapter.created.size, 0);
  assert.equal(registry.added.length, 0);
  assert.deepEqual(adapter.calls.filter(([name]) => name === "create"), []);
});

test("gate 2 blocks with awaiting_write_confirmation persisted before the prompt", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry();
  const task = makeTask("t-cancel-2");
  const prompts = [];
  const statesAtPrompt = [];
  const confirm = makeConfirm({ task, prompts, statesAtPrompt, answers: [true, false] });
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task });

  const report = await pipeline.run({ source: makeSource(), confirm });

  assert.equal(report.status, "cancelled");
  assert.equal(report.stage, "confirm-write");
  assert.equal(task.state, "cancelled");
  assert.deepEqual(statesAtPrompt, ["awaiting_confirmation", "awaiting_write_confirmation"]);
  assert.equal(adapter.created.size, 0);
  assert.equal(registry.added.length, 0);
});

test("a preflight failure returns a structured failed report instead of hanging", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry([], { findByHashError: new Error("registry corrupt") });
  const driver = makeDriver();
  const task = makeTask("t-preflight");
  const pipeline = new IngestPipeline({ adapter, registry, driver, task });

  const report = await pipeline.run({ source: makeSource(), confirm: async () => true });

  assert.equal(report.status, "failed");
  assert.equal(report.stage, "preflight");
  assert.match(report.error, /registry corrupt/);
  assert.equal(report.created, false);
  assert.equal(task.state, "failed");
  assert.deepEqual(adapter.calls.filter(([name]) => name === "create"), []);
  assert.equal(driver.calls.length, 0);
});

test("an unsafe slug override fails the run at preflight without writing", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry();
  const task = makeTask("t-slug-bad");
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task });

  const report = await pipeline.run({ source: makeSource(), confirm: async () => true, slug: "../escape" });

  assert.equal(report.status, "failed");
  assert.equal(report.stage, "preflight");
  assert.match(report.error, /single path segment/);
  assert.equal(task.state, "failed");
  assert.equal(adapter.created.size, 0);
});

test("a valid slug override is the single source of truth for both gates and the write", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry();
  const task = makeTask("t-slug-good");
  const prompts = [];
  const confirm = makeConfirm({ task, prompts, answers: [true, true] });
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task });

  const report = await pipeline.run({ source: makeSource(), confirm, slug: "custom-slug" });

  assert.equal(report.status, "completed");
  assert.equal(report.plan.targetPath, "Sources/custom-slug.md");
  assert.ok(prompts[0].includes("目标: Sources/custom-slug.md"));
  assert.ok(prompts[1].includes("Sources/custom-slug.md"));
  assert.ok(adapter.created.has("Sources/custom-slug.md"));
});

test("a read-back mismatch fails the run, keeps the created flag and skips the registry", async () => {
  const adapter = makeAdapter({ tamperRead: true });
  const registry = makeRegistry();
  const task = makeTask("t-mismatch");
  const confirm = makeConfirm({ task, answers: [true, true] });
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task });

  const report = await pipeline.run({ source: makeSource(), confirm });

  assert.equal(report.status, "failed");
  assert.equal(report.stage, "validate");
  assert.match(report.error, /read-back content mismatch/);
  assert.equal(report.created, true);
  assert.equal(task.state, "failed");
  assert.equal(registry.added.length, 0);
  assert.equal(registry.saved.length, 0);
});

test("a read-back error fails the run instead of crashing", async () => {
  const adapter = makeAdapter({ readError: new Error("read failed") });
  const registry = makeRegistry();
  const task = makeTask("t-read-error");
  const confirm = makeConfirm({ task, answers: [true, true] });
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task });

  const report = await pipeline.run({ source: makeSource(), confirm });

  assert.equal(report.status, "failed");
  assert.equal(report.stage, "validate");
  assert.match(report.error, /read failed/);
  assert.equal(task.state, "failed");
});

test("an existing target (412) stops as needs_review without reading back", async () => {
  const adapter = makeAdapter({ createError: new ObsidianError("target exists", { status: 412 }) });
  const registry = makeRegistry();
  const task = makeTask("t-412");
  const confirm = makeConfirm({ task, answers: [true, true] });
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task });

  const report = await pipeline.run({ source: makeSource(), confirm });

  assert.equal(report.status, "needs_review");
  assert.equal(report.reason, "target exists");
  assert.equal(task.state, "needs_review");
  assert.deepEqual(adapter.calls.filter(([name]) => name !== "list" && name !== "create"), []);
  assert.equal(registry.added.length, 0);
});

test("a compile failure reports partial while keeping the registry record", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry();
  const driver = makeDriver({ waitError: new Error("wiki ingest timed out") });
  const task = makeTask("t-compile");
  const confirm = makeConfirm({ task, answers: [true, true] });
  const pipeline = new IngestPipeline({ adapter, registry, driver, task });

  const report = await pipeline.run({ source: makeSource(), confirm });

  assert.equal(report.status, "partial");
  assert.equal(report.stage, "compile");
  assert.match(report.error, /wiki ingest timed out/);
  assert.equal(report.created, true);
  assert.equal(report.compile, null);
  assert.equal(task.state, "partial");
  assert.equal(registry.added.length, 1);
  assert.equal(registry.saved.length, 1);
  assert.equal(report.registry.vaultPath, "Sources/pipeline-note.md");
});

test("a registry persist failure reports partial after the note was written", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry([], { saveError: new Error("disk full") });
  const driver = makeDriver();
  const task = makeTask("t-registry");
  const confirm = makeConfirm({ task, answers: [true, true] });
  const pipeline = new IngestPipeline({ adapter, registry, driver, task });

  const report = await pipeline.run({ source: makeSource(), confirm });

  assert.equal(report.status, "partial");
  assert.equal(report.stage, "registry");
  assert.match(report.error, /disk full/);
  assert.equal(report.created, true);
  assert.equal(task.state, "partial");
  assert.ok(adapter.created.has("Sources/pipeline-note.md"));
  assert.equal(driver.calls.length, 0);
});

test("preflight warnings appear in the gate-1 prompt and in the report", async () => {
  const adapter = makeAdapter({ listError: new Error("vault offline") });
  const registry = makeRegistry();
  const task = makeTask("t-warnings");
  const prompts = [];
  const confirm = makeConfirm({ task, prompts, answers: [false] });
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task });
  const source = makeSource({ warnings: ["manual warning"] });

  const report = await pipeline.run({ source, confirm });

  assert.equal(report.status, "cancelled");
  assert.ok(report.warnings.includes("manual warning"));
  assert.ok(report.warnings.some((warning) => warning.includes("vault offline")));
  assert.ok(prompts[0].includes("- manual warning"));
  assert.ok(prompts[0].includes("vault offline"));
});

test("runs without a wiki driver and reports a null compile result", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry();
  const task = makeTask("t-no-driver");
  const confirm = makeConfirm({ task, answers: [true, true] });
  const pipeline = new IngestPipeline({ adapter, registry, task });

  const report = await pipeline.run({ source: makeSource(), confirm });

  assert.equal(report.status, "completed");
  assert.equal(report.compile, null);
  assert.equal(registry.saved.length, 1);
});

test("a non-412 write failure is logged on the task and rethrown with write context", async () => {
  const adapter = makeAdapter({ createError: new Error("network down") });
  const registry = makeRegistry();
  const task = makeTask("t-write-fail");
  const confirm = makeConfirm({ task, answers: [true, true] });
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task });

  await assert.rejects(
    () => pipeline.run({ source: makeSource(), confirm }),
    (err) => {
      assert.equal(err.message, "write failed for Sources/pipeline-note.md: network down");
      assert.equal(err.cause.message, "network down");
      return true;
    },
  );
  assert.equal(task.state, "failed");
  const writeStep = task.steps.find((step) => step.step === "write");
  assert.ok(writeStep, "the write failure must be recorded on the task");
  assert.equal(writeStep.detail, "network down");
  assert.equal(registry.added.length, 0);
});

test("a confirm callback that throws fails gate 1 instead of leaving the task awaiting", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry();
  const task = makeTask("t-confirm-throw-1");
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task });

  const report = await pipeline.run({
    source: makeSource(),
    confirm: async () => {
      throw new Error("prompt pipe closed");
    },
  });

  assert.equal(report.status, "failed");
  assert.equal(report.stage, "confirm-preflight");
  assert.match(report.error, /prompt pipe closed/);
  assert.equal(report.preflight.targetPath, "Sources/pipeline-note.md");
  assert.equal(task.state, "failed");
  assert.equal(adapter.created.size, 0);
  assert.equal(registry.added.length, 0);
});

test("a confirm callback that throws fails gate 2 instead of leaving the task awaiting", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry();
  const task = makeTask("t-confirm-throw-2");
  let prompts = 0;
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task });

  const report = await pipeline.run({
    source: makeSource(),
    confirm: async () => {
      prompts += 1;
      if (prompts === 1) return true;
      throw new Error("second prompt failed");
    },
  });

  assert.equal(report.status, "failed");
  assert.equal(report.stage, "confirm-write");
  assert.match(report.error, /second prompt failed/);
  assert.equal(report.plan.targetPath, "Sources/pipeline-note.md");
  assert.equal(task.state, "failed");
  assert.equal(adapter.created.size, 0);
});

test("gate prompts are produced by the exported PREFLIGHT_PROMPT/WRITE_PROMPT builders", async () => {
  const adapter = makeAdapter();
  const registry = makeRegistry();
  const source = makeSource();
  const prompts = [];

  const gateOneTask = makeTask("t-prompt-builders-1");
  const gateOnePipeline = new IngestPipeline({ adapter, registry, driver: null, task: gateOneTask });
  const cancelledOne = await gateOnePipeline.run({
    source,
    confirm: makeConfirm({ task: gateOneTask, prompts, answers: [false] }),
  });
  assert.equal(prompts[0], PREFLIGHT_PROMPT(source, cancelledOne.preflight));

  const gateTwoTask = makeTask("t-prompt-builders-2");
  const gateTwoPipeline = new IngestPipeline({ adapter, registry, driver: null, task: gateTwoTask });
  const cancelledTwo = await gateTwoPipeline.run({
    source,
    confirm: makeConfirm({ task: gateTwoTask, prompts, answers: [true, false] }),
  });
  assert.equal(prompts.at(-1), WRITE_PROMPT(cancelledTwo.plan));
});

test("a custom wikiSourcesDir is used for the slug-duplicate listing", async () => {
  const adapter = makeAdapter({ files: ["custom/sources/pipeline-note.md"] });
  const registry = makeRegistry();
  const task = makeTask("t-wiki-dir");
  const pipeline = new IngestPipeline({
    adapter,
    registry,
    driver: null,
    task,
    wikiSourcesDir: "custom/sources",
  });

  const report = await pipeline.run({ source: makeSource(), confirm: makeConfirm({ task, answers: [false] }) });

  assert.equal(report.status, "cancelled");
  assert.deepEqual(
    adapter.calls.find(([name]) => name === "list"),
    ["list", "custom/sources"],
  );
  assert.equal(report.preflight.duplicate.slugMatch, true);
});
