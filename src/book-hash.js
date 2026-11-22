// Empreinte d'une position pour la base des coups de théorie (src/book.js) : FNV-1a sur 32 bits, en base 36,
// calculée sur les pièces, le trait, les roques et l'en passant. Environ 8 000 positions : confusion négligeable.
export function posHash(fen) {
  const s = fen.split(' ').slice(0, 4).join(' '); let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
