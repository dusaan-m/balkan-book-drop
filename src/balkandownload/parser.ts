import * as cheerio from 'cheerio';
import {
  BALKANDOWNLOAD_ORIGIN,
  BLOCKED_TOPIC_IDS,
  buildFindPostUrl,
  isBalkanDownloadUrl,
  type CatalogTopic,
  type ForumDef,
  type ThreadBook,
} from './forums.js';

type CheerioSelection = ReturnType<cheerio.CheerioAPI>;

const FORMAT_REGEX = /\b(epub|azw3|mobi|pdf|djvu|docx|doc|fb2|cbr|cbz)\b/gi;
const FORMAT_PRIORITY = ['EPUB', 'AZW3', 'MOBI', 'PDF', 'FB2', 'DJVU', 'DOCX', 'DOC', 'CBZ', 'CBR'];

const SYNOPSIS_MARKER_REGEX =
  /^(overview|opis|sadržaj|sadrzaj|sinopsis|synopsis|kratak opis|o knjizi|radnja)\s*:/i;

const BOILERPLATE_LINE_REGEX =
  /^(download|link|linkovi|hidden content|skriveni sadr[zž]aj|format|jezik|language|pismo|obrada|sken|scan|izvor|source|upload|veličina|velicina|size|pages|strana|stranica|godina|year|publisher|izdava[cč]|isbn|goodreads|amazon|pdf|epub|mobi|azw3|djvu|srpski|hrvatski|bosanski|english|latinica|[cć]irilica)\b[:\s-]*$/i;

const PACK_INTRO_REGEX =
  /^(upakovane|sadr[zž]i|spisak|lista|knjige u (paketu|kompletu|arhivi)|books? included|contents?|includes?)\b.*:?$/i;

/**
 * Normalizes text for diacritic-insensitive ex-YU and Latin search.
 * Maps đ/Đ -> dj (and č/ć -> c, š -> s, ž -> z via NFD).
 */
export function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Builds the indexed normalized string for a topic title.
 * When the title contains `đ`/`Đ`, appends an alternate `d` spelling alongside `dj`
 * so queries for `đorđe`, `djordje`, and `dordje` all match.
 */
