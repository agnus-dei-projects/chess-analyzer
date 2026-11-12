// Parcours complets : verdict et partie libre, changement de position, analyse, problèmes.
import { B, open, ui, waitMsg, engine, expect, finish } from './outils.mjs';
const sf = engine(); await sf.init();
const st = (page) => page.evaluate(() => ({ ply: window.__P.ply, done: window.__P.done, free: window.__P.free, tries: window.__P.tries, fen: window.__P.c.fen(), start: window.__P.startFen, sub: document.getElementById('t-sub').textContent, msg: document.getElementById('t-msg').textContent, actions: [...document.querySelectorAll('#t-actions button')].map((b) => b.textContent), elo: document.getElementById('t-elo').textContent, delta: document.getElementById('t-delta').textContent }));
const mv = async (page, u) => { await page.evaluate(async (u) => { const pr = window.__move(u.slice(0, 2), u.slice(2, 4)); if (u[4]) { await new Promise((r) => setTimeout(r, 60)); const b = document.querySelector('.promo button[aria-label="Dame"]'); if (b) b.click(); } await pr; }, u); await page.waitForFunction(() => window.__P.done || window.__P.thinking === false, null, { timeout: 60000 }); };
const click = (page, text) => page.locator('#t-actions button', { hasText: text }).click();
const playable = (page) => page.waitForFunction(() => window.__P.c && window.__P.thinking === false && !window.__P.done, null, { timeout: 60000 });
const startAt = async (page, id, fen) => { await page.evaluate(({ id, fen }) => { location.hash = 'exercices'; if (fen) localStorage.setItem(`current-${id}`, JSON.stringify({ fen, rated: false })); localStorage.setItem(`elo-${id}`, JSON.stringify({ r: 800, n: 0 })); }, { id, fen }); await page.evaluate((id) => { location.hash = `situation-${id}`; }, id); await playable(page); };
const best = async (page) => { for (let i = 0; i < 200; i += 1) { const s = await st(page); if (s.done) return s; await mv(page, (await sf.ev(s.fen, 10)).best); } return st(page); };
// Le plus mauvais coup légal d'après le moteur : de quoi perdre vite.
const worst = async (page) => { for (let i = 0; i < 60; i += 1) { const s = await st(page); if (s.done) return s; const after = await page.evaluate(() => window.__P.c.moves({ verbose: true }).slice(0, 40).map((m) => { const c = new window.__P.c.constructor(window.__P.c.fen()); c.move(m); return { u: m.from + m.to + (m.promotion || ''), fen: c.isGameOver() ? null : c.fen() }; })); let w = null; for (const a of after) { if (!a.fen) continue; const e = (await sf.ev(a.fen, 6)).cp; if (!w || e > w.e) w = { u: a.u, e }; } await mv(page, w ? w.u : after[0].u); } return st(page); };
async function run(name, body, routes) { const { browser, page } = await open(); console.log(`\n== ${name}`); try { if (routes) await routes(page); await page.goto(`${B}#exercices`); await body(page); } catch (e) { expect(false, `scénario interrompu : ${String(e.message).slice(0, 200)}`); } await browser.close(); }

