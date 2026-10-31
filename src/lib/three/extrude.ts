import * as THREE from 'three';
import { loadImage } from '../image/mask';

export type Sticker3DTheme = 'vinyl' | 'holographic' | 'epoxy' | 'enamel';

export interface Point2D {
  x: number;
  y: number;
}

export interface ExtrudedStickerResult {
  geometry: THREE.ExtrudeGeometry;
  texture: THREE.CanvasTexture;
  shadowTexture: THREE.CanvasTexture;
  sideColor: THREE.Color;
  worldWidth: number;
  worldHeight: number;
  extrudeDepth: number;
  aspectRatio: number;
}

interface ContourLoop {
  points: Point2D[];
  signedArea: number;
  absArea: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

const TRACE_MAX_DIM = 240;
const ALPHA_THRESHOLD = 12;
const MIN_LOOP_AREA_PX = 18;
const MAX_TOTAL_VERTICES = 260;

function computeSignedArea(pts: Point2D[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return area * 0.5;
}

function computeBBox(pts: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function perpendicularDistance(pt: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const magSq = dx * dx + dy * dy;
  if (magSq === 0) {
    return Math.hypot(pt.x - lineStart.x, pt.y - lineStart.y);
  }
  const u = ((pt.x - lineStart.x) * dx + (pt.y - lineStart.y) * dy) / magSq;
  const clampedU = Math.max(0, Math.min(1, u));
  const projX = lineStart.x + clampedU * dx;
  const projY = lineStart.y + clampedU * dy;
  return Math.hypot(pt.x - projX, pt.y - projY);
}

function rdpOpen(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 2) {
    return points;
  }

  let maxDist = 0;
  let splitIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      splitIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpOpen(points.slice(0, splitIdx + 1), epsilon);
    const right = rdpOpen(points.slice(splitIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

/**
 * Chaikin corner-cutting pass to give die-cut sticker contours smooth, organic curves.
 */
function smoothClosedLoopChaikin(points: Point2D[], maxVertices: number): Point2D[] {
  if (points.length < 4 || points.length * 2 > maxVertices) {
    return points;
  }
  const smoothed: Point2D[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    smoothed.push({
      x: 0.75 * p0.x + 0.25 * p1.x,
      y: 0.75 * p0.y + 0.25 * p1.y,
    });
    smoothed.push({
      x: 0.25 * p0.x + 0.75 * p1.x,
      y: 0.25 * p0.y + 0.75 * p1.y,
    });
  }
  return smoothed;
}

function simplifyClosedLoop(points: Point2D[], epsilon: number, maxVertices: number): Point2D[] {
  if (points.length <= 6) {
    return points;
  }

  let splitA = 0;
  let splitB = Math.floor(points.length / 2);
  let maxDistSq = -1;

  const step = Math.max(1, Math.floor(points.length / 30));
  for (let i = 0; i < points.length; i += step) {
    for (let j = i + step; j < points.length; j += step) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const dSq = dx * dx + dy * dy;
      if (dSq > maxDistSq) {
        maxDistSq = dSq;
        splitA = i;
        splitB = j;
      }
    }
  }

  const ordered =
    splitA < splitB
      ? points
      : [...points.slice(splitB), ...points.slice(0, splitB)];
  const idxA = splitA < splitB ? splitA : 0;
  const idxB = splitA < splitB ? splitB : splitA - splitB;

  let currentEpsilon = epsilon;
  let result: Point2D[] = ordered;

  for (let attempt = 0; attempt < 6; attempt++) {
    const half1 = ordered.slice(idxA, idxB + 1);
    const half2 = [...ordered.slice(idxB), ...ordered.slice(0, idxA + 1)];
    const s1 = rdpOpen(half1, currentEpsilon);
    const s2 = rdpOpen(half2, currentEpsilon);
    result = [...s1.slice(0, -1), ...s2.slice(0, -1)];

    if (result.length <= Math.floor(maxVertices * 0.55)) {
      break;
    }
    currentEpsilon *= 1.4;
  }

  const baseLoop = result.length >= 4 ? result : points.slice(0, Math.min(points.length, 4));
  return smoothClosedLoopChaikin(baseLoop, maxVertices);
}

function pointInPolygon(pt: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-10) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function traceMarchingSquaresLoops(
  alphaGrid: Uint8Array,
  gridW: number,
  gridH: number
): ContourLoop[] {
  const outgoingSegments = new Map<number, number[]>();

  const encodeVertex = (gx2: number, gy2: number): number => gy2 * (gridW * 2 + 2) + gx2;
  const decodeVertex = (key: number): Point2D => {
    const stride = gridW * 2 + 2;
    const gy2 = Math.floor(key / stride);
    const gx2 = key % stride;
    return { x: gx2 * 0.5, y: gy2 * 0.5 };
  };

  const addSegment = (fromGx2: number, fromGy2: number, toGx2: number, toGy2: number): void => {
    const kFrom = encodeVertex(fromGx2, fromGy2);
    const kTo = encodeVertex(toGx2, toGy2);
    const list = outgoingSegments.get(kFrom);
    if (list) {
      list.push(kTo);
    } else {
      outgoingSegments.set(kFrom, [kTo]);
    }
  };

  for (let y = 0; y < gridH - 1; y++) {
    for (let x = 0; x < gridW - 1; x++) {
      const tl = alphaGrid[y * gridW + x] > 0 ? 1 : 0;
      const tr = alphaGrid[y * gridW + (x + 1)] > 0 ? 1 : 0;
      const br = alphaGrid[(y + 1) * gridW + (x + 1)] > 0 ? 1 : 0;
      const bl = alphaGrid[(y + 1) * gridW + x] > 0 ? 1 : 0;

      const state = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (state === 0 || state === 15) continue;

      const topX2 = x * 2 + 1;
      const topY2 = y * 2;
      const rightX2 = x * 2 + 2;
      const rightY2 = y * 2 + 1;
      const bottomX2 = x * 2 + 1;
      const bottomY2 = y * 2 + 2;
      const leftX2 = x * 2;
      const leftY2 = y * 2 + 1;

      switch (state) {
        case 1:
          addSegment(leftX2, leftY2, bottomX2, bottomY2);
          break;
        case 2:
          addSegment(bottomX2, bottomY2, rightX2, rightY2);
          break;
        case 3:
          addSegment(leftX2, leftY2, rightX2, rightY2);
          break;
        case 4:
          addSegment(rightX2, rightY2, topX2, topY2);
          break;
        case 5:
          addSegment(leftX2, leftY2, topX2, topY2);
          addSegment(rightX2, rightY2, bottomX2, bottomY2);
          break;
        case 6:
          addSegment(bottomX2, bottomY2, topX2, topY2);
          break;
        case 7:
          addSegment(leftX2, leftY2, topX2, topY2);
          break;
        case 8:
          addSegment(topX2, topY2, leftX2, leftY2);
          break;
        case 9:
          addSegment(topX2, topY2, bottomX2, bottomY2);
          break;
        case 10:
          addSegment(topX2, topY2, rightX2, rightY2);
          addSegment(bottomX2, bottomY2, leftX2, leftY2);
          break;
        case 11:
          addSegment(topX2, topY2, rightX2, rightY2);
          break;
        case 12:
          addSegment(rightX2, rightY2, leftX2, leftY2);
          break;
        case 13:
          addSegment(rightX2, rightY2, bottomX2, bottomY2);
          break;
        case 14:
          addSegment(bottomX2, bottomY2, leftX2, leftY2);
          break;
        default:
          break;
      }
    }
  }

  const loops: ContourLoop[] = [];

  for (const [startKey, nextTargets] of outgoingSegments.entries()) {
    while (nextTargets.length > 0) {
      const points: Point2D[] = [];
      let currKey = startKey;
      const visitedInLoop = new Set<number>();

      while (true) {
        points.push(decodeVertex(currKey));
        const targets = outgoingSegments.get(currKey);
        if (!targets || targets.length === 0) break;
        const nextKey = targets.pop()!;
        if (nextKey === startKey || visitedInLoop.has(nextKey)) {
          break;
        }
        visitedInLoop.add(nextKey);
        currKey = nextKey;
      }

      if (points.length >= 6) {
        // Reverse points so that in Three.js (Y-up) space:
        // Outer boundaries are Counter-Clockwise (CCW, signedArea > 0)
        // Holes are Clockwise (CW, signedArea < 0)
        const reversedPoints = [...points].reverse();
        const threePoints = reversedPoints.map((p) => ({
          x: p.x,
          y: gridH - p.y,
        }));
        const signedArea = computeSignedArea(threePoints);
        const absArea = Math.abs(signedArea);
        if (absArea >= MIN_LOOP_AREA_PX) {
          loops.push({
            points: threePoints,
            signedArea,
            absArea,
            bbox: computeBBox(threePoints),
          });
        }
      }
    }
  }

  return loops;
}

function sampleOutlineColor(imageData: ImageData): THREE.Color {
  const { data, width, height } = imageData;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;

  const step = Math.max(1, Math.floor(Math.min(width, height) / 65));
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3];
      if (a > 200) {
        const upA = data[((y - 1) * width + x) * 4 + 3];
        const dnA = data[((y + 1) * width + x) * 4 + 3];
        const lfA = data[(y * width + (x - 1)) * 4 + 3];
        const rtA = data[(y * width + (x + 1)) * 4 + 3];
        if (upA < 30 || dnA < 30 || lfA < 30 || rtA < 30) {
          rSum += data[idx];
          gSum += data[idx + 1];
          bSum += data[idx + 2];
          count++;
        }
      }
    }
  }

  if (count === 0) {
    return new THREE.Color('#ffffff');
  }

  return new THREE.Color(
    rSum / (count * 255),
    gSum / (count * 255),
    bSum / (count * 255)
  );
}

/**
 * Generates a soft, blurred contact shadow texture matching the sticker's exact die-cut silhouette.
 */
function buildContactShadowTexture(sourceImg: HTMLImageElement): THREE.CanvasTexture {
  const size = 256;
  const pad = 28;
  const inner = size - pad * 2;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = size;
  maskCanvas.height = size;
  const maskCtx = maskCanvas.getContext('2d');

  if (maskCtx) {
    maskCtx.drawImage(sourceImg, 0, 0, sourceImg.width, sourceImg.height, pad, pad, inner, inner);
    maskCtx.globalCompositeOperation = 'source-in';
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, size, size);
  }

  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = size;
  blurCanvas.height = size;
  const blurCtx = blurCanvas.getContext('2d');

