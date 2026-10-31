import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { stickersRouter } from './routes/stickers';
import { widgetsRouter } from './routes/widgets';
import { settingsRouter } from './routes/settings';
import { getStickersDir } from './db';

export interface ServerInstance {
  port: number;
  server: Server;
}

export function startLocalServer(token: string): Promise<ServerInstance> {
  return new Promise((resolve, reject) => {
    const app = express();

    app.use(
      cors({
        origin: [/^http:\/\/127\.0\.0\.1(:\d+)?$/, /^http:\/\/localhost(:\d+)?$/],
      })
    );
    app.use(express.json({ limit: '50mb' }));

    // Serve saved sticker PNGs and thumbnails locally
    app.use('/files/stickers', express.static(getStickersDir()));

    // Serve bundled pokemon cards and foil textures locally
    const publicImgDir = path.resolve(__dirname, '../../public/img');
    const distImgDir = path.resolve(__dirname, '../dist/img');
    if (fs.existsSync(publicImgDir)) {
      app.use('/img', express.static(publicImgDir));
    } else if (fs.existsSync(distImgDir)) {
      app.use('/img', express.static(distImgDir));
    }

    app.use((req: Request, res: Response, next: NextFunction) => {
      const providedToken = req.header('x-stickerdesk-token');
      if (req.method !== 'GET' && providedToken !== token) {
        res.status(401).json({ error: 'Unauthorized: invalid or missing local token' });
        return;
      }
      if (providedToken !== undefined && providedToken !== token) {
        res.status(401).json({ error: 'Unauthorized: token mismatch' });
        return;
      }
      next();
    });

    app.use('/stickers', stickersRouter);
    app.use('/widgets', widgetsRouter);
    app.use('/settings', settingsRouter);

    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        server,
      });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}
