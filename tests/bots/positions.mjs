// Étape 1. Usage : node tests/bots/positions.mjs parties.json positions.json <pseudo>
// Extrait des parties toutes les positions où il est au trait, avec le coup joué et le temps pris.
import fs from 'fs'; import { Chess } from 'chess.js';
const [inp, out, who] = process.argv.slice(2); const ME = String(who || '').toLowerCase(); // pseudo Chess.com du joueur à imiter
const G = JSON.parse(fs.readFileSync(inp)); const rows = [];
const clk = (s) => { const [h, m, x] = s.split(':'); return +h * 3600 + +m * 60 + +x; };
G.forEach((g, gi) => {
  if (g.tc !== '600') return;
  const white = g.white.u.toLowerCase() === ME; const me = white ? g.white : g.black; const op = white ? g.black : g.white;
  const c = new Chess(); c.loadPgn(g.pgn); const h = c.history({ verbose: true });
  const clocks = [...g.pgn.matchAll(/%clk ([\d:.]+)/g)].map((m) => clk(m[1]));
  h.forEach((m, i) => {
    if ((m.color === 'w') !== white) return;
    const prev = i >= 2 ? clocks[i - 2] : 600; const spent = clocks[i] != null ? Math.max(0, prev - clocks[i]) : null;
    rows.push({ g: gi, ply: i, prevTo: i ? h[i - 1].to : null, prior: h.slice(Math.max(0, i - 8), i).map((x) => x.before), fen: m.before, uci: m.from + m.to + (m.promotion || ''), san: m.san, myElo: me.r, oppElo: op.r, spent, left: clocks[i] ?? null, res: me.res === 'win' ? 1 : op.res === 'win' ? 0 : 0.5 });
  });
});
fs.writeFileSync(out, JSON.stringify(rows)); console.log(rows.length, 'positions,', new Set(rows.map((r) => r.g)).size, 'parties');
