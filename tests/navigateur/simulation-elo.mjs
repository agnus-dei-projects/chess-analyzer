// Batterie longue (≈ 15 min pour 50 parties, non lancée par run.mjs) : un joueur simulé (Maia à un Elo fixe), dont l'Elo
// des problèmes est établi à ce niveau, enchaîne des mises en situation ; l'Elo de chaque thème évolue comme dans l'appli.
// Usage : construire avec AUDIT=1, servir dist/app (serveur.mjs), puis BASE=http://localhost:8766/ node tests/navigateur/simulation-elo.mjs <elo> <parties par thème> <sortie.json>
import fs from 'fs'; import { open } from './outils.mjs';
const [eloStr, nStr, outFile] = process.argv.slice(2); const ME = +eloStr; const N = +nStr;
const POS = JSON.parse(fs.readFileSync(new URL('../../src/situations.json', import.meta.url)));
const { browser, page, logs } = await open();
await page.goto((process.env.BASE || 'http://localhost:8765/') + '#exercices');
await page.evaluate((me) => { localStorage.clear(); localStorage.setItem('elo-puzzle', JSON.stringify({ r: me, n: 40 })); }, ME);
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile)) : [];
for (const id of Object.keys(POS)) {
  const list = POS[id];
  for (let k = out.filter((g) => g.id === id).length; k < N; k += 1) {
    const fen = list[(k * 7 + ME) % list.length].fen; // positions variées, différentes d'un joueur à l'autre
    const before = await page.evaluate(({ id, fen, prev }) => {
      location.hash = 'exercices';
      if (prev) localStorage.setItem(`elo-${id}`, prev);
      localStorage.setItem(`current-${id}`, JSON.stringify({ fen, rated: false }));
      return JSON.parse(localStorage.getItem(`elo-${id}`) || '{"r":800,"n":0}');
    }, { id, fen, prev: out.filter((g) => g.id === id).length ? JSON.stringify(out.filter((g) => g.id === id).slice(-1)[0].after) : null });
    await page.evaluate((id) => { location.hash = `situation-${id}`; }, id);
    await page.waitForFunction(() => window.__P.c && window.__P.thinking === false && !window.__P.done && /Abandonner/.test(document.getElementById('t-actions').textContent), null, { timeout: 90000 });
    before.r = +(await page.evaluate(() => document.getElementById("t-elo").textContent)); let stuck = false;
    for (;;) {
      const st = await page.evaluate(() => ({ done: window.__P.done, fen: window.__P.c.fen() }));
      if (st.done) break;
      const uci = await page.evaluate(async ({ fen, me, opp }) => (await import(new URL('maia/maia.mjs', location.href).href)).move(fen, me, opp, 1), { fen: st.fen, me: ME, opp: before.r });
      try {
        await page.evaluate(async (u) => { const pr = window.__move(u.slice(0, 2), u.slice(2, 4)); if (u[4]) { await new Promise((r) => setTimeout(r, 60)); const b = document.querySelector('.promo button[aria-label="Dame"]'); if (b) b.click(); } await pr; }, uci);
        await page.waitForFunction(() => window.__P.done || window.__P.thinking === false, null, { timeout: 60000 });
      } catch (e) { stuck = String(e.message).slice(0, 120); break; }
    }
    const r = await page.evaluate((id) => ({ ply: window.__P.ply, msg: document.getElementById('t-msg').textContent, result: window.__P.result, after: JSON.parse(localStorage.getItem(`elo-${id}`)), actions: [...document.querySelectorAll('#t-actions button')].map((b) => b.textContent) }), id);
    out.push({ id, fen, me: ME, before, stuck, ...r });
    fs.writeFileSync(outFile, JSON.stringify(out));
    console.log(id, k, `Elo ${before.r}→${r.after.r}`, 'demi-coups', r.ply, '|', r.msg.slice(0, 50), stuck || '');
  }
}
console.log('console :', logs.filter((l) => !/Service Worker|404/.test(l)).slice(0, 5));
await browser.close();
