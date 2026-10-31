import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useStudioStore } from '../../store/useStudioStore';
import type { Sticker3DTheme, TiltMode, IdleAnimation } from '../../../electron/widgetManager';
import type { PokemonCardData } from '../../types/pokemon';
import { PokemonCard } from '../../components/pokemon/PokemonCard';
import rawPokemonCards from '../../data/pokemonCards.json';

const pokemonCardsList = rawPokemonCards as PokemonCardData[];

interface ParsedWidgetSettings {
  animation: IdleAnimation;
  theme: Sticker3DTheme;
  tiltMode: TiltMode;
  shadowEnabled: boolean;
}

interface ActiveWidgetRow {
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

function parseWidgetSettingsSafe(jsonStr: string): ParsedWidgetSettings {
  const defaults: ParsedWidgetSettings = {
    animation: 'none',
    theme: 'vinyl',
    tiltMode: 'subtle',
    shadowEnabled: true,
  };
  try {
    const parsed = JSON.parse(jsonStr) as Partial<ParsedWidgetSettings>;
    return {
      animation:
        parsed.animation === 'float' ||
        parsed.animation === 'spin' ||
        parsed.animation === 'sway' ||
        parsed.animation === 'none'
          ? parsed.animation
          : defaults.animation,
      theme:
        parsed.theme === 'vinyl' ||
        parsed.theme === 'holographic' ||
        parsed.theme === 'epoxy' ||
        parsed.theme === 'enamel'
          ? parsed.theme
          : defaults.theme,
      tiltMode:
        parsed.tiltMode === 'none' ||
        parsed.tiltMode === 'subtle' ||
        parsed.tiltMode === 'dynamic'
          ? parsed.tiltMode
          : defaults.tiltMode,
      shadowEnabled:
        typeof parsed.shadowEnabled === 'boolean'
          ? parsed.shadowEnabled
          : defaults.shadowEnabled,
    };
  } catch {
    return defaults;
  }
}

async function cardImageToBase64(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load card image (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to convert card image blob to base64'));
        }
      };
      reader.onerror = () => reject(new Error('FileReader error while reading card blob'));
      reader.readAsDataURL(blob);
    });
  } catch (fetchErr) {
    // Fallback to Image element if fetch is blocked
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to create 2D canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () =>
        reject(new Error(fetchErr instanceof Error ? fetchErr.message : 'Failed to load card image'));
      img.src = url;
    });
  }
}

