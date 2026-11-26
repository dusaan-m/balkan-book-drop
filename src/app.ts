import crypto from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { BOOKDROP_VERSION, DISABLE_HSTS, MAX_FILE_SIZE, MAX_FILES_PER_KEY } from './config.js';
import { logger } from './logger.js';
import type { KeyInfo } from './types.js';
import { isEreaderAgent, extractSharedUrl, formatLimit, newErrorRef } from './utils.js';
import { serveHtml, makeNotifySSE } from './middleware.js';
import { makeKeysRouter } from './routes/keys.js';
import { makeUploadRouter } from './routes/upload.js';
import { makeBalkanDownloadRouter } from './routes/balkandownload.js';
import type { BalkanDownloadService } from './balkandownload/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VERSIONED_ASSETS = [
  'base.css',
  'upload.css',
  'download.css',
  'theme.js',
  'howto.js',
  'archive.js',
  'balkandownload.js',
  'upload.js',
  'download.js',
];

function computeAssetVersion(staticDir: string): string {
  const hash = crypto.createHash('sha256');
  for (const asset of VERSIONED_ASSETS) {
    try {
      hash.update(asset);
      hash.update(fs.readFileSync(path.join(staticDir, asset)));
    } catch {
      // Test fixtures may run against a minimal or empty staticDir.
    }
  }
  return hash.digest('hex').slice(0, 10);
}

export function createApp(options?: {
  staticDir?: string;
  viewsDir?: string;
  balkanDownload?: BalkanDownloadService | null;
}) {
  const STATIC_DIR = options?.staticDir ?? path.join(__dirname, '../client/public');
  const VIEWS_DIR = options?.viewsDir ?? path.join(__dirname, '../client/views');
  const assetVersion = computeAssetVersion(STATIC_DIR);
  const keys = new Map<string, KeyInfo>();
  const sseClients = new Map<string, express.Response>();
  const app = express();

  const nonceMap = new WeakMap<IncomingMessage, string>();
  const notifySSE = makeNotifySSE(sseClients);

  app.use(
    compression({
      filter: (req, res) => {
        if (req.path.startsWith('/events/')) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );
  app.use((req, _res, next) => {
    nonceMap.set(req, crypto.randomBytes(16).toString('base64'));
    next();
  });
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
    );
    next();
  });
  app.use(
    helmet({
      hsts: DISABLE_HSTS ? false : { maxAge: 31536000, includeSubDomains: true },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'wasm-unsafe-eval'",
            (req) => `'nonce-${nonceMap.get(req) ?? ''}'`,
          ],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: DISABLE_HSTS ? null : [],
        },
      },
    })
  );
  app.set('trust proxy', 1);

  app.get('/health', (_req, res) => {
    logger.debug('health check');
    res.json({ status: 'ok', version: BOOKDROP_VERSION });
  });

  app.use((req, res, next) => {
    if (!DISABLE_HSTS && !req.secure) {
      res
        .status(400)
        .type('text')
        .send(
          'Balkan BookDrop is configured to use HSTS, but you connected over HTTP. Either connect over HTTPS or set environment variable "DISABLE_HSTS=1" to disable.'
        );

      return;
    }

    next();
  });

  app.use(
    express.static(STATIC_DIR, {
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          ms: Date.now() - start,
          ua: req.get('user-agent'),
        },
        '%s %s %d',
        req.method,
        req.url,
        res.statusCode
      );
    });
    next();
  });

  if (options?.balkanDownload) {
    app.use(makeBalkanDownloadRouter(options.balkanDownload));
  }
  app.use(makeKeysRouter(keys, sseClients, notifySSE));
  app.use(makeUploadRouter(keys, notifySSE));

  // Fallback for Web Share Target when the service worker isn't controlling the page yet;
  // shared files can't be recovered here (no session), only links. On a parse error,
  // req.body may hold fields parsed before it, so it is ignored.
  const parseShare = multer({ limits: { fieldSize: 64 * 1024 } }).none();
  app.post('/share', (req, res) => {
    parseShare(req, res, (err?: unknown) => {
      const url = err
        ? null
        : extractSharedUrl((req.body ?? {}) as { url?: unknown; text?: unknown });
      res.redirect(303, url ? `/?shared_url=${encodeURIComponent(url)}` : '/');
    });
  });
  app.get('/receive', (req, res, next) => {
    const ereaderClass = isEreaderAgent(req.get('user-agent') ?? '') ? 'ereader' : '';
    void serveHtml(VIEWS_DIR, 'download.html', nonceMap.get(req) ?? '', res, next, {
      EREADER_CLASS_PLACEHOLDER: ereaderClass,
      VERSION_PLACEHOLDER: BOOKDROP_VERSION,
    });
  });
  app.get('/', (req, res, next) => {
    const ua = req.get('user-agent') ?? '';
    const isEreader = isEreaderAgent(ua);
    const page = isEreader ? 'download.html' : 'upload.html';
    const extras: Record<string, string> = isEreader
      ? { EREADER_CLASS_PLACEHOLDER: 'ereader', VERSION_PLACEHOLDER: BOOKDROP_VERSION }
      : {
          MAX_FILE_SIZE_PLACEHOLDER: String(MAX_FILE_SIZE),
          MAX_FILE_SIZE_LABEL_PLACEHOLDER: formatLimit(MAX_FILE_SIZE),
          MAX_FILES_PER_KEY_PLACEHOLDER: String(MAX_FILES_PER_KEY),
          VERSION_PLACEHOLDER: BOOKDROP_VERSION,
          ASSET_HASH_PLACEHOLDER: assetVersion,
          BALKANDOWNLOAD_ENABLED_PLACEHOLDER: options?.balkanDownload ? '1' : '0',
        };
    void serveHtml(VIEWS_DIR, page, nonceMap.get(req) ?? '', res, next, extras);
  });

  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err instanceof URIError) {
        res.status(400).json({ error: 'Bad request.' });
        return;
      }
      const ref = newErrorRef();
      logger.error({ err, ref }, 'Unhandled error');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error.', ref });
      }
    }
  );

  return { app, keys };
}
