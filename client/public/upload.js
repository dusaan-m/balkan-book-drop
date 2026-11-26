const ACCEPTED_EXTENSIONS = [
  '.epub',
  '.mobi',
  '.azw3',
  '.pdf',
  '.txt',
  '.html',
  '.cbz',
  '.cbr',
  '.png',
  '.jpg',
  '.jpeg',
];
const ARCHIVE_EXTENSIONS = window.BookDropArchive?.ARCHIVE_EXTENSIONS ?? [
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
const ACCEPT_ATTR = [
  ...ACCEPTED_EXTENSIONS,
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.tgz',
  '.gz',
  '.bz2',
  '.xz',
  'application/epub+zip',
  'application/epub',
  'application/x-mobipocket-ebook',
  'application/vnd.amazon.mobi8-ebook',
  'application/pdf',
  'text/html',
  'application/vnd.comicbook+zip',
  'application/vnd.comicbook-rar',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-bzip2',
  'application/x-xz',
  'image/png',
  'image/jpeg',
].join(',');

// Don't restrict file type on iOS — it breaks the file picker
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const zoneEmpty = document.getElementById('zone-empty');
const zoneSelected = document.getElementById('zone-selected');
const zonePick = document.getElementById('zone-pick');
const zoneAnnounce = document.getElementById('zone-announce');
const zoneFileName = document.getElementById('zone-file-name');
const zoneFileSize = document.getElementById('zone-file-size');
const zoneClearBtn = document.getElementById('zone-clear-btn');
const fileQueue = document.getElementById('file-queue');
const submitBtn = document.getElementById('submit-btn');
const historySection = document.getElementById('history');
const historyList = document.getElementById('history-list');
const toastContainer = document.getElementById('toast-container');
const urlInput = document.getElementById('urlinput');
const statusMsg = document.getElementById('status-msg');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const pageUrlLink = document.getElementById('page-url');
const optionsNote = document.getElementById('options-note');
const zipDialog = document.getElementById('zip-dialog');
const zipCloseBtn = document.getElementById('zip-close');
const zipSubtitle = document.getElementById('zip-subtitle');
const zipToggleAllBtn = document.getElementById('zip-toggle-all');
const zipSelectionSummary = document.getElementById('zip-selection-summary');
const zipLimitWarning = document.getElementById('zip-limit-warning');
const zipErrorEl = document.getElementById('zip-error');
const zipFileList = document.getElementById('zip-file-list');
const zipCancelBtn = document.getElementById('zip-cancel');
const zipConfirmBtn = document.getElementById('zip-confirm');

const MAX_FILE_SIZE =
  parseInt(document.querySelector('meta[name="max-file-size"]')?.content, 10) || 0;
const MAX_FILES_PER_KEY =
  parseInt(document.querySelector('meta[name="max-files-per-key"]')?.content, 10) || 0;

const receiveUrl = `${window.location.origin}/receive`;
pageUrlLink.href = receiveUrl;
pageUrlLink.textContent = receiveUrl;

if (!isIOS) {
  fileInput.accept = ACCEPT_ATTR;
}

const OPTIONS = [
  {
    id: 'kepubify',
    name: 'kepubify',
    label: 'Kobo format',
    tag: 'Kobo · EPUB',
    description:
      "Converts EPUB to Kobo's .kepub format — enables better typography, font control, and page turns. Only runs when sending an EPUB to a Kobo.",
    defaultChecked: false,
    enabledExtensions: ['.epub'],
  },
  {
    id: 'kindlegen',
    name: 'kindlegen',
    label: 'Kindle format',
    tag: 'Kindle · EPUB',
    description:
      "Converts EPUB to MOBI so Kindle can open it — Kindle doesn't natively support EPUB. Only runs when sending an EPUB to a Kindle.",
    defaultChecked: false,
    enabledExtensions: ['.epub'],
  },
  {
    id: 'pdfcropmargins',
    name: 'pdfcropmargins',
    label: 'Crop PDF margins',
    tag: 'PDF only',
    description:
      'Trims white borders from PDF pages so text fills more of the small screen. Most useful for academic papers or scanned books with wide margins.',
    defaultChecked: false,
    enabledExtensions: ['.pdf'],
  },
  {
    id: 'transliteration',
    name: 'transliteration',
    label: 'Transliterate filename',
    tag: 'Any file',
    description:
      "Replaces accented and non-Latin characters in the filename with ASCII equivalents (e.g. Ü→U, é→e). Helps older devices that can't handle Unicode filenames.",
    defaultChecked: false,
  },
  {
    id: 'fetchmetadata',
    name: 'fetchmetadata',
    label: 'Update metadata',
    tag: 'EPUB only',
    description:
      "Looks up title, author, publisher, and description from Google Books and updates the EPUB's internal metadata. You'll see what changed on the download page.",
    defaultChecked: false,
    enabledExtensions: ['.epub'],
  },
];

const BUG_REPORT_URL = 'https://github.com/dusaan-m/custom-book-drop/issues/new';
const appVersion = document.getElementById('app-version')?.textContent ?? 'unknown';

let detectedDevice = null;

const MUTUALLY_EXCLUSIVE = ['kepubify', 'kindlegen'];
const OPTIONS_STORAGE_KEY = 'bookdrop-options';

function buildOptionsGrid() {
  const optionsGrid = document.getElementById('options-grid');
  OPTIONS.forEach(({ id, name, label, tag, description, defaultChecked, enabledExtensions }) => {
    const lbl = document.createElement('label');
    lbl.className = 'option-item';
    lbl.htmlFor = id;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.name = name;
    input.checked = defaultChecked;
    input.dataset.defaultChecked = defaultChecked;
    input.setAttribute('aria-describedby', `${id}-desc`);
    if (enabledExtensions) {
      input.dataset.enabledExtensions = enabledExtensions.join(',');
    }

    const wrapper = document.createElement('span');

    const labelRow = document.createElement('span');
    labelRow.className = 'option-label-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'option-label';
    labelEl.textContent = label;

    const tagEl = document.createElement('span');
    tagEl.className = 'option-tag';
    tagEl.textContent = tag;

    labelRow.append(labelEl, tagEl);

    const descEl = document.createElement('span');
    descEl.className = 'option-desc';
    descEl.id = `${id}-desc`;
    descEl.textContent = description;

    wrapper.append(labelRow, descEl);
    lbl.append(input, wrapper);
    optionsGrid.appendChild(lbl);
  });
}

function getExtension(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 && i < name.length - 1 ? name.slice(i).toLowerCase() : '';
}

function commonExtension(files) {
  if (files.length === 0) {
    return null;
  }
  const first = getExtension(files[0].name);
  if (!first) {
    return null;
  }
  return files.every((f) => getExtension(f.name) === first) ? first : null;
}

function updateOptionAvailability(files) {
  const ext = commonExtension(files);

  if (!ext) {
    OPTIONS.forEach(({ id, enabledExtensions }) => {
      if (!enabledExtensions) {
        return;
      }
      const input = document.getElementById(id);
      if (!input) {
        return;
      }
      input.disabled = true;
      input.checked = false;
      const label = input.closest('label');
      if (label) {
        label.classList.add('option-disabled');
      }
    });
    if (optionsNote) {
      optionsNote.textContent =
        files.length > 1
          ? 'Conversion options are unavailable when files have different formats.'
          : '';
      optionsNote.classList.toggle('hidden', files.length <= 1);
    }
    return;
  }

  if (optionsNote) {
    optionsNote.textContent =
      files.length > 1 ? `${files.length} ${ext} files selected — options apply to all.` : '';
    optionsNote.classList.toggle('hidden', files.length <= 1);
  }

  OPTIONS.forEach(({ id, enabledExtensions }) => {
    if (!enabledExtensions) {
      return;
    }
    const input = document.getElementById(id);
    if (!input) {
      return;
    }
    const enabled = enabledExtensions.includes(ext);
    const wasDisabled = input.disabled;
    input.disabled = !enabled;
    if (!enabled) {
      input.checked = false;
    } else if (wasDisabled) {
      input.checked = input.dataset.defaultChecked === 'true';
    }
    const label = input.closest('label');
    if (label) {
      label.classList.toggle('option-disabled', !enabled);
    }
  });
}

function wireMutualExclusion() {
  MUTUALLY_EXCLUSIVE.forEach((id) => {
    document.getElementById(id).addEventListener('change', (e) => {
      if (e.target.checked) {
        MUTUALLY_EXCLUSIVE.forEach((otherId) => {
          if (otherId !== id) {
            document.getElementById(otherId).checked = false;
          }
        });
      }
    });
  });
}

let selectedFiles = [];
let currentUploadId = 0;
// Bumped by every selection change, so a slower pending file check can't overwrite a newer one.
let handleFilesId = 0;

function formatSize(bytes) {
  return bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

// Must match formatLimit() in src/utils.ts.
function formatLimit(bytes) {
  return bytes >= 1024 * 1024
    ? `${+(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

function updateSubmitState() {
  submitBtn.disabled = selectedFiles.length === 0 && !urlInput.value.trim();
}

function setFiles(files) {
  handleFilesId++;
  selectedFiles = files.slice();
  updateSubmitState();
  if (files.length === 0) {
    zoneEmpty.classList.remove('hidden');
    zoneSelected.classList.add('hidden');
    dropZone.classList.remove('has-file');
    zoneAnnounce.textContent = '';
    fileInput.value = '';
    fileQueue.innerHTML = '';
    fileQueue.classList.add('hidden');
  } else if (files.length === 1) {
    zoneEmpty.classList.add('hidden');
    zoneSelected.classList.remove('hidden');
    zoneFileName.textContent = files[0].name;
    zoneFileSize.textContent = formatSize(files[0].size);
    dropZone.classList.add('has-file');
    zoneAnnounce.textContent = `Selected ${files[0].name}`;
    fileQueue.innerHTML = '';
    fileQueue.classList.add('hidden');
  } else {
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    zoneEmpty.classList.add('hidden');
    zoneSelected.classList.remove('hidden');
    zoneFileName.textContent = `${files.length} files selected`;
    zoneFileSize.textContent = formatSize(totalSize);
    dropZone.classList.add('has-file');
    zoneAnnounce.textContent = `${files.length} files selected`;
    fileQueue.innerHTML = '';
    files.forEach((f, idx) => {
      const li = document.createElement('li');
      li.dataset.index = idx;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'fq-name';
      nameSpan.textContent = f.name;
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'fq-size';
      sizeSpan.textContent = formatSize(f.size);
      const statusSpan = document.createElement('span');
      statusSpan.className = 'fq-status';
      statusSpan.id = `fq-status-${idx}`;
      statusSpan.textContent = 'queued';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'fq-remove';
      removeBtn.setAttribute('aria-label', `Remove ${f.name}`);
      removeBtn.textContent = '\u00d7';
      removeBtn.addEventListener('click', () => {
        const newFiles = selectedFiles.filter((_, i) => i !== idx);
        setFiles(newFiles);
      });
      li.append(nameSpan, sizeSpan, statusSpan, removeBtn);
      fileQueue.appendChild(li);
    });
    fileQueue.classList.remove('hidden');
  }
  updateOptionAvailability(files);
}

function setFileQueueStatus(index, text, modifier) {
  const el = document.getElementById(`fq-status-${index}`);
  if (!el) {
    return;
  }
  el.textContent = text;
  el.className = `fq-status${modifier ? ` fq-${modifier}` : ''}`;
}

function lockFileQueue() {
  fileQueue.querySelectorAll('.fq-remove').forEach((btn) => btn.classList.add('hidden'));
}

function unlockFileQueue() {
  fileQueue.querySelectorAll('.fq-remove').forEach((btn) => btn.classList.remove('hidden'));
}

function resetFormAfterUpload() {
  handleFilesId++;
  selectedFiles = [];
  updateSubmitState();
  zoneEmpty.classList.remove('hidden');
  zoneSelected.classList.add('hidden');
  dropZone.classList.remove('has-file');
  zoneAnnounce.textContent = '';
  fileInput.value = '';
  updateOptionAvailability([]);
}

const HISTORY_KEY = 'bookdrop-sent';
const HISTORY_MAX = 5;
const HISTORY_TTL_MS = 60 * 60 * 1000;

function addToHistory(results) {
  const existing = readHistory();
  const now = Date.now();
  const newEntries = results
    .filter((r) => r.filename)
    .map((r) => ({ name: r.filename, sentAt: now }));
  if (newEntries.length === 0) {
    return;
  }
  const merged = [...newEntries, ...existing].slice(0, HISTORY_MAX);
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
  } catch {}
}

function readHistory() {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    if (!raw) {
      return [];
    }
    const entries = JSON.parse(raw);
    const cutoff = Date.now() - HISTORY_TTL_MS;
    return entries.filter((e) => e.sentAt > cutoff).slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function relativeTime(sentAt) {
  const mins = Math.floor((Date.now() - sentAt) / 60_000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins} min ago`;
  }
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr ago`;
}

function renderHistory() {
  const entries = readHistory();
  if (entries.length === 0) {
    historySection.classList.add('hidden');
    return;
  }
  historyList.innerHTML = '';
  entries.forEach((entry) => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'history-name';
    nameSpan.textContent = entry.name;
    const timeSpan = document.createElement('span');
    timeSpan.className = 'history-time';
    timeSpan.textContent = relativeTime(entry.sentAt);
    li.append(nameSpan, timeSpan);
    historyList.appendChild(li);
  });
  historySection.classList.remove('hidden');
}

// A zip's end record is 22 bytes, followed by a comment of at most 65,535 bytes.
const ZIP_END_RECORD_SIZE = 22;
const ZIP_END_SEARCH_BYTES = ZIP_END_RECORD_SIZE + 0xffff;

// Unreadable files pass so the upload path can report its own, more specific error.
async function hasEpubEndRecord(file) {
  if (!file.name.toLowerCase().endsWith('.epub')) {
    return true;
  }
  try {
    const bytes = new Uint8Array(await file.slice(-ZIP_END_SEARCH_BYTES).arrayBuffer());
    for (let i = bytes.length - ZIP_END_RECORD_SIZE; i >= 0; i--) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 &&
        bytes[i + 3] === 0x06
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

// An EPUB's first zip entry must be an uncompressed "mimetype" file with no extra header
// field, so its name always starts at byte 30 and its content at byte 38.
const SIGNATURES = [
  {
    ext: '.epub',
    parts: [
      [0, 'PK\x03\x04'],
      [30, 'mimetypeapplication/epub+zip'],
    ],
  },
  { ext: '.pdf', parts: [[0, '%PDF-']] },
  { ext: '.png', parts: [[0, '\x89PNG\r\n\x1a\n']] },
  { ext: '.jpg', parts: [[0, '\xff\xd8\xff']] },
];
const SIGNATURE_BYTES = 58;

async function withDetectedExtension(file) {
  if (ACCEPTED_EXTENSIONS.includes(getExtension(file.name))) {
    return file;
  }
  let bytes;
  try {
    bytes = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  } catch {
    return file;
  }
  const match = SIGNATURES.find(({ parts }) =>
    parts.every(([offset, text]) =>
      Array.from(text).every((char, i) => bytes[offset + i] === char.charCodeAt(0))
    )
  );
  if (!match) {
    return file;
  }
  return new File([file], file.name + match.ext, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

async function rejectionReason(file) {
  if (!ACCEPTED_EXTENSIONS.includes(getExtension(file.name))) {
    return 'format';
  }
  if (MAX_FILE_SIZE && file.size > MAX_FILE_SIZE) {
    return 'size';
  }
  if (!(await hasEpubEndRecord(file))) {
    return 'epub';
  }
  return null;
}

function sizeMessage(file) {
  return `\u201c${file.name}\u201d is ${formatSize(file.size)} \u2014 the limit is ${formatLimit(MAX_FILE_SIZE)} per file.`;
}

const ALLOWED_FORMATS_LINE = `Allowed: ${[...ACCEPTED_EXTENSIONS, '.zip', '.rar', '.7z', '.tar'].join(', ')}`;
const MISSING_EXTENSION_HINT =
  'If this is a book, its name may be missing its extension (such as .epub). Try choosing it from Files.';

function rejectionMessage(rejected) {
  if (rejected.length === 1) {
    const { file, reason } = rejected[0];
    if (reason === 'format') {
      return `Unsupported format: ${file.name}\n${ALLOWED_FORMATS_LINE}\n${MISSING_EXTENSION_HINT}`;
    }
    if (reason === 'size') {
      return sizeMessage(file);
    }
    if (reason === 'archive-corrupt') {
      return `\u201c${file.name}\u201d isn\u2019t a valid archive. It may be damaged or not fully downloaded.`;
    }
    if (reason === 'archive-encrypted') {
      return `\u201c${file.name}\u201d is password-protected and can\u2019t be extracted here.`;
    }
    if (reason === 'archive-unsupported-browser') {
      return `Your browser doesn\u2019t support extracting \u201c${file.name}\u201d. Please extract it on your device first.`;
    }
    if (reason === 'archive-empty') {
      return `\u201c${file.name}\u201d doesn\u2019t contain any supported ebook files.\n${ALLOWED_FORMATS_LINE}`;
    }
    if (reason === 'archive-size') {
      return `\u201c${file.name}\u201d exceeds the ${formatLimit(MAX_FILE_SIZE)} per-file limit.`;
    }
    if (reason === 'archive-extract') {
      return `Couldn\u2019t extract \u201c${file.name}\u201d from the archive.`;
    }
    return `\u201c${file.name}\u201d isn\u2019t a valid EPUB file. It may be damaged or not fully downloaded. Try downloading it again.`;
  }
  const lines = [`${rejected.length} files weren\u2019t added:`];
  for (const { file, reason } of rejected) {
    if (reason === 'format') {
      lines.push(`\u2022 \u201c${file.name}\u201d is an unsupported format.`);
    } else if (reason === 'size') {
      lines.push(`\u2022 ${sizeMessage(file)}`);
    } else if (reason === 'archive-corrupt') {
      lines.push(`\u2022 \u201c${file.name}\u201d isn\u2019t a valid archive.`);
    } else if (reason === 'archive-encrypted') {
      lines.push(`\u2022 \u201c${file.name}\u201d is password-protected.`);
    } else if (reason === 'archive-unsupported-browser') {
      lines.push(`\u2022 Your browser doesn\u2019t support extracting \u201c${file.name}\u201d.`);
    } else if (reason === 'archive-empty') {
      lines.push(`\u2022 \u201c${file.name}\u201d doesn\u2019t contain any supported ebook files.`);
    } else if (reason === 'archive-size') {
      lines.push(
        `\u2022 \u201c${file.name}\u201d exceeds the ${formatLimit(MAX_FILE_SIZE)} per-file limit.`
      );
    } else if (reason === 'archive-extract') {
      lines.push(`\u2022 Couldn\u2019t extract \u201c${file.name}\u201d from the archive.`);
    } else {
      lines.push(`\u2022 \u201c${file.name}\u201d isn\u2019t a valid EPUB file.`);
    }
  }
  if (rejected.some((r) => r.reason === 'format' || r.reason === 'archive-empty')) {
    lines.push(ALLOWED_FORMATS_LINE);
  }
  if (rejected.some((r) => r.reason === 'format')) {
    lines.push(MISSING_EXTENSION_HINT);
  }
  if (rejected.some((r) => r.reason === 'epub')) {
    lines.push(
      'Invalid EPUB files may be damaged or not fully downloaded. Try downloading them again.'
    );
  }
  return lines.join('\n');
}

function isArchiveFile(file) {
  if (window.BookDropArchive?.isArchiveFilename) {
    return window.BookDropArchive.isArchiveFilename(file.name);
  }
  const lower = (file.name || '').toLowerCase();
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function zipEntryDisabledReason(entry) {
  if (entry.encrypted) {
    return 'Password-protected';
  }
  if (entry.unsupportedCompression) {
    return 'Unsupported compression';
  }
  if (entry.uncompressedSize === 0) {
    return 'Empty file';
  }
  if (MAX_FILE_SIZE && entry.uncompressedSize > MAX_FILE_SIZE) {
    return `Exceeds ${formatLimit(MAX_FILE_SIZE)} limit`;
  }
  return null;
}

function uniqueExtractedName(name, usedNames) {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }
  const ext = getExtension(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  let n = 2;
  let candidate;
  do {
    candidate = `${base} (${n++})${ext}`;
  } while (usedNames.has(candidate));
  usedNames.add(candidate);
  return candidate;
}

let zipDialogSession = null;

function updateZipDialogSummary() {
  if (!zipDialogSession) {
    return;
  }
  const { items, pendingRegularFiles, extracting } = zipDialogSession;
  const selectable = items.filter((item) => !item.disabledReason);
  const checked = selectable.filter((item) => item.checked);
  const totalBytes = checked.reduce((sum, item) => sum + item.entry.uncompressedSize, 0);

  if (selectable.length === 0) {
    zipToggleAllBtn.disabled = true;
    zipToggleAllBtn.textContent = 'Select all';
    zipSelectionSummary.textContent = 'No selectable files';
  } else {
    zipToggleAllBtn.disabled = extracting;
    zipToggleAllBtn.textContent =
      checked.length === selectable.length ? 'Deselect all' : 'Select all';
    zipSelectionSummary.textContent =
      checked.length > 0
        ? `${checked.length} of ${selectable.length} selected (${formatSize(totalBytes)})`
        : `0 of ${selectable.length} selected`;
  }

  const totalPlanned = checked.length + pendingRegularFiles.length;
  if (MAX_FILES_PER_KEY > 0 && totalPlanned > MAX_FILES_PER_KEY) {
    zipLimitWarning.textContent =
      pendingRegularFiles.length > 0
        ? `This session supports up to ${MAX_FILES_PER_KEY} files at a time (${totalPlanned} selected including files outside the archive). Extra files won\u2019t be accepted by the server.`
        : `This session supports up to ${MAX_FILES_PER_KEY} files at a time (${checked.length} selected). Extra files won\u2019t be accepted by the server.`;
    zipLimitWarning.classList.remove('hidden');
  } else {
    zipLimitWarning.textContent = '';
    zipLimitWarning.classList.add('hidden');
  }

  zipConfirmBtn.disabled = extracting || checked.length === 0;
  zipCancelBtn.disabled = extracting;
  zipCloseBtn.disabled = extracting;
  if (extracting) {
    zipConfirmBtn.textContent = 'Extracting\u2026';
  } else if (checked.length === 0) {
    zipConfirmBtn.textContent = 'Add selected files';
  } else if (checked.length === 1) {
    zipConfirmBtn.textContent = 'Add 1 file';
  } else {
    zipConfirmBtn.textContent = `Add ${checked.length} files`;
  }
}

function closeArchiveHandles(handles) {
  for (const handle of handles) {
    Promise.resolve(handle.close()).catch(() => {});
  }
}

function closeZipDialog(cancelled) {
  const session = zipDialogSession;
  zipDialogSession = null;
  if (zipDialog.open) {
    zipDialog.close();
  }
  fileInput.value = '';
  if (session) {
    closeArchiveHandles(session.handles);
  }
  if (cancelled && session) {
    if (session.pendingRegularFiles.length > 0) {
      setFiles(session.pendingRegularFiles);
    }
    if (session.priorRejected.length > 0) {
      showStatus('error', rejectionMessage(session.priorRejected));
    }
    zonePick.focus();
  }
}

function openZipDialog({
  archiveNames,
  handles,
  items,
  skippedCount,
  pendingRegularFiles,
  priorRejected,
}) {
  if (zipDialogSession) {
    closeArchiveHandles(zipDialogSession.handles);
  }
  const multiArchive = archiveNames.length > 1;
  zipDialogSession = {
    handles,
    items,
    pendingRegularFiles,
    priorRejected,
    multiArchive,
    extracting: false,
  };

  const foundLabel =
    items.length === 1 ? '1 ebook file found' : `${items.length} ebook files found`;
  const archiveLabel = multiArchive ? `${archiveNames.length} archives` : archiveNames[0];
  const parts = [`${archiveLabel} \u2014 ${foundLabel}`];
  if (skippedCount > 0) {
    parts.push(
      skippedCount === 1 ? '1 unsupported file hidden' : `${skippedCount} unsupported files hidden`
    );
  }
  zipSubtitle.textContent = parts.join(' \u00b7 ');
  zipErrorEl.textContent = '';
  zipErrorEl.classList.add('hidden');
  zipFileList.innerHTML = '';

  items.forEach((item, idx) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.className = `zip-item${item.disabledReason ? ' zip-item-disabled' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `zip-entry-${idx}`;
    checkbox.checked = item.checked;
    checkbox.disabled = Boolean(item.disabledReason);
    checkbox.addEventListener('change', () => {
      item.checked = checkbox.checked;
      updateZipDialogSummary();
    });
    item.checkbox = checkbox;

    const info = document.createElement('span');
    info.className = 'zip-item-info';

    const nameEl = document.createElement('span');
    nameEl.className = 'zip-item-name';
    nameEl.textContent = item.entry.basename;
    info.appendChild(nameEl);

    const locationParts = [];
    if (multiArchive) {
      locationParts.push(item.zipFile.name);
    }
    if (item.entry.folder) {
      locationParts.push(item.entry.folder);
    }
    if (locationParts.length > 0) {
      const folderEl = document.createElement('span');
      folderEl.className = 'zip-item-folder';
      folderEl.textContent = locationParts.join(' / ');
      info.appendChild(folderEl);
    }

    if (item.disabledReason) {
      const reasonEl = document.createElement('span');
      reasonEl.className = 'zip-item-reason';
      reasonEl.textContent = item.disabledReason;
      info.appendChild(reasonEl);
    }

    const meta = document.createElement('span');
    meta.className = 'zip-item-meta';

    const ext = getExtension(item.entry.basename).slice(1).toUpperCase();
    if (ext) {
      const extEl = document.createElement('span');
      extEl.className = 'zip-item-ext';
      extEl.textContent = ext;
      meta.appendChild(extEl);
    }

    const sizeEl = document.createElement('span');
    sizeEl.className = 'zip-item-size';
    sizeEl.textContent = formatSize(item.entry.uncompressedSize);
    meta.appendChild(sizeEl);

    label.append(checkbox, info, meta);
    li.appendChild(label);
    zipFileList.appendChild(li);
  });

  updateZipDialogSummary();
  if (typeof zipDialog.showModal === 'function') {
    zipDialog.showModal();
  }
}

