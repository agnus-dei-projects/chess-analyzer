// Coups de théorie : lien d'ouverture Chess.com et base Lichess par position (src/book.js).
import fs from 'fs'; import path from 'path'; import esbuild from 'esbuild'; import { Chess } from 'chess.js';
import { X, A, here, root } from './lib.mjs';
const tmp = fs.mkdtempSync('/tmp/chess-livre-');
await esbuild.build({ entryPoints: [path.join(root, 'src/book.js')], bundle: true, format: 'esm', platform: 'node', outfile: tmp + '/bk.mjs', logLevel: 'error' });
const { bookPliesByPosition } = await import(tmp + '/bk.mjs');
let bad = 0; const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!ok) bad += 1; };
const game = (s) => { const c = new Chess(); const fens = [c.fen()]; const plies = []; for (const m of s.split(' ')) { const r = c.move(m); fens.push(c.fen()); plies.push({ san: r.san }); } return { fens, plies }; };
const url = (slug) => `https://www.chess.com/openings/${slug}`;
let g = game('e4 e6 d4 d5 exd5 exd5 Nf3 Bd6 Bd3 Ne7 O-O Bf5 Ng5');
check(X.bookFromEcoUrl(url('French-Defense-Exchange-Variation...4.Bd3-Bd6-5.Nf3-Ne7-6.O-O'), [{ san: 'e4' }, { san: 'e6' }, { san: 'd4' }, { san: 'd5' }, { san: 'exd5' }, { san: 'exd5' }, { san: 'Bd3' }, { san: 'Bd6' }, { san: 'Nf3' }, { san: 'Ne7' }, { san: 'O-O' }]).plies === 11, 'lien Chess.com avec un roque : lu jusqu’à 6.O-O');
check(X.bookFromEcoUrl(url('English-Opening-Anglo-Dutch-Defense...4.Bg2-Be7-5.O-O-O-O'), 'Nf3 e6 c4 f5 g3 Nf6 Bg2 Be7 O-O O-O'.split(' ').map((san) => ({ san }))).plies === 10, 'lien Chess.com avec deux roques');
g = game('d4 e6 e3 f5 Nf3 Nf6');
check(X.bookFromEcoUrl(url('Queens-Pawn-Opening-Horwitz-Defense'), g.plies).plies === 0 && bookPliesByPosition(g.fens) === 2, `lien sans coups (« Horwitz Defense » = 1.d4 e6) : théorie trouvée par la position (${bookPliesByPosition(g.fens)} demi-coups)`);
check(X.bookFromEcoUrl(url('Queens-Pawn-Opening-Horwitz-Defense...3.Bf4-Nf6-4.e3-Be7'), game('d4 e6 Nf3 f5 Bf4 Nf6 e3 Be7 Ne5').plies).plies === 8, 'lien avec « ... » avant les coups : lu jusqu’à 4…Be7');
check(X.bookFromEcoUrl(url('Queens-Pawn-Opening-Chigorin-Variation-2...c6'), game('d4 d5 Nc3 c6 Bf4').plies).plies === 4, 'lien « 2...c6 » : 4 demi-coups');
g = game('d4 d5 Nc3 f5 g4 e6');
check(bookPliesByPosition(g.fens) >= 4, `ordre de coups différent du nom Chess.com : ${bookPliesByPosition(g.fens)} demi-coups`);
g = game('e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2 Bxd2+ Nbxd2 d5 a3 a6 h3 h6');
const n = bookPliesByPosition(g.fens); check(n >= 10 && n < 20, `Italienne principale : théorie jusqu’au ${n}e demi-coup, puis sortie`);
// Garde-fou : une ligne nommée perdante n'est pas un coup de théorie (mat du lion).
g = game('f3 e5 g4 Qh4#'); const bp = bookPliesByPosition(g.fens);
const ev = (cp) => ({ score: { type: 'cp', value: cp }, best: 'e2e4', pv: [] });
const evals = [ev(30), ev(10), ev(20), { score: { type: 'mate', value: -1 }, best: 'd8h4', pv: [] }, { score: { type: 'mate', value: 0, mated: 'white' }, best: null, pv: [] }];
const plies = g.plies.map((p, i) => ({ ...p, color: i % 2 ? 'b' : 'w', uci: ['f2f3', 'e7e5', 'g2g4', 'd8h4'][i], legal: 20 }));
const kinds = A.buildReport(plies, evals, bp).moves.map((m) => m.kind);
check(bp === 4 && kinds[2] !== 'book' && kinds[0] === 'book', `mat du lion (ligne nommée) : g4 n’est pas « théorie » (${kinds.join(', ')})`);
console.log(bad ? `${bad} échec(s)` : 'Théorie : tous les contrôles passent'); process.exit(bad ? 1 : 0);
