import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import JSZip from 'jszip';

interface ArchiveEntryMeta {
  path: string;
  basename: string;
  folder: string;
  compressionMethod?: number;
  compressedSize?: number;
  uncompressedSize: number;
  localHeaderOffset?: number;
  encrypted: boolean;
  unsupportedCompression: boolean;
}

interface ArchiveHandle {
  entries: ArchiveEntryMeta[];
  extract(
    entry: ArchiveEntryMeta,
    options?: { maxBytes?: number; filename?: string }
  ): Promise<File>;
  close(): Promise<void>;
}

interface MockArchiveInstance {
  hasEncryptedData(): Promise<boolean | null>;
  getFilesArray(): Promise<Array<{ file: unknown; path: string }>>;
  close(): Promise<void>;
}

interface BookDropArchiveApi {
  ARCHIVE_EXTENSIONS: string[];
  ArchiveError: new (code: string, message: string) => Error & { code: string };
  isArchiveFilename(name: string): boolean;
  listZipEntries(file: Blob): Promise<ArchiveEntryMeta[]>;
  extractZipEntry(
    file: Blob,
    entry: ArchiveEntryMeta,
    options?: { maxBytes?: number; filename?: string }
  ): Promise<File>;
  openArchive(
    file: File,
    options?: {
      loadLibArchive?: () => Promise<{ open(f: File): Promise<MockArchiveInstance> }>;
    }
  ): Promise<ArchiveHandle>;
  mimeForFilename(name: string): string;
}

function loadBookDropArchive(): BookDropArchiveApi {
  const srcPath = path.resolve(import.meta.dirname, '../client/public/archive.js');
  const code = fs.readFileSync(srcPath, 'utf8');
  const sandbox: Record<string, unknown> = {
    DataView,
    Uint8Array,
    TextDecoder,
    File,
    Blob,
    DecompressionStream,
    Set,
    Error,
    Number,
    String,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'archive.js' });
  return sandbox.BookDropArchive as BookDropArchiveApi;
}

const BookDropArchive = loadBookDropArchive();

function toZipFile(buf: Buffer, name = 'books.zip'): File {
  return new File([new Uint8Array(buf)], name, { type: 'application/zip' });
}

