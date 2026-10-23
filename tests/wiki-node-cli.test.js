// Regression tests for the wiki-node CLI (G14/G16/G17/G18), for the P2 CLI
// hardening wave (G15 parallel listing, G19 overridable vault layout, G20 shared
// random/show pipeline) and for the ingest CLI confirmation gate (G3). The CLI
// scripts export their helpers and guard their main flow, so the behaviors are
// tested with fake adapters and fake stdin/stdout: no Obsidian instance, no
// network, no vault access.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ObsidianError } from "../src/obsidian/obsidian-adapter.js";
import {
  DEFAULT_WIKI_DIRS,
  WIKI_DIRS,
  collectNodes,
  extractSourceFile,
  extractSourceLinks,
  listDir,
  parseWikiDirs,
  readNode,
  randomNode,
  showNode,
  contextNode,
} from "../scripts/wiki-node-cli.mjs";
import { createConfirm } from "../scripts/ingest-cli.mjs";

const CODE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI_CLI = join(CODE_DIR, "scripts", "wiki-node-cli.mjs");

function notFound() {
  return new ObsidianError("not found", { status: 404 });
}

function fakeStdout() {
  return {
    text: "",
    write(chunk) {
      this.text += chunk;
    },
  };
}

test("extractSourceFile handles quoted, aliased and commented source_file lines", () => {
  const cases = [
    ['---\nsource_file: "[[Sources/foo.md]]"\n---\nbody', "Sources/foo.md"],
    ["---\nsource_file: '[[Sources/bar.md|Bar Alias]]'\n---\nbody", "Sources/bar.md"],
    ["---\nsource_file: [[Sources/baz.md]] # origin\n---", "Sources/baz.md"],
    ['source_file: "[[Sources/with space.md|Alias]]"', "Sources/with space.md"],
    ['source_file: "Sources/plain.md"', null],
    ["---\ntitle: no source link\n---\nbody", null],
    ["source_file: [[ ]]", null],
  ];
  for (const [content, expected] of cases) {
    assert.equal(extractSourceFile(content), expected, JSON.stringify(content));
  }
  // A non-string body must not crash the parser.
  assert.equal(extractSourceFile(undefined), null);
  assert.equal(extractSourceFile(null), null);
});

test("listDir treats only a 404 as an empty directory", async () => {
  const missing = {
    list: async () => {
      throw notFound();
    },
  };
  assert.deepEqual(await listDir(missing, "wiki/concepts"), []);

  const empty = { list: async () => ({}) };
  assert.deepEqual(await listDir(empty, "wiki/entities"), []);

  const unauthorized = {
    list: async () => {
      throw new ObsidianError("unauthorized", { status: 401 });
    },
  };
  await assert.rejects(
    () => listDir(unauthorized, "wiki/concepts"),
    (err) => {
      assert.match(err.message, /failed to list "wiki\/concepts"/);
      assert.match(err.message, /unauthorized/);
      assert.equal(err.cause.status, 401);
      return true;
    },
  );
});

test("parseWikiDirs normalises the override and falls back to the default layout", () => {
  assert.deepEqual(DEFAULT_WIKI_DIRS, ["wiki/concepts", "wiki/entities", "wiki/sources"]);
  // No override (undefined/non-string/blank) means the compiled wiki layout.
  assert.deepEqual(parseWikiDirs(undefined), DEFAULT_WIKI_DIRS);
  assert.deepEqual(parseWikiDirs("   "), DEFAULT_WIKI_DIRS);
  assert.deepEqual(parseWikiDirs(" , ,"), DEFAULT_WIKI_DIRS);
  // Entries are trimmed, blanks dropped and duplicates collapsed in first-seen order.
  assert.deepEqual(parseWikiDirs(" wiki/a , wiki/b , wiki/a "), ["wiki/a", "wiki/b"]);
  assert.deepEqual(parseWikiDirs(WIKI_DIRS.join(",")), WIKI_DIRS);
});

