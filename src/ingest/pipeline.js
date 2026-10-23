// Ingest pipeline orchestrator (P3). Drives preflight -> confirmation ->
// plan -> write (create-only) -> verify -> compile -> report, honoring the
// safety gates: no write without confirmation, only create, idempotent.
//
// Confirmation state is persisted BEFORE each gate prompts, so a suspended run
// records that it is blocked on a user decision. A write failure after a
// successful note creation (registry/compile) is reported as "partial" rather
// than losing the fact that the note exists.

import { buildPreflight } from "./preflight.js";
import { planNote } from "./planner.js";
import { ObsidianError } from "../obsidian/obsidian-adapter.js";

function duplicateLabel(duplicate) {
  if (duplicate.exact) return "精确重复(已摄入)";
  if (duplicate.slugMatch) return "同主题source页已存在";
  return "无";
}

// Gate-1 prompt: title, origin, duplicate signal, the exact target path that
// will be written, and the preflight warnings raised so far.
function preflightPrompt(source, pre) {
  const lines = [
    "确认摄入？",
    `  标题: ${source.title}`,
    `  来源: ${source.sourceUri}`,
    `  重复: ${duplicateLabel(pre.duplicate)}`,
    `  目标: ${pre.targetPath}`,
  ];
  if (pre.warnings.length > 0) {
    lines.push("  警告:");
    for (const warning of pre.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join("\n");
}

export class IngestPipeline {
  constructor({ adapter, registry, driver, targetDir = "Sources", task = null }) {
    this.adapter = adapter;
    this.registry = registry;
    this.driver = driver;
    this.targetDir = targetDir;
    this.task = task;
  }

  // Gate: confirmation callback must return true before any write.
  async _confirm(callback, prompt) {
    if (typeof callback !== "function") return false;
    return (await callback(prompt)) === true;
  }

  _fail(stage, err, extra = {}) {
    if (this.task) this.task.transition("failed").log(stage, `failed: ${err.message}`);
    return { status: "failed", stage, error: err.message, created: false, ...extra };
  }

  _partial(stage, err, extra = {}) {
    if (this.task) this.task.transition("partial").log(stage, `partial: ${err.message}`);
    return { status: "partial", stage, error: err.message, created: true, compile: null, ...extra };
  }

  // Verify the note reads back exactly as planned (B11).
  async _verifyWrite(plan, report) {
    let readBack;
    try {
      readBack = await this.adapter.read(plan.targetPath);
    } catch (err) {
      return { error: this._fail("validate", err, { ...report, created: true }) };
    }
    if (typeof readBack !== "string") {
      return { error: this._fail("validate", new Error("read-back content is not a string"), { ...report, created: true }) };
    }
    if (this.task) this.task.log("validate", `read-back ${readBack.length} chars`);
    if (readBack !== plan.content) {
      const mismatch = new Error(`read-back content mismatch for ${plan.targetPath}`);
      return { error: this._fail("validate", mismatch, { ...report, created: true }) };
    }
    return { ok: true };
  }

  // Compile the written note; a failure here is partial, not lost work.
  async _compile(plan, report) {
    if (!this.driver) return { compile: null };
    try {
      const snapshot = await this.driver.snapshotWiki();
      await this.driver.openAndIngest(plan.targetPath);
      const compile = await this.driver.waitForIngest({ snapshot });
      return { compile };
    } catch (err) {
      return { error: this._partial("compile", err, report) };
    }
  }

  // Verify the write, then record it before compiling so a later compile
  // failure cannot erase the dedupe history.
  async _validateAndRecord(source, plan, report) {
    if (this.task) this.task.transition("validating");
    const verified = await this._verifyWrite(plan, report);
    if (!verified.ok) return { error: verified.error };

    const registryRecord = {
      contentHash: source.contentHash,
      sourceUri: source.sourceUri,
      title: source.title,
      vaultPath: plan.targetPath,
    };
    try {
      this.registry.add(registryRecord);
      await this.registry.save();
      if (this.task) this.task.log("registry", `recorded ${plan.targetPath}`);
    } catch (err) {
      return { error: this._partial("registry", err, report) };
    }
    return { registryRecord };
  }

  // Run the pipeline with an explicit confirmation callback (the agent/CLI
  // implements it; the user decides). Returns a report object.
  async run({ source, confirm, slug }) {
    const t = this.task;
    if (source === null || typeof source !== "object") {
      return this._fail("source", new Error("IngestPipeline: source object is required"));
    }
    if (t) t.log("start", `ingest ${source.sourceUri}`);

    // Preflight (no writes). A preflight crash is a failed run, not a task that
    // stays pending forever.
    let pre;
    try {
      pre = await buildPreflight({
        source,
        registry: this.registry,
        adapter: this.adapter,
        targetDir: this.targetDir,
        slug,
      });
      if (t) t.transition("preflighted").log("preflight", JSON.stringify(pre.duplicate));
    } catch (err) {
      return this._fail("preflight", err, { warnings: [] });
    }
    const warnings = pre.warnings;

    // Gate 1: persist the "blocked on confirmation" state before prompting.
    if (t) t.transition("awaiting_confirmation");
    const okPreflight = await this._confirm(confirm, preflightPrompt(source, pre));
    if (!okPreflight) {
      if (t) t.transition("cancelled");
      return { status: "cancelled", stage: "confirm-preflight", preflight: pre, warnings };
    }

    // Plan the note (create-only) from the preflight's validated slug, so the
    // path shown at gate 1 is exactly the path written.
    let plan;
    try {
      plan = planNote({ source, targetDir: this.targetDir, slug: pre.slug });
      if (plan.targetPath !== pre.targetPath) {
        throw new Error(`planned target ${plan.targetPath} does not match confirmed target ${pre.targetPath}`);
      }
      if (t) t.transition("planned").log("plan", `${plan.operation} ${plan.targetPath}`);
    } catch (err) {
      return this._fail("plan", err, { preflight: pre, warnings });
    }

    // Gate 2: persist the pending write confirmation before prompting.
    if (t) t.transition("awaiting_write_confirmation");
    const okWrite = await this._confirm(confirm, `写入计划：${plan.operation} ${plan.targetPath}\n确认写入？`);
    if (!okWrite) {
      if (t) t.transition("cancelled");
      return { status: "cancelled", stage: "confirm-write", preflight: pre, plan, warnings };
    }

    // Write: create-only, never overwrite (If-None-Match: * -> 412).
    if (t) t.transition("writing");
    try {
      await this.adapter.create(plan.targetPath, plan.content);
    } catch (err) {
      if (err instanceof ObsidianError && err.status === 412) {
        if (t) t.transition("needs_review").log("write", "target exists, refused to overwrite");
        return { status: "needs_review", reason: "target exists", stage: "write", preflight: pre, plan, warnings };
      }
      if (t) t.transition("failed");
      throw err;
    }

    // Verify the write, then record it before compiling so a later compile
    // failure cannot erase the dedupe history.
    const writeReport = { preflight: pre, plan, warnings };
    const recorded = await this._validateAndRecord(source, plan, writeReport);
    if (recorded.error) return recorded.error;
    const registryRecord = recorded.registryRecord;

    if (t) t.transition("compiling");
    const compiled = await this._compile(plan, { ...writeReport, registry: registryRecord });
    if (compiled.error) return compiled.error;

    if (t) t.transition("completed");
    return {
      status: "completed",
      preflight: pre,
      plan,
      created: true,
      compile: compiled.compile,
      registry: registryRecord,
      warnings,
    };
  }
}
