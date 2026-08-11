import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { fetchPageMeta } from './meta-fetcher';
import { parseBookmarkHtml } from './db';

type Bindings = {
  DB: D1Database;
  RECALL_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', cors());

function isAuthenticated(c: any): boolean {
  const key = c.req.header('X-API-Key');
  return !!(c.env.RECALL_API_KEY && key && c.env.RECALL_API_KEY === key);
}

app.use('/api/*', async (c, next) => {
  if (c.req.method === 'GET') return next();
  if (!c.env.RECALL_API_KEY) {
    return c.json({ error: 'Server misconfigured: RECALL_API_KEY not set' }, 500);
  }
  const key = c.req.header('X-API-Key');
  if (c.env.RECALL_API_KEY === key) {
    return next();
  }
  return c.json({ error: 'Unauthorized' }, 401);
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
    const ftsQuery = q.split(/\s+/).map((word) => `"${word}"*`).join(' ');
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
    ).bind(ftsQuery).all();
    return c.json({ results });
  }

  if (tag && !q) {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM bookmarks b
       WHERE ',' || b.tags || ',' LIKE '%,' || ? || ',%'
       ${secretFilter}
       ORDER BY created_at DESC LIMIT 50`
    ).bind(tag).all();
    return c.json({ results });
  }

  // Both q and tag
  const ftsQuery = q!.split(/\s+/).map((word) => `"${word}"*`).join(' ');
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
  ).bind(ftsQuery, tag).all();
  return c.json({ results });
});

// List all bookmarks (paginated)
app.get('/api/bookmarks', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = 50;
  const offset = (page - 1) * limit;
  const authed = isAuthenticated(c);
  const secretFilter = authed ? '' : 'WHERE secret = 0';

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM bookmarks ${secretFilter} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

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
  ).bind(id).first();

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

  let title = body.title || '';
  let description = body.description || '';

  if (!title) {
    try {
      const meta = await fetchPageMeta(body.url);
      title = meta.title;
      description = description || meta.description;
    } catch {
      // fetch failed — save with empty title
    }
  }

  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO bookmarks (url, title, description, tags, secret)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`
    ).bind(body.url, title, description, body.tags || '', body.secret ? 1 : 0).first();

    return c.json(result, 201);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'Bookmark already exists' }, 409);
    }
    throw e;
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

  const existing = await c.env.DB.prepare(
    'SELECT * FROM bookmarks WHERE id = ?'
  ).bind(id).first<{ url: string; title: string; description: string; tags: string; secret: number }>();

  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  const result = await c.env.DB.prepare(
    `UPDATE bookmarks SET url = ?, title = ?, description = ?, tags = ?, secret = ?, updated_at = datetime('now')
     WHERE id = ? RETURNING *`
  ).bind(
    body.url ?? existing.url,
    body.title ?? existing.title,
    body.description ?? existing.description,
    body.tags ?? existing.tags,
    body.secret !== undefined ? (body.secret ? 1 : 0) : existing.secret,
    id
  ).first();

  return c.json(result);
});

// Delete bookmark
app.delete('/api/bookmarks/:id', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(
    'DELETE FROM bookmarks WHERE id = ? RETURNING id'
  ).bind(id).first();

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

  const bookmarks = parseBookmarkHtml(body.html);
  let imported = 0;
  let skipped = 0;

  for (const bm of bookmarks) {
    try {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO bookmarks (url, title, tags) VALUES (?, ?, ?)`
      ).bind(bm.url, bm.title, bm.tags).run();
      imported++;
    } catch {
      skipped++;
    }
  }

  return c.json({ imported, skipped, total: bookmarks.length });
});

export default app;