await run('Verdict gagné, puis partie libre jusqu’au mat', async (page) => {
  await startAt(page, 'attack', '4kr2/R6p/8/4pq2/8/N7/PrPB1P1P/2KR4 b - - 1 21');
  const v = await best(page);
  expect((/mat/.test(v.msg) || (v.ply >= 4 && /confirmée/.test(v.msg))) && v.delta === '+50', `mat, ou verdict tenu au moins deux tours (ici ${Math.ceil(v.ply / 2)} coups : ${v.msg.slice(0, 40)})`);
  if (v.actions.includes('Continuer la partie')) {
    await click(page, 'Continuer la partie'); const f = await st(page);
    expect(f.free && !f.done && /Partie libre/.test(f.sub), 'la partie se poursuit librement');
    const end = await best(page);
    expect(/mat/.test(end.msg) && end.elo === v.elo && end.actions[0] === 'Situation suivante', 'elle va jusqu’au mat sans recompter l’Elo');
  }
  expect(await page.evaluate(() => localStorage.getItem('current-attack')) === 'null', 'la position réussie n’est plus à refaire');
});
await run('Trois essais manqués, puis changement de position', async (page) => {
  await startAt(page, 'pawn', '8/6p1/p3P3/3k3P/6P1/7K/8/8 b - - 0 1');
  let s;
  for (let k = 1; k <= 3; k += 1) { s = await worst(page); if (k === 1) expect(s.ply >= 4 && s.delta === '−50' && !s.actions.includes('Passer cette position'), 'premier échec : Elo compté, pas encore de changement possible'); if (k === 2) expect(s.delta === '', 'deuxième essai : Elo inchangé'); if (k < 3) { await click(page, 'Réessayer'); await playable(page); } }
  expect(s.tries === 3 && s.actions.includes('Passer cette position'), 'après trois échecs, on peut changer de position');
  const before = s.start; await click(page, 'Passer cette position'); await playable(page);
  expect((await st(page)).start !== before, 'une autre position est proposée');
});
await run('Elo de départ d’un thème jamais joué', async (page) => {
  await page.evaluate(() => { localStorage.clear(); });
  await page.evaluate(() => { location.hash = 'situation-rook'; }); await playable(page);
  expect((await st(page)).elo === '800', 'sans aucun Elo établi : 800');
  await page.evaluate(() => { location.hash = 'exercices'; localStorage.clear(); localStorage.setItem('elo-puzzle', JSON.stringify({ r: 1630, n: 40 })); localStorage.setItem('elo-pawn', JSON.stringify({ r: 1900, n: 20 })); localStorage.setItem('elo-attack', JSON.stringify({ r: 2400, n: 5 })); });
  await page.evaluate(() => { location.hash = 'situation-rook'; }); await playable(page);
  expect((await st(page)).elo === '1775', `démarre à la moyenne des Elo stabilisés (problèmes 1630, pions 1900 ; l’attaque, trop peu jouée, ne compte pas) : ${(await st(page)).elo}`);
});
await run('Abandon, analyse, identifiant inconnu', async (page) => {
  await startAt(page, 'rook'); await mv(page, (await sf.ev((await st(page)).fen, 8)).best); await click(page, 'Abandonner');
  const s = await st(page); expect(s.done && !s.actions.includes('Continuer la partie') && s.actions.includes('Analyser cette partie'), 'abandon : essai clos');
  await click(page, 'Analyser cette partie'); await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.body.dataset.screen === 'analyse' && window.__state.game.plies.length === 2), 'la partie s’ouvre dans l’analyse');
  await page.evaluate(() => { location.hash = 'situation-xyz'; }); await page.waitForTimeout(500);
  expect(/n’existe pas/.test((await ui(page)).msg), 'identifiant inconnu : message clair, pas de plantage');
});

