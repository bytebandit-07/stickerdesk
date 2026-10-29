export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });
}

export async function imageUrlToImageData(src: string): Promise<ImageData> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context');
  }
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function imageDataToDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context');
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export function cloneImageData(source: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
}

export function cropImageData(source: ImageData, crop: PixelCrop): ImageData {
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = source.width;
  sourceCanvas.height = source.height;
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    throw new Error('Could not initialize source 2D context');
  }
  sourceCtx.putImageData(source, 0, 0);

  const safeWidth = Math.max(1, Math.round(crop.width));
  const safeHeight = Math.max(1, Math.round(crop.height));

  const destCanvas = document.createElement('canvas');
  destCanvas.width = safeWidth;
  destCanvas.height = safeHeight;
  const destCtx = destCanvas.getContext('2d');
  if (!destCtx) {
    throw new Error('Could not initialize destination 2D context');
  }

  destCtx.drawImage(
    sourceCanvas,
    Math.round(crop.x),
    Math.round(crop.y),
    safeWidth,
    safeHeight,
    0,
    0,
    safeWidth,
    safeHeight
  );

  return destCtx.getImageData(0, 0, safeWidth, safeHeight);
}

/**
 * Applies a freehand lasso path to `source`: pixels outside the closed polygon
 * have their alpha set to 0, and the result is cropped tightly to the path's bounding box.
 */
export function applyLassoMask(source: ImageData, points: Point2D[]): ImageData {
  if (points.length < 3) {
    return cloneImageData(source);
  }

  const { width, height } = source;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) {
    throw new Error('Could not initialize lasso mask context');
  }

  maskCtx.fillStyle = '#ffffff';
  maskCtx.beginPath();
  maskCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    maskCtx.lineTo(points[i].x, points[i].y);
  }
  maskCtx.closePath();
  maskCtx.fill();

  const maskPixels = maskCtx.getImageData(0, 0, width, height).data;
  const output = cloneImageData(source);
  const outPixels = output.data;

  for (let i = 0; i < outPixels.length; i += 4) {
    if (maskPixels[i + 3] === 0) {
      outPixels[i + 3] = 0;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (const pt of points) {
    minX = Math.max(0, Math.min(minX, Math.floor(pt.x)));
    minY = Math.max(0, Math.min(minY, Math.floor(pt.y)));
    maxX = Math.min(width, Math.max(maxX, Math.ceil(pt.x)));
    maxY = Math.min(height, Math.max(maxY, Math.ceil(pt.y)));
  }

  if (maxX > minX && maxY > minY) {
    return cropImageData(output, {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
  }

  return output;
}

/**
 * Extracts a binary alpha mask (0 or 255) from an ImageData buffer.
 */
export function extractAlphaMask(source: ImageData, threshold = 16): Uint8Array {
  const totalPixels = source.width * source.height;
  const mask = new Uint8Array(totalPixels);
  const data = source.data;

  for (let i = 0; i < totalPixels; i++) {
    mask[i] = data[i * 4 + 3] >= threshold ? 255 : 0;
  }

  return mask;
}

/**
 * Applies a continuous circular brush stroke from `from` to `to`.
 * - 'erase': zeroes out the pixel alpha channel.
 * - 'restore': restores original RGB + alpha values from `referenceOriginal`.
 */
export function applyBrushSegment(
  working: ImageData,
  referenceOriginal: ImageData,
  from: Point2D,
  to: Point2D,
  radius: number,
  mode: 'erase' | 'restore'
): void {
  const width = working.width;
  const height = working.height;
  const workData = working.data;
  const origData = referenceOriginal.data;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.25)));
  const rSq = radius * radius;

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;

    const startX = Math.max(0, Math.floor(cx - radius));
    const endX = Math.min(width - 1, Math.ceil(cx + radius));
    const startY = Math.max(0, Math.floor(cy - radius));
    const endY = Math.min(height - 1, Math.ceil(cy + radius));

    for (let y = startY; y <= endY; y++) {
      const yOffset = y * width;
      const distY = y - cy;
      for (let x = startX; x <= endX; x++) {
        const distX = x - cx;
        if (distX * distX + distY * distY <= rSq) {
          const idx = (yOffset + x) * 4;
          if (mode === 'erase') {
            workData[idx + 3] = 0;
          } else {
            workData[idx] = origData[idx];
            workData[idx + 1] = origData[idx + 1];
            workData[idx + 2] = origData[idx + 2];
            workData[idx + 3] = origData[idx + 3];
          }
        }
      }
    }
  }
}
