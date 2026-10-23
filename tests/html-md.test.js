// Unit tests for deterministic HTML -> Markdown extraction (S3, T1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown, HtmlMdError } from "../src/ingest/html-md.js";

test("converts headings and inline emphasis", () => {
  const { markdown } = htmlToMarkdown("<html><body><h1>Title</h1><p>Hello <strong>world</strong> and <em>you</em></p></body></html>");
  assert.match(markdown, /^# Title/m);
  assert.ok(markdown.includes("**world**"));
  assert.ok(markdown.includes("*you*"));
});

test("strips script/style/nav and extracts the title", () => {
  const { title, markdown } = htmlToMarkdown("<html><head><title>Page T</title></head><body><nav>menu</nav><script>var x=1</script><style>p{}</style><p>body text</p></body></html>");
  assert.equal(title, "Page T");
  assert.ok(!markdown.includes("menu"));
  assert.ok(!markdown.includes("var x"));
  assert.ok(markdown.includes("body text"));
});

test("makes relative links absolute with baseUrl", () => {
  const { markdown } = htmlToMarkdown("<body><a href='/a/b'>link</a></body>", { baseUrl: "https://example.com/x/y.html" });
  assert.ok(markdown.includes("[link](https://example.com/a/b)"));
});

test("renders nested lists and fenced code blocks", () => {
  const { markdown } = htmlToMarkdown("<body><ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><pre><code>const x = 1;</code></pre></body>");
  assert.ok(markdown.includes("- a"));
  assert.ok(markdown.includes("- b"));
  assert.ok(markdown.includes("- c"));
  assert.match(markdown, /```[\s\S]*const x = 1;/);
});

test("renders blockquote and pipe table", () => {
  const { markdown } = htmlToMarkdown("<body><blockquote>quote text</blockquote><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></body>");
  assert.ok(markdown.includes("> quote text"));
  assert.ok(markdown.includes("A | B"));
  assert.ok(markdown.includes("1 | 2"));
});

test("truncates over maxLength", () => {
  const { markdown } = htmlToMarkdown("<p>" + "x".repeat(100) + "</p>", { maxLength: 50 });
  assert.ok(markdown.endsWith("<!-- truncated -->"));
});

test("throws on non-string input", () => {
  assert.throws(() => htmlToMarkdown(null), HtmlMdError);
});

test("preserves preformatted line breaks and indentation", () => {
  const { markdown } = htmlToMarkdown("<body><pre><code>line1\n    line2\nline3</code></pre></body>");
  assert.ok(markdown.includes("line1\n    line2\nline3"), "code block must keep its layout");
  assert.ok(!markdown.includes("line1     line2"), "whitespace must not be collapsed");
});

test("nested list items are not duplicated into the parent bullet", () => {
  const { markdown } = htmlToMarkdown("<body><ul><li>b<ul><li>c</li></ul></li></ul></body>");
  assert.ok(markdown.includes("- b"));
  assert.ok(markdown.includes("  - c"));
  assert.ok(!markdown.includes("- bc"), "the child item must not be inlined into the parent");
});

test("drops javascript:/data: link targets but keeps safe schemes", () => {
  const { markdown } = htmlToMarkdown(
    '<body><a href="javascript:alert(1)">x</a><img src="data:image/png;base64,AAA"><a href="mailto:a@b">m</a></body>',
    { baseUrl: "https://example.com/" },
  );
  assert.ok(!markdown.includes("javascript:"), "javascript: URLs must not reach the note");
  assert.ok(!markdown.includes("data:"), "data: images must not reach the note");
  assert.ok(!markdown.includes("[x]("), "the unsafe link must lose its target");
  assert.ok(markdown.includes("[m](mailto:a@b)"), "mailto remains allowed");
});

test("renders blockquote children as separate quoted lines", () => {
  const { markdown } = htmlToMarkdown("<body><blockquote><p>a</p><p>b</p></blockquote></body>");
  assert.ok(markdown.includes("> a"));
  assert.ok(markdown.includes("> b"));
  assert.ok(!markdown.includes("> ab"), "paragraphs must not be concatenated");
});

test("keeps spaces inside inline code", () => {
  const { markdown } = htmlToMarkdown("<body><p>use <code>a  b</code> now</p></body>");
  assert.ok(markdown.includes("`a  b`"));
});
