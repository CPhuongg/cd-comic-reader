const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const electronPath = require('electron');
const port = 9333 + Math.floor(Math.random() * 300);
const tempRoot = path.join(os.tmpdir(), `cd-comic-reader-smoke-${process.pid}`);
const imageFolder = path.join(tempRoot, 'images-1000');
const cbzPath = path.join(tempRoot, 'comic-1000.cbz');
const videoPath = path.join(tempRoot, 'sample.mp4');
const userDataPath = path.join(tempRoot, 'user-data');
const metrics = {};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createFixtures() {
  await fsp.mkdir(imageFolder, { recursive: true });
  const png = await fsp.readFile(path.join(root, 'assets', 'icon.png'));
  const writes = [];
  for (let index = 0; index < 1000; index++) {
    writes.push(fsp.writeFile(path.join(imageFolder, `page-${String(index + 1).padStart(4, '0')}.png`), png));
    if (writes.length === 50) {
      await Promise.all(writes.splice(0));
    }
  }
  await Promise.all(writes);

  const zip = new JSZip();
  for (let index = 0; index < 1000; index++) {
    zip.file(`page-${String(index + 1).padStart(4, '0')}.png`, png, { compression: 'STORE' });
  }
  await fsp.writeFile(cbzPath, await zip.generateAsync({ type: 'nodebuffer', streamFiles: true }));

  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath
    ], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)));
  });
}

async function waitForTarget(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
      const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {}
    await delay(200);
  }
  throw new Error('Electron DevTools target did not become available.');
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.sequence = 0;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
    await this.send('Runtime.enable');
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async waitFor(expression, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await delay(100);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  close() {
    this.socket?.close();
  }
}

