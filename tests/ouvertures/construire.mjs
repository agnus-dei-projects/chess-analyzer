// Construit src/openings.json à partir des définitions, de la base de noms Lichess (domaine public, CC0),
// de Maia au niveau ELO (2000 par défaut ; popularité des coups chez des joueurs de club) et de Stockfish (qualité des coups).
//
// Usage, dans l'ordre (dossier de travail au choix, par exemple /tmp/ouv) :
//   node tests/ouvertures/construire.mjs noeuds    <travail> <dossier des .tsv de github.com/lichess-org/chess-openings>
//   node tests/ouvertures/construire.mjs maia      <travail>        (Chrome + Playwright, appli construite et servie : BASE=…)
//   node tests/ouvertures/construire.mjs moteur    <travail> [part] [parts]
//   node tests/ouvertures/construire.mjs assembler <travail>
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { Chess } from 'chess.js';
import { OPENINGS } from '../../src/openings-def.js';
import { CLASSIC_TRAPS } from './pieges-classiques.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Les étapes ne s'exécutent que si ce fichier est lancé directement (simuler.mjs n'en importe que le moteur).
const direct = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
const [step, work, ...rest] = direct ? process.argv.slice(2) : [];
if (work) fs.mkdirSync(work, { recursive: true });
const W = (f) => path.join(work, f);
const load = (f) => JSON.parse(fs.readFileSync(W(f)));
const save = (f, v) => fs.writeFileSync(W(f), JSON.stringify(v));

export const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
const uciOf = (m) => m.from + m.to + (m.promotion || '');
export const ELO = +(process.env.ELO || 2000); // niveau des joueurs simulés par Maia
const BOOK_PLIES = 16; // profondeur des variantes retenues après les coups de départ
const TRAP_MIN_POP = 0.1; // un coup « naturel » : Maia (niveau ELO) le joue au moins une fois sur dix
const TRAP_MIN_LOSS = 200; // un piège coûte au moins deux pions
const MAIN_MAX_LOSS = 60; // la ligne principale ne contient aucun coup perdant plus de 0,6 pion

function sanLine(sans) {
  const c = new Chess(); const out = [];
  for (const s of (Array.isArray(sans) ? sans : sans.trim().split(/\s+/)).filter(Boolean)) {
    const m = c.move(s.replace(/^\d+\.+/, ''));
    out.push({ uci: uciOf(m), san: m.san, before: m.before, after: m.after, color: m.color });
  }
  return out;
}
const parseTsvPgn = (pgn) => pgn.replace(/\d+\.\s*/g, ' ').trim().split(/\s+/);

/* ---------- 1. Nœuds : variantes nommées, lignes principales, pièges classiques ---------- */
if (step === 'noeuds') {
  const dir = rest[0];
  const rows = [];
  for (const f of 'abcde') for (const line of fs.readFileSync(path.join(dir, `${f}.tsv`), 'utf8').split('\n').slice(1)) {
    const [eco, name, pgn] = line.split('\t'); if (pgn) rows.push({ eco, name, moves: sanLine(parseTsvPgn(pgn)) });
  }
  const names = {}; // position (clé) → nom Lichess le plus court qui y mène
  for (const r of rows) { const k = key(r.moves[r.moves.length - 1].after); if (!names[k] || r.name.length < names[k].length) names[k] = r.name; }
  const nodes = new Map(); // clé → { fen, prior }
  const addLine = (moves, upto) => moves.slice(0, upto).forEach((m, i) => {
    const k = key(m.before); if (!nodes.has(k)) nodes.set(k, { fen: m.before, prior: moves.slice(Math.max(0, i - 8), i).map((x) => x.before) });
  });
  const out = [];
  for (const o of OPENINGS) {
    const rootL = sanLine(o.root); const main = sanLine(o.main);
    if (o.main.indexOf(o.root) !== 0) throw new Error(`${o.id} : la ligne principale ne commence pas par les coups de départ`);
    const last = rootL[rootL.length - 1];
    if (last.color !== o.side) throw new Error(`${o.id} : le dernier coup de départ doit être joué par le camp de l'ouverture`);
    const n = rootL.length; const lines = rows.filter((r) => r.moves.length > n && rootL.every((m, i) => r.moves[i].uci === m.uci));
    lines.forEach((r) => addLine(r.moves, Math.min(r.moves.length, n + BOOK_PLIES)));
    addLine(main, main.length);
    const traps = CLASSIC_TRAPS.filter((t) => t.opening === o.id).map((t) => ({ ...t, moves: sanLine(t.line) }));
    traps.forEach((t) => { if (t.moves.length <= t.bait) throw new Error(`${t.title} : rang du coup fautif hors de la ligne`); addLine(t.moves, t.moves.length); });
    out.push({ id: o.id, root: rootL, main, lines: lines.map((r) => ({ name: r.name, eco: r.eco, moves: r.moves.map((m) => m.uci) })), traps });
    console.log(`${o.id.padEnd(16)} ${String(lines.length).padStart(3)} variantes nommées, ligne principale de ${main.length} demi-coups`);
  }
  save('openings.json', out); save('names.json', names); save('nodes.json', [...nodes.values()]);
  console.log(nodes.size, 'positions à évaluer');
}

/* ---------- 2. Maia (niveau ELO) : probabilité de chaque coup dans chaque position ---------- */
if (step === 'maia') {
  const { open } = await import('../navigateur/outils.mjs');
  const nodes = load('nodes.json');
  const res = fs.existsSync(W('maia.json')) ? load('maia.json') : {};
  const { browser, page } = await open();
  await page.goto(process.env.BASE || 'http://localhost:8766/');
  await page.evaluate(async () => { window.__m = await import(new URL('maia/maia.mjs', location.href).href); await window.__m.load(new URL('maia/', location.href).href); });
  const todo = nodes.filter((n) => !res[key(n.fen)]);
  for (let i = 0; i < todo.length; i += 50) {
    const got = await page.evaluate(async ([chunk, elo]) => {
      const o = []; for (const n of chunk) { const mv = await window.__m.policy(n.fen, elo, elo, n.prior); o.push(mv.filter((x) => x[1] >= 0.005).sort((a, b) => b[1] - a[1]).map((x) => [x[0], +x[1].toFixed(4)])); } return o;
    }, [todo.slice(i, i + 50), ELO]);
    got.forEach((g, j) => { res[key(todo[i + j].fen)] = g; });
    save('maia.json', res);
    if ((i / 50) % 10 === 0) console.log(Object.keys(res).length, '/', nodes.length);
  }
  await browser.close(); console.log('fini', Object.keys(res).length);
}

/* ---------- 3. Stockfish ---------- */
export function engine() {
  const p = spawn('node', [path.join(root, 'node_modules/stockfish/bin/stockfish-19-lite-single.js')]);
  let buf = ''; let wait = null; let lines = new Map();
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    const m = l.match(/ multipv (\d+) score (cp|mate) (-?\d+).* pv (.+)$/);
    if (m && !/ (lowerbound|upperbound) /.test(l)) lines.set(+m[1], { cp: m[2] === 'cp' ? +m[3] : (+m[3] > 0 ? 10000 - +m[3] : -10000 - +m[3]), mate: m[2] === 'mate' ? +m[3] : null, pv: m[4].split(' ') });
    if (wait && l.startsWith(wait.k)) { const w = wait; wait = null; w.r(l); } } });
  const send = (c, k) => new Promise((r) => { if (k) wait = { k, r }; p.stdin.write(`${c}\n`); if (!k) r(); });
  return {
    async init() { await send('uci', 'uciok'); await send('setoption name Hash value 64'); await send('isready', 'readyok'); },
    // Coups du camp au trait, du meilleur au moins bon ; cp du point de vue de ce camp. only : limiter à ces coups.
    async analyse(fen, depth, multipv = 1, only) {
      lines = new Map(); await send(`setoption name MultiPV value ${multipv}`); await send(`position fen ${fen}`);
      await send(`go depth ${depth}${only && only.length ? ` searchmoves ${only.join(' ')}` : ''}`, 'bestmove');
      return [...lines.values()].map((x) => ({ uci: x.pv[0], cp: x.cp, mate: x.mate, pv: x.pv })).sort((a, b) => b.cp - a.cp);
    },
    kill() { p.kill(); },
  };
}

