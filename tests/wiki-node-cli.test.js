// Regression tests for the wiki-node CLI (G14/G16/G17/G18) and for the
// ingest CLI confirmation gate (G3). The CLI scripts export their helpers and
// guard their main flow, so the behaviors are tested with fake adapters and
// fake stdin/stdout: no Obsidian instance, no network, no vault access.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ObsidianError } from "../src/obsidian/obsidian-adapter.js";
import { extractSourceFile, listDir, readNode, randomNode, showNode } from "../scripts/wiki-node-cli.mjs";
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
