import { create } from 'zustand';

export interface StickerItem {
  id: string;
  name: string;
  file_path: string;
  thumb_path: string;
  width: number;
  height: number;
  created_at: string;
}

export type StudioView = 'library' | 'editor';

interface StudioState {
  stickers: StickerItem[];
  serverBaseUrl: string;
  isLoaded: boolean;
  error: string | null;
  activeView: StudioView;
  pendingFile: File | null;
  setActiveView: (view: StudioView) => void;
  openEditorWithFile: (file: File | null) => void;
  fetchStickers: () => Promise<void>;
  saveSticker: (name: string, imageBase64: string) => Promise<StickerItem>;
  renameSticker: (stickerId: string, newName: string) => Promise<void>;
  duplicateSticker: (stickerId: string) => Promise<StickerItem>;
  pinStickerToDesktop: (stickerId: string) => Promise<void>;
  deleteSticker: (stickerId: string) => Promise<void>;
  disableAllClickThrough: () => Promise<void>;
}

export const useStudioStore = create<StudioState>((set) => ({
  stickers: [],
  serverBaseUrl: '',
  isLoaded: false,
  error: null,
  activeView: 'library',
  pendingFile: null,

  setActiveView: (view) => set({ activeView: view }),

  openEditorWithFile: (file) =>
    set({
      pendingFile: file,
      activeView: 'editor',
    }),

  fetchStickers: async () => {
    try {
      const config = await window.stickerdesk.getServerConfig();
      const response = await fetch(`${config.baseUrl}/stickers`, {
        headers: {
          'x-stickerdesk-token': config.token,
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as StickerItem[];
      set({
        stickers: data,
        serverBaseUrl: config.baseUrl,
        isLoaded: true,
        error: null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      set({ error: message, isLoaded: true });
    }
  },

  saveSticker: async (name: string, imageBase64: string): Promise<StickerItem> => {
    const config = await window.stickerdesk.getServerConfig();
    const response = await fetch(`${config.baseUrl}/stickers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-stickerdesk-token': config.token,
      },
      body: JSON.stringify({ name, imageBase64 }),
    });

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error ?? `Failed to save sticker (HTTP ${response.status})`);
    }

    const created = (await response.json()) as StickerItem;
    set((state) => ({
      stickers: [created, ...state.stickers],
      serverBaseUrl: config.baseUrl,
    }));
    return created;
  },

  renameSticker: async (stickerId: string, newName: string): Promise<void> => {
    const trimmed = newName.trim();
    if (!trimmed) {
      throw new Error('Sticker name cannot be empty');
    }

    const config = await window.stickerdesk.getServerConfig();
    const response = await fetch(
      `${config.baseUrl}/stickers/${encodeURIComponent(stickerId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-stickerdesk-token': config.token,
        },
        body: JSON.stringify({ name: trimmed }),
      }
    );

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error ?? `Failed to rename sticker (HTTP ${response.status})`);
    }

    const updated = (await response.json()) as StickerItem;
    set((state) => ({
      stickers: state.stickers.map((s) => (s.id === stickerId ? updated : s)),
    }));
  },

  duplicateSticker: async (stickerId: string): Promise<StickerItem> => {
    const config = await window.stickerdesk.getServerConfig();
    const response = await fetch(
      `${config.baseUrl}/stickers/${encodeURIComponent(stickerId)}/duplicate`,
      {
        method: 'POST',
        headers: {
          'x-stickerdesk-token': config.token,
        },
      }
    );

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error ?? `Failed to duplicate sticker (HTTP ${response.status})`);
    }

    const duplicated = (await response.json()) as StickerItem;
    set((state) => ({
      stickers: [duplicated, ...state.stickers],
      serverBaseUrl: config.baseUrl,
    }));
    return duplicated;
  },

  pinStickerToDesktop: async (stickerId: string): Promise<void> => {
    await window.stickerdesk.pinSticker(stickerId);
  },

  deleteSticker: async (stickerId: string): Promise<void> => {
    const config = await window.stickerdesk.getServerConfig();
    const response = await fetch(`${config.baseUrl}/stickers/${stickerId}`, {
      method: 'DELETE',
      headers: {
        'x-stickerdesk-token': config.token,
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to delete sticker (HTTP ${response.status})`);
    }
    set((state) => ({
      stickers: state.stickers.filter((s) => s.id !== stickerId),
    }));
  },

  disableAllClickThrough: async (): Promise<void> => {
    await window.stickerdesk.setAllClickThrough(false);
  },
}));
