import { extractAlphaMask } from './mask';

export interface OutlineOptions {
  thickness: number; // 0 - 40 px
  color: string; // Hex color (default #ffffff)
  dropShadow: boolean;
  shadowBlur: number;
  shadowOffsetY: number;
  shadowOpacity: number;
}

export const DEFAULT_OUTLINE_OPTIONS: OutlineOptions = {
  thickness: 12,
  color: '#ffffff',
  dropShadow: true,
  shadowBlur: 10,
  shadowOffsetY: 4,
  shadowOpacity: 0.35,
};

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r: isNaN(r) ? 255 : r, g: isNaN(g) ? 255 : g, b: isNaN(b) ? 255 : b };
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return { r: isNaN(r) ? 255 : r, g: isNaN(g) ? 255 : g, b: isNaN(b) ? 255 : b };
}

/**
 * Exact 2D Squared Euclidean Distance Transform (Meijster algorithm) in O(W * H).
 * Dilates a binary alpha mask by `radius` pixels accurately.
 */
function dilateMaskEDT(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const INF = 1e9;
  const g = new Float32Array(width * height);

  // Pass 1: Vertical 1D distance transform
  for (let x = 0; x < width; x++) {
    let dist = mask[x] > 0 ? 0 : INF;
    g[x] = dist;
    for (let y = 1; y < height; y++) {
      const idx = y * width + x;
      dist = mask[idx] > 0 ? 0 : dist + 1;
      g[idx] = dist;
    }
    for (let y = height - 2; y >= 0; y--) {
      const idx = y * width + x;
      const below = g[(y + 1) * width + x] + 1;
      if (below < g[idx]) {
        g[idx] = below;
      }
    }
  }

  // Pass 2: Horizontal 1D parabolic lower envelope
  const dilated = new Uint8Array(width * height);
  const rSq = radius * radius;
  const s = new Int32Array(width);
  const t = new Int32Array(width);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let q = 0;
    s[0] = 0;
    t[0] = 0;

    const f = (x: number, i: number): number => {
      const dx = x - i;
      const gi = g[rowOffset + i];
      return dx * dx + gi * gi;
    };

    const sep = (i: number, u: number): number => {
      const gi = g[rowOffset + i];
      const gu = g[rowOffset + u];
      return Math.floor((u * u - i * i + gu * gu - gi * gi) / (2 * (u - i)));
    };

    for (let u = 1; u < width; u++) {
      while (q >= 0 && f(t[q], s[q]) > f(t[q], u)) {
        q--;
      }
      if (q < 0) {
        q = 0;
        s[0] = u;
      } else {
        const w = 1 + sep(s[q], u);
        if (w < width) {
          q++;
          s[q] = u;
          t[q] = w;
        }
      }
    }

    for (let u = width - 1; u >= 0; u--) {
      const dSq = f(u, s[q]);
      dilated[rowOffset + u] = dSq <= rSq ? 255 : 0;
      if (u === t[q]) {
        q--;
      }
    }
  }

  return dilated;
}

/**
 * Renders the die-cut sticker (dilated + smoothed outline, original image on top, optional drop shadow).
 */
