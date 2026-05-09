#!/usr/bin/env node
// Lightweight dev server for Place ID lookup.
// Usage: node scripts/search-server.js
// Then open http://localhost:3456

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 3456;

// Load .env
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) {
  console.error('Error: GOOGLE_PLACES_API_KEY not set in .env');
  process.exit(1);
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API proxy: GET /search?q=...
  if (url.pathname === '/search') {
    const q = url.searchParams.get('q')?.trim();
    if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing q' })); return; }

    try {
      const apiRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount',
        },
        body: JSON.stringify({ textQuery: q, maxResultCount: 10 }),
      });
      const data = await apiRes.json();
      res.writeHead(apiRes.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Static files from tools/
  const filePath = url.pathname === '/' ? join(ROOT, 'tools', 'search.html')
                                        : join(ROOT, 'tools', url.pathname.replace(/^\//, ''));

  if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }

  const mime = MIME[extname(filePath)] || 'text/plain';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(readFileSync(filePath));

}).listen(PORT, '127.0.0.1', () => {
  console.log(`Place ID search → http://localhost:${PORT}`);
});
