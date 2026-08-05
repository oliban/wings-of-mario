#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The game, plus somewhere for the phone to post its input diary.
//
//   node tools/logserve.mjs            serve on 8125, log to input-log.txt
//   node tools/logserve.mjs 8080       another port
//
// Why this exists: a button that dies on a phone cannot be read off the phone.
// The on-screen diary (?inputlog) shows the last 26 events, which is fine for
// something that fails in front of you and useless for something that fails
// after ten minutes of play. So the diary posts here instead, and the log
// outlives the session.
//
// It binds every interface, not just loopback, because the point is that a
// PHONE reaches it: open the http://<lan-ip>:<port>/?inputlog line printed at
// startup on the handset and play. Static serving is identical to serve.mjs —
// same no-store, same MIME table — so nothing about the build changes.
// ---------------------------------------------------------------------------

import { createServer } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8125;
const LOG = join(ROOT, 'input-log.txt');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const lanAddress = () => {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return '127.0.0.1';
};

const stamp = () => new Date().toISOString().slice(11, 23);

const srv = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(req.url.split('?')[0]);

    // --- the sink --------------------------------------------------------
    if (path === '/__inputlog') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString('utf8');
      const lines = body
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length) {
        const out = lines.map((l) => `${stamp()} ${l}`).join('\n');
        await appendFile(LOG, out + '\n');
        // echoed as well as written, so it can be watched live in the terminal
        for (const l of lines) console.log(`${stamp()} ${l}`);
      }
      // sendBeacon wants a cheap 2xx and no body
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
      });
      res.end();
      return;
    }

    // --- the game --------------------------------------------------------
    const p = path === '/' ? '/index.html' : path;
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const buf = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

srv.listen(PORT, '0.0.0.0', () => {
  const ip = lanAddress();
  console.log(`serving ${ROOT}`);
  console.log(`  this machine : http://localhost:${PORT}/?inputlog`);
  console.log(`  the phone    : http://${ip}:${PORT}/?inputlog`);
  console.log(`  writing to   : ${LOG}`);
  console.log('');
});
