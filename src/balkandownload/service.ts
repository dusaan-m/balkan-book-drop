import { logger } from '../logger.js';
import {
  EBOOK_FORUMS,
  buildTopicPageUrl,
  buildTopicsListUrl,
  isBalkanDownloadUrl,
  type CatalogStatus,
  type ForumDef,
  type ForumSection,
  type ThreadBook,
  type ThreadBooksResult,
} from './forums.js';
import { parseThreadPage, parseTopicsList } from './parser.js';
import { BalkanDownloadStore, type SearchTopicsResponse } from './store.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface BalkanDownloadServiceOptions {
  dbPath: string;
  syncIntervalMs: number;
  threadCacheTtlMs: number;
  maxThreadPages: number;
  requestTimeoutMs: number;
  requestDelayMs?: number;
  forums?: readonly ForumDef[];
  fetchFn?: FetchLike;
}

export class BalkanDownloadUpstreamError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'BalkanDownloadUpstreamError';
  }
}

export class BalkanDownloadNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BalkanDownloadNotFoundError';
  }
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'sr-RS,sr;q=0.9,hr;q=0.8,en;q=0.7',
};

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BalkanDownloadService {
  readonly store: BalkanDownloadStore;
  private readonly syncIntervalMs: number;
  private readonly threadCacheTtlMs: number;
  private readonly maxThreadPages: number;
  private readonly requestTimeoutMs: number;
  private readonly requestDelayMs: number;
  private readonly forums: readonly ForumDef[];
  private readonly fetchFn: FetchLike;

  private syncInFlight: Promise<CatalogStatus> | null = null;
  private readonly threadInFlight = new Map<number, Promise<ThreadBooksResult>>();

  constructor(options: BalkanDownloadServiceOptions) {
    this.store = new BalkanDownloadStore(options.dbPath);
    this.syncIntervalMs = options.syncIntervalMs;
    this.threadCacheTtlMs = options.threadCacheTtlMs;
    this.maxThreadPages = Math.max(1, options.maxThreadPages);
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.requestDelayMs = options.requestDelayMs ?? 350;
    this.forums = options.forums ?? EBOOK_FORUMS;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async fetchHtml(url: string): Promise<string> {
    if (!isBalkanDownloadUrl(url)) {
      throw new BalkanDownloadUpstreamError('Refused non-BalkanDownload URL.');
    }

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'GET',
        headers: DEFAULT_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BalkanDownloadUpstreamError(`Could not reach BalkanDownload: ${msg}`);
    }

    if (!res.ok) {
      throw new BalkanDownloadUpstreamError(
        `BalkanDownload returned HTTP ${res.status}.`,
        res.status
      );
    }

    return res.text();
  }

  getStatus(): CatalogStatus {
    const stats = this.store.getStats();
    return {
      syncing: this.syncInFlight !== null,
      topicCount: stats.topicCount,
      countsBySection: stats.countsBySection,
      lastSyncedAt: stats.lastSyncedAt,
      lastError: stats.lastError,
    };
  }

  searchTopics(options: {
    query: string;
    section?: ForumSection | 'all';
    forumId?: number;
    limit?: number;
  }): SearchTopicsResponse {
    return this.store.searchTopics(options);
  }

  /**
   * Starts a background catalog sync if the catalog is empty or stale.
   * Returns true if a sync was started (or already running).
   */
  ensureFreshCatalog(): boolean {
    if (this.syncInFlight) {
      return true;
    }
    const stats = this.store.getStats();
    const isStale =
      stats.topicCount === 0 ||
      stats.lastSyncedAt === null ||
      Date.now() - stats.lastSyncedAt >= this.syncIntervalMs;

    if (!isStale) {
      return false;
    }

    void this.syncCatalog().catch((err) => {
      logger.warn({ err }, 'Background BalkanDownload catalog sync failed');
    });
    return true;
  }

  syncCatalog(): Promise<CatalogStatus> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = this.runSyncCatalog().finally(() => {
      this.syncInFlight = null;
    });

    return this.syncInFlight;
  }

  private async runSyncCatalog(): Promise<CatalogStatus> {
    const startedAt = Date.now();
    let succeededForums = 0;
    const failedForums: string[] = [];

    logger.info({ forums: this.forums.length }, 'Starting BalkanDownload catalog sync');

    for (let i = 0; i < this.forums.length; i++) {
      const forum = this.forums[i];
      if (i > 0) {
        await sleep(this.requestDelayMs);
      }
      try {
        const html = await this.fetchHtml(buildTopicsListUrl(forum.id));
        const topics = parseTopicsList(html, forum);
        // Only replace forum entries if we received valid topicslist markup;
        // prevents wiping the index if upstream returns an unexpected error page with 200 OK.
        if (topics.length > 0 || html.includes('mlist_content')) {
          this.store.replaceForumTopics(forum.id, topics, Date.now());
          succeededForums++;
          logger.debug({ forumId: forum.id, count: topics.length }, 'Synced BalkanDownload forum');
        } else {
          failedForums.push(`f=${forum.id} (unexpected page structure)`);
          logger.warn(
            { forumId: forum.id },
            'BalkanDownload topicslist response missing expected table markup'
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failedForums.push(`f=${forum.id} (${msg})`);
        logger.warn({ forumId: forum.id, err }, 'Failed to sync BalkanDownload forum');
      }
    }

    if (succeededForums > 0) {
      this.store.setMeta('last_synced_at', String(Date.now()));
    }

    if (failedForums.length > 0) {
      this.store.setMeta('last_error', `Failed forums: ${failedForums.join('; ')}`);
    } else {
      this.store.deleteMeta('last_error');
    }

    const status: CatalogStatus = {
      ...this.getStatus(),
      syncing: false,
    };
    logger.info(
      {
        ms: Date.now() - startedAt,
        succeededForums,
        failedForums: failedForums.length,
        topicCount: status.topicCount,
      },
      'Finished BalkanDownload catalog sync'
    );
    return status;
  }

  async getTopicBooks(
    topicId: number,
    options?: { refresh?: boolean }
  ): Promise<ThreadBooksResult> {
    const topic = this.store.getTopicById(topicId);
    if (!topic) {
      throw new BalkanDownloadNotFoundError('Topic not found in catalog.');
    }

    const refresh = options?.refresh === true;
    if (!refresh) {
      const cached = this.store.getCachedThreadBooks(topicId, this.threadCacheTtlMs);
      if (cached) {
        return {
          topic,
          books: cached.books,
          totalPages: cached.totalPages,
          fetchedPages: cached.fetchedPages,
          truncated: cached.truncated,
          cachedAt: cached.fetchedAt,
          fromCache: true,
        };
      }
    }

    const existing = this.threadInFlight.get(topicId);
    if (existing) {
      return existing;
    }

    const promise = this.fetchAndCacheTopicBooks(topic.topicId).finally(() => {
      this.threadInFlight.delete(topicId);
    });
    this.threadInFlight.set(topicId, promise);
    return promise;
  }

  private async fetchAndCacheTopicBooks(topicId: number): Promise<ThreadBooksResult> {
    const topic = this.store.getTopicById(topicId);
    if (!topic) {
      throw new BalkanDownloadNotFoundError('Topic not found in catalog.');
    }

    const page1Url = buildTopicPageUrl(topic.url, 1);
    const page1Html = await this.fetchHtml(page1Url);
    const page1 = parseThreadPage(page1Html, topic.title);

    const totalPages = Math.max(1, page1.totalPages);
    const pagesToFetch = Math.min(totalPages, this.maxThreadPages);
    const truncated = totalPages > this.maxThreadPages;

    const seenPids = new Set<number>();
    const allBooks: ThreadBook[] = [];

    const appendBooks = (books: ThreadBook[]) => {
      for (const b of books) {
        if (!seenPids.has(b.pid)) {
          seenPids.add(b.pid);
          allBooks.push(b);
        }
      }
    };

    appendBooks(page1.books);

    let fetchedPages = 1;
    for (let pageNum = 2; pageNum <= pagesToFetch; pageNum++) {
      await sleep(this.requestDelayMs);
      const pageUrl = buildTopicPageUrl(topic.url, pageNum);
      const pageHtml = await this.fetchHtml(pageUrl);
      const parsed = parseThreadPage(pageHtml, topic.title);
      appendBooks(parsed.books);
      fetchedPages++;
    }

    const fetchedAt = Date.now();
    this.store.saveCachedThreadBooks(topicId, {
      fetchedAt,
      totalPages,
      fetchedPages,
      truncated,
      books: allBooks,
    });

    return {
      topic,
      books: allBooks,
      totalPages,
      fetchedPages,
      truncated,
      cachedAt: fetchedAt,
      fromCache: false,
    };
  }

  close(): void {
    this.store.close();
  }
}
