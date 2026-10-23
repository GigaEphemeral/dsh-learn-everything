// Preflight for the ingest pipeline (P3): duplicate detection and warnings,
// produced before any write or confirmation gate.
//
// The preflight owns slug selection so the confirmation prompt and the planner
// share one effective slug: either the caller's validated override or the slug
// derived from the title (with a deterministic hash-based fallback when the
// title yields nothing usable).

import { fallbackSlug, slugify, validateSlug } from "./slug.js";

function baseName(entry) {
  const name = String(entry);
  const base = name.split("/").pop();
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

// Resolve the effective slug and record a warning when the title is unusable.
function resolveSlug({ requested, title, contentHash, warnings }) {
  if (requested !== undefined && requested !== null) {
    // Explicit caller input is validated strictly; never silently rewritten.
    return validateSlug(requested);
  }
  const derived = slugify(title);
  if (derived) return derived;

  const fallback = fallbackSlug(contentHash);
  warnings.push(`title "${String(title ?? "")}" produced an empty slug; using fallback "${fallback}"`);
  return fallback;
}

export async function buildPreflight({
  source,
  registry,
  adapter,
  wikiSourcesDir = "wiki/sources",
  targetDir = "Sources",
  slug: requestedSlug,
}) {
  if (source === null || typeof source !== "object") {
    throw new Error("buildPreflight: source object is required");
  }
  if (!registry || typeof registry.findByHash !== "function") {
    throw new Error("buildPreflight: registry with findByHash() is required");
  }

  const warnings = Array.isArray(source.warnings) ? [...source.warnings] : [];
  const slug = resolveSlug({ requested: requestedSlug, title: source.title, contentHash: source.contentHash, warnings });
  const duplicate = { exact: null, slugMatch: false };

  // 1) Exact duplicate: same content hash already ingested (project registry).
  const exact = registry.findByHash(source.contentHash);
  if (exact) {
    duplicate.exact = exact;
    warnings.push(`content already ingested as ${exact.vaultPath} (hash ${String(source.contentHash).slice(0, 12)})`);
  }

  // 2) Slug match: a compiled wiki source page with the same basename exists.
  // An empty slug (unreachable today thanks to the fallback) short-circuits to
  // "no match"; a failed listing is a warning, not a preflight failure.
  if (adapter && slug) {
    try {
      const listing = await adapter.list(wikiSourcesDir);
      const files = Array.isArray(listing?.files) ? listing.files : null;
      if (files === null) {
        warnings.push(`wiki listing at ${wikiSourcesDir} returned no file list; slug duplicate check skipped`);
      } else {
        duplicate.slugMatch = files.some((entry) => baseName(entry) === slug);
      }
    } catch (err) {
      warnings.push(`wiki listing at ${wikiSourcesDir} failed (${err.message}); slug duplicate check skipped`);
    }
  }

  const targetPath = `${targetDir}/${slug}.md`;
  return {
    source: { ...source },
    slug,
    targetPath,
    duplicate,
    warnings,
  };
}
