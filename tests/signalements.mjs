// Rejoue les signalements faits dans l'appli avec les calculs du moteur tels que l'appli les avait.
//   node tests/signalements.mjs fichier.txt   bloc collé (« Tout copier ») ou signalement unique
//   node tests/signalements.mjs --github      tickets ouverts « [Signalement] » du dépôt (via gh)
// Chaque signalement est aussi écrit dans tests/signalements/ pour pouvoir en faire un test permanent.
import fs from 'fs'; import path from 'path'; import { execSync } from 'child_process'; import { Chess } from 'chess.js';
import { X, A, here, plain } from './lib.mjs';
const arg = process.argv[2]; let items = [];
if (arg === '--github') {
  const raw = execSync('gh api "repos/agnus-dei-projects/chess-analyzer/issues?state=open&per_page=100"', { encoding: 'utf8', maxBuffer: 1 << 26 });
  for (const is of JSON.parse(raw)) { if (!is.title.startsWith('[Signalement]')) continue; const m = is.body.match(/```json\n([\s\S]*?)\n```/); if (m) items.push({ id: `ticket-${is.number}`, data: JSON.parse(m[1]) }); }
} else {
  const raw = fs.readFileSync(arg, 'utf8'); const start = Math.min(...['[', '{'].map((c) => raw.indexOf(c)).filter((i) => i >= 0));
  const parsed = JSON.parse(raw.slice(start)); items = (Array.isArray(parsed) ? parsed : [parsed]).map((data, i) => ({ id: `${path.basename(arg).replace(/\.[^.]+$/, '')}-${i + 1}`, data }));
}
fs.mkdirSync(path.join(here, 'signalements'), { recursive: true });
for (const { id, data: r } of items) {
  fs.writeFileSync(path.join(here, 'signalements', `${id}.json`), JSON.stringify(r));
  const c = new Chess(r.fen); const legal = c.moves().length;
  const m = c.move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] });
  const prev = r.prev ? (typeof r.prev === 'string' ? { uci: r.prev, to: r.prev.slice(2, 4), captured: null } : r.prev) : null;
  const ply = { san: m.san, color: m.color, from: m.from, to: m.to, uci: r.uci, legal, captured: m.captured, piece: m.piece, sacrifice: X.isSacrifice(m), recapture: !!(prev && m.captured && prev.captured && prev.to === m.to) };
  const move = A.buildReport([ply], [r.avant, r.apres], 0).moves[0];
  const ex = X.explainMove({ fenBefore: r.fen, fenAfter: c.fen(), ply, before: r.avant, after: r.apres, move, index: 20, prev, avoid: null });
  const f = (s) => (s.type === 'mate' ? '#' + s.value : (s.value / 100).toFixed(1));
  console.log(`\n== ${id} : ${r.coup} [appli : ${r.classement} ; ici : ${move.kind}] ${f(r.avant.score)}→${f(r.apres.score)}\n   meilleur : ${X.walk(r.fen, r.avant.pv).slice(0, 8).map((s) => s.m.san).join(' ')}\n   joué     : ${m.san} ${X.walk(c.fen(), r.apres.pv || []).slice(0, 7).map((s) => s.m.san).join(' ')}\n   Dans l'appli : ${r.commentaire}\n   Maintenant   : ${plain(ex)}\n   cas : ${JSON.stringify({ name: r.coup, fen: r.fen, uci: r.uci, prev, must: [], mustNot: [] })}`);
}
console.log(`\n${items.length} signalement(s)`);
