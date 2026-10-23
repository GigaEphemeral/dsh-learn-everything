<p align="center">
  <a href="./README.md">English</a> | <a href="./README-zh.md">简体中文</a>
</p>

# DSH + Obsidian Learning System — DSH Plugin (code/)

The complete **DSH plugin** of the DSH + Obsidian personal learning system. It operates the Obsidian vault through the
**Local REST API with MCP** plugin, drives **karpathywiki** (LLM Wiki) compilation, and provides three business
flows: ingest, search, and daily practice. DSH is the single entry point; Obsidian is the authoritative knowledge store.

## Requirements
- Obsidian running with the formal vault (learnEverything) open and these plugins enabled:
  `obsidian-local-rest-api` (v5.5.2) and `karpathywiki` (v1.28.0)
- API key: Obsidian → Settings → Local REST API → API key
- Node.js ≥ 20 (v24 on the dev machine)

## Configuration (`code/.env`)
```bash
cp .env.example .env   # fill in OBSIDIAN_API_KEY
```

| Variable | Meaning | Default |
|---|---|---|
| OBSIDIAN_API_KEY | Plugin API key (required) | — |
| OBSIDIAN_BASE_URL | Plugin HTTPS server base URL | https://127.0.0.1:27124 |
| OBSIDIAN_SCOPE | Restrict the adapter to a vault subfolder (optional) | (empty) |
| OBSIDIAN_INGEST_TIMEOUT_MS | Max ms to wait for compiled wiki pages after triggering ingest | 900000 (15 min) |
| OBSIDIAN_INGEST_POLL_INTERVAL_MS | ms between wiki output folder checks | 10000 |
| OBSIDIAN_INGEST_SETTLE_MS | ms to keep waiting after the first new page appears | 60000 |
| OBSIDIAN_REVIEW_W_OVERDUE / WEAKNESS / COVERAGE / NOVELTY | Daily practice selection weights | 1.0 / 0.8 / 0.5 / 0.3 |
| OBSIDIAN_STATE_DIR | Runtime state dir (ingest registry, attempts, review) | code/.state |

## DSH plugin structure
```
package.json   # dsh.bundle.patch -> ./cordis.patch.yml
cordis.patch.yml  # registers this bundle in the DSH profile
index.js       # registers the skills under skills/ on ctx.skills
skills/        # packaged skills: remember-knowledge, knowledge-search, daily-practice
```

## Source layout (split by domain)
```
src/
├── obsidian/     # Vault access: client (HTTPS+timeout), adapter (list/read/create/append/frontmatter/search),
│                 #   vault-path (path validation), mcp-client (MCP JSON-RPC)
├── wiki/         # karpathywiki driver: open+ingest, snapshot diff, blocking wait (configurable timeout/poll/settle)
├── ingest/       # Ingest: source-fetch, preflight (duplicate check), planner, pipeline (two confirmation gates,
│                 #   create-only), registry, task state machine
├── search/       # Search: intent classifier, wiki-first retriever (stopword stripping, per-term fallback,
│                 #   meta-file filtering)
└── learning/     # Learning: question store, append-only attempt store, weighted review scheduler
scripts/          # ingest-cli / search-cli / practice-cli
tests/            # node --test unit tests
```

## Usage
```bash
# Ingest (https URLs or local Markdown; interactive confirmation; --auto-yes for unattended runs)
node scripts/ingest-cli.mjs <https-url|local.md>

# Search (intent routing: concept exploration / exact-source lookup / structural query / combined)
node scripts/search-cli.mjs "what is spaced repetition"

# Daily practice (LLM-driven, on-demand; see skills/daily-practice)
```


## Knowledge assets & Obsidian vault layout

The formal vault is `learnEverything`. Knowledge is split by ownership so DSH writes never pollute human-maintained or plugin-managed content:

| Directory | Responsibility | Owner | Notes |
|---|---|---|---|
| `Sources/` | **Ingested originals** — every ingested URL/local file lands here as `<slug>.md` (frontmatter: source_uri/source_id/content_hash/fetched_at + the original body) | DSH writes; user reads | create-only, never overwrite |
| `Learning/MOC` | Human-maintained topic navigation | User (DSH assists) | the only learning dir kept in the vault |
| `Inbox/` | Pending materials | User | empty |
| `wiki/` | KarpathyWiki **derived** network: `concepts/ entities/ sources/` + `index.md log.md schema/config.md` | Plugin auto-generates | rebuildable; never treat as original knowledge |

Boundaries: `Sources/` + `Learning/MOC` = formal knowledge. `wiki/` = derived, rebuildable. **Learning state — Plans/Questions/Reviews (题目/作答/评分/复习调度/掌握度) — lives in SQLite (decision B), never written into vault notes.**

### Ingest flow (where the original goes)
```
URL (https-only) or local .md
  → normalize (sha256 content_hash, source_id)
  → preflight (exact hash via code/.state/sources.json registry + wiki/sources slug match)
  → user confirmation ×2 (scope, write plan)
  → create-only write → Sources/<slug>.md   ← original text lives here
  → read-back verify
  → karpathywiki compile → wiki/ derived pages (traceable via source_file)
  → registry record (hash → vault path)
```

> Note: the REST API lists only non-empty directories; empty folders (Learning/*, Inbox) exist on disk but do not appear in `/vault/` listings.

### Current vault state (2026-10-23)
- `Sources/dsh-plugin-dev-patterns.md` + `wiki/` pages for it (1 source page, concepts, entities)
- Leftover artifacts pending cleanup: root `concepts/间隔重复.md` (stray), `_p1-test/` (P1 scratch), `未命名.base` (Obsidian file) — confirm before deleting.

## Self-test
```bash
npm test                                  # 29 unit tests (no network)
OBSIDIAN_API_KEY=... npm run test:live     # live integration (needs running Obsidian)
```

## Acceptance status (2026-10-23)
- **P1** MCP access ✅ read/write, search, 412 no-overwrite, path traversal 400, .obsidian 403,
  frontmatter field preservation, 404
- **P2** karpathywiki ✅ command-driven ingest (no UI dialog), traceable wiki pages, merge & idempotency,
  blocking-wait mechanism
- **P3** Ingest ✅ preflight → two confirmation gates → create-only write → verify → compile → report;
  end-to-end tested
- **P4** Search ✅ intent routing + wiki-first + evidence excerpts + meta-file filtering
- **P5** Learning loop ✅ append-only attempts, doubling review intervals, overdue-first selection
- 29 unit tests + 2 live integration tests green; every new behavior has a test that fails if reverted (AGENTS.md rule)

## Quick curl checks
```bash
KEY=<your-key>; B=https://127.0.0.1:27124
curl -sk -H "Authorization: Bearer $KEY" $B/                      # server info + auth status
curl -sk -H "Authorization: Bearer $KEY" $B/vault/                # list vault files
curl -sk -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: text/markdown" -H "If-None-Match: *" \
     --data-binary $'---\ntitle: x\n---\n\nbody' $B/vault/_t/a.md   # create (412 on conflict)
curl -sk -G -X POST -H "Authorization: Bearer $KEY" --data-urlencode 'query=x' $B/search/simple/  # search
```

## Notes
- Secrets live only in `.env` (gitignored); runtime state (`.state/`) is not committed either
- karpathywiki compilation takes ~6 min per source (LLM); the CLI blocks and waits — timeout/poll/settle
  are configurable
- Every write to the formal vault passes a confirmation gate; create-only, never silently overwrite
  human-maintained notes
