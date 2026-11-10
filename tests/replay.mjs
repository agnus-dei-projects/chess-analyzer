// Rejoue un signalement copié depuis l'appli (bouton « Signaler ce commentaire ») avec les calculs du moteur
// tels que l'appli les avait : node tests/replay.mjs signalement.txt
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import esbuild from 'esbuild'; import { Chess } from 'chess.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const tmp = fs.mkdtempSync('/tmp/replay-');
await esbuild.build({ entryPoints: [path.join(root, 'src/explain.js')], bundle: true, format: 'esm', platform: 'node', outfile: tmp + '/ex.mjs', logLevel: 'error' });
await esbuild.build({ entryPoints: [path.join(root, 'src/analysis.js')], bundle: true, format: 'esm', platform: 'node', outfile: tmp + '/an.mjs', logLevel: 'error' });
const X = await import(tmp + '/ex.mjs'); const A = await import(tmp + '/an.mjs');
const raw = fs.readFileSync(process.argv[2], 'utf8'); const r = JSON.parse(raw.slice(raw.indexOf('{')));
const c = new Chess(r.fen); const legal = c.moves().length;
let prev = null;
const m = c.move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] });
const ply = { san: m.san, color: m.color, from: m.from, to: m.to, uci: r.uci, legal, captured: m.captured, piece: m.piece, sacrifice: X.isSacrifice(m), recapture: false };
if (r.prev) prev = { to: r.prev.slice(2, 4), uci: r.prev };
const move = A.buildReport([ply], [r.avant, r.apres], 0).moves[0];
const ex = X.explainMove({ fenBefore: r.fen, fenAfter: c.fen(), ply, before: r.avant, after: r.apres, move, index: 20, prev, avoid: null });
console.log(`${r.coup} [appli : ${r.classement} ; ici : ${move.kind}]\nDans l'appli : ${r.commentaire}\nMaintenant   : ${[...ex.sentences, ...ex.notes].join(' ').replace(/\[\[|\]\]/g, '')}`);
console.log(`\nPour en faire un test permanent, ajouter à tests/cases.json :\n${JSON.stringify({ name: r.coup, fen: r.fen, uci: r.uci, must: [], mustNot: [] })}`);
