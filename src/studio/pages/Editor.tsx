
import React, { useState, useEffect, useRef, useCallback } from 'react';

import { removeBackground } from '@imgly/background-removal';

import { useStudioStore } from '../../store/useStudioStore';

import {

  imageUrlToImageData,

  imageDataToDataUrl,

  cloneImageData,

  cropImageData,

  applyBrushSegment,

  PixelCrop,

  Point2D,

} from '../../lib/image/mask';

import {

  OutlineOptions,

  DEFAULT_OUTLINE_OPTIONS,

  renderDieCutSticker,

} from '../../lib/image/outline';

import { CropTool } from '../components/CropTool';

import { LassoTool } from '../components/LassoTool';

import { OutlineControls } from '../components/OutlineControls';



type ActiveTool = 'preview' | 'crop' | 'lasso' | 'erase' | 'restore';



interface HistoryEntry {

  working: ImageData;

  referenceOriginal: ImageData;

  preBgRemoval: ImageData | null;

}



interface CursorOverlayState {

  visible: boolean;

  x: number;

  y: number;

  displayDiameter: number;

}



const MAX_HISTORY_STEPS = 25;

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB limit

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];



const CHECKERBOARD_STYLE: React.CSSProperties = {

  backgroundImage: `

    linear-gradient(45deg, #232323 25%, transparent 25%),

    linear-gradient(-45deg, #232323 25%, transparent 25%),

    linear-gradient(45deg, transparent 75%, #232323 75%),

    linear-gradient(-45deg, transparent 75%, #232323 75%)

  `,

  backgroundSize: '20px 20px',

  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',

  backgroundColor: '#181818',

};



