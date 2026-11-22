// Construit src/book.json : les positions de toutes les ouvertures nommées de la base Lichess
// (github.com/lichess-org/chess-openings, domaine public, copiée dans data/lichess-openings/).
// Chaque position (pièces, trait, roques, en passant) est stockée sous forme d'empreinte (src/book.js).
//   node tests/ouvertures/livre.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { Chess } from 'chess.js';
import { posHash } from '../../src/book-hash.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(root, 'data/lichess-openings');
const set = new Set(); let lines = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.tsv')).sort()) {
  for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(1)) {
    if (!l.trim()) continue; lines += 1;
    const c = new Chess();
    for (const t of l.split('\t')[2].split(/\s+/)) { if (!t || /^\d+\./.test(t)) continue; c.move(t); set.add(posHash(c.fen())); }
  }
}
const out = { source: 'github.com/lichess-org/chess-openings (CC0)', lines, positions: [...set].sort().join(' ') };
fs.writeFileSync(path.join(root, 'src/book.json'), JSON.stringify(out));
console.log(`${lines} lignes, ${set.size} positions, ${Math.round(fs.statSync(path.join(root, 'src/book.json')).size / 1000)} Ko`);
