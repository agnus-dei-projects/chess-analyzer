// Outils communs aux tests dans le navigateur (Chrome piloté par Playwright, non installé par le projet :
// `npm i -g playwright` ou PLAYWRIGHT_DIR=/chemin/vers/node_modules).
import { createRequire } from 'module'; import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(`${process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules'}/`);
const { chromium } = require('playwright');
export const B = process.env.BASE || 'http://localhost:8766/';
export const ctl = (q) => fetch(`${B}__ctl?${q}`).then((r) => r.text());
export async function open(opts = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: opts.sw ? 'allow' : 'block' });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  return { browser, ctx, page, logs };
}
export const ui = (page) => page.evaluate(() => ({ sub: document.getElementById('t-sub').textContent, msg: document.getElementById('t-msg').textContent, tone: document.getElementById('t-msg').dataset.tone, actions: [...document.querySelectorAll('#t-actions button')].map((b) => b.textContent), elo: document.getElementById('t-elo').textContent, delta: document.getElementById('t-delta').textContent }));
export const waitMsg = (page, re, timeout = 60000) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById('t-msg').textContent), re.source, { timeout });
// Stockfish côté test, pour jouer les coups du joueur.
export function engine() {
  const p = spawn('node', [path.join(root, 'node_modules/stockfish/bin/stockfish-19-lite-single.js')]);
  let buf = ''; let wait = null; let last = null;
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    const m = l.match(/score (cp|mate) (-?\d+)/); if (m && l.includes(' pv ')) last = { type: m[1], value: +m[2] };
    if (wait && l.startsWith(wait.k)) { const w = wait; wait = null; w.r(l); } } });
  const send = (c, k) => new Promise((r) => { if (k) wait = { k, r }; p.stdin.write(`${c}\n`); if (!k) r(); });
  return {
    async init() { await send('uci', 'uciok'); await send('isready', 'readyok'); },
    async ev(fen, depth) { last = null; await send(`position fen ${fen}`); const l = await send(`go depth ${depth}`, 'bestmove'); const s = last || { type: 'cp', value: 0 }; return { cp: s.type === 'cp' ? s.value : (s.value > 0 ? 20000 : -20000), best: l.split(' ')[1] }; },
    kill() { p.kill(); },
  };
}
// Chaque scénario dit ce qu'il attend ; un écart compte comme un échec.
let failures = 0;
export const expect = (ok, text) => { console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${text}`); if (!ok) failures += 1; };
export const finish = () => { process.exit(failures ? 1 : 0); };
