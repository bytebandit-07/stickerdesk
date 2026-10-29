# StickerDesk: Detailed Build Plan

Hand this file to Antigravity as the project brief. Build phase by phase. Do NOT start the next phase until the current one runs and its acceptance checks pass.

## 1. What it is
A Windows desktop app where the user imports a PNG/JPG, crops it, removes the background, adds a die-cut sticker outline, and then pins it on the desktop as a floating **2D** or **3D** widget. Everything runs locally.

## 2. Tech stack (fixed, do not swap)
| Layer | Choice |
|---|---|
| Shell | Electron (latest stable) + TypeScript |
| UI | React + Vite + Zustand (state) |
| Cropping | react-easy-crop (rect) + custom Canvas lasso tool |
| Background removal | @imgly/background-removal (runs in renderer, no Python) |
| 3D | three.js (+ @react-three/fiber for the studio preview) |
| Local backend | Node + Express inside Electron main process, better-sqlite3 |
| Packaging | electron-builder (Windows NSIS installer) |

## 3. Project structure
```
stickerdesk/
  package.json
  electron/
    main.ts              # app lifecycle, tray, hotkeys, window manager
    preload.ts           # contextBridge IPC API (typed)
    widgetManager.ts     # create/destroy/update widget windows
    server/
      index.ts           # Express app (localhost, random port)
      db.ts              # SQLite setup + migrations
      routes/stickers.ts
      routes/widgets.ts
      routes/settings.ts
  src/
    studio/              # main studio window (React)
      pages/Library.tsx
      pages/Editor.tsx
      components/CropTool.tsx
      components/LassoTool.tsx
      components/OutlineControls.tsx
    widget/              # widget window (React, minimal)
      Widget2D.tsx
      Widget3D.tsx
      shaders/holo.ts
    lib/
      image/outline.ts   # die-cut outline algorithm
      image/mask.ts      # alpha mask helpers
      three/extrude.ts   # alpha mask -> 3D geometry
    store/
  data/                  # userData: stickers/*.png, db.sqlite
```

## 4. Data model (SQLite)
```
stickers(id, name, file_path, thumb_path, width, height, created_at)
widgets(id, sticker_id, mode['2d'|'3d'], x, y, width, height, monitor_id,
        opacity, locked, click_through, always_on_top, settings_json, active)
settings(key, value)   # hotkey, launch_on_startup, default_mode, etc.
```

## 5. REST API (local only, bound to 127.0.0.1)
- `GET/POST /stickers`, `GET/PATCH/DELETE /stickers/:id`
- `GET/POST /widgets`, `PATCH/DELETE /widgets/:id`
- `GET/PUT /settings`
- Validate all input with zod. Never expose to non-localhost.

---

## Phase 0: Scaffold
**Do:** Electron + Vite + React + TS project, preload with contextIsolation ON, nodeIntegration OFF, typed IPC, Express server started in main process, SQLite migrations.
**Done when:** `npm run dev` opens a studio window showing "Library (empty)" and `GET /stickers` returns `[]`.

## Phase 1: Studio (import, crop, background removal, outline)
**Do:**
1. Import via file picker AND drag-and-drop (png, jpg, webp). Limit 20 MB.
2. Crop tool: rectangle crop with aspect presets (free, 1:1, 4:3), plus a freehand **lasso** tool (draw path, everything outside becomes transparent).
3. One-click **Remove Background** (imgly), with a progress indicator and before/after toggle. Manual **eraser/restore brush** to fix mistakes.
4. **Die-cut outline:** algorithm = take alpha mask, dilate by N px (slider 0-40), fill white, smooth corners (blur + threshold), draw original on top. Add optional drop shadow. Color picker for outline (default white).
5. Live preview on a checkerboard background. Undo/redo (at least 20 steps).
6. Save: writes final PNG + thumbnail to `userData/stickers`, inserts DB row.
**Done when:** a photo can be imported, cropped, background-removed, outlined, saved, and appears in Library with a thumbnail.

