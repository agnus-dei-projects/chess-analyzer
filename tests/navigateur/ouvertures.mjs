// Ouvertures : menu, cours des 30 ouvertures, entraînement (coups vérifiés, erreurs, pièges), suite libre, pannes.
import { B, ctl, open, engine, expect, finish } from './outils.mjs';
const sf = engine(); await sf.init();
const st = (page) => page.evaluate(() => ({ ply: window.__P.ply, done: window.__P.done, thinking: window.__P.thinking, free: window.__P.free, fen: window.__P.c && window.__P.c.fen(), san: window.__P.c ? window.__P.c.history() : [], mistakes: window.__P.mistakes, userMoves: window.__P.userMoves, sub: document.getElementById('t-sub').textContent, msg: document.getElementById('t-msg').textContent, actions: [...document.querySelectorAll('#t-actions button')].map((b) => b.textContent) }));
const click = (page, text) => page.locator('#t-actions button', { hasText: text }).first().click();
const myTurn = (page) => page.waitForFunction(() => window.__P.opening && (window.__P.done || (window.__P.thinking === false && /À toi de jouer|Fin de l’ouverture|Imprécision|Erreur :|Gaffe|Piège/.test(document.getElementById('t-msg').textContent))), null, { timeout: 90000 });
const omove = async (page, u) => { await page.evaluate((u) => window.__omove(u.slice(0, 2), u.slice(2, 4)), u); await page.waitForFunction(() => window.__P.done || window.__P.thinking === false || /Imprécision|Erreur :|Gaffe|Piège/.test(document.getElementById('t-msg').textContent), null, { timeout: 90000 }); };
async function run(name, body, routes) { await ctl('reset=1'); const { browser, page, logs } = await open(); console.log(`\n== ${name}`); try { if (routes) await routes(page); await page.goto(B); await body(page); } catch (e) { expect(false, `scénario interrompu : ${String(e.message).slice(0, 200)}`); } const errs = logs.filter((l) => !/Service Worker|404 \(|ERR_/.test(l)); expect(!errs.length, `aucune erreur dans la console${errs.length ? ` : ${errs[0].slice(0, 160)}` : ''}`); await browser.close(); }

await run('Menu et cours des 30 ouvertures', async (page) => {
  await page.evaluate(() => { location.hash = 'exercices'; });
  expect(await page.locator('#screen-hub a[href="#ouvertures"]').count() === 1, 'Exercices propose « Ouvertures »');
  await page.locator('#screen-hub a[href="#ouvertures"]').click();
  const tiles = await page.locator('#ouv-list a.tile').count();
  expect(tiles === 30, `la liste contient 30 ouvertures (${tiles})`);
  const ids = await page.locator('#ouv-list a.tile').evaluateAll((a) => a.map((x) => x.getAttribute('href').slice(11)));
  let bad = [];
  for (const id of ids) {
    await page.evaluate((id) => { location.hash = `ouverture-${id}`; }, id);
    await page.waitForFunction(() => document.querySelectorAll('#t-course h3').length >= 5 || /pas pu/.test(document.getElementById('t-course').textContent), null, { timeout: 20000 });
    const c = await page.evaluate(() => ({ h3: [...document.querySelectorAll('#t-course h3')].map((x) => x.textContent), mv: document.querySelectorAll('#t-course .mv').length, actions: [...document.querySelectorAll('#t-actions button')].map((b) => b.textContent), title: document.getElementById('bar-title').textContent }));
    if (c.h3.length < 5 || c.mv < 10 || c.actions.length !== 2 || /Ouvertures/.test(c.title)) bad.push(`${id} ${JSON.stringify(c).slice(0, 120)}`);
  }
  expect(!bad.length, `chaque cours a ses sections, ses coups cliquables et ses deux boutons d’entraînement${bad.length ? ` : ${bad.join(' | ')}` : ''}`);
  await page.evaluate(() => { location.hash = 'ouverture-caro-kann'; });
  await page.waitForFunction(() => document.querySelectorAll('#t-course .mv').length > 10);
  const h3 = await page.evaluate(() => [...document.querySelectorAll('#t-course h3')].map((x) => x.textContent));
  expect(h3.some((t) => /Pièges/.test(t)) && h3.some((t) => /Contre cette ouverture/.test(t)) && h3.some((t) => /Si tu la joues/.test(t)), `Caro-Kann : sections contre / si tu la joues / pièges (${h3.join(', ')})`);
  await page.locator('#t-course .c-trap .mv.bad').first().click();
  await page.waitForFunction(() => document.querySelectorAll('#tboard square.last-move').length === 2, null, { timeout: 5000 }).catch(() => {});
  expect(await page.evaluate(() => document.querySelectorAll('#tboard square.last-move').length === 2 && document.querySelectorAll('#t-course .mv.on').length === 1), 'un coup cliqué s’affiche sur l’échiquier');
});

await run('Entraînement complet sans faute, puis partie libre', async (page) => {
  await page.evaluate(() => { location.hash = 'ouv-sicilienne-w'; });
  await myTurn(page); let s = await st(page);
  expect(s.san.join(' ') === 'e4 c5' && /coup 1 sur 10/.test(s.msg), `les coups de départ sont joués d’office (${s.san.join(' ')})`);
  for (let i = 0; i < 12 && !s.done; i += 1) { await omove(page, (await sf.ev(s.fen, 14)).best); await myTurn(page); s = await st(page); }
  expect(s.done && /Fin de l’ouverture : aucune erreur/.test(s.msg) && s.userMoves === 10, `10 coups du moteur joués : aucune erreur signalée (${s.msg.slice(0, 60)})`);
  expect(/1 sans faute sur 1/.test(s.sub), 'le compteur sans faute est mis à jour');
  console.log('   partie :', s.san.join(' '));
  await click(page, 'Continuer la partie');
  await page.waitForFunction(() => window.__P.free && window.__P.thinking === false && !window.__P.done, null, { timeout: 60000 });
  const before = (await st(page)).ply;
  await page.evaluate(async () => { const m = window.__P.c.moves({ verbose: true })[0]; await window.__move(m.from, m.to); });
  await page.waitForFunction(() => window.__P.thinking === false || window.__P.done, null, { timeout: 60000 });
  expect((await st(page)).ply === before + 2, 'la partie continue librement contre Maia');
});

await run('Erreur signalée, rejouée ; piège reconnu', async (page) => {
  await page.evaluate(() => { location.hash = 'ouv-caro-kann-w'; });
  await myTurn(page);
  // 2.Ba6 ? donne le fou (…bxa6 ou …Nxa6).
  await omove(page, 'f1a6'); let s = await st(page);
  expect(/Gaffe : ce coup coûte environ [\d,]+ pions selon le moteur/.test(s.msg) && /Meilleur/.test(s.msg) && s.actions.includes('Rejouer ce coup') && s.mistakes === 1, `une gaffe est signalée avec le meilleur coup (${s.msg.slice(0, 70)})`);
  await click(page, 'Rejouer ce coup'); s = await st(page);
  expect(s.san.join(' ') === 'e4 c6' && !s.thinking && /Rejoue ce coup/.test(s.msg), 'le coup est annulé, on rejoue');
  // Piège du mat étouffé : le joueur a les Noirs, on le place juste avant le coup fautif.
  await page.evaluate(() => { location.hash = 'ouv-caro-kann-b'; });
  await page.waitForFunction(() => window.__P.opening && window.__P.ply >= 2, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__P.thinking === false, null, { timeout: 90000 });
  await page.evaluate(() => { const C = window.__P.c.constructor; const c = new C(); ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'Qe2'].forEach((x) => c.move(x)); window.__P.c = c; window.__P.thinking = false; window.__P.done = false; });
  await omove(page, 'g8f6'); s = await st(page);
  expect(/Piège : Le mat étouffé en d6/.test(s.msg), `le piège classique est reconnu et expliqué (${s.msg.slice(0, 60)})`);
});

await run('Données indisponibles', async (page) => {
  await page.evaluate(() => { location.hash = 'ouverture-francaise'; });
  await page.waitForFunction(() => /pas pu être chargé/.test(document.getElementById('t-course').textContent), null, { timeout: 20000 });
  expect(true, 'cours : message clair si le fichier des ouvertures ne vient pas');
  await page.unroute('**/openings.json');
  await page.locator('#t-course button', { hasText: 'Réessayer' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#t-course h3').length >= 5, null, { timeout: 20000 });
  expect(true, '« Réessayer » charge le cours une fois le réseau revenu');
}, (page) => page.route('**/openings.json', (r) => r.abort('failed')));

sf.kill(); finish();
