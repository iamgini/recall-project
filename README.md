# Recall

Local-first bookmark search engine. Save URLs, search with plain English, find links fast.

Runs on Cloudflare Pages + D1 (free tier) or fully offline on your machine.

## Features

- **Search** — Type natural English, get ranked results (powered by SQLite FTS5)
- **Auto-fetch** — Paste a URL, title and description are fetched automatically
- **Tags** — Organize bookmarks with tags, filter by clicking
- **Chrome import** — Upload your Chrome bookmarks HTML export
- **CLI** — `recall <url> tag1 tag2` from your terminal
- **Auth** — API key protects write operations; reads are public
- **Secret bookmarks** — Mark URLs as secret; only visible with a valid API key
- **Portable** — Runs on Cloudflare, Node.js, Bun, Deno, or any container

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Hono](https://hono.dev) (14KB, zero deps) |
| Database | Cloudflare D1 / local SQLite via Miniflare |
| Search | SQLite FTS5 with BM25 ranking |
| Frontend | Static HTML/CSS/JS (no framework) |
| Deploy | Cloudflare Pages (free tier) |

## Project Structure

```
recall-project/
├── src/
│   ├── index.ts          # Hono app — all API routes
│   ├── db.ts             # DB helpers + Chrome bookmark parser
│   └── meta-fetcher.ts   # Auto-fetch page title/description
├── functions/
│   └── api/
│       └── [[route]].ts  # Cloudflare Pages Functions entry point
├── public/
│   ├── index.html        # Single-page UI
│   ├── style.css         # Dark theme styles
│   └── app.js            # Frontend logic
├── schema.sql            # Database schema (bookmarks + FTS5)
├── wrangler.toml         # Cloudflare config
├── Containerfile         # Container image for local dev
├── dev.sh                # Build + run helper script
├── recall.sh             # CLI — source this in .bashrc
├── package.json
└── tsconfig.json
```

## Quick Start

```bash
cd ~/workarea/recall-project
./dev.sh
```

On first run, `dev.sh` auto-generates an API key (via `uuidgen`), saves it to `.env`, and prints it:

```
==> Starting Recall on http://localhost:8788
    Data persisted in podman volume: recall-data

    API Key: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    (use this in browser Settings and CLI)
```

Open http://localhost:8788 → click **Settings** → paste the API key → Save.

You're done. Add bookmarks, search, import Chrome bookmarks.

## Local Development

### Option A: Containerized with Podman (recommended, no host installs)

`./dev.sh` handles everything: builds the image, creates a Podman volume for data, generates an API key (saved to `.env`), and runs the app.

```bash
# Start (auto-generates key on first run, reuses from .env after)
./dev.sh

# Override with a specific key
RECALL_API_KEY=custom-key ./dev.sh

# Rebuild after code changes (data + key persist)
./dev.sh

# Reset all data
podman volume rm recall-data
```

Bookmarks persist in a Podman volume (`recall-data`). API key persists in `.env`. Ctrl+C to stop.

### Option B: Local with npm

```bash
cd ~/workarea/recall-project

# Install dependencies
npm install

# Create .dev.vars with your API key
echo "RECALL_API_KEY=<your-key>" > .dev.vars

# Initialize local database
npm run db:init:local

# Start dev server
npm run dev
```

Open http://localhost:8788

### Available npm scripts

| Script | Command |
|--------|---------|
| `npm run dev` | Start local dev server |
| `npm run db:init:local` | Create local D1 database and apply schema |
| `npm run db:init:remote` | Apply schema to remote Cloudflare D1 |
| `npm run deploy` | Deploy to Cloudflare Pages |

## Deploy to Cloudflare

### 1. Create D1 database

- Cloudflare Dashboard → Workers & Pages → D1 → Create database
- Name it `recall-db`
- Copy the database ID

### 2. Configure wrangler.toml

```bash
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml — replace <your-database-id> with the ID from step 1
```

### 3. Apply schema (required before first use)

- Cloudflare Dashboard → D1 → recall-db → Console
- Paste the contents of `schema.sql` and run it
- You should see 5 successful commands (table + FTS + 3 triggers)
- **The app will not work until this step is done**

### 4. Set API key secret

- Cloudflare Dashboard → Workers & Pages → recall → Settings → Variables and Secrets
- Add secret: `RECALL_API_KEY` = the same key you use locally

### 5. Deploy

Connect your GitHub repo to Cloudflare Pages:

- Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
- Select your `recall-project` repo
- Build settings: leave empty (static files, no build step needed)
- Deploy

Your app will be live at `https://recall-<hash>.pages.dev`.

## Usage

### Adding bookmarks

1. Click **+ Add**
2. Paste a URL — title and description auto-fill
3. Add tags (comma-separated): `python, tutorial, devops`
4. Click **Save**

### Searching

Type in the search bar. Examples:
- `python tutorial` — finds bookmarks with python AND tutorial
- `docker kubernetes` — matches title, description, URL, or tags
- Click a tag to filter by that tag

Search uses BM25 ranking: title matches rank highest, then description, tags, and URL.

### CLI usage

Add `recall` command to your terminal:

```bash
# Add to ~/.bashrc or ~/.zshrc
source ~/workarea/recall-project/recall.sh
export RECALL_URL="http://localhost:8788"       # or your Cloudflare URL
export RECALL_API_KEY="<same-key-from-setup>"   # required
```

Then use it:

```bash
# Add a bookmark with tags
recall https://docs.ansible.com ansible devops automation

# Add a secret bookmark
recall --secret https://internal.example.com work vpn

# Search (includes secret results when RECALL_API_KEY is set)
recall search ansible tutorial
```

### Importing Chrome bookmarks

1. In Chrome: Bookmarks Manager → ⋮ → Export bookmarks
2. In Recall: click **Import** → upload the HTML file
3. Folder names become tags automatically

## Running Fully Offline

**Container mode**: After the initial `podman build` (which pulls the base image and npm packages), the container runs fully offline. Data lives inside the container and is ephemeral.

**Local npm mode**: After `npm install`, runs entirely offline. Data is stored in `.wrangler/state/` as a local SQLite file. Delete that directory to reset.

## Authentication

`RECALL_API_KEY` must be set. Write operations fail with `500` if the key is not configured.

| Route type | Auth required? |
|-----------|---------------|
| `GET /api/*` (search, list, tags) | No — but secret bookmarks are hidden |
| `GET /api/*` with `X-API-Key` header | No — secret bookmarks are included |
| `POST/PUT/DELETE /api/*` (add, edit, delete, import) | Yes (`X-API-Key` header) |

**Where to set the key:**

| Environment | How |
|-------------|-----|
| Podman (local) | Auto-generated by `./dev.sh` (saved to `.env`); override with `RECALL_API_KEY=<key> ./dev.sh` |
| npm (local) | `echo "RECALL_API_KEY=<key>" > .dev.vars` |
| Cloudflare | Dashboard → Workers & Pages → recall → Settings → Variables and Secrets |
| CLI | `export RECALL_API_KEY=<key>` in `~/.bashrc` |
| Browser | Click **Settings** → paste key → Save (stored in localStorage) |

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/search?q=...&tag=...` | No | Full-text search with optional tag filter |
| `GET` | `/api/bookmarks?page=1` | No | List bookmarks (paginated) |
| `GET` | `/api/bookmarks/:id` | No | Get single bookmark |
| `POST` | `/api/bookmarks` | Yes | Add bookmark `{url, title?, description?, tags?, secret?}` |
| `PUT` | `/api/bookmarks/:id` | Yes | Update bookmark |
| `DELETE` | `/api/bookmarks/:id` | Yes | Delete bookmark |
| `GET` | `/api/tags` | No | List all tags with counts |
| `POST` | `/api/fetch-meta` | Yes | Fetch page title/description `{url}` |
| `POST` | `/api/import` | Yes | Import Chrome bookmarks `{html}` |

## Security

See [SECURITY.md](SECURITY.md) for the full security reference — OWASP Top 10 mapping, VAPT coverage, headers, SSRF protection, and more.

Run the dependency audit (no host installs):

```bash
./audit.sh
```

## Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `hono` | Web framework | ~14KB |
| `wrangler` | Cloudflare dev/deploy CLI | dev only |
| `typescript` | Type checking | dev only |
| `@cloudflare/workers-types` | D1/Worker type definitions | dev only |

## License

MIT
