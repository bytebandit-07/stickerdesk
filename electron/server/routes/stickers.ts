
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

    .regex(

      /^data:image\/png;base64,[A-Za-z0-9+/=]+$/,

      'Must be a valid data:image/png;base64 string'

    ),

});



const PatchStickerSchema = z.object({

  name: z.string().trim().min(1).max(120),

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



stickersRouter.get('/:id', (req: Request, res: Response) => {

  const db = getDb();

  const row = db.prepare('SELECT * FROM stickers WHERE id = ?').get(req.params.id);

  if (!row) {

    res.status(404).json({ error: 'Sticker not found' });

    return;

  }



  const parsed = StickerRowSchema.safeParse(row);

  if (!parsed.success) {

    res.status(500).json({ error: 'Invalid sticker record' });

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



stickersRouter.patch('/:id', (req: Request, res: Response) => {

  const validation = PatchStickerSchema.safeParse(req.body);

  if (!validation.success) {

    res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });

    return;

  }



  const db = getDb();

  const result = db

    .prepare('UPDATE stickers SET name = ? WHERE id = ?')

    .run(validation.data.name, req.params.id);



  if (result.changes === 0) {

    res.status(404).json({ error: 'Sticker not found' });

    return;

  }



  const updated = db.prepare('SELECT * FROM stickers WHERE id = ?').get(req.params.id);

  res.json(updated);

});



stickersRouter.delete('/:id', (req: Request, res: Response) => {

  const stickerId = req.params.id;

  const db = getDb();



  const row = db.prepare('SELECT * FROM stickers WHERE id = ?').get(stickerId);

  if (!row) {

    res.status(404).json({ error: 'Sticker not found' });

    return;

  }



  const parsed = StickerRowSchema.safeParse(row);

  if (!parsed.success) {

    res.status(500).json({ error: 'Corrupted sticker row' });

    return;

  }



  // 1. Close any open desktop widgets for this sticker

  const associatedWidgets = db

    .prepare('SELECT id FROM widgets WHERE sticker_id = ?')

    .all(stickerId) as Array<{ id: string }>;



  for (const w of associatedWidgets) {

    widgetManager.closeWidget(w.id);

  }



  // 2. Delete SQLite rows (widgets cascade or are explicitly deleted)

  db.prepare('DELETE FROM widgets WHERE sticker_id = ?').run(stickerId);

  db.prepare('DELETE FROM stickers WHERE id = ?').run(stickerId);



  // 3. Unlink full-res PNG and thumbnail PNG from disk

  const stickersDir = getStickersDir();

  const fullFilePath = path.join(stickersDir, path.basename(parsed.data.file_path));

  const fullThumbPath = path.join(stickersDir, path.basename(parsed.data.thumb_path));



  for (const targetPath of [fullFilePath, fullThumbPath]) {

    try {

      if (fs.existsSync(targetPath)) {

        fs.unlinkSync(targetPath);

      }

    } catch {

      // Ignore file unlink errors if already removed

    }

  }



  res.status(204).end();

});



