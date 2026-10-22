// Preflight for the ingest pipeline (P3): duplicate detection and warnings,
// produced before any write or confirmation gate.

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    ;
}

export function buildPreflight({ source, registry, adapter, wikiSourcesDir = "wiki/sources", targetDir = "Sources" }) {
  const warnings = [...source.warnings];
  const duplicate = { exact: null, slugMatch: false };

  // 1) Exact duplicate: same content hash already ingested (project registry).
  const exact = registry.findByHash(source.contentHash);
  if (exact) {
    duplicate.exact = exact;
    warnings.push(`content already ingested as ${exact.vaultPath} (hash ${source.contentHash.slice(0, 12)})`);
  }

  // 2) Slug match: a compiled wiki source page for the same basename exists.
  const slug = slugify(source.title);
  const slugMatch = adapter
    ? adapter
        .list(wikiSourcesDir)
        .then(({ files }) => files.some((f) => f.startsWith(slug)), () => false)
    : Promise.resolve(false);

  const targetPath = `${targetDir}/${slug}.md`;
  return {
    source: { ...source },
    slug,
    targetPath,
    duplicate,
    warnings,
    slugMatchPromise: slugMatch,
  };
}