export function buildIndexedNormalizedTitle(title: string): string {
  const primary = normalizeSearchText(title);
  if (/[đĐ]/.test(title)) {
    const dVariant = title
      .toLowerCase()
      .replace(/đ/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
    if (dVariant && dVariant !== primary) {
      return `${primary} ${dVariant}`;
    }
  }
  return primary;
}

function resolveCanonicalUrl(rawHref: string | undefined): string | null {
  if (!rawHref) {
    return null;
  }
  const trimmed = rawHref.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const resolved = new URL(trimmed, BALKANDOWNLOAD_ORIGIN).toString();
    return isBalkanDownloadUrl(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

export function parseTopicsList(html: string, forum: ForumDef): CatalogTopic[] {
  const $ = cheerio.load(html);
  const seen = new Set<number>();
  const topics: CatalogTopic[] = [];

  $('#mlist_content table.ipb_table tr[id^="trow_"]').each((_idx, row) => {
    const $row = $(row);
    const rowId = $row.attr('id') ?? '';
    const $link = $row.find('td.altrow > a').first();
    const href = resolveCanonicalUrl($link.attr('href'));
    const title = $link.text().replace(/\s+/g, ' ').trim();

    if (!href || !title) {
      return;
    }

    let topicId = NaN;
    const idMatch = rowId.match(/^trow_(\d+)$/);
    if (idMatch) {
      topicId = parseInt(idMatch[1], 10);
    } else {
      const urlMatch = href.match(/\/topic\/(\d+)-/);
      if (urlMatch) {
        topicId = parseInt(urlMatch[1], 10);
      }
    }

    if (!Number.isInteger(topicId) || topicId <= 0) {
      return;
    }
    if (BLOCKED_TOPIC_IDS.has(topicId) || seen.has(topicId)) {
      return;
    }

    seen.add(topicId);
    topics.push({
      topicId,
      forumId: forum.id,
      section: forum.section,
      forumLabel: forum.shortLabel,
      title,
      normalizedTitle: buildIndexedNormalizedTitle(title),
      url: href,
    });
  });

  return topics;
}

export function detectTotalPages($: cheerio.CheerioAPI): number {
  let maxPage = 1;

  $('.pagination').each((_idx, el) => {
    const text = $(el).text();
    const ofMatch = text.match(/Page\s+\d+\s+of\s+(\d+)/i);
    if (ofMatch) {
      const n = parseInt(ofMatch[1], 10);
      if (Number.isInteger(n) && n > maxPage) {
        maxPage = n;
      }
    }

    $(el)
      .find('a[href]')
      .each((_aIdx, anchor) => {
        const href = $(anchor).attr('href') ?? '';
        const pageMatch = href.match(/\/page-(\d+)\b/i);
        if (pageMatch) {
          const n = parseInt(pageMatch[1], 10);
          if (Number.isInteger(n) && n > maxPage) {
            maxPage = n;
          }
        }
      });
  });

  return maxPage;
}

function cleanLine(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTopicAuthorAliases(topicTitle: string): Set<string> {
  const aliases = new Set<string>();
  const normFull = normalizeSearchText(topicTitle);
  if (normFull) {
    aliases.add(normFull);
  }
  // Handle "Original Name (Phonetic Name)" and "Author - Series"
  const beforeDash = topicTitle.split(/\s+[-–—]\s+/)[0]?.trim();
  if (beforeDash) {
    const normBeforeDash = normalizeSearchText(beforeDash);
    if (normBeforeDash) {
      aliases.add(normBeforeDash);
    }
    const parenMatch = beforeDash.match(/^([^(]+)\(([^)]+)\)/);
    if (parenMatch) {
      const outside = normalizeSearchText(parenMatch[1]);
      const inside = normalizeSearchText(parenMatch[2]);
      if (outside) {
        aliases.add(outside);
      }
      if (inside) {
        aliases.add(inside);
      }
    }
  }
  return aliases;
}

function isUselessTitleCandidate(line: string, authorAliases: Set<string>): boolean {
  if (!line || line.length < 2) {
    return true;
  }
  if (/^https?:\/\//i.test(line)) {
    return true;
  }
  if (/^[^a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF]+$/.test(line)) {
    return true;
  }
  if (BOILERPLATE_LINE_REGEX.test(line)) {
    return true;
  }
  if (SYNOPSIS_MARKER_REGEX.test(line)) {
    return true;
  }
  // Skip bare format-only lines like "epub, pdf, azw3"
  const strippedFormats = line.replace(FORMAT_REGEX, '').replace(/[\s,./|+&()-]+/g, '');
  if (!strippedFormats) {
    return true;
  }
  const norm = normalizeSearchText(line);
  if (!norm || authorAliases.has(norm)) {
    return true;
  }
  return false;
}

function extractFormats(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(FORMAT_REGEX)) {
    found.add(match[1].toUpperCase());
  }
  return [...found].sort((a, b) => {
    const ia = FORMAT_PRIORITY.indexOf(a);
    const ib = FORMAT_PRIORITY.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

function htmlToLines($: cheerio.CheerioAPI, root: CheerioSelection): string[] {
  const clone = root.clone();
  clone.find('br').replaceWith('\n');
  clone.find('p, div, li, h1, h2, h3, h4, tr').each((_idx, el) => {
    $(el).append('\n');
  });
  return clone
    .text()
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line.length > 0);
}

function extractSubtitles($: cheerio.CheerioAPI, $body: CheerioSelection): string[] {
  const subtitles: string[] = [];
  const seen = new Set<string>();

  $body.find('blockquote').each((_idx, bq) => {
    const lines = htmlToLines($, $(bq));
    for (const rawLine of lines) {
      const line = rawLine.replace(/^[*•\-–—\d.)\s]+/, '').trim();
      if (!line || line.length < 2 || line.length > 160) {
        continue;
      }
      if (PACK_INTRO_REGEX.test(line) || BOILERPLATE_LINE_REGEX.test(line)) {
        continue;
      }
      if (/^https?:\/\//i.test(line)) {
        continue;
      }
      const key = line.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      subtitles.push(line);
      if (subtitles.length >= 50) {
        return false;
      }
    }
    return undefined;
  });

  return subtitles;
}

function parseFontSizePx(style: string | undefined): number {
  if (!style) {
    return 0;
  }
  const match = style.match(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*(px|pt)?/i);
  if (!match) {
    return 0;
  }
  const value = parseFloat(match[1]);
  const unit = (match[2] ?? 'px').toLowerCase();
  return unit === 'pt' ? value * 1.333 : value;
}

/**
 * Returns a clone of the post body truncated before blockquotes, synopsis markers,
 * or the first long paragraph (> 180 chars) so header heuristics only inspect the top area.
 */
function collectTopHeaderCandidates(
  $: cheerio.CheerioAPI,
  $body: CheerioSelection,
  authorAliases: Set<string>
): { largeSpans: string[]; boldLines: string[]; plainLines: string[] } {
  const largeSpans: string[] = [];
  const boldLines: string[] = [];
  const plainLines: string[] = [];

  // Work on a clone without blockquotes so pack lists don't confuse title extraction
  const $top = $body.clone();
  $top.find('blockquote').remove();

  // Priority 1: large styled spans (font-size >= 18px)
  $top.find('span[style*="font-size"]').each((_idx, el) => {
    const size = parseFontSizePx($(el).attr('style'));
    if (size < 18) {
      return;
    }
    // Avoid duplicating outer span if an inner span also has font-size >= 18
    const hasInnerLarge = $(el)
      .find('span[style*="font-size"]')
      .toArray()
      .some((inner) => parseFontSizePx($(inner).attr('style')) >= 18);
    if (hasInnerLarge) {
      return;
    }
    const text = cleanLine($(el).text());
    if (text.length > 0 && text.length <= 160 && !isUselessTitleCandidate(text, authorAliases)) {
      if (!largeSpans.includes(text)) {
        largeSpans.push(text);
      }
    }
  });

  // Priority 2: leading <strong> / <b> elements (only from top portion before long paragraphs/synopsis)
  const topLines = htmlToLines($, $top);
  const cutoffLines = new Set<string>();
  for (const line of topLines) {
    if (SYNOPSIS_MARKER_REGEX.test(line) || line.length > 180) {
      break;
    }
    cutoffLines.add(line);
  }

  $top.find('strong, b').each((_idx, el) => {
    const text = cleanLine($(el).text());
    if (!text || text.length > 160) {
      return;
    }
    if (SYNOPSIS_MARKER_REGEX.test(text)) {
      return false;
    }
    // Must appear before synopsis / long paragraph when we have top lines
    const inTopSection =
      cutoffLines.size === 0 ||
      [...cutoffLines].some((topLine) => topLine.includes(text) || text.includes(topLine));
    if (!inTopSection) {
      return;
    }
    if (!isUselessTitleCandidate(text, authorAliases) && !boldLines.includes(text)) {
      boldLines.push(text);
    }
    return undefined;
  });

  // Priority 3: first short non-empty plain lines before <img> or synopsis/long paragraph
  const $beforeImg = $top.clone();
  let seenImg = false;
  const contents = $beforeImg.contents().toArray();
  for (const node of contents) {
    if (seenImg) {
      $(node).remove();
      continue;
    }
    if (node.type === 'tag') {
      const tagName = 'name' in node ? String(node.name) : '';
      if (tagName === 'img' || $(node).find('img').length > 0) {
        // Keep text inside this element before its <img> if any, then stop
        const $el = $(node);
        const firstImg = tagName === 'img' ? $el : $el.find('img').first();
        firstImg.nextAll().remove();
        firstImg.remove();
        seenImg = true;
      }
    }
  }

  for (const line of htmlToLines($, $beforeImg)) {
    if (SYNOPSIS_MARKER_REGEX.test(line) || line.length > 140) {
      break;
    }
    if (!isUselessTitleCandidate(line, authorAliases)) {
      plainLines.push(line);
    }
  }

  // Also allow top plain lines even if an image appeared first (e.g. cover at very top, title right under)
  if (plainLines.length === 0) {
    for (const line of topLines.slice(0, 6)) {
      if (SYNOPSIS_MARKER_REGEX.test(line) || line.length > 140) {
        break;
      }
      if (!isUselessTitleCandidate(line, authorAliases)) {
        plainLines.push(line);
      }
    }
  }

  return { largeSpans, boldLines, plainLines };
}

function extractPostTitle(
  $: cheerio.CheerioAPI,
  $body: CheerioSelection,
  topicTitle: string,
  postNumber: string
): string {
  const authorAliases = extractTopicAuthorAliases(topicTitle);
  const { largeSpans, boldLines, plainLines } = collectTopHeaderCandidates($, $body, authorAliases);

  if (largeSpans.length > 0) {
    // Combine up to 2 short distinct large spans (e.g. series + title), otherwise pick first
    if (largeSpans.length >= 2 && largeSpans[0].length + largeSpans[1].length <= 120) {
      return `${largeSpans[0]} — ${largeSpans[1]}`;
    }
    return largeSpans[0];
  }

  if (boldLines.length > 0) {
    return boldLines[0];
  }

  if (plainLines.length > 0) {
    return plainLines[0];
  }

  // Fallback: first non-empty preview line from post body
  const allLines = htmlToLines($, $body).filter(
    (line) => !/^https?:\/\//i.test(line) && !BOILERPLATE_LINE_REGEX.test(line)
  );
  if (allLines.length > 0) {
    const preview =
      allLines[0].length > 90 ? `${allLines[0].slice(0, 87).trimEnd()}…` : allLines[0];
    return `Post ${postNumber} — ${preview}`;
  }

  return `${topicTitle} (${postNumber})`;
}

export interface ParsedThreadPage {
  totalPages: number;
  books: ThreadBook[];
}

export function parseThreadPage(html: string, topicTitle: string): ParsedThreadPage {
  const $ = cheerio.load(html);
  const totalPages = detectTotalPages($);
  const books: ThreadBook[] = [];

  const $posts = $('#ips_Posts div.post_block');
  const postNodes = $posts.length > 0 ? $posts : $('div.post_block');

  postNodes.each((_idx, block) => {
    const $block = $(block);
    const $replyLink = $block.find('a[itemprop="replyToUrl"]').first();

    let pid = NaN;
    const dataPid = $replyLink.attr('data-entry-pid');
    if (dataPid && /^\d+$/.test(dataPid)) {
      pid = parseInt(dataPid, 10);
    } else {
      const blockId = $block.attr('id') ?? '';
      const idMatch = blockId.match(/^post_id_(\d+)$/);
      if (idMatch) {
        pid = parseInt(idMatch[1], 10);
      }
    }

    if (!Number.isInteger(pid) || pid <= 0) {
      return;
    }

    const $comment = $block.find('div.post.entry-content[itemprop="commentText"]').first();
    const $entry = $comment.length > 0 ? $comment : $block.find('div.post.entry-content').first();
    if ($entry.length === 0) {
      return;
    }

    const rawEntryHtml = $entry.html() ?? '';
    const rawEntryText = $entry.text();
    const hasHiddenContent =
      $entry.find('div.message.error').length > 0 ||
      rawEntryHtml.includes('TB_HIDE_CONTENT') ||
      /hidden content|skriveni sadr[zž]aj/i.test(rawEntryText);

    if (!hasHiddenContent) {
      return;
    }

    const postNumber = cleanLine($replyLink.text()) || `#${pid}`;
    const directUrl = resolveCanonicalUrl($replyLink.attr('href')) ?? buildFindPostUrl(pid);
    const postUrl = buildFindPostUrl(pid);
    const uploader = cleanLine($block.find('span[itemprop="creator name"].author').first().text());
    const postedAt =
      $block.find('abbr.published[itemprop="commentTime"]').first().attr('title')?.trim() ?? '';

    let thanksCount = 0;
    const thankersText = $(`#thankersBox_${pid}`).text() || $block.find('.thankers').text();
    const thanksMatch = thankersText.match(/Thanked by\s+(\d+)\s+Member/i);
    if (thanksMatch) {
      thanksCount = parseInt(thanksMatch[1], 10) || 0;
    }

    // Clone commentText and strip hidden-content banners & non-content tags
    const $cleanBody = $entry.clone();
    $cleanBody.find('.message.error, .signature, .edit, script, style').remove();

    const cleanText = $cleanBody.text();
    const formats = extractFormats(cleanText);
    const subtitles = extractSubtitles($, $cleanBody);
    const title = extractPostTitle($, $cleanBody, topicTitle, postNumber);

    books.push({
      pid,
      postNumber,
      title,
      subtitles,
      formats,
      uploader,
      postedAt,
      thanksCount,
      postUrl,
      directUrl,
    });
  });

  return { totalPages, books };
}