test("OBSIDIAN_WIKI_DIRS overrides the exported WIKI_DIRS layout", () => {
  const moduleUrl = new URL("../scripts/wiki-node-cli.mjs", import.meta.url).href;
  const script = `import(${JSON.stringify(moduleUrl)}).then((m) => process.stdout.write(JSON.stringify(m.WIKI_DIRS)))`;
  const baseEnv = { ...process.env };
  delete baseEnv.OBSIDIAN_WIKI_DIRS;
  const run = (env) =>
    spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: CODE_DIR, encoding: "utf8", env });

  const defaults = run(baseEnv);
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.deepEqual(JSON.parse(defaults.stdout), DEFAULT_WIKI_DIRS);

  const custom = run({ ...baseEnv, OBSIDIAN_WIKI_DIRS: "wiki/notes, wiki/index" });
  assert.equal(custom.status, 0, custom.stderr);
  assert.deepEqual(JSON.parse(custom.stdout), ["wiki/notes", "wiki/index"]);
});

test("collectNodes lists the wiki dirs in parallel and keeps WIKI_DIRS order", { timeout: 5000 }, async () => {
  const started = [];
  let markAllStarted;
  const allStarted = new Promise((resolveAll) => {
    markAllStarted = resolveAll;
  });
  // A serial implementation cannot start dir N+1 until dir N resolves, so it
  // never reaches allStarted and fails with this explicit error instead of
  // hanging the suite.
  let serialTimer;
  const serialListing = new Promise((_, reject) => {
    serialTimer = setTimeout(
      () => reject(new Error("listDir calls are serial: the next dir only started after the previous resolved")),
      250,
    );
  });
  const adapter = {
    list: (dir) =>
      new Promise((resolveList, rejectList) => {
        started.push(dir);
        if (started.length === WIKI_DIRS.length) markAllStarted();
        Promise.race([allStarted, serialListing]).then(() => {
          // Resolve in reverse declaration order: the flatten must not depend on
          // which request finishes first.
          const index = WIKI_DIRS.indexOf(dir);
          setTimeout(() => resolveList({ files: [`${index}.md`] }), (WIKI_DIRS.length - index) * 10);
        }, rejectList);
      }),
  };

  const nodes = await collectNodes(adapter);
  clearTimeout(serialTimer);
  assert.deepEqual(started, WIKI_DIRS, "every wiki dir must be listed before any listing resolves");
  assert.deepEqual(
    nodes.map((node) => node.path),
    WIKI_DIRS.map((dir, index) => `${dir}/${index}.md`),
    "nodes must be flattened in WIKI_DIRS order, not completion order",
  );
});

test("readNode rejects missing bodies and wraps read errors", async () => {
  const noBody = { read: async () => undefined };
  await assert.rejects(
    () => readNode(noBody, "wiki/concepts/x.md"),
    /unexpected response for "wiki\/concepts\/x.md".*expected Markdown text/,
  );

  const failing = {
    read: async () => {
      throw new ObsidianError("server exploded", { status: 500 });
    },
  };
  await assert.rejects(
    () => readNode(failing, "wiki/concepts/x.md"),
    (err) => {
      assert.match(err.message, /failed to read "wiki\/concepts\/x.md"/);
      assert.match(err.message, /server exploded/);
      assert.equal(err.cause.status, 500);
      return true;
    },
  );
});

test("randomNode reports truncation and extracts an aliased source link", async () => {
  const longBody = `---\nsource_file: '[[Sources/long.md|Alias]]'\n---\n${"x".repeat(2500)}`;
  const adapter = {
    list: async (dir) => {
      if (dir === "wiki/concepts") return { files: ["node.md"] };
      throw notFound();
    },
    read: async () => longBody,
  };
  const node = await randomNode(adapter);
  assert.equal(node.keyword, "node");
  assert.equal(node.type, "concepts");
  assert.equal(node.path, "wiki/concepts/node.md");
  assert.equal(node.sourceFile, "Sources/long.md");
  assert.equal(node.content.length, 2000);
  assert.equal(node.truncated, true);

  const shortBody = "short body";
  const shortAdapter = { ...adapter, read: async () => shortBody };
  const shortNode = await randomNode(shortAdapter);
  assert.equal(shortNode.content, shortBody);
  assert.equal(shortNode.truncated, false);
  assert.equal(shortNode.sourceFile, null);
});

