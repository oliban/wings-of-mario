import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

// The map the deleted deploy/nginx.conf used to own, kept for the same reason
// it gave: an ES module served as text/plain is refused by the browser and the
// whole game silently fails to boot with no console error worth reading. This
// process is now the only thing standing between the game and that failure.
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
};

// Resolve a URL path inside `root` and refuse anything that escapes it.
// `..` in a request path is the oldest bug on the web and this server is
// about to be exposed on the public internet by Task 10.
export function resolveSafe(root, urlPath) {
  const base = resolve(root);
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath).split('?')[0]);
  } catch {
    return null;
  }
  // A NUL byte truncates the path for some syscalls but not for the string
  // comparison below, which is exactly the gap a traversal check must not have.
  if (decoded.includes('\0')) return null;
  if (decoded.endsWith('/')) decoded += 'index.html';
  const full = normalize(join(base, decoded));
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export async function serveStatic(req, res, root) {
  const full = resolveSafe(root, req.url || '/');
  if (!full) {
    res.writeHead(403).end('forbidden');
    return true;
  }
  let info;
  try {
    info = await stat(full);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': info.size,
    'X-Content-Type-Options': 'nosniff',
    // The art modules are large string-literal files that change on every art
    // pass, so they are revalidated rather than cached hard — the policy the
    // nginx config had, carried over deliberately.
    'Cache-Control': 'public, max-age=0, must-revalidate',
  });
  createReadStream(full).pipe(res);
  return true;
}