export const Library: React.FC = () => {
  const {
    stickers,
    serverBaseUrl,
    isLoaded,
    error,
    fetchStickers,
    openEditorWithFile,
    setActiveView,
    pinStickerToDesktop,
    disableAllClickThrough,
  } = useStudioStore();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<'stickers' | 'pokemon'>('stickers');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [activeWidgets, setActiveWidgets] = useState<ActiveWidgetRow[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  // Pokemon Vault filter and search
  const [pokemonSearch, setPokemonSearch] = useState<string>('');
  const [pokemonFilter, setPokemonFilter] = useState<string>('all');
  const [pinningCardId, setPinningCardId] = useState<string | null>(null);

  const fetchActiveWidgets = useCallback(async () => {
    try {
      const config = await window.stickerdesk.getServerConfig();
      const res = await fetch(`${config.baseUrl}/widgets`, {
        headers: {
          'x-stickerdesk-token': config.token,
        },
      });
      if (!res.ok) return;
      const rows = (await res.json()) as ActiveWidgetRow[];
      setActiveWidgets(rows.filter((w) => w.active === 1));
    } catch {
      // Ignore background poll errors
    }
  }, []);

  useEffect(() => {
    void fetchStickers();
    void fetchActiveWidgets();

    const interval = window.setInterval(() => {
      void fetchActiveWidgets();
    }, 2500);

    return () => window.clearInterval(interval);
  }, [fetchStickers, fetchActiveWidgets]);

  const handleFileSelected = (file: File | undefined): void => {
    if (!file) return;
    openEditorWithFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      openEditorWithFile(file);
    }
  };

  const handlePinSticker = async (stickerId: string): Promise<void> => {
    setLocalError(null);
    try {
      await pinStickerToDesktop(stickerId);
      await fetchActiveWidgets();
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Failed to pin sticker');
    }
  };

  const deleteSticker = async (stickerId: string): Promise<void> => {
    setLocalError(null);
    try {
      const config = await window.stickerdesk.getServerConfig();
      const res = await fetch(`${config.baseUrl}/stickers/${encodeURIComponent(stickerId)}`, {
        method: 'DELETE',
        headers: {
          'x-stickerdesk-token': config.token,
        },
      });
      if (!res.ok) {
        throw new Error(`Failed to delete sticker (HTTP ${res.status})`);
      }
      setConfirmDeleteId(null);
      await Promise.all([fetchStickers(), fetchActiveWidgets()]);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Failed to delete sticker');
    }
  };

  const patchWidget = async (
    widgetId: string,
    payload: Record<string, unknown>
  ): Promise<void> => {
    setLocalError(null);
    try {
      const config = await window.stickerdesk.getServerConfig();
      const res = await fetch(`${config.baseUrl}/widgets/${encodeURIComponent(widgetId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-stickerdesk-token': config.token,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Failed to update widget (HTTP ${res.status})`);
      }
      await fetchActiveWidgets();
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Failed to update widget');
    }
  };

  const handleToggleWidgetMode = async (widget: ActiveWidgetRow): Promise<void> => {
    const nextMode = widget.mode === '2d' ? '3d' : '2d';
    await patchWidget(widget.id, { mode: nextMode });
  };

  const handleChangeWidgetTheme = async (
    widget: ActiveWidgetRow,
    theme: Sticker3DTheme
  ): Promise<void> => {
    await patchWidget(widget.id, { settings: { theme } });
  };

  const handleCycleWidgetTilt = async (
    widget: ActiveWidgetRow,
    currentTilt: TiltMode
  ): Promise<void> => {
    const order: TiltMode[] = ['none', 'subtle', 'dynamic'];
    const nextTilt = order[(order.indexOf(currentTilt) + 1) % order.length];
    await patchWidget(widget.id, { settings: { tiltMode: nextTilt } });
  };

  const handleToggleWidgetAlwaysOnTop = async (widget: ActiveWidgetRow): Promise<void> => {
    await patchWidget(widget.id, { always_on_top: widget.always_on_top === 0 });
  };

  const handleToggleWidgetClickThrough = async (widget: ActiveWidgetRow): Promise<void> => {
    await patchWidget(widget.id, { click_through: widget.click_through === 0 });
  };

  const handleToggleWidgetLock = async (widget: ActiveWidgetRow): Promise<void> => {
    await patchWidget(widget.id, { locked: widget.locked === 0 });
  };

  const handleCloseWidget = async (widgetId: string): Promise<void> => {
    setLocalError(null);
    try {
      const config = await window.stickerdesk.getServerConfig();
      const res = await fetch(`${config.baseUrl}/widgets/${encodeURIComponent(widgetId)}`, {
        method: 'DELETE',
        headers: {
          'x-stickerdesk-token': config.token,
        },
      });
      if (!res.ok) {
        throw new Error(`Failed to close widget (HTTP ${res.status})`);
      }
      await fetchActiveWidgets();
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Failed to close widget');
    }
  };

  const handleDisableAllClickThrough = async (): Promise<void> => {
    await disableAllClickThrough();
    await fetchActiveWidgets();
  };

  const handlePinPokemonCard = async (card: PokemonCardData): Promise<void> => {
    setLocalError(null);
    setLocalSuccess(null);
    setPinningCardId(card.id);

    try {
      const config = await window.stickerdesk.getServerConfig();
      const imgUrl = card.images.small || card.images.large || `/img/pokemon/cards/${card.id}.png`;
      const base64 = await cardImageToBase64(imgUrl);

      // 1. Save sticker in library
      const createRes = await fetch(`${config.baseUrl}/stickers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-stickerdesk-token': config.token,
        },
        body: JSON.stringify({
          name: `${card.name} (${card.rarity || 'Holo'})`,
          imageBase64: base64,
        }),
      });

      if (!createRes.ok) {
        throw new Error(`Failed to create sticker for ${card.name}`);
      }

      const created = (await createRes.json()) as { id: string };

      // 2. Pin to desktop directly via window.stickerdesk API
      const pinned = await window.stickerdesk.pinSticker(created.id);

      // 3. Set widget to 3D mode with Holographic Foil theme and Dynamic tilt
      await fetch(`${config.baseUrl}/widgets/${encodeURIComponent(pinned.id)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-stickerdesk-token': config.token,
        },
        body: JSON.stringify({
          mode: '3d',
          settings: {
            theme: 'holographic',
            tiltMode: 'dynamic',
            shadowEnabled: true,
          },
        }),
      });

      setLocalSuccess(`✨ ${card.name} pinned to desktop in 3D Holographic Foil!`);
      await Promise.all([fetchStickers(), fetchActiveWidgets()]);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Failed to pin Pokemon card');
    } finally {
      setPinningCardId(null);
    }
  };

  const filteredPokemon = useMemo(() => {
    const q = pokemonSearch.trim().toLowerCase();
    return pokemonCardsList.filter((c) => {
      const matchesSearch =
        q === '' ||
        c.name.toLowerCase().includes(q) ||
        c.number.includes(q) ||
        (c.subtypes || []).some((s) => s.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      if (pokemonFilter === 'all') return true;
      const rarity = (c.rarity || '').toLowerCase();
      const subtypes = (c.subtypes || []).map((s) => s.toLowerCase());

      if (pokemonFilter === 'secret') {
        return rarity.includes('secret') || rarity.includes('rainbow');
      }
      if (pokemonFilter === 'vmax') {
        return subtypes.includes('vmax') || subtypes.includes('vstar');
      }
      if (pokemonFilter === 'radiant') {
        return subtypes.includes('radiant');
      }
      if (pokemonFilter === 'trainer') {
        return rarity.includes('trainer gallery');
      }
      if (pokemonFilter === 'amazing') {
        return rarity.includes('amazing');
      }

      return true;
    });
  }, [pokemonSearch, pokemonFilter]);

  return (
    <main
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      style={{
        padding: '24px',
        minHeight: '100vh',
        boxSizing: 'border-box',
        outline: isDragging ? '3px dashed #4f46e5' : 'none',
        outlineOffset: '-12px',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Library</h1>
          <div
            style={{
              display: 'flex',
              backgroundColor: '#1f1f1f',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid #333',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('stickers')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: activeTab === 'stickers' ? '#4f46e5' : 'transparent',
                color: activeTab === 'stickers' ? '#fff' : '#aaa',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              🖼️ My Stickers ({stickers.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('pokemon')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: activeTab === 'pokemon' ? '#ec4899' : 'transparent',
                color: activeTab === 'pokemon' ? '#fff' : '#aaa',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              ✨ Pokémon Holo Vault ({pokemonCardsList.length})
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              handleFileSelected(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => void handleDisableAllClickThrough()}
            title="Shortcut: Ctrl+Alt+C"
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #3a3a3a',
              backgroundColor: '#1f1f1f',
              color: '#bbb',
              cursor: 'pointer',
              fontSize: '0.82rem',
            }}
          >
            Un-Click-Through All (Ctrl+Alt+C)
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#4f46e5',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.88rem',
            }}
          >
            + Import / New Sticker
          </button>
          <button
            type="button"
            onClick={() => setActiveView('editor')}
            style={{
              padding: '8px 14px',
              borderRadius: '6px',
              border: '1px solid #3a3a3a',
              backgroundColor: '#1f1f1f',
              color: '#ddd',
              cursor: 'pointer',
              fontSize: '0.88rem',
            }}
          >
            Open Editor
          </button>
        </div>
      </div>

      {/* Active Desktop Widgets Management Bar */}
      <section
        style={{
          marginBottom: '24px',
          padding: '14px 16px',
          backgroundColor: '#181818',
          border: '1px solid #2c2c2c',
          borderRadius: '10px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: activeWidgets.length > 0 ? '12px' : 0,
          }}
        >
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e5e7eb' }}>
            Active Desktop Widgets ({activeWidgets.length})
          </span>
          {activeWidgets.length === 0 && (
            <span style={{ fontSize: '0.8rem', color: '#777' }}>
              No widgets currently pinned on the desktop
            </span>
          )}
        </div>

        {activeWidgets.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {activeWidgets.map((w) => {
              const parentSticker = stickers.find((s) => s.id === w.sticker_id);
              const isAlwaysOnTop = w.always_on_top === 1;
              const isClickThrough = w.click_through === 1;
              const isLocked = w.locked === 1;
              const is3D = w.mode === '3d';
              const settings = parseWidgetSettingsSafe(w.settings_json);

              const tiltLabel =
                settings.tiltMode === 'none'
                  ? 'Still'
                  : settings.tiltMode === 'subtle'
                  ? 'Subtle 5°'
                  : 'Dynamic 15°';

              return (
                <div
                  key={w.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                    padding: '6px 10px',
                    backgroundColor: '#222222',
                    border: '1px solid #383838',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                  }}
                >
                  {parentSticker && serverBaseUrl && (
                    <img
                      src={`${serverBaseUrl}/files/stickers/${parentSticker.thumb_path}`}
                      alt={parentSticker.name}
                      style={{
                        width: '28px',
                        height: '28px',
                        objectFit: 'contain',
                        borderRadius: '4px',
                        backgroundColor: '#141414',
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontWeight: 600,
                      color: '#f3f4f6',
                      maxWidth: '100px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {parentSticker?.name ?? 'Sticker'}
                  </span>

                  <button
                    type="button"
                    onClick={() => void handleToggleWidgetMode(w)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '5px',
                      border: '1px solid #444',
                      backgroundColor: is3D ? '#ec4899' : '#2d2d2d',
                      color: is3D ? '#fff' : '#ccc',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                    }}
                  >
                    Mode: {w.mode.toUpperCase()}
                  </button>

                  {is3D && (
                    <>
                      <select
                        value={settings.theme}
                        onChange={(e) =>
                          void handleChangeWidgetTheme(
                            w,
                            e.target.value as Sticker3DTheme
                          )
                        }
                        title="3D Sticker Theme"
                        style={{
                          padding: '3px 6px',
                          borderRadius: '5px',
                          border: '1px solid #444',
                          backgroundColor: '#141414',
                          color: '#f3f4f6',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        <option value="vinyl">Theme: Vinyl Die-Cut</option>
                        <option value="holographic">Theme: Holo Foil</option>
                        <option value="epoxy">Theme: Epoxy Dome</option>
                        <option value="enamel">Theme: Enamel Pin</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => void handleCycleWidgetTilt(w, settings.tiltMode)}
                        title="Cycle 3D Motion / Parallax Tilt"
                        style={{
                          padding: '4px 8px',
                          borderRadius: '5px',
                          border: '1px solid #444',
                          backgroundColor:
                            settings.tiltMode === 'none' ? '#2d2d2d' : '#0ea5e9',
                          color: settings.tiltMode === 'none' ? '#ccc' : '#fff',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                        }}
                      >
                        Tilt: {tiltLabel}
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleToggleWidgetAlwaysOnTop(w)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '5px',
                      border: '1px solid #444',
                      backgroundColor: isAlwaysOnTop ? '#8b5cf6' : '#2d2d2d',
                      color: isAlwaysOnTop ? '#fff' : '#ccc',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                    }}
                  >
                    On Top: {isAlwaysOnTop ? 'ON' : 'OFF'}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleToggleWidgetClickThrough(w)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '5px',
                      border: '1px solid #444',
                      backgroundColor: isClickThrough ? '#f59e0b' : '#2d2d2d',
                      color: isClickThrough ? '#000' : '#ccc',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                    }}
                  >
                    Click-Through: {isClickThrough ? 'ON' : 'OFF'}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleToggleWidgetLock(w)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '5px',
                      border: '1px solid #444',
                      backgroundColor: isLocked ? '#3b82f6' : '#2d2d2d',
                      color: isLocked ? '#fff' : '#ccc',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                    }}
                  >
                    Lock: {isLocked ? 'ON' : 'OFF'}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCloseWidget(w.id)}
                    title="Close Widget"
                    style={{
                      padding: '4px 7px',
                      borderRadius: '5px',
                      border: 'none',
                      backgroundColor: '#3f2222',
                      color: '#fca5a5',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {localSuccess && (
        <p
          style={{
            backgroundColor: '#064e3b',
            color: '#a7f3d0',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '0.85rem',
            marginBottom: '16px',
            fontWeight: 500,
          }}
        >
          {localSuccess}
        </p>
      )}

      {isLoaded && (error || localError) && (
        <p style={{ color: '#ff6b6b', marginTop: '12px', fontSize: '0.875rem' }}>
          API Error: {localError ?? error}
        </p>
      )}

      {/* VIEW 1: MY STICKERS */}
      {activeTab === 'stickers' && (
        <>
          {stickers.length === 0 ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                marginTop: '40px',
                padding: '56px 24px',
                borderRadius: '12px',
                border: '2px dashed #333',
                backgroundColor: '#181818',
                textAlign: 'center',
                cursor: 'pointer',
              }}
            >
              <p style={{ margin: '0 0 8px 0', fontSize: '1rem', color: '#e5e7eb', fontWeight: 500 }}>
                Drag & drop a PNG, JPG, or WEBP here to create a sticker
              </p>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#888' }}>
                or click &ldquo;+ Import / New Sticker&rdquo; above (max 20 MB)
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '16px',
              }}
            >
              {stickers.map((sticker) => {
                const isConfirming = confirmDeleteId === sticker.id;

                return (
                  <div
                    key={sticker.id}
                    style={{
                      backgroundColor: '#1c1c1c',
                      border: '1px solid #2e2e2e',
                      borderRadius: '10px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: '150px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '6px',
                        backgroundImage:
                          'linear-gradient(45deg, #252525 25%, transparent 25%), linear-gradient(-45deg, #252525 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #252525 75%), linear-gradient(-45deg, transparent 75%, #252525 75%)',
                        backgroundSize: '16px 16px',
                        backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                        backgroundColor: '#181818',
                        overflow: 'hidden',
                      }}
                    >
                      <img
                        src={`${serverBaseUrl}/files/stickers/${sticker.thumb_path}`}
                        alt={sticker.name}
                        style={{
                          maxWidth: '90%',
                          maxHeight: '90%',
                          objectFit: 'contain',
                        }}
                      />
                    </div>

                    <div style={{ width: '100%', textAlign: 'left' }}>
                      <div
                        style={{
                          fontSize: '0.9rem',
                          fontWeight: 600,
                          color: '#f3f4f6',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {sticker.name}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px' }}>
                        {sticker.width} × {sticker.height} px
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        width: '100%',
                        gap: '6px',
                        marginTop: 'auto',
                      }}
                    >
                      {!isConfirming ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handlePinSticker(sticker.id)}
                            style={{
                              flex: 1,
                              padding: '8px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#10b981',
                              color: '#fff',
                              fontWeight: 600,
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                            }}
                          >
                            Pin to Desktop
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(sticker.id)}
                            style={{
                              padding: '8px 10px',
                              borderRadius: '6px',
                              border: '1px solid #4b2323',
                              backgroundColor: '#2a1818',
                              color: '#fca5a5',
                              fontWeight: 600,
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                            }}
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void deleteSticker(sticker.id)}
                            style={{
                              flex: 1,
                              padding: '8px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              backgroundColor: '#ef4444',
                              color: '#fff',
                              fontWeight: 700,
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                            }}
                          >
                            Confirm Delete?
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            title="Cancel Delete"
                            style={{
                              padding: '8px 10px',
                              borderRadius: '6px',
                              border: '1px solid #444',
                              backgroundColor: '#2a2a2a',
                              color: '#ddd',
                              fontWeight: 600,
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                            }}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* VIEW 2: POKÉMON HOLO VAULT (91 CARDS) */}
      {activeTab === 'pokemon' && (
        <section>
          {/* Search & Category Filter Toolbar */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              marginBottom: '24px',
              backgroundColor: '#191919',
              padding: '16px',
              borderRadius: '10px',
              border: '1px solid #2d2d2d',
            }}
          >
            <input
              type="text"
              value={pokemonSearch}
              onChange={(e) => setPokemonSearch(e.target.value)}
              placeholder="🔍 Search 91 Pokémon cards (e.g. Pikachu, Charizard, Mewtwo, Rayquaza, Gengar)..."
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #3d3d3d',
                backgroundColor: '#121212',
                color: '#fff',
                fontSize: '0.88rem',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: `All (${pokemonCardsList.length})` },
                { id: 'secret', label: 'Secret Rare & Rainbow' },
                { id: 'vmax', label: 'VMAX / VSTAR' },
                { id: 'radiant', label: 'Radiant' },
                { id: 'trainer', label: 'Trainer Gallery' },
                { id: 'amazing', label: 'Amazing Rare' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setPokemonFilter(f.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid',
                    borderColor: pokemonFilter === f.id ? '#ec4899' : '#333',
                    backgroundColor: pokemonFilter === f.id ? '#831843' : '#222',
                    color: pokemonFilter === f.id ? '#fff' : '#ccc',
                    fontWeight: 600,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <p style={{ color: '#888', fontSize: '0.82rem', marginBottom: '16px' }}>
            Showing {filteredPokemon.length} holographic cards. Hover over any card to view its live
            3D holographic tilt and prism glare!
          </p>

          {/* Cards Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '24px',
            }}
          >
            {filteredPokemon.map((card) => {
              const isPinning = pinningCardId === card.id;

              return (
                <div
                  key={card.id}
                  style={{
                    backgroundColor: '#1c1c1c',
                    border: '1px solid #2e2e2e',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <PokemonCard card={card} interactive={true} scale={0.88} />

                  <div style={{ width: '100%', textAlign: 'center' }}>
                    <div
                      style={{
                        fontSize: '0.95rem',
                        fontWeight: 600,
                        color: '#f3f4f6',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {card.name}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#9ca3af', marginTop: '2px' }}>
                      {card.rarity || 'Holo Rare'} · #{card.number}
                    </div>

                    <button
                      type="button"
                      disabled={isPinning}
                      onClick={() => void handlePinPokemonCard(card)}
                      style={{
                        marginTop: '10px',
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: isPinning ? '#374151' : '#10b981',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '0.82rem',
                        cursor: isPinning ? 'wait' : 'pointer',
                        transition: 'background-color 0.2s',
                      }}
                    >
                      {isPinning ? 'Pinning to Desktop...' : '📌 Pin to Desktop (3D Holo)'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
};
