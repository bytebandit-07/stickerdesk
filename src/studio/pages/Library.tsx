
import React, { useEffect, useRef, useState, useCallback } from 'react';

import { useStudioStore } from '../../store/useStudioStore';



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

  const [isDragging, setIsDragging] = useState<boolean>(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [activeWidgets, setActiveWidgets] = useState<ActiveWidgetRow[]>([]);

  const [localError, setLocalError] = useState<string | null>(null);



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



  const handleToggleWidgetClickThrough = async (widget: ActiveWidgetRow): Promise<void> => {

    setLocalError(null);

    try {

      const config = await window.stickerdesk.getServerConfig();

      const nextState = widget.click_through === 0;

      const res = await fetch(`${config.baseUrl}/widgets/${encodeURIComponent(widget.id)}`, {

        method: 'PATCH',

        headers: {

          'Content-Type': 'application/json',

          'x-stickerdesk-token': config.token,

        },

        body: JSON.stringify({ click_through: nextState }),

      });

      if (!res.ok) {

        throw new Error(`Failed to update widget (HTTP ${res.status})`);

      }

      await fetchActiveWidgets();

    } catch (err: unknown) {

      setLocalError(err instanceof Error ? err.message : 'Failed to toggle click-through');

    }

  };



  const handleToggleWidgetLock = async (widget: ActiveWidgetRow): Promise<void> => {

    setLocalError(null);

    try {

      const config = await window.stickerdesk.getServerConfig();

      const nextState = widget.locked === 0;

      const res = await fetch(`${config.baseUrl}/widgets/${encodeURIComponent(widget.id)}`, {

        method: 'PATCH',

        headers: {

          'Content-Type': 'application/json',

          'x-stickerdesk-token': config.token,

        },

        body: JSON.stringify({ locked: nextState }),

      });

      if (!res.ok) {

        throw new Error(`Failed to update widget lock (HTTP ${res.status})`);

      }

      await fetchActiveWidgets();

    } catch (err: unknown) {

      setLocalError(err instanceof Error ? err.message : 'Failed to toggle lock');

    }

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

        {stickers.length === 0 ? (

          <h1 style={{ fontSize: '1.25rem', fontWeight: 500, margin: 0 }}>Library (empty)</h1>

        ) : (

          <h1 style={{ fontSize: '1.25rem', fontWeight: 500, margin: 0 }}>

            Library ({stickers.length})

          </h1>

        )}



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

              const isClickThrough = w.click_through === 1;

              const isLocked = w.locked === 1;



              return (

                <div

                  key={w.id}

                  style={{

                    display: 'flex',

                    alignItems: 'center',

                    gap: '10px',

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

                      maxWidth: '110px',

                      whiteSpace: 'nowrap',

                      overflow: 'hidden',

                      textOverflow: 'ellipsis',

                    }}

                  >

                    {parentSticker?.name ?? 'Sticker'}

                  </span>



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



      {isLoaded && (error || localError) && (

        <p style={{ color: '#ff6b6b', marginTop: '12px', fontSize: '0.875rem' }}>

          API Error: {localError ?? error}

        </p>

      )}



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

    </main>

  );

};