test("randomNode and showNode surface empty wiki / missing nodes instead of empty data", async () => {
  const empty = {
    list: async () => {
      throw notFound();
    },
  };
  await assert.rejects(() => randomNode(empty), /wiki is empty/);
  await assert.rejects(() => showNode(empty, "Anything"), /node "Anything" not found/);

  const found = {
    list: async (dir) => (dir === "wiki/sources" ? { files: ["Foo.md"] } : { files: [] }),
    read: async () => "body",
  };
  const node = await showNode(found, "Foo");
  assert.equal(node.path, "wiki/sources/Foo.md");
  assert.equal(node.content, "body");
  await assert.rejects(() => showNode(found, "Bar"), /node "Bar" not found/);
});

test("showNode reuses randomNode's shape: source file, truncation signal and echoed keyword", async () => {
  const longBody = `---\nsource_file: "[[Sources/foo.md]]"\n---\n${"y".repeat(2500)}`;
  const adapter = {
    list: async (dir) => ({ files: dir === "wiki/sources" ? ["Foo.md"] : [] }),
    read: async () => longBody,
  };
  const node = await showNode(adapter, "Foo");
  assert.equal(node.keyword, "Foo", "show must echo the requested name as keyword");
  assert.equal(node.type, "sources");
  assert.equal(node.path, "wiki/sources/Foo.md");
  assert.equal(node.sourceFile, "Sources/foo.md", "show must report the source note like random");
  assert.equal(node.content.length, 2000);
  assert.equal(node.truncated, true, "show must signal a partial page like random");
});

function startConfirm(options) {
  const stdin = new PassThrough();
  const stdout = fakeStdout();
  const confirm = createConfirm({ stdin, stdout, ...options });
  return { stdin, stdout, confirm };
}

test("ingest confirm answers yes/no from stdin and cleans up the listener", { timeout: 5000 }, async () => {
  const cases = [
    ["y\n", true],
    ["YES\n", true],
    ["n\n", false],
    ["whatever\n", false],
  ];
  for (const [input, expected] of cases) {
    const { stdin, stdout, confirm } = startConfirm();
    const answer = confirm("ingest?");
    stdin.write(input);
    assert.equal(await answer, expected, `input ${JSON.stringify(input)}`);
    assert.match(stdout.text, /\[y\/N\]/);
    assert.equal(stdin.listenerCount("data"), 0, "the data listener must be removed after settle");
    assert.equal(stdin.listenerCount("end"), 0);
    assert.equal(stdin.listenerCount("close"), 0);
    assert.equal(stdin.isPaused(), true, "stdin must be paused after settle");
  }
});

test("ingest confirm denies by default on stdin end/close", { timeout: 5000 }, async () => {
  const ended = startConfirm();
  const eofAnswer = ended.confirm("ingest?");
  ended.stdin.end();
  assert.equal(await eofAnswer, false, "EOF without an answer must deny");
  assert.equal(ended.stdin.isPaused(), true);

  const destroyed = startConfirm();
  const closeAnswer = destroyed.confirm("ingest?");
  destroyed.stdin.destroy();
  assert.equal(await closeAnswer, false, "a closed stdin must deny");
});

test("ingest confirm denies immediately when stdin is already ended", { timeout: 5000 }, async () => {
  const stdin = new PassThrough();
  stdin.end();
  await new Promise((resolveDone) => setImmediate(resolveDone));
  const stdout = fakeStdout();
  const confirm = createConfirm({ stdin, stdout });
  assert.equal(await confirm("ingest?"), false);
});

test("ingest confirm --auto-yes answers without subscribing to stdin", { timeout: 5000 }, async () => {
  const stdin = {
    on() {
      assert.fail("--auto-yes must not subscribe to stdin");
    },
    once() {
      assert.fail("--auto-yes must not subscribe to stdin");
    },
  };
  const stdout = fakeStdout();
  const confirm = createConfirm({ stdin, stdout, autoYes: true });
  assert.equal(await confirm("ingest?"), true);
  assert.match(stdout.text, /\[confirm auto-yes\] ingest\?/);
});

