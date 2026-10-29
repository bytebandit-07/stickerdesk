import { BrowserWindow, Menu, MenuItemConstructorOptions, screen } from 'electron';
import path from 'path';
import crypto from 'crypto';
import { getDb } from './server/db';

export type IdleAnimation = 'none' | 'float' | 'sway';

export interface WidgetSettings {
  animation: IdleAnimation;
}

export interface WidgetRow {
  id: string;
  sticker_id: string;
  mode: '2d' | '3d';
  x: number;
  y: number;
  width: number;
  height: number;
  monitor_id: string;
  opacity: number;
  locked: number;
  click_through: number;
  always_on_top: number;
  settings_json: string;
  active: number;
}

export interface WidgetStatePayload {
  id: string;
  stickerId: string;
  stickerFilePath: string;
  mode: '2d' | '3d';
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number;
  opacity: number;
  locked: boolean;
  clickThrough: boolean;
  alwaysOnTop: boolean;
  settings: WidgetSettings;
}

export interface WidgetUpdateOptions {
  mode?: '2d' | '3d';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  locked?: boolean;
  clickThrough?: boolean;
  alwaysOnTop?: boolean;
  settings?: Partial<WidgetSettings>;
  active?: boolean;
}

interface StickerDimensionsRow {
  id: string;
  file_path: string;
  width: number;
  height: number;
}

const MIN_WIDGET_SIZE = 64;
const MAX_WIDGET_SIZE = 1200;

export class WidgetManager {
  private readonly windows: Map<string, BrowserWindow> = new Map();
  private readonly aspectRatios: Map<string, number> = new Map();
  private readonly saveBoundsTimers: Map<string, NodeJS.Timeout> = new Map();

  private parseSettings(jsonStr: string): WidgetSettings {
    try {
      const parsed = JSON.parse(jsonStr) as Partial<WidgetSettings>;
      const anim = parsed.animation;
      if (anim === 'float' || anim === 'sway' || anim === 'none') {
        return { animation: anim };
      }
    } catch {
      // Fallback to default settings
    }
    return { animation: 'none' };
  }

  /**
   * Clamps widget coordinates so the widget remains visible on an active monitor,
   * even if a secondary monitor was unplugged since last launch.
   */
  private clampToVisibleDisplays(
    x: number,
    y: number,
    width: number,
    height: number
  ): { x: number; y: number; monitorId: string } {
    const displays = screen.getAllDisplays();
    const centerPoint = {
      x: Math.round(x + width / 2),
      y: Math.round(y + height / 2),
    };

    const targetDisplay =
      displays.find((d) => {
        const b = d.bounds;
        return (
          centerPoint.x >= b.x &&
          centerPoint.x <= b.x + b.width &&
          centerPoint.y >= b.y &&
          centerPoint.y <= b.y + b.height
        );
      }) ?? screen.getPrimaryDisplay();

    const area = targetDisplay.workArea;
    const clampedX = Math.max(
      area.x,
      Math.min(x, area.x + Math.max(0, area.width - width))
    );
    const clampedY = Math.max(
      area.y,
      Math.min(y, area.y + Math.max(0, area.height - height))
    );

    return {
      x: Math.round(clampedX),
      y: Math.round(clampedY),
      monitorId: String(targetDisplay.id),
    };
  }

  public getWidgetPayload(widgetId: string): WidgetStatePayload | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM widgets WHERE id = ?')
      .get(widgetId) as WidgetRow | undefined;
    if (!row) return null;

    const sticker = db
      .prepare('SELECT id, file_path, width, height FROM stickers WHERE id = ?')
      .get(row.sticker_id) as StickerDimensionsRow | undefined;
    if (!sticker) return null;

    const aspectRatio = sticker.width / Math.max(1, sticker.height);
    this.aspectRatios.set(widgetId, aspectRatio);

