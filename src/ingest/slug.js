// Slug handling for ingest target paths. Kept in one module so the preflight,
// the planner and the pipeline agree on the single validated slug that becomes
// the note path (the confirmation prompt must show what is actually written).

const MAX_SLUG_LENGTH = 120;
const SLUG_CHARS = /^[a-z0-9\u4e00-\u9fa5_-]+$/;

// Derive a slug from a human title. May return an empty string when the title
// has no usable characters; callers must then fall back deterministically.
export function slugify(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
}

// Validate an explicitly requested slug. It must be a single path segment made
// of slug characters: this rejects empty values, absolute paths, Windows
// separators and "." / ".." traversal segments.
export function validateSlug(raw) {
  if (typeof raw !== "string") {
    throw new Error("slug must be a string");
  }
  const slug = raw.trim();
  if (!slug) {
    throw new Error("slug must not be empty");
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    throw new Error(`slug must be at most ${MAX_SLUG_LENGTH} characters`);
  }
  if (slug.includes("/") || slug.includes("\\")) {
    throw new Error(`slug must be a single path segment: "${raw}"`);
  }
  if (slug === "." || slug === "..") {
    throw new Error(`slug must not be "${slug}"`);
  }
  if (!SLUG_CHARS.test(slug)) {
    throw new Error(`slug contains unsupported characters: "${raw}"`);
  }
  return slug;
}

// Deterministic fallback when a title produces no slug: source-<hash8>. The
// hash prefix is sanitized so a malformed content hash cannot inject path
// characters into the target path.
export function fallbackSlug(contentHash) {
  const prefix = String(contentHash ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return `source-${prefix || "untitled"}`;
}
