import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { nativeImage } from 'electron';
import { getDb, getStickersDir } from '../db';
import { widgetManager } from '../../widgetManager';

export const stickersRouter = Router();

export const StickerRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  file_path: z.string(),
  thumb_path: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  created_at: z.string(),
});

export type StickerRow = z.infer<typeof StickerRowSchema>;

const CreateStickerSchema = z.object({
  name: z.string().trim().min(1, 'Sticker name is required').max(120),
  imageBase64: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'Must be a valid data:image/png;base64 string'),
});

stickersRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM stickers ORDER BY created_at DESC').all();
  const parsed = z.array(StickerRowSchema).safeParse(rows);

  if (!parsed.success) {
    res.status(500).json({ error: 'Invalid database state for stickers' });
    return;
  }

  res.json(parsed.data);
});

stickersRouter.post('/', (req: Request, res: Response) => {
  const validation = CreateStickerSchema.safeParse(req.body);
  if (!validation.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: validation.error.flatten(),
    });
    return;
  }

  const { name, imageBase64 } = validation.data;
  const base64Payload = imageBase64.replace(/^data:image\/png;base64,/, '');
  const pngBuffer = Buffer.from(base64Payload, 'base64');

  const image = nativeImage.createFromBuffer(pngBuffer);
  if (image.isEmpty()) {
    res.status(400).json({ error: 'Decoded PNG buffer is empty or corrupted' });
    return;
  }

  const { width, height } = image.getSize();
  if (width <= 0 || height <= 0) {
    res.status(400).json({ error: 'Invalid image dimensions' });
    return;
  }

  // Create a 256x256 square thumbnail canvas preserving aspect ratio
  const maxThumbDim = 256;
  const thumbWidth =
    width >= height ? maxThumbDim : Math.max(1, Math.round((width / height) * maxThumbDim));
  const thumbHeight =
    height > width ? maxThumbDim : Math.max(1, Math.round((height / width) * maxThumbDim));
  const thumbImage = image.resize({ width: thumbWidth, height: thumbHeight, quality: 'best' });
  const thumbBuffer = thumbImage.toPNG();

  const id = crypto.randomUUID();
  const stickersDir = getStickersDir();
  const fileName = `${id}.png`;
  const thumbFileName = `${id}_thumb.png`;

  const fullFilePath = path.join(stickersDir, fileName);
  const fullThumbPath = path.join(stickersDir, thumbFileName);

  fs.writeFileSync(fullFilePath, pngBuffer);
  fs.writeFileSync(fullThumbPath, thumbBuffer);

  const createdAt = new Date().toISOString();
  const db = getDb();

  db.prepare(
    `INSERT INTO stickers (id, name, file_path, thumb_path, width, height, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, fileName, thumbFileName, width, height, createdAt);

  const createdRow = db.prepare('SELECT * FROM stickers WHERE id = ?').get(id);
  const parsedRow = StickerRowSchema.safeParse(createdRow);

  if (!parsedRow.success) {
    res.status(500).json({ error: 'Failed to read created sticker record' });
    return;
  }

  res.status(201).json(parsedRow.data);
});

stickersRouter.delete('/:id', (req: Request, res: Response) => {
  const stickerId = req.params.id;
  const db = getDb();
  const row = db.prepare('SELECT file_path, thumb_path FROM stickers WHERE id = ?').get(stickerId) as {
    file_path: string;
    thumb_path: string;
  } | undefined;

  if (!row) {
    res.status(404).json({ error: 'Sticker not found' });
    return;
  }

  // 1. Close any active desktop widgets for this sticker
  widgetManager.closeWidgetsForSticker(stickerId);

  // 2. Delete image files from disk
  const stickersDir = getStickersDir();
  try {
    fs.unlinkSync(path.join(stickersDir, row.file_path));
  } catch {
    // File might already be gone
  }
  try {
    fs.unlinkSync(path.join(stickersDir, row.thumb_path));
  } catch {
    // Thumbnail might already be gone
  }

  // 3. Delete from SQLite (cascades to widgets table)
  db.prepare('DELETE FROM stickers WHERE id = ?').run(stickerId);

  res.status(204).end();
});