async function confirmZipDialog() {
  if (!zipDialogSession || zipDialogSession.extracting) {
    return;
  }
  const session = zipDialogSession;
  const chosen = session.items.filter((item) => !item.disabledReason && item.checked);
  if (chosen.length === 0) {
    return;
  }

  session.extracting = true;
  session.items.forEach((item) => {
    if (item.checkbox) {
      item.checkbox.disabled = true;
    }
  });
  zipErrorEl.textContent = '';
  zipErrorEl.classList.add('hidden');
  updateZipDialogSummary();

  const usedNames = new Set(session.pendingRegularFiles.map((f) => f.name));
  const extracted = [];
  const rejected = [...session.priorRejected];

  for (const item of chosen) {
    const filename = uniqueExtractedName(item.entry.basename, usedNames);
    try {
      const file = await item.handle.extract(item.entry, {
        maxBytes: MAX_FILE_SIZE,
        filename,
      });
      extracted.push(file);
    } catch (err) {
      if (err?.code === 'unsupported-browser') {
        session.extracting = false;
        session.items.forEach((it) => {
          if (it.checkbox) {
            it.checkbox.disabled = Boolean(it.disabledReason);
          }
        });
        zipErrorEl.textContent =
          'Your browser doesn\u2019t support extracting this archive format. Please extract the archive on your device first.';
        zipErrorEl.classList.remove('hidden');
        updateZipDialogSummary();
        return;
      }
      const reason =
        err?.code === 'size'
          ? 'archive-size'
          : err?.code === 'encrypted'
            ? 'archive-encrypted'
            : 'archive-extract';
      rejected.push({
        file: { name: filename, size: item.entry.uncompressedSize },
        reason,
      });
    }
  }

  const reasons = await Promise.all(extracted.map(rejectionReason));
  const validExtracted = extracted.filter((_, i) => reasons[i] === null);
  extracted.forEach((file, i) => {
    if (reasons[i] !== null) {
      rejected.push({ file, reason: reasons[i] });
    }
  });

  const combined = [...session.pendingRegularFiles, ...validExtracted];
  closeZipDialog(false);

  if (combined.length > 0) {
    setFiles(combined);
  }
  if (rejected.length > 0) {
    showStatus('error', rejectionMessage(rejected));
  } else {
    hideStatus();
    zonePick.focus();
  }
}

