import express from 'express';
import {
  BALKANDOWNLOAD_SEARCH_RATE_LIMIT_MAX,
  BALKANDOWNLOAD_SYNC_RATE_LIMIT_MAX,
  BALKANDOWNLOAD_THREAD_RATE_LIMIT_MAX,
} from '../config.js';
import { makeLimiter, requireXhr } from '../middleware.js';
import { logger } from '../logger.js';
import { EBOOK_FORUMS, EBOOK_FORUMS_BY_ID, type ForumSection } from '../balkandownload/forums.js';
import {
  BalkanDownloadNotFoundError,
  BalkanDownloadUpstreamError,
  type BalkanDownloadService,
} from '../balkandownload/service.js';

const MAX_QUERY_LENGTH = 100;

function parseSection(raw: unknown): ForumSection | 'all' | null {
  if (raw === undefined || raw === '') {
    return 'all';
  }
  if (raw === 'all' || raw === 'domace' || raw === 'strane') {
    return raw;
  }
  return null;
}

export function makeBalkanDownloadRouter(service: BalkanDownloadService): express.Router {
  const router = express.Router();

  const searchLimiter = makeLimiter(BALKANDOWNLOAD_SEARCH_RATE_LIMIT_MAX);
  const threadLimiter = makeLimiter(BALKANDOWNLOAD_THREAD_RATE_LIMIT_MAX);
  const syncLimiter = makeLimiter(BALKANDOWNLOAD_SYNC_RATE_LIMIT_MAX);

  router.get('/api/balkandownload/status', searchLimiter, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      enabled: true,
      ...service.getStatus(),
      forums: EBOOK_FORUMS,
    });
  });

  router.get('/api/balkandownload/search', searchLimiter, (req, res) => {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!rawQuery) {
      res.status(400).json({ error: 'Search query is required.' });
      return;
    }
    if (rawQuery.length > MAX_QUERY_LENGTH) {
      res
        .status(400)
        .json({ error: `Search query must be ${MAX_QUERY_LENGTH} characters or less.` });
      return;
    }

    const section = parseSection(req.query.section);
    if (!section) {
      res.status(400).json({ error: 'Invalid section filter. Expected all, domace, or strane.' });
      return;
    }

    let forumId: number | undefined;
    if (typeof req.query.forumId === 'string' && req.query.forumId.trim() !== '') {
      if (!/^\d+$/.test(req.query.forumId.trim())) {
        res.status(400).json({ error: 'Invalid forumId.' });
        return;
      }
      const parsedForumId = parseInt(req.query.forumId.trim(), 10);
      if (!EBOOK_FORUMS_BY_ID.has(parsedForumId)) {
        res.status(400).json({ error: 'Unknown forumId.' });
        return;
      }
      forumId = parsedForumId;
    }

    let limit = 30;
    if (typeof req.query.limit === 'string' && req.query.limit.trim() !== '') {
      if (!/^\d+$/.test(req.query.limit.trim())) {
        res.status(400).json({ error: 'Invalid limit.' });
        return;
      }
      limit = Math.max(1, Math.min(parseInt(req.query.limit.trim(), 10), 100));
    }

    const { results, total } = service.searchTopics({
      query: rawQuery,
      section,
      forumId,
      limit,
    });

    res.set('Cache-Control', 'no-store');
    res.json({
      query: rawQuery,
      section,
      results,
      total,
      ...service.getStatus(),
    });
  });

  router.get('/api/balkandownload/topics/:topicId/books', threadLimiter, async (req, res, next) => {
    const rawId = typeof req.params.topicId === 'string' ? req.params.topicId : '';
    if (!/^\d+$/.test(rawId)) {
      res.status(400).json({ error: 'Invalid topic ID.' });
      return;
    }
    const topicId = parseInt(rawId, 10);
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';

    try {
      const data = await service.getTopicBooks(topicId, { refresh });
      res.set('Cache-Control', 'no-store');
      res.json(data);
    } catch (err) {
      if (err instanceof BalkanDownloadNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof BalkanDownloadUpstreamError) {
        logger.warn({ topicId, err: err.message }, 'Upstream BalkanDownload thread fetch failed');
        res.status(502).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.post('/api/balkandownload/sync', requireXhr, syncLimiter, async (req, res, next) => {
    const wait = req.query.wait === '1' || req.query.wait === 'true';
    try {
      const syncPromise = service.syncCatalog();
      if (wait) {
        const status = await syncPromise;
        res.set('Cache-Control', 'no-store');
        res.json({ started: true, ...status });
        return;
      }
      void syncPromise.catch((err) => {
        logger.warn({ err }, 'Manual BalkanDownload catalog sync failed');
      });
      res.set('Cache-Control', 'no-store');
      res.status(202).json({ started: true, ...service.getStatus() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
