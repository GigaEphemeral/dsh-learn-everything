// Ingest planner (P3): decide the target note and its frontmatter.
// v1 only plans CREATE operations; nothing is auto-updated or overwritten.

export function planNote({ source, targetDir = "Sources", slug }) {
  const targetPath = `${targetDir}/${slug}.md`;
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(source.title)}`,
    "tags:",
    "  - source",
    `source_uri: ${JSON.stringify(source.sourceUri)}`,
    `source_id: ${JSON.stringify(source.sourceId)}`,
    `content_hash: ${JSON.stringify(source.contentHash.slice(0, 16))}`,
    `fetched_at: ${JSON.stringify(source.fetchedAt)}`,
    "---",
  ];
  const body = source.content;
  return {
    operation: "create",
    targetPath,
    content: frontmatter.join("\n") + "\n\n" + body + "\n",
  };
}
