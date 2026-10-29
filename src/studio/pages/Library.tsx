import React, { useEffect, useRef, useState } from 'react';
import { useStudioStore } from '../../store/useStudioStore';

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

  useEffect(() => {
    void fetchStickers();
  }, [fetchStickers]);

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
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
            onClick={() => void disableAllClickThrough()}
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

      {isLoaded && error && (
        <p style={{ color: '#ff6b6b', marginTop: '12px', fontSize: '0.875rem' }}>
          API Error: {error}
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
            gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
            gap: '16px',
          }}
        >
          {stickers.map((sticker) => (
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

              <button
                type="button"
                onClick={() => void pinStickerToDesktop(sticker.id)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#10b981',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  marginTop: 'auto',
                }}
              >
                Pin to Desktop
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
};
