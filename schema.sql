CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  description TEXT,
  tags TEXT,
  secret INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS bookmarks_fts USING fts5(
  url,
  title,
  description,
  tags,
  content='bookmarks',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS bookmarks_ai AFTER INSERT ON bookmarks BEGIN
  INSERT INTO bookmarks_fts(rowid, url, title, description, tags)
  VALUES (new.id, new.url, new.title, new.description, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS bookmarks_ad AFTER DELETE ON bookmarks BEGIN
  INSERT INTO bookmarks_fts(bookmarks_fts, rowid, url, title, description, tags)
  VALUES ('delete', old.id, old.url, old.title, old.description, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS bookmarks_au AFTER UPDATE ON bookmarks BEGIN
  INSERT INTO bookmarks_fts(bookmarks_fts, rowid, url, title, description, tags)
  VALUES ('delete', old.id, old.url, old.title, old.description, old.tags);
  INSERT INTO bookmarks_fts(rowid, url, title, description, tags)
  VALUES (new.id, new.url, new.title, new.description, new.tags);
END;
