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
  const whites = list.filter((p) => p.fen.split(' ')[1] === 'w').length;
  check(whites >= list.length / 4 && whites <= (list.length * 3) / 4, `${s.id} : le joueur a tantôt les Blancs, tantôt les Noirs (${whites} sur ${list.length})`);
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
// Les quatre lignes d'exemple publiées par Lichess avec le format de sa base (database.lichess.org, section Puzzles ;
// source : github.com/lichess-org/database, web/index.html.tpl). La position donnée précède le coup adverse,
// le premier coup s'applique, la solution commence au second ; les thèmes sont un texte séparé par des espaces.
const SAMPLES = `00sHx,q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17,e8d7 a2e6 d7d8 f7f8,1760,80,83,72,mate mateIn2 middlegame short
00sJ9,r3r1k1/p4ppp/2p2n2/1p6/3P1qb1/2NQR3/PPB2PP1/R1B3K1 w - - 5 18,e3g3 e8e1 g1h2 e1c1 a1c1 f4h6 h2g1 h6c1,2671,105,87,325,advantage attraction fork middlegame sacrifice veryLong
00sJb,Q1b2r1k/p2np2p/5bp1/q7/5P2/4B3/PPP3PP/2KR1B1R w - - 1 17,d1d7 a5e1 d7d1 e1e3 c1b1 e3b6,2235,76,97,64,advantage fork long
00sO1,1k1r4/pp3pp1/2p1p3/4b3/P3n1P1/8/KPP2PN1/3rBR1R b - - 2 31,b8c7 e1a5 b7b6 f1d1,998,85,94,293,advantage discoveredAttack master middlegame short`;
for (const line of SAMPLES.split('\n')) {
  const [PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes] = line.split(',');
  const p = Z.fromRow({ PuzzleId, FEN, Moves, Rating: +Rating, RatingDeviation: +RatingDeviation, Popularity: +Popularity, NbPlays: +NbPlays, Themes });
  const c = new Chess(p.start); p.solution.forEach((u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }));
  check(Z.validPuzzle(p) && p.solution.length % 2 === 1 && p.themes.length >= 3 && (!p.themes.includes('mate') || c.isCheckmate()), `exemple officiel de la base Lichess ${PuzzleId} : lu, solution jouable${p.themes.includes('mate') ? ' et qui finit par un mat' : ''}`);
}
const LI = { game: { pgn: 'e4 e5 Qh5 Nc6 Bc4 Nf6' }, puzzle: { id: 'li', rating: 700, solution: ['h5f7'], themes: ['mateIn1'], initialPly: 5 } };
const l1 = Z.fromLichess(LI);
const l2 = Z.fromLichess({ game: {}, puzzle: { ...LI.puzzle, fen: l1.start, lastMove: 'g8f6' } });
check(Z.validPuzzle(l1) && l1.lastMove === 'g8f6' && l1.start === l2.start, 'problème Lichess lu depuis la partie, ou depuis la position fournie');
// Exemple officiel de réponse, copié de la description de l'API Lichess (github.com/lichess-org/api,
// doc/specs/examples/puzzles-getNewPuzzle.json.yaml). Sa position fournie ne correspond pas à sa partie :
// la partie doit l'emporter.
const OFFICIAL = { game: { pgn: 'd4 d5 Nf3 e6 c4 Nf6 Nc3 Be7 Bg5 b6 e3 Bb7 Bd3 Nbd7 O-O O-O Rc1 Rc8 Qe2 Ne4 Bf4 c5 Rfd1 cxd4 exd4 f5 h3 Qe8 cxd5 exd5 Nb5 Qg6 a3 a6 Nc3 b5 Ne5 Nxe5 Bxe5 Bf6 Na2 Rfe8 Bxf6 Qxf6 Rxc8 Bxc8 Qc2 h6 f3 Ng5 Kh1 f4 Nc3 Bb7 Qf2 Re3 Bb1 Qe6 Qh4 Qf6 Ba2 Qf5 Bb1 Qf6 Ba2 Qf5 Bb1 Qf7 Qf2 Qh5 Kh2 Bc8 Nxd5 Bxh3 Nxe3' }, puzzle: { id: 'G9itW', rating: 1873, plays: 313, solution: ['h3g2', 'h2g2', 'h5h3', 'g2g1', 'g5f3', 'f2f3', 'h3f3'], themes: ['middlegame', 'crushing', 'attraction', 'sacrifice', 'discoveredAttack', 'deflection', 'veryLong'], fen: 'r1bqr1k1/pp3ppp/2p2n2/3p2B1/8/2P1P3/PP1N1PPb/1BRQ1RK1 w - - 0 1', lastMove: 'e5h2', initialPly: 74 } };
const off = Z.fromLichess(OFFICIAL);
check(Z.validPuzzle(off) && off.lastMove === 'd5e3' && new Chess(off.start).turn() === 'b' && off.solution.length === 7, 'exemple officiel de l’API Lichess : lu, solution jouable jusqu’au bout');

