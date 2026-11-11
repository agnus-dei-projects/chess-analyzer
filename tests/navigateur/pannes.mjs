// Pannes de chargement et pannes en pleine partie : l'exercice ne doit jamais rester figé.
import { B, ctl, open, ui, waitMsg, expect, finish } from './outils.mjs';
const mute = (page, what) => page.evaluate((what) => { const post = Worker.prototype.postMessage; window.__mute = true; Worker.prototype.postMessage = function (m, t) { if (window.__mute && (what === 'maia' ? m && m.type === 'move' : typeof m === 'string' && m.startsWith('go '))) return undefined; return post.call(this, m, t); }; }, what);
const playOne = async (page) => {
  await page.evaluate(async () => { const m = window.__P.c.moves({ verbose: true }).find((x) => !x.promotion); await window.__move(m.from, m.to); });
  return page.evaluate(() => ({ ply: window.__P.ply, thinking: window.__P.thinking, maia: window.__P.maia, msg: document.getElementById('t-msg').textContent, sub: document.getElementById('t-sub').textContent, actions: [...document.querySelectorAll('#t-actions button')].map((b) => b.textContent) }));
};
const ready = async (page, timeout = 60000) => { await waitMsg(page, /Fais tomber|n’a pas pu démarrer/, timeout); return { maia: await page.evaluate(() => window.__P.maia), ...(await ui(page)) }; };
const served = async (re) => JSON.parse(await ctl('log=1')).filter((l) => re.test(l));
async function run(name, faults, body, opts) {
  await ctl('reset=1'); for (const f of faults) await ctl(f);
  const { browser, page } = await open(opts);
  console.log(`\n== ${name}`);
  try { await page.goto(`${B}#situation-attack`); await body(page); } catch (e) { expect(false, `scénario interrompu : ${String(e.message).slice(0, 200)}`); }
  await browser.close();
}
const retry = async (page) => { await page.locator('#t-actions button', { hasText: 'Réessayer' }).click(); await waitMsg(page, /Fais tomber/, 30000); return playOne(page); };

