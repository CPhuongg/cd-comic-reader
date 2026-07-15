const ipcRenderer = window.electronAPI;

// ── State ──────────────────────────────────────────────
let currentImages = [];
let currentKey    = '';
let imgWidth      = 70;
let pageGap       = 4;
let pageObserver  = null;
let imageLoadObserver = null;
let scrollCurrentPage = 0; // Current page in a scrolling mode (zero-based)
let readMode      = 'scroll'; // 'scroll' | 'scroll-ltr' | 'scroll-rtl' | 'ltr' | 'rtl'
let currentPage   = 0;
let isDoublePage  = false;
let currentCbzSession = '';
let sourceGeneration = 0;
let sourceLoadRequest = 0;
let pagedRenderVersion = 0;
let progressSaveTimer = null;
const imageObjectUrls = new Map();
const imageLoadPromises = new Map();
const pagedPreloaders = new Map();

// Video state
let videoFiles       = [];
let videoIndex       = 0;
let videoViewVisible = false;
let _videoHideTimer  = null;

// Cache scroll nodes while temporarily showing paged mode.
const _scrollHolder = document.createElement('div');
let _scrollHolderKey = '';

// ── DOM refs ───────────────────────────────────────────
const reader            = document.getElementById('reader');
const pagesContainer    = document.getElementById('pages-container');
const emptyState        = document.getElementById('empty-state');
const loadingEl         = document.getElementById('loading');
const pageIndicator     = document.getElementById('page-indicator');
const pageIndicatorTx   = document.getElementById('page-indicator-text');
const scrollTopBtn      = document.getElementById('scroll-top');
const widthSlider       = document.getElementById('width-slider');
const widthValue        = document.getElementById('width-value');
const gapSlider         = document.getElementById('gap-slider');
const gapValue          = document.getElementById('gap-value');
const infoName          = document.getElementById('info-name');
const infoPages         = document.getElementById('info-pages');
const infoCurrent       = document.getElementById('info-current');
const historyList       = document.getElementById('history-list');
const sidebarPagedNav   = document.getElementById('sidebar-paged-nav');
const sidebarScrollNav  = document.getElementById('sidebar-scroll-nav');
const scrollNavPrev     = document.getElementById('scroll-nav-prev');
const scrollNavNext     = document.getElementById('scroll-nav-next');
const scrollPageDisplay = document.getElementById('scroll-page-display');
const scrollPageTotal   = document.getElementById('scroll-page-total');
const navPrev           = document.getElementById('nav-prev');
const navNext           = document.getElementById('nav-next');
const doublePageToggle  = document.getElementById('double-page-toggle');
const pageInput         = document.getElementById('page-input');
const pageTotal         = document.getElementById('page-total');

function clearElement(element) {
  element.replaceChildren();
}

async function processConcurrently(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function releaseImageUrl(index) {
  const url = imageObjectUrls.get(index);
  if (url) URL.revokeObjectURL(url);
  imageObjectUrls.delete(index);
}

function releaseAllImageUrls() {
  pagedPreloaders.forEach(img => img.removeAttribute('src'));
  pagedPreloaders.clear();
  imageObjectUrls.forEach(url => URL.revokeObjectURL(url));
  imageObjectUrls.clear();
  imageLoadPromises.clear();
}

async function preloadPagedImage(index, generation = sourceGeneration) {
  if (index < 0 || index >= currentImages.length || pagedPreloaders.has(index)) return;
  try {
    const src = await resolveImageSource(index, generation);
    if (!src || generation !== sourceGeneration) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    pagedPreloaders.set(index, img);
  } catch (error) {
    console.warn(`Page ${index + 1} could not be preloaded:`, error);
  }
}

function prunePagedCache(keepIndexes) {
  pagedPreloaders.forEach((img, index) => {
    if (!keepIndexes.has(index)) {
      img.removeAttribute('src');
      pagedPreloaders.delete(index);
    }
  });
  imageObjectUrls.forEach((_url, index) => {
    if (!keepIndexes.has(index)) releaseImageUrl(index);
  });
}

async function resolveImageSource(index, generation = sourceGeneration) {
  const source = currentImages[index];
  if (typeof source === 'string') return source;
  if (!source || source.kind !== 'cbz') throw new Error('Image source is unavailable.');
  if (imageObjectUrls.has(index)) return imageObjectUrls.get(index);
  if (imageLoadPromises.has(index)) return imageLoadPromises.get(index);

  const request = ipcRenderer.invoke('read-cbz-page', source.sessionId, source.index)
    .then(result => {
      if (generation !== sourceGeneration || source !== currentImages[index]) return null;
      const blob = new Blob([result.data], { type: result.mime || source.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      imageObjectUrls.set(index, url);
      return url;
    })
    .finally(() => imageLoadPromises.delete(index));
  imageLoadPromises.set(index, request);
  return request;
}

async function loadImageElement(img, index, generation = sourceGeneration) {
  if (!img || img.dataset.loaded === 'true' || img.dataset.loading === 'true') return;
  img.dataset.loading = 'true';
  const shell = img.closest('.page-shell, .paged-page-shell');
  shell?.classList.add('loading');
  try {
    const src = await resolveImageSource(index, generation);
    if (!src || generation !== sourceGeneration || !img.isConnected) return;
    if (shell?.classList.contains('page-shell') && shell.dataset.wanted === 'false') {
      delete img.dataset.loading;
      shell.classList.remove('loading');
      if (currentImages[index]?.kind === 'cbz') releaseImageUrl(index);
      return;
    }
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight && shell) {
        shell.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      }
      img.dataset.loaded = 'true';
      delete img.dataset.loading;
      shell?.classList.remove('loading', 'load-error');
      shell?.classList.add('loaded');
    };
    img.onerror = () => {
      delete img.dataset.loading;
      shell?.classList.remove('loading');
      shell?.classList.add('load-error');
      img.removeAttribute('src');
      releaseImageUrl(index);
    };
    img.src = src;
  } catch (error) {
    delete img.dataset.loading;
    shell?.classList.remove('loading');
    shell?.classList.add('load-error');
    console.warn(`Page ${index + 1} could not be loaded:`, error);
  }
}

function unloadScrollImage(shell) {
  const index = Number(shell.dataset.index);
  const img = shell.querySelector('.page-img');
  if (!img || img.dataset.loading === 'true') return;
  img.onload = null;
  img.onerror = null;
  img.removeAttribute('src');
  delete img.dataset.loaded;
  shell.classList.remove('loaded', 'load-error');
  if (currentImages[index]?.kind === 'cbz') releaseImageUrl(index);
}

function loadScrollNeighborhood(centerIndex, radius = 2) {
  const from = Math.max(0, centerIndex - radius);
  const to = Math.min(currentImages.length - 1, centerIndex + radius);
  for (let index = from; index <= to; index++) {
    const shell = pagesContainer.querySelector(`.page-shell[data-index="${index}"]`);
    if (!shell) continue;
    shell.dataset.wanted = 'true';
    loadImageElement(shell.querySelector('.page-img'), index);
  }
}

function saveProgressSoon(delay = 1000) {
  clearTimeout(progressSaveTimer);
  if (!currentKey) return;
  const key = currentKey;
  const value = isScrollMode()
    ? {
        page: scrollCurrentPage,
        scrollTop: reader.scrollTop,
        scrollLeft: reader.scrollLeft,
        mode: readMode
      }
    : { page: currentPage, mode: readMode };
  progressSaveTimer = setTimeout(() => {
    if (key === currentKey) ipcRenderer.invoke('save-progress', { key, value }).catch(console.warn);
  }, delay);
}

async function flushProgress() {
  clearTimeout(progressSaveTimer);
  if (!currentKey) return;
  const value = isScrollMode()
    ? { page: scrollCurrentPage, scrollTop: reader.scrollTop, scrollLeft: reader.scrollLeft, mode: readMode }
    : { page: currentPage, mode: readMode };
  try {
    await ipcRenderer.invoke('save-progress', { key: currentKey, value });
  } catch (error) {
    console.warn('Progress save failed:', error);
  }
}

async function releaseCurrentComic() {
  await flushProgress();
  sourceGeneration++;
  pagedRenderVersion++;
  pageObserver?.disconnect();
  imageLoadObserver?.disconnect();
  pageObserver = null;
  imageLoadObserver = null;
  document.querySelectorAll('.page-img').forEach(img => {
    img.onload = null;
    img.onerror = null;
    img.removeAttribute('src');
  });
  clearElement(pagesContainer);
  clearElement(_scrollHolder);
  releaseAllImageUrls();
  if (currentCbzSession) {
    try { await ipcRenderer.invoke('close-cbz-session', currentCbzSession); } catch {}
  }
  currentCbzSession = '';
  _scrollHolderKey = '';
  currentImages = [];
  currentKey = '';
}

// ── Library DOM refs ───────────────────────────────────
const btnSaveLibrary   = document.getElementById('btn-save-library');
const libraryViewEl    = document.getElementById('library-view');
const libraryViewGrid  = document.getElementById('library-view-grid');

// ── Bookmarks (localStorage) ──────────────────────────
const bookmarkSection   = document.getElementById('bookmark-section');
const bookmarkList      = document.getElementById('bookmark-list');
const bookmarkEmpty     = document.getElementById('bookmark-empty');
const btnAddBookmark    = document.getElementById('btn-add-bookmark');

function loadBookmarks(key) {
  try {
    const all = JSON.parse(localStorage.getItem('cd-bookmarks') || '{}');
    return all[key] || [];
  } catch { return []; }
}
function saveBookmarks(key, pages) {
  try {
    const all = JSON.parse(localStorage.getItem('cd-bookmarks') || '{}');
    if (pages.length === 0) { delete all[key]; }
    else { all[key] = pages.slice(0, 200); }
    const keys = Object.keys(all);
    while (keys.length > 100) delete all[keys.shift()];
    localStorage.setItem('cd-bookmarks', JSON.stringify(all));
  } catch (e) { console.error('saveBookmarks:', e); }
}
function addBookmark(page) {
  const pages = loadBookmarks(currentKey);
  if (pages.includes(page)) return;
  pages.push(page);
  pages.sort((a, b) => a - b);
  saveBookmarks(currentKey, pages);
  renderBookmarks();
}
function removeBookmark(page) {
  const pages = loadBookmarks(currentKey).filter(p => p !== page);
  saveBookmarks(currentKey, pages);
  renderBookmarks();
}
function renderBookmarks() {
  if (!currentKey) { bookmarkSection.style.display = 'none'; return; }
  bookmarkSection.style.display = 'block';
  const pages = loadBookmarks(currentKey);
  bookmarkList.textContent = '';
  if (pages.length === 0) {
    bookmarkList.appendChild(bookmarkEmpty);
    return;
  }
  pages.forEach(pageIdx => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';

    const label = document.createElement('div');
    label.className = 'bookmark-item-label';
    const mark = document.createElement('span');
    mark.textContent = `Page ${pageIdx + 1}`;
    label.appendChild(mark);
    label.append(` / ${currentImages.length}`);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'bookmark-del';
    delBtn.title = 'Delete bookmark';
    delBtn.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

    delBtn.addEventListener('click', (e) => { e.stopPropagation(); removeBookmark(pageIdx); });
    item.addEventListener('click', () => jumpToBookmark(pageIdx));
    item.appendChild(label);
    item.appendChild(delBtn);
    bookmarkList.appendChild(item);
  });
}
function jumpToBookmark(pageIdx) {
  if (isScrollMode()) {
    scrollCurrentPage = pageIdx;
    scrollToPageIndex(pageIdx);
  } else {
    currentPage = isDoublePage ? pageIdx - (pageIdx % 2) : pageIdx;
    renderPaged();
  }
}

