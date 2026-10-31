import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
} from 'electron';
import path from 'path';
import crypto from 'crypto';
import { initDb } from './server/db';
import { startLocalServer } from './server/index';
import { widgetManager, WidgetStatePayload } from './widgetManager';
import type { ServerConfig, WidgetBoundsInput, ScreenPoint } from './preload';

let studioWindow: BrowserWindow | null = null;
let serverConfig: ServerConfig | null = null;
let appTray: Tray | null = null;

function createStudioWindow(): void {
  if (studioWindow && !studioWindow.isDestroyed()) {
    studioWindow.show();
    studioWindow.focus();
    return;
  }

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

function setupSystemTray(): void {
  // Generate a clean 16x16 indigo icon buffer so Tray always works without external icon assets
  const size = 16;
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = 79;     // R
    rgba[i * 4 + 1] = 70; // G
    rgba[i * 4 + 2] = 229;// B
    rgba[i * 4 + 3] = 255;// A
  }
  const icon = nativeImage.createFromBitmap(rgba, { width: size, height: size });
  appTray = new Tray(icon);
  appTray.setToolTip('StickerDesk');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open StickerDesk Studio',
      click: () => createStudioWindow(),
    },
    { type: 'separator' },
    {
      label: 'Disable Click-Through on All Widgets (Ctrl+Alt+C)',
      click: () => widgetManager.setAllClickThrough(false),
    },
    {
      label: 'Toggle Click-Through on All Widgets (Ctrl+Alt+Shift+C)',
      click: () => widgetManager.toggleAllClickThrough(),
    },
    { type: 'separator' },
    {
      label: 'Quit StickerDesk',
      click: () => app.quit(),
    },
  ]);

  appTray.setContextMenu(contextMenu);
  appTray.on('double-click', () => createStudioWindow());
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

  ipcMain.handle('screen:get-cursor', (): ScreenPoint => {
    return screen.getCursorScreenPoint();
  });

  setupSystemTray();
  widgetManager.restoreActiveWidgets();

  screen.on('display-removed', () => {
    widgetManager.reclampAllWidgets();
  });
  screen.on('display-metrics-changed', () => {
    widgetManager.reclampAllWidgets();
  });

  // Global hotkeys to guarantee click-through mode is never a trap
  globalShortcut.register('CommandOrControl+Alt+C', () => {
    widgetManager.setAllClickThrough(false);
  });
  globalShortcut.register('CommandOrControl+Alt+Shift+C', () => {
    widgetManager.toggleAllClickThrough();
  });

  createStudioWindow();

  app.on('activate', () => {
    createStudioWindow();
  });
}).catch((err: unknown) => {
  console.error('[StickerDesk] Failed to initialize application:', err);
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (appTray) {
    appTray.destroy();
    appTray = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