export function renderDieCutSticker(source: ImageData, options: OutlineOptions): HTMLCanvasElement {
  const shadowMargin = options.dropShadow
    ? Math.ceil(options.shadowBlur * 2 + Math.abs(options.shadowOffsetY) + 4)
    : 0;
  const padding = Math.ceil(options.thickness) + shadowMargin + 8;

  const outWidth = source.width + padding * 2;
  const outHeight = source.height + padding * 2;

  const paddedCanvas = document.createElement('canvas');
  paddedCanvas.width = outWidth;
  paddedCanvas.height = outHeight;
  const paddedCtx = paddedCanvas.getContext('2d');
  if (!paddedCtx) {
    throw new Error('Could not initialize padded canvas context');
  }
  paddedCtx.putImageData(source, padding, padding);

  if (options.thickness <= 0 && !options.dropShadow) {
    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = source.width;
    rawCanvas.height = source.height;
    const rawCtx = rawCanvas.getContext('2d');
    if (rawCtx) {
      rawCtx.putImageData(source, 0, 0);
    }
    return rawCanvas;
  }

  let compositeLayer: HTMLCanvasElement = paddedCanvas;

  if (options.thickness > 0) {
    const paddedData = paddedCtx.getImageData(0, 0, outWidth, outHeight);
    const alphaMask = extractAlphaMask(paddedData, 16);
    const dilatedMask = dilateMaskEDT(alphaMask, outWidth, outHeight, options.thickness);

    const rawMaskCanvas = document.createElement('canvas');
    rawMaskCanvas.width = outWidth;
    rawMaskCanvas.height = outHeight;
    const rawMaskCtx = rawMaskCanvas.getContext('2d');
    if (!rawMaskCtx) {
      throw new Error('Could not initialize mask canvas context');
    }

    const maskImgData = rawMaskCtx.createImageData(outWidth, outHeight);
    for (let i = 0; i < dilatedMask.length; i++) {
      const a = dilatedMask[i];
      const p = i * 4;
      maskImgData.data[p] = 255;
      maskImgData.data[p + 1] = 255;
      maskImgData.data[p + 2] = 255;
      maskImgData.data[p + 3] = a;
    }
    rawMaskCtx.putImageData(maskImgData, 0, 0);

    // Smooth corners with blur + threshold ramp and fill with outline color
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = outWidth;
    blurCanvas.height = outHeight;
    const blurCtx = blurCanvas.getContext('2d');
    if (!blurCtx) {
      throw new Error('Could not initialize blur canvas context');
    }

    const smoothRadius = Math.max(1.5, Math.min(6, options.thickness * 0.22));
    blurCtx.filter = `blur(${smoothRadius}px)`;
    blurCtx.drawImage(rawMaskCanvas, 0, 0);
    blurCtx.filter = 'none';

    const blurredData = blurCtx.getImageData(0, 0, outWidth, outHeight);
    const bPixels = blurredData.data;
    const { r, g, b } = parseHexColor(options.color);

    for (let i = 0; i < bPixels.length; i += 4) {
      const a = bPixels[i + 3];
      bPixels[i] = r;
      bPixels[i + 1] = g;
      bPixels[i + 2] = b;
      if (a < 110) {
        bPixels[i + 3] = 0;
      } else if (a > 145) {
        bPixels[i + 3] = 255;
      } else {
        bPixels[i + 3] = Math.round(((a - 110) / 35) * 255);
      }
    }

    blurCtx.putImageData(blurredData, 0, 0);
    blurCtx.drawImage(paddedCanvas, 0, 0);
    compositeLayer = blurCanvas;
  }

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outWidth;
  outputCanvas.height = outHeight;
  const outCtx = outputCanvas.getContext('2d');
  if (!outCtx) {
    throw new Error('Could not initialize output canvas context');
  }

  if (options.dropShadow) {
    outCtx.save();
    outCtx.shadowColor = `rgba(0, 0, 0, ${options.shadowOpacity})`;
    outCtx.shadowBlur = options.shadowBlur;
    outCtx.shadowOffsetX = 0;
    outCtx.shadowOffsetY = options.shadowOffsetY;
    outCtx.drawImage(compositeLayer, 0, 0);
    outCtx.restore();
  } else {
    outCtx.drawImage(compositeLayer, 0, 0);
  }

  return trimTransparentBounds(outputCanvas, 4);
}

function trimTransparentBounds(canvas: HTMLCanvasElement, margin = 4): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return canvas;
  }

  const cropX = Math.max(0, minX - margin);
  const cropY = Math.max(0, minY - margin);
  const cropW = Math.min(width - cropX, maxX - minX + 1 + margin * 2);
  const cropH = Math.min(height - cropY, maxY - minY + 1 + margin * 2);

  const trimmed = document.createElement('canvas');
  trimmed.width = cropW;
  trimmed.height = cropH;
  const trimmedCtx = trimmed.getContext('2d');
  if (trimmedCtx) {
    trimmedCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  }
  return trimmed;
}