if (zipDialog) {
  let zipDownOnBackdrop = false;
  zipDialog.addEventListener('mousedown', (e) => {
    zipDownOnBackdrop = e.target === zipDialog;
  });
  zipDialog.addEventListener('mouseup', (e) => {
    if (zipDownOnBackdrop && e.target === zipDialog && !zipDialogSession?.extracting) {
      closeZipDialog(true);
    }
    zipDownOnBackdrop = false;
  });
  zipDialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (!zipDialogSession?.extracting) {
      closeZipDialog(true);
    }
  });
  zipCloseBtn.addEventListener('click', () => {
    if (!zipDialogSession?.extracting) {
      closeZipDialog(true);
    }
  });
  zipCancelBtn.addEventListener('click', () => {
    if (!zipDialogSession?.extracting) {
      closeZipDialog(true);
    }
  });
  zipToggleAllBtn.addEventListener('click', () => {
    if (!zipDialogSession || zipDialogSession.extracting) {
      return;
    }
    const selectable = zipDialogSession.items.filter((item) => !item.disabledReason);
    const shouldCheck = selectable.some((item) => !item.checked);
    selectable.forEach((item) => {
      item.checked = shouldCheck;
      if (item.checkbox) {
        item.checkbox.checked = shouldCheck;
      }
    });
    updateZipDialogSummary();
  });
  zipConfirmBtn.addEventListener('click', confirmZipDialog);
}

