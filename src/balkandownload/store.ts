import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CatalogTopic, ForumSection, ThreadBook } from './forums.js';
import { normalizeSearchText } from './parser.js';

export interface SearchTopicsOptions {
  query: string;
  section?: ForumSection | 'all';
  forumId?: number;
  limit?: number;
}

export interface SearchTopicsResponse {
  results: CatalogTopic[];
  total: number;
}

export interface CachedThreadEntry {
  fetchedAt: number;
  totalPages: number;
  fetchedPages: number;
  truncated: boolean;
  books: ThreadBook[];
}

export interface StoreStats {
  topicCount: number;
  countsBySection: {
    domace: number;
    strane: number;
  };
  lastSyncedAt: number | null;
  lastError: string | null;
}

interface TopicRow {
  topic_id: number;
  forum_id: number;
  section: ForumSection;
  forum_label: string;
  title: string;
  normalized_title: string;
  url: string;
}

function rowToTopic(row: TopicRow): CatalogTopic {
  return {
    topicId: row.topic_id,
    forumId: row.forum_id,
    section: row.section,
    forumLabel: row.forum_label,
    title: row.title,
    normalizedTitle: row.normalized_title,
    url: row.url,
  };
}

export class BalkanDownloadStore {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema(dbPath !== ':memory:');
  }

  private initSchema(isFileDb: boolean): void {
    if (isFileDb) {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec(`
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS topics (
        topic_id INTEGER PRIMARY KEY,
        forum_id INTEGER NOT NULL,
        section TEXT NOT NULL,
        forum_label TEXT NOT NULL,
        title TEXT NOT NULL,
        normalized_title TEXT NOT NULL,
        url TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_topics_forum_id ON topics(forum_id);
      CREATE INDEX IF NOT EXISTS idx_topics_section ON topics(section);

      CREATE VIRTUAL TABLE IF NOT EXISTS topics_fts USING fts5(
        title,
        normalized_title,
        content='topics',
        content_rowid='topic_id',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS topics_ai AFTER INSERT ON topics BEGIN
        INSERT INTO topics_fts(rowid, title, normalized_title)
        VALUES (new.topic_id, new.title, new.normalized_title);
      END;

      CREATE TRIGGER IF NOT EXISTS topics_ad AFTER DELETE ON topics BEGIN
        INSERT INTO topics_fts(topics_fts, rowid, title, normalized_title)
        VALUES ('delete', old.topic_id, old.title, old.normalized_title);
      END;

      CREATE TRIGGER IF NOT EXISTS topics_au AFTER UPDATE ON topics BEGIN
        INSERT INTO topics_fts(topics_fts, rowid, title, normalized_title)
        VALUES ('delete', old.topic_id, old.title, old.normalized_title);
        INSERT INTO topics_fts(rowid, title, normalized_title)
        VALUES (new.topic_id, new.title, new.normalized_title);
      END;

      CREATE TABLE IF NOT EXISTS topic_books_cache (
        topic_id INTEGER PRIMARY KEY,
        fetched_at INTEGER NOT NULL,
        total_pages INTEGER NOT NULL,
        fetched_pages INTEGER NOT NULL,
        truncated INTEGER NOT NULL DEFAULT 0,
        books_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  replaceForumTopics(forumId: number, topics: CatalogTopic[], now = Date.now()): void {
    const deleteStmt = this.db.prepare('DELETE FROM topics WHERE forum_id = ?');
    const upsertStmt = this.db.prepare(`
      INSERT INTO topics (
        topic_id, forum_id, section, forum_label, title, normalized_title, url, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(topic_id) DO UPDATE SET
        forum_id = excluded.forum_id,
        section = excluded.section,
        forum_label = excluded.forum_label,
        title = excluded.title,
        normalized_title = excluded.normalized_title,
        url = excluded.url,
        updated_at = excluded.updated_at
    `);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      deleteStmt.run(forumId);
      for (const t of topics) {
        upsertStmt.run(
          t.topicId,
          t.forumId,
          t.section,
          t.forumLabel,
          t.title,
          t.normalizedTitle,
          t.url,
          now
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  searchTopics(options: SearchTopicsOptions): SearchTopicsResponse {
    const normalized = normalizeSearchText(options.query);
    if (!normalized) {
      return { results: [], total: 0 };
    }

    const tokens = normalized.split(' ').filter((tok) => tok.length > 0);
    if (tokens.length === 0) {
      return { results: [], total: 0 };
    }

    const ftsQuery = tokens.map((tok) => `"${tok}"*`).join(' ');
    const limit = Math.max(1, Math.min(options.limit ?? 30, 100));

    const whereClauses: string[] = ['topics_fts MATCH ?'];
    const filterParams: (string | number)[] = [ftsQuery];

    if (options.section && options.section !== 'all') {
      whereClauses.push('t.section = ?');
      filterParams.push(options.section);
    }

    if (typeof options.forumId === 'number' && Number.isInteger(options.forumId)) {
      whereClauses.push('t.forum_id = ?');
      filterParams.push(options.forumId);
    }

    const whereSql = whereClauses.join(' AND ');

    const countRow = this.db
      .prepare(
        `
        SELECT COUNT(*) AS cnt
        FROM topics_fts
        JOIN topics t ON t.topic_id = topics_fts.rowid
        WHERE ${whereSql}
      `
      )
      .get(...filterParams) as { cnt: number } | undefined;

    const total = countRow?.cnt ?? 0;
    if (total === 0) {
      return { results: [], total: 0 };
    }

    const rows = this.db
      .prepare(
        `
        SELECT
          t.topic_id,
          t.forum_id,
          t.section,
          t.forum_label,
          t.title,
          t.normalized_title,
          t.url
        FROM topics_fts
        JOIN topics t ON t.topic_id = topics_fts.rowid
        WHERE ${whereSql}
        ORDER BY
          CASE
            WHEN t.normalized_title = ? THEN 0
            WHEN t.normalized_title LIKE ? THEN 1
            ELSE 2
          END,
          bm25(topics_fts),
          t.title COLLATE NOCASE
        LIMIT ?
      `
      )
      .all(...filterParams, normalized, `${normalized}%`, limit) as unknown as TopicRow[];

    return {
      results: rows.map(rowToTopic),
      total,
    };
  }

  getTopicById(topicId: number): CatalogTopic | null {
    const row = this.db
      .prepare(
        `
        SELECT topic_id, forum_id, section, forum_label, title, normalized_title, url
        FROM topics
        WHERE topic_id = ?
      `
      )
      .get(topicId) as unknown as TopicRow | undefined;

    return row ? rowToTopic(row) : null;
  }

  getCachedThreadBooks(
    topicId: number,
    maxAgeMs: number,
    now = Date.now()
  ): CachedThreadEntry | null {
    const row = this.db
      .prepare(
        `
        SELECT fetched_at, total_pages, fetched_pages, truncated, books_json
        FROM topic_books_cache
        WHERE topic_id = ?
      `
      )
      .get(topicId) as
      | {
          fetched_at: number;
          total_pages: number;
          fetched_pages: number;
          truncated: number;
          books_json: string;
        }
      | undefined;

    if (!row) {
      return null;
    }
    if (now - row.fetched_at > maxAgeMs) {
      return null;
    }

    try {
      const books = JSON.parse(row.books_json) as ThreadBook[];
      if (!Array.isArray(books)) {
        return null;
      }
      return {
        fetchedAt: row.fetched_at,
        totalPages: row.total_pages,
        fetchedPages: row.fetched_pages,
        truncated: row.truncated === 1,
        books,
      };
    } catch {
      return null;
    }
  }

  saveCachedThreadBooks(topicId: number, entry: CachedThreadEntry): void {
    this.db
      .prepare(
        `
        INSERT INTO topic_books_cache (
          topic_id, fetched_at, total_pages, fetched_pages, truncated, books_json
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(topic_id) DO UPDATE SET
          fetched_at = excluded.fetched_at,
          total_pages = excluded.total_pages,
          fetched_pages = excluded.fetched_pages,
          truncated = excluded.truncated,
          books_json = excluded.books_json
      `
      )
      .run(
        topicId,
        entry.fetchedAt,
        entry.totalPages,
        entry.fetchedPages,
        entry.truncated ? 1 : 0,
        JSON.stringify(entry.books)
      );
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `
        INSERT INTO sync_meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
      )
      .run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row ? row.value : null;
  }

  deleteMeta(key: string): void {
    this.db.prepare('DELETE FROM sync_meta WHERE key = ?').run(key);
  }

  getStats(): StoreStats {
    const sectionRows = this.db
      .prepare('SELECT section, COUNT(*) AS cnt FROM topics GROUP BY section')
      .all() as Array<{ section: string; cnt: number }>;

    let domace = 0;
    let strane = 0;
    for (const r of sectionRows) {
      if (r.section === 'domace') {
        domace = r.cnt;
      } else if (r.section === 'strane') {
        strane = r.cnt;
      }
    }

    const lastSyncedRaw = this.getMeta('last_synced_at');
    const lastSyncedAt = lastSyncedRaw ? parseInt(lastSyncedRaw, 10) : null;
    const lastError = this.getMeta('last_error');

    return {
      topicCount: domace + strane,
      countsBySection: { domace, strane },
      lastSyncedAt: lastSyncedAt && !Number.isNaN(lastSyncedAt) ? lastSyncedAt : null,
      lastError,
    };
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }
}
