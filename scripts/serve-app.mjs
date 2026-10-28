// Serves the built app (npm run app → dist/site) at http://localhost:8080/app/
// for trying it in Chrome or Edge before a release. localhost counts as a
// secure address, so installing, the offline copy and folder access all work
// as they will on GitHub Pages. Only this computer can reach it. Ctrl+C stops
// it; the installed app then still opens, from its offline copy.
//   npm run serve-app [-- <port>]   (builds first)
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve('dist', 'site');
const port = Number(process.argv[2] || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  let file = join(root, path);
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    if (statSync(file).isDirectory()) {
      // A folder's address ends in "/" so its pages' relative links work.
      if (!req.url.split('?')[0].endsWith('/')) { res.writeHead(301, { location: `${req.url.split('?')[0]}/` }).end(); return; }
      file = join(file, 'index.html');
      statSync(file);
    }
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found. Run npm run app first.');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Message Archivist app: http://localhost:${port}/app/  (Ctrl+C to stop)`));
