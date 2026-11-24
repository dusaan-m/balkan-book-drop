import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EBOOK_FORUMS_BY_ID } from '../src/balkandownload/forums.js';
import {
  buildIndexedNormalizedTitle,
  normalizeSearchText,
  parseThreadPage,
  parseTopicsList,
} from '../src/balkandownload/parser.js';

describe('balkandownload parser — text normalization', () => {
  it('strips ex-YU diacritics and maps đ to dj', () => {
    assert.equal(normalizeSearchText('Mirko Kovač'), 'mirko kovac');
    assert.equal(normalizeSearchText('Ćamil Sijarić'), 'camil sijaric');
    assert.equal(normalizeSearchText('Đorđe Bajić'), 'djordje bajic');
    assert.equal(normalizeSearchText('Šćepan Živković'), 'scepan zivkovic');
  });

  it('indexes both dj and d variants when title contains đ', () => {
    const indexed = buildIndexedNormalizedTitle('Đorđe Bajić');
    assert.match(indexed, /\bdjordje bajic\b/);
    assert.match(indexed, /\bdorde bajic\b/);
  });

  it('does not duplicate normalized title when đ is absent', () => {
    assert.equal(buildIndexedNormalizedTitle('Mirko Kovač'), 'mirko kovac');
  });
});

