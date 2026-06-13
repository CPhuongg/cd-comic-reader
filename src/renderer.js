const { ipcRenderer } = require('electron');
const path = require('path');

// ── State ──────────────────────────────────────────────
let currentImages = [];
let currentKey    = '';
let imgWidth      = 70;
let pageGap       = 4;
let pageObserver  = null;
let scrollCurrentPage = 0; // Trang đang hiển thị ở chế độ cuộn (0-based)
let readMode      = 'scroll'; // 'scroll' | 'scroll-ltr' | 'scroll-rtl' | 'ltr' | 'rtl'
let currentPage   = 0;        // dùng cho chế độ paged
let isDoublePage = false;

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

// ── Library DOM refs ───────────────────────────────────
const btnSaveLibrary   = document.getElementById('btn-save-library');
const libraryViewEl    = document.getElementById('library-view');
const libraryViewGrid  = document.getElementById('library-view-grid');

// ── Library (localStorage) ─────────────────────────────
function loadLibrary() {
  try { return JSON.parse(localStorage.getItem('cd-library') || '[]'); } catch { return []; }
}
function saveLibraryData(lib) {
  localStorage.setItem('cd-library', JSON.stringify(lib));
}
function addLibraryEntry(entry) {
  const lib = loadLibrary();
  if (lib.some(e => e.id === entry.id)) return false;
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
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Đã lưu vào thư viện`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Lưu vào thư viện`;
}

// ── Library view (main panel) ─────────────────────────
function hideLibraryView() {
  libraryViewEl.style.display = 'none';
  if (currentKey) {
    reader.style.display = 'block';
  } else {
    emptyState.style.display = 'flex';
  }
}

async function showLibraryView() {
  emptyState.style.display = 'none';
  reader.style.display = 'none';
  loadingEl.style.display = 'none';
  libraryViewEl.style.display = 'flex';

  const lib = loadLibrary();
  libraryViewGrid.innerHTML = '';
  const emptyEl = document.getElementById('library-view-empty');

  if (!lib.length) {
    emptyEl.style.display = 'flex';
    libraryViewGrid.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  libraryViewGrid.style.display = 'grid';

  // Dựng cards với placeholder trước, load ảnh bìa song song sau
  const thumbEls = lib.map(entry => {
    const card = document.createElement('div');
    card.className = 'lib-view-card';
    if (entry.id === currentKey) card.classList.add('active');

    // Nút xóa (hiện khi hover)
    const delBtn = document.createElement('button');
    delBtn.className = 'lib-view-delete';
    delBtn.title = 'Xóa khỏi thư viện';
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

    const typeLabel = entry.type === 'folder' ? 'Thư mục' : entry.type === 'web' ? 'Web' : 'CBZ';
    thumb.innerHTML = `<div class="lib-view-thumb-placeholder">${placeholderIcon}<span>${typeLabel}</span></div>`;

    const info = document.createElement('div');
    info.className = 'lib-view-info';
    info.innerHTML = `<div class="lib-view-name" title="${entry.name}">${entry.name}</div><div class="lib-view-type">${typeLabel}</div>`;

    card.appendChild(thumb);
    card.appendChild(info);

    card.addEventListener('click', () => {
      hideLibraryView();
      if (entry.type === 'folder') loadFolder(entry.path);
      else if (entry.type === 'web') { urlInput.value = entry.path; openUrlModal(); }
      else loadCBZ(entry.path);
    });

    libraryViewGrid.appendChild(card);
    return { entry, thumb };
  });

  // Load ảnh bìa song song (không chặn render)
  thumbEls.forEach(async ({ entry, thumb }) => {
    if (entry.type === 'web') return;
    try {
      const ipcCall = entry.type === 'folder' ? 'get-folder-thumbnail' : 'get-cbz-thumbnail';
      const src = await ipcRenderer.invoke(ipcCall, entry.path);
      if (src && libraryViewEl.style.display !== 'none') {
        thumb.innerHTML = '';
        const img = document.createElement('img');
        img.src = src;
        thumb.appendChild(img);
      }
    } catch {}
  });
}

document.getElementById('btn-show-library').addEventListener('click', showLibraryView);
document.getElementById('btn-close-library-view').addEventListener('click', hideLibraryView);

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
  if (type === 'loading') {
    urlStatus.innerHTML = `<span class="status-spinner"></span><span>${msg}</span>`;
  } else {
    const icon = type === 'error' ? '✕' : '✓';
    urlStatus.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  }
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
  } catch {}
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') urlLoadBtn.click();
  if (e.key === 'Escape') closeUrlModal();
});

urlLoadBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) { setUrlStatus('error', 'Vui lòng nhập URL chapter'); return; }
  if (!/^https?:\/\//i.test(url)) { setUrlStatus('error', 'URL phải bắt đầu bằng http:// hoặc https://'); return; }

  urlLoadBtn.disabled = true;
  setUrlStatus('loading', 'Đang tải trang, vui lòng chờ...');

  try {
    const result = await ipcRenderer.invoke('fetch-web-chapter', url);
    if (!result || !result.images || result.images.length === 0) {
      setUrlStatus('error', 'Không tìm thấy ảnh truyện. Thử trang khác hoặc kiểm tra URL.');
      urlLoadBtn.disabled = false;
      return;
    }
    setUrlStatus('success', `Tìm thấy ${result.images.length} trang — đang mở...`);
    setTimeout(async () => {
      closeUrlModal();
      await loadFromWeb(result);
    }, 600);
  } catch (err) {
    setUrlStatus('error', err.message || 'Lỗi không xác định');
    urlLoadBtn.disabled = false;
  }
});

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
  showLoading();
  try {
    const images = await ipcRenderer.invoke('read-cbz', filePath);
    const name = filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    currentKey = 'cbz:' + filePath;
    await renderPages(images, name);
  } catch (e) {
    alert('Lỗi đọc file: ' + e.message);
    hideLoading();
  }
}

// ── Load from Web ──────────────────────────────────────
async function loadFromWeb(result) {
  showLoading();
  try {
    const { images, title, url } = result;
    // Dùng URL làm key để lưu lịch sử / tiến độ
    currentKey = 'web:' + url;
    const name = title || new URL(url).hostname;
    await renderPages(images, name);
  } catch (e) {
    alert('Lỗi mở chapter web: ' + e.message);
    hideLoading();
  }
}
async function loadFolder(folderPath) {
  showLoading();
  try {
    const files = await ipcRenderer.invoke('read-folder', folderPath);
    if (!files.length) { alert('Không tìm thấy ảnh trong thư mục này.'); hideLoading(); return; }
    const imageSrcs = files.map(f => 'file://' + f.replace(/\\/g, '/'));
    const name = folderPath.split(/[\\/]/).pop();
    currentKey = 'folder:' + folderPath;
    await renderPages(imageSrcs, name);
  } catch (e) {
    alert('Lỗi đọc thư mục: ' + e.message);
    hideLoading();
  }
}

// ── Render pages ───────────────────────────────────────
function buildScrollPages() {
  pagesContainer.innerHTML = '';
  currentImages.forEach((src, idx) => {
    const img = document.createElement('img');
    img.className = 'page-img';
    img.dataset.index = idx;
    img.loading = 'lazy';
    img.style.width = imgWidth + '%';
    img.style.marginBottom = pageGap + 'px';
    img.src = src;
    pagesContainer.appendChild(img);
  });
}

async function renderPages(imageSrcs, name) {
  currentImages = imageSrcs;

  if (pageObserver) pageObserver.disconnect();

  buildScrollPages();

  infoName.textContent = name;
  infoPages.textContent = imageSrcs.length;
  infoName.title = name;
  scrollPageTotal.textContent = ' / ' + imageSrcs.length;

  await saveToHistory(name);
  await loadAndRenderHistory();
  updateSaveLibraryBtn();

  emptyState.style.display = 'none';
  reader.style.display = 'block';
  hideLoading();

  currentPage = 0;
  applyReadMode();

  // Khôi phục tiến độ
  const saved = await ipcRenderer.invoke('load-progress', currentKey);
  if (isScrollMode()) {
    if (saved) {
      setTimeout(() => {
        if (saved.scrollTop) reader.scrollTop = saved.scrollTop;
        if (saved.scrollLeft) reader.scrollLeft = saved.scrollLeft;
      }, 80);
    }
  } else {
    if (saved && typeof saved.page === 'number' && saved.page < currentImages.length) {
      currentPage = saved.page;
      renderPaged();
    }
  }
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
      const cur = topMost + 1;
      pageIndicatorTx.textContent = cur + ' / ' + currentImages.length;
      infoCurrent.textContent = cur;
      if (isScrollMode()) updateScrollNavUI();
    }
  }, { root: reader, threshold: 0.3 });

  document.querySelectorAll('.page-img').forEach(img => pageObserver.observe(img));
}

// ── Save progress on scroll ────────────────────────────
let saveTimer = null;
reader.addEventListener('scroll', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (currentKey) {
      ipcRenderer.invoke('save-progress', {
        key: currentKey,
        value: { scrollTop: reader.scrollTop, scrollLeft: reader.scrollLeft }
      });
    }
  }, 800);
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
    document.querySelectorAll('.page-img').forEach(img => {
      img.style.width = imgWidth + '%';
    });
  }
});

