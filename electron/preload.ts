import { contextBridge, ipcRenderer } from 'electron';
import type { WidgetStatePayload } from './widgetManager';

export interface ServerConfig {
  port: number;
  token: string;
  baseUrl: string;
}

export interface WidgetBoundsInput {
  x?: number;
  y?: number;
  width?: number;
}

export interface StickerDeskAPI {
  getServerConfig: () => Promise<ServerConfig>;
  pinSticker: (stickerId: string) => Promise<WidgetStatePayload>;
  getWidgetState: (widgetId: string) => Promise<WidgetStatePayload | null>;
  setWidgetBounds: (widgetId: string, bounds: WidgetBoundsInput) => void;
  showWidgetContextMenu: (widgetId: string) => void;
  setAllClickThrough: (enabled: boolean) => Promise<void>;
  onWidgetStateUpdated: (callback: (state: WidgetStatePayload) => void) => () => void;
}

const api: StickerDeskAPI = {
  getServerConfig: (): Promise<ServerConfig> => ipcRenderer.invoke('server:get-config'),
  pinSticker: (stickerId: string): Promise<WidgetStatePayload> =>
    ipcRenderer.invoke('widget:pin', stickerId),
  getWidgetState: (widgetId: string): Promise<WidgetStatePayload | null> =>
    ipcRenderer.invoke('widget:get-state', widgetId),
  setWidgetBounds: (widgetId: string, bounds: WidgetBoundsInput): void => {
    ipcRenderer.send('widget:set-bounds', widgetId, bounds);
  },
  showWidgetContextMenu: (widgetId: string): void => {
    ipcRenderer.send('widget:context-menu', widgetId);
  },
  setAllClickThrough: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('widget:set-all-click-through', enabled),
  onWidgetStateUpdated: (callback: (state: WidgetStatePayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: WidgetStatePayload) => {
      callback(state);
    };
    ipcRenderer.on('widget:state-updated', listener);
    return () => {
      ipcRenderer.removeListener('widget:state-updated', listener);
    };
  },
};

contextBridge.exposeInMainWorld('stickerdesk', api);
