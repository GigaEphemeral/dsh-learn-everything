// Unit tests for skill catalog loading and the registered provider: skip
// malformed skills, detect duplicate names, and expose the packaged skills.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { apply, loadSkillsCached, loadSkillsFrom, name as pluginName } from "../index.js";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGED_SKILLS = ["obs-access", "obs-daily-practice", "obs-knowledge-search", "obs-remember-knowledge"];

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
  assert.deepEqual(listed.map((skill) => skill.name), PACKAGED_SKILLS);
  assert.ok(listed.every((skill) => typeof skill.description === "string" && skill.description.length > 0));
  assert.ok(listed.every((skill) => skill.content === undefined));
  const definition = await provider.get({ name: "obs-knowledge-search" });
  assert.equal(definition.name, "obs-knowledge-search");
  assert.match(definition.content, /知识检索/);
  // Skills resolve their relative paths against the plugin package root, not
  // their own folder: the host turns this path into the resource hint the model
  // reads, and a per-skill hint sends agents hunting a repository checkout.
  assert.deepEqual(definition.resourceBase, { kind: "directory", path: PLUGIN_ROOT });
  assert.equal(await provider.get({ name: "missing-skill" }), undefined);
});

test("apply registers every native tool when the host exposes tools", async () => {
  const providers = [];
  const registered = [];
  apply({
    skills: { registerProvider: (factory) => providers.push(factory) },
    tools: { register: (tool) => { registered.push(tool); return () => {}; } },
  });
  assert.deepEqual(registered.map((tool) => tool.name), [
    "practice_draw_node", "practice_record_question", "practice_record_answer", "practice_status",
    "obs_ingest", "obs_vault", "obs_compile",
  ]);
  for (const tool of registered) {
    assert.equal(typeof tool.output.render, "function", `${tool.name} must render its value`);
    assert.equal(typeof tool.execute, "function", `${tool.name} must execute host-side`);
    assert.equal(tool.parameters.type, "object", `${tool.name} exposes a JSON-Schema object`);
  }
});

test("packaged skills use native tools instead of shell commands", async () => {
  const bodies = Object.fromEntries(await Promise.all(PACKAGED_SKILLS.map(async (name) => [
    name, await readFile(join(PLUGIN_ROOT, "skills", name, "SKILL.md"), "utf8"),
  ])));
  for (const [name, raw] of Object.entries(bodies)) {
    // A shell command in a skill is what broke on Windows (wrong drive path,
    // missing .env). The skills must name tools only.
    assert.doesNotMatch(raw, /node\s+scripts\//, `${name} must not run CLI scripts`);
    assert.doesNotMatch(raw, /--env-file/, `${name} must not depend on an .env file`);
    assert.doesNotMatch(raw, /\bcd\s+["']?[A-Za-z]:?[\\/]/, `${name} must not cd into an OS-specific path`);
    assert.doesNotMatch(raw, /\bcode\//, `${name} must not reference checkout-internal paths`);
  }
  assert.match(bodies["obs-remember-knowledge"], /obs_ingest/, "ingest must use the native ingest tool");
  assert.match(bodies["obs-remember-knowledge"], /obs_compile/, "ingest must name the native compile tool");
  assert.match(bodies["obs-knowledge-search"], /obs_vault/, "search must use the native vault tool");
  assert.match(bodies["obs-access"], /obs_compile/, "access must use the native compile tool");
  assert.match(bodies["obs-daily-practice"], /practice_draw_node/, "daily-practice must use the native draw tool");
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
