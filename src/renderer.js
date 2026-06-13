const { ipcRenderer } = require('electron');
const path = require('path');

// ── State ──────────────────────────────────────────────
let currentImages = [];
let currentKey    = '';
let imgWidth      = 70;
let pageGap       = 4;
let pageObserver  = null;
let readMode      = 'scroll'; // 'scroll' | 'ltr' | 'rtl'
let currentPage   = 0;        // dùng cho chế độ paged

// ── DOM refs ───────────────────────────────────────────
const reader          = document.getElementById('reader');
const pagesContainer  = document.getElementById('pages-container');
const emptyState      = document.getElementById('empty-state');
const loadingEl       = document.getElementById('loading');
const pageIndicator   = document.getElementById('page-indicator');
const pageIndicatorTx = document.getElementById('page-indicator-text');
const scrollTopBtn    = document.getElementById('scroll-top');
const widthSlider     = document.getElementById('width-slider');
const widthValue      = document.getElementById('width-value');
const gapSlider       = document.getElementById('gap-slider');
const gapValue        = document.getElementById('gap-value');
const infoName        = document.getElementById('info-name');
const infoPages       = document.getElementById('info-pages');
const infoCurrent     = document.getElementById('info-current');
const historyList     = document.getElementById('history-list');
const pagedNav        = document.getElementById('paged-nav');
const pagedPageInfo   = document.getElementById('paged-page-info');
const navPrev         = document.getElementById('nav-prev');
const navNext         = document.getElementById('nav-next');

// ── Init ───────────────────────────────────────────────
loadAndRenderHistory();

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

// ── Load folder ────────────────────────────────────────
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
async function renderPages(imageSrcs, name) {
  currentImages = imageSrcs;
  pagesContainer.innerHTML = '';

  if (pageObserver) pageObserver.disconnect();

  imageSrcs.forEach((src, idx) => {
    const img = document.createElement('img');
    img.className = 'page-img';
    img.dataset.index = idx;
    img.loading = 'lazy';
    img.style.width = imgWidth + '%';
    img.style.marginBottom = pageGap + 'px';
    img.src = src;
    pagesContainer.appendChild(img);
  });

  infoName.textContent = name;
  infoPages.textContent = imageSrcs.length;
  infoName.title = name;

  await saveToHistory(name);
  await loadAndRenderHistory();

  emptyState.style.display = 'none';
  reader.style.display = 'block';
  hideLoading();

  currentPage = 0;
  applyReadMode();

  // Khôi phục tiến độ (chỉ cho chế độ cuộn)
  if (readMode === 'scroll') {
    const saved = await ipcRenderer.invoke('load-progress', currentKey);
    if (saved && saved.scrollTop) {
      setTimeout(() => { reader.scrollTop = saved.scrollTop; }, 80);
    }
  }
}

// ── Page observer ──────────────────────────────────────
function setupPageObserver() {
  pageObserver = new IntersectionObserver((entries) => {
    let topMost = null;
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const idx = parseInt(entry.target.dataset.index);
        if (topMost === null || idx < topMost) topMost = idx;
      }
    });
    if (topMost !== null) {
      const cur = topMost + 1;
      pageIndicatorTx.textContent = cur + ' / ' + currentImages.length;
      infoCurrent.textContent = cur;
    }
  }, { root: reader, threshold: 0.1 });

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
        value: { scrollTop: reader.scrollTop }
      });
    }
  }, 800);
  scrollTopBtn.style.display = reader.scrollTop > 300 ? 'flex' : 'none';
});