    return {
      id: row.id,
      stickerId: row.sticker_id,
      stickerFilePath: sticker.file_path,
      mode: row.mode,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      aspectRatio,
      opacity: row.opacity,
      locked: Boolean(row.locked),
      clickThrough: Boolean(row.click_through),
      alwaysOnTop: Boolean(row.always_on_top),
      settings: this.parseSettings(row.settings_json),
    };
  }

  /**
   * Creates a new widget row in SQLite for `stickerId` and spawns its BrowserWindow.
   */
  public pinSticker(stickerId: string): WidgetStatePayload {
    const db = getDb();
    const sticker = db
      .prepare('SELECT id, file_path, width, height FROM stickers WHERE id = ?')
      .get(stickerId) as StickerDimensionsRow | undefined;

    if (!sticker) {
      throw new Error(`Sticker ${stickerId} not found`);
    }

    const aspect = sticker.width / Math.max(1, sticker.height);
    const baseSize = 220;
    const initWidth = aspect >= 1 ? baseSize : Math.max(MIN_WIDGET_SIZE, Math.round(baseSize * aspect));
    const initHeight = aspect < 1 ? baseSize : Math.max(MIN_WIDGET_SIZE, Math.round(baseSize / aspect));

    const primary = screen.getPrimaryDisplay();
    const workArea = primary.workArea;
    // Slight random offset so multiple pinned stickers don't stack identically
    const offset = (this.windows.size % 6) * 28;
    const rawX = Math.round(workArea.x + (workArea.width - initWidth) / 2 + offset);
    const rawY = Math.round(workArea.y + (workArea.height - initHeight) / 2 + offset);

    const { x, y, monitorId } = this.clampToVisibleDisplays(rawX, rawY, initWidth, initHeight);
    const widgetId = crypto.randomUUID();
    const defaultSettings: WidgetSettings = { animation: 'none' };

    db.prepare(
      `INSERT INTO widgets (
        id, sticker_id, mode, x, y, width, height, monitor_id,
        opacity, locked, click_through, always_on_top, settings_json, active
      ) VALUES (?, ?, '2d', ?, ?, ?, ?, ?, 1.0, 0, 0, 0, ?, 1)`
    ).run(widgetId, stickerId, x, y, initWidth, initHeight, monitorId, JSON.stringify(defaultSettings));

    this.createWidget(widgetId);
    const payload = this.getWidgetPayload(widgetId);
    if (!payload) {
      throw new Error('Failed to load newly created widget payload');
    }
    return payload;
  }

  /**
   * Spawns the transparent frameless desktop BrowserWindow for an existing widget row.
   */
  public createWidget(widgetId: string): void {
    const existing = this.windows.get(widgetId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return;
    }

    const payload = this.getWidgetPayload(widgetId);
    if (!payload) return;

    const clamped = this.clampToVisibleDisplays(
      payload.x,
      payload.y,
      payload.width,
      payload.height
    );

    if (clamped.x !== payload.x || clamped.y !== payload.y) {
      getDb()
        .prepare('UPDATE widgets SET x = ?, y = ?, monitor_id = ? WHERE id = ?')
        .run(clamped.x, clamped.y, clamped.monitorId, widgetId);
      payload.x = clamped.x;
      payload.y = clamped.y;
    }

    const win = new BrowserWindow({
      x: payload.x,
      y: payload.y,
      width: payload.width,
      height: payload.height,
      transparent: true,
      frame: false,
      alwaysOnTop: payload.alwaysOnTop,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    win.setAlwaysOnTop(payload.alwaysOnTop);
    if (payload.clickThrough) {
      win.setIgnoreMouseEvents(true, { forward: true });
    }

    const query = `?widgetId=${encodeURIComponent(widgetId)}`;
    if (process.env.NODE_ENV === 'development') {
      void win.loadURL(`http://127.0.0.1:5173/widget.html${query}`);
    } else {
      void win.loadFile(path.join(__dirname, '../dist/widget.html'), {
        search: query,
      });
    }

    win.on('closed', () => {
      this.windows.delete(widgetId);
      this.aspectRatios.delete(widgetId);
    });

    this.windows.set(widgetId, win);
  }

  /**
   * Restores all active widgets from SQLite on app launch and clamps when displays change.
   */
  public restoreActiveWidgets(): void {
    const db = getDb();
    const activeRows = db
      .prepare('SELECT id FROM widgets WHERE active = 1')
      .all() as Array<{ id: string }>;

    for (const row of activeRows) {
      this.createWidget(row.id);
    }
  }

  public reclampAllWidgets(): void {
    for (const [widgetId, win] of this.windows.entries()) {
      if (win.isDestroyed()) continue;
      const bounds = win.getBounds();
      const clamped = this.clampToVisibleDisplays(
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height
      );
      if (clamped.x !== bounds.x || clamped.y !== bounds.y) {
        win.setBounds({
          x: clamped.x,
          y: clamped.y,
          width: bounds.width,
          height: bounds.height,
        });
        getDb()
          .prepare('UPDATE widgets SET x = ?, y = ?, monitor_id = ? WHERE id = ?')
          .run(clamped.x, clamped.y, clamped.monitorId, widgetId);
      }
    }
  }

  /**
   * Moves and/or resizes a widget while strictly preserving its sticker aspect ratio.
   */
  public setWidgetBounds(
    widgetId: string,
    nextBounds: { x?: number; y?: number; width?: number }
  ): void {
    const win = this.windows.get(widgetId);
    if (!win || win.isDestroyed()) return;

    if (nextBounds.width !== undefined) {
      const current = win.getBounds();
      const aspect = this.aspectRatios.get(widgetId) ?? (current.width / Math.max(1, current.height));
      const targetWidth = Math.max(MIN_WIDGET_SIZE, Math.min(MAX_WIDGET_SIZE, Math.round(nextBounds.width)));
      const targetHeight = Math.max(MIN_WIDGET_SIZE, Math.round(targetWidth / aspect));
      if (nextBounds.x !== undefined && nextBounds.y !== undefined) {
        win.setBounds({
          x: Math.round(nextBounds.x),
          y: Math.round(nextBounds.y),
          width: targetWidth,
          height: targetHeight,
        });
      } else {
        win.setBounds({
          x: current.x,
          y: current.y,
          width: targetWidth,
          height: targetHeight,
        });
      }
    } else if (nextBounds.x !== undefined && nextBounds.y !== undefined) {
      // ONLY MOVE - NEVER TOUCH SIZE during drag
      win.setPosition(Math.round(nextBounds.x), Math.round(nextBounds.y));
    }

    // Debounce SQLite write so fast mousemove doesn't thrash disk
    const existingTimer = this.saveBoundsTimers.get(widgetId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      this.saveBoundsTimers.delete(widgetId);
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      const display = screen.getDisplayMatching(b);
      getDb()
        .prepare(
          'UPDATE widgets SET x = ?, y = ?, width = ?, height = ?, monitor_id = ? WHERE id = ?'
        )
        .run(b.x, b.y, b.width, b.height, String(display.id), widgetId);
    }, 200);
    this.saveBoundsTimers.set(widgetId, timer);
  }

  public updateWidget(widgetId: string, options: WidgetUpdateOptions): WidgetStatePayload | null {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM widgets WHERE id = ?')
      .get(widgetId) as WidgetRow | undefined;
    if (!existing) return null;

    const currentSettings = this.parseSettings(existing.settings_json);
    const mergedSettings: WidgetSettings = {
      ...currentSettings,
      ...(options.settings ?? {}),
    };

    const nextMode = options.mode ?? existing.mode;
    const nextX = options.x !== undefined ? Math.round(options.x) : existing.x;
    const nextY = options.y !== undefined ? Math.round(options.y) : existing.y;
    const nextWidth = options.width !== undefined ? Math.round(options.width) : existing.width;
    const nextHeight = options.height !== undefined ? Math.round(options.height) : existing.height;
    const nextOpacity =
      options.opacity !== undefined
        ? Math.max(0.1, Math.min(1.0, options.opacity))
        : existing.opacity;
    const nextLocked =
      options.locked !== undefined ? (options.locked ? 1 : 0) : existing.locked;
    const nextClickThrough =
      options.clickThrough !== undefined
        ? options.clickThrough
          ? 1
          : 0
        : existing.click_through;
    const nextAlwaysOnTop =
      options.alwaysOnTop !== undefined
        ? options.alwaysOnTop
          ? 1
          : 0
        : existing.always_on_top;
    const nextActive =
      options.active !== undefined ? (options.active ? 1 : 0) : existing.active;

    db.prepare(
      `UPDATE widgets
       SET mode = ?, x = ?, y = ?, width = ?, height = ?,
           opacity = ?, locked = ?, click_through = ?, always_on_top = ?,
           settings_json = ?, active = ?
       WHERE id = ?`
    ).run(
      nextMode,
      nextX,
      nextY,
      nextWidth,
      nextHeight,
      nextOpacity,
      nextLocked,
      nextClickThrough,
      nextAlwaysOnTop,
      JSON.stringify(mergedSettings),
      nextActive,
      widgetId
    );

    const updatedPayload = this.getWidgetPayload(widgetId);
    const win = this.windows.get(widgetId);

    if (nextActive === 0) {
      if (win && !win.isDestroyed()) {
        win.close();
      }
      this.windows.delete(widgetId);
      return updatedPayload;
    }

    if (win && !win.isDestroyed() && updatedPayload) {
      if (options.x !== undefined || options.y !== undefined || options.width !== undefined) {
        this.setWidgetBounds(widgetId, {
          x: options.x,
          y: options.y,
          width: options.width,
        });
      }
      win.setAlwaysOnTop(updatedPayload.alwaysOnTop);
      win.setIgnoreMouseEvents(updatedPayload.clickThrough, { forward: true });
      win.webContents.send('widget:state-updated', updatedPayload);
    }

    return updatedPayload;
  }

  public setAllClickThrough(enabled: boolean): void {
    const db = getDb();
    db.prepare('UPDATE widgets SET click_through = ? WHERE active = 1').run(enabled ? 1 : 0);
    for (const [widgetId, win] of this.windows.entries()) {
      if (win.isDestroyed()) continue;
      win.setIgnoreMouseEvents(enabled, { forward: true });
      const payload = this.getWidgetPayload(widgetId);
      if (payload) {
        win.webContents.send('widget:state-updated', payload);
      }
    }
  }

  public removeWidget(widgetId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM widgets WHERE id = ?').run(widgetId);
    this.closeWidget(widgetId);
  }

  public closeWidget(widgetId: string): void {
    const win = this.windows.get(widgetId);
    if (win && !win.isDestroyed()) {
      win.close();
    }
    this.windows.delete(widgetId);
    this.aspectRatios.delete(widgetId);
  }

  /**
   * Displays the native right-click context menu for a widget window.
   */
  public showContextMenu(widgetId: string): void {
    const win = this.windows.get(widgetId);
    const payload = this.getWidgetPayload(widgetId);
    if (!win || win.isDestroyed() || !payload) return;

    const opacityLevels = [
      { label: '100%', value: 1.0 },
      { label: '85%', value: 0.85 },
      { label: '70%', value: 0.7 },
      { label: '50%', value: 0.5 },
      { label: '30%', value: 0.3 },
    ];

    const animationOptions: Array<{ label: string; value: IdleAnimation }> = [
      { label: 'None', value: 'none' },
      { label: 'Float', value: 'float' },
      { label: 'Gentle Sway', value: 'sway' },
    ];

    const template: MenuItemConstructorOptions[] = [
      {
        label: 'Opacity',
        submenu: opacityLevels.map((lvl) => ({
          label: lvl.label,
          type: 'radio',
          checked: Math.abs(payload.opacity - lvl.value) < 0.05,
          click: () => {
            this.updateWidget(widgetId, { opacity: lvl.value });
          },
        })),
      },
      {
        label: 'Idle Animation',
        submenu: animationOptions.map((anim) => ({
          label: anim.label,
          type: 'radio',
          checked: payload.settings.animation === anim.value,
          click: () => {
            this.updateWidget(widgetId, { settings: { animation: anim.value } });
          },
        })),
      },
      { type: 'separator' },
      {
        label: 'Lock Position',
        type: 'checkbox',
        checked: payload.locked,
        click: () => {
          this.updateWidget(widgetId, { locked: !payload.locked });
        },
      },
      {
        label: 'Always On Top (Float Over Other Apps)',
        type: 'checkbox',
        checked: payload.alwaysOnTop,
        click: () => {
          this.updateWidget(widgetId, { alwaysOnTop: !payload.alwaysOnTop });
        },
      },
      {
        label: 'Click-Through Mode',
        type: 'checkbox',
        checked: payload.clickThrough,
        click: () => {
          this.updateWidget(widgetId, { clickThrough: !payload.clickThrough });
        },
      },
      { type: 'separator' },
      {
        label: payload.mode === '2d' ? 'Switch to 3D (Phase 3)' : 'Switch to 2D',
        enabled: false, // Phase 3 stub per plan
      },
      { type: 'separator' },
      {
        label: 'Remove Widget',
        click: () => {
          this.removeWidget(widgetId);
        },
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  }
}

export const widgetManager = new WidgetManager();