  if (blurCtx) {
    blurCtx.filter = 'blur(11px)';
    blurCtx.globalAlpha = 0.55;
    blurCtx.drawImage(maskCanvas, 0, 0);
    blurCtx.filter = 'none';
  }

  const shadowTex = new THREE.CanvasTexture(blurCanvas);
  shadowTex.needsUpdate = true;
  return shadowTex;
}

function getThemeExtrudeConfig(theme: Sticker3DTheme): {
  depth: number;
  bevelSegments: number;
  bevelSize: number;
  bevelThickness: number;
} {
  switch (theme) {
    case 'vinyl':
      // Realistic thin die-cut vinyl (~1.5mm feel) with smooth fillet edge
      return {
        depth: 1.6,
        bevelSegments: 5,
        bevelSize: 0.75,
        bevelThickness: 0.85,
      };
    case 'holographic':
      // Collector foil card thickness with crisp prism edge
      return {
        depth: 2.0,
        bevelSegments: 4,
        bevelSize: 0.8,
        bevelThickness: 0.9,
      };
    case 'epoxy':
      // Thick domed acrylic/resin charm with deep rounded dome bevel
      return {
        depth: 3.6,
        bevelSegments: 8,
        bevelSize: 2.2,
        bevelThickness: 2.8,
      };
    case 'enamel':
      // Raised metallic lapel pin badge
      return {
        depth: 3.2,
        bevelSegments: 4,
        bevelSize: 1.35,
        bevelThickness: 1.6,
      };
  }
}