await run('Chargement normal', [], async (page) => {
  const r = await ready(page); const c = await playOne(page);
  expect(r.maia && c.ply === 2 && !c.thinking, 'adversaire chargé, il répond au premier coup');
  expect((await served(/ort-wasm.*\.wasm/)).length === 1, 'le moteur ONNX n’est téléchargé qu’une fois');
});
await run('Modèle coupé deux fois en route', ['match=m.onnx&kind=cut&at=5000000&times=1', 'match=m.onnx&kind=cut&at=3000000&times=1'], async (page) => {
  const r = await ready(page);
  expect(r.maia && /Fais tomber/.test(r.msg), 'le téléchargement reprend tout seul et aboutit');
  expect((await served(/m\.onnx range/)).length === 2, 'il reprend où il s’était arrêté (deux reprises partielles)');
});
await run('Connexion qui se fige', ['match=m.onnx&kind=stall&at=3000000&times=1'], async (page) => {
  const r = await ready(page);
  expect(r.maia && (await served(/m\.onnx range 3000000/)).length === 1, 'la connexion figée est relancée puis reprise à 3 Mo');
});
await run('Modèle introuvable', ['match=m.onnx&kind=status&at=404&times=99'], async (page) => {
  const r = await ready(page); const c = await playOne(page);
  expect(!r.maia && /Adversaire de secours/.test(r.msg) && /\(moteur\)/.test(r.sub), 'l’exercice démarre avec l’adversaire de secours, et le dit');
  expect(c.ply === 2 && !c.thinking, 'l’adversaire de secours joue');
});
await run('Fichier .wasm du moteur en panne une fois', ['match=sf/engine.wasm&kind=status&at=503&times=1'], async (page) => {
  const r = await ready(page);
  expect(/n’a pas pu démarrer \(fichier inaccessible, erreur 503\)/.test(r.msg) && r.actions.includes('Réessayer'), 'la panne est annoncée avec sa cause, sans attente');
  expect((await retry(page)).ply === 2, '« Réessayer » relance un moteur neuf et la partie se joue');
});
await run('Script du moteur en panne une fois', ['match=sf/stockfish.js&kind=status&at=503&times=1'], async (page) => {
  const r = await ready(page);
  expect(/n’a pas pu démarrer/.test(r.msg) && r.actions.includes('Réessayer'), 'la panne est annoncée');
  expect((await retry(page)).ply === 2, '« Réessayer » relance un moteur neuf et la partie se joue');
});
await run('Maia ne répond plus en pleine partie', [], async (page) => {
  await ready(page); await mute(page, 'maia'); const c = await playOne(page);
  expect(c.ply === 2 && !c.thinking && !c.maia && /\(moteur\)/.test(c.sub), 'le moteur prend le relais, la partie continue');
});
await run('Moteur muet en pleine partie', [], async (page) => {
  await ready(page); await mute(page, 'moteur'); const c = await playOne(page);
  expect(c.ply === 2 && !c.thinking, 'la partie continue sans évaluation ce tour-ci');
});
await run('Maia absente et moteur muet', ['match=m.onnx&kind=status&at=404&times=99'], async (page) => {
  await ready(page); await mute(page, 'moteur'); const c = await playOne(page);
  expect(/ne répond plus/.test(c.msg) && c.actions.includes('Relancer l’adversaire') && c.ply === 1, 'la panne est annoncée, la partie conservée');
  await page.evaluate(() => { window.__mute = false; }); await page.locator('#t-actions button', { hasText: 'Relancer' }).click();
  await page.waitForFunction(() => window.__P.thinking === false, null, { timeout: 40000 });
  expect(await page.evaluate(() => window.__P.ply) === 2, '« Relancer l’adversaire » reprend la partie');
});
await run('Quitter pendant le chargement puis revenir', ['match=m.onnx&kind=stall&at=2000000&times=1'], async (page) => {
  await page.waitForFunction(() => /\d+ %/.test(document.getElementById('t-msg').textContent), null, { timeout: 20000 });
  await page.evaluate(() => { location.hash = 'exercices'; }); await page.waitForTimeout(300);
  await page.evaluate(() => { location.hash = 'situation-attack'; }); await page.waitForTimeout(1500);
  expect(/\d+ %/.test((await ui(page)).msg), 'la progression reste affichée au retour');
  expect((await ready(page)).maia, 'le chargement aboutit');
});
// Avec le service worker : mise en cache par la page, réutilisation, fichier abîmé.
await run('Cache des gros fichiers', ['match=m.onnx&kind=cut&at=5000000&times=1'], async (page) => {
  await page.goto(B); await page.evaluate(() => navigator.serviceWorker.ready); await page.reload();
  const go = async () => { await page.evaluate(() => { location.hash = 'exercices'; }); await page.evaluate(() => { location.hash = 'situation-attack'; }); return ready(page); };
  const sizes = () => page.evaluate(async () => { const c = await caches.open('chess-analyzer-maia-5m-v1'); const out = {}; for (const r of await c.keys()) out[r.url.split('/').pop()] = (await (await c.match(r)).arrayBuffer()).byteLength; return out; });
  expect((await go()).maia, 'premier chargement à travers le service worker, coupure comprise');
  await page.waitForTimeout(1500); let s = await sizes();
  expect(s['m.onnx'] === 22550022 && s['ort-wasm-simd-threaded.wasm'] > 1e7 && Object.keys(s).length === 2, 'les deux gros fichiers sont en cache, entiers, et eux seuls');
  await ctl('reset=1'); await ctl('match=maia/m.onnx&kind=status&at=503&times=99'); await ctl('match=ort-wasm-simd-threaded.wasm&kind=status&at=503&times=99'); await page.reload();
  expect((await go()).maia && (await served(/m\.onnx|\.wasm/)).filter((l) => /maia/.test(l)).length === 0, 'au rechargement, tout vient du cache (serveur en panne)');
  await page.evaluate(async () => { const c = await caches.open('chess-analyzer-maia-5m-v1'); await c.put(new URL('maia/ort-wasm-simd-threaded.wasm', location.href).href, new Response(new Uint8Array(1000))); });
  await ctl('reset=1'); await page.reload();
  expect((await go()).maia && (await served(/ort-wasm.*\.wasm full/)).length === 1, 'un fichier abîmé dans le cache est retéléchargé');
}, { sw: true });
finish();
