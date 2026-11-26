(() => {
  'use strict';

  const BD_ORIGIN = 'https://www.balkandownload.org';
  const SEARCH_DEBOUNCE_MS = 220;
  const STATUS_POLL_MS = 2000;

  function isSafeBdUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl) {
      return false;
    }
    try {
      const parsed = new URL(rawUrl);
      return parsed.protocol === 'https:' && parsed.hostname === 'www.balkandownload.org';
    } catch {
      return false;
    }
  }

  function normalizeClientText(text) {
    return String(text ?? '')
      .toLowerCase()
      .replace(/đ/g, 'dj')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function formatRelativeTime(timestampMs) {
    if (!timestampMs) {
      return 'never';
    }
    const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
    if (diffSec < 60) {
      return 'just now';
    }
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) {
      return `${diffMin}m ago`;
    }
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  function formatPostDate(isoString) {
    if (!isoString) {
      return '';
    }
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) {
      return '';
    }
    try {
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return isoString.slice(0, 10);
    }
  }

  function formatCount(n) {
    try {
      return Number(n).toLocaleString();
    } catch {
      return String(n);
    }
  }

  function initBalkanDownload() {
    const enabledMeta = document.querySelector('meta[name="balkandownload-enabled"]');
    if (!enabledMeta || enabledMeta.getAttribute('content') !== '1') {
      return;
    }

    const dialog = document.getElementById('bd-dialog');
    const openHeaderBtn = document.getElementById('bd-open-header');
    const launcherCard = document.getElementById('bd-launcher-card');
    const launcherForm = document.getElementById('bd-launcher-form');
    const launcherInput = document.getElementById('bd-launcher-input');
    const launcherBadge = document.getElementById('bd-launcher-badge');
    const closeBtn = document.getElementById('bd-close');

    const statusText = document.getElementById('bd-status-text');
    const syncBtn = document.getElementById('bd-sync-btn');

    const stepSearch = document.getElementById('bd-step-search');
    const searchInput = document.getElementById('bd-search-input');
    const filterButtons = Array.from(document.querySelectorAll('.bd-filter-btn'));
    const searchError = document.getElementById('bd-search-error');
    const resultsMeta = document.getElementById('bd-results-meta');
    const topicList = document.getElementById('bd-topic-list');
    const searchEmpty = document.getElementById('bd-search-empty');

    const stepBooks = document.getElementById('bd-step-books');
    const backBtn = document.getElementById('bd-back-btn');
    const topicOpenLink = document.getElementById('bd-topic-open-link');
    const topicRefreshBtn = document.getElementById('bd-topic-refresh-btn');
    const topicTitleEl = document.getElementById('bd-topic-title');
    const topicBadgeEl = document.getElementById('bd-topic-badge');
    const bookFilterWrap = document.getElementById('bd-book-filter-wrap');
    const bookFilterInput = document.getElementById('bd-book-filter');
    const booksError = document.getElementById('bd-books-error');
    const booksTruncated = document.getElementById('bd-books-truncated');
    const booksMeta = document.getElementById('bd-books-meta');
    const booksLoading = document.getElementById('bd-books-loading');
    const bookList = document.getElementById('bd-book-list');
    const booksEmpty = document.getElementById('bd-books-empty');

    if (
      !dialog ||
      typeof dialog.showModal !== 'function' ||
      !openHeaderBtn ||
      !launcherCard ||
      !searchInput ||
      !topicList ||
      !bookList
    ) {
      return;
    }

    openHeaderBtn.classList.remove('hidden');
    launcherCard.classList.remove('hidden');

    let currentSection = 'all';
    let searchTimer = null;
    let searchAbort = null;
    let booksAbort = null;
    let pollTimer = null;
    let wasSyncing = false;
    let activeTopic = null;
    let loadedBooks = [];
    let currentStatus = null;

    function clearNode(el) {
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    }

    function setError(el, message) {
      if (!message) {
        el.textContent = '';
        el.classList.add('hidden');
      } else {
        el.textContent = message;
        el.classList.remove('hidden');
      }
    }

    function stopPollingStatus() {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function startPollingStatus() {
      if (pollTimer !== null) {
        return;
      }
      pollTimer = setInterval(() => {
        if (!dialog.open) {
          stopPollingStatus();
          return;
        }
        void fetchStatus();
      }, STATUS_POLL_MS);
    }

    function renderStatus(status) {
      currentStatus = status;
      const count = status.topicCount ?? 0;

      if (launcherBadge) {
        if (status.syncing) {
          launcherBadge.textContent = 'Syncing…';
        } else if (count > 0) {
          launcherBadge.textContent = `${formatCount(count)} topics`;
        } else {
          launcherBadge.textContent = '';
        }
      }

      if (status.syncing) {
        statusText.textContent =
          count > 0
            ? `Syncing catalog… (${formatCount(count)} topics indexed)`
            : 'Syncing BalkanDownload catalog (first sync takes a few seconds)…';
        syncBtn.disabled = true;
        syncBtn.textContent = 'Syncing…';
        wasSyncing = true;
        if (dialog.open) {
          startPollingStatus();
        }
        return;
      }

      stopPollingStatus();
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sync catalog';

      if (count > 0) {
        const syncedLabel = formatRelativeTime(status.lastSyncedAt);
        statusText.textContent = `${formatCount(count)} topics indexed · synced ${syncedLabel}`;
      } else if (status.lastError) {
        statusText.textContent = `Catalog empty · ${status.lastError}`;
      } else {
        statusText.textContent = 'Catalog not synced yet.';
      }

      // If a sync just finished while the user had a query typed, re-run the search automatically.
      if (wasSyncing) {
        wasSyncing = false;
        if (dialog.open && !stepSearch.classList.contains('hidden') && searchInput.value.trim()) {
          void runSearch();
        }
      }
    }

    async function fetchStatus() {
      try {
        const res = await fetch('/api/balkandownload/status', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          return null;
        }
        const data = await res.json();
        renderStatus(data);
        return data;
      } catch {
        return null;
      }
    }

    async function triggerSync() {
      setError(searchError, '');
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing…';
      try {
        const res = await fetch('/api/balkandownload/sync', {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json',
          },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const errMsg = data?.error ?? `Sync failed (HTTP ${res.status}).`;
          setError(searchError, errMsg);
          syncBtn.disabled = false;
          syncBtn.textContent = 'Sync catalog';
          return;
        }
        if (data) {
          renderStatus({ ...data, syncing: true });
        }
      } catch {
        setError(searchError, 'Could not reach the server to sync the catalog.');
        syncBtn.disabled = false;
        syncBtn.textContent = 'Sync catalog';
      }
    }

    function showSearchStep() {
      if (booksAbort) {
        booksAbort.abort();
        booksAbort = null;
      }
      stepBooks.classList.add('hidden');
      stepSearch.classList.remove('hidden');
      searchInput.focus({ preventScroll: true });
    }

    function formatTopicBadge(topic) {
      if (topic.section === 'strane') {
        return 'Strane';
      }
      if (topic.forumId === 35) {
        return 'Domaće';
      }
      return `Domaće · ${topic.forumLabel}`;
    }

    function renderTopicResults(data) {
      clearNode(topicList);
      const results = Array.isArray(data.results) ? data.results : [];
      const total = data.total ?? results.length;

      if (results.length === 0) {
        resultsMeta.textContent = '';
        searchEmpty.classList.remove('hidden');
        if (data.topicCount === 0 && data.syncing) {
          searchEmpty.textContent = 'Catalog is syncing — results will appear automatically…';
        } else if (data.topicCount === 0) {
          searchEmpty.textContent = 'Catalog is empty. Click "Sync catalog" above to fetch topics.';
        } else {
          searchEmpty.textContent = `No topics found for "${data.query}". Try a different spelling or switch to All.`;
        }
        return;
      }

      searchEmpty.classList.add('hidden');
      resultsMeta.textContent =
        total > results.length
          ? `Showing top ${results.length} of ${formatCount(total)} matching topics`
          : `${formatCount(total)} matching ${total === 1 ? 'topic' : 'topics'}`;

      for (const topic of results) {
        const li = document.createElement('li');
        li.className = 'bd-topic-item';

        const mainBtn = document.createElement('button');
        mainBtn.type = 'button';
        mainBtn.className = 'bd-topic-main';
        mainBtn.addEventListener('click', () => {
          void openTopicBooks(topic, false);
        });

        const info = document.createElement('span');
        info.className = 'bd-topic-info';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'bd-topic-name';
        titleSpan.textContent = topic.title;

        const badgeSpan = document.createElement('span');
        badgeSpan.className = `bd-badge bd-badge-${topic.section}`;
        badgeSpan.textContent = formatTopicBadge(topic);

        info.appendChild(titleSpan);
        info.appendChild(badgeSpan);

        const chevron = document.createElement('span');
        chevron.className = 'bd-topic-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = '›';

        mainBtn.appendChild(info);
        mainBtn.appendChild(chevron);
        li.appendChild(mainBtn);

        if (isSafeBdUrl(topic.url)) {
          const extLink = document.createElement('a');
          extLink.className = 'bd-ext-link';
          extLink.href = topic.url;
          extLink.target = '_blank';
          extLink.rel = 'noopener noreferrer';
          extLink.textContent = 'Thread ↗';
          extLink.title = `Open "${topic.title}" on BalkanDownload`;
          li.appendChild(extLink);
        }

        topicList.appendChild(li);
      }
    }

    async function runSearch() {
      const q = searchInput.value.trim();
      setError(searchError, '');

      if (!q) {
        if (searchAbort) {
          searchAbort.abort();
          searchAbort = null;
        }
        clearNode(topicList);
        resultsMeta.textContent = '';
        searchEmpty.textContent =
          'Type an author name or title to search Domaće & Strane e-book threads.';
        searchEmpty.classList.remove('hidden');
        return;
      }

      if (searchAbort) {
        searchAbort.abort();
      }
      const controller = new AbortController();
      searchAbort = controller;

      const params = new URLSearchParams({
        q,
        section: currentSection,
        limit: '40',
      });

      try {
        const res = await fetch(`/api/balkandownload/search?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        const data = await res.json().catch(() => null);
        if (controller.signal.aborted) {
          return;
        }
        if (!res.ok) {
          setError(searchError, data?.error ?? `Search failed (HTTP ${res.status}).`);
          return;
        }
        if (data) {
          renderStatus(data);
          renderTopicResults(data);
        }
      } catch (err) {
        if (err && err.name === 'AbortError') {
          return;
        }
        setError(searchError, 'Could not reach the server. Please try again.');
      }
    }

    function scheduleSearch() {
      if (searchTimer !== null) {
        clearTimeout(searchTimer);
      }
      searchTimer = setTimeout(() => {
        searchTimer = null;
        void runSearch();
      }, SEARCH_DEBOUNCE_MS);
    }

    function renderBooksList(books, filterQuery) {
      clearNode(bookList);
      const normFilter = normalizeClientText(filterQuery);
      const filtered = normFilter
        ? books.filter((b) => {
            const haystack = normalizeClientText(
              [b.title, ...(b.formats ?? []), ...(b.subtitles ?? [])].join(' ')
            );
            return normFilter.split(' ').every((tok) => haystack.includes(tok));
          })
        : books;

      if (books.length === 0) {
        booksEmpty.textContent =
          'No downloadable book posts were detected in this thread. You can still open the full thread on BalkanDownload above.';
        booksEmpty.classList.remove('hidden');
        return;
      }

      if (filtered.length === 0) {
        booksEmpty.textContent = `No books in this thread match "${filterQuery.trim()}".`;
        booksEmpty.classList.remove('hidden');
        return;
      }

      booksEmpty.classList.add('hidden');

      for (const book of filtered) {
        const li = document.createElement('li');
        li.className = 'bd-book-item';

        const header = document.createElement('div');
        header.className = 'bd-book-top';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'bd-book-title-wrap';

        const titleEl = document.createElement('div');
        titleEl.className = 'bd-book-title';
        titleEl.textContent = book.title;
        titleWrap.appendChild(titleEl);

        if (Array.isArray(book.formats) && book.formats.length > 0) {
          const formatsRow = document.createElement('div');
          formatsRow.className = 'bd-formats';
          for (const fmt of book.formats) {
            const chip = document.createElement('span');
            chip.className = 'bd-format-chip';
            chip.textContent = fmt;
            formatsRow.appendChild(chip);
          }
          titleWrap.appendChild(formatsRow);
        }

        header.appendChild(titleWrap);

        const targetUrl = isSafeBdUrl(book.postUrl)
          ? book.postUrl
          : isSafeBdUrl(book.directUrl)
            ? book.directUrl
            : BD_ORIGIN;

        const openLink = document.createElement('a');
        openLink.className = 'bd-post-link';
        openLink.href = targetUrl;
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.textContent = 'Open post ↗';
        openLink.title = `Open ${book.postNumber} on BalkanDownload`;
        header.appendChild(openLink);

        li.appendChild(header);

        const metaParts = [];
        if (book.postNumber) {
          metaParts.push(book.postNumber);
        }
        const dateLabel = formatPostDate(book.postedAt);
        if (dateLabel) {
          metaParts.push(dateLabel);
        }
        if (book.uploader) {
          metaParts.push(`by ${book.uploader}`);
        }
        if (typeof book.thanksCount === 'number' && book.thanksCount > 0) {
          metaParts.push(`♥ ${book.thanksCount}`);
        }

        if (metaParts.length > 0) {
          const metaRow = document.createElement('div');
          metaRow.className = 'bd-book-meta';
          metaRow.textContent = metaParts.join(' · ');
          li.appendChild(metaRow);
        }

        if (Array.isArray(book.subtitles) && book.subtitles.length > 0) {
          const details = document.createElement('details');
          details.className = 'bd-subtitles';

          const summary = document.createElement('summary');
          summary.textContent = `Includes ${book.subtitles.length} ${book.subtitles.length === 1 ? 'title' : 'titles'}`;
          details.appendChild(summary);

          const subList = document.createElement('ul');
          subList.className = 'bd-subtitles-list';
          for (const sub of book.subtitles) {
            const subLi = document.createElement('li');
            subLi.textContent = sub;
            subList.appendChild(subLi);
          }
          details.appendChild(subList);
          li.appendChild(details);
        }

        bookList.appendChild(li);
      }
    }

    async function openTopicBooks(topic, refresh) {
      activeTopic = topic;
      loadedBooks = [];

      stepSearch.classList.add('hidden');
      stepBooks.classList.remove('hidden');

      topicTitleEl.textContent = topic.title;
      topicBadgeEl.textContent = formatTopicBadge(topic);
      topicBadgeEl.className = `bd-badge bd-badge-${topic.section}`;
      topicOpenLink.href = isSafeBdUrl(topic.url) ? topic.url : BD_ORIGIN;

      bookFilterInput.value = '';
      bookFilterWrap.classList.add('hidden');
      setError(booksError, '');
      booksTruncated.textContent = '';
      booksTruncated.classList.add('hidden');
      booksMeta.textContent = '';
      booksEmpty.classList.add('hidden');
      clearNode(bookList);
      booksLoading.classList.remove('hidden');
      topicRefreshBtn.disabled = true;

      if (booksAbort) {
        booksAbort.abort();
      }
      const controller = new AbortController();
      booksAbort = controller;

      const qs = refresh ? '?refresh=1' : '';
      try {
        const res = await fetch(`/api/balkandownload/topics/${topic.topicId}/books${qs}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        const data = await res.json().catch(() => null);
        if (controller.signal.aborted) {
          return;
        }
        booksLoading.classList.add('hidden');
        topicRefreshBtn.disabled = false;

        if (!res.ok) {
          setError(booksError, data?.error ?? `Could not load thread (HTTP ${res.status}).`);
          return;
        }

        loadedBooks = Array.isArray(data.books) ? data.books : [];
        const pageWord = data.fetchedPages === 1 ? 'page' : 'pages';
        const cacheLabel = data.fromCache
          ? `cached ${formatRelativeTime(data.cachedAt)}`
          : 'freshly loaded';
        booksMeta.textContent = `${loadedBooks.length} book ${loadedBooks.length === 1 ? 'post' : 'posts'} across ${data.fetchedPages} ${pageWord} · ${cacheLabel}`;

        if (data.truncated) {
          booksTruncated.textContent = `Showing first ${data.fetchedPages} of ${data.totalPages} pages. Open the full thread on BalkanDownload to see older or newer pages.`;
          booksTruncated.classList.remove('hidden');
        }

        if (loadedBooks.length > 3) {
          bookFilterWrap.classList.remove('hidden');
        }

        renderBooksList(loadedBooks, '');
      } catch (err) {
        if (err && err.name === 'AbortError') {
          return;
        }
        booksLoading.classList.add('hidden');
        topicRefreshBtn.disabled = false;
        setError(booksError, 'Could not load books from BalkanDownload. Please try again.');
      }
    }

    function openDialog(initialQuery) {
      if (!dialog.open) {
        dialog.showModal();
      }
      if (typeof initialQuery === 'string' && initialQuery.trim()) {
        searchInput.value = initialQuery.trim();
        showSearchStep();
        void runSearch();
      } else {
        showSearchStep();
      }

      void fetchStatus().then((status) => {
        if (status && status.topicCount === 0 && !status.syncing && !status.lastSyncedAt) {
          void triggerSync();
        }
      });
    }

    openHeaderBtn.addEventListener('click', () => {
      openDialog('');
    });

    if (launcherForm && launcherInput) {
      launcherForm.addEventListener('submit', (e) => {
        e.preventDefault();
        openDialog(launcherInput.value);
      });
    }

    closeBtn.addEventListener('click', () => {
      dialog.close();
    });

    // Require both mousedown and mouseup on backdrop to close, matching howto.js
    let downOnBackdrop = false;
    dialog.addEventListener('mousedown', (e) => {
      downOnBackdrop = e.target === dialog;
    });
    dialog.addEventListener('mouseup', (e) => {
      if (downOnBackdrop && e.target === dialog) {
        dialog.close();
      }
      downOnBackdrop = false;
    });

    dialog.addEventListener('close', () => {
      stopPollingStatus();
      if (searchTimer !== null) {
        clearTimeout(searchTimer);
        searchTimer = null;
      }
      if (searchAbort) {
        searchAbort.abort();
        searchAbort = null;
      }
      if (booksAbort) {
        booksAbort.abort();
        booksAbort = null;
      }
    });

    syncBtn.addEventListener('click', () => {
      void triggerSync();
    });

    searchInput.addEventListener('input', () => {
      scheduleSearch();
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (searchTimer !== null) {
          clearTimeout(searchTimer);
          searchTimer = null;
        }
        void runSearch();
      }
    });

    for (const btn of filterButtons) {
      btn.addEventListener('click', () => {
        const nextSection = btn.getAttribute('data-section') || 'all';
        if (nextSection === currentSection) {
          return;
        }
        currentSection = nextSection;
        for (const other of filterButtons) {
          const active = other === btn;
          other.classList.toggle('is-active', active);
          other.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
        if (searchInput.value.trim()) {
          void runSearch();
        }
      });
    }

    backBtn.addEventListener('click', () => {
      showSearchStep();
    });

    topicRefreshBtn.addEventListener('click', () => {
      if (activeTopic) {
        void openTopicBooks(activeTopic, true);
      }
    });

    bookFilterInput.addEventListener('input', () => {
      renderBooksList(loadedBooks, bookFilterInput.value);
    });

    // Fetch lightweight status once on load to show topic count in the launcher badge
    void fetchStatus().then(() => {
      if (currentStatus?.syncing) {
        wasSyncing = true;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', initBalkanDownload);
})();