if (step === 'moteur') {
  const part = +(rest[0] || 0); const parts = +(rest[1] || 1);
  const ops = load('openings.json'); const M = load('maia.json');
  const outF = `moteur-${part}.json`; const res = fs.existsSync(W(outF)) ? load(outF) : {};
  const e = engine(); await e.init(); let n = 0; const t0 = Date.now();
  const run = async (id, fn) => { if (res[id] !== undefined) return; if (n++ % parts !== part) return; res[id] = await fn(); if (Object.keys(res).length % 20 === 0) { save(outF, res); console.log(part, Object.keys(res).length, Math.round((Date.now() - t0) / 1000) + 's'); } };
  for (const o of ops) {
    const fen0 = o.root[o.root.length - 1].after; const pol0 = M[key(fen0)] || [];
    // a) à la racine : meilleurs coups du camp qui affronte l'ouverture, et réponses les plus jouées
    await run(`racine:${o.id}`, async () => {
      const top = await e.analyse(fen0, 18, 4);
      const pop = pol0.slice(0, 4).map((x) => x[0]).filter((u) => !top.some((t) => t.uci === u));
      const extra = pop.length ? await e.analyse(fen0, 18, pop.length, pop) : [];
      return [...top, ...extra].map((x) => ({ uci: x.uci, cp: x.cp, mate: x.mate }));
    });
    // b) pour les trois réponses les plus jouées : la meilleure suite pour le camp de l'ouverture
    for (const [u] of pol0.slice(0, 3)) {
      await run(`reponse:${o.id}:${u}`, async () => { const c = new Chess(fen0); c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); const r = await e.analyse(c.fen(), 18, 1); return { uci: r[0].uci, cp: r[0].cp, mate: r[0].mate }; });
    }
    // c) ligne principale : perte de chaque coup après les coups de départ
    for (let i = o.root.length; i < o.main.length; i += 1) {
      const m = o.main[i];
      await run(`ligne:${o.id}:${i}`, async () => { const top = await e.analyse(m.before, 16, 1); const mine = top[0].uci === m.uci ? top[0] : (await e.analyse(m.before, 16, 1, [m.uci]))[0]; return { best: top[0].uci, bestCp: top[0].cp, cp: mine.cp }; });
    }
    // d) pièges classiques : le coup fautif, puis chaque coup de la punition
    for (const t of o.traps) {
      for (let i = t.bait; i < t.moves.length; i += 1) {
        const m = t.moves[i]; const c = new Chess(m.before); if (c.isGameOver()) continue;
        await run(`piege:${o.id}:${t.title}:${i}`, async () => { const top = await e.analyse(m.before, 16, 1); const mine = top[0].uci === m.uci ? top[0] : (await e.analyse(m.before, 16, 1, [m.uci]))[0]; return { best: top[0].uci, bestCp: top[0].cp, cp: mine.cp, pv: top[0].pv.slice(0, 10) }; });
      }
    }
  }
  // e) pièges trouvés automatiquement : dans chaque position des variantes, un coup que Maia joue souvent mais qui perd beaucoup
  const seen = new Set();
  for (const o of ops) {
    const lines = [...o.lines.map((l) => l.moves), o.main.map((m) => m.uci)];
    for (const l of lines) {
      const c = new Chess();
      for (let i = 0; i < Math.min(l.length, o.root.length + BOOK_PLIES); i += 1) {
        const fen = c.fen(); const k = key(fen);
        if (i >= o.root.length && !seen.has(k)) {
          seen.add(k);
          const cand = (M[k] || []).filter((x) => x[1] >= TRAP_MIN_POP).slice(0, 4).map((x) => x[0]);
          if (cand.length) await run(`auto:${k}`, async () => { const top = await e.analyse(fen, 12, 1); const r = await e.analyse(fen, 12, cand.length, cand); return { best: top[0].uci, bestCp: top[0].cp, moves: r.map((x) => [x.uci, x.cp]) }; });
        }
        c.move({ from: l[i].slice(0, 2), to: l[i].slice(2, 4), promotion: l[i][4] });
      }
    }
  }
  save(outF, res); e.kill(); console.log('fini', part, Object.keys(res).length);
}

