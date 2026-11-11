// Étape 2. Usage : HIST=1 node tests/bots/maia.mjs positions.json maia.json
// Probabilités de Maia pour chaque position, calculées dans Chrome avec le modèle de l'appli.
import fs from 'fs'; import { createRequire } from 'module';
const require = createRequire(`${process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules'}/`); const { chromium } = require('playwright');
const [inp, out] = process.argv.slice(2); const rows = JSON.parse(fs.readFileSync(inp));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
await page.goto(process.env.BASE || 'http://localhost:8770/'); // l'appli construite, servie en local (tests/navigateur/serveur.mjs)
await page.evaluate(async () => { window.__m = await import(new URL('maia/maia.mjs', location.href).href); await window.__m.load(new URL('maia/', location.href).href); });
const res = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out)) : []; const t0 = Date.now();
for (let i = res.length; i < rows.length; i += 40) {
  const chunk = rows.slice(i, i + 40).map((r) => [r.fen, r.myElo, r.oppElo, process.env.HIST ? r.prior : null]);
  const got = await page.evaluate(async (chunk) => { const o = []; for (const [fen, a, b, pr] of chunk) { const mv = await window.__m.policy(fen, a, b, pr); o.push(mv.filter((x) => x[1] >= 0.001).sort((x, y) => y[1] - x[1]).map((x) => [x[0], +x[1].toFixed(4)])); } return o; }, chunk);
  res.push(...got); fs.writeFileSync(out, JSON.stringify(res));
  if ((i / 40) % 10 === 0) console.log(res.length, Math.round((Date.now() - t0) / 1000) + 's');
}
console.log('fini', res.length); await browser.close();