btnAddBookmark.addEventListener('click', () => {
  const page = isScrollMode() ? scrollCurrentPage : currentPage;
  addBookmark(page);
});

// ── Library (localStorage) ─────────────────────────────
function loadLibrary() {
  try {
    const value = JSON.parse(localStorage.getItem('cd-library') || '[]');
    return Array.isArray(value) ? value.slice(0, 200) : [];
  } catch { return []; }
}
function saveLibraryData(lib) {
  try {
    localStorage.setItem('cd-library', JSON.stringify(lib.slice(0, 200)));
  } catch (error) {
    console.error('Library save failed:', error);
    alert('The library could not be saved because local storage is full.');
  }
}
function addLibraryEntry(entry) {
  const lib = loadLibrary();
  if (lib.some(e => e.id === entry.id)) return false;
  if (lib.length >= 200) {
    alert('The library is limited to 200 items. Remove an item before adding another.');
    return false;
  }
  lib.push(entry);
  saveLibraryData(lib);
  return true;
}
function removeLibraryEntry(id) {
  saveLibraryData(loadLibrary().filter(e => e.id !== id));
}

function updateSaveLibraryBtn() {
  if (!currentKey) { btnSaveLibrary.style.display = 'none'; return; }
  btnSaveLibrary.style.display = 'flex';
  const isSaved = loadLibrary().some(e => e.id === currentKey);
  btnSaveLibrary.classList.toggle('saved', isSaved);
  btnSaveLibrary.innerHTML = isSaved
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Saved to Library`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Save to Library`;
}

// ── Library view (main panel) ─────────────────────────
function hideLibraryView() {
  libraryViewEl.style.display = 'none';
  if (videoViewVisible) {
    document.getElementById('video-view').style.display = 'flex';
  } else if (currentKey) {
    reader.style.display = 'block';
  } else {
    emptyState.style.display = 'flex';
  }
}

