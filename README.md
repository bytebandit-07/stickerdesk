# StickerDesk 🎨📌

A local-first Windows desktop application built with Electron, React, TypeScript, and Vite. Import images, automatically remove backgrounds using local on-device AI, fine-tune boundaries with an editable polygon lasso, add die-cut sticker outlines, and pin them directly to your desktop as interactive floating widgets.

---

## ✨ Features

- **Local AI Background Removal:** Powered by `@imgly/background-removal` and ONNX Runtime Web. Runs 100% locally with zero cloud dependencies.
- **Editable Polygon Lasso Tool:** Draw freehand cutouts and fine-tune boundaries with draggable control vertices (up to 32 points) for pixel-perfect cutouts.
- **Die-Cut Sticker Generator:** Configurable outline dilation, custom border colors, and drop-shadows.
- **Desktop Sticker Widgets:**
  - **Silky Smooth Dragging:** Drag stickers anywhere across multi-monitor setups.
  - **DPI Rounding Drift Protection:** Explicit in-memory dimension caching eliminates Windows fractional scaling (125%/150%) auto-zoom bugs.
  - **Native Right-Click Context Menu:** Adjust opacity, toggle idle animations (Float, Gentle Sway), lock position, toggle Click-Through, or delete.
  - **Desktop-Level Z-Order:** Widgets stay gracefully on the desktop wallpaper level behind active applications, with an instant "Always on Top" toggle when desired.
  - **Click-Through Mode & Fail-Safe Recovery:** Turn stickers click-through to work beneath them, with 3 recovery mechanisms:
    1. System Tray Menu (*Disable Click-Through on All Widgets*)
    2. Global Shortcuts (`Ctrl + Alt + C` / `Ctrl + Alt + Shift + C`)
    3. Studio Library Dashboard

---

## 🛠️ Tech Stack

- **Runtime:** Electron 31 + Node.js
- **Frontend:** React 18, TypeScript 5, Vite 5
- **Local Database:** SQLite via `better-sqlite3` (WAL mode enabled)
- **Local Server:** Express API with per-launch cryptographic token authorization
- **AI / ML:** ONNX Runtime Web (`ort-wasm-simd-threaded.jsep.wasm`)

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v20 or v22 recommended)
- Windows 10/11

### Installation & Run

```bash
# Clone the repository
git clone https://github.com/bytebandit-07/stickerdesk.git
cd stickerdesk

# Install dependencies
npm install

# Start development mode (Vite + Electron)
npm run dev
```

---

## 📐 Architecture & Key Solutions

Detailed architectural decisions and bug resolutions are documented in [`DECISIONS.md`](./DECISIONS.md).

### The Drag Auto-Zoom Bug & Fix:
Transparent, frameless Electron windows on Windows with fractional display scaling (125%/150%) previously suffered from runaway size inflation during drag events. The solution combines:
1. **Authoritative In-Memory Sizing:** Cached dimensions in `WidgetManager` passed atomically via `win.setBounds({ x, y, width, height })`, preventing Windows DWM from drifting width/height during position updates.
2. **Chromium Visual Zoom Lockdown:** `disablePageZoom` sets `zoomFactor` to `1` and locks visual zoom limits `(1, 1)`.
3. **Native Non-Passive Wheel Interception:** Disables browser-level gesture zooming during dragging.

---

## 📄 License

MIT License.
