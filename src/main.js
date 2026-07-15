const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const JSZip = require('jszip');

const fsp = fs.promises;
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m4v']);
const MAX_CBZ_SESSIONS = 2;
const MAX_PROGRESS_ENTRIES = 300;
const MAX_HISTORY_ENTRIES = 10;
const MAX_THUMBNAIL_LENGTH = 300000;

let mainWindow;
let cbzSessionSequence = 0;
const cbzSessions = new Map();
const thumbnailCache = new Map();

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
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hidden'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  Menu.setApplicationMenu(null);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function requirePath(value, label = 'Path') {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    throw new Error(`${label} is invalid.`);
  }
  return path.resolve(value);
}

function naturalSort(items) {
  return items.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function listFiles(folderPath, extensions) {
  const resolved = requirePath(folderPath, 'Folder path');
  const entries = await fsp.readdir(resolved, { withFileTypes: true });
  return naturalSort(entries
    .filter(entry => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()))
    .map(entry => entry.name))
    .map(name => path.join(resolved, name));
}

function imageMime(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}

function getZipEntries(zip) {
  return naturalSort(Object.keys(zip.files).filter(name => {
    const entry = zip.files[name];
    return !entry.dir && IMAGE_EXTS.has(path.extname(name).toLowerCase());
  }));
}

function touchCbzSession(sessionId) {
  const session = cbzSessions.get(sessionId);
  if (!session) throw new Error('This comic session has expired. Please open the CBZ again.');
  session.lastAccess = Date.now();
  return session;
}

function trimCbzSessions() {
  if (cbzSessions.size <= MAX_CBZ_SESSIONS) return;
  const oldest = [...cbzSessions.entries()]
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    .slice(0, cbzSessions.size - MAX_CBZ_SESSIONS);
  oldest.forEach(([sessionId]) => cbzSessions.delete(sessionId));
}

async function loadCbzArchive(filePath) {
  const resolved = requirePath(filePath, 'Comic path');
  const stats = await fsp.stat(resolved);
  if (!stats.isFile()) throw new Error('The selected comic is not a file.');

  const data = await fsp.readFile(resolved);
  const zip = await JSZip.loadAsync(data);
  const entries = getZipEntries(zip);
  if (!entries.length) throw new Error('No supported images were found in this archive.');
  return { resolved, zip, entries };
}

function validateWebUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 4096) {
    throw new Error('The chapter URL is invalid.');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('The chapter URL is invalid.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS chapter URLs are supported.');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error('The chapter URL contains unsupported credentials or host data.');
  }
  return parsed.toString();
}

function sanitizeRemoteImages(images, baseUrl) {
  if (!Array.isArray(images)) return [];
  const safe = [];
  const seen = new Set();
  for (const value of images.slice(0, 5000)) {
    try {
      const parsed = new URL(value, baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      const normalized = parsed.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        safe.push(normalized);
      }
    } catch {}
  }
  return safe;
}

async function fileExists(filePath, expectedType) {
  try {
    const stats = await fsp.stat(requirePath(filePath));
    return expectedType === 'folder' ? stats.isDirectory() : stats.isFile();
  } catch {
    return false;
  }
}

function cacheThumbnail(key, value) {
  if (!value) return value;
  thumbnailCache.delete(key);
  thumbnailCache.set(key, value);
  while (thumbnailCache.size > 50) {
    thumbnailCache.delete(thumbnailCache.keys().next().value);
  }
  return value;
}

function bufferToThumbnail(buffer) {
  const image = nativeImage.createFromBuffer(Buffer.from(buffer));
  if (image.isEmpty()) return null;
  const size = image.getSize();
  const scale = Math.min(240 / size.width, 360 / size.height, 1);
  const resized = scale < 1
    ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), quality: 'good' })
    : image;
  return `data:image/jpeg;base64,${resized.toJPEG(72).toString('base64')}`;
}