// ── Gap slider ─────────────────────────────────────────
gapSlider.addEventListener('input', () => {
  pageGap = parseInt(gapSlider.value);
  gapValue.textContent = pageGap + 'px';
  document.querySelectorAll('.page-img').forEach(img => {
    img.style.marginBottom = pageGap + 'px';
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

// Helper: kiểm tra chế độ cuộn (dọc hoặc ngang)
function isScrollMode() {
  return readMode === 'scroll' || readMode === 'scroll-ltr' || readMode === 'scroll-rtl';
}

// Áp dụng chế độ đọc lên ảnh đang hiển thị
function applyReadMode() {
  const container = pagesContainer;

  if (isScrollMode()) {
    // Nếu đang chuyển từ chế độ paged sang, cần dựng lại danh sách ảnh cuộn
    const comingFromPaged = !!container.querySelector('.paged-layout');
    if (comingFromPaged || !container.querySelector('.page-img')) {
      buildScrollPages();
    }

    reader.classList.remove('paged-mode');

    if (readMode === 'scroll') {
      // Cuộn dọc
      container.style.flexDirection = 'column';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'flex-start';
      container.style.padding = '20px 0 60px';
      container.style.minWidth = '';
      container.style.height = '';
      reader.style.overflowY = 'scroll';
      reader.style.overflowX = 'hidden';
      document.querySelectorAll('.page-img').forEach(img => {
        img.style.display = 'block';
        img.style.width = imgWidth + '%';
        img.style.height = 'auto';
        img.style.maxHeight = '';
        img.style.objectFit = '';
        img.style.marginBottom = pageGap + 'px';
        img.style.marginRight = '';
        img.style.flexShrink = '';
      });
    } else {
      // Cuộn ngang (scroll-ltr hoặc scroll-rtl)
      container.style.flexDirection = readMode === 'scroll-rtl' ? 'row-reverse' : 'row';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'flex-start';
      container.style.padding = '8px 40px';
      container.style.minWidth = 'max-content';
      container.style.height = '100%';
      reader.style.overflowY = 'hidden';
      reader.style.overflowX = 'scroll';
      document.querySelectorAll('.page-img').forEach(img => {
        img.style.display = 'block';
        img.style.width = 'auto';
        img.style.height = (reader.clientHeight - 16) + 'px';
        img.style.maxHeight = '100%';
        img.style.objectFit = 'contain';
        img.style.marginBottom = '';
        img.style.marginRight = pageGap + 'px';
        img.style.flexShrink = '0';
      });
    }

    sidebarPagedNav.style.display = 'none';
    sidebarScrollNav.style.display = 'block';
    pageIndicator.style.display = 'block';
    scrollTopBtn.style.display = readMode === 'scroll' && reader.scrollTop > 300 ? 'flex' : 'none';
    updateScrollNavUI();
    setupPageObserver(readMode !== 'scroll');

    // scroll-rtl: trang 0 nằm ở phải nhất (row-reverse), cần scroll đến cuối
    if (readMode === 'scroll-rtl') {
      requestAnimationFrame(() => {
        reader.scrollLeft = reader.scrollWidth - reader.clientWidth;
      });
    }

    // Cuộn tới trang đang đọc (giữ vị trí khi đổi từ chế độ paged)
    if (comingFromPaged) {
      const target = pagesContainer.querySelector(`.page-img[data-index="${currentPage}"]`);
      if (target) {
        requestAnimationFrame(() => {
          if (readMode === 'scroll') {
            target.scrollIntoView({ block: 'start' });
          } else {
            target.scrollIntoView({ inline: 'start' });
          }
        });
      }
      scrollCurrentPage = currentPage;
    }

    if (currentKey) {
      ipcRenderer.invoke('save-progress', { key: currentKey, value: { scrollTop: reader.scrollTop, page: scrollCurrentPage } });
    }

  } else {
    // Chế độ trang (ltr / rtl)
    const comingFromScroll = !!container.querySelector('.page-img');
    if (comingFromScroll) {
      currentPage = scrollCurrentPage;
    }

    reader.classList.add('paged-mode');
    if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
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
  } catch {}

  const type = currentKey.startsWith('folder:') ? 'folder'
             : currentKey.startsWith('cbz:')    ? 'cbz'
             : 'web';
  const srcPath = currentKey.replace(/^(folder:|cbz:|web:)/, '');
  await ipcRenderer.invoke('history-add', { key: currentKey, name, type, path: srcPath, thumbnail });
}

async function loadAndRenderHistory() {
  const list = await ipcRenderer.invoke('history-get');
  historyList.innerHTML = '';

  if (!list || list.length === 0) {
    historyList.innerHTML = '<div id="history-empty">Chưa có lịch sử đọc</div>';
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
    meta.textContent = entry.type === 'folder' ? 'Thư mục' : entry.type === 'web' ? '🌐 Web' : 'CBZ';

    info.appendChild(nameEl);
    info.appendChild(meta);
    card.appendChild(info);

    // Nút xóa
    const delBtn = document.createElement('button');
    delBtn.className = 'history-delete-btn';
    delBtn.title = 'Xóa khỏi lịch sử';
    delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;

    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation(); // không trigger click mở truyện

      // Animation xóa
      card.style.transition = 'opacity 0.18s, transform 0.18s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(-8px)';
      setTimeout(async () => {
        await ipcRenderer.invoke('history-remove', entry.key);
        await loadAndRenderHistory();
      }, 180);
    });

    card.appendChild(delBtn);

    // Click vào card → mở truyện
    card.addEventListener('click', () => {
      if (entry.type === 'folder') loadFolder(entry.path);
      else if (entry.type === 'web') {
        // Mở lại modal với URL đã điền sẵn
        urlInput.value = entry.path;
        openUrlModal();
      }
      else loadCBZ(entry.path);
    });

    historyList.appendChild(card);
  });
}

// ── Helpers ────────────────────────────────────────────
function showLoading() {
  emptyState.style.display = 'none';
  reader.style.display = 'none';
  libraryViewEl.style.display = 'none';
  loadingEl.style.display = 'flex';
}

function hideLoading() {
  loadingEl.style.display = 'none';
}

function renderPaged() {
  pagesContainer.innerHTML = '';
  if (currentImages.length === 0) return;

  // Clamp currentPage trong giới hạn hợp lệ
  currentPage = Math.max(0, Math.min(currentImages.length - 1, currentPage));

  const container = document.createElement('div');
  container.className = 'paged-layout';

  if (readMode === 'rtl') container.classList.add('rtl');
  if (isDoublePage) container.classList.add('double-page');

  // Render trang đầu tiên
  const img1 = document.createElement('img');
  img1.src = currentImages[currentPage];
  img1.style.maxHeight = (reader.clientHeight - 16) + 'px';
  container.appendChild(img1);

  // Render trang thứ hai nếu ở chế độ Double Page và chưa hết ảnh
  let lastIdx = currentPage;
  if (isDoublePage && currentPage + 1 < currentImages.length) {
    const img2 = document.createElement('img');
    img2.src = currentImages[currentPage + 1];
    img2.style.maxHeight = (reader.clientHeight - 16) + 'px';
    container.appendChild(img2);
    lastIdx = currentPage + 1;
  }

  pagesContainer.appendChild(container);

  // ── Cập nhật UI thông tin trang ──
  const fromDisp = currentPage + 1;
  const toDisp = lastIdx + 1;
  const label = (toDisp > fromDisp) ? `${fromDisp}-${toDisp}` : `${fromDisp}`;

  pageInput.value = fromDisp;
  pageInput.max = currentImages.length;
  pageTotal.textContent = ` / ${currentImages.length}`;
  pagedPageInfo.title = `Trang ${label} / ${currentImages.length}`;
  pageIndicatorTx.textContent = `${label} / ${currentImages.length}`;
  infoCurrent.textContent = label;

  // ── Trạng thái nút điều hướng ──
  const atStart = currentPage === 0;
  const atEnd = lastIdx >= currentImages.length - 1;
  if (readMode === 'rtl') {
    navPrev.disabled = atEnd;
    navNext.disabled = atStart;
  } else {
    navPrev.disabled = atStart;
    navNext.disabled = atEnd;
  }

  // Lưu tiến độ đọc (chế độ paged lưu theo số trang)
  if (currentKey) {
    ipcRenderer.invoke('save-progress', { key: currentKey, value: { page: currentPage } });
  }
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

function scrollToPageIndex(idx) {
  const target = pagesContainer.querySelector(`.page-img[data-index="${idx}"]`);
  if (!target) return;
  if (readMode === 'scroll') {
    reader.scrollTo({ top: target.offsetTop - 8, behavior: 'smooth' });
  } else {
    reader.scrollTo({ left: target.offsetLeft - 8, behavior: 'smooth' });
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
    // Cập nhật lại chiều cao ảnh khi resize
    document.querySelectorAll('.page-img').forEach(img => {
      img.style.height = (reader.clientHeight - 16) + 'px';
    });
  }
});