async function run() {
  await createFixtures();
  const childEnv = { ...process.env, DEBUG: '' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [
    root,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataPath}`,
    '--disable-gpu'
  ], {
    cwd: root,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  let client;
  try {
    const target = await waitForTarget();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.waitFor("document.readyState === 'complete'");

    await client.evaluate(`loadFolder(${JSON.stringify(imageFolder)})`);
    await client.waitFor("currentImages.length === 1000 && loadingEl.style.display === 'none'", 30000);
    await delay(500);
    metrics.folder = await client.evaluate(`({
      pages: currentImages.length,
      shells: document.querySelectorAll('.page-shell').length,
      loadedImages: document.querySelectorAll('.page-img[src]').length,
      objectUrls: imageObjectUrls.size
    })`);
    assert(metrics.folder.shells === 1000, 'The 1000-page folder did not render all lightweight shells.');
    assert(metrics.folder.loadedImages >= 1, 'The first folder pages were not loaded eagerly.');
    assert(metrics.folder.loadedImages <= 12, `Folder lazy loading attached ${metrics.folder.loadedImages} images.`);
    assert(metrics.folder.objectUrls === 0, 'Folder images unexpectedly created object URLs.');

    await client.evaluate(`scrollCurrentPage = 20; scrollToPageIndex(20, false); flushProgress()`);
    await delay(300);
    await client.evaluate(`loadFolder(${JSON.stringify(imageFolder)})`);
    await client.waitFor("currentImages.length === 1000 && loadingEl.style.display === 'none'", 30000);
    await delay(400);
    metrics.restoredPage = await client.evaluate('scrollCurrentPage');
    assert(metrics.restoredPage >= 19 && metrics.restoredPage <= 21, `Progress restored to page ${metrics.restoredPage + 1}, expected page 21.`);

    await client.evaluate(`document.querySelector('[data-mode="ltr"]').click()`);
    await client.waitFor("document.querySelectorAll('.paged-page-img').length === 1");
    metrics.folderPagedImages = await client.evaluate("document.querySelectorAll('.paged-page-img').length");
    assert(metrics.folderPagedImages === 1, 'Single-page mode rendered more than one image.');

    await client.evaluate(`doublePageToggle.checked = true; doublePageToggle.dispatchEvent(new Event('change'))`);
    await client.waitFor("document.querySelectorAll('.paged-page-img').length === 2");
    metrics.doublePageImages = await client.evaluate("document.querySelectorAll('.paged-page-img').length");

    await client.evaluate(`document.querySelector('[data-mode="scroll"]').click()`);
    await client.waitFor("document.querySelectorAll('.page-shell').length === 1000");
    await client.evaluate(`loadCBZ(${JSON.stringify(cbzPath)})`);
    await client.waitFor("currentImages.length === 1000 && loadingEl.style.display === 'none'", 45000);
    await delay(800);
    metrics.cbzScroll = await client.evaluate(`({
      pages: currentImages.length,
      loadedImages: document.querySelectorAll('.page-img[src]').length,
      objectUrls: imageObjectUrls.size,
      session: Boolean(currentCbzSession)
    })`);
    assert(metrics.cbzScroll.session, 'CBZ session was not established.');
    assert(metrics.cbzScroll.loadedImages >= 1, 'The first CBZ pages were not loaded eagerly.');
    assert(metrics.cbzScroll.loadedImages <= 12, `CBZ lazy loading attached ${metrics.cbzScroll.loadedImages} images.`);
    assert(metrics.cbzScroll.objectUrls <= 12, `CBZ retained ${metrics.cbzScroll.objectUrls} object URLs while scrolling.`);

    await client.evaluate(`scrollCurrentPage = 12; scrollToPageIndex(12, false); document.querySelector('[data-mode="scroll-ltr"]').click()`);
    await client.waitFor("readMode === 'scroll-ltr' && document.querySelectorAll('.page-shell').length === 1000");
    await delay(300);
    metrics.horizontalLtrPage = await client.evaluate('scrollCurrentPage');
    await client.evaluate(`document.querySelector('[data-mode="scroll-rtl"]').click()`);
    await client.waitFor("readMode === 'scroll-rtl' && document.querySelectorAll('.page-shell').length === 1000");
    await delay(300);
    metrics.horizontalRtlPage = await client.evaluate('scrollCurrentPage');
    assert(Math.abs(metrics.horizontalLtrPage - 12) <= 1, 'Horizontal LTR mode lost the current page.');
    assert(Math.abs(metrics.horizontalRtlPage - 12) <= 1, 'Horizontal RTL mode lost the current page.');

    await client.evaluate(`document.querySelector('[data-mode="rtl"]').click()`);
    await client.waitFor("document.querySelectorAll('.paged-page-img').length >= 1");
    await client.evaluate(`changePage('next'); changePage('next'); changePage('next')`);
    await delay(700);
    metrics.cbzPaged = await client.evaluate(`({
      rendered: document.querySelectorAll('.paged-page-img').length,
      objectUrls: imageObjectUrls.size,
      preloaders: pagedPreloaders.size
    })`);
    assert(metrics.cbzPaged.rendered <= 2, 'Paged CBZ mode rendered more than two images.');
    assert(metrics.cbzPaged.objectUrls <= 6, `Paged CBZ mode retained ${metrics.cbzPaged.objectUrls} object URLs.`);

    await client.evaluate(`loadFolder(${JSON.stringify(imageFolder)})`);
    await client.waitFor("currentImages.length === 1000 && !currentCbzSession", 30000);
    metrics.afterCbzClose = await client.evaluate('imageObjectUrls.size');
    assert(metrics.afterCbzClose === 0, 'CBZ object URLs were retained after changing comics.');

    metrics.missingSource = await client.evaluate(`ipcRenderer.invoke('get-source-status', 'cbz', ${JSON.stringify(path.join(tempRoot, 'missing.cbz'))})`);
    assert(metrics.missingSource.available === false, 'Missing files are not reported as unavailable.');

    await client.evaluate(`loadVideo([${JSON.stringify(videoPath)}, ${JSON.stringify(videoPath)}], 0)`);
    await client.waitFor("videoViewVisible && videoFiles.length === 2");
    await delay(500);
    metrics.video = await client.evaluate(`({
      visible: videoViewEl.style.display,
      playlistItems: document.querySelectorAll('.video-playlist-item').length,
      comicPages: currentImages.length,
      cbzSession: currentCbzSession
    })`);
    assert(metrics.video.visible === 'flex', 'Video view did not open.');
    assert(metrics.video.playlistItems === 2, 'Video playlist did not render both files.');
    assert(metrics.video.comicPages === 0 && !metrics.video.cbzSession, 'Comic resources were retained after opening video.');

    console.log(JSON.stringify(metrics, null, 2));
    await client.send('Browser.close').catch(() => {});
  } finally {
    client?.close();
    if (!child.killed) child.kill();
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      delay(3000)
    ]);
    if (stderr && !/DevTools listening/.test(stderr)) process.stderr.write(stderr);
    const resolvedTemp = path.resolve(tempRoot);
    assert(resolvedTemp.startsWith(path.resolve(os.tmpdir()) + path.sep), 'Refusing to clean a path outside the temp directory.');
    await fsp.rm(resolvedTemp, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