// 3. Réserve de problèmes : panne de la base, entrées abîmées, tout en panne.
const mem = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) }; };
const net = (hf, li) => { globalThis.fetch = async (url) => { const mode = String(url).includes('huggingface') ? hf : li; if (mode === 'down') throw new Error('réseau'); return { ok: true, json: async () => (String(url).includes('huggingface') ? { rows: [{ row: { ...ROW, Themes: ['mate'] } }, { row: { ...ROW, PuzzleId: 'x', FEN: 'abîmé' } }] } : LI) }; }; };
net('ok', 'ok'); check((await Z.createPool(mem()).next(800)).id === 'a', 'la base fournit un problème, la ligne illisible est ignorée');
net('down', 'ok'); check((await Z.createPool(mem()).next(800)).id === 'li', 'base en panne : la source de secours prend le relais');
net('ok', 'ok'); { const st = mem(); st.set('puzzle-pool', JSON.stringify([{ id: 'y', start: '8/8/8/8/8/8/8/8 w - - 0 1', solution: ['a1a2'], rating: 800, themes: [] }])); check((await Z.createPool(st).next(800)).id === 'a', 'entrée abîmée de la réserve écartée, puis réserve remplie'); }
net('down', 'down'); { let failed = false; try { await Z.createPool(mem()).next(800); } catch { failed = true; } check(failed, 'tout en panne : une erreur est remontée (l’écran propose Réessayer)'); }
{ const st = mem(); st.set('puzzle-pool', JSON.stringify([a])); check((await Z.createPool(st).next(800)).id === 'a', 'hors connexion : la réserve suffit'); }
const e = Z.updateElo({ r: 800, n: 0 }, 800, 1); check(e.r === 850 && e.delta === 50, 'Elo : +50 pour une première réussite à niveau égal (démarrage rapide)');
check(Z.updateElo({ r: 1500, n: 100 }, 1500, 1).delta === 8, 'Elo : +8 à niveau égal une fois stabilisé');

// 4. Bots : le modèle de jakbot est cohérent et le choix des coups suit ses règles.
const BOT = await load('bot.js');
const JAK = JSON.parse(fs.readFileSync(path.join(root, 'src/bots/jakbot.json')));
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
let illegal = 0;
for (const [key, moves] of Object.entries(JAK.book)) {
  const c = new Chess(`${key} 0 1`); const legal = new Set(c.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')));
  for (const u of Object.keys(moves)) if (!legal.has(u)) illegal += 1;
}
check(illegal === 0 && Object.keys(JAK.book).length > 100, `jakbot : tous les coups du répertoire sont légaux (${Object.keys(JAK.book).length} positions)`);
check(JAK.elo >= 2000 && JAK.alpha >= 1 && JAK.alpha <= 3 && JAK.tempo.length >= 6, 'jakbot : Elo, netteté et rythme renseignés');
const firsts = new Set(); for (let i = 0; i < 200; i += 1) firsts.add(BOT.bookMove(JAK, START, () => i / 200));
check(firsts.size === 2 && firsts.has('d2d4'), 'jakbot ouvre par 1.d4 (et très rarement par un autre coup, comme dans ses parties)');
const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
check(BOT.bookMove(JAK, afterE4, () => 0.5) === 'e7e6', 'jakbot répond 1...e6 à 1.e4');
check(BOT.bookMove(JAK, '8/8/8/4k3/8/8/4K3/8 w - - 0 1') === null, 'hors répertoire : pas de coup de répertoire');
const pol = [['a2a3', 0.5], ['b2b3', 0.3], ['c2c3', 0.195], ['h2h4', 0.005]];
const draws = { }; for (let i = 0; i < 2000; i += 1) { const u = BOT.pickFromPolicy(JAK, pol, () => (i + 0.5) / 2000); draws[u] = (draws[u] || 0) + 1; }
check(!draws.h2h4 && draws.a2a3 / 2000 > 0.5 && draws.c2c3 > 0, 'tirage : les coups jugés improbables par Maia sont écartés, la netteté favorise le premier choix sans supprimer les autres');
const t = [0, 20, 60].map((ply) => BOT.thinkMs(JAK, ply, () => 0.5)); check(t.every((x) => x >= 400 && x <= 3500) && t[1] > t[0], 'rythme : il réfléchit plus en milieu de partie qu’à l’ouverture, dans des limites raisonnables');

console.log(bad ? `${bad} contrôle(s) en échec` : 'Mode entraînement : tous les contrôles passent');
process.exit(bad ? 1 : 0);
