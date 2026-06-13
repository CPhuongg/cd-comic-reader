const { ipcRenderer } = require('electron');
const path = require('path');

// ── State ──────────────────────────────────────────────
let currentImages = [];
let currentKey    = '';
let imgWidth      = 70;
let pageGap       = 4;
let pageObserver  = null;
let scrollCurrentPage = 0; // Trang đang hiển thị ở chế độ cuộn (0-based)
let readMode      = 'scroll'; // 'scroll' | 'ltr' | 'rtl'
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
const pagedNav          = document.getElementById('paged-nav');
const pagedPageInfo     = document.getElementById('paged-page-info');
const navPrev           = document.getElementById('nav-prev');
const navNext           = document.getElementById('nav-next');
const doublePageSetting = document.getElementById('double-page-setting');
const doublePageToggle  = document.getElementById('double-page-toggle');
const pageInput         = document.getElementById('page-input');
const pageTotal         = document.getElementById('page-total');

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

  await saveToHistory(name);
  await loadAndRenderHistory();

  emptyState.style.display = 'none';
  reader.style.display = 'block';
  hideLoading();

  currentPage = 0;
  applyReadMode();

  // Khôi phục tiến độ
  const saved = await ipcRenderer.invoke('load-progress', currentKey);
  if (readMode === 'scroll') {
    if (saved && saved.scrollTop) {
      setTimeout(() => { reader.scrollTop = saved.scrollTop; }, 80);
    }
  } else {
    if (saved && typeof saved.page === 'number' && saved.page < currentImages.length) {
      currentPage = saved.page;
      renderPaged();
    }
  }
}

// ── Page observer ──────────────────────────────────────
function setupPageObserver() {
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
    // Nếu đang chuyển từ chế độ paged sang, cần dựng lại danh sách ảnh cuộn
    const comingFromPaged = !!container.querySelector('.paged-layout');
    if (comingFromPaged || !container.querySelector('.page-img')) {
      buildScrollPages();
    }

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
    doublePageSetting.style.display = 'none';
    pageIndicator.style.display = 'block';
    scrollTopBtn.style.display = reader.scrollTop > 300 ? 'flex' : 'none';
    setupPageObserver();

    // Cuộn tới trang đang đọc (giữ vị trí khi đổi từ chế độ paged)
    if (comingFromPaged) {
      const target = pagesContainer.querySelector(`.page-img[data-index="${currentPage}"]`);
      if (target) {
        requestAnimationFrame(() => {
          target.scrollIntoView({ block: 'start' });
        });
      }
      scrollCurrentPage = currentPage;
    }

    if (currentKey) {
      ipcRenderer.invoke('save-progress', { key: currentKey, value: { scrollTop: reader.scrollTop, page: scrollCurrentPage } });
    }

  } else {
    // Nếu đang chuyển từ chế độ cuộn sang, lấy trang đang hiển thị làm trang hiện tại
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
    pagedNav.style.display = 'flex';
    doublePageSetting.style.display = 'block';
    renderPaged(); // renderPaged() tự lưu progress { page: currentPage }
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
  if (readMode === 'scroll') return;
  mouseDownPos = { x: e.clientX, y: e.clientY };
});

reader.addEventListener('click', (e) => {
  if (readMode === 'scroll') return;
  // Bỏ qua nếu người dùng vừa kéo (drag) hoặc click vào nút điều hướng
  if (e.target.closest('#paged-nav') || e.target.closest('#double-page-setting')) return;
  if (mouseDownPos) {
    const dx = Math.abs(e.clientX - mouseDownPos.x);
    const dy = Math.abs(e.clientY - mouseDownPos.y);
    if (dx > 6 || dy > 6) { mouseDownPos = null; return; } // đây là kéo, không phải click
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
  if (readMode === 'scroll' || e.ctrlKey) return;
  e.preventDefault();
  if (e.deltaY > 0 || e.deltaX > 0) {
    changePage('next');
  } else if (e.deltaY < 0 || e.deltaX < 0) {
    changePage('prev');
  }
}, { passive: false });
// ── Resize: cập nhật lại layout paged khi đổi kích thước cửa sổ ──
window.addEventListener('resize', () => {
  if (readMode !== 'scroll' && currentImages.length > 0) {
    renderPaged();
  }
});