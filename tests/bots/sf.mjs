// Étape 3. Usage : node tests/bots/sf.mjs positions.json maia.json sf0.json 0 2   (et sf1.json 1 2 en parallèle)
// Évalue avec Stockfish les coups candidats de chaque position (ceux que Maia juge plausibles, plus le coup joué).
import fs from 'fs'; import { spawn } from 'child_process';
const [pos, maia, out, part, parts, depthArg] = process.argv.slice(2); const DEPTH = +(depthArg || 10);
const rows = JSON.parse(fs.readFileSync(pos)); const M = JSON.parse(fs.readFileSync(maia));
const p = spawn('node', [new URL('../../node_modules/stockfish/bin/stockfish-19-lite-single.js', import.meta.url).pathname]);
let buf = ''; let wait = null; let multi = null;
p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
  const m = l.match(/multipv (\d+) score (cp|mate) (-?\d+).* pv (\S+)/); if (m && multi) multi.set(+m[1], [m[4], m[2] === 'cp' ? +m[3] : (+m[3] > 0 ? 3000 : -3000)]);
  if (wait && l.startsWith(wait.k)) { const w = wait; wait = null; w.r(l); } } });
const send = (c, k) => new Promise((r) => { if (k) wait = { k, r }; p.stdin.write(c + '\n'); if (!k) r(); });
await send('uci', 'uciok'); await send('setoption name Hash value 32'); await send('isready', 'readyok');
const res = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out)) : {}; const t0 = Date.now(); let n = 0;
for (let i = +part; i < rows.length; i += +parts) {
  if (res[i]) continue;
  const cand = M[i].filter((x) => x[1] >= 0.01).slice(0, 10).map((x) => x[0]); if (!cand.includes(rows[i].uci)) cand.push(rows[i].uci);
  multi = new Map(); await send(`setoption name MultiPV value ${cand.length}`); await send(`position fen ${rows[i].fen}`); await send(`go depth ${DEPTH} searchmoves ${cand.join(' ')}`, 'bestmove');
  res[i] = [...multi.values()]; n += 1;
  if (n % 100 === 0) { fs.writeFileSync(out, JSON.stringify(res)); console.log(part, n, Math.round((Date.now() - t0) / 1000) + 's'); }
}
fs.writeFileSync(out, JSON.stringify(res)); console.log('fini', part, n); p.kill();
