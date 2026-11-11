// Contrôles du mode entraînement, sans navigateur : données des mises en situation, lecture et choix des problèmes.
// Usage : node tests/training.mjs
import fs from 'fs'; import path from 'path'; import esbuild from 'esbuild'; import { Chess } from 'chess.js';
import { here, root } from './lib.mjs';
const tmp = fs.mkdtempSync('/tmp/chess-training-');
const load = async (file) => { const out = `${tmp}/${path.basename(file, '.js')}.mjs`; await esbuild.build({ entryPoints: [path.join(root, 'src', file)], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { __AUDIT__: 'false' } }); return import(out); };
const { SITUATIONS } = await load('exercises.js');
const Z = await load('puzzles.js');
let bad = 0; const check = (ok, text) => { if (!ok) { bad += 1; console.log('ÉCHEC', text); } };

// 1. Mises en situation : chaque thème a des positions jouables et des seuils cohérents.
const POS = JSON.parse(fs.readFileSync(path.join(root, 'src/situations.json')));
for (const s of SITUATIONS) {
  const list = POS[s.id] || [];
  check(list.length >= 10, `${s.id} : au moins 10 positions (${list.length})`);
  check(s.lossAt < s.capDraw && s.capDraw <= s.capWin && s.capWin < s.winAt, `${s.id} : seuils dans l'ordre perte < moyen ≤ réussite < gain`);
  check(s.cap >= 20 && s.cap % 2 === 0, `${s.id} : limite de coups paire et suffisante`);
  check(new Set(list.map((p) => p.fen)).size === list.length, `${s.id} : pas de position en double`);
  for (const p of list) {
    let c = null; try { c = new Chess(p.fen); } catch { /* signalé ci-dessous */ }
    check(c && !c.isGameOver() && c.moves().length > 0, `${s.id} : position jouable ${p.fen}`);
  }
}
check(Object.keys(POS).every((k) => SITUATIONS.some((s) => s.id === k)), 'chaque liste de positions correspond à un thème');

// 2. Problèmes : lecture des deux sources, tolérance aux données abîmées.
const ROW = { PuzzleId: 'a', FEN: 'r2r2k1/1p3ppp/8/8/8/8/3R1PPP/3R2K1 b - - 0 1', Moves: 'b7b6 d2d8 a8d8 d1d8', Rating: 820, RatingDeviation: 80, Popularity: 90, NbPlays: 500 };
const a = Z.fromRow({ ...ROW, Themes: ['mate', 'mateIn2'] }); const b = Z.fromRow({ ...ROW, Themes: 'mate mateIn2' });
check(Z.validPuzzle(a) && a.solution.length === 3 && a.lastMove === 'b7b6', 'ligne de la base lue');
check(JSON.stringify(a.themes) === JSON.stringify(b.themes), 'thèmes lus en liste comme en texte');
check(!Z.validPuzzle({ ...a, solution: ['d2d7', 'a8d8'] }) && !Z.validPuzzle({ ...a, start: 'n’importe quoi' }) && !Z.validPuzzle(null) && !Z.validPuzzle({ ...a, solution: [] }), 'problème injouable refusé');
const LI = { game: { pgn: 'e4 e5 Qh5 Nc6 Bc4 Nf6' }, puzzle: { id: 'li', rating: 700, solution: ['h5f7'], themes: ['mateIn1'], initialPly: 5 } };
const l1 = Z.fromLichess(LI);
const l2 = Z.fromLichess({ game: {}, puzzle: { ...LI.puzzle, fen: l1.start, lastMove: 'g8f6' } });
check(Z.validPuzzle(l1) && l1.lastMove === 'g8f6' && l1.start === l2.start, 'problème Lichess lu avec ou sans position fournie');

// 3. Réserve de problèmes : panne de la base, entrées abîmées, tout en panne.
const mem = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) }; };
const net = (hf, li) => { globalThis.fetch = async (url) => { const mode = String(url).includes('huggingface') ? hf : li; if (mode === 'down') throw new Error('réseau'); return { ok: true, json: async () => (String(url).includes('huggingface') ? { rows: [{ row: { ...ROW, Themes: ['mate'] } }, { row: { ...ROW, PuzzleId: 'x', FEN: 'abîmé' } }] } : LI) }; }; };
net('ok', 'ok'); check((await Z.createPool(mem()).next(800)).id === 'a', 'la base fournit un problème, la ligne illisible est ignorée');
net('down', 'ok'); check((await Z.createPool(mem()).next(800)).id === 'li', 'base en panne : la source de secours prend le relais');
net('ok', 'ok'); { const st = mem(); st.set('puzzle-pool', JSON.stringify([{ id: 'y', start: '8/8/8/8/8/8/8/8 w - - 0 1', solution: ['a1a2'], rating: 800, themes: [] }])); check((await Z.createPool(st).next(800)).id === 'a', 'entrée abîmée de la réserve écartée, puis réserve remplie'); }
net('down', 'down'); { let failed = false; try { await Z.createPool(mem()).next(800); } catch { failed = true; } check(failed, 'tout en panne : une erreur est remontée (l’écran propose Réessayer)'); }
{ const st = mem(); st.set('puzzle-pool', JSON.stringify([a])); check((await Z.createPool(st).next(800)).id === 'a', 'hors connexion : la réserve suffit'); }
const e = Z.updateElo({ r: 800, n: 0 }, 800, 1); check(e.r === 820 && e.delta === 20, 'Elo : +20 pour une première réussite à niveau égal');

console.log(bad ? `${bad} contrôle(s) en échec` : 'Mode entraînement : tous les contrôles passent');
process.exit(bad ? 1 : 0);
