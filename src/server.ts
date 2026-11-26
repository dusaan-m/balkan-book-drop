import http from 'http';
import fs from 'fs/promises';
import express from 'express';
import { createApp } from './app.js';
import { logger } from './logger.js';
import {
  PORT,
  UPLOAD_DIR,
  MAX_EXPIRE_MS,
  UPLOAD_CLEANUP_INTERVAL_MS,
  BALKANDOWNLOAD_ENABLED,
  BALKANDOWNLOAD_DB_PATH,
  BALKANDOWNLOAD_SYNC_INTERVAL_MS,
  BALKANDOWNLOAD_THREAD_CACHE_TTL_MS,
  BALKANDOWNLOAD_MAX_THREAD_PAGES,
  BALKANDOWNLOAD_REQUEST_TIMEOUT_MS,
} from './config.js';
import { cleanExpiredUploads } from './cleanup.js';
import { BalkanDownloadService } from './balkandownload/service.js';

async function main(): Promise<void> {
  const balkanDownload = BALKANDOWNLOAD_ENABLED
    ? new BalkanDownloadService({
        dbPath: BALKANDOWNLOAD_DB_PATH,
        syncIntervalMs: BALKANDOWNLOAD_SYNC_INTERVAL_MS,
        threadCacheTtlMs: BALKANDOWNLOAD_THREAD_CACHE_TTL_MS,
        maxThreadPages: BALKANDOWNLOAD_MAX_THREAD_PAGES,
        requestTimeoutMs: BALKANDOWNLOAD_REQUEST_TIMEOUT_MS,
      })
    : null;

  const { app, keys } = createApp({ balkanDownload });

  await cleanExpiredUploads(UPLOAD_DIR, keys, MAX_EXPIRE_MS);
  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const server = http.createServer(app);

  const cleanupTimer = setInterval(
    () => void cleanExpiredUploads(UPLOAD_DIR, keys, MAX_EXPIRE_MS),
    UPLOAD_CLEANUP_INTERVAL_MS
  );

  let bdSyncTimer: ReturnType<typeof setInterval> | null = null;
  if (balkanDownload) {
    balkanDownload.ensureFreshCatalog();
    const checkInterval = Math.max(60_000, Math.min(BALKANDOWNLOAD_SYNC_INTERVAL_MS, 60 * 60_000));
    bdSyncTimer = setInterval(() => {
      balkanDownload.ensureFreshCatalog();
    }, checkInterval);
    bdSyncTimer.unref();
  }

  function shutdown() {
    clearInterval(cleanupTimer);
    if (bdSyncTimer) {
      clearInterval(bdSyncTimer);
    }
    balkanDownload?.close();
    server.close(() => process.exit(0));
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Send 100 Continue before Express reads the body, so large uploads aren't streamed before validation.
  server.on('checkContinue', (req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeContinue();
    app(req as express.Request, res as express.Response, () => {});
  });

  server.listen(PORT, () => {
    logger.info({ port: PORT }, `balkan-book-drop listening on http://localhost:${PORT}`);
  });
}

process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err: Error) => {
  logger.error({ err }, 'Uncaught exception');
  process.exit(1);
});

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
