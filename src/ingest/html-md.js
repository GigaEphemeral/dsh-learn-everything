// Deterministic HTML -> Markdown extraction (S3, T1).
// fetchUrl returns cleaned Markdown for HTML responses so the ingest skill
// only confirms and writes; the LLM never hand-writes converters.
// Built on cheerio (battle-tested HTML parsing).

import { load } from "cheerio";

export class HtmlMdError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "HtmlMdError";
    this.code = code;
  }
}

const NOISE = "script,style,noscript,template,iframe,form,svg,nav,button,input,select,textarea,canvas,aside";

const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function hasScheme(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

// Resolve a link/image target and drop dangerous schemes. Untrusted HTML must
// not be able to write javascript:/data: links into the Markdown note (which
// Obsidian would then render).
function absolutize(url, baseUrl) {
  if (!url) return null;
  if (baseUrl) {
    try {
      const parsed = new URL(url, baseUrl);
      return ALLOWED_SCHEMES.has(parsed.protocol) ? parsed.href : null;
    } catch {
      return null;
    }
  }
  // Without a base URL, only a scheme-less relative path is kept as-is; an
  // absolute URL must still pass the allowlist.
  if (!hasScheme(url)) return url;
  try {
    const parsed = new URL(url);
    return ALLOWED_SCHEMES.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function textOnly($, el) { return (el.text() || "").replace(/\s+/g, " ").trim(); }

// Recursively render inline-level content (text/strong/em/a/code/img/br).
function inline($, el, baseUrl) {
  const parts = [];
  el.contents().each((_, node) => {
    if (node.type === "text") {
      parts.push((node.data || "").replace(/\s+/g, " "));
      return;
    }
    const n = $(node);
    const tag = (node.tagName || "").toLowerCase();
    switch (tag) {
      case "strong": case "b": parts.push("**" + inline($, n, baseUrl) + "**"); break;
      case "em": case "i": parts.push("*" + inline($, n, baseUrl) + "*"); break;
      // Preserve spaces inside inline code; textOnly() would collapse them.
      case "code": parts.push("`" + n.text().trim() + "`"); break;
      case "a": {
        const href = absolutize(n.attr("href"), baseUrl);
        const t = inline($, n, baseUrl);
        parts.push(href && t ? `[${t}](${href})` : (t || href || ""));
        break;
      }
      case "img": {
        const src = absolutize(n.attr("src"), baseUrl);
        const alt = n.attr("alt") || "";
        parts.push(src ? `![${alt}](${src})` : (alt || ""));
        break;
      }
      case "br": parts.push("\n"); break;
      default: parts.push(inline($, n, baseUrl));
    }
  });
  // Text nodes are already whitespace-collapsed individually; do not collapse
  // the joined result or line breaks from <br> and spaces inside <code> vanish.
  return parts.join("").trim();
}

function renderList($, el, marker, depth, baseUrl) {
  const pad = "  ".repeat(depth);
  const lines = [];
  let index = 1;
  $(el).children("li").each((_, li) => {
    const $li = $(li);
    const prefix = marker === "1" ? `${pad}${index}. ` : `${pad}- `;
    // Inline the item's own content only: nested lists are rendered separately
    // below, and recursing into them here would duplicate their items.
    const $item = $li.clone();
    $item.children("ul,ol").remove();
    lines.push(prefix + inline($, $item, baseUrl));
    index += 1;
    $li.children("ul,ol").each((_, ul) => {
      const m = $(ul).prop("tagName").toLowerCase() === "ol" ? "1" : "-";
      lines.push(renderList($, $(ul), m, depth + 1, baseUrl));
    });
  });
  return lines.join("\n");
}

function renderTable($, el) {
  const rows = [];
  $(el).find("tr").each((_, tr) => {
    const cells = [];
    $(tr).children("th,td").each((_, c) => cells.push(textOnly($, $(c)).replace(/\|/g, "\\|")));
    if (cells.length) rows.push(cells);
  });
  if (!rows.length) return "";
  const out = [rows[0].join(" | ")];
  out.push(rows[0].map(() => "---").join(" | "));
  for (const r of rows.slice(1)) out.push(r.join(" | "));
  return "\n" + out.join("\n") + "\n";
}

function render($, el, depth, baseUrl) {
  const tag = (el.prop("tagName") || "").toLowerCase();
  if (!tag) return inline($, el, baseUrl);
  switch (tag) {
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
      return "\n" + "#".repeat(Number(tag[1])) + " " + inline($, el, baseUrl) + "\n";
    case "p": return inline($, el, baseUrl) + "\n\n";
    case "br": return "\n";
    case "hr": return "\n---\n";
    case "blockquote": {
      // Render children as blocks so paragraphs/lists keep their structure, then
      // prefix every produced line. Inlining here concatenated paragraphs.
      const inner = [];
      $(el).children().each((_, child) => {
        const rendered = render($, $(child), depth, baseUrl);
        if (rendered && rendered.trim()) inner.push(rendered.trim());
      });
      const body = inner.length > 0 ? inner.join("\n") : inline($, el, baseUrl);
      return body.split("\n").map((line) => (line === "" ? ">" : "> " + line)).join("\n") + "\n\n";
    }
    // Preserve preformatted content: el.text() keeps line breaks/indentation,
    // while textOnly() flattened code blocks into a single line.
    case "pre": {
      const code = (el.text() || "").replace(/^\n+/, "").replace(/\n+$/, "");
      return "\n```\n" + code + "\n```\n";
    }
    case "code": return "`" + (el.text() || "") + "`";
    case "strong": case "b": return "**" + inline($, el, baseUrl) + "**";
    case "em": case "i": return "*" + inline($, el, baseUrl) + "*";
    case "a": {
      const href = absolutize(el.attr("href"), baseUrl);
      const t = inline($, el, baseUrl);
      return href && t ? "[" + t + "](" + href + ")" : (t || href || "");
    }
    case "img": {
      const src = absolutize(el.attr("src"), baseUrl);
      const alt = el.attr("alt") || "";
      return src ? "![" + alt + "](" + src + ")" : (alt || "");
    }
    case "ul": return renderList($, el, "-", depth, baseUrl);
    case "ol": return renderList($, el, "1", depth, baseUrl);
    case "table": return renderTable($, el);
    default: {
      const parts = [];
      $(el).children().each((_, ch) => {
        const r = render($, $(ch), depth, baseUrl);
        if (r && r.trim()) parts.push(r);
      });
      if (!parts.length) {
        // Compute the inline fallback once; it is a full recursive walk.
        const text = inline($, el, baseUrl);
        return text ? text + "\n" : "";
      }
      return parts.join("\n") + "\n";
    }
  }
}

export function htmlToMarkdown(html, { baseUrl = null, maxLength = 400 * 1024 } = {}) {
  if (typeof html !== "string") throw new HtmlMdError("html must be a string", { code: "type" });
  const $ = load(html);
  $(NOISE).remove();
  const title = ($("title").first().text().trim() || $("h1").first().text().trim() || "").slice(0, 120) || null;
  const root = $("body").length ? $("body") : $.root();
  const parts = [];
  root.children().each((_, el) => {
    const r = render($, $(el), 0, baseUrl);
    if (r && r.trim()) parts.push(r);
  });
  let md = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (md.length > maxLength) {
    md = md.slice(0, maxLength) + "\n\n<!-- truncated -->";
  }
  return { title, markdown: md };
}
