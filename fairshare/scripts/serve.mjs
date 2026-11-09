// Serves the whole Toolhub site at http://localhost:5173, the origin Google sign-in already allows,
// so pages under tools/ (and their ../../js/fairshare-config.js) work exactly as on GitHub Pages.
// Usage (from fairshare/): npm run serve
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.env.PORT) || 5173;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let file = resolve(root, '.' + path);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      // Relative links (../../js/...) need the trailing slash, like on GitHub Pages.
      if (!path.endsWith('/')) {
        res.writeHead(301, { Location: path + '/' }).end();
        return;
      }
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(e));
  }
}).listen(port, 'localhost', () => {
  console.log(`Toolhub served from ${root}`);
  console.log(`Feasibility test: http://localhost:${port}/tools/fairshare-spike/`);
  console.log('Press Ctrl+C to stop.');
});
