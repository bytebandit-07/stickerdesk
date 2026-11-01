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

export async function imageUrlToImageData(src: string, maxDimension = 1600): Promise<ImageData> {
  const img = await loadImage(src);
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;

  // Proportionally cap oversized images (e.g. 4K/6K wallpapers) to maxDimension.
  // Prevents multi-gigabyte memory consumption while preserving crystal-clear Retina quality.
  if (w > maxDimension || h > maxDimension) {
    const scale = maxDimension / Math.max(w, h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context');
  }
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
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
 * Applies a continuous circular brush stroke from `from` to `to` with variable hardness/feathering.
 * @param hardness Normalized hardness in [0.0, 1.0] (0.0 = fully feathered Gaussian-like falloff, 1.0 = razor sharp).
 * @returns The bounding box (PixelCrop) of the modified pixels for high-speed dirty-rectangle canvas blits.
 */
export function applyBrushSegment(
  working: ImageData,
  referenceOriginal: ImageData,
  from: Point2D,
  to: Point2D,
  radius: number,
  mode: 'erase' | 'restore',
  hardness = 0.85
): PixelCrop {
  const width = working.width;
  const height = working.height;
  const workData = working.data;
  const origData = referenceOriginal.data;

  const safeRadius = Math.max(1, radius);
  const clampedHardness = Math.max(0, Math.min(1, hardness));
  const innerRadius = safeRadius * clampedHardness;
  const innerRadiusSq = innerRadius * innerRadius;
  const falloffSpan = Math.max(1e-4, safeRadius - innerRadius);

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const stepSpacing = Math.max(1, safeRadius * (clampedHardness < 0.95 ? 0.3 : 0.45));
  const steps = Math.max(1, Math.ceil(dist / stepSpacing));
  const rSq = safeRadius * safeRadius;

  const minModX = Math.max(0, Math.floor(Math.min(from.x, to.x) - safeRadius));
  const maxModX = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + safeRadius));
  const minModY = Math.max(0, Math.floor(Math.min(from.y, to.y) - safeRadius));
  const maxModY = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + safeRadius));

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;

    const startX = Math.max(0, Math.floor(cx - safeRadius));
    const endX = Math.min(width - 1, Math.ceil(cx + safeRadius));
    const startY = Math.max(0, Math.floor(cy - safeRadius));
    const endY = Math.min(height - 1, Math.ceil(cy + safeRadius));

    for (let y = startY; y <= endY; y++) {
      const yOffset = y * width;
      const distY = y - cy;
      for (let x = startX; x <= endX; x++) {
        const distX = x - cx;
        const dSq = distX * distX + distY * distY;
        if (dSq <= rSq) {
          let strength = 1.0;
          if (dSq > innerRadiusSq) {
            const d = Math.sqrt(dSq);
            const norm = Math.max(0, Math.min(1, 1 - (d - innerRadius) / falloffSpan));
            // Smoothstep falloff curve
            strength = norm * norm * (3 - 2 * norm);
          }

          const idx = (yOffset + x) * 4;
          if (mode === 'erase') {
            const currentAlpha = workData[idx + 3];
            const targetAlpha = Math.round(currentAlpha * (1 - strength));
            if (targetAlpha < currentAlpha) {
              workData[idx + 3] = targetAlpha;
            }
          } else {
            const origAlpha = origData[idx + 3];
            const currentAlpha = workData[idx + 3];
            const blendedAlpha = Math.min(
              origAlpha,
              Math.round(currentAlpha + (origAlpha - currentAlpha) * strength)
            );
            workData[idx] = origData[idx];
            workData[idx + 1] = origData[idx + 1];
            workData[idx + 2] = origData[idx + 2];
            if (blendedAlpha > currentAlpha) {
              workData[idx + 3] = blendedAlpha;
            }
          }
        }
      }
    }
  }

  return {
    x: minModX,
    y: minModY,
    width: Math.max(1, maxModX - minModX + 1),
    height: Math.max(1, maxModY - minModY + 1),
  };
}

/**
 * 1-Click Edge Defringe Filter:
 * 1. Erodes 1-2px semi-transparent boundary fringe artifacts left by AI background segmentation.
 * 2. Decontaminates edge RGB colors by bleeding opaque interior pixel colors outward into the alpha ramp.
 */
export function defringeImageData(source: ImageData, strengthPx = 1.5): ImageData {
  const { width, height } = source;
  const src = source.data;
  const out = cloneImageData(source);
  const dst = out.data;

  const alphaCopy = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    alphaCopy[i] = src[i * 4 + 3];
  }

  // Pass 1: Erode low-alpha boundary halo and sharpen soft semi-transparent fringe
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const a = alphaCopy[i];
      if (a === 0) continue;

      const minNeighborAlpha = Math.min(
        alphaCopy[i - 1],
        alphaCopy[i + 1],
        alphaCopy[i - width],
        alphaCopy[i + width],
        alphaCopy[i - width - 1],
        alphaCopy[i - width + 1],
        alphaCopy[i + width - 1],
        alphaCopy[i + width + 1]
      );

      // If pixel sits on the outer boundary next to transparency
      if (minNeighborAlpha < 210) {
        const eroded = Math.max(0, a - Math.round(78 * strengthPx));
        // Apply contrast ramp to eliminate wispy ghost pixels
        dst[i * 4 + 3] = eroded < 42 ? 0 : Math.min(255, Math.round((eroded - 42) * 1.25));
      }
    }
  }

  // Pass 2: Color decontamination — replace semi-transparent edge RGB with nearest solid interior RGB
  for (let y = 2; y < height - 2; y++) {
    const row = y * width;
    for (let x = 2; x < width - 2; x++) {
      const i = row + x;
      const a = dst[i * 4 + 3];
      if (a > 0 && a < 235) {
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;

        for (let dy = -2; dy <= 2; dy++) {
          const nRow = (y + dy) * width;
          for (let dx = -2; dx <= 2; dx++) {
            const ni = nRow + (x + dx);
            if (alphaCopy[ni] >= 240) {
              const p = ni * 4;
              rSum += src[p];
              gSum += src[p + 1];
              bSum += src[p + 2];
              count++;
            }
          }
        }

        if (count > 0) {
          const p = i * 4;
          dst[p] = Math.round(rSum / count);
          dst[p + 1] = Math.round(gSum / count);
          dst[p + 2] = Math.round(bSum / count);
        }
      }
    }
  }

  return out;
}
