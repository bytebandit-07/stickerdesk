import React, { useState, useEffect, useRef, useCallback } from 'react';
import { removeBackground } from '@imgly/background-removal';
import { useStudioStore } from '../../store/useStudioStore';
import {
  imageUrlToImageData,
  imageDataToDataUrl,
  cloneImageData,
  cropImageData,
  applyBrushSegment,
  defringeImageData,
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

type ActiveTool = 'preview' | 'hand' | 'zoom' | 'crop' | 'lasso' | 'erase' | 'restore';
type CanvasBgMode = 'dark-checker' | 'light-checker' | 'wallpaper';

interface HistoryEntry {
  working: ImageData;
}

interface PanDragState {
  startX: number;
  startY: number;
  originPanX: number;
  originPanY: number;
}

// 12 history steps of lean working buffers is optimal: keeps memory <80 MB while allowing full multi-step undo
const MAX_HISTORY_STEPS = 12;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB limit
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MIN_ZOOM = 0.1; // 10%
const MAX_ZOOM = 8.0; // 800%

function getBackgroundStyle(mode: CanvasBgMode): React.CSSProperties {
  if (mode === 'light-checker') {
    return {
      backgroundImage: `
        linear-gradient(45deg, #d4d4d8 25%, transparent 25%),
        linear-gradient(-45deg, #d4d4d8 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #d4d4d8 75%),
        linear-gradient(-45deg, transparent 75%, #d4d4d8 75%)
      `,
      backgroundSize: '20px 20px',
      backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
      backgroundColor: '#f4f4f5',
    };
  }
  if (mode === 'wallpaper') {
    return {
      backgroundImage:
        'radial-gradient(circle at 20% 20%, #1e3a8a 0%, #0f172a 45%, #090d16 100%)',
      backgroundColor: '#0f172a',
    };
  }
  return {
    backgroundImage: `
      linear-gradient(45deg, #232323 25%, transparent 25%),
      linear-gradient(-45deg, #232323 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #232323 75%),
      linear-gradient(-45deg, transparent 75%, #232323 75%)
    `,
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
    backgroundColor: '#161616',
  };
}

export const Editor: React.FC = () => {
  const { pendingFile, setActiveView, openEditorWithFile, saveSticker } = useStudioStore();

  const [stickerName, setStickerName] = useState<string>('My Sticker');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  const [activeTool, setActiveTool] = useState<ActiveTool>('preview');
  const [bgMode, setBgMode] = useState<CanvasBgMode>('dark-checker');

  // Zoom & Pan Engine State
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const [isPanningDrag, setIsPanningDrag] = useState<boolean>(false);

  // Brush & Ergonomics State
  const [brushSize, setBrushSize] = useState<number>(22);
  const [brushHardness, setBrushHardness] = useState<number>(85); // 0% to 100%
  const [showOriginalReference, setShowOriginalReference] = useState<boolean>(true);
  const cursorOverlayRef = useRef<HTMLDivElement | null>(null);
  const cursorInnerRef = useRef<HTMLDivElement | null>(null);

  // Single instances of reference and pre-background removal images
  // (Prevents duplicating 50 MB images into 25 history entries!)
  const referenceOriginalRef = useRef<ImageData | null>(null);
  const preBgRemovalRef = useRef<ImageData | null>(null);

  const [outlineOptions, setOutlineOptions] = useState<OutlineOptions>(DEFAULT_OUTLINE_OPTIONS);

  const [isRemovingBg, setIsRemovingBg] = useState<boolean>(false);
  const [bgProgressPct, setBgProgressPct] = useState<number>(0);
  const [bgProgressText, setBgProgressText] = useState<string>('');
  const [showBeforeBg, setShowBeforeBg] = useState<boolean>(false);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const referenceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isBrushingRef = useRef<boolean>(false);
  const lastBrushPointRef = useRef<Point2D | null>(null);
  const brushDraftRef = useRef<ImageData | null>(null);
  const panDragRef = useRef<PanDragState | null>(null);

  const currentEntry: HistoryEntry | null =
    historyIndex >= 0 && historyIndex < history.length ? history[historyIndex] : null;

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;

  const pushHistory = useCallback(
    (working: ImageData) => {
      setHistory((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        const next = [...sliced, { working }];
        if (next.length > MAX_HISTORY_STEPS) {
          next.shift();
        }
        return next;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY_STEPS - 1));
    },
    [historyIndex]
  );

  const handleUndo = useCallback((): void => {
    if (historyIndex > 0) {
      setHistoryIndex((i) => i - 1);
      setShowBeforeBg(false);
    }
  }, [historyIndex]);

  const handleRedo = useCallback((): void => {
    if (historyIndex >= 0 && historyIndex < history.length - 1) {
      setHistoryIndex((i) => i + 1);
      setShowBeforeBg(false);
    }
  }, [historyIndex, history.length]);

  const handleFitToScreen = useCallback(
    (targetImg?: ImageData) => {
      const vp = viewportRef.current;
      const img = targetImg ?? currentEntry?.working;
      if (!vp || !img) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }
      const pad = 96;
      const availW = Math.max(100, vp.clientWidth - pad);
      const availH = Math.max(100, vp.clientHeight - pad);
      const extraOutline = (outlineOptions.thickness + 16) * 2;
      const fitScale = Math.min(
        availW / Math.max(1, img.width + extraOutline),
        availH / Math.max(1, img.height + extraOutline),
        1.5
      );
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(fitScale.toFixed(3)))));
      setPan({ x: 0, y: 0 });
    },
    [currentEntry, outlineOptions.thickness]
  );

  const handleResetZoom100 = useCallback((): void => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleLoadFile = useCallback(
    async (file: File) => {
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
        const imgData = await imageUrlToImageData(objectUrl, 1600);
        const baseName = file.name.replace(/\.[^/.]+$/, '') || 'Sticker';
        setStickerName(baseName);
        referenceOriginalRef.current = cloneImageData(imgData);
        preBgRemovalRef.current = null;
        setHistory([{ working: cloneImageData(imgData) }]);
        setHistoryIndex(0);
        setActiveTool('preview');
        setShowBeforeBg(false);
        setTimeout(() => handleFitToScreen(imgData), 20);
      } catch (err: unknown) {
        setStatusError(err instanceof Error ? err.message : 'Failed to decode image');
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },
    [handleFitToScreen]
  );

  useEffect(() => {
    if (pendingFile) {
      void handleLoadFile(pendingFile);
      openEditorWithFile(null);
    }
  }, [pendingFile, handleLoadFile, openEditorWithFile]);

  // Global Keyboard Shortcuts ('Z', 'H', 'B', 'L', 'C', '[', ']', Spacebar, Ctrl+Z, Ctrl+Y)
  useEffect(() => {
    const isTypingInInput = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    };

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (isTypingInInput(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
        return;
      }

      // Undo / Redo shortcuts
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (!currentEntry || e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === '[') {
        e.preventDefault();
        setBrushSize((prev) => Math.max(2, prev - (prev > 20 ? 4 : 2)));
      } else if (key === ']') {
        e.preventDefault();
        setBrushSize((prev) => Math.min(120, prev + (prev >= 20 ? 4 : 2)));
      } else if (key === 'z') {
        e.preventDefault();
        setActiveTool((prev) => (prev === 'zoom' ? 'preview' : 'zoom'));
      } else if (key === 'h') {
        e.preventDefault();
        setActiveTool((prev) => (prev === 'hand' ? 'preview' : 'hand'));
      } else if (key === 'b') {
        e.preventDefault();
        setActiveTool((prev) => (prev === 'erase' ? 'restore' : 'erase'));
      } else if (key === 'l') {
        e.preventDefault();
        setActiveTool('lasso');
      } else if (key === 'c') {
        e.preventDefault();
        setActiveTool('crop');
      } else if (key === 'v' || e.key === 'Escape') {
        e.preventDefault();
        setActiveTool('preview');
      }
    };

    const handleKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        panDragRef.current = null;
        setIsPanningDrag(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [currentEntry, handleUndo, handleRedo]);

  // Cursor-Centered Mouse Wheel Zoom (10% to 800%)
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const handleWheel = (e: WheelEvent): void => {
      if (!currentEntry || activeTool === 'crop') return;
      e.preventDefault();

      const rect = vp.getBoundingClientRect();
      const cursorOffsetX = e.clientX - (rect.left + rect.width * 0.5);
      const cursorOffsetY = e.clientY - (rect.top + rect.height * 0.5);

      const zoomFactor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
      setZoom((prevZoom) => {
        const nextZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, Number((prevZoom * zoomFactor).toFixed(4)))
        );
        const ratio = nextZoom / prevZoom;
        setPan((prevPan) => ({
          x: cursorOffsetX - (cursorOffsetX - prevPan.x) * ratio,
          y: cursorOffsetY - (cursorOffsetY - prevPan.y) * ratio,
        }));
        return nextZoom;
      });
    };

    vp.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      vp.removeEventListener('wheel', handleWheel);
    };
  }, [currentEntry, activeTool]);

  // Render live die-cut preview on checkerboard
  useEffect(() => {
    if (!currentEntry || (activeTool !== 'preview' && activeTool !== 'hand' && activeTool !== 'zoom')) {
      return;
    }
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const targetImageData =
      showBeforeBg && preBgRemovalRef.current
        ? preBgRemovalRef.current
        : currentEntry.working;

    // Debounce die-cut render (20ms) to ensure outline slider dragging remains at smooth 60 FPS
    const timer = setTimeout(() => {
      const rendered = renderDieCutSticker(targetImageData, outlineOptions);
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(rendered, 0, 0);
      }
    }, 20);

    return () => clearTimeout(timer);
  }, [currentEntry, outlineOptions, activeTool, showBeforeBg]);

  // Sync both working brush canvas and underlying ghost referenceOriginal canvas
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
    const refOrig = referenceOriginalRef.current || currentEntry.working;
    if (refCanvas && refOrig) {
      refCanvas.width = refOrig.width;
      refCanvas.height = refOrig.height;
      const rCtx = refCanvas.getContext('2d');
      if (rCtx) {
        rCtx.putImageData(refOrig, 0, 0);
      }
    }
  }, [currentEntry, activeTool, showOriginalReference]);

  const isPanModeActive = isSpacePressed || activeTool === 'hand';

  const handleViewportMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!currentEntry || activeTool === 'crop') return;

    // Middle mouse button (button === 1) or Spacebar+LeftClick or Hand Tool
    if (e.button === 1 || (e.button === 0 && isPanModeActive)) {
      e.preventDefault();
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originPanX: pan.x,
        originPanY: pan.y,
      };
      setIsPanningDrag(true);
      return;
    }

    // Zoom tool click: Left click zooms in, Alt + Left click zooms out centered on cursor
    if (e.button === 0 && activeTool === 'zoom') {
      const vp = viewportRef.current;
      if (!vp) return;
      const rect = vp.getBoundingClientRect();
      const cursorOffsetX = e.clientX - (rect.left + rect.width * 0.5);
      const cursorOffsetY = e.clientY - (rect.top + rect.height * 0.5);
      const factor = e.altKey ? 1 / 1.35 : 1.35;

      setZoom((prevZoom) => {
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * factor));
        const ratio = nextZoom / prevZoom;
        setPan((prevPan) => ({
          x: cursorOffsetX - (cursorOffsetX - prevPan.x) * ratio,
          y: cursorOffsetY - (cursorOffsetY - prevPan.y) * ratio,
        }));
        return nextZoom;
      });
    }
  };

  const handleViewportMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const panSession = panDragRef.current;
    if (!panSession) return;
    const dx = e.clientX - panSession.startX;
    const dy = e.clientY - panSession.startY;
    setPan({
      x: panSession.originPanX + dx,
      y: panSession.originPanY + dy,
    });
  };

  const handleViewportMouseUp = (): void => {
    if (panDragRef.current) {
      panDragRef.current = null;
      setIsPanningDrag(false);
    }
  };

  const handleApplyCrop = (pixelCrop: PixelCrop): void => {
    if (!currentEntry) return;
    const croppedWorking = cropImageData(currentEntry.working, pixelCrop);
    if (referenceOriginalRef.current) {
      referenceOriginalRef.current = cropImageData(referenceOriginalRef.current, pixelCrop);
    }
    if (preBgRemovalRef.current) {
      preBgRemovalRef.current = cropImageData(preBgRemovalRef.current, pixelCrop);
    }

    pushHistory(croppedWorking);
    setActiveTool('preview');
    setTimeout(() => handleFitToScreen(croppedWorking), 20);
  };

  const handleApplyLasso = (lassoWorking: ImageData): void => {
    if (!currentEntry) return;
    referenceOriginalRef.current = cloneImageData(lassoWorking);
    if (preBgRemovalRef.current) {
      preBgRemovalRef.current = cloneImageData(lassoWorking);
    }
    pushHistory(lassoWorking);
    setActiveTool('preview');
    setTimeout(() => handleFitToScreen(lassoWorking), 20);
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
        const bgRemovedData = await imageUrlToImageData(resultUrl, 1600);
        preBgRemovalRef.current = cloneImageData(currentEntry.working);
        pushHistory(bgRemovedData);
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

  const handleDefringeEdges = (): void => {
    if (!currentEntry) return;
    const cleaned = defringeImageData(currentEntry.working, 1.5);
    pushHistory(cleaned);
  };

  /**
   * Maps screen mouse event coordinates through the active Pan/Zoom transform matrix
   * into exact image-space coordinates on `brushCanvasRef`, and positions the viewport cursor HUD.
   * Direct DOM manipulation enables 144Hz silky-smooth tracking with ZERO component re-renders.
   */
  const getBrushPointAndUpdateCursor = (
    e: React.MouseEvent<HTMLCanvasElement>
  ): Point2D => {
    const canvas = brushCanvasRef.current;
    const vp = viewportRef.current;
    if (!canvas || !vp) return { x: 0, y: 0 };

    const canvasRect = canvas.getBoundingClientRect();
    const vpRect = vp.getBoundingClientRect();

    const scaleX = canvas.width / Math.max(1, canvasRect.width);
    const scaleY = canvas.height / Math.max(1, canvasRect.height);

    const outerDiameter = Math.max(4, (brushSize * 2) / scaleX);
    const innerDiameter = Math.max(2, outerDiameter * (brushHardness / 100));

    // Direct DOM manipulation - NO React state update on mousemove!
    if (cursorOverlayRef.current) {
      cursorOverlayRef.current.style.display = 'flex';
      cursorOverlayRef.current.style.transform = `translate3d(${e.clientX - vpRect.left}px, ${e.clientY - vpRect.top}px, 0) translate(-50%, -50%)`;
      cursorOverlayRef.current.style.width = `${outerDiameter}px`;
      cursorOverlayRef.current.style.height = `${outerDiameter}px`;
      if (cursorInnerRef.current) {
        cursorInnerRef.current.style.width = `${innerDiameter}px`;
        cursorInnerRef.current.style.height = `${innerDiameter}px`;
        cursorInnerRef.current.style.display = brushHardness < 98 ? 'block' : 'none';
      }
    }

    return {
      x: (e.clientX - canvasRect.left) * scaleX,
      y: (e.clientY - canvasRect.top) * scaleY,
    };
  };

  const handleBrushDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (isPanModeActive || e.button !== 0) return;
    if (!currentEntry || (activeTool !== 'erase' && activeTool !== 'restore')) return;
    e.stopPropagation();

    isBrushingRef.current = true;
    const pt = getBrushPointAndUpdateCursor(e);
    lastBrushPointRef.current = pt;
    const draft = cloneImageData(currentEntry.working);
    brushDraftRef.current = draft;

    const refOrig = referenceOriginalRef.current || currentEntry.working;
    const dirty = applyBrushSegment(
      draft,
      refOrig,
      pt,
      pt,
      brushSize,
      activeTool,
      brushHardness / 100
    );
    const ctx = brushCanvasRef.current?.getContext('2d');
    if (ctx && dirty.width > 0 && dirty.height > 0) {
      ctx.putImageData(draft, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
    }
  };

  const handleBrushMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const pt = getBrushPointAndUpdateCursor(e);
    if (
      !isBrushingRef.current ||
      isPanModeActive ||
      !currentEntry ||
      !brushDraftRef.current ||
      !lastBrushPointRef.current
    ) {
      return;
    }
    if (activeTool !== 'erase' && activeTool !== 'restore') return;

    const refOrig = referenceOriginalRef.current || currentEntry.working;
    const dirty = applyBrushSegment(
      brushDraftRef.current,
      refOrig,
      lastBrushPointRef.current,
      pt,
      brushSize,
      activeTool,
      brushHardness / 100
    );
    lastBrushPointRef.current = pt;

    const ctx = brushCanvasRef.current?.getContext('2d');
    if (ctx && dirty.width > 0 && dirty.height > 0) {
      ctx.putImageData(brushDraftRef.current, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
    }
  };

  const handleBrushUp = (): void => {
    if (!isBrushingRef.current || !currentEntry || !brushDraftRef.current) return;
    isBrushingRef.current = false;
    const finishedDraft = brushDraftRef.current;
    brushDraftRef.current = null;
    lastBrushPointRef.current = null;

    pushHistory(finishedDraft);
  };

  const handleBrushLeave = (): void => {
    if (cursorOverlayRef.current) {
      cursorOverlayRef.current.style.display = 'none';
    }
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

  const viewportCursor = isPanningDrag
    ? 'grabbing'
    : isPanModeActive
    ? 'grab'
    : activeTool === 'zoom'
    ? 'zoom-in'
    : activeTool === 'erase' || activeTool === 'restore'
    ? 'none'
    : 'default';

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
      {/* Top Navigation, Quick Tool Strip & Background Switcher */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 18px',
          backgroundColor: '#1a1a1a',
          borderBottom: '1px solid #2a2a2a',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
              fontSize: '0.82rem',
            }}
          >
            ← Library
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
              fontSize: '0.85rem',
              width: '175px',
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
              fontSize: '0.82rem',
            }}
          >
            Import...
          </button>
        </div>

        {/* Center Shortcut Toolbar */}
        {currentEntry && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              backgroundColor: '#121212',
              padding: '4px',
              borderRadius: '8px',
              border: '1px solid #2e2e2e',
            }}
          >
            {(
              [
                { id: 'preview', label: 'Preview (V)' },
                { id: 'hand', label: 'Pan (H)' },
                { id: 'zoom', label: 'Zoom (Z)' },
                { id: 'crop', label: 'Crop (C)' },
                { id: 'lasso', label: 'Lasso (L)' },
                { id: 'erase', label: 'Erase (B)' },
                { id: 'restore', label: 'Restore' },
              ] as const
            ).map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => setActiveTool(tool.id)}
                style={{
                  padding: '5px 9px',
                  borderRadius: '5px',
                  border: 'none',
                  backgroundColor: activeTool === tool.id ? '#4f46e5' : 'transparent',
                  color: activeTool === tool.id ? '#fff' : '#bbb',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {tool.label}
              </button>
            ))}
          </div>
        )}

        {/* Right: Background Switcher + Undo/Redo + Save */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Live Preview Background Switcher */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              backgroundColor: '#121212',
              padding: '3px',
              borderRadius: '6px',
              border: '1px solid #2e2e2e',
            }}
            title="Switch Canvas Preview Background"
          >
            {(
              [
                { id: 'dark-checker', label: 'Dark' },
                { id: 'light-checker', label: 'Light' },
                { id: 'wallpaper', label: 'Desktop' },
              ] as const
            ).map((bg) => (
              <button
                key={bg.id}
                type="button"
                onClick={() => setBgMode(bg.id)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: bgMode === bg.id ? '#374151' : 'transparent',
                  color: bgMode === bg.id ? '#fff' : '#888',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {bg.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!canUndo}
            onClick={handleUndo}
            title="Undo (Ctrl+Z)"
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid #3a3a3a',
              backgroundColor: canUndo ? '#262626' : '#181818',
              color: canUndo ? '#fff' : '#555',
              cursor: canUndo ? 'pointer' : 'not-allowed',
              fontSize: '0.8rem',
            }}
          >
            Undo ({Math.max(0, historyIndex)})
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={handleRedo}
            title="Redo (Ctrl+Y)"
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid #3a3a3a',
              backgroundColor: canRedo ? '#262626' : '#181818',
              color: canRedo ? '#fff' : '#555',
              cursor: canRedo ? 'pointer' : 'not-allowed',
              fontSize: '0.8rem',
            }}
          >
            Redo
          </button>

          <button
            type="button"
            disabled={!currentEntry || isSaving || activeTool === 'crop' || activeTool === 'lasso'}
            onClick={() => void handleSaveSticker()}
            style={{
              padding: '7px 16px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: currentEntry ? '#4f46e5' : '#374151',
              color: '#fff',
              fontWeight: 600,
              cursor: currentEntry ? 'pointer' : 'not-allowed',
              fontSize: '0.85rem',
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
        {/* Interactive Zoom & Pan Canvas Viewport */}
        <div
          ref={viewportRef}
          onMouseDown={handleViewportMouseDown}
          onMouseMove={handleViewportMouseMove}
          onMouseUp={handleViewportMouseUp}
          onMouseLeave={handleViewportMouseUp}
          style={{
            ...getBackgroundStyle(bgMode),
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
            cursor: viewportCursor,
            outline: isDraggingOver ? '3px dashed #4f46e5' : 'none',
            outlineOffset: '-12px',
            paddingBottom: activeTool === 'lasso' ? '54px' : 0,
            boxSizing: 'border-box',
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
            <div style={{ width: '100%', height: '100%', padding: '20px', boxSizing: 'border-box' }}>
              <CropTool
                imageSrc={imageDataToDataUrl(currentEntry.working)}
                imageWidth={currentEntry.working.width}
                imageHeight={currentEntry.working.height}
                onApplyCrop={handleApplyCrop}
                onCancel={() => setActiveTool('preview')}
              />
            </div>
          ) : (
            /* Pan & Zoom Transformed Stage */
            <div
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isPanningDrag ? 'none' : 'transform 0.04s ease-out',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {activeTool === 'lasso' ? (
                <LassoTool
                  sourceImageData={currentEntry.working}
                  zoom={zoom}
                  isPanning={isPanModeActive || isPanningDrag}
                  onApplyLasso={handleApplyLasso}
                  onCancel={() => setActiveTool('preview')}
                />
              ) : activeTool === 'erase' || activeTool === 'restore' ? (
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
                      opacity: showOriginalReference ? 0.35 : 0,
                      pointerEvents: 'none',
                    }}
                  />

                  {/* Active Working Brush Canvas */}
                  <canvas
                    ref={brushCanvasRef}
                    onMouseDown={handleBrushDown}
                    onMouseMove={handleBrushMove}
                    onMouseUp={handleBrushUp}
                    onMouseLeave={handleBrushLeave}
                    style={{
                      position: 'relative',
                      display: 'block',
                      cursor: isPanModeActive ? 'grab' : 'none',
                    }}
                  />
                </div>
              ) : (
                <canvas
                  ref={previewCanvasRef}
                  style={{
                    display: 'block',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          )}

          {/* Live Brush Radius & Hardness Cursor Overlay in Viewport Coordinates (Direct DOM - 144Hz) */}
          {(activeTool === 'erase' || activeTool === 'restore') && !isPanModeActive && (
            <div
              ref={cursorOverlayRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                display: 'none',
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                border:
                  activeTool === 'erase'
                    ? '1.5px solid #ef4444'
                    : '1.5px solid #10b981',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.8)',
                pointerEvents: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 25,
                willChange: 'transform',
              }}
            >
              {/* Inner ring indicating Brush Hardness / Feather threshold */}
              <div
                ref={cursorInnerRef}
                style={{
                  borderRadius: '50%',
                  border: '1px dashed rgba(255, 255, 255, 0.65)',
                  pointerEvents: 'none',
                  display: brushHardness < 98 ? 'block' : 'none',
                }}
              />
            </div>
          )}

          {/* Floating Brush Ergonomics Bar when in Erase / Restore Mode */}
          {currentEntry && (activeTool === 'erase' || activeTool === 'restore') && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                top: '16px',
                left: '50%',
                transform: 'translateX(-50%)',
                padding: '8px 16px',
                borderRadius: '10px',
                backgroundColor: 'rgba(24, 24, 28, 0.94)',
                border: '1px solid #383838',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '14px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                zIndex: 20,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: '#ccc', fontWeight: 600 }}>
                  Size ([ / ]): {brushSize}px
                </span>
                <input
                  type="range"
                  min={2}
                  max={120}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  style={{ width: '95px' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: '#ccc', fontWeight: 600 }}>
                  Hardness: {brushHardness}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={brushHardness}
                  onChange={(e) => setBrushHardness(Number(e.target.value))}
                  style={{ width: '85px' }}
                />
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.8rem',
                  color: '#ddd',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={showOriginalReference}
                  onChange={(e) => setShowOriginalReference(e.target.checked)}
                />
                Ghost Reference
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
                  fontSize: '0.8rem',
                }}
              >
                Done (V)
              </button>
            </div>
          )}

          {/* Bottom-Right Zoom & Pan HUD Overlay */}
          {currentEntry && activeTool !== 'crop' && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                right: '16px',
                bottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                borderRadius: '8px',
                backgroundColor: 'rgba(20, 20, 24, 0.92)',
                border: '1px solid #333',
                boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
                zIndex: 20,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setZoom((z) => Math.max(MIN_ZOOM, Number((z / 1.2).toFixed(3))))
                }
                title="Zoom Out"
                style={{
                  padding: '4px 8px',
                  borderRadius: '5px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#262626',
                  color: '#ddd',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}
              >
                −
              </button>

              <span
                style={{
                  minWidth: '52px',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  color: '#f3f4f6',
                }}
              >
                {Math.round(zoom * 100)}%
              </span>

              <button
                type="button"
                onClick={() =>
                  setZoom((z) => Math.min(MAX_ZOOM, Number((z * 1.2).toFixed(3))))
                }
                title="Zoom In"
                style={{
                  padding: '4px 8px',
                  borderRadius: '5px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#262626',
                  color: '#ddd',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}
              >
                +
              </button>

              <button
                type="button"
                onClick={() => handleFitToScreen()}
                style={{
                  padding: '4px 9px',
                  borderRadius: '5px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#262626',
                  color: '#ddd',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                Fit to Screen
              </button>

              <button
                type="button"
                onClick={handleResetZoom100}
                style={{
                  padding: '4px 9px',
                  borderRadius: '5px',
                  border: '1px solid #3a3a3a',
                  backgroundColor: '#262626',
                  color: '#ddd',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                100%
              </button>
            </div>
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
                zIndex: 35,
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
              width: '315px',
              backgroundColor: '#161616',
              borderLeft: '1px solid #2a2a2a',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              overflowY: 'auto',
            }}
          >
            {/* 1. Crop & Lasso */}
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
                Shortcuts: <b>C</b> (Rect Crop) • <b>L</b> (Freehand Lasso)
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
                  Rect Crop (C)
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
                  Lasso Cut (L)
                </button>
              </div>
            </div>

            {/* 2. Background Removal, 1-Click Defringe & Mask Brushes */}
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
                2. Background & Edge Cleanup
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
                {isRemovingBg ? 'Processing...' : 'Remove Background (AI)'}
              </button>

              {/* 1-Click Edge Defringe Filter */}
              <button
                type="button"
                onClick={handleDefringeEdges}
                title="Trims 1-2px semi-transparent fringe halos and decontaminates edge colors"
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #3b82f6',
                  backgroundColor: '#1e293b',
                  color: '#93c5fd',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                }}
              >
                ✨ Clean Edges / Defringe
              </button>

              {Boolean(preBgRemovalRef.current) && (
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

              <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
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
                    fontWeight: 500,
                  }}
                >
                  Eraser (B)
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
                    fontWeight: 500,
                  }}
                >
                  Restore (B)
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
