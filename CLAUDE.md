# Recall — Bookmark Search Engine

## Overview

Personal bookmark manager with natural language search. Runs on Cloudflare Pages + D1 (free tier) or fully offline via Podman.

- **Live**: https://recall-project.pages.dev
- **Repo**: https://github.com/iamgini/recall-project

## Stack

- **Framework**: Hono (TypeScript, Cloudflare Pages Functions)
- **Database**: Cloudflare D1 (SQLite) / local SQLite via Miniflare
- **Search**: SQLite FTS5 with BM25 ranking
- **Frontend**: Static HTML/CSS/JS in `public/`
- **Container**: Podman with volume persistence (`recall-data`)

## Project Structure

```
src/index.ts          — Hono app, all API routes + auth middleware
src/db.ts             — Chrome bookmark HTML parser
src/meta-fetcher.ts   — Fetch page title/description via regex
functions/api/[[route]].ts — Pages Functions entry point
public/               — Static frontend (index.html, style.css, app.js)
schema.sql            — D1 schema (bookmarks + FTS5 + triggers)
dev.sh                — Build + run with Podman
recall.sh             — CLI (source in .bashrc)
Containerfile         — Container image definition
wrangler.toml.example — Template (wrangler.toml is gitignored)
```

## Key Architecture Decisions

- `wrangler.toml` is gitignored — contains D1 database ID. `wrangler.toml.example` is committed.
- `.dev.vars` is gitignored — holds `RECALL_API_KEY` for local wrangler dev.
- Auth: `RECALL_API_KEY` is required. Write ops (POST/PUT/DELETE) need `X-API-Key` header. GET routes are public but hide secret bookmarks unless authenticated.
- Secret bookmarks: `secret` column (0/1). Filtered from all GET responses unless valid API key is provided.
- FTS5 content table synced via SQLite triggers (insert/update/delete).
- BM25 weights: url=1, title=10, description=5, tags=3.

## Development

```bash
# Run locally (Podman, no host installs)
RECALL_API_KEY=<key> ./dev.sh

# Data persists in podman volume "recall-data"
# Reset: podman volume rm recall-data
```

## Cloudflare Deployment

1. Create D1 database in dashboard, name: `recall-db`
2. Apply `schema.sql` via D1 Console
3. Bind D1 to Pages project: variable name `DB`, select `recall-db`
4. Set `RECALL_API_KEY` in Workers & Pages → Settings → Variables and Secrets
5. Connect GitHub repo, build command: `npm install`, output dir: `public`
6. Redeploy after adding bindings

## Common Commands

```bash
# CLI: add bookmark
recall https://example.com tag1 tag2

# CLI: add secret bookmark
recall --secret https://internal.example.com work

# CLI: search
recall search ansible tutorial

# Test API
curl -s https://recall-project.pages.dev/api/search?q=ansible
```

## Files to Watch

- `schema.sql` — Any column changes require volume reset locally + D1 Console re-run on Cloudflare
- `src/index.ts` — All API logic lives here
- `public/app.js` — All frontend logic, auth header handling
