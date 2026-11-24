export function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) {
    return fallback;
  }
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export const PORT = envInt('PORT', 3001);
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? 'uploads';
export const EXPIRE_DELAY_MS = envInt('EXPIRE_DELAY_MS', 300_000);
export const MAX_EXPIRE_MS = envInt('MAX_EXPIRE_MS', 3_600_000);
export const MAX_FILE_SIZE = envInt('MAX_FILE_SIZE', 100 * 1024 * 1024);
export const MAX_ACTIVE_KEYS = envInt('MAX_ACTIVE_KEYS', 100);
export const FILE_DELETE_DELAY_MS = envInt('FILE_DELETE_DELAY_MS', 60_000);
export const RATE_LIMIT_WINDOW_MS = envInt('RATE_LIMIT_WINDOW_MS', 15 * 60_000);
export const RATE_LIMIT_MAX = envInt('RATE_LIMIT_MAX', 20);
export const STATUS_RATE_LIMIT_MAX = envInt('STATUS_RATE_LIMIT_MAX', 120);
export const UPLOAD_RATE_LIMIT_MAX = envInt('UPLOAD_RATE_LIMIT_MAX', 10);
export const DELETE_RATE_LIMIT_MAX = envInt('DELETE_RATE_LIMIT_MAX', 20);
export const EVENTS_RATE_LIMIT_MAX = envInt('EVENTS_RATE_LIMIT_MAX', 5);
export const DOWNLOAD_RATE_LIMIT_MAX = envInt('DOWNLOAD_RATE_LIMIT_MAX', 20);
export const MAX_KEYS_PER_IP = envInt('MAX_KEYS_PER_IP', 3);
export const MAX_DISK_BYTES = envInt('MAX_DISK_BYTES', 1 * 1024 * 1024 * 1024);
export const MAX_FILES_PER_KEY = envInt('MAX_FILES_PER_KEY', 5);
export const MAX_URLS_PER_KEY = envInt('MAX_URLS_PER_KEY', 20);
export const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY ?? '';
export const DISABLE_HSTS = process.env.DISABLE_HSTS === '1';
// Injected into HTML, so restricted to characters that are safe there.
export const BOOKDROP_VERSION = /^[\w.+-]{1,64}$/.test(process.env.BOOKDROP_VERSION ?? '')
  ? process.env.BOOKDROP_VERSION!
  : 'dev';
export const SSE_MAX_DURATION_MS = envInt('SSE_MAX_DURATION_MS', 30 * 60_000);
export const KINDLE_CONVERTER =
  process.env.KINDLE_CONVERTER?.trim().toLowerCase() === 'kindlegen' ? 'kindlegen' : 'kindling';
export const SSE_HEARTBEAT_MS = envInt('SSE_HEARTBEAT_MS', 25_000);
export const UPLOAD_CLEANUP_INTERVAL_MS = envInt('UPLOAD_CLEANUP_INTERVAL_MS', MAX_EXPIRE_MS);
export const CONVERTER_TIMEOUT_MS = envInt('CONVERTER_TIMEOUT_MS', 55_000);
export const KINDLEGEN_TIMEOUT_MS = envInt('KINDLEGEN_TIMEOUT_MS', 100_000);
export const KINDLING_MEMORY_LIMIT_BYTES = envInt('KINDLING_MEMORY_LIMIT_BYTES', 384 * 1024 * 1024);
export const KINDLING_MAX_UNPACKED_BYTES = envInt('KINDLING_MAX_UNPACKED_BYTES', 256 * 1024 * 1024);
export const MAX_KINDLE_ENTRIES = envInt('MAX_KINDLE_ENTRIES', 10_000);
export const MAX_CONVERT_UNCOMPRESSED_BYTES = envInt(
  'MAX_CONVERT_UNCOMPRESSED_BYTES',
  512 * 1024 * 1024
);
export const MAX_ZIP_INDEX_BYTES = envInt('MAX_ZIP_INDEX_BYTES', 4 * 1024 * 1024);

export const BALKANDOWNLOAD_ENABLED = process.env.BALKANDOWNLOAD_ENABLED !== '0';
export const BALKANDOWNLOAD_DB_PATH =
  process.env.BALKANDOWNLOAD_DB_PATH ?? 'data/balkandownload.sqlite';
export const BALKANDOWNLOAD_SYNC_INTERVAL_MS = envInt(
  'BALKANDOWNLOAD_SYNC_INTERVAL_MS',
  24 * 60 * 60_000
);
export const BALKANDOWNLOAD_THREAD_CACHE_TTL_MS = envInt(
  'BALKANDOWNLOAD_THREAD_CACHE_TTL_MS',
  24 * 60 * 60_000
);
export const BALKANDOWNLOAD_MAX_THREAD_PAGES = envInt('BALKANDOWNLOAD_MAX_THREAD_PAGES', 15);
export const BALKANDOWNLOAD_REQUEST_TIMEOUT_MS = envInt(
  'BALKANDOWNLOAD_REQUEST_TIMEOUT_MS',
  20_000
);
export const BALKANDOWNLOAD_SEARCH_RATE_LIMIT_MAX = envInt(
  'BALKANDOWNLOAD_SEARCH_RATE_LIMIT_MAX',
  120
);
export const BALKANDOWNLOAD_THREAD_RATE_LIMIT_MAX = envInt(
  'BALKANDOWNLOAD_THREAD_RATE_LIMIT_MAX',
  30
);
export const BALKANDOWNLOAD_SYNC_RATE_LIMIT_MAX = envInt('BALKANDOWNLOAD_SYNC_RATE_LIMIT_MAX', 3);
