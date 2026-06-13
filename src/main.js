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
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
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