async function handleFiles(files) {
  const id = ++handleFilesId;
  if (!files || files.length === 0) {
    setFiles([]);
    return;
  }
  const incoming = Array.from(files);
  const archiveFiles = incoming.filter(isArchiveFile);
  const regularInput = incoming.filter((f) => !isArchiveFile(f));

  const regularList = await Promise.all(regularInput.map(withDetectedExtension));
  const regularReasons = await Promise.all(regularList.map(rejectionReason));
  if (id !== handleFilesId) {
    return;
  }

  const validRegular = regularList.filter((_, i) => regularReasons[i] === null);
  const rejected = regularList
    .map((file, i) => ({ file, reason: regularReasons[i] }))
    .filter((r) => r.reason !== null);

  if (archiveFiles.length === 0) {
    if (validRegular.length > 0) {
      setFiles(validRegular);
    }
    if (rejected.length > 0) {
      showStatus('error', rejectionMessage(rejected));
    } else {
      hideStatus();
    }
    return;
  }

  const needsWasmNotice = archiveFiles.some((f) => !f.name.toLowerCase().endsWith('.zip'));
  if (needsWasmNotice) {
    showStatus('info', 'Inspecting archive\u2026');
  }

  const inspections = await Promise.all(
    archiveFiles.map(async (archiveFile) => {
      try {
        const handle = await window.BookDropArchive.openArchive(archiveFile);
        return { archiveFile, handle, error: null };
      } catch (err) {
        return { archiveFile, handle: null, error: err };
      }
    })
  );

  if (id !== handleFilesId) {
    closeArchiveHandles(inspections.map((r) => r.handle).filter(Boolean));
    return;
  }

  const archiveItems = [];
  const validArchiveNames = [];
  const activeHandles = [];
  let skippedCount = 0;

  for (const { archiveFile, handle, error } of inspections) {
    if (error || !handle) {
      const reason =
        error?.code === 'encrypted'
          ? 'archive-encrypted'
          : error?.code === 'unsupported-browser'
            ? 'archive-unsupported-browser'
            : 'archive-corrupt';
      rejected.push({ file: archiveFile, reason });
      continue;
    }
    const supported = [];
    for (const entry of handle.entries) {
      if (ACCEPTED_EXTENSIONS.includes(getExtension(entry.basename))) {
        supported.push(entry);
      } else {
        skippedCount++;
      }
    }
    if (supported.length === 0) {
      closeArchiveHandles([handle]);
      rejected.push({ file: archiveFile, reason: 'archive-empty' });
      continue;
    }
    validArchiveNames.push(archiveFile.name);
    activeHandles.push(handle);
    for (const entry of supported) {
      const disabledReason = zipEntryDisabledReason(entry);
      archiveItems.push({
        zipFile: archiveFile,
        handle,
        entry,
        disabledReason,
        checked: disabledReason === null,
        checkbox: null,
      });
    }
  }

  if (archiveItems.length === 0) {
    fileInput.value = '';
    if (validRegular.length > 0) {
      setFiles(validRegular);
    }
    if (rejected.length > 0) {
      showStatus('error', rejectionMessage(rejected));
    } else if (needsWasmNotice) {
      hideStatus();
    }
    return;
  }

  if (needsWasmNotice) {
    hideStatus();
  }

  openZipDialog({
    archiveNames: validArchiveNames,
    handles: activeHandles,
    items: archiveItems,
    skippedCount,
    pendingRegularFiles: validRegular,
    priorRejected: rejected,
  });
}

zoneClearBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setFiles([]);
  hideStatus();
  zonePick.focus();
});

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragging');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
urlInput.addEventListener('input', updateSubmitState);

function buildSuccessToast(results) {
  const files = results.filter((r) => r.filename);
  const urlAdded = results.some((r) => !r.filename && r.url);
  if (files.length === 0) {
    return 'URL added';
  }
  const device = files.find((r) => r.device)?.device ?? 'your device';
  const sent =
    files.length === 1 ? `1 file sent to ${device}` : `${files.length} files sent to ${device}`;
  return urlAdded ? `${sent}, URL added` : sent;
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 2700);
}

function showStatus(type, message) {
  statusMsg.textContent = message;
  statusMsg.className = `status-msg status-${type}`;
  statusMsg.classList.remove('hidden');
  if (type === 'error' || type === 'success') {
    statusMsg.focus();
  }
}

function hideStatus() {
  statusMsg.classList.add('hidden');
}

function setProgress(value, visible) {
  progressWrap.classList.toggle('hidden', !visible);
  progressWrap.setAttribute('aria-valuenow', value);
  progressFill.style.setProperty('--progress', `${value}%`);
}

function formatSuccessMessages(results) {
  const fileResults = results.filter((r) => r.filename);
  const urlResults = results.filter((r) => !r.filename && r.url);

  const lines = [];

  if (fileResults.length === 1) {
    const r = fileResults[0];
    lines.push(
      r.conversionTool
        ? `Sent to ${r.device} (converted with ${r.conversionTool})`
        : `Sent to ${r.device}`
    );
    lines.push(`\u2022 ${r.filename}`);
    if (r.url) {
      lines.push(`URL added: ${r.url}`);
    }
    if (r.metadataFailed) {
      lines.push('(Metadata lookup failed \u2014 original metadata kept.)');
    }
  } else if (fileResults.length > 1) {
    lines.push(`${fileResults.length} files sent to ${fileResults[0].device}`);
    for (const r of fileResults) {
      let entry = `\u2022 ${r.filename}`;
      if (r.conversionTool) {
        entry += ` \u2014 converted with ${r.conversionTool}`;
      }
      if (r.metadataFailed) {
        entry += ' \u2014 metadata unchanged';
      }
      lines.push(entry);
    }
  }

  for (const r of urlResults) {
    lines.push(`URL added: ${r.url}`);
  }

  return lines.join('\n');
}

