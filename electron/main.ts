import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  globalShortcut,
  Menu,
  nativeImage,
  Tray,
} from 'electron';
import path from 'path';
import crypto from 'crypto';
import { initDb } from './server/db';
import { startLocalServer } from './server/index';
import { widgetManager, WidgetStatePayload } from './widgetManager';
import type { ServerConfig, WidgetBoundsInput } from './preload';

let studioWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverConfig: ServerConfig | null = null;

// 32x32 indigo/white sticker icon, kept inline so the tray works in dev and packaged builds.
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAjElEQVR42u3XQQoAIQgF0E7Xdu5/gM7R7EN0tK/9gYS2/UdRaGt/q2nUkdBUzLrp04e6YAhvMBSyE6xBysNDCHT4igiHI05GRWgBUsGvwhOOQHABvt49AiAirA2R4SEA6hVsAVL/hAu4gEqE+ycsB2QizL6gCsDbkFC0ZMebUoq2nGIwoRnNKIbTzHoBNFss5OuEKfsAAAAASUVORK5CYII=';

function showStudioWindow(): void {
  if (!studioWindow || studioWindow.isDestroyed()) {
    createStudioWindow();
    return;
  }
  if (studioWindow.isMinimized()) {
    studioWindow.restore();
  }
  studioWindow.show();
  studioWindow.focus();
}

function createTray(): void {
  if (tray) return;

  try {
    const icon = nativeImage
      .createFromDataURL(TRAY_ICON_DATA_URL)
      .resize({ width: 16, height: 16 });
    if (icon.isEmpty()) {
      throw new Error('Tray icon failed to decode');
    }
    tray = new Tray(icon);
    tray.setToolTip('StickerDesk');

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Studio', click: showStudioWindow },
        { type: 'separator' },
        {
          // Always-available escape hatch: click-through widgets ignore the mouse,
          // so this menu is the reliable way to turn click-through back off.
          label: 'Disable Click-Through on All Widgets',
          click: () => widgetManager.setAllClickThrough(false),
        },
        { type: 'separator' },
        { label: 'Quit StickerDesk', click: () => app.quit() },
      ])
    );

    tray.on('double-click', showStudioWindow);
  } catch (err: unknown) {
    // A tray failure must not prevent the rest of the app from starting; the
    // global hotkeys and Library button still provide click-through recovery.
    console.warn('[StickerDesk] Could not create tray icon:', err);
    tray = null;
  }
}

function createStudioWindow(): void {
  studioWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'StickerDesk Studio',
    backgroundColor: '#121212',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (process.env.NODE_ENV === 'development') {
    void studioWindow.loadURL('http://127.0.0.1:5173');
  } else {
    void studioWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  studioWindow.on('closed', () => {
    studioWindow = null;
  });
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  initDb(userDataPath);

  const launchToken = crypto.randomBytes(32).toString('hex');
  const { port } = await startLocalServer(launchToken);

  serverConfig = {
    port,
    token: launchToken,
    baseUrl: `http://127.0.0.1:${port}`,
  };

  console.log(`[StickerDesk] Local Express API listening at ${serverConfig.baseUrl}`);
  console.log(`[StickerDesk] Token: ${launchToken}`);

  ipcMain.handle('server:get-config', (): ServerConfig => {
    if (!serverConfig) {
      throw new Error('Server config requested before server initialized');
    }
    return serverConfig;
  });

  ipcMain.handle('widget:pin', (_event, stickerId: string): WidgetStatePayload => {
    return widgetManager.pinSticker(stickerId);
  });

  ipcMain.handle(
    'widget:get-state',
    (_event, widgetId: string): WidgetStatePayload | null => {
      return widgetManager.getWidgetPayload(widgetId);
    }
  );

  ipcMain.on(
    'widget:set-bounds',
    (_event, widgetId: string, bounds: WidgetBoundsInput) => {
      widgetManager.setWidgetBounds(widgetId, bounds);
    }
  );

  ipcMain.on('widget:context-menu', (_event, widgetId: string) => {
    widgetManager.showContextMenu(widgetId);
  });

  ipcMain.handle('widget:set-all-click-through', (_event, enabled: boolean) => {
    widgetManager.setAllClickThrough(enabled);
  });

  // Restore all active desktop widgets on app launch
  widgetManager.restoreActiveWidgets();

  // Re-clamp widgets whenever a monitor is disconnected or resolution changes
  screen.on('display-removed', () => {
    widgetManager.reclampAllWidgets();
  });
  screen.on('display-metrics-changed', () => {
    widgetManager.reclampAllWidgets();
  });

  // Global hotkeys to disable click-through on all widgets. Registering two
  // combinations means the escape hatch still works if another app already
  // owns the first one.
  const clickThroughRecovery = (): void => {
    widgetManager.setAllClickThrough(false);
  };
  const primaryRegistered = globalShortcut.register('CommandOrControl+Alt+C', clickThroughRecovery);
  const fallbackRegistered = globalShortcut.register(
    'CommandOrControl+Alt+Shift+C',
    clickThroughRecovery
  );
  if (!primaryRegistered) {
    console.warn(
      '[StickerDesk] Ctrl+Alt+C is already in use; use the tray menu to disable click-through.'
    );
  }
  if (!fallbackRegistered) {
    console.warn(
      '[StickerDesk] Ctrl+Alt+Shift+C is already in use; use the tray menu to disable click-through.'
    );
  }

  createStudioWindow();
  createTray();

  app.on('activate', () => {
    showStudioWindow();
  });
}).catch((err: unknown) => {
  console.error('[StickerDesk] Failed to initialize application:', err);
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
