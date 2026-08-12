import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { fetchPageMeta } from './meta-fetcher';
import { parseBookmarkHtml } from './db';

type Bindings = {
  DB: D1Database;
  RECALL_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 500;
const MAX_DESC_LENGTH = 2000;
const MAX_TAGS_LENGTH = 500;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) {
    crypto.subtle.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.subtle.timingSafeEqual(aBuf, bBuf);
}

function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeFtsQuery(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `"${word.replace(/"/g, '')}"*`)
    .filter((w) => w !== '""*')
    .join(' ');
}

const rateLimits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  let ts = rateLimits.get(ip);
  if (!ts) {
    ts = [];
    rateLimits.set(ip, ts);
  }
  while (ts.length > 0 && now - ts[0] > RATE_LIMIT_WINDOW_MS) ts.shift();
  if (ts.length >= RATE_LIMIT_MAX) return true;
  ts.push(now);
  return false;
}

function getClientIp(c: any): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

// Security headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('X-Permitted-Cross-Domain-Policies', 'none');
  c.header('Cache-Control', 'private, no-store');
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
});

// CORS — same-origin in production, localhost for dev
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      if (!origin) return undefined;
      try {
        const u = new URL(origin);
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return origin;
      } catch {}
      return undefined;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type', 'X-API-Key'],
    maxAge: 86400,
  })
);

function isAuthenticated(c: any): boolean {
  const key = c.req.header('X-API-Key');
  if (!c.env.RECALL_API_KEY || !key) return false;
  return timingSafeEqual(c.env.RECALL_API_KEY, key);
}

// Auth + rate limit on write operations
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'GET') return next();

  if (!c.env.RECALL_API_KEY) {
    return c.json({ error: 'Server misconfigured' }, 500);
  }

  const ip = getClientIp(c);
  if (isRateLimited(ip)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Too many requests' }, 429);
  }

  const key = c.req.header('X-API-Key');
  if (!key || !timingSafeEqual(c.env.RECALL_API_KEY, key)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return next();
});

// Search bookmarks using FTS5
app.get('/api/search', async (c) => {
  const q = c.req.query('q')?.trim();
  const tag = c.req.query('tag')?.trim();
  const authed = isAuthenticated(c);
  const secretFilter = authed ? '' : 'AND b.secret = 0';

  if (!q && !tag) {
    return c.json({ results: [] });
  }

  if (q && !tag) {
    const ftsQuery = sanitizeFtsQuery(q);
    if (!ftsQuery) return c.json({ results: [] });
    const { results } = await c.env.DB.prepare(
      `SELECT b.id, b.url, b.title, b.description, b.tags, b.secret, b.created_at,
              highlight(bookmarks_fts, 1, '<mark>', '</mark>') as title_hl,
              highlight(bookmarks_fts, 2, '<mark>', '</mark>') as desc_hl
       FROM bookmarks_fts
       JOIN bookmarks b ON b.id = bookmarks_fts.rowid
       WHERE bookmarks_fts MATCH ?
       ${secretFilter}
       ORDER BY bm25(bookmarks_fts, 1.0, 10.0, 5.0, 3.0)
       LIMIT 50`
    )
      .bind(ftsQuery)
      .all();
    return c.json({ results });
  }

  if (tag && !q) {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM bookmarks b
       WHERE ',' || b.tags || ',' LIKE '%,' || ? || ',%'
       ${secretFilter}
       ORDER BY created_at DESC LIMIT 50`
    )
      .bind(tag)
      .all();
    return c.json({ results });
  }

  const ftsQuery = sanitizeFtsQuery(q!);
  if (!ftsQuery) return c.json({ results: [] });
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.url, b.title, b.description, b.tags, b.secret, b.created_at,
            highlight(bookmarks_fts, 1, '<mark>', '</mark>') as title_hl,
            highlight(bookmarks_fts, 2, '<mark>', '</mark>') as desc_hl
     FROM bookmarks_fts
     JOIN bookmarks b ON b.id = bookmarks_fts.rowid
     WHERE bookmarks_fts MATCH ?
     AND ',' || b.tags || ',' LIKE '%,' || ? || ',%'
     ${secretFilter}
     ORDER BY bm25(bookmarks_fts, 1.0, 10.0, 5.0, 3.0)
     LIMIT 50`
  )
    .bind(ftsQuery, tag)
    .all();
  return c.json({ results });
});

