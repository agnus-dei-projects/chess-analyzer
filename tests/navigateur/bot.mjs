// Affronte un bot : choix de couleur, répertoire d'ouvertures, partie complète, reprise, abandon, analyse, pannes.
import fs from 'fs';
import path from 'path';
import { B, ctl, open, engine, expect, finish, root } from './outils.mjs';
const sf = engine(); await sf.init();
const st = (page) => page.evaluate(() => ({ ply: window.__P.ply, done: window.__P.done, thinking: window.__P.thinking, maia: window.__P.maia, user: window.__P.user, fen: window.__P.c.fen(), san: window.__P.c.history(), sub: document.getElementById('t-sub').textContent, msg: document.getElementById('t-msg').textContent, actions: [...document.querySelectorAll('#t-actions button')].map((b) => b.textContent), elo: document.getElementById('t-elo').textContent }));
const click = (page, text) => page.locator('#t-actions button', { hasText: text }).first().click();
const ready = (page) => page.waitForFunction(() => window.__P.bot && (window.__P.done || window.__P.thinking === false) && /À toi|mat|nulle|abandonné/i.test(document.getElementById('t-msg').textContent), null, { timeout: 90000 });
const mv = async (page, u) => { await page.evaluate(async (u) => { const pr = window.__move(u.slice(0, 2), u.slice(2, 4)); if (u[4]) { await new Promise((r) => setTimeout(r, 60)); const b = document.querySelector('.promo button[aria-label="Dame"]'); if (b) b.click(); } await pr; }, u); await page.waitForFunction(() => window.__P.done || window.__P.thinking === false, null, { timeout: 90000 }); };
async function run(name, faults, body) { if (process.env.ONLY === '23m' && !/23M/.test(name)) return; await ctl('reset=1'); for (const f of faults) await ctl(f); const { browser, page, logs } = await open(); console.log(`\n== ${name}`); try { await page.goto(B); await body(page); } catch (e) { expect(false, `scénario interrompu : ${String(e.message).slice(0, 200)}`); } const errs = logs.filter((l) => !/Service Worker|404 \(|ERR_/.test(l)); expect(!errs.length, `aucune erreur dans la console${errs.length ? ' : ' + errs[0].slice(0, 160) : ''}`); await browser.close(); }

await run('Menu et choix de la couleur', [], async (page) => {
  expect(await page.locator('#screen-home a.big-tile').count() === 3 && /Affronte un bot/.test(await page.locator('#screen-home a.big-tile').nth(2).textContent()), 'le menu a une troisième entrée « Affronte un bot »');
  await page.locator('#screen-home a.big-tile').nth(2).click();
  expect(/jakbot/.test(await page.locator('#bots-list').textContent()), 'jakbot est proposé');
  await page.locator('#bots-list a').first().click(); await page.waitForFunction(() => /Choisis ta couleur/.test(document.getElementById('t-msg').textContent));
  expect(JSON.stringify((await st(page)).actions) === JSON.stringify(['Blancs', 'Noirs', 'Au hasard']), 'choix : Blancs, Noirs, Au hasard');
  await click(page, 'Noirs'); await ready(page); let s = await st(page);
  expect(s.user === 'b' && s.san[0] === 'd4', `avec les Blancs, jakbot ouvre par 1.d4 (joué : ${s.san[0]})`);
  // quitter puis revenir : la partie est proposée à la reprise
  await mv(page, 'g8f6'); const plyBefore = (await st(page)).ply;
  await page.evaluate(() => { location.hash = 'bots'; }); await page.waitForTimeout(300); await page.evaluate(() => { location.hash = 'bot-jakbot'; });
  await page.waitForFunction(() => /en cours/.test(document.getElementById('t-msg').textContent)); await click(page, 'Reprendre'); await ready(page); s = await st(page);
  expect(s.ply === plyBefore && s.user === 'b', 'partie quittée puis reprise au même coup');
  await click(page, 'Abandonner'); s = await st(page);
  expect(s.done && /Défaite · Bilan : 0 V · 0 N · 1 D/.test(s.sub) && s.actions.includes('Revanche'), 'abandon : défaite comptée au bilan');
  await click(page, 'Analyser'); await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.body.dataset.screen === 'analyse' && window.__state.game.plies.length >= 3), 'la partie s’ouvre dans l’analyse');
});
await run('Partie complète avec les Blancs', [], async (page) => {
  await page.evaluate(() => { location.hash = 'bot-jakbot'; }); await page.waitForFunction(() => /Choisis ta couleur/.test(document.getElementById('t-msg').textContent));
  await click(page, 'Blancs'); await ready(page); await mv(page, 'e2e4'); let s = await st(page);
  expect(s.san[1] === 'e6', `contre 1.e4, jakbot répond 1...e6 (joué : ${s.san[1]})`);
  const t0 = Date.now(); let n = 0;
  for (; n < 150 && !s.done; n += 1) { await mv(page, (await sf.ev(s.fen, 12)).best); s = await st(page); }
  expect(s.done && /mat/i.test(s.msg) && /Victoire · Bilan : 1 V/.test(s.sub), `partie menée jusqu’au mat en ${Math.ceil(s.ply / 2)} coups, victoire comptée`);
  console.log('   temps moyen par coup de jakbot :', Math.round((Date.now() - t0) / Math.max(1, n) / 100) / 10, 's ; partie :', s.san.slice(0, 16).join(' '));
  await click(page, 'Revanche'); await page.waitForFunction(() => /Choisis ta couleur/.test(document.getElementById('t-msg').textContent)); expect(true, '« Revanche » ramène au choix de la couleur');
});
await run('Modèle Maia introuvable', ['match=m.onnx&kind=status&at=404&times=99'], async (page) => {
  await page.evaluate(() => { location.hash = 'bot-jakbot'; }); await page.waitForFunction(() => /Choisis ta couleur/.test(document.getElementById('t-msg').textContent));
  await click(page, 'Blancs'); await ready(page); let s = await st(page);
  expect(!s.maia && /moteur seul/.test(s.sub) && /sans son style/.test(s.msg), 'la panne est annoncée : jakbot joue avec le moteur seul');
  await mv(page, 'e2e4'); s = await st(page); expect(s.san[1] === 'e6', 'le répertoire d’ouvertures reste joué (1...e6)');
  for (let i = 0; i < 12 && !s.done; i += 1) { await mv(page, (await sf.ev(s.fen, 8)).best); s = await st(page); }
  expect(s.ply >= 20 || s.done, 'la partie se poursuit au-delà du répertoire avec le moteur');
});
// Le gros modèle des bots vient de chez son éditeur. Pour tester ce chemin sans réseau, donner le fichier :
// MAIA_23M=/chemin/maia3_23m.onnx node tests/navigateur/bot.mjs
const big = process.env.MAIA_23M;
if (big && fs.existsSync(big) && (!process.env.ONLY || process.env.ONLY === "23m")) {
  await run('Gros modèle (23M) : téléchargement, mise en cache, bascule entre modèles', [], async (page) => {
    let served = 0;
    // Comme chez l'éditeur, l'adresse redirige vers un autre serveur : ici le serveur de test, qui sert le fichier donné.
    fs.mkdirSync(path.join(root, 'dist/app/big'), { recursive: true }); fs.rmSync(path.join(root, 'dist/app/big/m23.onnx'), { force: true }); fs.symlinkSync(big, path.join(root, 'dist/app/big/m23.onnx'));
    await page.route('https://huggingface.co/**', (r) => { served += 1; return r.fulfill({ status: 302, headers: { location: `${B}big/m23.onnx`, 'access-control-allow-origin': '*' } }); });
    await page.evaluate(() => { location.hash = 'bot-jakbot'; }); await page.waitForFunction(() => /Choisis ta couleur/.test(document.getElementById('t-msg').textContent));
    await click(page, 'Blancs'); await ready(page); let s = await st(page);
    expect(s.maia && !/léger|moteur seul/.test(s.sub) && served === 1, 'jakbot charge son modèle complet');
    await mv(page, 'e2e4'); s = await st(page);
    for (let i = 0; i < 14 && !s.done; i += 1) { await mv(page, (await sf.ev(s.fen, 8)).best); s = await st(page); }
    expect(s.ply >= 24 && s.maia, 'il joue au-delà du répertoire avec ce modèle');
    expect(await page.evaluate(async () => { const c = await caches.open('chess-analyzer-maia-23m-v1'); const k = await c.keys(); return k.length === 1 && (await (await c.match(k[0])).arrayBuffer()).byteLength === 92628155; }), 'le modèle est rangé dans le cache, entier');
    // une mise en situation recharge le modèle léger, puis le bot reprend le sien depuis le cache
    await page.evaluate(() => { location.hash = 'situation-rook'; }); await page.waitForFunction(() => /Fais valoir/.test(document.getElementById('t-msg').textContent), null, { timeout: 60000 });
    await page.evaluate(async () => { const m = window.__P.c.moves({ verbose: true })[0]; await window.__move(m.from, m.to); });
    expect(await page.evaluate(() => window.__P.ply === 2 && window.__P.maia), 'une mise en situation fonctionne ensuite avec le modèle léger');
    await page.evaluate(() => { location.hash = 'bot-jakbot'; }); await page.waitForFunction(() => /en cours/.test(document.getElementById('t-msg').textContent));
    await click(page, 'Reprendre'); await ready(page); s = await st(page);
    expect(s.maia && !/léger/.test(s.sub) && served === 1, 'retour au bot : modèle complet repris depuis le cache, sans nouveau téléchargement');
  });
}
sf.kill(); finish();
