# CD COMIC READER

**CD Comic Reader** is a lightweight, minimalist desktop application built with Electron for reading comics and manga from local files or web sources. Supports continuous scrolling and paged layouts across all directions.

---

## Features

### Reading Modes
- **Cuộn dọc** — Vertical continuous scroll, ideal for Webtoons
- **Cuộn ngang L→R** — Horizontal scroll, left to right
- **Cuộn ngang R→L** — Horizontal scroll, right to left (manga style), starts at page 1 on the right
- **Trang L→R** — Single/double page, left to right
- **Trang R→L** — Single/double page, right to left (manga)

### Sources
- Open `.cbz` / `.zip` archive files
- Open local image folders (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`)
- Load chapters directly from web URLs — uses a hidden Chromium window to scrape images with site-specific parsers for NetTruyen, Manganato, TruyenQQ, NhaTruyen, TruyenFull, and a generic fallback

### Library
- Save any open source (folder, CBZ, or web URL) to a persistent library with one click
- Open the library as a full-panel grid view with cover thumbnails and entry names
- Delete individual entries from the library grid (hover to reveal ✕ button)
- Library data stored in `localStorage` — no extra files written to disk

### Session & History
- **Auto-resume progress** — saves scroll position or page number per source, restores on reopen
- **Recent history** — last 10 opened sources with cover thumbnails, stored in `history.json`

### Display Controls
- Image width slider: 30%–100%
- Page gap slider: 0px–32px
- Background presets: Pitch Black, Midnight Blue, Dark Grey, Warm Cream, White
- Double-page toggle (paged modes)
- Scroll-to-top button (vertical scroll mode)

---

## Keyboard Shortcuts

| Keys | Action |
|------|--------|
| `Ctrl+O` | Open CBZ/ZIP file |
| `Ctrl+F` | Open image folder |
| `ArrowDown` / `PageDown` | Scroll down (vertical scroll mode) |
| `ArrowUp` / `PageUp` | Scroll up (vertical scroll mode) |
| `ArrowRight` / `PageDown` | Scroll right / next page (L→R modes) |
| `ArrowLeft` / `PageUp` | Scroll left / prev page; or next/prev inverted in R→L modes |
| `Home` / `End` | Jump to first / last page |
| `[` | Decrease image width by 5% |
| `]` | Increase image width by 5% |
| `Ctrl + Wheel` | Resize image width |

---

## Tech Stack

- **Electron** — main process, IPC, window controls
- **JSZip** — in-memory CBZ/ZIP extraction
- **Chromium (hidden BrowserWindow)** — web chapter scraping
- **localStorage** — library persistence
- **Inter & Syne** — typography (Google Fonts)

---

## Installation

```bash
npm install
npm start
```

## Project Structure

| File | Role |
|------|------|
| `src/main.js` | Electron main process — window creation, IPC handlers (file dialogs, image reading, thumbnails, history/progress JSON, web scraping) |
| `src/index.html` | App layout — titlebar, sidebar, reader area, library panel, URL modal |
| `src/renderer.js` | UI logic — reading modes, library, history, scroll/page navigation, keyboard/mouse events |
| `src/style.css` | Styles — CSS custom properties, dark theme, library grid, reader layouts |