describe('client/public/archive.js', () => {
  it('recognizes archive extensions and excludes direct e-reader formats like EPUB/CBZ/CBR', () => {
    for (const name of [
      'pack.zip',
      'pack.RAR',
      'bundle.7z',
      'books.tar',
      'books.tar.gz',
      'books.tgz',
      'books.tar.bz2',
      'books.tbz2',
      'books.tar.xz',
      'books.txz',
    ]) {
      assert.strictEqual(BookDropArchive.isArchiveFilename(name), true, name);
    }
    for (const name of ['book.epub', 'comic.cbz', 'comic.cbr', 'doc.pdf', 'notes.txt']) {
      assert.strictEqual(BookDropArchive.isArchiveFilename(name), false, name);
    }
  });

  it('lists and extracts STORE and DEFLATE ZIP entries with exact bytes', async () => {
    const zip = new JSZip();
    const storedContent = 'Hello stored book!';
    const deflatedContent = 'Once upon a time in a land far away. '.repeat(100);
    zip.file('stored.txt', storedContent, { compression: 'STORE' });
    zip.file('deflated.txt', deflatedContent, { compression: 'DEFLATE' });
    const file = toZipFile(await zip.generateAsync({ type: 'nodebuffer' }));

    const handle = await BookDropArchive.openArchive(file);
    assert.strictEqual(handle.entries.length, 2);

    const stored = handle.entries.find((e) => e.basename === 'stored.txt')!;
    const deflated = handle.entries.find((e) => e.basename === 'deflated.txt')!;
    assert.strictEqual(stored.compressionMethod, 0);
    assert.strictEqual(deflated.compressionMethod, 8);

    const extractedStored = await handle.extract(stored);
    assert.strictEqual(extractedStored.name, 'stored.txt');
    assert.strictEqual(extractedStored.type, 'text/plain');
    assert.strictEqual(await extractedStored.text(), storedContent);

    const extractedDeflated = await handle.extract(deflated, { filename: 'renamed.txt' });
    assert.strictEqual(extractedDeflated.name, 'renamed.txt');
    assert.strictEqual(await extractedDeflated.text(), deflatedContent);
    await handle.close();
  });

  it('scans nested folders and filters out macOS/Windows metadata junk and directories', async () => {
    const zip = new JSZip();
    zip.folder('Sci-Fi/Herbert')!.file('Dune.epub', 'epub-bytes');
    zip.file('__MACOSX/Sci-Fi/Herbert/._Dune.epub', 'apple-double');
    zip.file('._hidden.epub', 'apple-double');
    zip.file('.DS_Store', 'finder');
    zip.file('Sci-Fi/Thumbs.db', 'thumbs');
    zip.file('desktop.ini', 'ini');
    zip.file('notes.txt', 'hello');
    const file = toZipFile(await zip.generateAsync({ type: 'nodebuffer' }));

    const entries = await BookDropArchive.listZipEntries(file);
    assert.deepStrictEqual(
      entries.map((e) => ({ basename: e.basename, folder: e.folder })),
      [
        { basename: 'Dune.epub', folder: 'Sci-Fi/Herbert' },
        { basename: 'notes.txt', folder: '' },
      ]
    );
  });

  it('decodes UTF-8 filenames properly', async () => {
    const zip = new JSZip();
    zip.file('Bücher/Über_den_Berg.epub', 'content');
    const file = toZipFile(await zip.generateAsync({ type: 'nodebuffer' }));

    const entries = await BookDropArchive.listZipEntries(file);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].basename, 'Über_den_Berg.epub');
    assert.strictEqual(entries[0].folder, 'Bücher');
  });

  it('rejects non-ZIP and truncated buffers', async () => {
    await assert.rejects(
      () => BookDropArchive.listZipEntries(toZipFile(Buffer.from('not a zip file at all'))),
      (err: unknown) => err instanceof BookDropArchive.ArchiveError && err.code === 'corrupt'
    );
    await assert.rejects(
      () => BookDropArchive.listZipEntries(toZipFile(Buffer.alloc(10))),
      (err: unknown) => err instanceof BookDropArchive.ArchiveError && err.code === 'corrupt'
    );
  });

  it('flags encrypted ZIP entries and refuses to extract them', async () => {
    const zip = new JSZip();
    zip.file('secret.txt', 'hidden', { compression: 'STORE' });
    const buf = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    const cdSig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const cdOffset = buf.indexOf(cdSig);
    assert.ok(cdOffset >= 0);
    buf.writeUInt16LE(buf.readUInt16LE(cdOffset + 8) | 0x1, cdOffset + 8);

    const file = toZipFile(buf);
    const entries = await BookDropArchive.listZipEntries(file);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].encrypted, true);

    await assert.rejects(
      () => BookDropArchive.extractZipEntry(file, entries[0]),
      (err: unknown) => err instanceof BookDropArchive.ArchiveError && err.code === 'encrypted'
    );
  });

  it('enforces maxBytes during DEFLATE streaming extraction', async () => {
    const zip = new JSZip();
    zip.file('big.txt', 'A'.repeat(20_000), { compression: 'DEFLATE' });
    const file = toZipFile(await zip.generateAsync({ type: 'nodebuffer' }));

    const [entry] = await BookDropArchive.listZipEntries(file);
    await assert.rejects(
      () => BookDropArchive.extractZipEntry(file, entry, { maxBytes: 4096 }),
      (err: unknown) => err instanceof BookDropArchive.ArchiveError && err.code === 'size'
    );
  });

  it('uses libarchive adapter for RAR/7z/TAR archives, filters junk, extracts, and closes worker', async () => {
    let closedCount = 0;
    const rarFile = new File([new Uint8Array([0x52, 0x61, 0x72, 0x21])], 'pack.rar', {
      type: 'application/vnd.rar',
    });

    const handle = await BookDropArchive.openArchive(rarFile, {
      loadLibArchive: async () => ({
        async open() {
          return {
            async hasEncryptedData() {
              return false;
            },
            async getFilesArray() {
              return [
                {
                  path: 'Fantasy/',
                  file: {
                    name: 'Hobbit.epub',
                    size: 11,
                    async extract() {
                      return new File(['epub-bytes!'], 'Hobbit.epub');
                    },
                  },
                },
                {
                  path: '__MACOSX/Fantasy/',
                  file: {
                    name: '._Hobbit.epub',
                    size: 4,
                    async extract() {
                      return new File(['junk'], '._Hobbit.epub');
                    },
                  },
                },
              ];
            },
            async close() {
              closedCount++;
            },
          };
        },
      }),
    });

    assert.strictEqual(handle.entries.length, 1);
    assert.strictEqual(handle.entries[0].basename, 'Hobbit.epub');
    assert.strictEqual(handle.entries[0].folder, 'Fantasy');

    const extracted = await handle.extract(handle.entries[0], { maxBytes: 1024 });
    assert.strictEqual(extracted.name, 'Hobbit.epub');
    assert.strictEqual(extracted.type, 'application/epub+zip');
    assert.strictEqual(await extracted.text(), 'epub-bytes!');

    await assert.rejects(
      () => handle.extract(handle.entries[0], { maxBytes: 5 }),
      (err: unknown) => err instanceof BookDropArchive.ArchiveError && err.code === 'size'
    );

    await handle.close();
    await handle.close(); // idempotent
    assert.strictEqual(closedCount, 1);
  });

  it('closes worker and maps encrypted errors when libarchive fails on password-protected RAR', async () => {
    let closedCount = 0;
    const rarFile = new File([new Uint8Array([0x52, 0x61, 0x72, 0x21])], 'locked.rar');

    await assert.rejects(
      () =>
        BookDropArchive.openArchive(rarFile, {
          loadLibArchive: async () => ({
            async open() {
              return {
                async hasEncryptedData() {
                  return true;
                },
                async getFilesArray() {
                  throw new Error('Archive requires a passphrase');
                },
                async close() {
                  closedCount++;
                },
              };
            },
          }),
        }),
      (err: unknown) => err instanceof BookDropArchive.ArchiveError && err.code === 'encrypted'
    );
    assert.strictEqual(closedCount, 1);
  });

  it('infers MIME types for supported ebook extensions', () => {
    assert.strictEqual(BookDropArchive.mimeForFilename('book.epub'), 'application/epub+zip');
    assert.strictEqual(BookDropArchive.mimeForFilename('doc.PDF'), 'application/pdf');
    assert.strictEqual(
      BookDropArchive.mimeForFilename('comic.cbz'),
      'application/vnd.comicbook+zip'
    );
    assert.strictEqual(BookDropArchive.mimeForFilename('unknown.xyz'), 'application/octet-stream');
  });
});
