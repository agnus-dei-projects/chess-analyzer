// Parties simulées pour vérifier les forces et faiblesses annoncées dans les cours (src/openings-def.js).
//   node tests/ouvertures/simuler.mjs parties <travail> [part] [parts]   (Chrome + Playwright, appli servie : BASE=…)
//   node tests/ouvertures/simuler.mjs moteur  <travail> [part] [parts]
//   node tests/ouvertures/simuler.mjs mesures <travail>
// Parties : Maia contre Maia au niveau ELO (2000 par défaut) depuis les coups de départ, PLIES demi-coups, GAMES parties par ouverture.
import fs from 'fs'; import path from 'path'; import { Chess } from 'chess.js';
import { OPENINGS } from '../../src/openings-def.js';
import { engine, ELO } from './construire.mjs';

export const GAMES = 40;
export const PLIES = 30;
const [step, work, partS, partsS] = process.argv.slice(2);
const part = +(partS || 0); const parts = +(partsS || 1);
const W = (f) => path.join(work, f);
const load = (f) => JSON.parse(fs.readFileSync(W(f)));
const save = (f, v) => fs.writeFileSync(W(f), JSON.stringify(v));
const rootOf = (o) => { const c = new Chess(); o.root.split(' ').forEach((s) => c.move(s)); return c.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')); };

if (step === 'parties') {
  const { open } = await import('../navigateur/outils.mjs');
  const outF = `parties-${part}.json`; const res = fs.existsSync(W(outF)) ? load(outF) : {};
  const { browser, page } = await open();
  await page.goto(process.env.BASE || 'http://localhost:8766/');
  await page.evaluate(async () => { window.__m = await import(new URL('maia/maia.mjs', location.href).href); await window.__m.load(new URL('maia/', location.href).href); });
  const t0 = Date.now();
  for (let i = part; i < OPENINGS.length; i += parts) {
    const o = OPENINGS[i]; res[o.id] = res[o.id] || [];
    while (res[o.id].length < GAMES) {
      const c = new Chess(); const moves = rootOf(o); moves.forEach((u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }));
      for (let k = 0; k < PLIES && !c.isGameOver(); k += 1) {
        const u = await page.evaluate(([fen, elo]) => window.__m.move(fen, elo, elo, 1), [c.fen(), ELO]);
        c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); moves.push(u);
      }
      res[o.id].push(moves);
      save(outF, res);
    }
    console.log(part, o.id, res[o.id].length, Math.round((Date.now() - t0) / 1000) + 's');
  }
  await browser.close(); console.log('fini', part);
}

/* Stockfish : évaluation (profondeur 10) de chaque position, du point de vue du camp au trait. */
if (step === 'moteur') {
  const G = Object.assign({}, ...fs.readdirSync(work).filter((f) => /^parties-\d+\.json$/.test(f)).map((f) => load(f)));
  const outF = `evals-${part}.json`; const res = fs.existsSync(W(outF)) ? load(outF) : {};
  const e = engine(); await e.init(); let n = 0; const t0 = Date.now();
  for (const o of OPENINGS) {
    for (let g = 0; g < (G[o.id] || []).length; g += 1) {
      const id = `${o.id}:${g}`; if (res[id] || (n++ % parts) !== part) continue;
      const c = new Chess(); const moves = G[o.id][g]; const evs = [];
      for (let i = 0; i <= moves.length; i += 1) {
        if (i >= rootOf(o).length) {
          if (c.isGameOver()) { evs.push(c.isCheckmate() ? -10000 : 0); } else { const r = await e.analyse(c.fen(), 10, 1); evs.push(Math.max(-3000, Math.min(3000, r[0].cp))); }
        } else evs.push(null);
        if (i < moves.length) c.move({ from: moves[i].slice(0, 2), to: moves[i].slice(2, 4), promotion: moves[i][4] });
      }
      res[id] = evs; save(outF, res);
      if (Object.keys(res).length % 40 === 0) console.log(part, Object.keys(res).length, Math.round((Date.now() - t0) / 1000) + 's');
    }
  }
  e.kill(); save(outF, res); console.log('fini', part, Object.keys(res).length);
}