// List all bookmarks (paginated)
app.get('/api/bookmarks', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1') || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  const authed = isAuthenticated(c);
  const secretFilter = authed ? '' : 'WHERE secret = 0';

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM bookmarks ${secretFilter} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all();

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM bookmarks ${secretFilter}`
  ).first<{ total: number }>();

  return c.json({ results, total: countResult?.total || 0, page });
});

// Get single bookmark
app.get('/api/bookmarks/:id', async (c) => {
  const id = c.req.param('id');
  const authed = isAuthenticated(c);
  const secretFilter = authed ? '' : 'AND secret = 0';

  const bookmark = await c.env.DB.prepare(
    `SELECT * FROM bookmarks WHERE id = ? ${secretFilter}`
  )
    .bind(id)
    .first();

  if (!bookmark) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.json(bookmark);
});

// Add bookmark
app.post('/api/bookmarks', async (c) => {
  const body = await c.req.json<{
    url: string;
    title?: string;
    description?: string;
    tags?: string;
    secret?: boolean;
  }>();

  if (!body.url) {
    return c.json({ error: 'URL is required' }, 400);
  }

  if (!isValidHttpUrl(body.url)) {
    return c.json({ error: 'Invalid URL — only http and https are allowed' }, 400);
  }

  if (body.url.length > MAX_URL_LENGTH) {
    return c.json({ error: `URL exceeds ${MAX_URL_LENGTH} characters` }, 400);
  }

  const tags = (body.tags || '').substring(0, MAX_TAGS_LENGTH);
  let title = (body.title || '').substring(0, MAX_TITLE_LENGTH);
  let description = (body.description || '').substring(0, MAX_DESC_LENGTH);

  if (!title) {
    try {
      const meta = await fetchPageMeta(body.url);
      title = meta.title.substring(0, MAX_TITLE_LENGTH);
      description = description || meta.description.substring(0, MAX_DESC_LENGTH);
    } catch {
      // fetch failed — save with empty title
    }
  }

  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO bookmarks (url, title, description, tags, secret)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    )
      .bind(body.url, title, description, tags, body.secret ? 1 : 0)
      .first();

    return c.json(result, 201);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Bookmark already exists' }, 409);
    }
    return c.json({ error: 'Failed to save bookmark' }, 500);
  }
});

// Update bookmark
app.put('/api/bookmarks/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    url?: string;
    title?: string;
    description?: string;
    tags?: string;
    secret?: boolean;
  }>();

  if (body.url !== undefined) {
    if (!isValidHttpUrl(body.url)) {
      return c.json({ error: 'Invalid URL — only http and https are allowed' }, 400);
    }
    if (body.url.length > MAX_URL_LENGTH) {
      return c.json({ error: `URL exceeds ${MAX_URL_LENGTH} characters` }, 400);
    }
  }

  const existing = await c.env.DB.prepare('SELECT * FROM bookmarks WHERE id = ?')
    .bind(id)
    .first<{
      url: string;
      title: string;
      description: string;
      tags: string;
      secret: number;
    }>();

  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  const result = await c.env.DB.prepare(
    `UPDATE bookmarks SET url = ?, title = ?, description = ?, tags = ?, secret = ?, updated_at = datetime('now')
     WHERE id = ? RETURNING *`
  )
    .bind(
      body.url ?? existing.url,
      (body.title ?? existing.title).substring(0, MAX_TITLE_LENGTH),
      (body.description ?? existing.description).substring(0, MAX_DESC_LENGTH),
      (body.tags ?? existing.tags).substring(0, MAX_TAGS_LENGTH),
      body.secret !== undefined ? (body.secret ? 1 : 0) : existing.secret,
      id
    )
    .first();

  return c.json(result);
});

// Delete bookmark
app.delete('/api/bookmarks/:id', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    'DELETE FROM bookmarks WHERE id = ? RETURNING id'
  )
    .bind(id)
    .first();

  if (!result) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.json({ deleted: true });
});

// List all tags with counts
app.get('/api/tags', async (c) => {
  const authed = isAuthenticated(c);
  const secretFilter = authed ? '' : 'AND secret = 0';
  const { results } = await c.env.DB.prepare(
    `SELECT tags FROM bookmarks WHERE tags != '' AND tags IS NOT NULL ${secretFilter}`
  ).all<{ tags: string }>();

  const tagCounts: Record<string, number> = {};
  for (const row of results) {
    for (const tag of row.tags.split(',')) {
      const t = tag.trim();
      if (t) {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      }
    }
  }

  const sorted = Object.entries(tagCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return c.json({ tags: sorted });
});

// Fetch metadata for a URL (preview before save)
app.post('/api/fetch-meta', async (c) => {
  const body = await c.req.json<{ url: string }>();
  if (!body.url) {
    return c.json({ error: 'URL is required' }, 400);
  }

  if (!isValidHttpUrl(body.url)) {
    return c.json({ error: 'Invalid URL' }, 400);
  }

  try {
    const meta = await fetchPageMeta(body.url);
    return c.json(meta);
  } catch {
    return c.json({ title: '', description: '' });
  }
});

// Import Chrome bookmarks HTML
app.post('/api/import', async (c) => {
  const body = await c.req.json<{ html: string }>();
  if (!body.html) {
    return c.json({ error: 'HTML content is required' }, 400);
  }

  if (body.html.length > MAX_IMPORT_BYTES) {
    return c.json({ error: 'Import file too large (max 5MB)' }, 413);
  }

  const bookmarks = parseBookmarkHtml(body.html);
  let imported = 0;
  let skipped = 0;
  const BATCH_SIZE = 50;

  for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
    const batch = bookmarks.slice(i, i + BATCH_SIZE);
    const stmts = batch.map((bm) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO bookmarks (url, title, tags) VALUES (?, ?, ?)`
      ).bind(
        bm.url.substring(0, MAX_URL_LENGTH),
        bm.title.substring(0, MAX_TITLE_LENGTH),
        bm.tags.substring(0, MAX_TAGS_LENGTH)
      )
    );

    try {
      const results = await c.env.DB.batch(stmts);
      for (const r of results) {
        if (r.meta.changes > 0) imported++;
        else skipped++;
      }
    } catch {
      skipped += batch.length;
    }
  }

  return c.json({ imported, skipped, total: bookmarks.length });
});

app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
