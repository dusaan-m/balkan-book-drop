import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EBOOK_FORUMS, type ForumDef } from '../src/balkandownload/forums.js';
import { BalkanDownloadStore } from '../src/balkandownload/store.js';
import {
  BalkanDownloadNotFoundError,
  BalkanDownloadService,
  type FetchLike,
} from '../src/balkandownload/service.js';
import { buildIndexedNormalizedTitle } from '../src/balkandownload/parser.js';

function makeResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

describe('BalkanDownloadStore — SQLite FTS5 & caching', () => {
  it('searches across diacritics, đ/dj/d variants, and section filters', () => {
    const store = new BalkanDownloadStore(':memory:');
    try {
      store.replaceForumTopics(35, [
        {
          topicId: 72947,
          forumId: 35,
          section: 'domace',
          forumLabel: 'Domaće',
          title: 'Mirko Kovač',
          normalizedTitle: buildIndexedNormalizedTitle('Mirko Kovač'),
          url: 'https://www.balkandownload.org/topic/72947-mirko-kovac/',
        },
        {
          topicId: 81000,
          forumId: 35,
          section: 'domace',
          forumLabel: 'Domaće',
          title: 'Đorđe Bajić',
          normalizedTitle: buildIndexedNormalizedTitle('Đorđe Bajić'),
          url: 'https://www.balkandownload.org/topic/81000-djordje-bajic/',
        },
      ]);
      store.replaceForumTopics(36, [
        {
          topicId: 73299,
          forumId: 36,
          section: 'strane',
          forumLabel: 'Strane',
          title: 'Abbi Glines',
          normalizedTitle: buildIndexedNormalizedTitle('Abbi Glines'),
          url: 'https://www.balkandownload.org/topic/73299-abbi-glines/',
        },
      ]);

      assert.equal(store.searchTopics({ query: 'kovac' }).results[0]?.topicId, 72947);
      assert.equal(store.searchTopics({ query: 'Kovač' }).results[0]?.topicId, 72947);
      assert.equal(store.searchTopics({ query: 'djordje' }).results[0]?.topicId, 81000);
      assert.equal(store.searchTopics({ query: 'dorde' }).results[0]?.topicId, 81000);
      assert.equal(store.searchTopics({ query: 'Đorđe' }).results[0]?.topicId, 81000);

      // Section filtering
      assert.equal(store.searchTopics({ query: 'abbi', section: 'domace' }).total, 0);
      assert.equal(store.searchTopics({ query: 'abbi', section: 'strane' }).total, 1);

      const stats = store.getStats();
      assert.equal(stats.topicCount, 3);
      assert.deepEqual(stats.countsBySection, { domace: 2, strane: 1 });
    } finally {
      store.close();
    }
  });

  it('replaces a single forum atomically without affecting other forums', () => {
    const store = new BalkanDownloadStore(':memory:');
    try {
      store.replaceForumTopics(35, [
        {
          topicId: 1,
          forumId: 35,
          section: 'domace',
          forumLabel: 'Domaće',
          title: 'Old Author',
          normalizedTitle: 'old author',
          url: 'https://www.balkandownload.org/topic/1-old-author/',
        },
      ]);
      store.replaceForumTopics(36, [
        {
          topicId: 2,
          forumId: 36,
          section: 'strane',
          forumLabel: 'Strane',
          title: 'Foreign Author',
          normalizedTitle: 'foreign author',
          url: 'https://www.balkandownload.org/topic/2-foreign-author/',
        },
      ]);

      // Replace forum 35 with a new topic
      store.replaceForumTopics(35, [
        {
          topicId: 3,
          forumId: 35,
          section: 'domace',
          forumLabel: 'Domaće',
          title: 'New Author',
          normalizedTitle: 'new author',
          url: 'https://www.balkandownload.org/topic/3-new-author/',
        },
      ]);

      assert.equal(store.searchTopics({ query: 'Old Author' }).total, 0);
      assert.equal(store.searchTopics({ query: 'New Author' }).total, 1);
      assert.equal(store.searchTopics({ query: 'Foreign Author' }).total, 1);
    } finally {
      store.close();
    }
  });
});

