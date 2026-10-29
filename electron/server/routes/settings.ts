import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db';

export const settingsRouter = Router();

export const SettingUpdateSchema = z.record(z.string(), z.string());

settingsRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;

  const settingsMap: Record<string, string> = {};
  for (const row of rows) {
    settingsMap[row.key] = row.value;
  }

  res.json(settingsMap);
});