async function showLibraryView() {
  emptyState.style.display = 'none';
  reader.style.display = 'none';
  loadingEl.style.display = 'none';
  document.getElementById('video-view').style.display = 'none';
  if (videoPlayer) videoPlayer.pause();
  libraryViewEl.style.display = 'flex';

  const lib = loadLibrary();
  clearElement(libraryViewGrid);
  const emptyEl = document.getElementById('library-view-empty');

  if (!lib.length) {
    emptyEl.style.display = 'flex';
    libraryViewGrid.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  libraryViewGrid.style.display = 'grid';

  // Build lightweight cards first, then resolve availability and thumbnails.
  const thumbEls = lib.map(entry => {
    const card = document.createElement('div');
    card.className = 'lib-view-card';
    if (entry.id === currentKey) card.classList.add('active');

    const delBtn = document.createElement('button');
    delBtn.className = 'lib-view-delete';
    delBtn.title = 'Remove from library';
    delBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      card.style.transition = 'opacity 0.15s, transform 0.15s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.9)';
      setTimeout(() => {
        removeLibraryEntry(entry.id);
        card.remove();
        if (libraryViewGrid.children.length === 0) {
          libraryViewGrid.style.display = 'none';
          document.getElementById('library-view-empty').style.display = 'flex';
        }
        updateSaveLibraryBtn();
      }, 150);
    });
    card.appendChild(delBtn);

    const thumb = document.createElement('div');
    thumb.className = 'lib-view-thumb';

    const placeholderIcon = entry.type === 'web'
      ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`
      : entry.type === 'cbz'
        ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`
        : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

    const typeLabel = entry.type === 'folder' ? 'Folder' : entry.type === 'web' ? 'Web' : 'CBZ';
    thumb.innerHTML = `<div class="lib-view-thumb-placeholder">${placeholderIcon}<span>${typeLabel}</span></div>`;

    const info = document.createElement('div');
    info.className = 'lib-view-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'lib-view-name';
    nameEl.title = entry.name;
    nameEl.textContent = entry.name;

    const typeEl = document.createElement('div');
    typeEl.className = 'lib-view-type';
    typeEl.textContent = typeLabel;

    info.appendChild(nameEl);
    info.appendChild(typeEl);

    card.appendChild(thumb);
    card.appendChild(info);

    card.addEventListener('click', () => {
      if (card.classList.contains('is-missing')) {
        alert(`${entry.name} is no longer available at its saved location.`);
        return;
      }
      hideLibraryView();
      if (entry.type === 'folder') loadFolder(entry.path);
      else if (entry.type === 'web') { urlInput.value = entry.path; openUrlModal(); }
      else loadCBZ(entry.path);
    });

    libraryViewGrid.appendChild(card);
    return { entry, thumb, card, typeEl };
  });

  // Resolve entries independently so a slow disk does not block the panel.
  processConcurrently(thumbEls, 4, async ({ entry, thumb, card, typeEl }) => {
    try {
      const status = await ipcRenderer.invoke('get-source-status', entry.type, entry.path);
      if (!status.available) {
        card.classList.add('is-missing');
        typeEl.textContent = status.reason || 'Source unavailable';
        return;
      }
      if (entry.type === 'web') return;
      const ipcCall = entry.type === 'folder' ? 'get-folder-thumbnail' : 'get-cbz-thumbnail';
      const src = await ipcRenderer.invoke(ipcCall, entry.path);
      if (src && libraryViewEl.style.display !== 'none') {
        clearElement(thumb);
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        thumb.appendChild(img);
      }
    } catch (error) {
      card.classList.add('is-missing');
      typeEl.textContent = 'Source unavailable';
      console.warn('Library source check failed:', entry.path, error);
    }
  }).catch(error => console.warn('Library scan failed:', error));
}

document.getElementById('btn-show-library').addEventListener('click', showLibraryView);
document.getElementById('btn-close-library-view').addEventListener('click', hideLibraryView);

// ── Export / Import library ────────────────────────────
document.getElementById('btn-export-library').addEventListener('click', () => {
  const lib = loadLibrary();
  const json = JSON.stringify({ version: 1, library: lib }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cd-library.json';
  a.click();
  URL.revokeObjectURL(url);
});

const importInput = document.getElementById('import-library-input');
document.getElementById('btn-import-library').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const entries = Array.isArray(data) ? data : (data.library || []);
    if (!Array.isArray(entries)) { alert('Invalid file.'); return; }
    const existing = loadLibrary();
    const existingIds = new Set(existing.map(e => e.id));
    let added = 0;
    entries.forEach(entry => {
      if (entry.id && entry.name && entry.type && !existingIds.has(entry.id)) {
        existing.push(entry);
        existingIds.add(entry.id);
        added++;
      }
    });
    saveLibraryData(existing.slice(0, 200));
    importInput.value = '';
    await showLibraryView();
    if (added > 0) alert(`Imported ${added} item(s) into the library.`);
    else alert('No new items were added (all items already exist).');
  } catch {
    alert('File read error. Make sure the JSON file is valid.');
  }
});

btnSaveLibrary.addEventListener('click', () => {
  if (!currentKey) return;
  const type = currentKey.startsWith('folder:') ? 'folder'
             : currentKey.startsWith('cbz:')    ? 'cbz' : 'web';
  const srcPath = currentKey.replace(/^(folder:|cbz:|web:)/, '');
  const name = infoName.textContent || srcPath.split(/[\\/]/).pop() || srcPath;
  addLibraryEntry({ id: currentKey, name, type, path: srcPath });
  updateSaveLibraryBtn();
});

// ── Init ───────────────────────────────────────────────
loadAndRenderHistory();

// ── URL Modal ──────────────────────────────────────────
const urlModalOverlay = document.getElementById('url-modal-overlay');
const urlInput        = document.getElementById('url-input');
const urlStatus       = document.getElementById('url-status');
const urlLoadBtn      = document.getElementById('url-load-btn');
const urlCancelBtn    = document.getElementById('url-cancel-btn');
const urlModalClose   = document.getElementById('url-modal-close');
const urlPasteBtn     = document.getElementById('url-paste-btn');

function openUrlModal() {
  urlModalOverlay.style.display = 'flex';
  setUrlStatus('', '');
  urlLoadBtn.disabled = false;
  setTimeout(() => urlInput.focus(), 80);
}
function closeUrlModal() {
  urlModalOverlay.style.display = 'none';
  urlInput.value = '';
  setUrlStatus('', '');
  urlLoadBtn.disabled = false;
}
function setUrlStatus(type, msg) {
  if (!type || !msg) { urlStatus.style.display = 'none'; return; }
  urlStatus.style.display = 'flex';
  urlStatus.className = 'url-status ' + type;
  urlStatus.textContent = '';
  const iconSpan = document.createElement('span');
  const textSpan = document.createElement('span');
  textSpan.textContent = msg;
  if (type === 'loading') {
    iconSpan.className = 'status-spinner';
  } else {
    iconSpan.textContent = type === 'error' ? '✕' : '✓';
  }
  urlStatus.appendChild(iconSpan);
  urlStatus.appendChild(textSpan);
}

document.getElementById('btn-open-url').addEventListener('click', openUrlModal);
urlModalClose.addEventListener('click', closeUrlModal);
urlCancelBtn.addEventListener('click', closeUrlModal);
urlModalOverlay.addEventListener('click', (e) => { if (e.target === urlModalOverlay) closeUrlModal(); });

urlPasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    urlInput.value = text.trim();
    urlInput.focus();
  } catch (e) { console.warn('Clipboard read failed:', e); }
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') urlLoadBtn.click();
  if (e.key === 'Escape') closeUrlModal();
});

urlLoadBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) { setUrlStatus('error', 'Please enter a chapter URL'); return; }
  if (!/^https?:\/\//i.test(url)) { setUrlStatus('error', 'URL must start with http:// or https://'); return; }

  urlLoadBtn.disabled = true;
  setUrlStatus('loading', 'Loading page, please wait...');

  try {
    const result = await ipcRenderer.invoke('fetch-web-chapter', url);
    if (!result || !result.images || result.images.length === 0) {
      setUrlStatus('error', 'No comic images found. Try another site or check the URL.');
      urlLoadBtn.disabled = false;
      return;
    }
    setUrlStatus('success', `Found ${result.images.length} page(s) - opening...`);
    setTimeout(async () => {
      closeUrlModal();
      await loadFromWeb(result);
    }, 600);
  } catch (err) {
    setUrlStatus('error', err.message || 'Unknown error');
    urlLoadBtn.disabled = false;
  }
});

// ── Fullscreen (ẩn/hiện sidebar) ──────────────────────
function toggleSidebar() {
  document.body.classList.toggle('sidebar-hidden');
}
document.getElementById('btn-fullscreen').addEventListener('click', toggleSidebar);

