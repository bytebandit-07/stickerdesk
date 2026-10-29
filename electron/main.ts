import { app, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron';
import path from 'path';
import crypto from 'crypto';
import { initDb } from './server/db';
import { startLocalServer } from './server/index';
import { widgetManager, WidgetStatePayload } from './widgetManager';
import type { ServerConfig, WidgetBoundsInput } from './preload';

let studioWindow: BrowserWindow | null = null;
let serverConfig: ServerConfig | null = null;

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

  // Global hotkey (Ctrl+Alt+C) to disable click-through on all widgets
  globalShortcut.register('CommandOrControl+Alt+C', () => {
    widgetManager.setAllClickThrough(false);
  });

  createStudioWindow();

  app.on('activate', () => {
    if (!studioWindow || studioWindow.isDestroyed()) {
      createStudioWindow();
    }
  });
}).catch((err: unknown) => {
  console.error('[StickerDesk] Failed to initialize application:', err);
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