function readJson(xhr) {
  try {
    return JSON.parse(xhr.responseText);
  } catch {
    return null;
  }
}

function readResult(xhr) {
  return readJson(xhr) ?? {};
}

// A proxy in front of the server (e.g. Cloudflare rejecting an oversized body) answers
// with an HTML page, which must not be shown verbatim.
function uploadErrorMessage(xhr, fallback) {
  const body = readJson(xhr);
  if (typeof body?.error === 'string') {
    return body.error;
  }
  if (xhr.status === 413) {
    return MAX_FILE_SIZE
      ? `File too large \u2014 the limit is ${formatLimit(MAX_FILE_SIZE)} per file.`
      : 'File too large.';
  }
  return `${fallback} (HTTP ${xhr.status}) Please try again in a moment.`;
}

const FILE_SPECIFIC_STATUSES = new Set([413, 422, 500]);

// Leaves out the filename, since book titles can be private.
function bugReportUrl({ file, message, ref }) {
  const options = OPTIONS.filter(({ id }) => document.getElementById(id).checked).map(
    ({ label }) => label
  );
  const ext = file.name.includes('.') ? file.name.split('.').pop().toUpperCase() : 'Unknown';
  const fileSummary = [
    ext,
    formatSize(file.size),
    ...(options.length ? options : ['no options']),
  ].join(', ');
  const params = new URLSearchParams({
    template: 'bug_report.yml',
    title: message.length > 80 ? `${message.slice(0, 79)}\u2026` : message,
    error: `${message}\nReference: ${ref}`,
    time: new Date().toISOString(),
    'device-file': `${detectedDevice ?? 'Unknown e-reader'}; ${fileSummary}`,
    install: `Self-hosted, version ${appVersion}`,
  });
  return `${BUG_REPORT_URL}?${params}`;
}

