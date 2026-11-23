import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { getModelsDir } from '../db';

export const modelsRouter = Router();

const UPSTREAM_BASE = 'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/';

function getContentType(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  if (filePath.endsWith('.mjs') || filePath.endsWith('.js')) return 'application/javascript';
  return 'application/octet-stream';
}

function fetchWithRedirects(
  targetUrl: string,
  maxRedirects: number,
  callback: (err: Error | null, res?: http.IncomingMessage) => void
): void {
  if (maxRedirects <= 0) {
    callback(new Error('Too many redirects'));
    return;
  }

  const req = https.get(targetUrl, (res) => {
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      const redirectUrl = new URL(res.headers.location, targetUrl).toString();
      fetchWithRedirects(redirectUrl, maxRedirects - 1, callback);
      return;
    }
    callback(null, res);
  });

  req.on('error', (err) => {
    callback(err);
  });
}

modelsRouter.get('/*', (req: Request, res: Response) => {
  // Extract path after /imgly/
  const rawPath = req.params[0] || '';
  const cleanPath = path.normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, '');

  if (!cleanPath || cleanPath === '.') {
    res.status(400).json({ error: 'Invalid model asset path' });
    return;
  }

  const modelsDir = getModelsDir();
  // Safe flat/relative storage on disk
  const safeFileName = cleanPath.replace(/[^a-zA-Z0-9._-]/g, '_');
  const cachedFilePath = path.join(modelsDir, safeFileName);
  const contentType = getContentType(cleanPath);

  // 1. Cache HIT: serve immediately from local disk
  if (fs.existsSync(cachedFilePath)) {
    const stat = fs.statSync(cachedFilePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(cachedFilePath).pipe(res);
    return;
  }

  // 2. Cache MISS: fetch via Node's https stack and cache locally
  const upstreamUrl = `${UPSTREAM_BASE}${cleanPath}`;
  const tmpFilePath = `${cachedFilePath}.tmp`;

  fetchWithRedirects(upstreamUrl, 5, (err, upstreamRes) => {
    if (err || !upstreamRes) {
      console.error('[Models Cache] Upstream network error:', err?.message || 'No response');
      res.status(502).json({ error: `Failed to fetch model asset: ${err?.message || 'Network error'}` });
      return;
    }

    if (upstreamRes.statusCode !== 200) {
      console.error(`[Models Cache] Upstream returned HTTP ${upstreamRes.statusCode} for ${cleanPath}`);
      res.status(upstreamRes.statusCode || 502).json({
        error: `Upstream error HTTP ${upstreamRes.statusCode}`,
      });
      return;
    }

    const fileStream = fs.createWriteStream(tmpFilePath);

    const headers: Record<string, string | number | string[]> = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Cache-Control': 'public, max-age=31536000, immutable',
    };

    if (upstreamRes.headers['content-length']) {
      headers['Content-Length'] = upstreamRes.headers['content-length'];
    }

    res.writeHead(200, headers);

    upstreamRes.on('data', (chunk) => {
      fileStream.write(chunk);
      res.write(chunk);
    });

    upstreamRes.on('end', () => {
      fileStream.end(() => {
        // Atomic rename tmp -> final cached file
        try {
          if (fs.existsSync(tmpFilePath)) {
            fs.renameSync(tmpFilePath, cachedFilePath);
          }
        } catch (renameErr) {
          console.warn('[Models Cache] Failed to rename temp cache file:', renameErr);
        }
      });
      res.end();
    });

    upstreamRes.on('error', (streamErr) => {
      console.error('[Models Cache] Upstream stream error:', streamErr);
      fileStream.close();
      if (fs.existsSync(tmpFilePath)) {
        fs.unlinkSync(tmpFilePath);
      }
      if (!res.headersSent) {
        res.status(502).json({ error: 'Stream interrupted' });
      } else {
        res.destroy();
      }
    });
  });
});
