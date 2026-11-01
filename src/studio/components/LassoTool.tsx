import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Point2D, applyLassoMask } from '../../lib/image/mask';

interface LassoToolProps {
  sourceImageData: ImageData;
  zoom?: number;
  isPanning?: boolean;
  onApplyLasso: (newImageData: ImageData, path?: Point2D[]) => void;
  onCancel: () => void;
}

export const LassoTool: React.FC<LassoToolProps> = ({
  sourceImageData,
  zoom = 1,
  isPanning = false,
  onApplyLasso,
  onCancel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Path & Segmentation State
  const [points, setPoints] = useState<Point2D[]>([]);
  const [isClosed, setIsClosed] = useState<boolean>(false);
  const [hoverPt, setHoverPt] = useState<Point2D | null>(null);
  const [isNearStart, setIsNearStart] = useState<boolean>(false);
  const [hoveredVertexIndex, setHoveredVertexIndex] = useState<number | null>(null);

  const isMouseDownRef = useRef<boolean>(false);
  const lastStreamPointRef = useRef<Point2D | null>(null);
  const draggingPointRef = useRef<number | null>(null);

  // Cache source image on offscreen GPU canvas for instant 120 FPS rendering
  useEffect(() => {
    const sc = document.createElement('canvas');
    sc.width = sourceImageData.width;
    sc.height = sourceImageData.height;
    const sCtx = sc.getContext('2d');
    if (sCtx) {
      sCtx.putImageData(sourceImageData, 0, 0);
    }
    sourceCanvasRef.current = sc;
  }, [sourceImageData]);

  /**
   * Transforms screen mouse event coordinates into image-space pixel coordinates.
   */
  const toCanvasCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point2D => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / Math.max(1, rect.width);
      const scaleY = canvas.height / Math.max(1, rect.height);
      return {
        x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX)),
        y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY)),
      };
    },
    []
  );

  const findPointNear = useCallback(
    (pt: Point2D, thresholdPx = 12): number => {
      const scale = 1 / Math.max(0.2, zoom);
      const hitDist = thresholdPx * scale;
      for (let i = points.length - 1; i >= 0; i--) {
        if (Math.hypot(points[i].x - pt.x, points[i].y - pt.y) <= hitDist) {
          return i;
        }
      }
      return -1;
    },
    [points, zoom]
  );

  // Global Keyboard Navigation (Backspace to undo point, Enter to close/apply, Esc to cancel)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (isClosed) {
          setIsClosed(false);
        } else {
          setPoints((prev) => prev.slice(0, -1));
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!isClosed && points.length >= 3) {
          setIsClosed(true);
        } else if (isClosed && points.length >= 3) {
          const result = applyLassoMask(sourceImageData, points);
          onApplyLasso(result, points);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isClosed, points, sourceImageData, onApplyLasso, onCancel]);

  // Main Canvas Render Loop
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (sourceCanvasRef.current) {
      ctx.drawImage(sourceCanvasRef.current, 0, 0);
    } else {
      ctx.putImageData(sourceImageData, 0, 0);
    }

    if (points.length === 0) return;

    ctx.save();
    const effectiveZoom = Math.max(0.2, zoom);
    const strokeWidth = Math.max(1.2, 1.8 / effectiveZoom);
    const dashLength = Math.max(3, 5 / effectiveZoom);

    // 1. Draw Path Boundary
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }

    if (isClosed) {
      ctx.closePath();
      // Translucent indigo selection fill
      ctx.fillStyle = 'rgba(79, 70, 229, 0.22)';
      ctx.fill();
    } else if (hoverPt) {
      // Dynamic rubber-band segment to cursor or start-snap
      if (isNearStart && points.length >= 3) {
        ctx.lineTo(points[0].x, points[0].y);
      } else {
        ctx.lineTo(hoverPt.x, hoverPt.y);
      }
    }

    // High-contrast dual stroke (White base + Indigo dash for crisp visibility on dark & light photos)
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.setLineDash([dashLength, dashLength]);
    ctx.strokeStyle = '#4f46e5';
    ctx.stroke();
    ctx.restore();

    // 2. Render Anchor Handles (Photoshop style: tiny crisp squares, NOT giant spheres)
    ctx.save();
    const anchorSize = Math.max(3, 4.5 / effectiveZoom);

    if (isClosed) {
      // Loop is closed: show tiny draggable anchor squares
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const isHovered = hoveredVertexIndex === i;

        ctx.beginPath();
        const s = isHovered ? anchorSize * 1.5 : anchorSize;
        ctx.rect(pt.x - s, pt.y - s, s * 2, s * 2);
        ctx.fillStyle = isHovered ? '#38bdf8' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = Math.max(1, 1.2 / effectiveZoom);
        ctx.strokeStyle = isHovered ? '#0284c7' : '#4f46e5';
        ctx.stroke();
      }
    } else {
      // In-progress drawing: show small origin dot and start-snap indicator
      if (points.length > 0) {
        const start = points[0];
        ctx.beginPath();
        if (isNearStart && points.length >= 3) {
          // Snap target ring indicator
          const snapRadius = Math.max(6, 10 / effectiveZoom);
          ctx.arc(start.x, start.y, snapRadius, 0, Math.PI * 2);
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = Math.max(1.5, 2.5 / effectiveZoom);
          ctx.stroke();
          ctx.fillStyle = 'rgba(16, 185, 129, 0.4)';
          ctx.fill();
        } else {
          // Small origin anchor
          ctx.arc(start.x, start.y, anchorSize * 1.3, 0, Math.PI * 2);
          ctx.fillStyle = '#10b981';
          ctx.fill();
          ctx.lineWidth = Math.max(1, 1.2 / effectiveZoom);
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }, [points, isClosed, hoverPt, isNearStart, hoveredVertexIndex, zoom, sourceImageData]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (isPanning || e.button !== 0) return;
    e.stopPropagation();
    const pt = toCanvasCoords(e);

    if (isClosed) {
      // When closed, clicking an anchor allows dragging it
      const vertexIdx = findPointNear(pt);
      if (vertexIdx !== -1) {
        draggingPointRef.current = vertexIdx;
      }
      return;
    }

    // While path is open:
    if (points.length >= 3 && isNearStart) {
      // Clicked on starting origin -> Close the shape!
      setIsClosed(true);
      setHoverPt(null);
      return;
    }

    // Add point
    setPoints((prev) => [...prev, pt]);
    isMouseDownRef.current = true;
    lastStreamPointRef.current = pt;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (isPanning) return;
    const pt = toCanvasCoords(e);
    setHoverPt(pt);

    if (isClosed) {
      // Handle vertex dragging
      if (draggingPointRef.current !== null) {
        const idx = draggingPointRef.current;
        setPoints((prev) => prev.map((p, i) => (i === idx ? pt : p)));
      } else {
        const hoverIdx = findPointNear(pt);
        setHoveredVertexIndex(hoverIdx !== -1 ? hoverIdx : null);
      }
      return;
    }

    // Check proximity to origin start point (within 14px threshold)
    if (points.length >= 3) {
      const startPt = points[0];
      const dist = Math.hypot(pt.x - startPt.x, pt.y - startPt.y);
      setIsNearStart(dist <= 14 / Math.max(0.2, zoom));
    } else {
      setIsNearStart(false);
    }

    // Freehand continuous drag mode: record points if mouse is held down
    if (isMouseDownRef.current && lastStreamPointRef.current) {
      const dist = Math.hypot(
        pt.x - lastStreamPointRef.current.x,
        pt.y - lastStreamPointRef.current.y
      );
      // Stream spacing proportional to zoom (avoids excessive point density)
      const minSpacing = Math.max(4, 7 / Math.max(0.2, zoom));
      if (dist >= minSpacing) {
        setPoints((prev) => [...prev, pt]);
        lastStreamPointRef.current = pt;
      }
    }
  };

  const handleMouseUp = (): void => {
    draggingPointRef.current = null;
    isMouseDownRef.current = false;
    // CRITICAL: We NEVER force-close or discard points on mouse-up!
    // The user can release touchpad/mouse, pause, zoom in, and click or drag next segment!
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    e.stopPropagation();
    if (!isClosed && points.length >= 3) {
      setIsClosed(true);
    }
  };

  const handleUndoPoint = (): void => {
    if (isClosed) {
      setIsClosed(false);
    } else {
      setPoints((prev) => prev.slice(0, -1));
    }
  };

  const handleConfirm = (): void => {
    if (points.length < 3) return;
    const finalPoints = isClosed ? points : [...points, points[0]];
    const result = applyLassoMask(sourceImageData, finalPoints);
    onApplyLasso(result, finalPoints);
  };

  const cursorStyle = isPanning
    ? 'grab'
    : isClosed
    ? hoveredVertexIndex !== null
      ? 'move'
      : 'default'
    : isNearStart && points.length >= 3
    ? 'pointer'
    : 'crosshair';

  return (
    <div style={{ display: 'inline-block', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={sourceImageData.width}
        height={sourceImageData.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setHoverPt(null);
          setIsNearStart(false);
          isMouseDownRef.current = false;
        }}
        onDoubleClick={handleDoubleClick}
        style={{
          display: 'block',
          cursor: cursorStyle,
          boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
        }}
      />

      {/* Permanently Docked Bottom Control Bar (Fixed to bottom of workspace, NEVER overlaps image!) */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: '315px', // Exact width of the editor right sidebar
          height: '52px',
          backgroundColor: '#16161a',
          borderTop: '1px solid #2b2b34',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 18px',
          zIndex: 45,
          boxShadow: '0 -4px 18px rgba(0,0,0,0.45)',
          boxSizing: 'border-box',
        }}
      >
        {/* Left Side: Status & Guidance */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 8px',
              borderRadius: '5px',
              backgroundColor: '#23232c',
              border: '1px solid #363644',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: isClosed ? '#10b981' : points.length > 0 ? '#f59e0b' : '#6b7280',
              }}
            />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f3f4f6' }}>
              {isClosed ? 'Path Closed' : `${points.length} points`}
            </span>
          </div>

          <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
            {points.length === 0 ? (
              'Click along subject edge or drag for smooth curve'
            ) : !isClosed ? (
              <span>
                Click to place vertices • Drag for curves • <b>Backspace</b> to undo point • Click origin or <b>Enter</b> to close
              </span>
            ) : (
              <span style={{ color: '#10b981', fontWeight: 500 }}>
                ✨ Boundary ready! Drag any square anchor to fine-tune • Press <b>Enter</b> to apply cut
              </span>
            )}
          </span>
        </div>

        {/* Right Side: Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            disabled={points.length === 0}
            onClick={handleUndoPoint}
            title="Shortcut: Backspace or Delete"
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #3d3d4a',
              backgroundColor: points.length === 0 ? '#1e1e24' : '#272732',
              color: points.length === 0 ? '#555' : '#e2e8f0',
              cursor: points.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '0.78rem',
              fontWeight: 500,
            }}
          >
            ⌫ Undo Point (Backspace)
          </button>

          <button
            type="button"
            disabled={points.length === 0}
            onClick={() => {
              setPoints([]);
              setIsClosed(false);
            }}
            style={{
              padding: '6px 11px',
              borderRadius: '6px',
              border: '1px solid #3d3d4a',
              backgroundColor: '#22222a',
              color: points.length === 0 ? '#555' : '#cbd5e1',
              cursor: points.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '0.78rem',
            }}
          >
            Clear Path
          </button>

          <button
            type="button"
            onClick={onCancel}
            title="Shortcut: Escape"
            style={{
              padding: '6px 11px',
              borderRadius: '6px',
              border: '1px solid #3d3d4a',
              backgroundColor: 'transparent',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '0.78rem',
            }}
          >
            Cancel (Esc)
          </button>

          {!isClosed ? (
            <button
              type="button"
              disabled={points.length < 3}
              onClick={() => setIsClosed(true)}
              title="Shortcut: Enter or Double-Click"
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid #4f46e5',
                backgroundColor: points.length >= 3 ? '#4f46e5' : '#2a2a38',
                color: points.length >= 3 ? '#ffffff' : '#6b7280',
                fontWeight: 600,
                cursor: points.length >= 3 ? 'pointer' : 'not-allowed',
                fontSize: '0.8rem',
              }}
            >
              Close Shape (Enter)
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              title="Shortcut: Enter"
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#10b981',
                color: '#ffffff',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '0.82rem',
                boxShadow: '0 2px 10px rgba(16, 185, 129, 0.4)',
              }}
            >
              ✨ Apply Lasso Cut (Enter)
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
