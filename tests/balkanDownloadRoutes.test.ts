import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { EBOOK_FORUMS } from '../src/balkandownload/forums.js';
import { BalkanDownloadService, type FetchLike } from '../src/balkandownload/service.js';

function makeResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

describe('BalkanDownload API routes', () => {
  let service: BalkanDownloadService;
  let server: http.Server;
  let shouldFailUpstream = false;

  before(async () => {
    const fetchFn: FetchLike = async (url) => {
      if (shouldFailUpstream) {
        return makeResponse('Upstream down', 503);
      }
      if (url.includes('topicslist&f=35')) {
        return makeResponse(`
          <div id="mlist_content">
            <table class="ipb_table">
              <tr id="trow_72947"><td class="altrow">
                <a href="https://www.balkandownload.org/topic/72947-mirko-kovac/">Mirko Kovač</a>
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
      if (url.includes('/topic/72947-mirko-kovac/')) {
        return makeResponse(`
          <div id="ips_Posts">
            <div class="post_block" id="post_id_310799">
              <a itemprop="replyToUrl" data-entry-pid="310799"
                 href="https://www.balkandownload.org/topic/72947-mirko-kovac/#entry310799">#1</a>
              <span itemprop="creator name" class="author vcard">zuls</span>
              <abbr class="published" itemprop="commentTime" title="2017-08-22T13:06:34+00:00">22 Aug</abbr>
              <div itemprop="commentText" class="post entry-content">
                <p><span style="font-size:28px">Ruganje s dušom</span></p>
                <p>EPUB, PDF</p>
                <div class="message error">Hidden Content</div>
              </div>
              <div id="thankersBox_310799">Thanked by 12 Members</div>
            </div>
          </div>
        `);
      }
      return makeResponse('Not found', 404);
    };

    service = new BalkanDownloadService({
      dbPath: ':memory:',
      syncIntervalMs: 60_000,
      threadCacheTtlMs: 60_000,
      maxThreadPages: 5,
      requestTimeoutMs: 5_000,
      requestDelayMs: 0,
      forums: [EBOOK_FORUMS[0], EBOOK_FORUMS[EBOOK_FORUMS.length - 1]],
      fetchFn,
    });

    const { app } = createApp({ balkanDownload: service });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    service.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const req = () => supertest(server);

  it('requires XHR header on POST /api/balkandownload/sync and syncs when provided', async () => {
    const forbidden = await req()
      .post('/api/balkandownload/sync')
      .set('X-Forwarded-Proto', 'https');
    assert.equal(forbidden.status, 403);

    const synced = await req()
      .post('/api/balkandownload/sync?wait=1')
      .set('X-Forwarded-Proto', 'https')
      .set('X-Requested-With', 'XMLHttpRequest');
    assert.equal(synced.status, 200);
    assert.equal(synced.body.topicCount, 2);
    assert.deepEqual(synced.body.countsBySection, { domace: 1, strane: 1 });
  });

  it('returns status and searches synced topics with section filtering', async () => {
    const statusRes = await req()
      .get('/api/balkandownload/status')
      .set('X-Forwarded-Proto', 'https');
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.enabled, true);
    assert.equal(statusRes.body.topicCount, 2);

    const emptyQ = await req().get('/api/balkandownload/search').set('X-Forwarded-Proto', 'https');
    assert.equal(emptyQ.status, 400);

    const badSection = await req()
      .get('/api/balkandownload/search?q=kovac&section=invalid')
      .set('X-Forwarded-Proto', 'https');
    assert.equal(badSection.status, 400);

    const searchRes = await req()
      .get('/api/balkandownload/search?q=kovac&section=domace')
      .set('X-Forwarded-Proto', 'https');
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.body.total, 1);
    assert.equal(searchRes.body.results[0].topicId, 72947);
    assert.equal(searchRes.body.results[0].title, 'Mirko Kovač');
  });

  it('fetches books for a valid topic, rejects invalid/unknown IDs, and returns 502 on upstream failure', async () => {
    const badId = await req()
      .get('/api/balkandownload/topics/not-a-number/books')
      .set('X-Forwarded-Proto', 'https');
    assert.equal(badId.status, 400);

    const unknownId = await req()
      .get('/api/balkandownload/topics/999999/books')
      .set('X-Forwarded-Proto', 'https');
    assert.equal(unknownId.status, 404);

    const booksRes = await req()
      .get('/api/balkandownload/topics/72947/books')
      .set('X-Forwarded-Proto', 'https');
    assert.equal(booksRes.status, 200);
    assert.equal(booksRes.body.books.length, 1);
    assert.equal(booksRes.body.books[0].title, 'Ruganje s dušom');
    assert.equal(booksRes.body.books[0].thanksCount, 12);
    assert.equal(
      booksRes.body.books[0].postUrl,
      'https://www.balkandownload.org/index.php?app=forums&module=forums&section=findpost&pid=310799'
    );

    // Upstream failure on forced refresh returns 502
    shouldFailUpstream = true;
    try {
      const upstreamErr = await req()
        .get('/api/balkandownload/topics/72947/books?refresh=1')
        .set('X-Forwarded-Proto', 'https');
      assert.equal(upstreamErr.status, 502);
    } finally {
      shouldFailUpstream = false;
    }
  });
});