describe('balkandownload parser — parseTopicsList', () => {
  const domaceForum = EBOOK_FORUMS_BY_ID.get(35)!;

  it('parses topics, skips blocklisted utility topics, and rejects non-balkandownload URLs', () => {
    const html = `
      <div class="ipsBox_container ipsPad" id="mlist_content">
        <table class="ipb_table">
          <tbody>
            <tr class="header"><th><strong>A</strong></th></tr>
            <tr class="row2" id="trow_90249">
              <td class="altrow">
                <a href="https://www.balkandownload.org/topic/90249-a-a-milne/">A. A. Milne</a>
              </td>
            </tr>
            <tr class="row1" id="trow_50815">
              <td class="altrow">
                <a href="https://www.balkandownload.org/topic/50815-pravila/">Pravila foruma</a>
              </td>
            </tr>
            <tr class="row2" id="trow_72947">
              <td class="altrow">
                <a href="/topic/72947-mirko-kovac/">  Mirko   Kovač  </a>
              </td>
            </tr>
            <tr class="row1" id="trow_99999">
              <td class="altrow">
                <a href="https://evil.example.com/topic/99999-phish/">External</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const topics = parseTopicsList(html, domaceForum);
    assert.equal(topics.length, 2);
    assert.deepEqual(
      topics.map((t) => ({ id: t.topicId, title: t.title, url: t.url, section: t.section })),
      [
        {
          id: 90249,
          title: 'A. A. Milne',
          url: 'https://www.balkandownload.org/topic/90249-a-a-milne/',
          section: 'domace',
        },
        {
          id: 72947,
          title: 'Mirko Kovač',
          url: 'https://www.balkandownload.org/topic/72947-mirko-kovac/',
          section: 'domace',
        },
      ]
    );
  });
});

describe('balkandownload parser — parseThreadPage', () => {
  it('detects total pages from pagination links and label', () => {
    const html = `
      <div class="pagination">
        <span>Page 1 of 4</span>
        <a href="https://www.balkandownload.org/topic/25390-robert-ludlum/page-2">2</a>
        <a href="https://www.balkandownload.org/topic/25390-robert-ludlum/page-4">4</a>
      </div>
      <div id="ips_Posts"></div>
    `;
    const parsed = parseThreadPage(html, 'Robert Ludlum');
    assert.equal(parsed.totalPages, 4);
    assert.equal(parsed.books.length, 0);
  });

  it('extracts books across all observed BBCode patterns and filters out chatter posts', () => {
    const html = `
      <div id="ips_Posts">
        <!-- Pattern 1: Large colored header span + author span to skip -->
        <div class="post_block" id="post_id_310799">
          <a itemprop="replyToUrl" data-entry-pid="310799"
             href="https://www.balkandownload.org/topic/72947-mirko-kovac/#entry310799">#1</a>
          <span itemprop="creator name" class="author vcard">zuls</span>
          <abbr class="published" itemprop="commentTime" title="2017-08-22T13:06:34+00:00">22 Aug</abbr>
          <div itemprop="commentText" class="post entry-content">
            <p style="text-align:center"><span style="font-size:24px">Mirko Kovač</span></p>
            <p style="text-align:center"><span style="color:#ffd700"><span style="font-size:36px">Ruganje s dušom</span></span></p>
            <p>Format: epub, pdf, azw3</p>
            <div class="message error">Hidden Content: You must reply or thank to see links</div>
          </div>
          <div id="thankersBox_310799">Thanked by 27 Members</div>
        </div>

        <!-- Chatter post without hidden content: must be skipped -->
        <div class="post_block" id="post_id_310800">
          <a itemprop="replyToUrl" data-entry-pid="310800"
             href="https://www.balkandownload.org/topic/72947-mirko-kovac/#entry310800">#2</a>
          <span itemprop="creator name" class="author vcard">reader1</span>
          <abbr class="published" itemprop="commentTime" title="2017-08-23T10:00:00+00:00">23 Aug</abbr>
          <div itemprop="commentText" class="post entry-content">
            <p>Hvala puno na knjizi!</p>
          </div>
        </div>

        <!-- Pattern 2 & 4: Strong header + multi-book blockquote pack -->
        <div class="post_block" id="post_id_310801">
          <a itemprop="replyToUrl" data-entry-pid="310801"
             href="https://www.balkandownload.org/topic/25390-robert-ludlum/#entry310801">#3</a>
          <span itemprop="creator name" class="author vcard">uploader2</span>
          <abbr class="published" itemprop="commentTime" title="2019-01-10T12:00:00+00:00">10 Jan</abbr>
          <div itemprop="commentText" class="post entry-content">
            <p><strong>Robert Ludlum - Komplet knjiga</strong></p>
            <blockquote>
              <p>Upakovane sledece knjige:</p>
              <p>* Ikarov Podsetnik I</p>
              <p>* Ostermanov vikend</p>
            </blockquote>
            <p>Formati: mobi i pdf</p>
            <!--TB_HIDE_CONTENT-->
          </div>
        </div>

        <!-- Pattern 3: Plain first line before img & Overview: -->
        <div class="post_block" id="post_id_310802">
          <a itemprop="replyToUrl" data-entry-pid="310802"
             href="https://www.balkandownload.org/topic/73299-abbi-glines/#entry310802">#4</a>
          <span itemprop="creator name" class="author vcard">engbook</span>
          <abbr class="published" itemprop="commentTime" title="2020-05-01T08:00:00+00:00">01 May</abbr>
          <div itemprop="commentText" class="post entry-content">
            Abbi Glines (Sweet #1) Sweet Little Thing<br/>
            <img class="bbc_img" src="https://img.example.com/cover.jpg" /><br/>
            Overview: A romantic story about love and choices. (EPUB)
            <div class="message error">Hidden Content</div>
          </div>
        </div>

        <!-- Pattern 5: Fallback when post jumps straight into long blurb -->
        <div class="post_block" id="post_id_310803">
          <a itemprop="replyToUrl" data-entry-pid="310803"
             href="https://www.balkandownload.org/topic/72084-adam-croft/#entry310803">#5</a>
          <span itemprop="creator name" class="author vcard">mysteryfan</span>
          <abbr class="published" itemprop="commentTime" title="2021-03-14T16:00:00+00:00">14 Mar</abbr>
          <div itemprop="commentText" class="post entry-content">
            <p>A GRIPPING PSYCHOLOGICAL THRILLER WITH A TWIST YOU WILL NEVER SEE COMING THAT KEEPS YOU GUESSING UNTIL THE VERY LAST PAGE OF THIS UNFORGETTABLE NOVEL ABOUT SECRETS AND LIES IN A QUIET VILLAGE.</p>
            <div class="message error">Hidden Content</div>
          </div>
        </div>
      </div>
    `;

    const parsed = parseThreadPage(html, 'Mirko Kovač');
    assert.equal(parsed.totalPages, 1);
    assert.equal(parsed.books.length, 4);

    // Post 1: Large span
    assert.equal(parsed.books[0].pid, 310799);
    assert.equal(parsed.books[0].title, 'Ruganje s dušom');
    assert.deepEqual(parsed.books[0].formats, ['EPUB', 'AZW3', 'PDF']);
    assert.equal(parsed.books[0].thanksCount, 27);
    assert.equal(parsed.books[0].uploader, 'zuls');
    assert.equal(
      parsed.books[0].postUrl,
      'https://www.balkandownload.org/index.php?app=forums&module=forums&section=findpost&pid=310799'
    );

    // Post 3: Strong header + blockquote subtitles
    assert.equal(parsed.books[1].pid, 310801);
    assert.equal(parsed.books[1].title, 'Robert Ludlum - Komplet knjiga');
    assert.deepEqual(parsed.books[1].subtitles, ['Ikarov Podsetnik I', 'Ostermanov vikend']);
    assert.deepEqual(parsed.books[1].formats, ['MOBI', 'PDF']);

    // Post 4: Plain line before image
    assert.equal(parsed.books[2].pid, 310802);
    assert.equal(parsed.books[2].title, 'Abbi Glines (Sweet #1) Sweet Little Thing');
    assert.deepEqual(parsed.books[2].formats, ['EPUB']);

    // Post 5: Fallback preview
    assert.equal(parsed.books[3].pid, 310803);
    assert.match(parsed.books[3].title, /^Post #5 — A GRIPPING PSYCHOLOGICAL THRILLER/);
  });
});
