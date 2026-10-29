import type { StickerDeskAPI } from '../electron/preload';

declare global {
  interface Window {
    stickerdesk: StickerDeskAPI;
  }
}

export {};
