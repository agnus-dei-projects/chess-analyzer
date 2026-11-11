// Étape 7 (facultative). Usage : node tests/bots/oldpos.mjs anciennes.json oldpos.json <pseudo>
// Positions où il est au trait dans les anciennes parties : clé de position, coup, rang du coup, date, cadence.
import fs from 'fs'; import { Chess } from 'chess.js';
const [inp, out, who] = process.argv.slice(2); const ME = who.toLowerCase(); const G = JSON.parse(fs.readFileSync(inp)); const rows = []; let bad = 0;
const MAXPLY = 60;
G.forEach((g, gi) => {
  const white = g.white.u.toLowerCase() === ME; let h;
  try { const c = new Chess(); c.loadPgn(g.pgn); h = c.history({ verbose: true }); } catch { bad += 1; return; }
  if (!h.length || h[0].before.split(' ')[0] !== 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR') { bad += 1; return; }
  h.slice(0, MAXPLY).forEach((m, i) => { if ((m.color === 'w') === white) rows.push([gi, i, m.before.split(' ').slice(0, 4).join(' '), m.from + m.to + (m.promotion || ''), g.end, g.cls === 'rapid' ? 1 : 0]); });
});
fs.writeFileSync(out, JSON.stringify(rows)); console.log(rows.length, 'positions,', G.length - bad, 'parties lues,', bad, 'ignorées');