// Problèmes, avec des sources simulées.
const row = (id, FEN, Moves, Rating, Themes) => ({ row: { PuzzleId: id, FEN, Moves, Rating, RatingDeviation: 80, Popularity: 90, NbPlays: 500, Themes } });
const ROWS = [row('m1', '6k1/1p3ppp/8/8/8/8/5PPP/R5K1 b - - 0 1', 'b7b6 a1a8', 790, ['mate', 'mateIn1', 'backRankMate']), row('m2', 'r2r2k1/1p3ppp/8/8/8/8/3R1PPP/3R2K1 b - - 0 1', 'b7b6 d2d8 a8d8 d1d8', 820, 'mate mateIn2 backRankMate'), row('bad', 'pas une position', 'e2e4 e7e5', 800, ['mate'])];
const LICHESS = { game: { pgn: 'e4 e5 Qh5 Nc6 Bc4 Nf6' }, puzzle: { id: 'li1', rating: 700, solution: ['h5f7'], themes: ['mateIn1'], initialPly: 5 } };
const net = { hf: 'ok', li: 'ok' };
const routes = async (page) => { await page.route('**datasets-server.huggingface.co/**', (r) => (net.hf === 'ok' ? r.fulfill({ json: { rows: ROWS } }) : net.hf === 'hang' ? null : r.abort('failed'))); await page.route('**lichess.org/api/**', (r) => (net.li === 'ok' ? r.fulfill({ json: LICHESS }) : r.abort('failed'))); };
const pm = async (page, u) => { await page.evaluate((u) => window.__pmove(u.slice(0, 2), u.slice(2, 4)), u); await page.waitForTimeout(700); };
const ps = (page) => page.evaluate(() => ({ ...{ sub: document.getElementById('t-sub').textContent, msg: document.getElementById('t-msg').textContent, actions: [...document.querySelectorAll('#t-actions button')].map((b) => b.textContent), delta: document.getElementById('t-delta').textContent }, id: window.__P.p && window.__P.p.id }));
const solve = async (page, id) => { if (id === 'm1') await pm(page, 'a1a8'); else { await pm(page, 'd2d8'); await page.waitForTimeout(600); await pm(page, 'd1d8'); } };
const puzzles = (page) => page.evaluate(() => { location.hash = 'problemes'; });
await run('Problèmes : bon coup, mauvais coup, solution', async (page) => {
  await puzzles(page); await waitMsg(page, /Trouve la meilleure suite/, 20000); let s = await ps(page);
  await solve(page, s.id); s = await ps(page); expect(/Résolu du premier coup/.test(s.msg) && /Mat/.test(s.sub) && s.delta.startsWith('+'), 'résolu du premier coup, thèmes affichés');
  await click(page, 'Problème suivant'); await waitMsg(page, /Trouve la meilleure suite/, 20000); const id = (await ps(page)).id;
  await pm(page, 'g1h1'); await page.waitForFunction(() => document.querySelectorAll('#t-actions button').length > 0, null, { timeout: 30000 }); s = await ps(page);
  expect(s.actions.includes('Réessayer') && s.delta.startsWith('−') && s.msg.length > 20, 'mauvais coup expliqué, Elo retiré une fois');
  await click(page, 'Réessayer'); await click(page, 'Voir la solution'); await waitMsg(page, /À toi de la rejouer/, 30000);
  await solve(page, id); s = await ps(page); expect(/pas du premier coup/.test(s.msg) && s.actions.includes('Problème suivant'), 'solution montrée puis rejouée : problème clos');
}, routes);
await run('Problèmes : sources en panne', async (page) => {
  net.hf = 'down'; await puzzles(page); await waitMsg(page, /Trouve la meilleure suite/, 20000);
  expect((await ps(page)).id === 'li1', 'base en panne : problème de la source de secours');
  await pm(page, 'h5f7'); expect(/Résolu/.test((await ps(page)).msg), 'il se résout normalement');
  net.li = 'down'; await page.evaluate(() => { localStorage.removeItem('puzzle-pool'); }); await page.reload(); await puzzles(page); await waitMsg(page, /Impossible de charger un problème/, 20000);
  net.hf = 'ok'; await click(page, 'Réessayer'); await waitMsg(page, /Trouve la meilleure suite/, 20000); expect(true, 'tout en panne : message, puis « Réessayer » fonctionne au retour du réseau');
  net.hf = 'hang'; net.li = 'ok'; await page.evaluate(() => { localStorage.removeItem('puzzle-pool'); localStorage.setItem('puzzle-current', 'null'); localStorage.removeItem('puzzle-seen'); }); await page.reload(); const t0 = Date.now(); await puzzles(page); await waitMsg(page, /Trouve la meilleure suite/, 30000);
  expect(Date.now() - t0 < 15000, `connexion qui ne répond jamais : secours pris au bout de ${Math.round((Date.now() - t0) / 1000)} s`);
  net.hf = 'ok';
  await page.evaluate(() => { localStorage.setItem('puzzle-current', JSON.stringify({ p: { id: 'x', start: 'abîmé', solution: ['e2e4'], rating: 900, themes: 'mate' }, failed: false })); localStorage.setItem('puzzle-pool', JSON.stringify([{ id: 'y', start: '8/8/8/8/8/8/8/8 w - - 0 1', solution: ['a1a2'], rating: 800, themes: [] }])); localStorage.removeItem('puzzle-seen'); }); await page.reload(); await puzzles(page); await waitMsg(page, /Trouve la meilleure suite|Impossible/, 20000);
  expect(/Trouve/.test((await ps(page)).msg), 'problème enregistré et réserve abîmés : écartés, un problème sain est proposé');
  await page.route('**/sf/engine.wasm', (r) => r.abort('failed')); await pm(page, 'g1h1'); await page.waitForFunction(() => document.querySelectorAll('#t-actions button').length > 0, null, { timeout: 60000 });
  expect((await ps(page)).actions.includes('Réessayer'), 'moteur en panne pendant l’explication : message simple et « Réessayer », pas de blocage');
}, routes);
sf.kill(); finish();
