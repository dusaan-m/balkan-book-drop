export type ForumSection = 'domace' | 'strane';

export interface ForumDef {
  id: number;
  name: string;
  shortLabel: string;
  section: ForumSection;
}

export interface CatalogTopic {
  topicId: number;
  forumId: number;
  section: ForumSection;
  forumLabel: string;
  title: string;
  normalizedTitle: string;
  url: string;
}

export interface ThreadBook {
  pid: number;
  postNumber: string;
  title: string;
  subtitles: string[];
  formats: string[];
  uploader: string;
  postedAt: string;
  thanksCount: number;
  postUrl: string;
  directUrl: string;
}

export interface ThreadBooksResult {
  topic: CatalogTopic;
  books: ThreadBook[];
  totalPages: number;
  fetchedPages: number;
  truncated: boolean;
  cachedAt: number;
  fromCache: boolean;
}

export interface CatalogStatus {
  syncing: boolean;
  topicCount: number;
  countsBySection: {
    domace: number;
    strane: number;
  };
  lastSyncedAt: number | null;
  lastError: string | null;
}

export const BALKANDOWNLOAD_ORIGIN = 'https://www.balkandownload.org';

/**
 * Complete E-Books (f=90) forum registry:
 * Domaće knjige (f=35) + its 6 subforums, and Strane knjige (f=36).
 */
export const EBOOK_FORUMS: readonly ForumDef[] = [
  { id: 35, name: 'Domaće knjige', shortLabel: 'Domaće', section: 'domace' },
  { id: 38, name: 'Školski udžbenici', shortLabel: 'Udžbenici', section: 'domace' },
  { id: 135, name: 'Pisani romani', shortLabel: 'Pisani romani', section: 'domace' },
  {
    id: 138,
    name: 'Enciklopedije, leksikoni, rečnici, recepti, uputstva, saveti',
    shortLabel: 'Enciklopedije / priručnici',
    section: 'domace',
  },
  {
    id: 140,
    name: 'Istorija, filozofija, naučna literatura, biografije, umetnost i narodna književnost',
    shortLabel: 'Istorija / nauka / biografije',
    section: 'domace',
  },
  {
    id: 150,
    name: 'Prevodi članova i prevodilačkih grupa',
    shortLabel: 'Prevodi članova',
    section: 'domace',
  },
  { id: 152, name: 'Dječje knjige i lektire', shortLabel: 'Dječje / lektire', section: 'domace' },
  { id: 36, name: 'Strane knjige', shortLabel: 'Strane', section: 'strane' },
] as const;

export const EBOOK_FORUMS_BY_ID = new Map<number, ForumDef>(EBOOK_FORUMS.map((f) => [f.id, f]));

/**
 * Known non-book / pinned rules / utility discussion threads excluded from catalog indexing.
 */
export const BLOCKED_TOPIC_IDS = new Set<number>([
  31171, 50815, 86681, 104028, 128057, 134008, 135340, 140661,
]);

export function buildTopicsListUrl(forumId: number): string {
  return `${BALKANDOWNLOAD_ORIGIN}/index.php?app=forums&module=extras&section=topicslist&f=${forumId}`;
}

export function buildFindPostUrl(pid: number): string {
  return `${BALKANDOWNLOAD_ORIGIN}/index.php?app=forums&module=forums&section=findpost&pid=${pid}`;
}

export function buildTopicPageUrl(canonicalUrl: string, pageNum: number): string {
  const base = canonicalUrl.replace(/\/page-\d+\/?$/i, '').replace(/\/+$/, '');
  if (pageNum <= 1) {
    return `${base}/`;
  }
  return `${base}/page-${pageNum}`;
}

export function isBalkanDownloadUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && parsed.hostname === 'www.balkandownload.org';
  } catch {
    return false;
  }
}