/* ---------- 3 bis. Confirmation des pièges trouvés automatiquement, plus profond ---------- */
if (step === 'confirmer') {
  const part = +(rest[0] || 0); const parts = +(rest[1] || 1);
  const M = load('maia.json'); const E = Object.assign({}, ...fs.readdirSync(work).filter((f) => /^moteur-\d+\.json$/.test(f)).map((f) => load(f)));
  const nodes = new Map(load('nodes.json').map((n) => [key(n.fen), n.fen]));
  const done = Object.assign({}, ...fs.readdirSync(work).filter((f) => /^confirmes.*\.json$/.test(f)).map((f) => load(f)));
  const outF = `confirmes-${part}.json`; const res = fs.existsSync(W(outF)) ? load(outF) : {};
  // Candidats : position équilibrée, coup joué souvent par Maia, perte d'au moins deux pions à profondeur 12.
  // Les plus probables d'abord, pour que les pièges les plus utiles soient confirmés en premier.
  const cand = [];
  for (const [id, v] of Object.entries(E)) {
    if (!id.startsWith('auto:') || Math.abs(v.bestCp) > 250) continue;
    const k = id.slice(5);
    for (const [u, cp] of v.moves) { const p = ((M[k] || []).find((x) => x[0] === u) || [0, 0])[1]; if (v.bestCp - cp >= TRAP_MIN_LOSS && !done[`${k}|${u}`]) cand.push({ k, u, score: p * Math.min(600, v.bestCp - cp) }); }
  }
  cand.sort((a, b) => b.score - a.score);
  const e = engine(); await e.init();
  for (let i = part; i < cand.length; i += parts) {
    const { k, u } = cand[i]; const fen = nodes.get(k);
    const top = await e.analyse(fen, 16, 1); const mine = (await e.analyse(fen, 16, 1, [u]))[0];
    const c = new Chess(fen); c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    const after = (await e.analyse(c.fen(), 16, 1))[0];
    res[`${k}|${u}`] = { fen, bait: u, pop: ((M[k] || []).find((x) => x[0] === u) || [0, 0])[1], bestCp: top[0].cp, best: top[0].uci, cp: mine.cp, refutation: after.pv.slice(0, 8), afterCp: after.cp, mate: after.mate };
    save(outF, res); console.log(part, `${i + 1}/${cand.length}`, u, top[0].cp, mine.cp);
  }
  e.kill(); console.log('fini', part);
}

