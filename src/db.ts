export async function initDb(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT,
      description TEXT,
      tags TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS bookmarks_fts USING fts5(
      url, title, description, tags,
      content='bookmarks', content_rowid='id'
    )`),
  ]);
}

export function parseBookmarkHtml(html: string): Array<{ url: string; title: string; tags: string }> {
  const bookmarks: Array<{ url: string; title: string; tags: string }> = [];
  const folderStack: string[] = [];

  const lines = html.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    const folderMatch = trimmed.match(/<H3[^>]*>([^<]+)<\/H3>/i);
    if (folderMatch) {
      folderStack.push(folderMatch[1].toLowerCase().replace(/\s+/g, '-'));
      continue;
    }

    if (trimmed === '</DL><p>' || trimmed === '</DL>') {
      folderStack.pop();
      continue;
    }

    const linkMatch = trimmed.match(/<A\s+HREF="([^"]+)"[^>]*>([^<]*)<\/A>/i);
    if (linkMatch) {
      const url = linkMatch[1];
      const title = linkMatch[2] || '';
      if (url.startsWith('http://') || url.startsWith('https://')) {
        bookmarks.push({
          url,
          title,
          tags: folderStack.length > 0 ? folderStack.join(',') : '',
        });
      }
    }
  }

  return bookmarks;
}