// ── Window controls ────────────────────────────────────
document.getElementById('btn-min').addEventListener('click', () => ipcRenderer.send('win-minimize'));
document.getElementById('btn-max').addEventListener('click', () => ipcRenderer.send('win-maximize'));
document.getElementById('btn-close').addEventListener('click', () => ipcRenderer.send('win-close'));

// ── Open actions ───────────────────────────────────────
document.getElementById('btn-open-file').addEventListener('click', async () => {
  const filePath = await ipcRenderer.invoke('open-file');
  if (!filePath) return;
  await loadCBZ(filePath);
});

document.getElementById('btn-open-folder').addEventListener('click', async () => {
  const folderPath = await ipcRenderer.invoke('open-folder');
  if (!folderPath) return;
  await loadFolder(folderPath);
});

// ── Load CBZ ───────────────────────────────────────────
async function loadCBZ(filePath) {
  const requestId = ++sourceLoadRequest;
  showLoading();
  try {
    const result = await ipcRenderer.invoke('read-cbz', filePath);
    if (!result?.sessionId || !Array.isArray(result.pages) || !result.pages.length) {
      throw new Error('No supported images were found in this archive.');
    }
    if (requestId !== sourceLoadRequest) {
      await ipcRenderer.invoke('close-cbz-session', result.sessionId);
      return;
    }
    await releaseCurrentComic();
    const name = filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    currentKey = 'cbz:' + filePath;
    currentCbzSession = result.sessionId;
    const images = result.pages.map(page => ({
      kind: 'cbz',
      sessionId: result.sessionId,
      index: page.index,
      mime: page.mime
    }));
    await renderPages(images, name);
  } catch (e) {
    alert('File read error: ' + e.message);
    hideLoading();
    if (currentKey) reader.style.display = 'block';
    else emptyState.style.display = 'flex';
  }
}

// ── Load from Web ──────────────────────────────────────
async function loadFromWeb(result) {
  const requestId = ++sourceLoadRequest;
  showLoading();
  try {
    const { images, title, url } = result;
    if (!Array.isArray(images) || !images.length) throw new Error('No comic images were found.');
    if (requestId !== sourceLoadRequest) return;
    await releaseCurrentComic();
    currentKey = 'web:' + url;
    const name = title || new URL(url).hostname;
    await renderPages(images, name);
  } catch (e) {
    alert('Error opening web chapter: ' + e.message);
    hideLoading();
    if (currentKey) reader.style.display = 'block';
    else emptyState.style.display = 'flex';
  }
}
async function loadFolder(folderPath) {
  const requestId = ++sourceLoadRequest;
  showLoading();
  try {
    const files = await ipcRenderer.invoke('read-folder', folderPath);
    if (requestId !== sourceLoadRequest) return;
    if (!files.length) {
      alert('No images found in this folder.');
      hideLoading();
      if (currentKey) reader.style.display = 'block';
      else emptyState.style.display = 'flex';
      return;
    }
    await releaseCurrentComic();
    const imageSrcs = files.map(filePath => {
      const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
      return encodeURI(`file:///${normalized}`);
    });
    const name = folderPath.split(/[\\/]/).pop();
    currentKey = 'folder:' + folderPath;
    await renderPages(imageSrcs, name);
  } catch (e) {
    alert('Folder read error: ' + e.message);
    hideLoading();
    if (currentKey) reader.style.display = 'block';
    else emptyState.style.display = 'flex';
  }
}

// ── Render pages ───────────────────────────────────────
function createScrollPage(index) {
  const shell = document.createElement('div');
  shell.className = 'page-shell';
  shell.dataset.index = index;
  shell.style.width = imgWidth + '%';
  shell.style.marginBottom = pageGap + 'px';

  const img = document.createElement('img');
  img.className = 'page-img';
  img.dataset.index = index;
  img.alt = `Page ${index + 1}`;
  img.decoding = 'async';
  shell.appendChild(img);
  return shell;
}

function buildScrollPages() {
  clearElement(pagesContainer);

  // Reuse the lightweight shells when returning from paged mode.
  if (_scrollHolderKey === currentKey && _scrollHolder.children.length === currentImages.length) {
    while (_scrollHolder.firstChild) pagesContainer.appendChild(_scrollHolder.firstChild);
    return;
  }

  _scrollHolderKey = currentKey;
  const fragment = document.createDocumentFragment();
  currentImages.forEach((_source, index) => fragment.appendChild(createScrollPage(index)));
  pagesContainer.appendChild(fragment);
}

async function renderPages(imageSrcs, name) {
  currentImages = imageSrcs;
  currentPage = 0;
  scrollCurrentPage = 0;
  pageObserver?.disconnect();
  imageLoadObserver?.disconnect();
  buildScrollPages();

  infoName.textContent = name;
  infoPages.textContent = imageSrcs.length;
  infoName.title = name;
  scrollPageTotal.textContent = ' / ' + imageSrcs.length;

  updateSaveLibraryBtn();
  renderBookmarks();

  emptyState.style.display = 'none';
  reader.style.display = 'block';
  hideLoading();

  applyReadMode();

  // Restore by page first; pixel offsets are only a fallback for older data.
  const saved = await ipcRenderer.invoke('load-progress', currentKey);
  if (isScrollMode()) {
    if (saved) {
      const restoredPage = Number.isInteger(saved.page)
        ? Math.max(0, Math.min(currentImages.length - 1, saved.page))
        : 0;
      scrollCurrentPage = restoredPage;
      requestAnimationFrame(() => {
        scrollToPageIndex(restoredPage, false);
        if (!Number.isInteger(saved.page) && saved.scrollTop) reader.scrollTop = saved.scrollTop;
        if (!Number.isInteger(saved.page) && saved.scrollLeft) reader.scrollLeft = saved.scrollLeft;
      });
    }
  } else {
    if (saved && typeof saved.page === 'number' && saved.page < currentImages.length) {
      currentPage = saved.page;
      renderPaged();
    }
  }

  saveToHistory(name)
    .then(loadAndRenderHistory)
    .catch(error => console.warn('History update failed:', error));
}

// ── Page observer ──────────────────────────────────────
function setupPageObserver(horizontal = false) {
  if (pageObserver) pageObserver.disconnect();
  pageObserver = new IntersectionObserver((entries) => {
    let topMost = null;
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const idx = parseInt(entry.target.dataset.index);
        if (topMost === null || idx < topMost) topMost = idx;
      }
    });
    if (topMost !== null) {
      scrollCurrentPage = topMost;
      loadScrollNeighborhood(topMost);
      const cur = topMost + 1;
      pageIndicatorTx.textContent = cur + ' / ' + currentImages.length;
      infoCurrent.textContent = cur;
      if (isScrollMode()) updateScrollNavUI();
    }
  }, { root: reader, threshold: 0.3 });

  document.querySelectorAll('.page-shell').forEach(shell => pageObserver.observe(shell));
}

function setupImageLoadObserver(horizontal = false) {
  imageLoadObserver?.disconnect();
  const generation = sourceGeneration;
  imageLoadObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const shell = entry.target;
      const index = Number(shell.dataset.index);
      if (entry.isIntersecting) {
        shell.dataset.wanted = 'true';
        loadImageElement(shell.querySelector('.page-img'), index, generation);
      } else if (Math.abs(index - scrollCurrentPage) > 4) {
        shell.dataset.wanted = 'false';
        unloadScrollImage(shell);
      }
    });
  }, {
    root: reader,
    rootMargin: horizontal ? '100% 200%' : '200% 100%',
    threshold: 0.01
  });
  document.querySelectorAll('.page-shell').forEach(shell => imageLoadObserver.observe(shell));
  loadScrollNeighborhood(scrollCurrentPage);
}