/* ---------- 4. Assemblage de src/openings.json ---------- */
const MAT = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const material = (fen, color) => { let s = 0; for (const ch of fen.split(' ')[0]) { const l = ch.toLowerCase(); if (MAT[l] !== undefined) s += (ch === l ? 'b' : 'w') === color ? MAT[l] : -MAT[l]; } return s; };
const sanOf = (fen, u) => new Chess(fen).move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san;
const FR = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };
const frSan = (s) => s.replace(/[KQRBN]/g, (c) => FR[c]);
const numbered = (fen, ucis) => { const c = new Chess(fen); return ucis.map((u, i) => { const n = c.moveNumber(); const w = c.turn() === 'w'; const s = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san; return (w ? `${n}.` : i === 0 ? `${n}…` : '') + s; }).join(' '); };

if (step === 'assembler') {
  const ops = load('openings.json'); const M = load('maia.json'); const names = load('names.json');
  const E = Object.assign({}, ...fs.readdirSync(work).filter((f) => /^moteur-\d+\.json$/.test(f)).map((f) => load(f)));
  const C = Object.assign({}, ...fs.readdirSync(work).filter((f) => /^confirmes.*\.json$/.test(f)).map((f) => load(f)));
  const pop = (k, u) => ((M[k] || []).find((x) => x[0] === u) || [0, 0])[1];
  const book = {}; const usedNames = {}; const report = [];
  const addBook = (ucis, upto) => { const c = new Chess(); ucis.slice(0, upto).forEach((u) => { const k = key(c.fen()); book[k] = book[k] || {}; book[k][u] = Math.max(0.003, pop(k, u)); c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); if (names[key(c.fen())]) usedNames[key(c.fen())] = names[key(c.fen())]; }); };
  const out = [];
  for (const o of ops) {
    const def = OPENINGS.find((d) => d.id === o.id);
    const n = o.root.length; const fen0 = o.root[n - 1].after; const k0 = key(fen0);
    const rootUci = o.root.map((m) => m.uci); const mainUci = o.main.map((m) => m.uci);
    o.lines.forEach((l) => addBook(l.moves, n + BOOK_PLIES)); addBook(mainUci, mainUci.length);
    // Meilleurs coups contre l'ouverture (camp au trait après les coups de départ)
    const best = (E[`racine:${o.id}`] || []).map((x) => ({ uci: x.uci, cp: x.cp, mate: x.mate, pop: pop(k0, x.uci) }))
      .filter((x, i, a) => a.findIndex((y) => y.uci === x.uci) === i).sort((a, b) => b.cp - a.cp).slice(0, 6);
    const replies = (M[k0] || []).slice(0, 3).map(([u, p]) => ({ uci: u, pop: p, answer: E[`reponse:${o.id}:${u}`] || null }));
    // Contrôle de la ligne principale
    for (let i = n; i < o.main.length; i += 1) { const r = E[`ligne:${o.id}:${i}`]; if (r && r.bestCp - r.cp > MAIN_MAX_LOSS) report.push(`${o.id} : ligne principale, coup ${i + 1} (${o.main[i].san}) perd ${r.bestCp - r.cp} (meilleur ${sanOf(o.main[i].before, r.best)})`); }
    // Pièges classiques : vérification
    const traps = [];
    for (const t of o.traps) {
      const b = E[`piege:${o.id}:${t.title}:${t.bait}`]; const ucis = t.moves.map((m) => m.uci);
      const problems = [];
      if (!b) problems.push('non évalué'); else if (b.bestCp - b.cp < 90) problems.push(`le coup fautif ne perd que ${b.bestCp - b.cp}`);
      for (let i = t.bait + 1; i < t.moves.length; i += 1) {
        const r = E[`piege:${o.id}:${t.title}:${i}`]; if (!r) continue;
        const punisher = (i - t.bait) % 2 === 1;
        if (punisher && r.bestCp - r.cp > 50 && !(r.cp > 900)) problems.push(`coup ${i + 1} (${t.moves[i].san}) n'est pas le meilleur (perd ${r.bestCp - r.cp}, meilleur ${sanOf(t.moves[i].before, r.best)})`);
      }
      if (problems.length) report.push(`${o.id} : piège « ${t.title} » : ${problems.join(' ; ')}`);
      const victim = t.moves[t.bait].color;
      traps.push({ title: t.title, text: t.text, victim, moves: ucis, bait: t.bait, pop: pop(key(t.moves[t.bait].before), ucis[t.bait]), cpBefore: b ? b.bestCp : null, cpAfter: b ? b.cp : null, auto: false, ok: !problems.length });
    }
    // Pièges trouvés automatiquement dans les variantes de cette ouverture
    const paths = new Map(); // clé → coups depuis le début
    for (const l of [...o.lines.map((x) => x.moves), mainUci]) { const c = new Chess(); for (let i = 0; i < Math.min(l.length, n + BOOK_PLIES); i += 1) { const kk = key(c.fen()); if (i >= n && !paths.has(kk)) paths.set(kk, l.slice(0, i)); c.move({ from: l[i].slice(0, 2), to: l[i].slice(2, 4), promotion: l[i][4] }); } }
    const autos = Object.values(C).map((t) => ({ ...t, pop: pop(key(t.fen), t.bait) })).filter((t) => paths.has(key(t.fen)) && t.pop >= TRAP_MIN_POP && t.bestCp - t.cp >= TRAP_MIN_LOSS && Math.abs(t.bestCp) <= 250)
      .filter((t) => !traps.some((x) => key(new Chess(t.fen).fen()) === key((() => { const c = new Chess(); x.moves.slice(0, x.bait).forEach((u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })); return c.fen(); })()) && x.moves[x.bait] === t.bait))
      .sort((a, b) => b.pop * Math.min(600, b.bestCp - b.cp) - a.pop * Math.min(600, a.bestCp - a.cp)).slice(0, 3);
    for (const t of autos) {
      const path0 = paths.get(key(t.fen)); const victim = t.fen.split(' ')[1];
      const after = new Chess(t.fen); after.move({ from: t.bait.slice(0, 2), to: t.bait.slice(2, 4), promotion: t.bait[4] });
      const ref = t.refutation.slice(0, 6); const end = new Chess(after.fen()); const refOk = [];
      for (const u of ref) { try { end.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); refOk.push(u); } catch { break; } }
      // Le texte ne dit que ce que le moteur a vérifié : la perte chiffrée et la suite la plus forte.
      const baitSan = sanOf(t.fen, t.bait); const bestSan = sanOf(t.fen, t.best);
      const lossTxt = t.mate != null || t.cp < -5000 ? 'mène au mat' : `perd environ ${Math.round((t.bestCp - t.cp) / 100)} pions selon Stockfish`;
      const text = `${victim === 'w' ? 'Les Blancs' : 'Les Noirs'} jouent souvent ${baitSan} ici (environ ${Math.round(t.pop * 100)} % des joueurs de ${ELO} selon Maia), mais ce coup ${lossTxt}. Suite la plus forte pour les ${victim === 'w' ? 'Noirs' : 'Blancs'} : ${numbered(after.fen(), refOk)}. Meilleur coup : ${bestSan}.`;
      traps.push({ title: `Le coup ${baitSan} ?`, text, victim, moves: [...path0, t.bait, ...refOk], bait: path0.length, pop: t.pop, cpBefore: t.bestCp, cpAfter: t.cp, auto: true, ok: true });
    }
    // Variantes nommées les plus probables (produit des probabilités Maia depuis les coups de départ)
    const scored = o.lines.map((l) => { const c = new Chess(); let p = 1; l.moves.forEach((u, i) => { if (i >= n) p *= Math.max(0.01, pop(key(c.fen()), u)); c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); }); return { name: l.name, moves: l.moves, p }; });
    const seenName = new Set(); const variations = [];
    for (const v of scored.sort((a, b) => b.p - a.p)) { const base = v.name; if (seenName.has(base) || v.moves.length > n + BOOK_PLIES) continue; seenName.add(base); variations.push({ name: v.name, moves: v.moves }); if (variations.length >= 8) break; }
    out.push({ id: o.id, name: def.name, side: def.side, root: rootUci, main: mainUci, idea: def.idea, forces: def.forces, faiblesses: def.faiblesses, against: def.against, with: def.with, best, replies, traps: traps.filter((t) => t.ok).map(({ ok, ...t }) => t), variations });
  }
  const data = { elo: ELO, source: `Noms : github.com/lichess-org/chess-openings (CC0). Popularité : Maia-3 à ${ELO} Elo. Évaluations : Stockfish 18 (profondeur 16 à 18).`, openings: out, book: Object.fromEntries(Object.entries(book).map(([k, v]) => [k, Object.entries(v).map(([u, w]) => [u, +w.toFixed(3)])])), names: usedNames };
  fs.writeFileSync(path.join(root, 'src/openings.json'), JSON.stringify(data));
  console.log(report.length ? `À CORRIGER :\n  ${report.join('\n  ')}` : 'Aucun problème');
  console.log(`src/openings.json : ${Math.round(fs.statSync(path.join(root, 'src/openings.json')).size / 1000)} Ko ; pièges : ${out.map((o) => `${o.id} ${o.traps.length}`).join(', ')}`);
}
