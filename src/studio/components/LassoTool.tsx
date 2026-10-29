import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Point2D, applyLassoMask } from '../../lib/image/mask';

interface LassoToolProps {
  sourceImageData: ImageData;
  onApplyLasso: (newImageData: ImageData) => void;
  onCancel: () => void;
}

export const LassoTool: React.FC<LassoToolProps> = ({
  sourceImageData,
  onApplyLasso,
  onCancel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const pt = toCanvasCoords(e);
    setIsDrawing(true);
    setPoints([pt]);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!isDrawing) return;
    const pt = toCanvasCoords(e);
    setPoints((prev) => [...prev, pt]);
  };

  const handleMouseUp = (): void => {
    setIsDrawing(false);
  };

  const handleConfirm = (): void => {
    if (points.length < 3) return;
    const result = applyLassoMask(sourceImageData, points);
    onApplyLasso(result);
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
          Draw a freehand loop around the area to keep. Everything outside becomes transparent.
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