// ── Save progress on scroll ────────────────────────────
reader.addEventListener('scroll', () => {
  saveProgressSoon(1200);
  if (readMode === 'scroll') {
    scrollTopBtn.style.display = reader.scrollTop > 300 ? 'flex' : 'none';
  }
});

// ── Scroll to top ──────────────────────────────────────
scrollTopBtn.addEventListener('click', () => {
  reader.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Width slider ───────────────────────────────────────
widthSlider.addEventListener('input', () => {
  imgWidth = parseInt(widthSlider.value);
  widthValue.textContent = imgWidth + '%';
  if (readMode === 'scroll') {
    document.querySelectorAll('.page-shell').forEach(shell => {
      shell.style.width = imgWidth + '%';
    });
  }
});

// ── Gap slider ─────────────────────────────────────────
gapSlider.addEventListener('input', () => {
  pageGap = parseInt(gapSlider.value);
  gapValue.textContent = pageGap + 'px';
  document.querySelectorAll('.page-shell').forEach(shell => {
    if (readMode === 'scroll') shell.style.marginBottom = pageGap + 'px';
    else shell.style.marginRight = pageGap + 'px';
  });
});

// ── Background picker ──────────────────────────────────
document.querySelectorAll('.bg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.bg;
    document.getElementById('main').style.background = color;
    document.getElementById('reader').style.background = color;
    document.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Read mode buttons ─────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const newMode = btn.dataset.mode;
    if (newMode === readMode) return;
    readMode = newMode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (currentImages.length > 0) applyReadMode();
  });
});

// Scrolling modes share the same lazy page shell pipeline.
function isScrollMode() {
  return readMode === 'scroll' || readMode === 'scroll-ltr' || readMode === 'scroll-rtl';
}

function applyReadMode() {
  const container = pagesContainer;

  if (isScrollMode()) {
    // Rebuild the scrolling shells when returning from paged mode.
    const comingFromPaged = !!container.querySelector('.paged-layout');
    if (comingFromPaged || !container.querySelector('.page-shell')) {
      buildScrollPages();
    }

    reader.classList.remove('paged-mode');

    if (readMode === 'scroll') {
      container.style.flexDirection = 'column';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'flex-start';
      container.style.padding = '20px 0 60px';
      container.style.minWidth = '';
      container.style.height = '';
      reader.style.overflowY = 'scroll';
      reader.style.overflowX = 'hidden';
      document.querySelectorAll('.page-shell').forEach(shell => {
        shell.style.width = imgWidth + '%';
        shell.style.height = 'auto';
        shell.style.maxHeight = '';
        shell.style.marginBottom = pageGap + 'px';
        shell.style.marginRight = '';
        const img = shell.querySelector('.page-img');
        img.style.objectFit = 'contain';
      });
    } else {
      container.style.flexDirection = readMode === 'scroll-rtl' ? 'row-reverse' : 'row';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'flex-start';
      container.style.padding = '8px 40px';
      container.style.minWidth = 'max-content';
      container.style.height = '100%';
      reader.style.overflowY = 'hidden';
      reader.style.overflowX = 'scroll';
      document.querySelectorAll('.page-shell').forEach(shell => {
        shell.style.width = 'auto';
        shell.style.height = (reader.clientHeight - 16) + 'px';
        shell.style.maxHeight = '100%';
        shell.style.marginBottom = '';
        shell.style.marginRight = pageGap + 'px';
        const img = shell.querySelector('.page-img');
        img.style.objectFit = 'contain';
      });
    }

    sidebarPagedNav.style.display = 'none';
    sidebarScrollNav.style.display = 'block';
    pageIndicator.style.display = 'block';
    scrollTopBtn.style.display = readMode === 'scroll' && reader.scrollTop > 300 ? 'flex' : 'none';
    updateScrollNavUI();
    setupPageObserver(readMode !== 'scroll');
    setupImageLoadObserver(readMode !== 'scroll');

    if (comingFromPaged) {
      scrollCurrentPage = currentPage;
    }
    requestAnimationFrame(() => scrollToPageIndex(scrollCurrentPage, false));

    saveProgressSoon(300);

  } else {
    const comingFromScroll = !!container.querySelector('.page-shell');
    if (comingFromScroll) {
      currentPage = scrollCurrentPage;
      _scrollHolderKey = currentKey;
      clearElement(_scrollHolder);
      Array.from(pagesContainer.querySelectorAll('.page-shell')).forEach(shell => {
        unloadScrollImage(shell);
        _scrollHolder.appendChild(shell);
      });
    }

    reader.classList.add('paged-mode');
    if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
    if (imageLoadObserver) { imageLoadObserver.disconnect(); imageLoadObserver = null; }
    reader.style.overflowY = 'hidden';
    reader.style.overflowX = 'hidden';
    pageIndicator.style.display = 'none';
    scrollTopBtn.style.display = 'none';
    sidebarPagedNav.style.display = 'block';
    sidebarScrollNav.style.display = 'none';
    renderPaged();
  }
}

// Điều hướng nút prev/next (đã xử lý hướng rtl trong changePage)
navNext.addEventListener('click', () => {
  readMode === 'rtl' ? changePage('prev') : changePage('next');
});
navPrev.addEventListener('click', () => {
  readMode === 'rtl' ? changePage('next') : changePage('prev');
});

