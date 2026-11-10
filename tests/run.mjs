// Tests permanents des commentaires : chaque position signalée est rejouée comme dans l'appli
// (profondeur 14, menace, suites prolongées, sondes « pourquoi pas ? ») puis le commentaire est contrôlé.
// Usage : node tests/run.mjs [filtre] [--show]. Les calculs du moteur sont gardés dans tests/engine-cache.json.
import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import esbuild from 'esbuild'; import { Chess } from 'chess.js';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.join(here, '..');
const tmp = fs.mkdtempSync('/tmp/cases-');
await esbuild.build({ entryPoints: [path.join(root, 'src/explain.js')], bundle: true, format: 'esm', platform: 'node', outfile: tmp + '/ex.mjs', logLevel: 'error' });
await esbuild.build({ entryPoints: [path.join(root, 'src/analysis.js')], bundle: true, format: 'esm', platform: 'node', outfile: tmp + '/an.mjs', logLevel: 'error' });
const X = await import(tmp + '/ex.mjs'); const A = await import(tmp + '/an.mjs');
const args = process.argv.slice(2); const show = args.includes('--show'); const filter = args.find((a) => !a.startsWith('--'));
const CASES = JSON.parse(fs.readFileSync(path.join(here, 'cases.json'))).filter((c) => !filter || c.name.includes(filter));
const CACHE = path.join(here, 'engine-cache.json'); const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE)) : {};
let p; let buf = ''; let wait = null; let last = null;
const send = (c, k) => new Promise((r) => { if (k) wait = { k, r }; p.stdin.write(c + '\n'); if (!k) r(); });
const start = async () => { p = spawn('node', [path.join(root, 'node_modules/stockfish/bin/stockfish-19-lite-single.js')]);
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); const inf = A.parseInfo(l); if (inf && inf.pv.length) last = inf; if (wait && l.startsWith(wait.k)) { const r = wait.r; wait = null; r(l); } } });
  await send('uci', 'uciok'); await send('isready', 'readyok'); };
