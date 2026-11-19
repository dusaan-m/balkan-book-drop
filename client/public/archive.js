(function (root) {
  const EOCD_SIGNATURE = 0x06054b50;
  const EOCD_SIZE = 22;
  const EOCD_SEARCH_BYTES = EOCD_SIZE + 0xffff;
  const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
  const ZIP64_LOCATOR_SIZE = 20;
  const ZIP64_EOCD_SIGNATURE = 0x06064b50;
  const CENTRAL_DIR_SIGNATURE = 0x02014b50;
  const CENTRAL_DIR_HEADER_SIZE = 46;
  const LOCAL_HEADER_SIGNATURE = 0x04034b50;
  const LOCAL_HEADER_SIZE = 30;
  const MAX_CENTRAL_DIR_BYTES = 16 * 1024 * 1024;
  const U16_MAX = 0xffff;
  const U32_MAX = 0xffffffff;

  const ARCHIVE_EXTENSIONS = [
    '.zip',
    '.rar',
    '.7z',
    '.tar',
    '.tar.gz',
    '.tgz',
    '.tar.bz2',
    '.tbz2',
    '.tar.xz',
    '.txz',
  ];

  const IGNORED_BASENAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

  const MIME_BY_EXTENSION = {
    '.epub': 'application/epub+zip',
    '.mobi': 'application/x-mobipocket-ebook',
    '.azw3': 'application/vnd.amazon.mobi8-ebook',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.cbz': 'application/vnd.comicbook+zip',
    '.cbr': 'application/vnd.comicbook-rar',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };

  const utf8Decoder = new TextDecoder('utf-8');

  class ArchiveError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'ArchiveError';
      this.code = code;
    }
  }

  function isArchiveFilename(name) {
    const lower = (name || '').toLowerCase();
    return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  function readUint64LE(view, offset) {
    const low = view.getUint32(offset, true);
    const high = view.getUint32(offset + 4, true);
    return high * 0x100000000 + low;
  }

  function getExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx >= 0 && idx < name.length - 1 ? name.slice(idx).toLowerCase() : '';
  }

  function mimeForFilename(name) {
    return MIME_BY_EXTENSION[getExtension(name)] ?? 'application/octet-stream';
  }

  function normalizeEntryPath(rawPath) {
    return String(rawPath || '')
      .replace(/\\/g, '/')
      .replace(/^(?:\.\/)+/, '')
      .replace(/^\/+/, '');
  }

  function isIgnoredPath(normalizedPath) {
    if (!normalizedPath || normalizedPath.endsWith('/')) {
      return true;
    }
    const segments = normalizedPath.split('/').filter(Boolean);
    if (segments.length === 0) {
      return true;
    }
    if (segments.some((seg) => seg.toLowerCase() === '__macosx')) {
      return true;
    }
    const base = segments[segments.length - 1];
    if (base.startsWith('._') || IGNORED_BASENAMES.has(base.toLowerCase())) {
      return true;
    }
    return false;
  }

  function splitPath(normalizedPath) {
    const segments = normalizedPath.split('/').filter(Boolean);
    const basename = segments[segments.length - 1];
    const folder = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
    return { basename, folder };
  }

  function parseZip64Extra(view, start, length, sizes) {
    let pos = start;
    const end = start + length;
    while (pos + 4 <= end) {
      const headerId = view.getUint16(pos, true);
      const dataSize = view.getUint16(pos + 2, true);
      const dataStart = pos + 4;
      const dataEnd = dataStart + dataSize;
      if (dataEnd > end) {
        break;
      }
      if (headerId === 0x0001) {
        let fieldPos = dataStart;
        if (sizes.uncompressedSize === U32_MAX && fieldPos + 8 <= dataEnd) {
          sizes.uncompressedSize = readUint64LE(view, fieldPos);
          fieldPos += 8;
        }
        if (sizes.compressedSize === U32_MAX && fieldPos + 8 <= dataEnd) {
          sizes.compressedSize = readUint64LE(view, fieldPos);
          fieldPos += 8;
        }
        if (sizes.localHeaderOffset === U32_MAX && fieldPos + 8 <= dataEnd) {
          sizes.localHeaderOffset = readUint64LE(view, fieldPos);
        }
        return;
      }
      pos = dataEnd;
    }
  }

  async function readCentralDirectoryMeta(file) {
    if (file.size < EOCD_SIZE) {
      throw new ArchiveError('corrupt', 'Not a valid ZIP archive.');
    }
    const tailStart = Math.max(0, file.size - EOCD_SEARCH_BYTES);
    const tailBuf = await file.slice(tailStart, file.size).arrayBuffer();
    const tailView = new DataView(tailBuf);

    let eocdOffset = -1;
    for (let i = tailBuf.byteLength - EOCD_SIZE; i >= 0; i--) {
      if (tailView.getUint32(i, true) === EOCD_SIGNATURE) {
        const commentLen = tailView.getUint16(i + 20, true);
        if (i + EOCD_SIZE + commentLen === tailBuf.byteLength) {
          eocdOffset = i;
          break;
        }
      }
    }
    if (eocdOffset < 0) {
      throw new ArchiveError('corrupt', 'Not a valid ZIP archive.');
    }

    let entryCount = tailView.getUint16(eocdOffset + 10, true);
    let dirSize = tailView.getUint32(eocdOffset + 12, true);
    let dirOffset = tailView.getUint32(eocdOffset + 16, true);
    const eocdFileOffset = tailStart + eocdOffset;

    if (entryCount === U16_MAX || dirSize === U32_MAX || dirOffset === U32_MAX) {
      if (eocdFileOffset < ZIP64_LOCATOR_SIZE) {
        throw new ArchiveError('corrupt', 'Corrupt ZIP64 header.');
      }
      const locStart = eocdFileOffset - ZIP64_LOCATOR_SIZE;
      const locBuf = await file.slice(locStart, eocdFileOffset).arrayBuffer();
      const locView = new DataView(locBuf);
      if (locView.getUint32(0, true) !== ZIP64_LOCATOR_SIGNATURE) {
        throw new ArchiveError('corrupt', 'Corrupt ZIP64 locator.');
      }
      const zip64EocdOffset = readUint64LE(locView, 8);
      if (zip64EocdOffset + 56 > file.size) {
        throw new ArchiveError('corrupt', 'Corrupt ZIP64 end record.');
      }
      const z64Buf = await file.slice(zip64EocdOffset, zip64EocdOffset + 56).arrayBuffer();
      const z64View = new DataView(z64Buf);
      if (z64View.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) {
        throw new ArchiveError('corrupt', 'Corrupt ZIP64 end record.');
      }
      entryCount = readUint64LE(z64View, 32);
      dirSize = readUint64LE(z64View, 40);
      dirOffset = readUint64LE(z64View, 48);
    }

    if (dirSize > MAX_CENTRAL_DIR_BYTES) {
      throw new ArchiveError('corrupt', 'ZIP index is too large to inspect.');
    }
    if (dirOffset + dirSize > eocdFileOffset) {
      throw new ArchiveError('corrupt', 'Corrupt ZIP index.');
    }

    return { entryCount, dirSize, dirOffset };
  }

  async function listZipEntries(file) {
    const { entryCount, dirSize, dirOffset } = await readCentralDirectoryMeta(file);
    const dirBuf = await file.slice(dirOffset, dirOffset + dirSize).arrayBuffer();
    const dirView = new DataView(dirBuf);
    const dirBytes = new Uint8Array(dirBuf);

    const entries = [];
    let pos = 0;

    for (let i = 0; i < entryCount; i++) {
      if (
        pos + CENTRAL_DIR_HEADER_SIZE > dirSize ||
        dirView.getUint32(pos, true) !== CENTRAL_DIR_SIGNATURE
      ) {
        throw new ArchiveError('corrupt', 'Corrupt ZIP central directory.');
      }

      const flags = dirView.getUint16(pos + 8, true);
      const compressionMethod = dirView.getUint16(pos + 10, true);
      const sizes = {
        compressedSize: dirView.getUint32(pos + 20, true),
        uncompressedSize: dirView.getUint32(pos + 24, true),
        localHeaderOffset: dirView.getUint32(pos + 42, true),
      };

      const nameLen = dirView.getUint16(pos + 28, true);
      const extraLen = dirView.getUint16(pos + 30, true);
      const commentLen = dirView.getUint16(pos + 32, true);
      const nameStart = pos + CENTRAL_DIR_HEADER_SIZE;
      const nameEnd = nameStart + nameLen;
      const extraEnd = nameEnd + extraLen;
      const nextPos = extraEnd + commentLen;
      if (nextPos > dirSize) {
        throw new ArchiveError('corrupt', 'Corrupt ZIP central directory.');
      }

      if (
        sizes.compressedSize === U32_MAX ||
        sizes.uncompressedSize === U32_MAX ||
        sizes.localHeaderOffset === U32_MAX
      ) {
        parseZip64Extra(dirView, nameEnd, extraLen, sizes);
      }

      const rawName = utf8Decoder.decode(dirBytes.subarray(nameStart, nameEnd));
      const normalized = normalizeEntryPath(rawName);
      pos = nextPos;

      if (isIgnoredPath(normalized)) {
        continue;
      }

      const { basename, folder } = splitPath(normalized);

      entries.push({
        path: normalized,
        basename,
        folder,
        compressionMethod,
        compressedSize: sizes.compressedSize,
        uncompressedSize: sizes.uncompressedSize,
        localHeaderOffset: sizes.localHeaderOffset,
        encrypted: (flags & 0x1) !== 0,
        unsupportedCompression: compressionMethod !== 0 && compressionMethod !== 8,
      });
    }

    return entries;
  }

  async function inflateDeflateRaw(blob, maxBytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new ArchiveError(
        'unsupported-browser',
        'Your browser does not support extracting compressed ZIP files.'
      );
    }
    const stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        total += value.byteLength;
        if (maxBytes && total > maxBytes) {
          await reader.cancel();
          throw new ArchiveError('size', 'Extracted file exceeds the maximum allowed size.');
        }
        chunks.push(value);
      }
    } catch (err) {
      if (err instanceof ArchiveError) {
        throw err;
      }
      throw new ArchiveError('corrupt', 'Failed to decompress file from ZIP archive.');
    }

    return chunks;
  }

  async function extractZipEntry(file, entry, options) {
    const maxBytes = options?.maxBytes ?? 0;
    const outputName = options?.filename ?? entry.basename;

    if (entry.encrypted) {
      throw new ArchiveError('encrypted', 'Password-protected archive entries are not supported.');
    }
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw new ArchiveError(
        'compression',
        `Unsupported ZIP compression method (${entry.compressionMethod}).`
      );
    }

    if (entry.localHeaderOffset + LOCAL_HEADER_SIZE > file.size) {
      throw new ArchiveError('corrupt', 'Corrupt ZIP entry header.');
    }

    const headerBuf = await file
      .slice(entry.localHeaderOffset, entry.localHeaderOffset + LOCAL_HEADER_SIZE)
      .arrayBuffer();
    const headerView = new DataView(headerBuf);
    if (headerView.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
      throw new ArchiveError('corrupt', 'Corrupt ZIP entry header.');
    }

    const nameLen = headerView.getUint16(26, true);
    const extraLen = headerView.getUint16(28, true);
    const dataStart = entry.localHeaderOffset + LOCAL_HEADER_SIZE + nameLen + extraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > file.size) {
      throw new ArchiveError('corrupt', 'ZIP entry data is truncated.');
    }

    const mimeType = mimeForFilename(outputName);

    if (entry.compressionMethod === 0) {
      if (maxBytes && entry.compressedSize > maxBytes) {
        throw new ArchiveError('size', 'Extracted file exceeds the maximum allowed size.');
      }
      const blob = file.slice(dataStart, dataEnd, mimeType);
      return new File([blob], outputName, { type: mimeType });
    }

    const chunks = await inflateDeflateRaw(file.slice(dataStart, dataEnd), maxBytes);
    return new File(chunks, outputName, { type: mimeType });
  }

  let libArchivePromise = null;

  async function defaultLoadLibArchive() {
    if (typeof Worker !== 'function') {
      throw new ArchiveError(
        'unsupported-browser',
        'Your browser does not support extracting this archive format.'
      );
    }
    if (!libArchivePromise) {
      const origin = root.location?.origin ?? '';
      const moduleUrl = `${origin}/vendor/libarchive/libarchive.js`;
      const workerUrl = `${origin}/vendor/libarchive/worker-bundle.js`;
      libArchivePromise = import(moduleUrl)
        .then((mod) => {
          mod.Archive.init({ workerUrl });
          return mod.Archive;
        })
        .catch((err) => {
          libArchivePromise = null;
          throw err;
        });
    }
    return libArchivePromise;
  }

  function isEncryptionMessage(err) {
    const msg = String(err?.message ?? err ?? '');
    return /encrypt|passphrase|password/i.test(msg);
  }

  async function openWithLibArchive(file, options) {
    const loadLibArchive = options?.loadLibArchive ?? defaultLoadLibArchive;
    let ArchiveCtor;
    try {
      ArchiveCtor = await loadLibArchive();
    } catch (err) {
      if (err instanceof ArchiveError) {
        throw err;
      }
      throw new ArchiveError('unsupported-browser', 'Could not load the archive extractor.');
    }

    let archive;
    try {
      archive = await ArchiveCtor.open(file);
    } catch (err) {
      if (isEncryptionMessage(err)) {
        throw new ArchiveError('encrypted', 'Password-protected archives are not supported.');
      }
      throw new ArchiveError('corrupt', 'Not a valid archive.');
    }

    let closed = false;
    const close = async () => {
      if (closed) {
        return;
      }
      closed = true;
      try {
        await archive.close();
      } catch {
        // Ignore worker teardown errors.
      }
    };

    try {
      let hasEncrypted = false;
      try {
        hasEncrypted = (await archive.hasEncryptedData()) === true;
      } catch {
        // Some formats only report encryption during listing or extraction.
      }

      const rawItems = await archive.getFilesArray();
      const entries = [];
      for (const item of rawItems) {
        const compressedFile = item?.file;
        if (!compressedFile || typeof compressedFile.extract !== 'function') {
          continue;
        }
        const normalized = normalizeEntryPath(`${item.path || ''}${compressedFile.name || ''}`);
        if (isIgnoredPath(normalized)) {
          continue;
        }
        const { basename, folder } = splitPath(normalized);
        entries.push({
          path: normalized,
          basename,
          folder,
          uncompressedSize: Number(compressedFile.size) || 0,
          encrypted: hasEncrypted,
          unsupportedCompression: false,
          _compressedFile: compressedFile,
        });
      }

      if (hasEncrypted && entries.length === 0) {
        await close();
        throw new ArchiveError('encrypted', 'Password-protected archives are not supported.');
      }

      return {
        entries,
        async extract(entry, extractOptions) {
          const maxBytes = extractOptions?.maxBytes ?? 0;
          const outputName = extractOptions?.filename ?? entry.basename;
          if (entry.encrypted) {
            throw new ArchiveError(
              'encrypted',
              'Password-protected archive entries are not supported.'
            );
          }
          if (maxBytes && entry.uncompressedSize > maxBytes) {
            throw new ArchiveError('size', 'Extracted file exceeds the maximum allowed size.');
          }
          let extracted;
          try {
            extracted = await entry._compressedFile.extract();
          } catch (err) {
            if (isEncryptionMessage(err)) {
              throw new ArchiveError(
                'encrypted',
                'Password-protected archive entries are not supported.'
              );
            }
            throw new ArchiveError('corrupt', 'Failed to extract file from archive.');
          }
          if (maxBytes && extracted.size > maxBytes) {
            throw new ArchiveError('size', 'Extracted file exceeds the maximum allowed size.');
          }
          const mimeType = mimeForFilename(outputName);
          return new File([extracted], outputName, {
            type: mimeType,
            lastModified: extracted.lastModified,
          });
        },
        close,
      };
    } catch (err) {
      await close();
      if (err instanceof ArchiveError) {
        throw err;
      }
      if (isEncryptionMessage(err)) {
        throw new ArchiveError('encrypted', 'Password-protected archives are not supported.');
      }
      throw new ArchiveError('corrupt', 'Not a valid archive.');
    }
  }

  async function openArchive(file, options) {
    const isZip = (file.name || '').toLowerCase().endsWith('.zip');
    if (isZip) {
      const entries = await listZipEntries(file);
      const needsWasmFallback = entries.some((e) => !e.encrypted && e.unsupportedCompression);
      if (!needsWasmFallback) {
        return {
          entries,
          extract(entry, extractOptions) {
            return extractZipEntry(file, entry, extractOptions);
          },
          async close() {},
        };
      }
      // Fall back to libarchive WASM for ZIPs using exotic compression (e.g. BZip2, LZMA, Zstd).
      if (options?.loadLibArchive || typeof Worker === 'function') {
        try {
          return await openWithLibArchive(file, options);
        } catch {
          // If WASM can't load, keep native listing so unsupported entries show their reason.
        }
      }
      return {
        entries,
        extract(entry, extractOptions) {
          return extractZipEntry(file, entry, extractOptions);
        },
        async close() {},
      };
    }

    return openWithLibArchive(file, options);
  }

  root.BookDropArchive = {
    ARCHIVE_EXTENSIONS,
    ArchiveError,
    isArchiveFilename,
    listZipEntries,
    extractZipEntry,
    openArchive,
    mimeForFilename,
  };
})(globalThis);