// ── Keyboard shortcuts ─────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'o') { document.getElementById('btn-open-file').click(); return; }
  if (e.ctrlKey && e.key === 'f') { document.getElementById('btn-open-folder').click(); return; }

  const tag = e.target.tagName;
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Video shortcuts take priority when video view is visible
  if (videoViewVisible) {
    if (e.key === ' ' && !isInput) {
      e.preventDefault();
      videoPlayer.paused ? videoPlayer.play() : videoPlayer.pause();
    }
    if (e.key === 'ArrowLeft' && !isInput) {
      e.preventDefault();
      videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 5);
    }
    if (e.key === 'ArrowRight' && !isInput) {
      e.preventDefault();
      videoPlayer.currentTime = Math.min(videoPlayer.duration || 0, videoPlayer.currentTime + 5);
    }
    if (e.key === 'ArrowUp' && !isInput) {
      e.preventDefault();
      videoPlayer.volume = Math.min(1, Math.round((videoPlayer.volume + 0.1) * 10) / 10);
      updateVideoVolumeUI();
    }
    if (e.key === 'ArrowDown' && !isInput) {
      e.preventDefault();
      videoPlayer.volume = Math.max(0, Math.round((videoPlayer.volume - 0.1) * 10) / 10);
      updateVideoVolumeUI();
    }
    if (e.key === 'm' && !e.ctrlKey && !e.altKey && !isInput) {
      videoPlayer.muted = !videoPlayer.muted;
      updateVideoVolumeUI();
    }
    if (e.key === 'f' && !e.ctrlKey && !e.altKey && !isInput) toggleSidebar();
    return;
  }

  if (readMode === 'scroll') {
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      reader.scrollBy({ top: reader.clientHeight * 0.9, behavior: 'smooth' }); e.preventDefault();
    }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      reader.scrollBy({ top: -reader.clientHeight * 0.9, behavior: 'smooth' }); e.preventDefault();
    }
    if (e.key === 'Home') { reader.scrollTo({ top: 0, behavior: 'smooth' }); e.preventDefault(); }
    if (e.key === 'End')  { reader.scrollTo({ top: reader.scrollHeight, behavior: 'smooth' }); e.preventDefault(); }
  } else if (readMode === 'scroll-ltr') {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      reader.scrollBy({ left: reader.clientWidth * 0.9, behavior: 'smooth' }); e.preventDefault();
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      reader.scrollBy({ left: -reader.clientWidth * 0.9, behavior: 'smooth' }); e.preventDefault();
    }
    if (e.key === 'Home') { reader.scrollTo({ left: 0, behavior: 'smooth' }); e.preventDefault(); }
    if (e.key === 'End')  { reader.scrollTo({ left: reader.scrollWidth, behavior: 'smooth' }); e.preventDefault(); }
  } else if (readMode === 'scroll-rtl') {
    // row-reverse: trang 0 ở scrollLeft max, trang tiếp theo = giảm scrollLeft
    if (e.key === 'ArrowLeft' || e.key === 'PageDown') {
      reader.scrollBy({ left: -reader.clientWidth * 0.9, behavior: 'smooth' }); e.preventDefault();
    }
    if (e.key === 'ArrowRight' || e.key === 'PageUp') {
      reader.scrollBy({ left: reader.clientWidth * 0.9, behavior: 'smooth' }); e.preventDefault();
    }
    if (e.key === 'Home') { reader.scrollTo({ left: reader.scrollWidth, behavior: 'smooth' }); e.preventDefault(); }
    if (e.key === 'End')  { reader.scrollTo({ left: 0, behavior: 'smooth' }); e.preventDefault(); }
  } else {
    // Paged mode — ArrowLeft/Right + PageUp/Down
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      readMode === 'rtl' ? changePage('prev') : changePage('next'); e.preventDefault();
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      readMode === 'rtl' ? changePage('next') : changePage('prev'); e.preventDefault();
    }
    if (e.key === 'Home') { currentPage = 0; renderPaged(); e.preventDefault(); }
    if (e.key === 'End')  { currentPage = currentImages.length - 1; renderPaged(); e.preventDefault(); }
  }

  if (e.key === '[') { widthSlider.value = Math.max(30, imgWidth - 5); widthSlider.dispatchEvent(new Event('input')); }
  if (e.key === ']') { widthSlider.value = Math.min(100, imgWidth + 5); widthSlider.dispatchEvent(new Event('input')); }

  if (e.key === 'f' && !e.ctrlKey && !e.altKey && !isInput) toggleSidebar();
  if (e.key === 'b' && !e.ctrlKey && !e.altKey && !isInput && currentKey) {
    const page = isScrollMode() ? scrollCurrentPage : currentPage;
    addBookmark(page);
  }
});

reader.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -5 : 5;
    widthSlider.value = Math.min(100, Math.max(30, imgWidth + delta));
    widthSlider.dispatchEvent(new Event('input'));
  }
}, { passive: false });

doublePageToggle.addEventListener('change', (e) => {
  isDoublePage = e.target.checked;
  // Đảm bảo trang hiện tại luôn là số chẵn (index chẵn) khi xem 2 trang để không bị kẹp ảnh
  if (isDoublePage && currentPage % 2 !== 0) {
    currentPage = Math.max(0, currentPage - 1);
  }
  renderPaged();
});

pageInput.addEventListener('change', (e) => {
  let val = parseInt(e.target.value) - 1; // Chuyển từ hiển thị (1-based) sang index (0-based)
  if (val >= 0 && val < currentImages.length) {
    currentPage = isDoublePage ? val - (val % 2) : val; // Tự fix index nếu ở chế độ 2 trang
    renderPaged();
  } else {
    e.target.value = currentPage + 1; // Reset nếu nhập sai phạm vi
  }
});
async function saveToHistory(name) {
  let thumbnail = null;
  try {
    if (currentKey.startsWith('folder:')) {
      thumbnail = await ipcRenderer.invoke('get-folder-thumbnail', currentKey.replace('folder:', ''));
    } else if (currentKey.startsWith('cbz:')) {
      thumbnail = await ipcRenderer.invoke('get-cbz-thumbnail', currentKey.replace('cbz:', ''));
    } else if (currentKey.startsWith('web:')) {
      // Dùng ảnh đầu tiên của chapter làm thumbnail
      if (currentImages.length > 0) thumbnail = currentImages[0];
    }
  } catch (e) { console.warn('Thumbnail for history failed:', e); }

  const type = currentKey.startsWith('folder:') ? 'folder'
             : currentKey.startsWith('cbz:')    ? 'cbz'
             : 'web';
  const srcPath = currentKey.replace(/^(folder:|cbz:|web:)/, '');
  await ipcRenderer.invoke('history-add', { key: currentKey, name, type, path: srcPath, thumbnail });
}

async function loadAndRenderHistory() {
  const list = await ipcRenderer.invoke('history-get');
  clearElement(historyList);

  if (!list || list.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'history-empty';
    empty.textContent = 'No reading history yet';
    historyList.appendChild(empty);
    return;
  }

  list.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'history-card';
    if (entry.key === currentKey) card.classList.add('active');

    // Thumbnail
    if (entry.thumbnail) {
      const img = document.createElement('img');
      img.className = 'history-thumb';
      img.src = entry.thumbnail;
      img.alt = entry.name;
      card.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'history-thumb-placeholder';
      ph.textContent = '📖';
      card.appendChild(ph);
    }

    // Info
    const info = document.createElement('div');
    info.className = 'history-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'history-name';
    nameEl.textContent = entry.name;
    nameEl.title = entry.name;

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = entry.type === 'folder' ? 'Folder' : entry.type === 'web' ? '🌐 Web' : 'CBZ';

    info.appendChild(nameEl);
    info.appendChild(meta);
    card.appendChild(info);

    const delBtn = document.createElement('button');
    delBtn.className = 'history-delete-btn';
    delBtn.title = 'Remove from history';
    delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;

    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();

      card.style.transition = 'opacity 0.18s, transform 0.18s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(-8px)';
      setTimeout(async () => {
        await ipcRenderer.invoke('history-remove', entry.key);
        await loadAndRenderHistory();
      }, 180);
    });

    card.appendChild(delBtn);

    card.addEventListener('click', () => {
      if (card.classList.contains('is-missing')) {
        alert(`${entry.name} is no longer available at its saved location.`);
        return;
      }
      if (entry.type === 'folder') loadFolder(entry.path);
      else if (entry.type === 'web') {
        urlInput.value = entry.path;
        openUrlModal();
      }
      else loadCBZ(entry.path);
    });

    historyList.appendChild(card);

    ipcRenderer.invoke('get-source-status', entry.type, entry.path)
      .then(status => {
        if (!status.available) {
          card.classList.add('is-missing');
          meta.textContent = status.reason || 'Source unavailable';
        }
      })
      .catch(error => {
        card.classList.add('is-missing');
        meta.textContent = 'Source unavailable';
        console.warn('History source check failed:', entry.path, error);
      });
  });
}

// ── Helpers ────────────────────────────────────────────
function showLoading() {
  emptyState.style.display = 'none';
  reader.style.display = 'none';
  libraryViewEl.style.display = 'none';
  document.getElementById('video-view').style.display = 'none';
  if (videoPlayer) videoPlayer.pause();
  videoViewVisible = false;
  loadingEl.style.display = 'flex';
}

