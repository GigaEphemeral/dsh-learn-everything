// Unit tests for skill catalog loading and the registered provider: skip
// malformed skills, detect duplicate names, and expose the packaged skills.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { apply, DEFAULT_GRILL_PERSONA, loadSkillsCached, loadSkillsFrom, name as pluginName } from "../index.js";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGED_SKILLS = ["obs-access", "obs-daily-practice", "obs-grill-me", "obs-knowledge-search", "obs-remember-knowledge"];

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

test("provider renders the configured grill persona into obs-grill-me per call", async () => {
  const prev = process.env.OBSIDIAN_GRILL_PERSONA;
  delete process.env.OBSIDIAN_GRILL_PERSONA;
  try {
    const providers = [];
    apply({ skills: { registerProvider: (factory) => providers.push(factory) } });
    const provider = providers[0]();
    const withDefault = await provider.get({ name: "obs-grill-me" });
    assert.equal(withDefault.name, "obs-grill-me");
    // The model must never see the raw placeholder, and the shipped persona
    // must be rendered in its place.
    assert.ok(!withDefault.content.includes("{{persona}}"), "the persona placeholder must be substituted");
    assert.ok(withDefault.content.includes(DEFAULT_GRILL_PERSONA), "the built-in persona must be rendered");
    assert.match(withDefault.content, /## 教学人格/);

    // Volatile references are re-read on every get(): the settings form can
    // change the persona without remounting the plugin, so a snapshot taken
    // at provider creation would serve a stale persona.
    let persona = "FIRST-PERSONA";
    const config = { grillPersona: { get: () => persona } };
    const customProviders = [];
    apply({ skills: { registerProvider: (factory) => customProviders.push(factory) } }, config);
    const customProvider = customProviders[0]();
    const first = await customProvider.get({ name: "obs-grill-me" });
    assert.match(first.content, /FIRST-PERSONA/);
    persona = "SECOND-PERSONA";
    const second = await customProvider.get({ name: "obs-grill-me" });
    assert.match(second.content, /SECOND-PERSONA/, "a volatile persona change must apply to the next get()");
    assert.doesNotMatch(second.content, /FIRST-PERSONA/);

    // Direct callers pass a plain string instead of a volatile reference.
    const plainProviders = [];
    apply({ skills: { registerProvider: (factory) => plainProviders.push(factory) } }, { grillPersona: "PLAIN-PERSONA" });
    const plain = await plainProviders[0]().get({ name: "obs-grill-me" });
    assert.match(plain.content, /PLAIN-PERSONA/);
    assert.ok(!plain.content.includes(DEFAULT_GRILL_PERSONA));

    // Persona rendering is scoped to obs-grill-me; other skills stay as shipped.
    const daily = await provider.get({ name: "obs-daily-practice" });
    assert.ok(!daily.content.includes(DEFAULT_GRILL_PERSONA));
    assert.ok(!daily.content.includes("{{persona}}"));
  } finally {
    if (prev === undefined) delete process.env.OBSIDIAN_GRILL_PERSONA;
    else process.env.OBSIDIAN_GRILL_PERSONA = prev;
  }
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
    "practice_grill_gate",
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
  assert.match(bodies["obs-grill-me"], /## 教学人格/, "grill-me must define its persona section");
  assert.match(bodies["obs-grill-me"], /\{\{persona\}\}/, "grill-me must keep the persona placeholder for the plugin to render");
  assert.match(bodies["obs-grill-me"], /ask_user_question/, "grill-me must ask one question per turn with the native question tool");
  assert.match(bodies["obs-grill-me"], /practice_grill_gate/, "grill-me must name the native gate tool");
  assert.match(bodies["obs-grill-me"], /2-4\s*个具体/, "grill-me must offer concrete options, not plain-text questions");
  assert.match(bodies["obs-grill-me"], /不超过\s*8\s*轮/, "grill-me must bound the number of rounds");
  assert.doesNotMatch(bodies["obs-grill-me"], /obs_ingest|obs_compile/, "grill-me must not write to the vault");
});

test("obs-daily-practice mandates the grill gate below 6/10", async () => {
  const text = await readFile(join(PLUGIN_ROOT, "skills", "obs-daily-practice", "SKILL.md"), "utf8");
  // Below six the lightweight local follow-up is no longer acceptable: the
  // skill must route through the gate and then load the packaged grill skill.
  assert.match(text, /首次评分低于\s*6[^。\n]*必须调用\s*`practice_grill_gate`/);
  assert.match(text, /required=true[^。\n]*必须加载并执行\s*`obs-grill-me`/);
  assert.match(text, /不是可选项/);
  assert.doesNotMatch(text, /仅用户主动要求/, "grill-me must stop being optional");
});

test("obs-grill-me frontmatter describes the high-pressure grill trigger", async () => {
  const text = await readFile(join(PLUGIN_ROOT, "skills", "obs-grill-me", "SKILL.md"), "utf8");
  const frontmatter = text.split("---")[1];
  assert.match(frontmatter, /name: obs-grill-me/);
  assert.match(frontmatter, /description:/);
  assert.match(frontmatter, /苏格拉底/);
  assert.match(frontmatter, /每轮只问一个关键问题/);
  assert.match(frontmatter, /grill me/);
  assert.match(frontmatter, /低于\s*6/);
  assert.match(frontmatter, /挑战/);
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