function appendReportLink(failure) {
  const link = document.createElement('a');
  link.href = bugReportUrl(failure);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Report this problem';
  statusMsg.append(`\nReference: ${failure.ref} \u00b7 `, link);
}

function uploadFailureMessage(failures, unsent, total) {
  if (total === 1) {
    return failures[0].message;
  }
  const describe = ({ file, message }) =>
    message.includes(`\u201c${file.name}\u201d`) ? message : `\u201c${file.name}\u201d: ${message}`;
  const lines =
    failures.length === 1
      ? [describe(failures[0])]
      : [
          `${failures.length} files weren\u2019t sent:`,
          ...failures.map((f) => `\u2022 ${describe(f)}`),
        ];
  if (unsent.length > 0) {
    lines.push(`Not sent: ${unsent.map((f) => `\u201c${f.name}\u201d`).join(', ')}`);
  }
  return lines.join('\n');
}

function attemptUpload(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload', true);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.upload.addEventListener('progress', (ev) => {
      if (ev.lengthComputable) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    });
    xhr.addEventListener('load', () => resolve(xhr));
    xhr.addEventListener('error', () => reject(new Error('network')));
    xhr.send(formData);
  });
}

function buildFormData(key, urlVal, file) {
  const formData = new FormData();
  formData.set('key', key);
  if (file) {
    formData.set('file', file, file.name);
  }
  if (urlVal) {
    formData.set('url', urlVal);
  }
  OPTIONS.forEach(({ id, name }) => {
    if (document.getElementById(id).checked) {
      formData.set(name, 'on');
    }
  });
  return formData;
}

// On Android, cloud-storage files can fail mid-stream; buffering into memory before the retry avoids that.
async function uploadOneFile(key, urlVal, file, onProgress) {
  let xhr;
  try {
    xhr = await attemptUpload(buildFormData(key, urlVal, file), onProgress);
  } catch {
    onProgress(0);
    showStatus('info', 'Retrying\u2026');
    let retryFile;
    try {
      const buffer = await file.arrayBuffer();
      retryFile = new File([buffer], file.name, { type: file.type });
    } catch {
      throw new Error('read');
    }
    xhr = await attemptUpload(buildFormData(key, urlVal, retryFile), onProgress);
  }
  return xhr;
}

