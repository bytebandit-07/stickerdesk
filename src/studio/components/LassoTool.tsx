import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Point2D, applyLassoMask } from '../../lib/image/mask';

interface LassoToolProps {
  sourceImageData: ImageData;
  onApplyLasso: (newImageData: ImageData, path: Point2D[]) => void;
  onCancel: () => void;
}

// Freehand drawing produces hundreds of points. Keep the boundary editable by
// thinning it down to a manageable number of draggable vertices.
const MAX_EDITABLE_VERTICES = 32;

function simplifyPoints(input: Point2D[]): Point2D[] {
  if (input.length <= MAX_EDITABLE_VERTICES) return input;

  const step = input.length / MAX_EDITABLE_VERTICES;
  const result: Point2D[] = [];
  for (let i = 0; i < MAX_EDITABLE_VERTICES; i++) {
    result.push(input[Math.min(input.length - 1, Math.round(i * step))]);
  }
  result[result.length - 1] = input[input.length - 1];
  return result;
}

export const LassoTool: React.FC<LassoToolProps> = ({
  sourceImageData,
  onApplyLasso,
  onCancel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingPointRef = useRef<number | null>(null);
  const [points, setPoints] = useState<Point2D[]>([]);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);

  const renderCanvas = useCallback(
    (currentPoints: Point2D[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.putImageData(sourceImageData, 0, 0);

      if (currentPoints.length > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(currentPoints[0].x, currentPoints[0].y);
        for (let i = 1; i < currentPoints.length; i++) {
          ctx.lineTo(currentPoints[i].x, currentPoints[i].y);
        }
        if (!isDrawing && currentPoints.length > 2) {
          ctx.closePath();
          ctx.fillStyle = 'rgba(79, 70, 229, 0.22)';
          ctx.fill();
        }
        ctx.lineWidth = Math.max(2, Math.round(sourceImageData.width / 250));
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = '#4f46e5';
        ctx.stroke();
        ctx.restore();

        // Editable boundary: show draggable vertices once the loop is closed.
        if (!isDrawing) {
          const handleRadius = Math.max(4, Math.round(sourceImageData.width / 140));
          ctx.save();
          ctx.setLineDash([]);
          for (const pt of currentPoints) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, handleRadius, 0, Math.PI * 2);
            ctx.fillStyle = '#4f46e5';
            ctx.fill();
            ctx.lineWidth = Math.max(1, handleRadius / 3);
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    },
    [sourceImageData, isDrawing]
  );

  useEffect(() => {
    renderCanvas(points);
  }, [points, renderCanvas]);

  const toCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>): Point2D => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const findPointNear = (pt: Point2D): number => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / Math.max(1, rect.width);
    const hitRadius = 10 * scale;
    for (let i = points.length - 1; i >= 0; i--) {
      if (Math.hypot(points[i].x - pt.x, points[i].y - pt.y) <= hitRadius) {
        return i;
      }
    }
    return -1;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    const pt = toCanvasCoords(e);

    // Grab an existing vertex to adjust the boundary instead of starting a new loop.
    if (!isDrawing && points.length > 2) {
      const pointIndex = findPointNear(pt);
      if (pointIndex !== -1) {
        draggingPointRef.current = pointIndex;
        return;
      }
    }

    draggingPointRef.current = null;
    setIsDrawing(true);
    setPoints([pt]);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (draggingPointRef.current !== null) {
      const pt = toCanvasCoords(e);
      const index = draggingPointRef.current;
      setPoints((prev) => prev.map((point, i) => (i === index ? pt : point)));
      return;
    }

    if (!isDrawing) return;
    const pt = toCanvasCoords(e);
    setPoints((prev) => [...prev, pt]);
  };

  const handleMouseUp = (): void => {
    if (draggingPointRef.current !== null) {
      draggingPointRef.current = null;
      return;
    }
    if (isDrawing) {
      setPoints((prev) => (prev.length > 2 ? simplifyPoints(prev) : prev));
    }
    setIsDrawing(false);
  };

  const handleConfirm = (): void => {
    if (points.length < 3) return;
    const result = applyLassoMask(sourceImageData, points);
    onApplyLasso(result, points);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: '12px',
        }}
      >
        <canvas
          ref={canvasRef}
          width={sourceImageData.width}
          height={sourceImageData.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            maxWidth: '100%',
            maxHeight: '65vh',
            objectFit: 'contain',
            cursor: 'crosshair',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}
        />
      </div>

      <div
        style={{
          marginTop: '12px',
          padding: '12px 16px',
          backgroundColor: '#1e1e1e',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: '0.85rem', color: '#bbb' }}>
          Draw a freehand loop around the area to keep, then drag the dots to fine-tune the
          boundary. Everything outside becomes transparent.
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setPoints([])}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #444',
              backgroundColor: '#2a2a2a',
              color: '#ddd',
              cursor: 'pointer',
            }}
          >
            Clear Path
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #444',
              backgroundColor: 'transparent',
              color: '#ddd',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={points.length < 3}
            onClick={handleConfirm}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: points.length >= 3 ? '#10b981' : '#374151',
              color: '#fff',
              fontWeight: 600,
              cursor: points.length >= 3 ? 'pointer' : 'not-allowed',
            }}
          >
            Apply Lasso Cut
          </button>
        </div>
      </div>
    </div>
  );
};
