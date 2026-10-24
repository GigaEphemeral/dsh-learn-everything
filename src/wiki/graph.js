// Wiki graph extraction (S4, plan A): nodes are wiki concept/entity/source
// pages, edges are the [[links]] between them. Pure functions over page
// contents so the graph building is unit-testable without a vault.

export const GRAPH_TYPES = Object.freeze(["concept", "entity", "source"]);

// Normalize a wiki path or [[link]] into a graph node id: strip the "wiki/"
// prefix and the ".md" suffix, keep the dir prefix ("concepts/x").
export function normalizeNodeId(path) {
  let p = String(path || "").replace(/\\/g, "/");
  // Obsidian links may carry a heading or block anchor; the graph node is the
  // note, not "concepts/x#Section".
  p = p.replace(/[#^].*$/, "");
  p = p.replace(/^wiki\//, "");
  p = p.replace(/\.md$/i, "");
  return p.trim();
}

export function nodeTypeFor(id) {
  if (id.startsWith("concepts/")) return "concept";
  if (id.startsWith("entities/")) return "entity";
  if (id.startsWith("sources/")) return "source";
  return "other";
}

export function labelFor(id) {
  const base = id.split("/").pop() || id;
  // karpathywiki names source pages "<slug>_<hash>"; keep the slug part.
  return base.replace(/_[0-9a-f]{6}$/, "");
}

// All [[...]] targets in a markdown body (Obsidian links, alias stripped).
export function parseWikiLinks(content) {
  const links = [];
  if (typeof content !== "string") return links;
  const re = /\[\[([^\]\n]+?)\]\]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const target = m[1].split("|")[0].trim();
    if (target) links.push(target);
  }
  return links;
}

// Build the graph from a list of wiki pages: [{ path, content }].
export function buildGraph(pages) {
  const nodes = new Map();
  const edges = new Map();
  for (const p of pages) {
    const id = normalizeNodeId(p.path);
    if (!nodes.has(id)) nodes.set(id, { id, label: labelFor(id), type: nodeTypeFor(id) });
  }
  for (const p of pages) {
    const id = normalizeNodeId(p.path);
    for (const link of parseWikiLinks(p.content)) {
      const target = normalizeNodeId(link);
      if (!target || nodeTypeFor(target) === "other") continue;
      if (!nodes.has(target)) nodes.set(target, { id: target, label: labelFor(target), type: nodeTypeFor(target) });
      const key = id + "->" + target;
      if (!edges.has(key)) edges.set(key, { source: id, target });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