## Phase 2: 2D desktop widget
**Do:**
1. "Pin to Desktop" button in Library creates an Electron BrowserWindow: `transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false`.
2. Widget renders the PNG. Drag to move (custom drag region), mouse-wheel or corner handle to resize (keep aspect ratio), right-click context menu: Opacity, Lock position, Click-through, Switch to 3D, Remove.
3. Idle animation options: none / float / gentle sway (CSS transform).
4. Click-through mode: `setIgnoreMouseEvents(true, {forward: true})`, toggled by tray menu or hotkey so it can always be turned off.
5. Persist x, y, size, opacity per widget; restore all active widgets on app start. Handle multi-monitor and clamp to visible displays if a monitor is removed.
**Done when:** 3 stickers can be pinned, moved, resized, restarted, and reappear in the same places.

## Phase 3: 3D widget
**Do:**
1. `extrude.ts`: trace the alpha mask contour (marching squares), simplify the polygon, build a `THREE.Shape`, and `ExtrudeGeometry` with depth (slider, default 0.08 of width) and small bevel.
2. Material: front face uses the sticker texture, sides use a solid color sampled from the outline. Options: **Matte**, **Glossy** (MeshPhysicalMaterial clearcoat), **Holographic** (custom shader: iridescent gradient driven by view angle).
3. Interaction: mouse-parallax tilt toward cursor (global cursor position from main process, since the widget is not focused), slow auto-rotate toggle, hover wobble.
4. Transparent WebGL canvas (`alpha: true`, `premultipliedAlpha`) with no background and correct antialiasing. Cap at 60 FPS and pause rendering when widget is hidden or fullscreen app is active.
5. Switch 2D <-> 3D live without losing position.
**Done when:** a sticker spins/tilts as a thick 3D object on the desktop with a transparent background and no visible rectangle.

## Phase 4: Library and widget manager
**Do:** Library grid with search, rename, delete (also removes widgets), duplicate. "Widgets" tab listing active widgets with mode toggle, lock, opacity, show/hide. Export sticker as PNG.
**Done when:** all state survives restart and deleting a sticker cleanly removes its widgets.

## Phase 5: System integration and polish
**Do:** Tray icon (Show Studio, Show/Hide all widgets, Click-through all, Quit). Global hotkey (default Ctrl+Alt+S) to toggle all widgets, configurable. Launch on startup option. Single-instance lock. Auto-pause 3D animation on battery saver. Error toasts, loading states, empty states. electron-builder NSIS installer.
**Done when:** the installer builds, installs on a clean Windows machine, and the app starts with Windows.

---

## 6. Non-functional requirements
- Security: contextIsolation on, no remote content, CSP set, Express bound to localhost with a random port + per-launch token.
- Performance: idle CPU under 2% with 5 2D widgets; 3D widget under 10% GPU on an integrated GPU.
- Code: strict TypeScript, no `any`, ESLint + Prettier, small modules, comments only where logic is non-obvious.

## 7. Known tricky parts (handle carefully)
1. Transparent window + WebGL on Windows: needs `alpha: true`, and disabling GPU vsync flicker; test with hardware acceleration on and off.
2. Click-through vs dragging: use `setIgnoreMouseEvents` with `forward: true` and toggle based on hover over opaque pixels.
3. Mask-to-geometry: holes in stickers (e.g. letter "O") must become shape holes; ignore specks under a minimum area.
4. DPI scaling: multi-monitor with different scale factors can misplace windows. Store DIP coordinates and convert via `screen` API.

## 8. Working rules for the agent
- Work one phase at a time. After each phase: run it, list what was verified, then wait.
- Commit after each phase with message `phase-N: <summary>`.
- If a requirement is ambiguous, pick the simplest option, note it in `DECISIONS.md`, and continue.
- Do not add features outside this plan.

## 9. Stretch ideas (only after Phase 5)
Sticker packs import/export, animated GIF/APNG widgets, per-sticker physics (bounces when dragged), pin to window edges, widget "personality" (reacts when typing).
