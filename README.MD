# CD COMIC READER

**CD Comic Reader** is a lightweight, minimalist desktop application built with Electron for reading comics and manga from local files or web sources. Supports continuous scrolling, paged layouts, and video playback.

---

## Features

### Reading Modes
- **Vertical Scroll** — Continuous scrolling, ideal for Webtoons
- **Horizontal L→R** — Horizontal scrolling from left to right
- **Horizontal R→L** — Horizontal scrolling from right to left (manga style), starting with page 1 on the right
- **Page L→R** — Single- or double-page reading from left to right
- **Page R→L** — Single- or double-page reading from right to left (manga style)

### Sources
- Open `.cbz` / `.zip` archive files
- Open local image folders (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`)
- Load chapters directly from web URLs — uses a hidden Chromium window to scrape images with site-specific parsers for NetTruyen, Manganato, TruyenQQ, NhaTruyen, TruyenFull, and a generic fallback

### Library
- Save any open source (folder, CBZ, or web URL) to a persistent library with one click
- Open the library as a full-panel grid view with cover thumbnails and entry names
- Delete individual entries from the library grid (hover to reveal ✕ button)
- **Export** the entire library to a JSON file for backup or sharing
- **Import** a JSON library file — merges without duplicates
- Library data stored in `localStorage` — no extra files written to disk

### Bookmarks
- Mark any page with `B` or the `+` button in the sidebar
- All bookmarks listed in the sidebar with page number — click to jump instantly
- Delete individual bookmarks from the list
- Stored per-source in `localStorage` as `cd-bookmarks`

### Video Viewer
- Open a single video file (`mp4`, `webm`, `mkv`, `avi`, `mov`, `wmv`, `flv`, `m4v`)
- Open a folder as a playlist — auto-advances to the next video when one ends
- Custom controls overlay: play/pause, seekbar, timestamp, volume/mute, playback speed (0.5×–2×), fullscreen
- Playlist panel appears automatically when a folder has 2+ videos
- Controls auto-hide after 3 s during playback; always visible when paused

### Session & History
- **Auto-resume progress** — saves scroll position or page number per source, restores on reopen
- **Recent history** — last 10 opened sources with cover thumbnails, stored in `history.json`

### Display Controls
- Image width slider: 30%–100%
- Page gap slider: 0px–32px
- Background presets: Pitch Black, Midnight Blue, Dark Grey, Warm Cream, White
- Double-page toggle (paged modes)
- Scroll-to-top button (vertical scroll mode)
- **Fullscreen / sidebar-hide** — toggle with `F` or the hamburger button in the titlebar (CSS transition 0.22 s)

---

## Keyboard Shortcuts

### Comic Reader
| Keys | Action |
|------|--------|
| `Ctrl+O` | Open CBZ/ZIP file |
| `Ctrl+F` | Open image folder |
| `F` | Toggle fullscreen (hide/show sidebar) |
| `B` | Toggle bookmark on current page |
| `ArrowDown` / `PageDown` | Scroll down (vertical scroll mode) |
| `ArrowUp` / `PageUp` | Scroll up (vertical scroll mode) |
| `ArrowRight` / `PageDown` | Scroll right / next page (L→R modes) |
| `ArrowLeft` / `PageUp` | Scroll left / prev page; inverted in R→L modes |
| `Home` / `End` | Jump to first / last page |
| `[` | Decrease image width by 5% |
| `]` | Increase image width by 5% |
| `Ctrl + Wheel` | Resize image width |

### Video Viewer
| Keys | Action |
|------|--------|
| `Space` | Play / Pause |
| `ArrowLeft` / `ArrowRight` | Seek ±5 seconds |
| `ArrowUp` / `ArrowDown` | Volume up / down |
| `M` | Mute / Unmute |
| `F` | Toggle sidebar |

---

## Tech Stack

- **Electron** — main process, IPC, window controls
- **JSZip** — in-memory CBZ/ZIP extraction
- **Chromium (hidden BrowserWindow)** — web chapter scraping
- **localStorage** — library, bookmark, and progress persistence
- **Inter & Syne** — typography (Google Fonts)

---

## Installation

```bash
npm install
npm start
```

Build a Windows installer:

```bash
npm run build
```

---

## Project Structure

| File | Role |
|------|------|
| `src/main.js` | Electron main process — window creation, IPC handlers (file dialogs, image reading, thumbnails, history/progress JSON, web scraping, video file/folder open) |
| `src/preload.js` | Context bridge — whitelisted IPC channels exposed to renderer via `window.electronAPI` |
| `src/index.html` | App layout — titlebar, sidebar, reader area, library panel, video view, URL modal |
| `src/renderer.js` | UI logic — reading modes, library, bookmarks, history, video player, scroll/page navigation, keyboard/mouse events |
| `src/style.css` | Styles — CSS custom properties, dark theme, library grid, reader layouts, video overlay |
