# CD COMIC READER
Local display images in comic style

**CD Comic Reader** is a lightweight, modern, and minimalist desktop application built to view comic books and manga directly from local image folders or compressed archive files (`.cbz`, `.zip`)[cite: 1, 2]. It is highly optimized to deliver both a fluid continuous vertical scrolling experience (Webtoon/Comic style) and a classic page-by-page layout (Manga style)[cite: 1, 3].

---

## 🚀 Key Features

### 1. Flexible Reading Modes
* **Continuous Scroll:** Automatically sequences and aligns images vertically with customizable gaps, offering the perfect layout for Webtoons and modern digital comics[cite: 1, 3].
* **Paged View (Left-to-Right):** Classic layout that renders one page at a time, moving forward from left to right[cite: 1, 3].
* **Manga View (Right-to-Left):** Tailored specifically for authentic Japanese Manga, reversing navigation flows to read from right to left[cite: 1, 3].

### 2. Comprehensive Archive & Format Compatibility
* Parses and extracts **`.cbz`** and **`.zip`** archives entirely on-the-fly directly inside memory buffers, removing any need for manual extraction on your hard drive[cite: 2].
* Supports all common image extensions natively: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, and `.bmp`[cite: 2].

### 3. Granular Sidebar Controller & Personalization
* **Image Width Adjuster:** Real-time slider to dynamic scale comic widths from `30%` to `100%` of the viewing container[cite: 1, 3].
* **Page Gap Configurator:** Allows users to fine-tune spacing between images from `0px` to `32px` to seamlessly join cut-slices in Webtoons[cite: 1, 3].
* **Immersive Background Tones:** Features a curated array of view backdrops (Pitch Black, Midnight Blue, Dark Grey, Warm Cream, and Crisp White) designed to prevent eye strain during long reading sessions[cite: 1].

### 4. Smart Session Management & High Performance
* **Auto-Resume Progress:** Monitors your scroll location and securely caches the exact pixel offset (`scrollTop`) to restore your exact reading position upon re-opening[cite: 2, 3].
* **Recent History Index:** Maintains an easily accessible list of your last 10 reading sessions, automatically rendering the comic's first page as an interactive thumbnail[cite: 2, 3].
* **Native Lazy Loading:** Defers out-of-viewport image rendering, safeguarding low RAM usage even when opening massive chapters containing hundreds of pages[cite: 3].
* **Frameless Aesthetics:** Uses a custom titlebar coupled with drag region support for an sleek, unified application boundary[cite: 1, 2].

---

## 🛠️ Tech Stack
* **Runtime Core:** Electron (Node.js & Chromium execution context)[cite: 2, 3]
* **Archive Utility:** `jszip` (asynchronous file extraction directly via buffers)[cite: 2]
* **Typography:** Syne & Inter (linked directly from Google Fonts)[cite: 1]

---

## ⌨️ Global Hotkeys & Controls

### System Operations
* `Ctrl + O` : Trigger native dialog to open `.cbz` / `.zip` archive files[cite: 1, 3].
* `Ctrl + F` : Trigger native directory selector to load local image folders[cite: 1, 3].

### Inside Scroll Mode
* `ArrowDown` / `PageDown` : Smoothly scroll down the chapter container[cite: 3].
* `ArrowUp` / `PageUp` : Smoothly scroll up the chapter container[cite: 3].
* `Home` / `End` : Snap directly to the absolute start or finish of the book[cite: 3].

### Inside Paged & Manga Modes
* `ArrowRight` / `PageDown` : Step to the next page (Acts as page-backward in Right-to-Left Manga mode)[cite: 3].
* `ArrowLeft` / `PageUp` : Step to the previous page (Acts as page-forward in Right-to-Left Manga mode)[cite: 3].

### View Resizing Bindings
* Phím `[` : Scale down comic width decrementally (`-5%`)[cite: 3].
* Phím `]` : Scale up comic width incrementally (`+5%`)[cite: 3].
* `Ctrl + Mouse Wheel` : Convenient macro to scale page bounds instantly[cite: 3].

---

## 📦 Installation & Local Deployment

### 1. Resolve Project Dependencies
Clone this repository to your local directory, open your terminal context inside the root project directory, and execute:
```bash
npm install

```

### 2. Initiate App in Developer Sandbox

Run the sandbox framework using Electron's lifecycle management script:

```bash
npm start

```

### 3. Architecture Blueprint Overview

* `index.html`: Defines the layout tree comprising the custom app titlebar, setting toggles inside the sidebar panel, and the view presentation stage.


* `renderer.js`: Orchestrates UI reactivity, captures global hotkey events, fires asynchronous queries, and runs the intersection observers to track current pages.


* `style.css`: Establishes modular design tokens (`:root`), controls smooth UI transition animations, and isolates structural layouts for fluid scrolling boundaries.


* `main.js`: Directs Electron main lifecycle processes, handles frame-hidden window instantiations, establishes secure IPC bridges for secure I/O operations, and commits reading metrics to local `.json` stores.


