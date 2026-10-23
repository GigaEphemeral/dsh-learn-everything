// Unit tests for skill catalog loading and the registered provider: skip
// malformed skills, detect duplicate names, and expose the packaged skills.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apply, loadSkillsCached, loadSkillsFrom, name as pluginName } from "../index.js";

const VALID_SKILL = `---
name: valid-one
description: A valid skill.
---
# Body
`;

async function makeRoot() {
  return mkdtemp(join(tmpdir(), "dsh-skills-"));
}

async function writeSkill(root, dirName, content) {
  await mkdir(join(root, dirName), { recursive: true });
  await writeFile(join(root, dirName, "SKILL.md"), content, "utf8");
}

function captureWarn() {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  return {
    warnings,
    restore: () => {
      console.warn = original;
    },
  };
}

test("apply registers a provider that lists the packaged skills", async () => {
  const providers = [];
  apply({ skills: { registerProvider: (factory) => providers.push(factory) } });
  assert.equal(providers.length, 1);
  const provider = providers[0]();
  assert.equal(provider.name, pluginName);
  const listed = await provider.list();
  assert.deepEqual(listed.map((skill) => skill.name), ["daily-practice", "knowledge-search", "obsidian-access", "remember-knowledge"]);
  assert.ok(listed.every((skill) => typeof skill.description === "string" && skill.description.length > 0));
  assert.ok(listed.every((skill) => skill.content === undefined));
  const definition = await provider.get({ name: "knowledge-search" });
  assert.equal(definition.name, "knowledge-search");
  assert.match(definition.content, /知识检索/);
  assert.equal(await provider.get({ name: "missing-skill" }), undefined);
});

test("loadSkillsFrom skips missing or unreadable SKILL.md files with warnings (F1)", async () => {
  const root = await makeRoot();
  const capture = captureWarn();
  try {
    await writeSkill(root, "valid-one", VALID_SKILL);
    await mkdir(join(root, "no-skill-md"), { recursive: true });
    // A directory where SKILL.md is expected makes readFile fail with EISDIR.
    await mkdir(join(root, "dir-skill", "SKILL.md"), { recursive: true });
    const skills = await loadSkillsFrom(root);
    assert.deepEqual(skills.map((skill) => skill.name), ["valid-one"]);
    assert.equal(capture.warnings.length, 2);
    assert.ok(capture.warnings.every((warning) => /skipping skill/.test(warning)));
  } finally {
    capture.restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("loadSkillsFrom skips malformed skills but keeps valid ones (F2)", async () => {
  const root = await makeRoot();
  const capture = captureWarn();
  try {
    await writeSkill(root, "valid-one", VALID_SKILL);
    await writeSkill(root, "bad-frontmatter", "no frontmatter here\n");
    await writeSkill(root, "bad-name", "---\nname: Bad_Name\ndescription: x\n---\nbody\n");
    await writeSkill(root, "missing-desc", "---\nname: missing-desc\n---\nbody\n");
    const skills = await loadSkillsFrom(root);
    assert.deepEqual(skills.map((skill) => skill.name), ["valid-one"]);
    assert.equal(capture.warnings.length, 3);
  } finally {
    capture.restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("loadSkillsFrom throws on duplicate skill names with both paths (F3)", async () => {
  const root = await makeRoot();
  try {
    await writeSkill(root, "a-dir", VALID_SKILL);
    await writeSkill(root, "b-dir", VALID_SKILL);
    await assert.rejects(() => loadSkillsFrom(root), (err) => {
      assert.match(err.message, /duplicate skill name "valid-one"/);
      assert.ok(err.message.includes(join(root, "a-dir", "SKILL.md")));
      assert.ok(err.message.includes(join(root, "b-dir", "SKILL.md")));
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadSkillsFrom rethrows unexpected read errors", async () => {
  const root = await makeRoot();
  try {
    const notDirectory = join(root, "not-a-directory");
    await writeFile(notDirectory, "x", "utf8");
    await assert.rejects(() => loadSkillsFrom(notDirectory), (err) => err.code === "ENOTDIR");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadSkillsCached returns the same cached arrays across calls (F5)", async () => {
  const root = await makeRoot();
  try {
    await writeSkill(root, "valid-one", VALID_SKILL);
    const first = await loadSkillsCached(root);
    const second = await loadSkillsCached(root);
    // Without the memoized promise these are two distinct arrays.
    assert.equal(first, second);
    const providers = [];
    apply({ skills: { registerProvider: (factory) => providers.push(factory) } });
    const provider = providers[0]();
    const listedOnce = await provider.list();
    const listedTwice = await provider.list();
    assert.equal(listedOnce, listedTwice);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadSkillsCached retries after a failed load (F5)", async () => {
  const root = await makeRoot();
  try {
    await writeSkill(root, "a-dir", VALID_SKILL);
    await writeSkill(root, "b-dir", VALID_SKILL);
    await assert.rejects(() => loadSkillsCached(root), /duplicate skill name "valid-one"/);
    // A cached rejected promise would keep failing after the conflict is fixed.
    await rm(join(root, "b-dir"), { recursive: true, force: true });
    const skills = await loadSkillsCached(root);
    assert.deepEqual(skills.map((skill) => skill.name), ["valid-one"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