describe('BalkanDownloadService — sync, pagination cap, and thread cache', () => {
  const twoForums: readonly ForumDef[] = [EBOOK_FORUMS[0], EBOOK_FORUMS[EBOOK_FORUMS.length - 1]];

  it('syncs catalog, fetches paginated thread up to cap, and serves subsequent requests from cache', async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      if (url.includes('topicslist&f=35')) {
        return makeResponse(`
          <div id="mlist_content">
            <table class="ipb_table">
              <tr id="trow_25390"><td class="altrow">
                <a href="https://www.balkandownload.org/topic/25390-robert-ludlum/">Robert Ludlum</a>
              </td></tr>
            </table>
          </div>
        `);
      }
      if (url.includes('topicslist&f=36')) {
        return makeResponse(`
          <div id="mlist_content">
            <table class="ipb_table">
              <tr id="trow_73299"><td class="altrow">
                <a href="https://www.balkandownload.org/topic/73299-abbi-glines/">Abbi Glines</a>
              </td></tr>
            </table>
          </div>
        `);
      }
      if (url === 'https://www.balkandownload.org/topic/25390-robert-ludlum/') {
        return makeResponse(`
          <div class="pagination">Page 1 of 3 <a href="/topic/25390-robert-ludlum/page-3">3</a></div>
          <div id="ips_Posts">
            <div class="post_block" id="post_id_1001">
              <a itemprop="replyToUrl" data-entry-pid="1001" href="https://www.balkandownload.org/topic/25390-robert-ludlum/#entry1001">#1</a>
              <div itemprop="commentText" class="post entry-content">
                <p><strong>Ostermanov vikend</strong></p>
                <p>EPUB</p>
                <div class="message error">Hidden Content</div>
              </div>
            </div>
          </div>
        `);
      }
      if (url === 'https://www.balkandownload.org/topic/25390-robert-ludlum/page-2') {
        return makeResponse(`
          <div id="ips_Posts">
            <div class="post_block" id="post_id_1002">
              <a itemprop="replyToUrl" data-entry-pid="1002" href="https://www.balkandownload.org/topic/25390-robert-ludlum/page-2#entry1002">#21</a>
              <div itemprop="commentText" class="post entry-content">
                <p><strong>Bornov identitet</strong></p>
                <p>PDF</p>
                <div class="message error">Hidden Content</div>
              </div>
            </div>
          </div>
        `);
      }
      return makeResponse('Not found', 404);
    };

    const service = new BalkanDownloadService({
      dbPath: ':memory:',
      syncIntervalMs: 60_000,
      threadCacheTtlMs: 60_000,
      maxThreadPages: 2,
      requestTimeoutMs: 5_000,
      requestDelayMs: 0,
      forums: twoForums,
      fetchFn,
    });

    try {
      const status = await service.syncCatalog();
      assert.equal(status.topicCount, 2);
      assert.equal(status.lastError, null);
      assert.ok(status.lastSyncedAt !== null);

      const first = await service.getTopicBooks(25390);
      assert.equal(first.fromCache, false);
      assert.equal(first.totalPages, 3);
      assert.equal(first.fetchedPages, 2);
      assert.equal(first.truncated, true);
      assert.deepEqual(
        first.books.map((b) => b.title),
        ['Ostermanov vikend', 'Bornov identitet']
      );

      const callsBeforeCache = calls.length;
      const second = await service.getTopicBooks(25390);
      assert.equal(second.fromCache, true);
      assert.equal(calls.length, callsBeforeCache);

      // Force refresh bypasses cache
      const refreshed = await service.getTopicBooks(25390, { refresh: true });
      assert.equal(refreshed.fromCache, false);
      assert.equal(calls.length, callsBeforeCache + 2);

      // Unknown topic throws BalkanDownloadNotFoundError without fetching
      await assert.rejects(() => service.getTopicBooks(999999), BalkanDownloadNotFoundError);
    } finally {
      service.close();
    }
  });
});