const ev = async (fen, depth, only) => { const key = `${fen}|${depth}|${only || ''}`; if (cache[key]) return cache[key]; if (!p) await start(); last = null; await send('ucinewgame'); await send('position fen ' + fen); const l = await send(`go depth ${depth}${only ? ' searchmoves ' + only.join(' ') : ''}`, 'bestmove'); cache[key] = { score: { type: last.type, value: last.value }, pv: last.pv, best: l.split(' ')[1] }; return cache[key]; };
const mv = (c, u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
const D = 14; const d = 12;
export async function analyse(fen, uci, prev = null) {
  const c = new Chess(fen); const white = c.turn() === 'w'; const legal = c.moves().length;
  const b = await ev(fen, D); const before = { score: A.toWhiteScore(b.score, white), best: b.best, pv: [...b.pv] };
  const m = mv(c, uci); const fenAfter = c.fen();
  let after;
  if (c.isCheckmate()) after = { score: { type: 'mate', value: 0, mated: c.turn() === 'w' ? 'white' : 'black' }, best: null, pv: [] };
  else { const a = await ev(fenAfter, D); after = { score: A.toWhiteScore(a.score, !white), best: a.best, pv: [...a.pv] }; }
  const extend = async (f, e) => { for (let k = 0; k < 2; k += 1) { const st = X.walk(f, e.pv, 30); if (!st.length || st.length >= 9) break; const end = st[st.length - 1].fen; if (new Chess(end).isGameOver()) break; const r = await ev(end, d); if (!r.pv.length) break; e.pv = [...e.pv.slice(0, st.length), ...r.pv]; } };
  await extend(fen, before); if (uci !== before.best) await extend(fenAfter, after);
  const cb = new Chess(fen); mv(cb, before.best);
  if (!cb.isGameOver() && !cb.inCheck()) { const parts = cb.fen().split(' '); parts[1] = parts[1] === 'w' ? 'b' : 'w'; parts[3] = '-'; const t = await ev(parts.join(' '), 8); before.threat = { fen: parts.join(' '), score: t.score, pv: t.pv }; } else before.threat = null;
  if (uci !== before.best && after.pv.length) {
    const rU = after.pv[0];
    if (!cb.isGameOver()) { if (cb.moves({ verbose: true }).some((x) => x.from + x.to + (x.promotion || '') === rU)) { const r = await ev(cb.fen(), d, [rU]); before.afterRef = { uci: rU, legal: true, score: A.toWhiteScore(r.score, cb.turn() === 'w'), pv: r.pv }; } else before.afterRef = { uci: rU, legal: false }; }
    const cr = new Chess(fenAfter); const rm = mv(cr, rU);
    if (rm.captured && !(after.pv[1] && after.pv[1].slice(2, 4) === rm.to)) { const recs = cr.moves({ verbose: true }).filter((x) => x.to === rm.to && x.captured).sort((a, z) => 'pnbrqk'.indexOf(a.piece) - 'pnbrqk'.indexOf(z.piece)); if (recs.length && !new Chess(recs[0].after).isGameOver()) { const r2 = await ev(recs[0].after, d); after.noRecapture = { uci: recs[0].from + recs[0].to + (recs[0].promotion || ''), pv: r2.pv, score: A.toWhiteScore(r2.score, recs[0].after.split(' ')[1] === 'w') }; } }
  }
  const first = X.walk(fen, before.pv, 2);
  if (first[0] && !first[0].m.san.endsWith('#')) { const ep = X.enPrise(first[0].m); const acc = first[1] && first[1].m.captured && first[1].m.to === first[0].m.to; if (ep && !acc) { const r = await ev(first[0].fen, d, ep.caps); before.ifTaken = { pv: r.pv, score: A.toWhiteScore(r.score, first[0].fen.split(' ')[1] === 'w') }; } }
  const ply = { san: m.san, color: m.color, from: m.from, to: m.to, uci, legal, captured: m.captured, piece: m.piece, sacrifice: X.isSacrifice(m), recapture: false };
  const move = A.buildReport([ply], [before, after], 0).moves[0];
  if (prev && m.captured && prev.captured && prev.to === m.to) ply.recapture = true;
  const ex = X.explainMove({ fenBefore: fen, fenAfter, ply, before, after, move, index: 20, prev, avoid: null });
  return { ex, move, before, after, ply, fenAfter };
}
let bad = 0;
for (const c of CASES) {
  const { ex, move, before, after, fenAfter } = await analyse(c.fen, c.uci, c.prev || null);
  const text = [...ex.sentences, ...ex.notes].join(' ');
  const miss = (c.must || []).filter((r) => !new RegExp(r).test(text)); const hit = (c.mustNot || []).filter((r) => new RegExp(r).test(text));
  const ok = !miss.length && !hit.length; if (!ok) bad += 1;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${c.name} [${move.kind}]${miss.length ? ' — manque : ' + miss.join(' , ') : ''}${hit.length ? ' — interdit : ' + hit.join(' , ') : ''}`);
  if (show || !ok) { const f = (s) => (s.type === 'mate' ? '#' + s.value : (s.value / 100).toFixed(1)); console.log(`     ${f(before.score)}→${f(after.score)} | meilleur ${X.walk(c.fen, before.pv).slice(0, 7).map((s) => s.m.san).join(' ')} | joué → ${X.walk(fenAfter, after.pv).slice(0, 7).map((s) => s.m.san).join(' ')}\n     ${ex.sentences.join('\n     ')}${ex.notes.length ? '\n     NOTES ' + ex.notes.join(' ') : ''}`); }
}
fs.writeFileSync(CACHE, JSON.stringify(cache)); if (p) p.kill();
console.log(bad ? `${bad} cas en échec sur ${CASES.length}` : `${CASES.length} cas, tous conformes`); process.exit(bad ? 1 : 0);