test("wiki-node-cli exits non-zero with usage when credentials are missing", () => {
  const env = { ...process.env };
  delete env.OBSIDIAN_API_KEY;
  const result = spawnSync(process.execPath, [WIKI_CLI, "random"], {
    cwd: CODE_DIR,
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /usage: OBSIDIAN_API_KEY/);
});

test("wiki-node-cli rejects an unknown mode without attempting a request", () => {
  const result = spawnSync(process.execPath, [WIKI_CLI, "bogus"], {
    cwd: CODE_DIR,
    encoding: "utf8",
    env: { ...process.env, OBSIDIAN_API_KEY: "test-key" },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /unknown mode/);
});

test("extractSourceLinks parses a sources: frontmatter list", () => {
  const content = [
    "---",
    "type: concept",
    "sources:",
    '  - "[[sources/foo_1a2b3c]]"',
    '  - "[[Sources/bar.md|Bar]]"',
    "generation_complete: true",
    "---",
    "# body",
  ].join("\n");
  assert.deepEqual(extractSourceLinks(content), ["sources/foo_1a2b3c", "Sources/bar.md"]);
});

test("extractSourceFile falls back to the sources: list when source_file is absent", () => {
  const content = [
    "---",
    "type: concept",
    "sources:",
    '  - "[[sources/foo_1a2b3c]]"',
    "---",
    "# body",
  ].join("\n");
  assert.equal(extractSourceFile(content), "sources/foo_1a2b3c");
  // source_file wins over the list when both exist.
  const both = content.replace("type: concept", 'type: concept\nsource_file: "[[Sources/original.md]]"');
  assert.equal(extractSourceFile(both), "Sources/original.md");
  // No source_file and no sources: list -> null.
  assert.equal(extractSourceFile("---\ntype: concept\n---\nbody"), null);
});

test("extractSourceLinks stops at the frontmatter end and strips heading/block anchors", () => {
  const content = [
    "---",
    "type: concept",
    "sources:",
    '  - "[[Sources/foo.md#Notes]]"',
    '  - "[[Sources/bar.md#^blk|Bar]]"',
    "---",
    "# body",
    "- [[Sources/not-a-source.md]]",
  ].join("\n");
  assert.deepEqual(extractSourceLinks(content), ["Sources/foo.md", "Sources/bar.md"]);
  // A body bullet list after frontmatter must not become a source.
  assert.deepEqual(extractSourceLinks("---\nsources:\n---\n- [[Body/x.md]]"), []);
  // source_file carries the same anchor stripping.
  assert.equal(extractSourceFile('---\nsource_file: "[[Sources/a.md#Heading]]"\n---\nbody'), "Sources/a.md");
});

test("context derives the learning key from the node, degrades when learning state is unreadable", async () => {
  const adapter = {
    list: async (dir) => ({ files: dir === "wiki/sources" ? ["Foo.md"] : [] }),
    read: async () => "---\nsource_file: \"[[Sources/foo.md]]\"\nsources:\n  - \"[[Sources/foo.md]]\"\n---\nbody",
  };
  // A directory at the configured learning-DB path makes LearningDb throw; the
  // node + sources payload must still be returned.
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "wiki-learn-"));
  const previous = process.env.OBSIDIAN_LEARNING_DB;
  process.env.OBSIDIAN_LEARNING_DB = dir;
  try {
    const node = await contextNode(adapter, "Foo.md");
    // The CLI argument was a filename; the summary key must be the file stem.
    assert.equal(node.keyword, "Foo");
    assert.equal(node.type, "sources");
    assert.equal(node.sourceFile, "Sources/foo.md");
    assert.deepEqual(node.sources, ["Sources/foo.md"]);
    assert.ok(node.learning && typeof node.learning.error === "string", "learning failure must degrade, not abort");
  } finally {
    if (previous === undefined) delete process.env.OBSIDIAN_LEARNING_DB;
    else process.env.OBSIDIAN_LEARNING_DB = previous;
    await rm(dir, { recursive: true, force: true });
  }

  // context random on an empty wiki uses the explicit empty-wiki message.
  const empty = { list: async () => { throw notFound(); } };
  await assert.rejects(() => contextNode(empty, "random"), /wiki is empty/);
});

test("randomNode/showNode forward the parsed sources list", async () => {
  const body = "---\nsources:\n  - \"[[Sources/a.md]]\"\n  - \"[[Sources/b.md#H|B]]\"\n---\nbody";
  const adapter = {
    list: async (dir) => ({ files: dir === "wiki/concepts" ? ["n.md"] : [] }),
    read: async () => body,
  };
  const node = await randomNode(adapter);
  assert.deepEqual(node.sources, ["Sources/a.md", "Sources/b.md"]);
  const shown = await showNode(adapter, "n");
  assert.deepEqual(shown.sources, ["Sources/a.md", "Sources/b.md"]);
});