function hideLoading() {
  loadingEl.style.display = 'none';
}

async function renderPaged() {
  const renderVersion = ++pagedRenderVersion;
  clearElement(pagesContainer);
  if (currentImages.length === 0) return;

  currentPage = Math.max(0, Math.min(currentImages.length - 1, currentPage));

  const container = document.createElement('div');
  container.className = 'paged-layout';

  if (readMode === 'rtl') container.classList.add('rtl');
  if (isDoublePage) container.classList.add('double-page');

  let lastIdx = currentPage;
  const indexes = [currentPage];
  if (isDoublePage && currentPage + 1 < currentImages.length) {
    lastIdx = currentPage + 1;
    indexes.push(lastIdx);
  }

  const pageImages = indexes.map(index => {
    const shell = document.createElement('div');
    shell.className = 'paged-page-shell loading';
    shell.dataset.index = index;
    const img = document.createElement('img');
    img.className = 'paged-page-img';
    img.dataset.index = index;
    img.alt = `Page ${index + 1}`;
    img.decoding = 'async';
    img.style.maxHeight = (reader.clientHeight - 16) + 'px';
    shell.appendChild(img);
    container.appendChild(shell);
    return { img, index };
  });

  pagesContainer.appendChild(container);
  await Promise.all(pageImages.map(({ img, index }) => loadImageElement(img, index)));
  if (renderVersion !== pagedRenderVersion) return;

  const keepIndexes = new Set();
  const preloadRadius = isDoublePage ? 2 : 1;
  for (let index = currentPage - preloadRadius; index <= lastIdx + preloadRadius; index++) {
    if (index >= 0 && index < currentImages.length) keepIndexes.add(index);
  }
  prunePagedCache(keepIndexes);
  keepIndexes.forEach(index => {
    if (!indexes.includes(index)) preloadPagedImage(index);
  });

  const fromDisp = currentPage + 1;
  const toDisp = lastIdx + 1;
  const label = (toDisp > fromDisp) ? `${fromDisp}-${toDisp}` : `${fromDisp}`;

  pageInput.value = fromDisp;
  pageInput.max = currentImages.length;
  pageTotal.textContent = ` / ${currentImages.length}`;
  pageIndicator.title = `Page ${label} / ${currentImages.length}`;
  pageIndicatorTx.textContent = `${label} / ${currentImages.length}`;
  infoCurrent.textContent = label;

  const atStart = currentPage === 0;
  const atEnd = lastIdx >= currentImages.length - 1;
  if (readMode === 'rtl') {
    navPrev.disabled = atEnd;
    navNext.disabled = atStart;
  } else {
    navPrev.disabled = atStart;
    navNext.disabled = atEnd;
  }

  saveProgressSoon(350);
}

function changePage(direction) {
  const step = isDoublePage ? 2 : 1;
  if (direction === 'next') {
    if (currentPage + step <= currentImages.length - 1) {
      currentPage += step;
    } else if (currentPage < currentImages.length - 1) {
      currentPage = currentImages.length - 1;
    } else {
      return;
    }
    renderPaged();
  } else if (direction === 'prev') {
    if (currentPage - step >= 0) {
      currentPage -= step;
    } else if (currentPage > 0) {
      currentPage = 0;
    } else {
      return;
    }
    renderPaged();
  }
}

// ── Điều hướng bằng chuột (chế độ ltr/rtl) ─────────────
// Click vào nửa trái/phải của khung đọc để lùi/tiến trang.
// Lăn chuột (wheel) cũng đổi trang khi đang ở chế độ paged.
let mouseDownPos = null;

reader.addEventListener('mousedown', (e) => {
  if (isScrollMode()) return;
  mouseDownPos = { x: e.clientX, y: e.clientY };
});

reader.addEventListener('click', (e) => {
  if (isScrollMode()) return;
  if (e.target.closest('#sidebar-paged-nav')) return;
  if (mouseDownPos) {
    const dx = Math.abs(e.clientX - mouseDownPos.x);
    const dy = Math.abs(e.clientY - mouseDownPos.y);
    if (dx > 6 || dy > 6) { mouseDownPos = null; return; }
  }
  mouseDownPos = null;

  const rect = reader.getBoundingClientRect();
  const isLeftSide = (e.clientX - rect.left) < rect.width / 2;

  if (readMode === 'rtl') {
    isLeftSide ? changePage('next') : changePage('prev');
  } else {
    isLeftSide ? changePage('prev') : changePage('next');
  }
});

reader.addEventListener('wheel', (e) => {
  if (e.ctrlKey) return; // zoom handled elsewhere
  // Chế độ paged: wheel đổi trang
  if (!isScrollMode()) {
    e.preventDefault();
    if (e.deltaY > 0 || e.deltaX > 0) changePage('next');
    else if (e.deltaY < 0 || e.deltaX < 0) changePage('prev');
    return;
  }
  // Chế độ cuộn ngang: deltaY chuyển thành scrollLeft smooth
  if (readMode === 'scroll-ltr' || readMode === 'scroll-rtl') {
    if (e.deltaY !== 0 && e.deltaX === 0) {
      e.preventDefault();
      // scroll-rtl: cuộn xuống = đọc tiếp = giảm scrollLeft (ngược chiều scroll-ltr)
      const dir = readMode === 'scroll-rtl' ? -1 : 1;
      reader.scrollBy({ left: e.deltaY * 2.5 * dir, behavior: 'smooth' });
    }
  }
}, { passive: false });
// ── Scroll navigation helpers ──────────────────────────
function updateScrollNavUI() {
  const total = currentImages.length;
  const cur = scrollCurrentPage + 1;
  scrollPageDisplay.textContent = cur;
  scrollPageTotal.textContent = ' / ' + total;
  scrollNavPrev.disabled = scrollCurrentPage <= 0;
  scrollNavNext.disabled = scrollCurrentPage >= total - 1;
}

function scrollToPageIndex(idx, smooth = true) {
  const target = pagesContainer.querySelector(`.page-shell[data-index="${idx}"]`);
  if (!target) return;
  const behavior = smooth ? 'smooth' : 'auto';
  loadScrollNeighborhood(idx);
  if (readMode === 'scroll') {
    reader.scrollTo({ top: target.offsetTop - 8, behavior });
  } else {
    reader.scrollTo({ left: target.offsetLeft - 8, behavior });
  }
}

scrollNavPrev.addEventListener('click', () => {
  const newIdx = Math.max(0, scrollCurrentPage - 1);
  scrollToPageIndex(newIdx);
});
scrollNavNext.addEventListener('click', () => {
  const newIdx = Math.min(currentImages.length - 1, scrollCurrentPage + 1);
  scrollToPageIndex(newIdx);
});

// ── Resize: cập nhật lại layout paged khi đổi kích thước cửa sổ ──
window.addEventListener('resize', () => {
  if (currentImages.length === 0) return;
  if (!isScrollMode()) {
    renderPaged();
  } else if (readMode === 'scroll-ltr' || readMode === 'scroll-rtl') {
    document.querySelectorAll('.page-shell').forEach(shell => {
      shell.style.height = (reader.clientHeight - 16) + 'px';
    });
  }
});

