# Architectural Decisions

## Phase 0
1. **Per-launch API Token & Verification**: The Express server generates a random 32-byte hex token on startup and binds to `127.0.0.1:0` (OS-assigned free port). The renderer retrieves `{ port, token, baseUrl }` via `window.stickerdesk.getServerConfig()`. To allow direct terminal/browser verification of `GET /stickers` during Phase 0 testing while keeping mutating routes protected, `GET` requests without the header are permitted on `127.0.0.1`, whereas any mutating request (`POST`, `PATCH`, `PUT`, `DELETE`) or any request supplying an invalid `x-stickerdesk-token` header is rejected with `401 Unauthorized`.
2. **Dual TypeScript Config (`tsconfig.json` + `tsconfig.node.json`)**: Vite bundles the React renderer (`src/`), while `tsc -p tsconfig.node.json` compiles `electron/` to CommonJS in `dist-electron/` so Electron and native `better-sqlite3` bindings load without ESM/CJS interop conflicts.
