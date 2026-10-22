// Ingest pipeline orchestrator (P3). Drives preflight -> confirmation ->
// plan -> write (create-only) -> verify -> compile -> report, honoring the
// safety gates: no write without confirmation, only create, idempotent.

import { planNote } from "./planner.js";
import { ObsidianError } from "../obsidian/obsidian-adapter.js";

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

  // Run the pipeline with an explicit confirmation callback (the agent/CLI
  // implements it; the user decides). Returns a report object.
  async run({ source, confirm, slug }) {
    const t = this.task;
    if (t) t.log("start", `ingest ${source.sourceUri}`);

    // Preflight (no writes).
    const { buildPreflight } = await import("./preflight.js");
    const pre = buildPreflight({ source, registry: this.registry, adapter: this.adapter, targetDir: this.targetDir });
    const slugMatch = await pre.slugMatchPromise;
    pre.duplicate.slugMatch = slugMatch;
    if (t) t.transition("preflighted").log("preflight", JSON.stringify(pre.duplicate));

    // Gate 1: user confirms the preflight (content, duplicates, target).
    const okPreflight = await this._confirm(confirm, `确认摄入？\n  标题: ${source.title}\n  来源: ${source.sourceUri}\n  重复: ${pre.duplicate.exact ? "精确重复(已摄入)" : pre.duplicate.slugMatch ? "同主题source页已存在" : "无"}\n  目标: ${pre.targetPath}`);
    if (!okPreflight) {
      if (t) t.transition("cancelled");
      return { status: "cancelled", preflight: pre };
    }
    if (t) t.transition("awaiting_confirmation");

    // Plan the note (create-only).
    const plan = planNote({ source, targetDir: this.targetDir, slug: slug ?? pre.slug });
    if (t) t.transition("planned").log("plan", `${plan.operation} ${plan.targetPath}`);

    // Gate 2: user confirms the actual write plan.
    const okWrite = await this._confirm(confirm, `写入计划：${plan.operation} ${plan.targetPath}\n确认写入？`);
    if (!okWrite) {
      if (t) t.transition("cancelled");
      return { status: "cancelled", preflight: pre, plan };
    }
    if (t) t.transition("awaiting_write_confirmation");

    // Write: create-only, never overwrite (If-None-Match: * -> 412).
    if (t) t.transition("writing");
    let created;
    try {
      await this.adapter.create(plan.targetPath, plan.content);
      created = true;
    } catch (err) {
      if (err instanceof ObsidianError && err.status === 412) {
        if (t) t.transition("needs_review").log("write", "target exists, refused to overwrite");
        return { status: "needs_review", reason: "target exists", preflight: pre, plan };
      }
      if (t) t.transition("failed");
      throw err;
    }

    // Verify the note was written and reads back intact.
    if (t) t.transition("validating");
    const readBack = await this.adapter.read(plan.targetPath);
    if (t) t.log("validate", `read-back ${readBack.length} chars`);

    // Compile via karpathywiki and wait for the wiki pages.
    if (t) t.transition("compiling");
    let compile = null;
    if (this.driver) {
      const snapshot = await this.driver.snapshotWiki();
      await this.driver.openAndIngest(plan.targetPath);
      compile = await this.driver.waitForIngest({ snapshot });
    }

    // Record in the project registry (exact-duplicate source for later).
    this.registry.add({
      contentHash: source.contentHash,
      sourceUri: source.sourceUri,
      title: source.title,
      vaultPath: plan.targetPath,
    });
    await this.registry.save();
    if (t) t.transition("completed");

    return { status: "completed", preflight: pre, plan, created, compile };
  }
}
