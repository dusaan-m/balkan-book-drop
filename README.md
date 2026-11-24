# Dule BookDrop

A self-hostable web service for sending ebooks to a Kobo, Kindle, or Tolino through its built-in browser — no account, no cloud, no cables.

Live at [bookdrop.cc](https://bookdrop.cc) · Forked from [send2ereader](https://github.com/daniel-j/send2ereader) by [djazz](https://github.com/daniel-j)

## How it works

1. Open the site in your ereader's browser — it shows a 4-character key and a QR code.
2. Scan the QR code with your phone to open the upload page with the key pre-filled, or enter the key manually on any computer.
3. Pick one or more files and click **Upload and send**.
4. Download links appear on the ereader within seconds.

Supported formats: EPUB, MOBI, AZW3, PDF, CBZ, CBR, HTML, TXT, PNG, JPG. You can also select or drop `.zip`, `.rar`, `.7z`, and `.tar` (`.tar.gz`, `.tgz`, `.tar.bz2`, `.tar.xz`) archives to pick supported ebook files inside them in your browser before uploading.

Optional conversions (requires external tools — see below):

- EPUB → KEPUB (Kobo, via kepubify) — better typography and font control
- EPUB → MOBI (Kindle, via [kindling](https://github.com/ciscoriordan/kindling)) — Kindle doesn't support EPUB natively. kindling replaces Amazon's discontinued KindleGen, which is still available with `KINDLE_CONVERTER=kindlegen`
- PDF margin cropping (via pdfCropMargins) — fills more of the small screen
- Update EPUB metadata from Google Books — patches title, author, publisher, etc. and shows a before/after diff on the download page (requires a `GOOGLE_BOOKS_API_KEY`)
- Built-in BalkanDownload.org search — syncs the Domaće (including subforums) and Strane e-book catalogs into a local SQLite FTS5 index, lists individual book posts inside writer threads on demand, and links directly to each post on BalkanDownload (`BALKANDOWNLOAD_ENABLED=1` by default)

EPUBs over 512 MiB uncompressed are sent without conversion only. For Kindle, the limit is 256 MiB and 10,000 files inside.

## Running locally

### Prerequisites

- Node.js 26 or later
- pnpm 12 (see [pnpm installation](https://pnpm.io/installation), or `pnpm self-update` from pnpm 11.10+)
- _(Optional)_ [kepubify](https://pgaskin.net/kepubify/) in `PATH`
- _(Optional)_ [kindling](https://github.com/ciscoriordan/kindling) in `PATH` (`cargo install kindling-mobi`)
- _(Optional)_ [KindleGen](http://web.archive.org/web/*/http://kindlegen.s3.amazonaws.com/kindlegen*) in `PATH`, if `KINDLE_CONVERTER=kindlegen`
- _(Optional)_ [pdfCropMargins](https://github.com/abarker/pdfCropMargins) (`pip install pdfCropMargins`)
- On Linux, `choom` from util-linux (included in most distributions), which converters are started through

### Development

```sh
pnpm install
pnpm dev        # watches SCSS and TypeScript; starts Express on :3001
```

### Production

```sh
pnpm build      # compiles SCSS to client/public/ and TypeScript to dist/
pnpm start      # runs dist/server.js
```

### Tests & linting

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build && pnpm test:integration   # runs the real kindling; skipped if it isn't installed
```

Uses Node.js's built-in test runner (`node:test`) — no extra test framework needed.

## Environment variables

Copy `.env.example` to `.env` to customise these values.

| Variable                               | Default                      | Description                                                                                                                           |
| -------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DISABLE_HSTS`                         | _(unset)_                    | Set to `1` to disable HSTS and `upgrade-insecure-requests`. Use only when serving plain HTTP without a TLS-terminating reverse proxy. |
| `PORT`                                 | `3001`                       | HTTP port the server listens on                                                                                                       |
| `UPLOAD_DIR`                           | `uploads`                    | Directory for temporary file storage                                                                                                  |
| `EXPIRE_DELAY_MS`                      | `300000`                     | Inactivity timeout per key (ms)                                                                                                       |
| `MAX_EXPIRE_MS`                        | `3600000`                    | Hard maximum key lifetime (ms)                                                                                                        |
| `SSE_MAX_DURATION_MS`                  | `1800000`                    | Maximum duration of an SSE `/events/:key` connection (ms)                                                                             |
| `SSE_HEARTBEAT_MS`                     | `25000`                      | SSE keep-alive heartbeat interval (ms)                                                                                                |
| `FILE_DELETE_DELAY_MS`                 | `60000`                      | Delay before deleting a file after download (ms)                                                                                      |
| `MAX_FILE_SIZE`                        | `104857600`                  | Upload size limit in bytes (100 MiB)                                                                                                  |
| `MAX_DISK_BYTES`                       | `1073741824`                 | Total upload directory size cap in bytes (1 GiB); uploads return 507 when exceeded                                                    |
| `MAX_FILES_PER_KEY`                    | `5`                          | Max files staged per session key; further uploads return 400                                                                          |
| `MAX_URLS_PER_KEY`                     | `20`                         | Max URLs staged per session key; further submissions return 400                                                                       |
| `MAX_ACTIVE_KEYS`                      | `100`                        | Max concurrent active sessions server-wide; further requests return 503                                                               |
| `MAX_KEYS_PER_IP`                      | `3`                          | Max concurrent sessions per IP (an IPv6 /56 counts as one IP, as do the rate limits); further requests return 429                     |
| `RATE_LIMIT_WINDOW_MS`                 | `900000`                     | Rate-limit window for all rate-limited routes (ms)                                                                                    |
| `RATE_LIMIT_MAX`                       | `20`                         | Max `/generate`, `/qr/:key`, and `/device/:key` requests per window per IP                                                            |
| `UPLOAD_RATE_LIMIT_MAX`                | `10`                         | Max `/upload` requests per window per IP                                                                                              |
| `DOWNLOAD_RATE_LIMIT_MAX`              | `20`                         | Max file download requests per window per IP                                                                                          |
| `DELETE_RATE_LIMIT_MAX`                | `20`                         | Max `/file` delete requests per window per IP                                                                                         |
| `EVENTS_RATE_LIMIT_MAX`                | `5`                          | Max `/events/:key` SSE connections per window per IP                                                                                  |
| `STATUS_RATE_LIMIT_MAX`                | `120`                        | Max failed `/status/:key` requests per window per IP                                                                                  |
| `CONVERTER_TIMEOUT_MS`                 | `55000`                      | Timeout for `kindling`, `kepubify`, and `pdfCropMargins` (ms)                                                                         |
| `KINDLEGEN_TIMEOUT_MS`                 | `100000`                     | Timeout for `kindlegen` (ms)                                                                                                          |
| `KINDLING_MEMORY_LIMIT_BYTES`          | `402653184`                  | Address-space cap for `kindling-cli` on Linux via `prlimit --as` (384 MiB; set `0` to disable)                                        |
| `KINDLING_MAX_UNPACKED_BYTES`          | `268435456`                  | Max declared uncompressed EPUB size for Kindle conversion (256 MiB)                                                                   |
| `MAX_KINDLE_ENTRIES`                   | `10000`                      | Max zip entries inside an EPUB for Kindle conversion                                                                                  |
| `MAX_CONVERT_UNCOMPRESSED_BYTES`       | `536870912`                  | Max declared uncompressed EPUB size for Kobo conversion (512 MiB)                                                                     |
| `MAX_ZIP_INDEX_BYTES`                  | `4194304`                    | Max zip central directory size when inspecting EPUBs (4 MiB)                                                                          |
| `LOG_LEVEL`                            | `info`                       | Pino log level (`trace`, `debug`, `info`, `warn`, `error`)                                                                            |
| `UPLOAD_CLEANUP_INTERVAL_MS`           | `3600000`                    | How often the orphaned-file cleanup worker runs (ms); defaults to `MAX_EXPIRE_MS`                                                     |
| `GOOGLE_BOOKS_API_KEY`                 | _(unset)_                    | Google Books API key for EPUB metadata enrichment; without it the API may rate-limit requests                                         |
| `KINDLE_CONVERTER`                     | `kindling`                   | Tool behind the "Kindle format" option: `kindling` or `kindlegen`                                                                     |
| `BALKANDOWNLOAD_ENABLED`               | `1`                          | Set to `0` to disable the built-in BalkanDownload.org search and background catalog sync                                              |
| `BALKANDOWNLOAD_DB_PATH`               | `data/balkandownload.sqlite` | SQLite database path for the BalkanDownload FTS5 topic catalog and thread cache                                                       |
| `BALKANDOWNLOAD_SYNC_INTERVAL_MS`      | `86400000`                   | Interval between automatic catalog syncs (ms; default 24h)                                                                            |
| `BALKANDOWNLOAD_THREAD_CACHE_TTL_MS`   | `86400000`                   | How long parsed book lists per thread stay cached before re-fetching (ms; default 24h)                                                |
| `BALKANDOWNLOAD_MAX_THREAD_PAGES`      | `15`                         | Max pages fetched per thread when listing books on demand                                                                             |
| `BALKANDOWNLOAD_REQUEST_TIMEOUT_MS`    | `20000`                      | HTTP timeout per request to BalkanDownload (ms)                                                                                       |
| `BALKANDOWNLOAD_SEARCH_RATE_LIMIT_MAX` | `120`                        | Max `/api/balkandownload/search` and `/status` requests per window per IP                                                             |
| `BALKANDOWNLOAD_THREAD_RATE_LIMIT_MAX` | `30`                         | Max `/api/balkandownload/topics/:topicId/books` requests per window per IP                                                            |
| `BALKANDOWNLOAD_SYNC_RATE_LIMIT_MAX`   | `3`                          | Max manual `POST /api/balkandownload/sync` requests per window per IP                                                                 |

## Docker

```sh
docker compose build
docker compose up -d
```

The service will be available at `http://localhost:3001` (or whatever PORT you use).

Serving plain HTTP (no reverse-proxy TLS)? Set `DISABLE_HSTS=1` — see env vars above.

## Heroku

This project deploys to Heroku using the **Container Stack** (`heroku.yml` + `Dockerfile`), which bundles Node 26 and all ebook converter binaries (`kepubify`, `kindling-cli`, `kindlegen`, `pdfCropMargins`).

### Deploy via Git (`heroku.yml`)

```sh
heroku create your-app-name
heroku stack:set container -a your-app-name
heroku config:set CONVERTER_TIMEOUT_MS=25000 KINDLING_MEMORY_LIMIT_BYTES=268435456 -a your-app-name
git push heroku HEAD:main
heroku ps:scale web=1 -a your-app-name
```

### Or deploy via Heroku Container Registry (builds locally)

```sh
heroku container:login
heroku container:push web -a your-app-name
heroku container:release web -a your-app-name
```

### Heroku notes

- **Single dyno only:** Keep `web` scaled to `1` dyno (`heroku ps:scale web=1`). Active keys, SSE streams, and uploaded files are stored per-dyno.
- **30-second router timeout:** Heroku's router drops requests that take longer than 30s to respond (`H12`). Setting `CONVERTER_TIMEOUT_MS=25000` lets slow conversions fail cleanly before the router times out.
- **Memory limits:** `Eco`/`Basic`/`Standard-1X` dynos have 512 MB RAM; `KINDLING_MEMORY_LIMIT_BYTES=268435456` (256 MiB) helps avoid `R14`/`R15` memory errors, or use `Standard-2X` (1 GB) for large files and PDF cropping.
- **Ephemeral disk:** Dyno restarts clear `uploads/` and `data/balkandownload.sqlite`. The BalkanDownload catalog re-syncs automatically in the background on startup (or disable it with `BALKANDOWNLOAD_ENABLED=0`).
- **HTTPS:** Heroku terminates TLS at its router and sets `X-Forwarded-Proto: https`, which works with `trust proxy` and HSTS out of the box. Always open the app over `https://` (or set `DISABLE_HSTS=1` only if an older ereader requires plain HTTP).
