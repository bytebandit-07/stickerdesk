import React, { useState, useCallback } from 'react';
import Cropper, { Area, Point } from 'react-easy-crop';
import { PixelCrop } from '../../lib/image/mask';

interface CropToolProps {
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  onApplyCrop: (pixelCrop: PixelCrop) => void;
  onCancel: () => void;
}

type AspectPreset = 'free' | '1:1' | '4:3';

export const CropTool: React.FC<CropToolProps> = ({
  imageSrc,
  onApplyCrop,
  onCancel,
}) => {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [preset, setPreset] = useState<AspectPreset>('free');
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const onCropComplete = useCallback((_croppedArea: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const currentAspect: number | undefined =
    preset === '1:1' ? 1 : preset === '4:3' ? 4 / 3 : undefined;

  const handleConfirm = (): void => {
    if (!croppedAreaPixels) return;
    onApplyCrop({
      x: croppedAreaPixels.x,
      y: croppedAreaPixels.y,
      width: croppedAreaPixels.width,
      height: croppedAreaPixels.height,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: '380px',
          backgroundColor: '#0d0d0d',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={currentAspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      <div
        style={{
          marginTop: '12px',
          padding: '12px 16px',
          backgroundColor: '#1e1e1e',
          borderRadius: '8px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.85rem', color: '#aaa' }}>Aspect:</span>
          {(['free', '1:1', '4:3'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPreset(item)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #3a3a3a',
                backgroundColor: preset === item ? '#4f46e5' : '#2a2a2a',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 600,
              }}
            >
              {item === 'free' ? 'Free' : item}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.85rem', color: '#aaa' }}>Zoom:</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '6px 14px',
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
            onClick={handleConfirm}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#10b981',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Apply Crop
          </button>
        </div>
      </div>
    </div>
  );
};
