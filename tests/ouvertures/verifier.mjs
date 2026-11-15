// Vérification des forces et faiblesses annoncées (src/openings-def.js) sur les parties simulées par simuler.mjs.
// Usage : node tests/ouvertures/verifier.mjs <travail des parties> <travail des ouvertures (construire.mjs)>
// Chaque affirmation est reliée à une mesure et à un critère fixé avant de lire les résultats ; « med » est la médiane
// de la même mesure sur les 30 ouvertures (ou sur le groupe indiqué). Une affirmation qu'aucune mesure ne peut tester
// est déclarée « non mesurable », avec la raison.
import fs from 'fs'; import path from 'path'; import { Chess } from 'chess.js';
import { OPENINGS } from '../../src/openings-def.js';

const [simDir, opDir] = process.argv.slice(2);
const L = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f)));
const merge = (d, re) => Object.assign({}, ...fs.readdirSync(d).filter((f) => re.test(f)).map((f) => L(d, f)));
const G = merge(simDir, /^parties-\d+\.json$/); const EV = merge(simDir, /^evals-\d+\.json$/);
const OPS = L(opDir, 'openings.json'); const MAIA = L(opDir, 'maia.json');
const OD = JSON.parse(fs.readFileSync(new URL('../../src/openings.json', import.meta.url)));
const ENG = merge(opDir, /^moteur-\d+\.json$/);
const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
const MAT = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const share = (a) => mean(a.map((x) => (x ? 1 : 0)));
const median = (a) => { const s = a.filter((x) => !Number.isNaN(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/* ---------- Mesures par partie, puis moyennes par ouverture ---------- */
function measure(o) {
  const side = o.side; const fac = side === 'w' ? 'b' : 'w';
  const rootN = o.root.split(' ').length;
  const games = G[o.id] || [];
  const per = games.map((moves, gi) => {
    const c = new Chess(); const pos = [c.fen()]; const hist = [];
    for (const u of moves) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); hist.push(m); pos.push(c.fen()); }
    const at = (k) => new Chess(pos[Math.min(pos.length - 1, rootN + k)]);
    const ev = EV[`${o.id}:${gi}`] || [];
    const evFor = (k) => { const i = Math.min(ev.length - 1, rootN + k); const v = ev[i]; if (v == null) return NaN; const mover = pos[i].split(' ')[1]; return (mover === side ? v : -v) / 100; };
    const mat = (cc, col) => { let s = 0; for (const row of cc.board()) for (const x of row) if (x) s += (x.color === col ? 1 : -1) * MAT[x.type]; return s; };
    // Gaffes : coups qui font perdre au moins 2 pions d'évaluation au camp qui les joue.
    const blunders = { w: [], b: [] };
    for (let i = rootN; i < moves.length; i += 1) { const a = ev[i]; const b = ev[i + 1]; if (a == null || b == null) continue; const loss = a + b; if (loss >= 200) blunders[hist[i].color].push(i - rootN); }
    const after = hist.slice(rootN);
    const checks = { w: 0, b: 0 }; after.forEach((m) => { if (/[+#]/.test(m.san)) checks[m.color === 'w' ? 'b' : 'w'] += 1; });
    const castled = (col, k) => hist.slice(0, rootN + k).some((m) => m.color === col && /O-O/.test(m.san));
    const dev = (cc, col) => { const home = col === 'w' ? ['b1', 'g1', 'c1', 'f1'] : ['b8', 'g8', 'c8', 'f8']; return 4 - home.filter((s) => { const p = cc.get(s); return p && p.color === col && (p.type === 'n' || p.type === 'b'); }).length; };
    const space = (cc, col) => { let n = 0; for (const row of cc.board()) for (const x of row) if (x && x.type === 'p' && x.color === col) { const r = +x.square[1]; if (col === 'w' ? r >= 5 : r <= 4) n += 1; } return n; };
    const central = (cc, col) => ['d4', 'e4', 'd5', 'e5'].filter((s) => { const p = cc.get(s); return p && p.type === 'p' && p.color === col; }).length;
    const atk = (cc, sq, col) => cc.attackers(sq, col).length;
    const islands = (cc, col) => { const files = 'abcdefgh'.split('').map((f) => [1, 2, 3, 4, 5, 6, 7, 8].some((r) => { const p = cc.get(`${f}${r}`); return p && p.type === 'p' && p.color === col; })); let n = 0; files.forEach((x, i) => { if (x && !files[i - 1]) n += 1; }); return n; };
    const symmetric = (cc) => { let same = 0; let tot = 0; for (let r = 1; r <= 8; r += 1) for (const f of 'abcdefgh') { const p = cc.get(`${f}${r}`); const q = cc.get(`${f}${9 - r}`); if ((p && p.type === 'p') || (q && q.type === 'p')) { tot += 1; if (p && q && p.type === 'p' && q.type === 'p' && p.color !== q.color) same += 1; } } return tot ? same / tot : 0; };
    const played = (re, col, upto = 30) => after.slice(0, upto).some((m) => m.color === col && re.test(m.san));
    const pieceMoves = (startSq, col, upto) => { let sq = startSq; let n = 0; for (const m of hist.slice(0, upto)) { if (m.from === sq) { n += 1; sq = m.to; } else if (m.to === sq && m.color !== col) break; } return n; };
    const c10 = at(10); const c20 = at(20); const c6 = at(6);
    return {
      ev10: evFor(10), ev20: evFor(20), ev30: evFor(30), abs20: Math.abs(evFor(20)), abs30: Math.abs(evFor(30)),
      mat10: mat(c10, side), mat20: mat(c20, side),
      blundO: blunders[side].length, blundF: blunders[fac].length, earlyF: blunders[fac].some((i) => i < 12), earlyO: blunders[side].some((i) => i < 12),
      checksO: checks[side], checksF: checks[fac],
      castleO: castled(side, 20), castleF: castled(fac, 20),
      devO: dev(c10, side), devF: dev(c10, fac),
      spaceO: space(c20, side), spaceF: space(c20, fac),
      centralO6: central(c6, side), centralF6: central(c6, fac), centralO10: central(c10, side),
      captures10: after.slice(0, 10).filter((m) => m.captured).length,
      f7atk: atk(c10, 'f7', 'w'), e5atk: atk(c10, 'e5', 'w') - atk(c10, 'e5', 'b'), e5atk20: atk(c20, 'e5', 'w') - atk(c20, 'e5', 'b'), d5atk: atk(c10, 'd5', 'w') - atk(c10, 'd5', 'b'),
      e4atkB: atk(c10, 'e4', 'b'), d6atkW: atk(c20, 'd6', 'w'),
      fOpenW: ![1, 2, 3, 4, 5, 6, 7, 8].some((r) => { const p = c20.get(`f${r}`); return p && p.type === 'p' && p.color === 'w'; }),
      c8home: (() => { const p = c20.get('c8'); return !!(p && p.type === 'b' && p.color === 'b'); })(), c8out10: (() => { const p = c10.get('c8'); return !(p && p.type === 'b' && p.color === 'b'); })(),
      f8home10: (() => { const p = c10.get('f8'); return !!(p && p.type === 'b' && p.color === 'b'); })(),
      islandsO: islands(c20, side), sym20: symmetric(c20),
      bQueenMoves: hist.slice(0, 20).filter((m) => m.color === 'b' && m.piece === 'q').length,
      g8moves: pieceMoves('g8', 'b', 20),
      b5moves: pieceMoves(o.id === 'espagnole' ? 'b5' : 'zz', 'w', rootN + 20),
      c4hit: (() => { for (let k = 0; k <= 20; k += 1) { const cc = at(k); const p = cc.get('c4'); if (p && p.type === 'b' && p.color === 'w' && cc.attackers('c4', 'b').length) return true; } return false; })(),
      d4hit: (() => { for (let k = 0; k <= 10; k += 1) { const cc = at(k); const p = cc.get('d4'); if (p && p.type === 'n' && p.color === 'w' && cc.attackers('d4', 'b').length) return true; } return false; })(),
      qxb2: played(/^Qxb2/, 'b'), qb6: played(/^Qb6/, 'b'),
      g3: played(/^g3$/, 'w'), f4: played(/^f4|^fxe5/, 'w', 10), d5: played(/^d5$|^dxe4|^d5\+/, 'b', 10), c5: played(/^c5$|^cxd4/, 'b'),
      ne4: (() => { const i = after.findIndex((m) => m.color === 'b' && /^Ne4/.test(m.san)); return i >= 0 && after.slice(i + 1, i + 4).some((m) => m.color === 'w' && m.piece === 'b' && m.from === 'g5'); })(),
      dxc4: played(/^dxc4/, 'b', 6), dxc4kept: played(/^dxc4/, 'b', 6) && mat(c10, 'w') <= -1, b5: played(/^b5$|^b4$/, 'b'), f5: played(/^f5$|^f4$/, 'b'), qside: played(/^c5$|^b4$|^b5$|^cxd6/, 'w'),
      ng5: played(/^Ng5/, 'w', 2), bh6: played(/^Bh6/, 'w'), qd2be3: played(/^Qd2/, 'w', 12) && played(/^Be3/, 'w', 12),
      e5gone: !c20.get('e5') || c20.get('e5').color !== 'w' || c20.get('e5').type !== 'p',
      d4gone: !c20.get('d4') || c20.get('d4').color !== 'w' || c20.get('d4').type !== 'p',
      bpair: (() => { const n = (col) => c20.board().flat().filter((x) => x && x.type === 'b' && x.color === col).length; return n('b') < 2 && n('w') === 2; })(),
      nc6: played(/^Nc6/, 'b', 20) || played(/^N[bd]?c6/, 'b', 20), e4w: played(/^e4$/, 'w'), e5w: played(/^e5$|^exd6|^dxe5/, 'w'),
      e5d5: (() => ['e5', 'd5'].every((s) => { const p = c10.get(s); return p && p.type === 'p' && p.color === 'b'; }))(),
      opening6: hist.slice(rootN, rootN + 6).map((m) => m.san).join(' '), opening4: hist.slice(rootN, rootN + 4).map((m) => m.san).join(' '),
      fromGambit: hist[1] && hist[1].san === 'e5',
      decisive30: Math.abs(evFor(30)) >= 3, asym20: 1 - symmetric(c20),
      bxn10: (() => { const n = (col, t) => c10.board().flat().filter((x) => x && x.type === t && x.color === col).length; return n('w', 'b') !== n('b', 'b'); })(),
    };
  });
  const arr = (k) => per.map((x) => x[k]).filter((v) => (typeof v === 'number' && !Number.isNaN(v)) || typeof v === 'boolean').map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const avg = (k) => mean(arr(k));
  const sh = (k) => share(per.map((x) => x[k]));
  const sub = (k, f) => { const s = per.filter((x) => x[k]); return { n: s.length, ev20: mean(s.map((x) => x.ev20).filter((v) => !Number.isNaN(v))), ...(f ? f(s) : {}) }; };
  const odata = OD.openings.find((x) => x.id === o.id);
  const evRoot = -odata.best[0].cp / 100; // meilleur coup du camp qui affronte, vu par le camp de l'ouverture
  const rootMoves = (() => { const c = new Chess(); const out = []; o.root.split(' ').forEach((s) => { const k = key(c.fen()); const m = c.move(s); out.push({ color: m.color, p: ((MAIA[k] || []).find((x) => x[0] === m.from + m.to + (m.promotion || '')) || [0, 0])[1] }); }); return out; })();
  const rarity = rootMoves.filter((m) => m.color === side).slice(-1)[0].p; // probabilité Maia du coup caractéristique
  // Ligne principale jouée par Stockfish (profondeur 16) : évaluation de la dernière position, pour le camp de l'ouverture.
  const lastI = (OPS.find((x) => x.id === o.id) || { main: [] }).main.length - 1;
  const lm = ENG[`ligne:${o.id}:${lastI}`];
  const lmMover = lm ? new Chess((OPS.find((x) => x.id === o.id)).main[lastI].before).turn() : side;
  const evMain = lm ? (lmMover === side ? lm.bestCp : -lm.bestCp) / 100 : NaN;
  const raw = {}; for (const k of Object.keys(per[0] || {})) raw[k] = arr(k);
  return {
    raw, evMain, rootN,
    medEv20: median(arr('ev20')), medEv30: median(arr('ev30')),
    n: per.length, evRoot, rarity, lines: (OPS.find((x) => x.id === o.id) || { lines: [] }).lines.length,
    ev10: avg('ev10'), ev20: avg('ev20'), ev30: avg('ev30'), abs20: avg('abs20'), abs30: avg('abs30'), mat10: avg('mat10'), mat20: avg('mat20'),
    blundO: avg('blundO'), blundF: avg('blundF'), earlyF: sh('earlyF'), earlyO: sh('earlyO'), checksO: avg('checksO'), checksF: avg('checksF'),
    castleO: sh('castleO'), castleF: sh('castleF'), devO: avg('devO'), devF: avg('devF'), spaceO: avg('spaceO'), spaceF: avg('spaceF'),
    centralO6: avg('centralO6'), centralF6: avg('centralF6'), centralO10: avg('centralO10'), captures10: avg('captures10'),
    f7atk: avg('f7atk'), e5atk: avg('e5atk'), e5atk20: avg('e5atk20'), d5atk: avg('d5atk'), e4atkB: avg('e4atkB'), d6atkW: avg('d6atkW'),
    fOpenW: sh('fOpenW'), c8home: sh('c8home'), c8out10: sh('c8out10'), f8home10: sh('f8home10'), islandsO: avg('islandsO'), sym20: avg('sym20'),
    bQueenMoves: avg('bQueenMoves'), g8moves: avg('g8moves'), b5moves: avg('b5moves'), c4hit: sh('c4hit'), d4hit: sh('d4hit'),
    qxb2: sh('qxb2'), qb6: sh('qb6'), g3: sh('g3'), f4: sh('f4'), ne4: sh('ne4'), dxc4: sh('dxc4'), dxc4kept: sh('dxc4kept'), b5: sh('b5'), f5: sh('f5'), qside: sh('qside'),
    ng5: sh('ng5'), bh6: sh('bh6'), qd2be3: sh('qd2be3'), e5gone: sh('e5gone'), d4gone: sh('d4gone'), bpair: sh('bpair'), nc6: sh('nc6'), e4w: sh('e4w'), e5w: sh('e5w'),
    diversity: new Set(per.map((x) => x.opening4)).size, decisive30: avg('decisive30'), asym20: avg('asym20'), bxn10: avg('bxn10'),
    withD5: sub('d5'), withC5: sub('c5'), withF4: sub('f4', (s) => ({ checksO: mean(s.map((x) => x.checksO)) })), withoutF4: sub('f4') && (() => { const s = per.filter((x) => !x.f4); return { n: s.length, checksO: mean(s.map((x) => x.checksO)) }; })(),
    withNg5: sub('ng5'), withE5d5: sub('e5d5'), fromGambit: sub('fromGambit', (s) => ({ blundO: mean(s.map((x) => x.blundO)) })),
  };
}

const M = Object.fromEntries(OPENINGS.map((o) => [o.id, measure(o)]));
const med = (k, filter = () => true) => median(OPENINGS.filter(filter).map((o) => M[o.id][k]));
const q3 = (k) => { const s = OPENINGS.map((o) => M[o.id][k]).sort((a, b) => a - b); return s[Math.floor(s.length * 0.75)]; };
const q1 = (k) => { const s = OPENINGS.map((o) => M[o.id][k]).sort((a, b) => a - b); return s[Math.floor(s.length * 0.25)]; };
const blackDef = (o) => o.side === 'b'; const e4e5 = (o) => /^e4 e5/.test(o.root);
const f = (x, d = 2) => (Number.isNaN(x) || x == null ? '—' : (+x).toFixed(d).replace('.', ','));
const pc = (x) => `${Math.round(x * 100)} %`;
const pw = (x) => `${x >= 0 ? '+' : '−'}${f(Math.abs(x))}`; // évaluation en pions pour le camp de l'ouverture

/* ---------- Outils de décision ----------
   Trois verdicts : confirmé (1), contredit (−1), non tranché (0) quand l'écart reste dans la marge d'erreur (90 %)
   des 40 parties. Les faits déterministes (position, base de noms, évaluation de Stockfish) tranchent toujours. */
const Z = 1.645;
const wilson = (p, n) => { if (!n) return [0, 1]; const d = 1 + (Z * Z) / n; const c = (p + (Z * Z) / (2 * n)) / d; const hh = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / d; return [c - hh, c + hh]; };
const se = (a) => (a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1) / a.length) : Infinity);
const both = (...xs) => (xs.includes(-1) ? -1 : xs.every((x) => x === 1) ? 1 : 0);
const meanGe = (m, k, ref) => { const a = m.raw[k]; const mu = mean(a); const e = se(a); return mu - Z * e >= ref ? 1 : mu + Z * e < ref ? -1 : 0; };
const meanLe = (m, k, ref) => { const a = m.raw[k]; const mu = mean(a); const e = se(a); return mu + Z * e <= ref ? 1 : mu - Z * e > ref ? -1 : 0; };
const shareGe = (m, k, t) => { const a = m.raw[k]; const [lo, hi] = wilson(mean(a), a.length); return lo >= t ? 1 : hi < t ? -1 : 0; };
const shareLe = (m, k, t) => { const a = m.raw[k]; const [lo, hi] = wilson(mean(a), a.length); return hi <= t ? 1 : lo > t ? -1 : 0; };
const diffGt = (m1, k1, m2, k2) => { const a = m1.raw[k1]; const b = m2.raw[k2]; const d = mean(a) - mean(b); const e = Math.sqrt(se(a) ** 2 + se(b) ** 2); return d - Z * e > 0 ? 1 : d + Z * e < 0 ? -1 : 0; };
const pairGt = (m, k1, k2) => { const a = m.raw[k1].map((x, i) => x - m.raw[k2][i]); const mu = mean(a); const e = se(a); return mu - Z * e > 0 ? 1 : mu + Z * e < 0 ? -1 : 0; };
const fact = (b) => (b ? 1 : -1);
const R = (v, txt) => ({ ok: v === 1 ? true : v === -1 ? false : undefined, txt });
const NM = (why) => () => ({ ok: null, txt: `non mesurable : ${why}` });
// Le nombre de variantes nommées dépend de la longueur des coups de départ : on compare aux ouvertures de longueur proche.
const bucket = (o) => (o.root.split(' ').length <= 3 ? 'court' : 'long');
const linesRef = (o, q = 0.5, filter = () => true) => { const s = OPENINGS.filter((x) => bucket(x) === bucket(o) && filter(x)).map((x) => M[x.id].lines).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const def = (id) => OPENINGS.find((x) => x.id === id);
const after = (sans) => { const c = new Chess(); sans.split(' ').forEach((x) => c.move(x)); return c; };
const engMain = (m, test, label = 'évaluation de la ligne principale') => R(fact(test(m.evMain)), `${label} (Stockfish, profondeur 16) : ${pw(m.evMain)}`);
const mu = (m, k, d = 2) => f(mean(m.raw[k]), d);
const sh2 = (m, k) => pc(mean(m.raw[k]));

const SPECS = {
  italienne: [
    (m) => R(meanGe(m, 'devO', med('devO')), `pièces mineures blanches sorties après 5 coups : ${mu(m, 'devO', 1)} (médiane des 30 : ${f(med('devO'), 1)})`),
    (m) => { const c = after('e4 e5 Nf3 Nc6 Bc4'); return R(both(fact(c.attackers('f7', 'w').includes('c4')), meanLe(m, 'f7atk', 1)), `après 3.Bc4, le fou attaque f7 ; 5 coups plus tard, attaquants blancs de f7 : ${mu(m, 'f7atk')} en moyenne`); },
    (m) => R(shareGe(m, 'castleO', 0.6), `roque blanc avant le 10e coup dans ${sh2(m, 'castleO')} des parties (médiane des 30 : ${pc(med('castleO'))})`),
    (m) => engMain(m, (v) => v <= 0.5),
    (m) => R(shareGe(m, 'c4hit', 0.25), `fou c4 attaqué par un pion ou une pièce noire dans ${sh2(m, 'c4hit')} des parties`),
  ],
  espagnole: [
    (m) => R(meanGe(m, 'e5atk', 0), `attaquants de e5 (Blancs − Noirs) après 5 coups : ${mu(m, 'e5atk')}`),
    (m) => R(fact(m.lines >= linesRef(def('espagnole'), 0.75)), `${m.lines} variantes nommées (3e quartile des ouvertures comparables : ${linesRef(def('espagnole'), 0.75)}) ; « à tous les niveaux » non mesuré`),
    (m) => engMain(m, (v) => v >= 0.2),
    (m) => R(fact(m.lines >= linesRef(def('espagnole'), 0.75)), `${m.lines} variantes nommées (3e quartile des ouvertures comparables : ${linesRef(def('espagnole'), 0.75)})`),
    () => { const c = after('e4 e5 Nf3 Nc6 Bb5 a6'); return R(fact(c.attackers('b5', 'b').includes('a6')), `après 3…a6, le pion a6 attaque le fou b5 ; coups du fou dans les 10 premiers coups simulés : ${mu(M.espagnole, 'b5moves', 1)}`); },
  ],
  ecossaise: [
    (m) => R(meanGe(m, 'captures10', med('captures10')), `prises dans les 5 premiers coups : ${mu(m, 'captures10', 1)} (médiane des 30 : ${f(med('captures10'), 1)})`),
    (m) => R(fact(m.lines < M.espagnole.lines), `${m.lines} variantes nommées contre ${M.espagnole.lines} pour l’espagnole`),
    (m) => R(both(meanGe(m, 'captures10', med('captures10')), fact(m.evMain <= 0.5)), `prises dans les 5 premiers coups ${mu(m, 'captures10', 1)} ; ligne principale (Stockfish) ${pw(m.evMain)}`),
    (m) => R(shareGe(m, 'd4hit', 0.5), `cavalier d4 attaqué dans ${sh2(m, 'd4hit')} des parties`),
  ],
  'gambit-roi': [
    (m) => R(shareGe(m, 'fOpenW', 0.5), `colonne f sans pion blanc après 10 coups dans ${sh2(m, 'fOpenW')} des parties`),
    (m) => R(meanGe(m, 'earlyF', med('earlyF')), `gaffe noire dans les 6 premiers coups : ${sh2(m, 'earlyF')} des parties (médiane des 30 : ${pc(med('earlyF'))})`),
    (m) => R(meanGe(m, 'checksO', med('checksO')), `échecs reçus par le roi blanc : ${mu(m, 'checksO')} par partie (médiane des 30 : ${f(med('checksO'))})`),
    (m) => R(fact(m.evRoot <= -0.3), `évaluation après 2.f4 (Stockfish, profondeur 18) : ${pw(m.evRoot)}`),
  ],
  viennoise: [
    (m) => R(both(shareGe(m, 'g3', 0.05), shareGe(m, 'f4', 0.05)), `g3 joué dans ${sh2(m, 'g3')} des parties, f4 dans ${sh2(m, 'f4')}`),
    (m) => R(fact(m.rarity < 0.5), `probabilité que Maia 1500 joue 2.Nc3 : ${pc(m.rarity)}`),
    (m) => (m.withF4.n >= 8 && m.withoutF4.n >= 8 ? R(fact(m.withF4.checksO > m.withoutF4.checksO), `échecs reçus avec f4 ${f(m.withF4.checksO)}, sans ${f(m.withoutF4.checksO)}`) : { ok: null, txt: `non mesurable : f4 joué dans ${m.withF4.n} parties seulement` }),
    (m) => engMain(m, (v) => v <= 0.5, 'évaluation de la ligne principale, qui contient …d5'),
  ],
  evans: [
    (m) => R(both(meanGe(m, 'devO', med('devO')), meanGe(m, 'centralO10', med('centralO10'))), `pièces mineures blanches sorties ${mu(m, 'devO', 1)} (médiane ${f(med('devO'), 1)}), pions centraux blancs ${mu(m, 'centralO10', 1)} (médiane ${f(med('centralO10'), 1)})`),
    (m) => R(meanGe(m, 'f7atk', 1), `attaquants blancs de f7 après 5 coups : ${mu(m, 'f7atk')}`),
    (m) => R(meanLe(m, 'mat10', -0.3), `matériel des Blancs après 5 coups : ${mu(m, 'mat10')}`),
    (m) => engMain(m, (v) => v <= 0.5),
  ],
  'gambit-dame': [
    () => { const c = after('d4 d5 c4'); return R(fact(c.attackers('d5', 'w').includes('c4')), `après 2.c4, le pion c4 attaque d5 ; les Noirs y répondent par …e6, …c6 ou …dxc4 dans ${pc(['e7e6', 'c7c6', 'd5c4'].reduce((t, u) => t + ((MAIA[key(c.fen())] || []).find((x) => x[0] === u) || [0, 0])[1], 0))} des cas selon Maia 1500`); },
    (m) => R(fact(m.evRoot >= -0.1), `évaluation après 2.c4 (Stockfish) : ${pw(m.evRoot)} ; « à tous les niveaux » non mesuré`),
    (m) => R(fact(m.lines >= linesRef(def('gambit-dame'), 0.75)), `${m.lines} variantes nommées (3e quartile des ouvertures comparables : ${linesRef(def('gambit-dame'), 0.75)})`),
    (m) => engMain(m, (v) => v <= 0.5),
  ],
  londres: [
    (m) => R(fact(m.lines <= linesRef(def('londres'), 0.25)), `${m.lines} variantes nommées (1er quartile des ouvertures comparables : ${linesRef(def('londres'), 0.25)})`),
    (m) => R(both(meanLe(m, 'blundO', med('blundO')), meanLe(m, 'checksO', med('checksO'))), `gaffes blanches ${mu(m, 'blundO')} (médiane ${f(med('blundO'))}), échecs reçus ${mu(m, 'checksO')} (médiane ${f(med('checksO'))})`),
    (m) => engMain(m, (v) => v <= 0.3, 'évaluation de la ligne principale, qui contient …c5'),
    (m) => (mean(m.raw.qb6) >= 0.1 ? R(fact(mean(m.raw.qxb2) / mean(m.raw.qb6) >= 0.2), `…Qb6 dans ${sh2(m, 'qb6')} des parties, …Qxb2 dans ${sh2(m, 'qxb2')}`) : { ok: null, txt: `non mesurable : …Qb6 joué dans ${sh2(m, 'qb6')} des parties seulement` }),
  ],
  catalane: [
    (m) => R(both(shareGe(m, 'castleO', 0.6), fact(m.evMain > 0)), `roque blanc avant le 10e coup dans ${sh2(m, 'castleO')} des parties ; ligne principale (Stockfish) ${pw(m.evMain)}`),
    (m) => R(meanLe(m, 'checksO', med('checksO')), `échecs reçus par le roi blanc : ${mu(m, 'checksO')} (médiane ${f(med('checksO'))})`),
    (m) => R(both(meanLe(m, 'checksF', med('checksF')), meanLe(m, 'captures10', med('captures10'))), `échecs donnés au roi noir ${mu(m, 'checksF')} (médiane ${f(med('checksF'))}), prises dans les 5 premiers coups ${mu(m, 'captures10', 1)} (médiane ${f(med('captures10'), 1)})`),
    (m) => R(shareGe(m, 'dxc4', 0.2), `…dxc4 dans ${sh2(m, 'dxc4')} des parties ; pion gardé après 5 coups dans ${sh2(m, 'dxc4kept')}`),
  ],
  anglaise: [
    (m) => R(fact(m.diversity > med('diversity')), `${m.diversity} enchaînements différents des 2 coups suivants sur 40 parties (médiane des 30 : ${med('diversity')}) ; « difficile à préparer » non mesuré`),
    (m) => R(meanGe(m, 'd5atk', 0), `attaquants de d5 (Blancs − Noirs) après 5 coups : ${mu(m, 'd5atk')}`),
    (m) => (m.withE5d5.n >= 6 ? R(fact(m.withE5d5.ev20 <= 0.2), `…`) : { ok: null, txt: `non mesurable : les Noirs ont e5 et d5 dans ${m.withE5d5.n} parties seulement` }),
    (m) => R(fact(m.lines >= linesRef(def('anglaise'), 0.75)), `${m.lines} variantes nommées (3e quartile des ouvertures comparables : ${linesRef(def('anglaise'), 0.75)}) ; les transpositions elles-mêmes ne sont pas comptées`),
  ],
  reti: [
    (m) => R(fact(m.diversity > med('diversity')), `${m.diversity} enchaînements différents des 2 coups suivants sur 40 parties (médiane des 30 : ${med('diversity')})`),
    NM('il faudrait savoir ce que l’adversaire a préparé'),
    (m) => engMain(m, (v) => v >= 0 && v <= 0.3),
    NM('la compréhension demandée ne se mesure pas sur des parties simulées'),
  ],
  'smith-morra': [
    (m) => R(meanGe(m, 'devO', med('devO')), `pièces mineures blanches sorties après 5 coups : ${mu(m, 'devO', 1)} (médiane ${f(med('devO'), 1)})`),
    (m) => R(meanGe(m, 'earlyF', med('earlyF')), `gaffe noire dans les 6 premiers coups : ${sh2(m, 'earlyF')} des parties (médiane des 30 : ${pc(med('earlyF'))})`),
    (m) => R(fact(m.evRoot < 0 && m.evRoot >= -0.5), `évaluation après 3.c3 (Stockfish, profondeur 18) : ${pw(m.evRoot)} ; ligne principale ${pw(m.evMain)}`),
  ],
  trompowsky: [
    (m) => R(fact(m.lines <= linesRef(def('trompowsky'), 0.25) && m.rarity < 0.15), `${m.lines} variantes nommées (1er quartile des ouvertures comparables : ${linesRef(def('trompowsky'), 0.25)}) ; 2.Bg5 joué par Maia 1500 dans ${pc(m.rarity)} des cas`),
    (m) => R(meanGe(m, 'bxn10', med('bxn10')), `fous échangés contre des cavaliers (nombre de fous différent) après 5 coups : ${sh2(m, 'bxn10')} des parties (médiane des 30 : ${pc(med('bxn10'))})`),
    (m) => R(shareGe(m, 'ne4', 0.2), `…Ne4 suivi d’un coup du fou g5 dans ${sh2(m, 'ne4')} des parties`),
    (m) => (mean(m.raw.qb6) >= 0.1 ? R(fact(mean(m.raw.qxb2) / mean(m.raw.qb6) >= 0.2), `…Qb6 dans ${sh2(m, 'qb6')} des parties, …Qxb2 dans ${sh2(m, 'qxb2')}`) : { ok: null, txt: `non mesurable : …Qb6 joué dans ${sh2(m, 'qb6')} des parties seulement` }),
  ],
  bird: [
    (m) => R(meanGe(m, 'e5atk20', 0), `attaquants de e5 (Blancs − Noirs) après 10 coups : ${mu(m, 'e5atk20')}`),
    (m) => R(meanGe(m, 'checksF', med('checksF')), `échecs donnés au roi noir : ${mu(m, 'checksF')} (médiane ${f(med('checksF'))})`),
    (m) => R(meanGe(m, 'checksO', med('checksO')), `échecs reçus par le roi blanc : ${mu(m, 'checksO')} (médiane ${f(med('checksO'))})`),
    () => { const t = OD.openings.find((x) => x.id === 'bird').traps.find((x) => !x.auto); return R(fact(!!t), t ? `piège « ${t.title} » vérifié par Stockfish (mat) ; 1…e5 n’apparaît que dans ${M.bird.fromGambit.n} des 40 parties simulées` : 'piège non vérifié'); },
  ],
  'blackmar-diemer': [
    (m) => R(both(meanGe(m, 'checksF', med('checksF')), meanGe(m, 'captures10', med('captures10'))), `échecs donnés au roi noir ${mu(m, 'checksF')} (médiane ${f(med('checksF'))}), prises dans les 5 premiers coups ${mu(m, 'captures10', 1)} (médiane ${f(med('captures10'), 1)})`),
    (m) => R(meanGe(m, 'earlyF', med('earlyF')), `gaffe noire dans les 6 premiers coups : ${sh2(m, 'earlyF')} des parties (médiane des 30 : ${pc(med('earlyF'))})`),
    (m) => R(fact(m.evRoot <= -0.3), `évaluation après 2.e4 (Stockfish) : ${pw(m.evRoot)}`),
  ],
  sicilienne: [
    (m) => R(meanGe(m, 'decisive30', med('decisive30')), `parties déjà décidées (écart ≥ 3 pions) après 15 coups : ${sh2(m, 'decisive30')} (médiane des 30 : ${pc(med('decisive30'))})`),
    (m) => R(fact(m.lines >= linesRef(def('sicilienne'), 0.75)), `${m.lines} variantes nommées (3e quartile des ouvertures comparables : ${linesRef(def('sicilienne'), 0.75)})`),
    (m) => R(fact(m.lines === Math.max(...OPENINGS.map((x) => M[x.id].lines))), `${m.lines} variantes nommées, le plus grand nombre des 30`),
    (m) => R(meanGe(m, 'checksO', med('checksO')), `échecs reçus par le roi noir : ${mu(m, 'checksO')} (médiane des 30 : ${f(med('checksO'))})`),
  ],
  francaise: [
    (m) => R(meanLe(m, 'islandsO', med('islandsO', blackDef)), `îlots de pions noirs à 10 coups : ${mu(m, 'islandsO')} (médiane des défenses : ${f(med('islandsO', blackDef))})`),
    (m) => R(fact(OPS.find((x) => x.id === 'francaise').main.some((x) => x.san === 'c5')), `…c5 figure dans la ligne principale ; joué dans ${pc(m.withC5.n / m.n)} des parties simulées`),
    (m) => R(both(shareGe(m, 'c8home', 0.3), diffGt(m, 'c8home', M['caro-kann'], 'c8home')), `fou c8 encore chez lui après 10 coups : ${sh2(m, 'c8home')} (Caro-Kann : ${sh2(M['caro-kann'], 'c8home')})`),
    (m) => R(pairGt(m, 'spaceF', 'spaceO'), `pions avancés en territoire adverse à 10 coups : Blancs ${mu(m, 'spaceF', 1)}, Noirs ${mu(m, 'spaceO', 1)}`),
  ],
  'caro-kann': [
    (m) => R(meanLe(m, 'islandsO', med('islandsO', blackDef)), `îlots de pions noirs à 10 coups : ${mu(m, 'islandsO')} (médiane des défenses : ${f(med('islandsO', blackDef))})`),
    (m) => R(diffGt(m, 'c8out10', M.francaise, 'c8out10'), `fou c8 sorti après 5 coups : ${sh2(m, 'c8out10')} (française : ${sh2(M.francaise, 'c8out10')})`),
    (m) => R(diffGt(M.sicilienne, 'decisive30', m, 'decisive30'), `parties décidées après 15 coups : ${sh2(m, 'decisive30')} (sicilienne : ${sh2(M.sicilienne, 'decisive30')})`),
    (m) => R(meanLe(m, 'devO', med('devO', blackDef)), `pièces mineures noires sorties après 5 coups : ${mu(m, 'devO', 1)} (médiane des défenses : ${f(med('devO', blackDef), 1)})`),
  ],
  scandinave: [
    (m) => R(fact(m.lines <= linesRef(def('scandinave'))), `${m.lines} variantes nommées (médiane des ouvertures comparables : ${linesRef(def('scandinave'))}) ; « plans simples » non mesuré`),
    NM('vrai par construction : 1…d5 fixe la structure'),
    () => { const c = after('e4 d5 exd5 Qxd5 Nc3'); return R(fact(c.attackers('d5', 'w').includes('c3')), `après 3.Nc3, le cavalier attaque la dame d5 ; coups de la dame noire dans les 10 premiers coups simulés : ${mu(M.scandinave, 'bQueenMoves', 1)}`); },
    (m) => R(pairGt(m, 'devF', 'devO'), `pièces mineures sorties après 5 coups : Blancs ${mu(m, 'devF', 1)}, Noirs ${mu(m, 'devO', 1)}`),
  ],
  pirc: [
    (m) => R(pairGt(m, 'centralF6', 'centralO6'), `pions centraux après 3 coups : Blancs ${mu(m, 'centralF6', 1)}, Noirs ${mu(m, 'centralO6', 1)}`),
    NM('dépend de positions où le centre blanc se surétend, trop rares à repérer de façon fiable'),
    (m) => R(both(pairGt(m, 'centralF6', 'centralO6'), shareGe(m, 'bh6', 0.2)), `pions centraux après 3 coups : Blancs ${mu(m, 'centralF6', 1)}, Noirs ${mu(m, 'centralO6', 1)} ; Bh6 dans ${sh2(m, 'bh6')} des parties, Qd2 et Be3 dans ${sh2(m, 'qd2be3')}`),
  ],
  alekhine: [
    (m) => R(fact(m.rarity < 0.1), `1…Nf6 joué par Maia 1500 dans ${pc(m.rarity)} des cas ; « surprend » non mesuré`),
    (m) => R(shareGe(m, 'e5gone', 0.5), `pion blanc e5 échangé ou perdu après 10 coups dans ${sh2(m, 'e5gone')} des parties`),
    (m) => R(meanGe(m, 'g8moves', 2.5), `coups du cavalier g8 dans les 10 premiers coups noirs : ${mu(m, 'g8moves', 1)}`),
    (m) => R(pairGt(m, 'spaceF', 'spaceO'), `pions avancés à 10 coups : Blancs ${mu(m, 'spaceF', 1)}, Noirs ${mu(m, 'spaceO', 1)}`),
  ],
  petrov: [
    (m) => R(fact(Math.abs(m.evRoot) <= 0.4 && Math.abs(m.evMain) <= 0.5), `évaluation après 2…Nf6 ${pw(m.evRoot)}, ligne principale ${pw(m.evMain)} (Stockfish)`),
    (m) => R(both(meanLe(m, 'blundO', med('blundO')), meanLe(m, 'checksO', med('checksO'))), `gaffes noires ${mu(m, 'blundO')} (médiane ${f(med('blundO'))}), échecs reçus par le roi noir ${mu(m, 'checksO')} (médiane ${f(med('checksO'))})`),
    (m) => R(meanGe(m, 'sym20', med('sym20')), `symétrie des pions à 10 coups : ${sh2(m, 'sym20')} (médiane des 30 : ${pc(med('sym20'))}) ; « difficiles à gagner » non mesuré`),
    () => { const t = OD.openings.find((x) => x.id === 'petrov').traps.find((x) => !x.auto); return R(fact(!!t), t ? `piège « ${t.title} » vérifié par Stockfish : le coup fautif coûte ${f((t.cpBefore - t.cpAfter) / 100, 1)} pions` : 'piège non vérifié'); },
  ],
  'deux-cavaliers': [
    (m) => R(meanGe(m, 'devO', med('devO', blackDef)), `pièces mineures noires sorties après 5 coups : ${mu(m, 'devO', 1)} (médiane des défenses : ${f(med('devO', blackDef), 1)})`),
    (m) => R(fact(m.evMain >= -0.5), `ligne principale avec 4.Ng5 et le pion sacrifié (Stockfish) : ${pw(m.evMain)} pour les Noirs`),
    () => { const c = after('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5'); const a = c.attackers('f7', 'w').length; const d = c.attackers('f7', 'b').length; return R(fact(a >= 2 && d <= 1), `après 4.Ng5 : f7 attaqué par ${a} pièces blanches, défendu par ${d} (le roi)`); },
    () => { const t = OD.openings.find((x) => x.id === 'deux-cavaliers').traps.find((x) => !x.auto); return R(fact(!!t), t ? `piège « ${t.title} » vérifié par Stockfish : le coup fautif coûte ${f((t.cpBefore - t.cpAfter) / 100, 1)} pion` : 'piège non vérifié'); },
  ],
  philidor: [
    (m) => R(meanLe(m, 'blundO', med('blundO')), `gaffes noires ${mu(m, 'blundO')} (médiane ${f(med('blundO'))}) ; « plans simples » non mesuré`),
    (m) => R(fact(m.lines <= linesRef(def('philidor'))), `${m.lines} variantes nommées (médiane des ouvertures comparables : ${linesRef(def('philidor'))})`),
    () => { const c = after('e4 e5 Nf3 d6'); const b = new Chess(c.fen()); const n = b.moves({ square: 'f8' }).length; return R(fact(n <= 1), `après 2…d6, le fou f8 a ${n} case${n > 1 ? 's' : ''} (e7) ; encore chez lui après 5 coups dans ${sh2(M.philidor, 'f8home10')} des parties`); },
    (m) => R(fact(m.evRoot <= -0.3), `évaluation après 2…d6 (Stockfish) : ${pw(m.evRoot)} pour les Noirs`),
  ],
  'est-indienne': [
    (m) => { const main = OPS.find((x) => x.id === 'est-indienne').main.map((x) => x.san); return R(fact(main.includes('e5') && main.includes('f5')), `…e5 et …f5 figurent dans la ligne principale ; …f5 n’est joué que dans ${sh2(m, 'f5')} des parties simulées entre joueurs de 1500`); },
    (m) => R(meanGe(m, 'asym20', med('asym20')), `asymétrie des pions à 10 coups : ${sh2(m, 'asym20')} (médiane des 30 : ${pc(med('asym20'))})`),
    (m) => R(both(pairGt(m, 'spaceF', 'spaceO'), shareGe(m, 'qside', 0.3)), `pions avancés à 10 coups : Blancs ${mu(m, 'spaceF', 1)}, Noirs ${mu(m, 'spaceO', 1)} ; c5 ou b4 blanc dans ${sh2(m, 'qside')} des parties`),
    (m) => R(fact(m.lines >= linesRef(def('est-indienne'))), `${m.lines} variantes nommées (médiane des ouvertures comparables : ${linesRef(def('est-indienne'))})`),
  ],
  nimzo: [
    NM('la réputation au haut niveau demanderait des parties de maîtres'),
    (m) => R(meanGe(m, 'e4atkB', 1), `attaquants noirs de e4 après 5 coups : ${mu(m, 'e4atkB')}`),
    (m) => R(shareGe(m, 'bpair', 0.25), `les Noirs ont cédé la paire de fous après 10 coups dans ${sh2(m, 'bpair')} des parties ; l’effet en finale n’est pas mesuré`),
  ],
  grunfeld: [
    (m) => R(shareGe(m, 'd4gone', 0.35), `pion blanc d4 échangé ou perdu après 10 coups dans ${sh2(m, 'd4gone')} des parties`),
    NM('la réputation au haut niveau demanderait des parties de maîtres'),
    (m) => engMain(m, (v) => v <= -0.3, 'évaluation de la ligne principale pour les Noirs'),
    (m) => R(pairGt(m, 'spaceF', 'spaceO'), `pions avancés à 10 coups : Blancs ${mu(m, 'spaceF', 1)}, Noirs ${mu(m, 'spaceO', 1)}`),
  ],
  slave: [
    (m) => R(both(meanLe(m, 'islandsO', med('islandsO', blackDef)), shareGe(m, 'c8out10', 0.35)), `îlots de pions noirs ${mu(m, 'islandsO')} (médiane des défenses ${f(med('islandsO', blackDef))}) ; fou c8 sorti après 5 coups : ${sh2(m, 'c8out10')}`),
    () => { const o = OPS.find((x) => x.id === 'slave'); const l = o.lines.find((x) => x.moves.includes('d5c4') && x.moves.includes('b7b5')); return R(fact(!!l), l ? `variante nommée « ${l.name} » : …dxc4 puis …b5` : 'aucune variante avec …dxc4 et …b5'); },
    () => { const p = after('d4 d5 c4 c6').get('c6'); return R(fact(!!(p && p.type === 'p' && p.color === 'b')), 'après 2…c6, la case c6 est occupée par le pion noir'); },
    (m) => R(fact(m.lines >= linesRef(def('slave'))), `${m.lines} variantes nommées (médiane des ouvertures comparables : ${linesRef(def('slave'))})`),
  ],
  hollandaise: [
    (m) => R(meanGe(m, 'asym20', med('asym20')), `asymétrie des pions à 10 coups : ${sh2(m, 'asym20')} (médiane des 30 : ${pc(med('asym20'))})`),
    (m) => R(fact(m.lines < linesRef(def('hollandaise'), 0.5, blackDef)), `${m.lines} variantes nommées (médiane des défenses comparables : ${linesRef(def('hollandaise'), 0.5, blackDef)})`),
    (m) => R(meanGe(m, 'checksO', med('checksO')), `échecs reçus par le roi noir : ${mu(m, 'checksO')} (médiane des 30 : ${f(med('checksO'))})`),
    (m) => R(meanGe(m, 'earlyO', med('earlyO')), `gaffe noire dans les 6 premiers coups : ${sh2(m, 'earlyO')} des parties (médiane des 30 : ${pc(med('earlyO'))})`),
  ],
  benoni: [
    (m) => R(meanGe(m, 'asym20', med('asym20')), `asymétrie des pions à 10 coups : ${sh2(m, 'asym20')} (médiane des 30 : ${pc(med('asym20'))})`),
    () => { const c = after('d4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6'); const n = (col) => ['a', 'b', 'c'].reduce((t, fl) => t + [2, 3, 4, 5, 6, 7].filter((r) => { const p = c.get(`${fl}${r}`); return p && p.type === 'p' && p.color === col; }).length, 0); return R(fact(n('b') > n('w')), `après l’échange en d5 : ${n('b')} pions noirs contre ${n('w')} blancs sur les colonnes a, b, c ; …b5 joué dans ${sh2(M.benoni, 'b5')} des parties simulées`); },
    () => { const c = after('d4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6'); const guard = ['c7', 'e7'].filter((sq) => { const p = c.get(sq); return p && p.type === 'p' && p.color === 'b'; }).length; return R(fact(guard === 0), `après l’échange en d5, aucun pion noir ne peut plus défendre d6 (pas de pion en c7 ni e7) ; attaquants blancs de d6 dans les parties simulées : ${mu(M.benoni, 'd6atkW')}`); },
    (m) => R(both(shareGe(m, 'e4w', 0.5), shareGe(m, 'e5w', 0.2)), `e4 joué dans ${sh2(m, 'e4w')} des parties, e5 (ou échange en d6, e5) dans ${sh2(m, 'e5w')}`),
  ],
};

const out = []; let ok = 0; let ko = 0; let nm = 0; let und = 0;
for (const o of OPENINGS) {
  const m = M[o.id]; const specs = SPECS[o.id];
  const claims = [...o.forces.map((t) => ['force', t]), ...o.faiblesses.map((t) => ['faiblesse', t])];
  if (specs.length !== claims.length) throw new Error(`${o.id} : ${claims.length} affirmations, ${specs.length} critères`);
  claims.forEach(([kind, text], i) => {
    const r = specs[i](m); if (r.ok === true) ok += 1; else if (r.ok === false) ko += 1; else if (r.ok === undefined) und += 1; else nm += 1;
    out.push({ id: o.id, name: o.name, kind, text, verdict: r.ok === true ? 'confirmé' : r.ok === false ? 'contredit' : r.ok === undefined ? 'non tranché' : 'non mesurable', detail: r.txt });
  });
}
fs.writeFileSync(path.join(simDir, 'verdicts.json'), JSON.stringify({ measures: M, verdicts: out }, null, 1));
// Résumé pour l'appli : un verdict et une mesure par affirmation, dans l'ordre des textes.
const code = { confirmé: 'ok', contredit: 'ko', 'non tranché': 'nt', 'non mesurable': 'nm' };
const checks = { method: `${OPENINGS.length * 40} parties simulées (40 par ouverture) entre deux joueurs de 1500 (Maia), 15 coups chacun après les coups de départ ; coups évalués par Stockfish (profondeur 10). Verdict « non tranché » quand l’écart reste dans la marge d’erreur à 90 %.`, openings: {} };
for (const o of OPENINGS) { const v = out.filter((x) => x.id === o.id); checks.openings[o.id] = { forces: v.filter((x) => x.kind === 'force').map((x) => ({ v: code[x.verdict], d: x.detail })), faiblesses: v.filter((x) => x.kind === 'faiblesse').map((x) => ({ v: code[x.verdict], d: x.detail })) }; }
fs.writeFileSync(new URL('../../src/openings-checks.json', import.meta.url), JSON.stringify(checks));
for (const v of out) console.log(`${v.verdict === 'confirmé' ? 'OK ' : v.verdict === 'contredit' ? 'NON' : v.verdict === 'non tranché' ? '~~ ' : ' ? '} ${v.id.padEnd(15)} ${v.kind.padEnd(9)} ${v.text}\n      ${v.detail}`);
console.log(`\n${ok} confirmées, ${ko} contredites, ${und} non tranchées, ${nm} non mesurables (parties : ${Object.values(M).map((x) => x.n).join(',')})`);