export const Editor: React.FC = () => {

  const { pendingFile, setActiveView, openEditorWithFile, saveSticker } = useStudioStore();



  const [stickerName, setStickerName] = useState<string>('My Sticker');

  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [historyIndex, setHistoryIndex] = useState<number>(-1);



  const [activeTool, setActiveTool] = useState<ActiveTool>('preview');

  const [brushSize, setBrushSize] = useState<number>(22);

  const [showOriginalReference, setShowOriginalReference] = useState<boolean>(true);

  const [cursorOverlay, setCursorOverlay] = useState<CursorOverlayState>({

    visible: false,

    x: 0,

    y: 0,

    displayDiameter: 22,

  });



  const [outlineOptions, setOutlineOptions] = useState<OutlineOptions>(DEFAULT_OUTLINE_OPTIONS);



  const [isRemovingBg, setIsRemovingBg] = useState<boolean>(false);

  const [bgProgressPct, setBgProgressPct] = useState<number>(0);

  const [bgProgressText, setBgProgressText] = useState<string>('');

  const [showBeforeBg, setShowBeforeBg] = useState<boolean>(false);



  const [isSaving, setIsSaving] = useState<boolean>(false);

  const [statusError, setStatusError] = useState<string | null>(null);

  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);



  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const referenceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isBrushingRef = useRef<boolean>(false);

  const lastBrushPointRef = useRef<Point2D | null>(null);

  const brushDraftRef = useRef<ImageData | null>(null);



  const currentEntry: HistoryEntry | null =

    historyIndex >= 0 && historyIndex < history.length ? history[historyIndex] : null;



  const pushHistory = useCallback(

    (entry: HistoryEntry) => {

      setHistory((prev) => {

        const sliced = prev.slice(0, historyIndex + 1);

        const next = [...sliced, entry];

        if (next.length > MAX_HISTORY_STEPS) {

          next.shift();

        }

        return next;

      });

      setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY_STEPS - 1));

    },

    [historyIndex]

  );



  const handleLoadFile = useCallback(async (file: File) => {

    setStatusError(null);

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {

      setStatusError('Unsupported file format. Please import a PNG, JPG, or WEBP image.');

      return;

    }

    if (file.size > MAX_FILE_BYTES) {

      setStatusError('File exceeds the 20 MB maximum size limit.');

      return;

    }



    const objectUrl = URL.createObjectURL(file);

    try {

      const imgData = await imageUrlToImageData(objectUrl);

      const baseName = file.name.replace(/\.[^/.]+$/, '') || 'Sticker';

      setStickerName(baseName);

      const initialEntry: HistoryEntry = {

        working: cloneImageData(imgData),

        referenceOriginal: cloneImageData(imgData),

        preBgRemoval: null,

      };

      setHistory([initialEntry]);

      setHistoryIndex(0);

      setActiveTool('preview');

      setShowBeforeBg(false);

    } catch (err: unknown) {

      setStatusError(err instanceof Error ? err.message : 'Failed to decode image');

    } finally {

      URL.revokeObjectURL(objectUrl);

    }

  }, []);



  useEffect(() => {

    if (pendingFile) {

      void handleLoadFile(pendingFile);

      openEditorWithFile(null);

    }

  }, [pendingFile, handleLoadFile, openEditorWithFile]);



  // Render live die-cut preview on checkerboard

  useEffect(() => {

    if (!currentEntry || activeTool !== 'preview') return;

    const canvas = previewCanvasRef.current;

    if (!canvas) return;



    const targetImageData =

      showBeforeBg && currentEntry.preBgRemoval

        ? currentEntry.preBgRemoval

        : currentEntry.working;



    const rendered = renderDieCutSticker(targetImageData, outlineOptions);

    canvas.width = rendered.width;

    canvas.height = rendered.height;

    const ctx = canvas.getContext('2d');

    if (ctx) {

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(rendered, 0, 0);

    }

  }, [currentEntry, outlineOptions, activeTool, showBeforeBg]);



  // Sync both the working brush canvas and the underlying ghost referenceOriginal canvas

  useEffect(() => {

    if (!currentEntry || (activeTool !== 'erase' && activeTool !== 'restore')) return;



    const workCanvas = brushCanvasRef.current;

    if (workCanvas) {

      workCanvas.width = currentEntry.working.width;

      workCanvas.height = currentEntry.working.height;

      const wCtx = workCanvas.getContext('2d');

      if (wCtx) {

        wCtx.putImageData(currentEntry.working, 0, 0);

      }

    }



    const refCanvas = referenceCanvasRef.current;

    if (refCanvas) {

      refCanvas.width = currentEntry.referenceOriginal.width;

      refCanvas.height = currentEntry.referenceOriginal.height;

      const rCtx = refCanvas.getContext('2d');

      if (rCtx) {

        rCtx.putImageData(currentEntry.referenceOriginal, 0, 0);

      }

    }

  }, [currentEntry, activeTool, showOriginalReference]);



  const canUndo = historyIndex > 0;

  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;



  const handleUndo = (): void => {

    if (canUndo) {

      setHistoryIndex((i) => i - 1);

      setShowBeforeBg(false);

    }

  };



  const handleRedo = (): void => {

    if (canRedo) {

      setHistoryIndex((i) => i + 1);

      setShowBeforeBg(false);

    }

  };



  const handleApplyCrop = (pixelCrop: PixelCrop): void => {

    if (!currentEntry) return;

    const croppedWorking = cropImageData(currentEntry.working, pixelCrop);

    const croppedOriginal = cropImageData(currentEntry.referenceOriginal, pixelCrop);

    const croppedPreBg = currentEntry.preBgRemoval

      ? cropImageData(currentEntry.preBgRemoval, pixelCrop)

      : null;



    pushHistory({

      working: croppedWorking,

      referenceOriginal: croppedOriginal,

      preBgRemoval: croppedPreBg,

    });

    setActiveTool('preview');

  };



  const handleApplyLasso = (lassoWorking: ImageData): void => {

    if (!currentEntry) return;

    // Works seamlessly both BEFORE and AFTER background removal

    pushHistory({

      working: lassoWorking,

      referenceOriginal: cloneImageData(lassoWorking),

      preBgRemoval: currentEntry.preBgRemoval ? cloneImageData(lassoWorking) : null,

    });

    setActiveTool('preview');

  };



  const handleRemoveBackground = async (): Promise<void> => {

    if (!currentEntry || isRemovingBg) return;

    setIsRemovingBg(true);

    setStatusError(null);

    setBgProgressPct(10);

    setBgProgressText('Loading high-precision ISNet model...');



    try {

      const sourceDataUrl = imageDataToDataUrl(currentEntry.working);

      const blob = await removeBackground(sourceDataUrl, {

        model: 'isnet',

        output: {

          quality: 1.0,

        },

        progress: (key: string, current: number, total: number) => {

          if (total > 0) {

            const pct = Math.min(100, Math.round((current / total) * 100));

            setBgProgressPct(pct);

            setBgProgressText(`${key} (${pct}%)`);

          }

        },

      });



      const resultUrl = URL.createObjectURL(blob);

      try {

        const bgRemovedData = await imageUrlToImageData(resultUrl);

        pushHistory({

          working: bgRemovedData,

          referenceOriginal: cloneImageData(currentEntry.referenceOriginal),

          preBgRemoval: cloneImageData(currentEntry.working),

        });

        setShowBeforeBg(false);

      } finally {

        URL.revokeObjectURL(resultUrl);

      }

    } catch (err: unknown) {

      setStatusError(

        err instanceof Error

          ? `Background removal failed: ${err.message}`

          : 'Background removal failed'

      );

    } finally {

      setIsRemovingBg(false);

      setBgProgressPct(0);

      setBgProgressText('');

    }

  };



  const getBrushPointAndUpdateCursor = (

    e: React.MouseEvent<HTMLCanvasElement>

  ): Point2D => {

    const canvas = brushCanvasRef.current;

    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / Math.max(1, rect.width);

    const scaleY = canvas.height / Math.max(1, rect.height);



    const localX = e.clientX - rect.left;

    const localY = e.clientY - rect.top;

    const displayDiameter = Math.max(4, (brushSize * 2) / scaleX);



    setCursorOverlay({

      visible: true,

      x: localX,

      y: localY,

      displayDiameter,

    });



    return {

      x: localX * scaleX,

      y: localY * scaleY,

    };

  };



  const handleBrushDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {

    if (!currentEntry || (activeTool !== 'erase' && activeTool !== 'restore')) return;

    isBrushingRef.current = true;

    const pt = getBrushPointAndUpdateCursor(e);

    lastBrushPointRef.current = pt;

    const draft = cloneImageData(currentEntry.working);

    brushDraftRef.current = draft;



    applyBrushSegment(draft, currentEntry.referenceOriginal, pt, pt, brushSize, activeTool);

    const ctx = brushCanvasRef.current?.getContext('2d');

    if (ctx) {

      ctx.putImageData(draft, 0, 0);

    }

  };



  const handleBrushMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {

    const pt = getBrushPointAndUpdateCursor(e);

    if (

      !isBrushingRef.current ||

      !currentEntry ||

      !brushDraftRef.current ||

      !lastBrushPointRef.current

    ) {

      return;

    }

    if (activeTool !== 'erase' && activeTool !== 'restore') return;



    applyBrushSegment(

      brushDraftRef.current,

      currentEntry.referenceOriginal,

      lastBrushPointRef.current,

      pt,

      brushSize,

      activeTool

    );

    lastBrushPointRef.current = pt;



    const ctx = brushCanvasRef.current?.getContext('2d');

    if (ctx) {

      ctx.putImageData(brushDraftRef.current, 0, 0);

    }

  };



  const handleBrushUp = (): void => {

    if (!isBrushingRef.current || !currentEntry || !brushDraftRef.current) return;

    isBrushingRef.current = false;

    const finishedDraft = brushDraftRef.current;

    brushDraftRef.current = null;

    lastBrushPointRef.current = null;



    pushHistory({

      working: finishedDraft,

      referenceOriginal: cloneImageData(currentEntry.referenceOriginal),

      preBgRemoval: currentEntry.preBgRemoval ? cloneImageData(currentEntry.preBgRemoval) : null,

    });

  };



  const handleBrushLeave = (): void => {

    setCursorOverlay((prev) => ({ ...prev, visible: false }));

    handleBrushUp();

  };



  const handleSaveSticker = async (): Promise<void> => {

    if (!currentEntry || isSaving) return;

    setIsSaving(true);

    setStatusError(null);



    try {

      const finalCanvas = renderDieCutSticker(currentEntry.working, outlineOptions);

      const base64Png = finalCanvas.toDataURL('image/png');

      await saveSticker(stickerName.trim() || 'Untitled Sticker', base64Png);

      setActiveView('library');

    } catch (err: unknown) {

      setStatusError(err instanceof Error ? err.message : 'Failed to save sticker');

    } finally {

      setIsSaving(false);

    }

  };



  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {

    e.preventDefault();

    setIsDraggingOver(false);

    const file = e.dataTransfer.files?.[0];

    if (file) {

      void handleLoadFile(file);

    }

  };



  return (

    <div

      onDragOver={(e) => {

        e.preventDefault();

        setIsDraggingOver(true);

      }}

      onDragLeave={() => setIsDraggingOver(false)}

      onDrop={handleDrop}

      style={{

        display: 'flex',

        flexDirection: 'column',

        height: '100vh',

        backgroundColor: '#121212',

        color: '#f5f5f5',

      }}

    >

      {/* Top Navigation & Actions Bar */}

      <header

        style={{

          display: 'flex',

          alignItems: 'center',

          justifyContent: 'space-between',

          padding: '12px 20px',

          backgroundColor: '#1a1a1a',

          borderBottom: '1px solid #2a2a2a',

        }}

      >

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>

          <button

            type="button"

            onClick={() => setActiveView('library')}

            style={{

              padding: '6px 12px',

              borderRadius: '6px',

              border: '1px solid #3a3a3a',

              backgroundColor: '#262626',

              color: '#fff',

              cursor: 'pointer',

              fontSize: '0.85rem',

            }}

          >

            ← Back to Library

          </button>



          <input

            type="text"

            value={stickerName}

            onChange={(e) => setStickerName(e.target.value)}

            placeholder="Sticker name..."

            style={{

              padding: '6px 10px',

              borderRadius: '6px',

              border: '1px solid #3a3a3a',

              backgroundColor: '#121212',

              color: '#fff',

              fontSize: '0.9rem',

              width: '200px',

            }}

          />



          <input

            ref={fileInputRef}

            type="file"

            accept="image/png,image/jpeg,image/webp"

            style={{ display: 'none' }}

            onChange={(e) => {

              const file = e.target.files?.[0];

              if (file) void handleLoadFile(file);

              e.target.value = '';

            }}

          />

          <button

            type="button"

            onClick={() => fileInputRef.current?.click()}

            style={{

              padding: '6px 12px',

              borderRadius: '6px',

              border: '1px solid #3a3a3a',

              backgroundColor: '#262626',

              color: '#ddd',

              cursor: 'pointer',

              fontSize: '0.85rem',

            }}

          >

            Import Image...

          </button>

        </div>



        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>

          <button

            type="button"

            disabled={!canUndo}

            onClick={handleUndo}

            style={{

              padding: '6px 12px',

              borderRadius: '6px',

              border: '1px solid #3a3a3a',

              backgroundColor: canUndo ? '#262626' : '#181818',

              color: canUndo ? '#fff' : '#555',

              cursor: canUndo ? 'pointer' : 'not-allowed',

              fontSize: '0.85rem',

            }}

          >

            Undo ({Math.max(0, historyIndex)})

          </button>

          <button

            type="button"

            disabled={!canRedo}

            onClick={handleRedo}

            style={{

              padding: '6px 12px',

              borderRadius: '6px',

              border: '1px solid #3a3a3a',

              backgroundColor: canRedo ? '#262626' : '#181818',

              color: canRedo ? '#fff' : '#555',

              cursor: canRedo ? 'pointer' : 'not-allowed',

              fontSize: '0.85rem',

            }}

          >

            Redo

          </button>



          <button

            type="button"

            disabled={!currentEntry || isSaving || activeTool === 'crop' || activeTool === 'lasso'}

            onClick={() => void handleSaveSticker()}

            style={{

              marginLeft: '8px',

              padding: '7px 18px',

              borderRadius: '6px',

              border: 'none',

              backgroundColor: currentEntry ? '#4f46e5' : '#374151',

              color: '#fff',

              fontWeight: 600,

              cursor: currentEntry ? 'pointer' : 'not-allowed',

              fontSize: '0.88rem',

            }}

          >

            {isSaving ? 'Saving...' : 'Save Sticker'}

          </button>

        </div>

      </header>



      {statusError && (

        <div

          style={{

            backgroundColor: '#7f1d1d',

            color: '#fecaca',

            padding: '8px 20px',

            fontSize: '0.85rem',

            display: 'flex',

            justifyContent: 'space-between',

          }}

        >

          <span>{statusError}</span>

          <button

            type="button"

            onClick={() => setStatusError(null)}

            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}

          >

            ✕

          </button>

        </div>

      )}



      {/* Main Editor Workspace */}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        <div

          style={{

            ...CHECKERBOARD_STYLE,

            flex: 1,

            display: 'flex',

            flexDirection: 'column',

            alignItems: 'center',

            justifyContent: 'center',

            padding: '20px',

            position: 'relative',

            overflow: 'hidden',

            outline: isDraggingOver ? '3px dashed #4f46e5' : 'none',

            outlineOffset: '-12px',

          }}

        >

          {!currentEntry ? (

            <div

              onClick={() => fileInputRef.current?.click()}

              style={{

                padding: '48px',

                borderRadius: '12px',

                border: '2px dashed #444',

                backgroundColor: 'rgba(20, 20, 20, 0.85)',

                textAlign: 'center',

                cursor: 'pointer',

              }}

            >

              <p style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}>

                Drop a PNG, JPG, or WEBP here

              </p>

              <p style={{ margin: 0, fontSize: '0.85rem', color: '#999' }}>

                or click to browse (max 20 MB)

              </p>

            </div>

          ) : activeTool === 'crop' ? (

            <CropTool

              imageSrc={imageDataToDataUrl(currentEntry.working)}

              imageWidth={currentEntry.working.width}

              imageHeight={currentEntry.working.height}

              onApplyCrop={handleApplyCrop}

              onCancel={() => setActiveTool('preview')}

            />

          ) : activeTool === 'lasso' ? (

            <LassoTool

              sourceImageData={currentEntry.working}

              onApplyLasso={handleApplyLasso}

              onCancel={() => setActiveTool('preview')}

            />

          ) : activeTool === 'erase' || activeTool === 'restore' ? (

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>

              <div

                style={{

                  position: 'relative',

                  display: 'inline-block',

                  lineHeight: 0,

                  boxShadow: '0 4px 20px rgba(0,0,0,0.45)',

                }}

              >

                {/* Ghost Reference Overlay Canvas (35% opacity underneath working canvas) */}

                <canvas

                  ref={referenceCanvasRef}

                  style={{

                    position: 'absolute',

                    inset: 0,

                    width: '100%',

                    height: '100%',

                    objectFit: 'contain',

                    opacity: showOriginalReference ? 0.35 : 0,

                    pointerEvents: 'none',

                  }}

                />



                {/* Active Working Canvas */}

                <canvas

                  ref={brushCanvasRef}

                  onMouseDown={handleBrushDown}

                  onMouseMove={handleBrushMove}

                  onMouseUp={handleBrushUp}

                  onMouseLeave={handleBrushLeave}

                  style={{

                    position: 'relative',

                    maxWidth: '100%',

                    maxHeight: '68vh',

                    objectFit: 'contain',

                    cursor: 'none',

                  }}

                />



                {/* Circular Brush Size Cursor Outline */}

                {cursorOverlay.visible && (

                  <div

                    style={{

                      position: 'absolute',

                      left: `${cursorOverlay.x}px`,

                      top: `${cursorOverlay.y}px`,

                      width: `${cursorOverlay.displayDiameter}px`,

                      height: `${cursorOverlay.displayDiameter}px`,

                      transform: 'translate(-50%, -50%)',

                      borderRadius: '50%',

                      border:

                        activeTool === 'erase'

                          ? '2px solid #ef4444'

                          : '2px solid #10b981',

                      boxShadow: '0 0 0 1px rgba(255,255,255,0.85)',

                      pointerEvents: 'none',

                    }}

                  />

                )}

              </div>



              <div

                style={{

                  padding: '8px 16px',

                  borderRadius: '8px',

                  backgroundColor: '#1e1e1e',

                  display: 'flex',

                  flexWrap: 'wrap',

                  alignItems: 'center',

                  gap: '14px',

                }}

              >

                <span style={{ fontSize: '0.82rem', color: '#ccc' }}>

                  {activeTool === 'erase' ? 'Eraser Brush' : 'Restore Brush'} Size: {brushSize}px

                </span>

                <input

                  type="range"

                  min={2}

                  max={80}

                  value={brushSize}

                  onChange={(e) => setBrushSize(Number(e.target.value))}

                />



                <label

                  style={{

                    display: 'flex',

                    alignItems: 'center',

                    gap: '6px',

                    fontSize: '0.82rem',

                    color: '#ddd',

                    cursor: 'pointer',

                  }}

                >

                  <input

                    type="checkbox"

                    checked={showOriginalReference}

                    onChange={(e) => setShowOriginalReference(e.target.checked)}

                  />

                  Show Original Reference

                </label>



                <button

                  type="button"

                  onClick={() => setActiveTool('preview')}

                  style={{

                    padding: '5px 12px',

                    borderRadius: '6px',

                    border: 'none',

                    backgroundColor: '#10b981',

                    color: '#fff',

                    fontWeight: 600,

                    cursor: 'pointer',

                  }}

                >

                  Done Brushing

                </button>

              </div>

            </div>

          ) : (

            <canvas

              ref={previewCanvasRef}

              style={{

                maxWidth: '100%',

                maxHeight: '76vh',

                objectFit: 'contain',

              }}

            />

          )}



          {isRemovingBg && (

            <div

              style={{

                position: 'absolute',

                inset: 0,

                backgroundColor: 'rgba(0, 0, 0, 0.78)',

                display: 'flex',

                flexDirection: 'column',

                alignItems: 'center',

                justifyContent: 'center',

                gap: '12px',

                zIndex: 10,

              }}

            >

              <div

                style={{

                  width: '260px',

                  height: '10px',

                  backgroundColor: '#2a2a2a',

                  borderRadius: '5px',

                  overflow: 'hidden',

                }}

              >

                <div

                  style={{

                    width: `${Math.max(10, bgProgressPct)}%`,

                    height: '100%',

                    backgroundColor: '#4f46e5',

                    transition: 'width 0.2s ease',

                  }}

                />

              </div>

              <span style={{ fontSize: '0.92rem', fontWeight: 500, color: '#e5e7eb' }}>

                Removing Background... {bgProgressText}

              </span>

            </div>

          )}

        </div>



        {/* Right Controls Sidebar */}

        {currentEntry && (

          <aside

            style={{

              width: '310px',

              backgroundColor: '#161616',

              borderLeft: '1px solid #2a2a2a',

              padding: '16px',

              display: 'flex',

              flexDirection: 'column',

              gap: '16px',

              overflowY: 'auto',

            }}

          >

            {/* 1. Crop & Lasso (usable both BEFORE and AFTER background removal) */}

            <div

              style={{

                display: 'flex',

                flexDirection: 'column',

                gap: '8px',

                padding: '14px',

                backgroundColor: '#1e1e1e',

                borderRadius: '8px',

                border: '1px solid #2e2e2e',

              }}

            >

              <h3 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: 600 }}>

                1. Crop & Cutout

              </h3>

              <span style={{ fontSize: '0.75rem', color: '#999', marginBottom: '2px' }}>

                Use before or after AI removal to isolate subjects or trim regions.

              </span>

              <div style={{ display: 'flex', gap: '8px' }}>

                <button

                  type="button"

                  onClick={() => setActiveTool('crop')}

                  style={{

                    flex: 1,

                    padding: '8px',

                    borderRadius: '6px',

                    border: '1px solid #3a3a3a',

                    backgroundColor: activeTool === 'crop' ? '#4f46e5' : '#2a2a2a',

                    color: '#fff',

                    cursor: 'pointer',

                    fontSize: '0.82rem',

                    fontWeight: 500,

                  }}

                >

                  Rect Crop

                </button>

                <button

                  type="button"

                  onClick={() => setActiveTool('lasso')}

                  style={{

                    flex: 1,

                    padding: '8px',

                    borderRadius: '6px',

                    border: '1px solid #3a3a3a',

                    backgroundColor: activeTool === 'lasso' ? '#4f46e5' : '#2a2a2a',

                    color: '#fff',

                    cursor: 'pointer',

                    fontSize: '0.82rem',

                    fontWeight: 500,

                  }}

                >

                  Freehand Lasso

                </button>

              </div>

            </div>



            {/* 2. Background Removal & Mask Brushes */}

            <div

              style={{

                display: 'flex',

                flexDirection: 'column',

                gap: '10px',

                padding: '14px',

                backgroundColor: '#1e1e1e',

                borderRadius: '8px',

                border: '1px solid #2e2e2e',

              }}

            >

              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>

                2. Background Removal

              </h3>



              <button

                type="button"

                disabled={isRemovingBg}

                onClick={() => void handleRemoveBackground()}

                style={{

                  padding: '9px 12px',

                  borderRadius: '6px',

                  border: 'none',

                  backgroundColor: '#4f46e5',

                  color: '#fff',

                  fontWeight: 600,

                  cursor: isRemovingBg ? 'wait' : 'pointer',

                  fontSize: '0.85rem',

                }}

              >

                {isRemovingBg ? 'Processing...' : 'Remove Background'}

              </button>



              {currentEntry.preBgRemoval && (

                <button

                  type="button"

                  onClick={() => setShowBeforeBg((prev) => !prev)}

                  style={{

                    padding: '6px 10px',

                    borderRadius: '6px',

                    border: '1px solid #444',

                    backgroundColor: showBeforeBg ? '#f59e0b' : '#2a2a2a',

                    color: showBeforeBg ? '#000' : '#ddd',

                    fontWeight: 600,

                    cursor: 'pointer',

                    fontSize: '0.8rem',

                  }}

                >

                  {showBeforeBg ? 'Showing: BEFORE' : 'Before / After Toggle'}

                </button>

              )}



              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>

                <button

                  type="button"

                  onClick={() => setActiveTool(activeTool === 'erase' ? 'preview' : 'erase')}

                  style={{

                    flex: 1,

                    padding: '7px',

                    borderRadius: '6px',

                    border: '1px solid #3a3a3a',

                    backgroundColor: activeTool === 'erase' ? '#ef4444' : '#2a2a2a',

                    color: '#fff',

                    cursor: 'pointer',

                    fontSize: '0.8rem',

                  }}

                >

                  Eraser Brush

                </button>

                <button

                  type="button"

                  onClick={() => setActiveTool(activeTool === 'restore' ? 'preview' : 'restore')}

                  style={{

                    flex: 1,

                    padding: '7px',

                    borderRadius: '6px',

                    border: '1px solid #3a3a3a',

                    backgroundColor: activeTool === 'restore' ? '#10b981' : '#2a2a2a',

                    color: '#fff',

                    cursor: 'pointer',

                    fontSize: '0.8rem',

                  }}

                >

                  Restore Brush

                </button>

              </div>

            </div>



            {/* 3. Die-Cut Outline Controls */}

            <OutlineControls options={outlineOptions} onChange={setOutlineOptions} />

          </aside>

        )}

      </div>

    </div>

  );

};