// ── Video viewer ────────────────────────────────────────
const videoViewEl   = document.getElementById('video-view');
const videoMainEl   = document.getElementById('video-main');
const videoPlayer   = document.getElementById('video-player');
const videoSeek     = document.getElementById('video-seek');
const videoVolume   = document.getElementById('video-volume');
const videoTimeEl   = document.getElementById('video-time');
const videoPlayBtn  = document.getElementById('video-play');
const videoMuteBtn  = document.getElementById('video-mute');
const videoPrevBtn  = document.getElementById('video-prev');
const videoNextBtn  = document.getElementById('video-next');
const videoSpeed    = document.getElementById('video-speed');
const videoFSBtn    = document.getElementById('video-fullscreen');
const videoPlaylist = document.getElementById('video-playlist');

const PLAY_ICON  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const PAUSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const VOL_ICON   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
const MUTE_ICON  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

function fmtTime(s) {
  if (!isFinite(s) || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function showVideoView() {
  emptyState.style.display = 'none';
  reader.style.display = 'none';
  libraryViewEl.style.display = 'none';
  loadingEl.style.display = 'none';
  videoViewEl.style.display = 'flex';
  videoViewVisible = true;
}

async function loadVideo(paths, startIndex) {
  ++sourceLoadRequest;
  await releaseCurrentComic();
  infoName.textContent = '—';
  infoPages.textContent = '—';
  infoCurrent.textContent = '—';
  updateSaveLibraryBtn();
  renderBookmarks();
  videoFiles = paths;
  showVideoView();
  renderVideoPlaylist();
  playVideoAt(startIndex || 0);
}

function playVideoAt(idx) {
  videoIndex = idx;
  const raw = videoFiles[idx];
  videoPlayer.src = encodeURI('file:///' + raw.replace(/\\/g, '/').replace(/^\/+/, ''));
  videoPlayer.play().catch(() => {});
  updatePlaylistActive();
  updateVideoPrevNext();
}

function renderVideoPlaylist() {
  if (videoFiles.length <= 1) {
    videoPlaylist.style.display = 'none';
    return;
  }
  videoPlaylist.style.display = 'flex';
  videoPlaylist.style.flexDirection = 'column';
  clearElement(videoPlaylist);
  const header = document.createElement('div');
  header.id = 'video-playlist-header';
  header.textContent = `Playlist (${videoFiles.length})`;
  const listEl = document.createElement('div');
  listEl.id = 'video-playlist-list';
  videoPlaylist.append(header, listEl);
  videoFiles.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'video-playlist-item' + (i === videoIndex ? ' active' : '');
    item.title = f.split(/[\\/]/).pop();
    item.textContent = `${i + 1}. ${item.title}`;
    item.addEventListener('click', () => playVideoAt(i));
    listEl.appendChild(item);
  });
}

function updatePlaylistActive() {
  document.querySelectorAll('.video-playlist-item').forEach((el, i) => {
    el.classList.toggle('active', i === videoIndex);
  });
  const activeEl = document.querySelector('.video-playlist-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function updateVideoPrevNext() {
  videoPrevBtn.disabled = videoIndex <= 0;
  videoNextBtn.disabled = videoIndex >= videoFiles.length - 1;
}

function updateVideoSeekUI() {
  const dur = videoPlayer.duration || 0;
  const cur = videoPlayer.currentTime || 0;
  const pct = dur > 0 ? (cur / dur) * 100 : 0;
  videoSeek.max = dur;
  videoSeek.value = cur;
  videoSeek.style.background = `linear-gradient(to right, var(--accent) ${pct}%, rgba(255,255,255,0.2) ${pct}%)`;
  videoTimeEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
}

function updateVideoVolumeUI() {
  const muted = videoPlayer.muted || videoPlayer.volume === 0;
  videoMuteBtn.innerHTML = muted ? MUTE_ICON : VOL_ICON;
  const pct = muted ? 0 : videoPlayer.volume * 100;
  videoVolume.value = videoPlayer.volume;
  videoVolume.style.background = `linear-gradient(to right, rgba(255,255,255,0.8) ${pct}%, rgba(255,255,255,0.2) ${pct}%)`;
}

function showVideoControls() {
  videoMainEl.classList.add('controls-visible');
  clearTimeout(_videoHideTimer);
  if (!videoPlayer.paused) {
    _videoHideTimer = setTimeout(() => {
      videoMainEl.classList.remove('controls-visible');
    }, 3000);
  }
}

// Controls auto-show on mouse move
videoMainEl.addEventListener('mousemove', showVideoControls);
videoMainEl.addEventListener('mouseleave', () => {
  clearTimeout(_videoHideTimer);
  if (!videoPlayer.paused) videoMainEl.classList.remove('controls-visible');
});
// Keep controls visible when hovering over the controls bar itself
document.getElementById('video-controls').addEventListener('mouseenter', () => {
  clearTimeout(_videoHideTimer);
  videoMainEl.classList.add('controls-visible');
});

// Play/Pause state
videoPlayer.addEventListener('play', () => {
  videoPlayBtn.innerHTML = PAUSE_ICON;
  _videoHideTimer = setTimeout(() => videoMainEl.classList.remove('controls-visible'), 3000);
});
videoPlayer.addEventListener('pause', () => {
  videoPlayBtn.innerHTML = PLAY_ICON;
  clearTimeout(_videoHideTimer);
  videoMainEl.classList.add('controls-visible');
});

// Seek & time update
videoPlayer.addEventListener('timeupdate', updateVideoSeekUI);
videoPlayer.addEventListener('loadedmetadata', () => {
  videoSeek.max = videoPlayer.duration;
  updateVideoSeekUI();
  updateVideoVolumeUI();
});

// Auto-advance playlist
videoPlayer.addEventListener('ended', () => {
  if (videoIndex < videoFiles.length - 1) {
    playVideoAt(videoIndex + 1);
  }
});

// Controls event listeners
videoPlayBtn.addEventListener('click', () => {
  videoPlayer.paused ? videoPlayer.play() : videoPlayer.pause();
});

videoSeek.addEventListener('input', () => {
  videoPlayer.currentTime = parseFloat(videoSeek.value);
  updateVideoSeekUI();
});

videoVolume.addEventListener('input', () => {
  videoPlayer.volume = parseFloat(videoVolume.value);
  videoPlayer.muted = videoPlayer.volume === 0;
  updateVideoVolumeUI();
});

videoMuteBtn.addEventListener('click', () => {
  videoPlayer.muted = !videoPlayer.muted;
  updateVideoVolumeUI();
});

videoPrevBtn.addEventListener('click', () => {
  if (videoIndex > 0) playVideoAt(videoIndex - 1);
});

videoNextBtn.addEventListener('click', () => {
  if (videoIndex < videoFiles.length - 1) playVideoAt(videoIndex + 1);
});

videoSpeed.addEventListener('change', () => {
  videoPlayer.playbackRate = parseFloat(videoSpeed.value);
});

videoFSBtn.addEventListener('click', () => {
  videoPlayer.requestFullscreen && videoPlayer.requestFullscreen();
});

// Click on video to play/pause
videoPlayer.addEventListener('click', () => {
  videoPlayer.paused ? videoPlayer.play() : videoPlayer.pause();
  showVideoControls();
});

// Open video buttons
document.getElementById('btn-open-video-file').addEventListener('click', async () => {
  const filePath = await ipcRenderer.invoke('open-video-file');
  if (!filePath) return;
  await loadVideo([filePath], 0);
});

document.getElementById('btn-open-video-folder').addEventListener('click', async () => {
  const files = await ipcRenderer.invoke('open-video-folder');
  if (!files || !files.length) { alert('No video files found in this folder.'); return; }
  await loadVideo(files, 0);
});
