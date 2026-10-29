import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { widgetManager } from '../../widgetManager';

export const widgetsRouter = Router();

const CreateWidgetSchema = z.object({
  stickerId: z.string().min(1),
});

export const WidgetPatchSchema = z.object({
  mode: z.enum(['2d', '3d']).optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  opacity: z.number().min(0.1).max(1.0).optional(),
  locked: z.boolean().optional(),
  click_through: z.boolean().optional(),
  always_on_top: z.boolean().optional(),
  settings: z
    .object({
      animation: z.enum(['none', 'float', 'sway']).optional(),
    })
    .optional(),
  active: z.boolean().optional(),
});

widgetsRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM widgets').all();
  res.json(rows);
});

widgetsRouter.post('/', (req: Request, res: Response) => {
  const parsed = CreateWidgetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  try {
    const created = widgetManager.pinSticker(parsed.data.stickerId);
    res.status(201).json(created);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to pin widget';
    res.status(404).json({ error: message });
  }
});

widgetsRouter.patch('/:id', (req: Request, res: Response) => {
  const parsed = WidgetPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid patch payload', details: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const updated = widgetManager.updateWidget(req.params.id, {
    mode: data.mode,
    x: data.x,
    y: data.y,
    width: data.width,
    height: data.height,
    opacity: data.opacity,
    locked: data.locked,
    clickThrough: data.click_through,
    alwaysOnTop: data.always_on_top,
    settings: data.settings,
    active: data.active,
  });

  if (!updated) {
    res.status(404).json({ error: 'Widget not found' });
    return;
  }

  res.json(updated);
});

widgetsRouter.delete('/:id', (req: Request, res: Response) => {
  widgetManager.removeWidget(req.params.id);
  res.status(204).end();
});