// ── Scroll to top ──────────────────────────────────────
scrollTopBtn.addEventListener('click', () => {
  reader.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Width slider ───────────────────────────────────────
widthSlider.addEventListener('input', () => {
  imgWidth = parseInt(widthSlider.value);
  widthValue.textContent = imgWidth + '%';
  document.querySelectorAll('.page-img').forEach(img => {
    img.style.width = imgWidth + '%';
  });
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

// Áp dụng chế độ đọc lên ảnh đang hiển thị
function applyReadMode() {
  const container = pagesContainer;

  if (readMode === 'scroll') {
    reader.classList.remove('paged-mode');
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.justifyContent = '';
    reader.style.overflowY = 'scroll';
    reader.style.overflowX = 'hidden';
    document.querySelectorAll('.page-img').forEach(img => {
      img.style.display = 'block';
      img.style.width = imgWidth + '%';
      img.style.maxHeight = '';
      img.style.objectFit = '';
      img.style.marginBottom = pageGap + 'px';
    });
    pagedNav.style.display = 'none';
    pageIndicator.style.display = 'block';
    scrollTopBtn.style.display = reader.scrollTop > 300 ? 'flex' : 'none';
    setupPageObserver();

  } else {
    reader.classList.add('paged-mode');
    if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
    reader.style.overflowY = 'hidden';
    reader.style.overflowX = 'hidden';
    pageIndicator.style.display = 'none';
    scrollTopBtn.style.display = 'none';
    pagedNav.style.display = 'flex';
    showPagedPage(currentPage);
  }
}

function showPagedPage(idx) {
  // Clamp index
  if (readMode === 'rtl') {
    idx = Math.max(0, Math.min(currentImages.length - 1, idx));
  } else {
    idx = Math.max(0, Math.min(currentImages.length - 1, idx));
  }
  currentPage = idx;

  document.querySelectorAll('.page-img').forEach((img, i) => {
    img.style.display = i === currentPage ? 'block' : 'none';
    img.style.width = imgWidth + '%';
    img.style.marginBottom = '0';
    img.style.maxHeight = (reader.clientHeight - 40) + 'px';
    img.style.objectFit = 'contain';
  });

  // Update info
  const display = currentPage + 1;
  pagedPageInfo.textContent = display + ' / ' + currentImages.length;
  pageIndicatorTx.textContent = display + ' / ' + currentImages.length;
  infoCurrent.textContent = display;

  // Cập nhật trạng thái nút điều hướng
  navPrev.disabled = currentPage === 0;
  navNext.disabled = currentPage === currentImages.length - 1;
}

function pagedGoNext() {
  if (currentPage < currentImages.length - 1) showPagedPage(currentPage + 1);
}
function pagedGoPrev() {
  if (currentPage > 0) showPagedPage(currentPage - 1);
}

navNext.addEventListener('click', () => {
  if (readMode === 'rtl') pagedGoPrev(); else pagedGoNext();
});
navPrev.addEventListener('click', () => {
  if (readMode === 'rtl') pagedGoNext(); else pagedGoPrev();
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
  } else {
    // Paged mode — ArrowLeft/Right + PageUp/Down
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      readMode === 'rtl' ? pagedGoPrev() : pagedGoNext(); e.preventDefault();
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      readMode === 'rtl' ? pagedGoNext() : pagedGoPrev(); e.preventDefault();
    }
    if (e.key === 'Home') { showPagedPage(readMode === 'rtl' ? currentImages.length - 1 : 0); e.preventDefault(); }
    if (e.key === 'End')  { showPagedPage(readMode === 'rtl' ? 0 : currentImages.length - 1); e.preventDefault(); }
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

// ── History ────────────────────────────────────────────
async function saveToHistory(name) {
  let thumbnail = null;
  try {
    if (currentKey.startsWith('folder:')) {
      thumbnail = await ipcRenderer.invoke('get-folder-thumbnail', currentKey.replace('folder:', ''));
    } else if (currentKey.startsWith('cbz:')) {
      thumbnail = await ipcRenderer.invoke('get-cbz-thumbnail', currentKey.replace('cbz:', ''));
    }
  } catch {}

  const type = currentKey.startsWith('folder:') ? 'folder' : 'cbz';
  const srcPath = currentKey.replace(/^(folder:|cbz:)/, '');
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
    meta.textContent = entry.type === 'folder' ? 'Thư mục' : 'CBZ';

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
      else loadCBZ(entry.path);
    });

    historyList.appendChild(card);
  });
}

// ── Helpers ────────────────────────────────────────────
function showLoading() {
  emptyState.style.display = 'none';
  reader.style.display = 'none';
  loadingEl.style.display = 'flex';
}
function hideLoading() {
  loadingEl.style.display = 'none';
}