const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // cần thiết để load ảnh từ các trang web truyện
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hidden'
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  Menu.setApplicationMenu(null);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── File dialogs ───────────────────────────────────────
ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Mở truyện',
    filters: [{ name: 'Comic Files', extensions: ['cbz', 'zip'] }, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Mở thư mục ảnh',
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ── Read images ────────────────────────────────────────
ipcMain.handle('read-folder', async (event, folderPath) => {
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  const files = fs.readdirSync(folderPath)
    .filter(f => exts.includes(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(f => path.join(folderPath, f));
  return files;
});

ipcMain.handle('read-cbz', async (event, filePath) => {
  const JSZip = require('jszip');
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  const entries = Object.keys(zip.files)
    .filter(name => exts.includes(path.extname(name).toLowerCase()) && !zip.files[name].dir)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const images = [];
  for (const name of entries) {
    const ext = path.extname(name).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext;
    const b64 = await zip.files[name].async('base64');
    images.push(`data:image/${mime};base64,${b64}`);
  }
  return images;
});

// ── Thumbnails ─────────────────────────────────────────
ipcMain.handle('get-folder-thumbnail', async (event, folderPath) => {
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  try {
    const files = fs.readdirSync(folderPath)
      .filter(f => exts.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!files.length) return null;
    const data = fs.readFileSync(path.join(folderPath, files[0]));
    const ext = path.extname(files[0]).toLowerCase().replace('.', '');
    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'jpeg' : ext;
    return `data:image/${mime};base64,${data.toString('base64')}`;
  } catch { return null; }
});

ipcMain.handle('get-cbz-thumbnail', async (event, filePath) => {
  const JSZip = require('jszip');
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
  try {
    const data = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(data);
    const entries = Object.keys(zip.files)
      .filter(name => exts.includes(path.extname(name).toLowerCase()) && !zip.files[name].dir)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!entries.length) return null;
    const name = entries[0];
    const ext = path.extname(name).toLowerCase().replace('.', '');
    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'jpeg' : ext;
    const b64 = await zip.files[name].async('base64');
    return `data:image/${mime};base64,${b64}`;
  } catch { return null; }
});

// ── Window controls ────────────────────────────────────
ipcMain.on('win-minimize', () => mainWindow.minimize());
ipcMain.on('win-maximize', () => { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.on('win-close', () => mainWindow.close());

// ── Reading progress ───────────────────────────────────
const storePath = path.join(app.getPath('userData'), 'progress.json');

ipcMain.handle('save-progress', (event, data) => {
  let store = {};
  try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')); } catch {}
  store[data.key] = data.value;
  fs.writeFileSync(storePath, JSON.stringify(store));
});

ipcMain.handle('load-progress', (event, key) => {
  try {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return store[key] || null;
  } catch { return null; }
});

// ── History ────────────────────────────────────────────
const historyPath = path.join(app.getPath('userData'), 'history.json');

function readHistory() {
  try { return JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch { return []; }
}
function writeHistory(list) {
  fs.writeFileSync(historyPath, JSON.stringify(list));
}

ipcMain.handle('history-add', (event, entry) => {
  let list = readHistory();
  list = list.filter(e => e.key !== entry.key);
  list.unshift(entry);
  if (list.length > 10) list = list.slice(0, 10);
  writeHistory(list);
  return list;
});

ipcMain.handle('history-get', () => readHistory());

ipcMain.handle('history-remove', (event, key) => {
  let list = readHistory();
  list = list.filter(e => e.key !== key);
  writeHistory(list);
  return list;
});

// Xóa toàn bộ lịch sử
ipcMain.handle('history-clear', () => {
  writeHistory([]);
  return [];
});

// ── Web chapter scraper ────────────────────────────────
// Dùng BrowserWindow ẩn để load trang web như browser thật,
// rồi inject script phát hiện ảnh chapter.
ipcMain.handle('fetch-web-chapter', async (event, url) => {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
        images: true,
      }
    });

    // Timeout 25 giây
    const timeout = setTimeout(() => {
      try { win.destroy(); } catch {}
      reject(new Error('Timeout: trang web mất quá nhiều thời gian tải'));
    }, 25000);

    win.webContents.on('did-finish-load', async () => {
      // Chờ thêm 1.5s để JS của trang chạy xong (lazy load, etc.)
      setTimeout(async () => {
        try {
          const result = await win.webContents.executeJavaScript(`
            (function() {
              const pageUrl = location.href;
              const hostname = location.hostname;

              // ── Parser cho từng trang phổ biến ──────────────────
              // NetTruyen / TruyenQQ / các site dùng cấu trúc tương tự
              function parseNetTruyen() {
                const imgs = document.querySelectorAll(
                  '.reading-detail img, .page-chapter img, #chapter-content img, .chapter-content img, .box_doc img'
                );
                return [...imgs].map(img => img.getAttribute('data-src') || img.getAttribute('data-original') || img.src)
                  .filter(s => s && !s.includes('data:') && s.length > 10);
              }

              // Manganato / Readmanganato
              function parseManganato() {
                const imgs = document.querySelectorAll('.container-chapter-reader img, .panel-read-story img');
                return [...imgs].map(img => img.src).filter(s => s && !s.includes('data:') && s.length > 10);
              }

              // MangaDex (dùng API riêng nên fallback sang generic)
              // TruyenFull / MangaVN
              function parseTruyenFull() {
                const imgs = document.querySelectorAll('#chapter-content img, .chapter-content img');
                return [...imgs].map(img => img.getAttribute('data-src') || img.src)
                  .filter(s => s && !s.includes('data:') && s.length > 10);
              }

              // Nhattruyenme / NhatTruyen
              function parseNhatTruyen() {
                const imgs = document.querySelectorAll('.reading-detail .page-chapter img');
                return [...imgs].map(img => img.getAttribute('data-original') || img.getAttribute('data-src') || img.src)
                  .filter(s => s && !s.includes('data:') && s.length > 10);
              }

              // ── Generic fallback: tìm tất cả ảnh lớn trên trang ──
              function parseGeneric() {
                const allImgs = [...document.querySelectorAll('img')];
                // Lọc ảnh lớn (có thể là trang truyện), bỏ qua icon/avatar/logo
                const candidates = allImgs.filter(img => {
                  const src = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.src || '';
                  if (!src || src.startsWith('data:') || src.length < 10) return false;
                  // Bỏ ảnh nhỏ theo kích thước thực tế
                  const w = img.naturalWidth || img.width || img.clientWidth || 0;
                  const h = img.naturalHeight || img.height || img.clientHeight || 0;
                  if (w > 0 && w < 100) return false;
                  if (h > 0 && h < 150) return false;
                  // Bỏ url chứa từ khoá icon/logo/avatar/banner/ads
                  const low = src.toLowerCase();
                  if (/logo|icon|avatar|banner|favicon|sprite|ads|advertisement|thumb(?!nail)|btn|button/.test(low)) return false;
                  return true;
                });

                // Lấy src ưu tiên data-src (lazy load)
                const srcs = candidates.map(img =>
                  img.getAttribute('data-src') ||
                  img.getAttribute('data-original') ||
                  img.getAttribute('data-lazy-src') ||
                  img.getAttribute('data-img') ||
                  img.src
                ).filter(Boolean);

                // Deduplicate
                return [...new Set(srcs)];
              }

              // ── Chọn parser theo hostname ──
              let images = [];
              if (/nettruyen|truyenqq|truyenfull|mangavn|doctruyen|blogtruyen/.test(hostname)) {
                images = parseNetTruyen();
              } else if (/manganato|readmanganato|chapmanganato/.test(hostname)) {
                images = parseManganato();
              } else if (/nhattruyen|nhattruyenme/.test(hostname)) {
                images = parseNhatTruyen();
              } else if (/truyenfull/.test(hostname)) {
                images = parseTruyenFull();
              }

              // Nếu parser cụ thể không ra ảnh → dùng generic
              if (images.length < 2) {
                images = parseGeneric();
              }

              // Lấy tiêu đề chapter
              const titleEl = document.querySelector(
                'h1.chapter-title, h1.title, .chapter-info h1, .chapter-info h2, ' +
                'title, h1, h2.chapter-name, .chapter-name'
              );
              const title = titleEl ? (titleEl.innerText || titleEl.textContent).trim().slice(0, 120) : document.title.slice(0, 120);

              return { images, title, url: pageUrl, hostname };
            })()
          `);

          clearTimeout(timeout);
          win.destroy();

          if (!result.images || result.images.length === 0) {
            reject(new Error('Không tìm thấy ảnh truyện trên trang này.\nThử kiểm tra lại URL hoặc trang web có thể không được hỗ trợ.'));
            return;
          }

          resolve(result);
        } catch (err) {
          clearTimeout(timeout);
          try { win.destroy(); } catch {}
          reject(err);
        }
      }, 1500);
    });

    win.webContents.on('did-fail-load', (event, code, desc) => {
      clearTimeout(timeout);
      try { win.destroy(); } catch {}
      reject(new Error(`Không thể tải trang: ${desc} (mã ${code})`));
    });

    // Set User-Agent như Chrome thật để tránh bị chặn
    win.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    win.loadURL(url).catch(err => {
      clearTimeout(timeout);
      try { win.destroy(); } catch {}
      reject(err);
    });
  });
});