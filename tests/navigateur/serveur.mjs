// Serveur de test : fichiers statiques avec reprise (Range) et pannes commandées par /__ctl.
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = process.argv[2]; const port = +process.argv[3];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.onnx': 'application/octet-stream' };
let faults = []; const log = [];
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__ctl') { if (u.searchParams.get('reset')) { faults = []; log.length = 0; } else if (u.searchParams.get('log')) { res.end(JSON.stringify(log)); return; } else faults.push({ match: u.searchParams.get('match'), kind: u.searchParams.get('kind'), at: +(u.searchParams.get('at') || 0), times: +(u.searchParams.get('times') || 1) }); res.end('ok'); return; }
  let file = path.join(root, decodeURIComponent(u.pathname)); if (u.pathname.endsWith('/')) file += 'index.html';
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(file).size; const range = /bytes=(\d+)-/.exec(req.headers.range || '');
  const start = range ? +range[1] : 0;
  const f = faults.find((x) => u.pathname.includes(x.match) && x.times > 0);
  log.push(`${u.pathname} ${range ? 'range ' + start : 'full'}${f ? ' FAULT ' + f.kind : ''}`);
  if (f) f.times -= 1;
  if (f && f.kind === 'status') { res.writeHead(f.at); res.end(); return; }
  if (start >= size) { res.writeHead(416); res.end(); return; }
  const head = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': size - start, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  if (range) head['Content-Range'] = `bytes ${start}-${size - 1}/${size}`;
  res.writeHead(range ? 206 : 200, head);
  if (f && (f.kind === 'cut' || f.kind === 'stall')) {
    const n = Math.min(f.at, size - start); const buf = Buffer.alloc(n); const fd = fs.openSync(file); fs.readSync(fd, buf, 0, n, start); fs.closeSync(fd);
    res.write(buf, () => { if (f.kind === 'cut') res.destroy(); });
    return;
  }
  fs.createReadStream(file, { start }).pipe(res);
}).listen(port, () => console.log('ok', port));
