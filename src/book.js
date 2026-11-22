// Coups de théorie reconnus par la position : une position atteinte par n'importe quel ordre de coups
// compte si elle figure dans une ouverture nommée de la base Lichess (src/book.json, construit par
// tests/ouvertures/livre.mjs). La théorie va jusqu'à la dernière position de la base atteinte dans les
// 40 premiers demi-coups : les coups qui y mènent par un autre ordre (transposition) en font partie.
import BOOK from './book.json';
import { posHash } from './book-hash.js';

let SET = null;
export function bookPliesByPosition(fens) {
  if (!SET) SET = new Set(BOOK.positions.split(' '));
  let n = 0;
  for (let i = 1; i < Math.min(fens.length, 41); i += 1) if (SET.has(posHash(fens[i]))) n = i;
  return n;
}