async function readJson(filePath, fallback) {
  try {
    const data = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    return data;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(value), 'utf8');
  try {
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await fsp.rm(filePath, { force: true });
    await fsp.rename(tempPath, filePath);
  }
}

function sanitizeProgress(value) {
  if (!value || typeof value !== 'object') return null;
  const safe = {};
  for (const key of ['page', 'scrollTop', 'scrollLeft']) {
    if (Number.isFinite(value[key])) safe[key] = Math.max(0, Math.round(value[key]));
  }
  if (typeof value.mode === 'string' && value.mode.length < 20) safe.mode = value.mode;
  return safe;
}

function sanitizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const key = typeof entry.key === 'string' ? entry.key.slice(0, 4100) : '';
  const sourcePath = typeof entry.path === 'string' ? entry.path.slice(0, 4096) : '';
  if (!key || !sourcePath || !['folder', 'cbz', 'web'].includes(entry.type)) return null;
  let thumbnail = null;
  if (typeof entry.thumbnail === 'string' && entry.thumbnail.length <= MAX_THUMBNAIL_LENGTH) {
    try {
      const parsed = new URL(entry.thumbnail);
      if (['http:', 'https:', 'data:'].includes(parsed.protocol)) thumbnail = entry.thumbnail;
    } catch {}
  }
  return {
    key,
    path: sourcePath,
    type: entry.type,
    name: String(entry.name || path.basename(sourcePath)).slice(0, 200),
    thumbnail
  };
}