export async function buildStickerExtrudeGeometry(
  imageUrl: string,
  theme: Sticker3DTheme = 'vinyl'
): Promise<ExtrudedStickerResult> {
  const img = await loadImage(imageUrl);
  const srcW = Math.max(1, img.naturalWidth || img.width);
  const srcH = Math.max(1, img.naturalHeight || img.height);
  const aspectRatio = srcW / srcH;

  const texCanvas = document.createElement('canvas');
  texCanvas.width = srcW;
  texCanvas.height = srcH;
  const texCtx = texCanvas.getContext('2d');
  if (!texCtx) {
    throw new Error('Failed to create 2D context for sticker texture');
  }
  texCtx.drawImage(img, 0, 0);
  const fullImageData = texCtx.getImageData(0, 0, srcW, srcH);
  const sideColor = sampleOutlineColor(fullImageData);

  const texture = new THREE.CanvasTexture(texCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  const shadowTexture = buildContactShadowTexture(img);

  const scale = Math.min(1, TRACE_MAX_DIM / Math.max(srcW, srcH));
  const innerW = Math.max(16, Math.round(srcW * scale));
  const innerH = Math.max(16, Math.round(srcH * scale));
  const pad = 3;
  const gridW = innerW + pad * 2;
  const gridH = innerH + pad * 2;

  const traceCanvas = document.createElement('canvas');
  traceCanvas.width = gridW;
  traceCanvas.height = gridH;
  const traceCtx = traceCanvas.getContext('2d');
  if (!traceCtx) {
    throw new Error('Failed to create 2D context for contour tracing');
  }
  traceCtx.drawImage(img, 0, 0, srcW, srcH, pad, pad, innerW, innerH);
  const traceData = traceCtx.getImageData(0, 0, gridW, gridH).data;

  const alphaGrid = new Uint8Array(gridW * gridH);
  for (let i = 0; i < gridW * gridH; i++) {
    alphaGrid[i] = traceData[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0;
  }

  const rawLoops = traceMarchingSquaresLoops(alphaGrid, gridW, gridH);

  const outerLoops = rawLoops
    .filter((l) => l.signedArea > 0)
    .sort((a, b) => b.absArea - a.absArea);
  const holeLoops = rawLoops
    .filter((l) => l.signedArea < 0)
    .sort((a, b) => b.absArea - a.absArea);

  // Safety guard: if outerLoops is empty but rawLoops has valid loops, the largest loop by area is the outer boundary
  if (outerLoops.length === 0 && rawLoops.length > 0) {
    const largest = [...rawLoops].sort((a, b) => b.absArea - a.absArea)[0];
    if (largest.signedArea < 0) {
      largest.points = largest.points.reverse();
      largest.signedArea = -largest.signedArea;
    }
    outerLoops.push(largest);
  }

  const worldScale = 100 / Math.max(innerW, innerH);
  const toWorldPoint = (pt: Point2D): THREE.Vector2 => {
    const unpaddedX = pt.x - pad;
    const unpaddedY = pt.y - pad;
    const wx = (unpaddedX - innerW * 0.5) * worldScale;
    const wy = (unpaddedY - innerH * 0.5) * worldScale;
    return new THREE.Vector2(wx, wy);
  };

  const shapes: THREE.Shape[] = [];

  if (outerLoops.length === 0) {
    const halfW = (innerW * worldScale) / 2;
    const halfH = (innerH * worldScale) / 2;
    const fallback = new THREE.Shape([
      new THREE.Vector2(-halfW, -halfH),
      new THREE.Vector2(halfW, -halfH),
      new THREE.Vector2(halfW, halfH),
      new THREE.Vector2(-halfW, halfH),
    ]);
    shapes.push(fallback);
  } else {
    const keptOuters = outerLoops.slice(0, 6);
    const maxPerOuter = Math.max(
      28,
      Math.floor(MAX_TOTAL_VERTICES / Math.max(1, keptOuters.length + holeLoops.length * 0.5))
    );

    const simplifiedOuters = keptOuters.map((loop) => {
      const simplifiedPts = simplifyClosedLoop(loop.points, 0.75, maxPerOuter);
      const worldPts = simplifiedPts.map(toWorldPoint);
      // Guarantee Counter-Clockwise (CCW) winding order for THREE.Shape
      const sArea = computeSignedArea(worldPts);
      const finalPts = sArea < 0 ? worldPts.reverse() : worldPts;
      return {
        raw: loop,
        shape: new THREE.Shape(finalPts),
      };
    });

    for (const hole of holeLoops.slice(0, 12)) {
      const samplePt = hole.points[0];
      let targetOuter: (typeof simplifiedOuters)[number] | null = null;

      for (const candidate of simplifiedOuters) {
        const b = candidate.raw.bbox;
        if (
          samplePt.x >= b.minX &&
          samplePt.x <= b.maxX &&
          samplePt.y >= b.minY &&
          samplePt.y <= b.maxY &&
          pointInPolygon(samplePt, candidate.raw.points)
        ) {
          if (!targetOuter || candidate.raw.absArea < targetOuter.raw.absArea) {
            targetOuter = candidate;
          }
        }
      }

      if (targetOuter) {
        const simplifiedHolePts = simplifyClosedLoop(hole.points, 0.75, 48).map(toWorldPoint);
        // Guarantee Clockwise (CW) winding order for THREE.Path hole
        const holeSignedArea = computeSignedArea(simplifiedHolePts);
        const finalHolePts = holeSignedArea > 0 ? simplifiedHolePts.reverse() : simplifiedHolePts;
        const holePath = new THREE.Path(finalHolePts);
        targetOuter.shape.holes.push(holePath);
      }
    }

    for (const item of simplifiedOuters) {
      shapes.push(item.shape);
    }
  }

  const worldWidth = innerW * worldScale;
  const worldHeight = innerH * worldScale;
  const extrudeCfg = getThemeExtrudeConfig(theme);

  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: extrudeCfg.depth,
    bevelEnabled: true,
    bevelSegments: extrudeCfg.bevelSegments,
    steps: 1,
    bevelSize: extrudeCfg.bevelSize,
    bevelThickness: extrudeCfg.bevelThickness,
  });

  geometry.translate(0, 0, -extrudeCfg.depth * 0.5);

  // Normalize UV coordinates across the exact sticker bounding box [-worldWidth/2..worldWidth/2] -> [0, 1]
  // Clamping to [0.002, 0.998] ensures outward bevels sample the sticker's white/colored outline smoothly
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;

  if (posAttr && uvAttr) {
    const halfW = worldWidth * 0.5;
    const halfH = worldHeight * 0.5;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const rawU = (vx + halfW) / Math.max(1e-5, worldWidth);
      const rawV = (vy + halfH) / Math.max(1e-5, worldHeight);
      const u = Math.max(0.002, Math.min(0.998, rawU));
      const v = Math.max(0.002, Math.min(0.998, rawV));
      uvAttr.setXY(i, u, v);
    }
    uvAttr.needsUpdate = true;
  }

  geometry.computeVertexNormals();

  return {
    geometry,
    texture,
    shadowTexture,
    sideColor,
    worldWidth,
    worldHeight,
    extrudeDepth: extrudeCfg.depth + extrudeCfg.bevelThickness * 2,
    aspectRatio,
  };
}
