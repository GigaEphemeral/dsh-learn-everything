# obsidian-adapter (P1)

Unified vault access layer for the DSH + Obsidian learning system.
Talks to the **Local REST API with MCP** plugin (v5.5.2) inside Obsidian.

## Setup
1. Keep Obsidian running with the vault open and the plugin enabled.
2. `cp .env.example .env` and fill `OBSIDIAN_API_KEY` (Settings -> Local REST API).
3. `npm test` (unit tests, no network) · `npm run test:live` (integration against the live vault).

## Quick command-line checks (curl)
```bash
KEY=2461361027   # your API key
B=https://127.0.0.1:27124
curl -sk -H "Authorization: Bearer $KEY" $B/                    # server info, authenticated flag
curl -sk -H "Authorization: Bearer $KEY" $B/vault/              # list vault files
curl -sk -H "Authorization: Bearer $KEY" $B/vault/README.md     # read a note
curl -sk -X PUT  -H "Authorization: Bearer $KEY" -H "Content-Type: text/markdown" -H "If-None-Match: *" \
     --data-binary '---\ntitle: x\n---\n\nbody' $B/vault/_p1-test/a.md   # create (no overwrite)
curl -sk -G -X POST -H "Authorization: Bearer $KEY" --data-urlencode 'query=title' $B/search/simple/  # search
curl -sk -X PATCH -H "Authorization: Bearer $KEY" -H "Operation: replace" -H "Create-Target-If-Missing: true" \
     -H "Content-Type: application/json" -d '"active"' $B/vault/_p1-test/a.md/frontmatter/status       # frontmatter
```

## P1 acceptance status (2026-10-23)
All service-level checks pass against the live vault: read, create (no-overwrite via `If-None-Match: *`, 412 on conflict),
search, frontmatter single-field update with other fields preserved, path traversal blocked (400),
.obsidian config dir refused (403), nonexistent file (404), delete + verify gone.