// File dialogs
ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Comic',
    filters: [
      { name: 'Comic Files', extensions: ['cbz', 'zip'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Image Folder',
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Video File',
    filters: [{ name: 'Video', extensions: [...VIDEO_EXTS].map(ext => ext.slice(1)) }],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-video-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Video Folder',
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return listFiles(result.filePaths[0], VIDEO_EXTS);
});

// Image sources and on-demand CBZ pages
ipcMain.handle('read-folder', async (_event, folderPath) => listFiles(folderPath, IMAGE_EXTS));

ipcMain.handle('read-cbz', async (_event, filePath) => {
  const archive = await loadCbzArchive(filePath);
  const sessionId = `cbz-${Date.now()}-${++cbzSessionSequence}`;
  cbzSessions.set(sessionId, {
    filePath: archive.resolved,
    zip: archive.zip,
    entries: archive.entries,
    lastAccess: Date.now()
  });
  trimCbzSessions();
  return {
    sessionId,
    pages: archive.entries.map((name, index) => ({ index, name, mime: imageMime(name) }))
  };
});

ipcMain.handle('read-cbz-page', async (_event, sessionId, pageIndex) => {
  if (typeof sessionId !== 'string' || !Number.isInteger(pageIndex)) {
    throw new Error('Invalid CBZ page request.');
  }
  const session = touchCbzSession(sessionId);
  const entryName = session.entries[pageIndex];
  if (!entryName) throw new Error('The requested page does not exist.');
  const data = await session.zip.files[entryName].async('uint8array');
  return { data, mime: imageMime(entryName) };
});

ipcMain.handle('close-cbz-session', (_event, sessionId) => {
  if (typeof sessionId === 'string') cbzSessions.delete(sessionId);
});

ipcMain.handle('get-source-status', async (_event, type, sourcePath) => {
  if (type === 'web') return { available: true };
  const available = await fileExists(sourcePath, type);
  return available
    ? { available: true }
    : { available: false, reason: type === 'folder' ? 'Folder not found' : 'File not found' };
});

// Small thumbnail generation and in-memory caching
ipcMain.handle('get-folder-thumbnail', async (_event, folderPath) => {
  const resolved = requirePath(folderPath, 'Folder path');
  const files = await listFiles(resolved, IMAGE_EXTS);
  if (!files.length) return null;
  const stats = await fsp.stat(files[0]);
  const cacheKey = `folder:${files[0]}:${stats.mtimeMs}`;
  if (thumbnailCache.has(cacheKey)) return thumbnailCache.get(cacheKey);
  const thumbnail = await nativeImage.createThumbnailFromPath(files[0], { width: 240, height: 360 });
  if (thumbnail.isEmpty()) return null;
  return cacheThumbnail(cacheKey, `data:image/jpeg;base64,${thumbnail.toJPEG(72).toString('base64')}`);
});

ipcMain.handle('get-cbz-thumbnail', async (_event, filePath) => {
  const resolved = requirePath(filePath, 'Comic path');
  const stats = await fsp.stat(resolved);
  const cacheKey = `cbz:${resolved}:${stats.mtimeMs}`;
  if (thumbnailCache.has(cacheKey)) return thumbnailCache.get(cacheKey);

  let zip;
  let entries;
  const active = [...cbzSessions.values()].find(session => session.filePath === resolved);
  if (active) {
    zip = active.zip;
    entries = active.entries;
  } else {
    const archive = await loadCbzArchive(resolved);
    zip = archive.zip;
    entries = archive.entries;
  }
  const buffer = await zip.files[entries[0]].async('nodebuffer');
  return cacheThumbnail(cacheKey, bufferToThumbnail(buffer));
});

// Window controls
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('win-close', () => mainWindow?.close());

// Reading progress. Mutations are serialized to avoid lost updates.
const progressPath = path.join(app.getPath('userData'), 'progress.json');
let progressStorePromise;
let progressWriteQueue = Promise.resolve();

function getProgressStore() {
  if (!progressStorePromise) {
    progressStorePromise = readJson(progressPath, {}).then(data => (
      data && typeof data === 'object' && !Array.isArray(data) ? data : {}
    ));
  }
  return progressStorePromise;
}

ipcMain.handle('save-progress', (_event, data) => {
  const key = typeof data?.key === 'string' ? data.key.slice(0, 4100) : '';
  const value = sanitizeProgress(data?.value);
  if (!key || !value) return false;

  progressWriteQueue = progressWriteQueue.then(async () => {
    const store = await getProgressStore();
    delete store[key];
    store[key] = value;
    while (Object.keys(store).length > MAX_PROGRESS_ENTRIES) {
      delete store[Object.keys(store)[0]];
    }
    await writeJson(progressPath, store);
  });
  return progressWriteQueue.then(() => true);
});

ipcMain.handle('load-progress', async (_event, key) => {
  if (typeof key !== 'string') return null;
  const store = await getProgressStore();
  return store[key] || null;
});

// Reading history. Thumbnails are bounded before being persisted.
const historyPath = path.join(app.getPath('userData'), 'history.json');
let historyWriteQueue = Promise.resolve();

async function readHistory() {
  const list = await readJson(historyPath, []);
  return Array.isArray(list) ? list.map(sanitizeHistoryEntry).filter(Boolean).slice(0, MAX_HISTORY_ENTRIES) : [];
}

function mutateHistory(mutator) {
  historyWriteQueue = historyWriteQueue.then(async () => {
    const list = await readHistory();
    const next = mutator(list).slice(0, MAX_HISTORY_ENTRIES);
    await writeJson(historyPath, next);
    return next;
  });
  return historyWriteQueue;
}

ipcMain.handle('history-add', (_event, entry) => {
  const safeEntry = sanitizeHistoryEntry(entry);
  if (!safeEntry) throw new Error('The history entry is invalid.');
  return mutateHistory(list => [safeEntry, ...list.filter(item => item.key !== safeEntry.key)]);
});

ipcMain.handle('history-get', async () => {
  await historyWriteQueue;
  return readHistory();
});

ipcMain.handle('history-remove', (_event, key) => (
  mutateHistory(list => list.filter(item => item.key !== key))
));

ipcMain.handle('history-clear', () => mutateHistory(() => []));

// Web scraper. webSecurity is disabled only in this isolated, hidden window.
ipcMain.handle('fetch-web-chapter', async (_event, rawUrl) => {
  const safeUrl = validateWebUrl(rawUrl);
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: false,
        images: true,
        partition: `scraper-${Date.now()}`
      }
    });

    let settled = false;
    let extractionTimer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(extractionTimer);
      if (!win.isDestroyed()) win.destroy();
      error ? reject(error) : resolve(result);
    };

    const timeout = setTimeout(() => {
      finish(new Error('Timeout: the website took too long to load'));
    }, 25000);

    win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, targetUrl) => {
      try {
        validateWebUrl(targetUrl);
      } catch {
        event.preventDefault();
      }
    });

    win.webContents.once('did-finish-load', () => {
      extractionTimer = setTimeout(async () => {
        try {
          const result = await win.webContents.executeJavaScript(`
            (function() {
              const pageUrl = location.href;
              const hostname = location.hostname;

              function readSources(selector, attributes) {
                return [...document.querySelectorAll(selector)].map(img => {
                  for (const attribute of attributes) {
                    const value = attribute === 'src' ? img.src : img.getAttribute(attribute);
                    if (value) return value;
                  }
                  return '';
                }).filter(value => value && !value.startsWith('data:') && value.length > 10);
              }

              function parseNetTruyen() {
                return readSources(
                  '.reading-detail img, .page-chapter img, #chapter-content img, .chapter-content img, .box_doc img',
                  ['data-src', 'data-original', 'src']
                );
              }

              function parseManganato() {
                return readSources('.container-chapter-reader img, .panel-read-story img', ['src']);
              }

              function parseNhatTruyen() {
                return readSources('.reading-detail .page-chapter img', ['data-original', 'data-src', 'src']);
              }

              function parseGeneric() {
                const candidates = [...document.querySelectorAll('img')].filter(img => {
                  const src = img.getAttribute('data-src') || img.getAttribute('data-original') ||
                    img.getAttribute('data-lazy-src') || img.src || '';
                  if (!src || src.startsWith('data:') || src.length < 10) return false;
                  const width = img.naturalWidth || img.width || img.clientWidth || 0;
                  const height = img.naturalHeight || img.height || img.clientHeight || 0;
                  if ((width > 0 && width < 100) || (height > 0 && height < 150)) return false;
                  return !/logo|icon|avatar|banner|favicon|sprite|ads|advertisement|thumb(?!nail)|btn|button/.test(src.toLowerCase());
                });
                return [...new Set(candidates.map(img =>
                  img.getAttribute('data-src') || img.getAttribute('data-original') ||
                  img.getAttribute('data-lazy-src') || img.getAttribute('data-img') || img.src
                ).filter(Boolean))];
              }

              let images = [];
              if (/nettruyen|truyenqq|truyenfull|mangavn|doctruyen|blogtruyen/.test(hostname)) {
                images = parseNetTruyen();
              } else if (/manganato|readmanganato|chapmanganato/.test(hostname)) {
                images = parseManganato();
              } else if (/nhattruyen|nhattruyenme/.test(hostname)) {
                images = parseNhatTruyen();
              }
              if (images.length < 2) images = parseGeneric();

              const titleElement = document.querySelector(
                'h1.chapter-title, h1.title, .chapter-info h1, .chapter-info h2, title, h1, h2.chapter-name, .chapter-name'
              );
              const title = titleElement
                ? (titleElement.innerText || titleElement.textContent).trim().slice(0, 120)
                : document.title.slice(0, 120);
              return { images, title, url: pageUrl };
            })()
          `);

          const finalUrl = validateWebUrl(result.url || safeUrl);
          const images = sanitizeRemoteImages(result.images, finalUrl);
          if (!images.length) {
            finish(new Error('No comic images were found on this page.\nCheck the URL or try another supported website.'));
            return;
          }
          finish(null, { images, title: String(result.title || '').slice(0, 120), url: finalUrl });
        } catch (error) {
          finish(error);
        }
      }, 1500);
    });

    win.webContents.on('did-fail-load', (_event, code, description, _validatedUrl, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        finish(new Error(`Could not load page: ${description} (code ${code})`));
      }
    });

    win.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    win.loadURL(safeUrl).catch(error => finish(error));
  });
});