document.getElementById('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const key = document.getElementById('keyinput').value.trim().toUpperCase();
  if (key.length !== 4) {
    showStatus('error', 'Please enter the 4-character key shown on your e-reader.');
    return;
  }

  const urlVal = urlInput.value.trim();
  if (selectedFiles.length === 0 && !urlVal) {
    showStatus('error', 'Please choose a file or enter a URL.');
    return;
  }

  if (urlVal) {
    try {
      const parsed = new URL(urlVal);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error();
      }
    } catch {
      showStatus('error', 'Please enter a valid http or https URL.');
      return;
    }
  }

  const uploadId = ++currentUploadId;
  submitBtn.disabled = true;

  const filesToUpload = selectedFiles.slice(); // capture before any async gaps
  const successResults = [];

  if (urlVal && filesToUpload.length > 0) {
    setProgress(0, true);
    showStatus('info', 'Staging URL\u2026');
    let urlXhr;
    try {
      urlXhr = await attemptUpload(buildFormData(key, urlVal, null), () => {});
    } catch {
      if (uploadId !== currentUploadId) {
        return;
      }
      submitBtn.disabled = false;
      setProgress(0, false);
      showStatus('error', 'Could not reach the server. Is it running?');
      return;
    }
    if (uploadId !== currentUploadId) {
      return;
    }
    if (urlXhr.status < 200 || urlXhr.status >= 300) {
      submitBtn.disabled = false;
      setProgress(0, false);
      showStatus('error', uploadErrorMessage(urlXhr, 'Failed to stage URL.'));
      return;
    }
    successResults.push(readResult(urlXhr));
  }

  if (filesToUpload.length === 0) {
    setProgress(0, true);
    showStatus('info', 'Uploading\u2026');
    let xhr;
    try {
      xhr = await attemptUpload(buildFormData(key, urlVal, null), () => {});
    } catch {
      if (uploadId !== currentUploadId) {
        return;
      }
      submitBtn.disabled = false;
      setProgress(0, false);
      showStatus('error', 'Could not reach the server. Is it running?');
      return;
    }
    if (uploadId !== currentUploadId) {
      return;
    }
    submitBtn.disabled = false;
    setProgress(0, false);
    if (xhr.status >= 200 && xhr.status < 300) {
      hideStatus();
      showToast(formatSuccessMessages([readResult(xhr)]));
      urlInput.value = '';
      updateSubmitState();
    } else {
      showStatus('error', uploadErrorMessage(xhr, 'Upload failed.'));
    }
    return;
  }

  const total = filesToUpload.length;
  if (total > 1) {
    lockFileQueue();
  }
  const failures = [];
  let stoppedAt = total;
  for (let i = 0; i < total; i++) {
    if (uploadId !== currentUploadId) {
      return;
    }

    const fileLabel = total > 1 ? ` (${i + 1} of ${total})` : '';

    const onProgress = (pct) => {
      setProgress(pct, true);
      if (pct < 100) {
        statusMsg.textContent = `Uploading${fileLabel}\u2026 ${pct}%`;
        if (total > 1) {
          setFileQueueStatus(i, `${pct}%`, 'uploading');
        }
      } else {
        statusMsg.textContent = `Processing${fileLabel} please wait`;
        if (total > 1) {
          setFileQueueStatus(i, 'processing', 'uploading');
        }
      }
    };

    setProgress(0, true);
    statusMsg.textContent = `Uploading${fileLabel}\u2026`;
    statusMsg.className = 'status-msg status-info is-processing';
    statusMsg.classList.remove('hidden');
    if (total > 1) {
      setFileQueueStatus(i, 'uploading\u2026', 'uploading');
    }

    const file = filesToUpload[i];
    let xhr;
    try {
      xhr = await uploadOneFile(key, '', file, onProgress);
    } catch (err) {
      if (uploadId !== currentUploadId) {
        return;
      }
      setFileQueueStatus(i, '\u2717 error', 'error');
      if (err.message === 'read') {
        failures.push({
          file,
          message: `Could not read \u201c${file.name}\u201d \u2014 try downloading it to your device first.`,
        });
        continue;
      }
      failures.push({
        file,
        message: `Upload failed for \u201c${file.name}\u201d. Try downloading the file to your device before uploading.`,
      });
      stoppedAt = i + 1;
      break;
    }

    if (uploadId !== currentUploadId) {
      return;
    }

    if (xhr.status < 200 || xhr.status >= 300) {
      setFileQueueStatus(i, '\u2717 error', 'error');
      failures.push({
        file,
        message: uploadErrorMessage(xhr, 'Upload failed.'),
        ref: readJson(xhr)?.ref,
      });
      if (FILE_SPECIFIC_STATUSES.has(xhr.status)) {
        continue;
      }
      stoppedAt = i + 1;
      break;
    }

    setFileQueueStatus(i, '\u2713 done', 'done');
    successResults.push(readResult(xhr));
  }

  if (uploadId !== currentUploadId) {
    return;
  }
  const unsent = filesToUpload.slice(stoppedAt);
  for (let j = stoppedAt; j < total; j++) {
    setFileQueueStatus(j, 'not sent', null);
  }
  submitBtn.disabled = false;
  setProgress(0, false);
  if (failures.length > 0 && total > 1) {
    unlockFileQueue();
  }
  if (successResults.length > 0) {
    addToHistory(successResults);
    renderHistory();
    showToast(
      total > 1 ? buildSuccessToast(successResults) : formatSuccessMessages(successResults)
    );
  }
  // If no file went through, the selection is already exactly the files to resend.
  if (successResults.some((r) => r.filename)) {
    const remaining = [...failures.map((f) => f.file), ...unsent];
    if (remaining.length > 0) {
      setFiles(remaining);
    } else if (total > 1) {
      resetFormAfterUpload();
    } else {
      setFiles([]);
    }
  }
  if (urlVal) {
    urlInput.value = '';
  }
  updateSubmitState();
  if (failures.length > 0) {
    showStatus('error', uploadFailureMessage(failures, unsent, total));
    const reportable = failures.find((f) => f.ref);
    if (reportable) {
      appendReportLink(reportable);
    }
  } else {
    hideStatus();
  }
});

async function checkPendingShare() {
  if (!('caches' in window)) {
    return;
  }
  const cache = await caches.open('bookdrop-share');
  const response = await cache.match('/pending-share');
  if (!response) {
    return;
  }
  await cache.delete('/pending-share');
  const name = decodeURIComponent(response.headers.get('X-File-Name') || 'shared-file');
  const file = new File([await response.blob()], name, {
    type: response.headers.get('Content-Type') || 'application/octet-stream',
  });
  await handleFiles([file]);
}

function saveOptions() {
  const state = {};
  OPTIONS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (el && !el.disabled) {
      state[id] = el.checked;
    }
  });
  try {
    localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function loadSavedOptions() {
  try {
    const raw = localStorage.getItem(OPTIONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function applyOptions(state) {
  OPTIONS.forEach(({ id }) => {
    if (id in state) {
      const el = document.getElementById(id);
      if (el) {
        el.dataset.defaultChecked = String(state[id]);
      }
      setOption(id, state[id]);
    }
  });
}

function setOption(id, checked) {
  const el = document.getElementById(id);
  if (el && el.checked !== checked) {
    el.checked = checked;
    el.dispatchEvent(new Event('change'));
  }
}

function lookupDevice(key) {
  fetch(`/device/${key}`)
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      detectedDevice = data?.device ?? null;
      if (!data) {
        return;
      }
      if (data.device === 'Kindle') {
        setOption('kindlegen', true);
      } else if (data.device === 'Kobo') {
        setOption('kepubify', true);
      } else if (data.device === 'Tolino') {
        setOption('kepubify', false);
        setOption('kindlegen', false);
      }
    })
    .catch(function () {});
}

document.getElementById('keyinput').addEventListener('input', function (e) {
  const key = e.target.value.trim().toUpperCase();
  detectedDevice = null;
  if (key.length === 4) {
    lookupDevice(key);
  }
});

buildOptionsGrid();
wireMutualExclusion();

(function () {
  const savedState = loadSavedOptions();
  if (savedState) {
    applyOptions(savedState);
  }
  OPTIONS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', saveOptions);
    }
  });
})();

checkPendingShare();
renderHistory();

(function () {
  const params = new URLSearchParams(location.search);
  const urlKey = params.get('key');
  if (!urlKey) {
    return;
  }
  const input = document.getElementById('keyinput');
  if (!input) {
    return;
  }
  const trimmed = urlKey.toUpperCase().slice(0, 4);
  input.value = trimmed;
  if (trimmed.length === 4) {
    lookupDevice(trimmed);
  }
})();

// shared_url is untrusted; the server re-validates it on upload.
(function () {
  const shared = new URLSearchParams(location.search).get('shared_url');
  if (!shared) {
    return;
  }
  const input = document.getElementById('urlinput');
  if (!input) {
    return;
  }
  input.value = shared;
  updateSubmitState();
})();
