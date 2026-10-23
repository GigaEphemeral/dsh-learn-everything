// Ingest planner (P3): decide the target note and its frontmatter.
// v1 only plans CREATE operations; nothing is auto-updated or overwritten.
//
// Source fields are normalized through String() so a missing value can never
// leak the literal "undefined" into a note, and required fields are validated
// before a plan is produced.

import { validateSlug } from "./slug.js";

const REQUIRED_SOURCE_FIELDS = ["title", "sourceUri", "contentHash", "content"];

// Coerce an interpolated frontmatter scalar to a string.
function scalar(value) {
  return String(value ?? "");
}

export function planNote({ source, targetDir = "Sources", slug }) {
  if (source === null || typeof source !== "object") {
    throw new Error("planNote: source object is required");
  }
  const missing = REQUIRED_SOURCE_FIELDS.filter(
    (field) => typeof source[field] !== "string" || source[field].trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(`planNote: source is missing required field(s): ${missing.join(", ")}`);
  }

  const validSlug = validateSlug(slug);
  const targetPath = `${targetDir}/${validSlug}.md`;
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(scalar(source.title))}`,
    "tags:",
    "  - source",
    `source_uri: ${JSON.stringify(scalar(source.sourceUri))}`,
    `source_id: ${JSON.stringify(scalar(source.sourceId))}`,
    `content_hash: ${JSON.stringify(scalar(source.contentHash).slice(0, 16))}`,
    `fetched_at: ${JSON.stringify(scalar(source.fetchedAt))}`,
    "---",
  ];
  const body = source.content;
  return {
    operation: "create",
    slug: validSlug,
    targetPath,
    content: frontmatter.join("\n") + "\n\n" + body + "\n",
  };
}
