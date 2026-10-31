# Architectural Decisions

## Phase 0
1. **Per-launch API Token & Verification**: The Express server generates a random 32-byte hex token on startup and binds to `127.0.0.1:0` (OS-assigned free port). The renderer retrieves `{ port, token, baseUrl }` via `window.stickerdesk.getServerConfig()`. To allow direct terminal/browser verification of `GET /stickers` during Phase 0 testing while keeping mutating routes protected, `GET` requests without the header are permitted on `127.0.0.1`, whereas any mutating request (`POST`, `PATCH`, `PUT`, `DELETE`) or any request supplying an invalid `x-stickerdesk-token` header is rejected with `401 Unauthorized`.
2. **Dual TypeScript Config (`tsconfig.json` + `tsconfig.node.json`)**: Vite bundles the React renderer (`src/`), while `tsc -p tsconfig.node.json` compiles `electron/` to CommonJS in `dist-electron/` so Electron and native `better-sqlite3` bindings load without ESM/CJS interop conflicts.


## Phase 2: Desktop Widget & Drag Stability

### 3. Resolution of the Drag Auto-Zoom & Size Inflation Bug
**The Problem:**
When dragging or holding a desktop sticker widget on Windows, the sticker would automatically and continuously expand/zoom in. This issue plagued early iterations due to two compounding factors in Electron on Windows:
1. **Chromium Page Visual Zoom:** Trackpad gestures or mouse hold events triggered Chromium's internal pinch/wheel zoom (`zoom-changed` event), scaling the web document visual tree independently of the OS window size.
2. **Windows Fractional DPI Rounding Drift:** On Windows displays with fractional scaling (125% or 150%), calling `win.setPosition(x, y)` on a frameless, transparent window forced Windows to recalculate physical pixel bounds. When converted back to Device Independent Pixels (DIPs), fractional rounding errors caused the window width and height to grow by 1–2 pixels on every single mousemove event. Reading `win.getContentSize()` repeatedly accumulated this drift into runaway window inflation.

**The Solution:**
1. **In-Memory Size Cache (`this.sizes` Map):** `WidgetManager` maintains an authoritative in-memory map of each widget's intended dimensions (`{ width, height }`), populated on creation and updated only during explicit resize sessions.
2. **Atomic `win.setBounds` Instead of `win.setPosition`:** During movement (`nextBounds.width === undefined`), `WidgetManager.setWidgetBounds` passes `{ x: targetX, y: targetY, width: size.width, height: size.height }` in a single atomic OS call. By explicitly supplying the cached dimensions, Windows DWM is prevented from round-off drifting.
3. **Chromium Zoom Lockdown (`disablePageZoom`):** `webContents.setZoomFactor(1)` and `webContents.setVisualZoomLevelLimits(1, 1)` are enforced on load and on `zoom-changed` events, preventing browser-level scaling.
4. **Native Non-Passive Wheel Interception:** A native `{ passive: false }` listener calls `e.preventDefault()` on `Ctrl + wheel` in the renderer, blocking browser page zoom before it reaches Chromium's gesture processor.
5. **Adaptive Corner Resize Threshold:** Resize handle activation is scaled via `Math.min(30, rect.width * 0.25)` so small stickers (down to 64px) retain their drag area without the corner handle consuming the entire widget body.
