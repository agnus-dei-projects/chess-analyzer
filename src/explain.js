// Explications fondées uniquement sur la position et les variantes calculées par Stockfish.
// Les coups et cases sont écrits [[Nf3]] : l'affichage et la voix les rendent différemment.
import { Chess } from 'chess.js';
import { LABELS } from './analysis.js';

const V = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
const FEM = { r: true, q: true };
const opp = (c) => (c === 'w' ? 'b' : 'w');
const hue = (p, c) => (c === 'w' ? (FEM[p] ? 'blanche' : 'blanc') : (FEM[p] ? 'noire' : 'noir'));
const the = (p, c) => `${FEM[p] ? 'la' : 'le'} ${NAME[p]} ${hue(p, c)}`;
const side = (c) => (c === 'w' ? 'les Blancs' : 'les Noirs');
const Side = (c) => (c === 'w' ? 'Les Blancs' : 'Les Noirs');
const tok = (s) => `[[${s}]]`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

const SPOKEN = { K: 'roi', Q: 'dame', R: 'tour', B: 'fou', N: 'cavalier' };
export function sanToSpeech(t) {
  const plus = /#$/.test(t) ? ', mat' : /\+$/.test(t) ? ', échec' : '';
  if (t.startsWith('O-O-O')) return `grand roque${plus}`;
  if (t.startsWith('O-O')) return `petit roque${plus}`;
  const m = t.match(/^([KQRBN])?([a-h]?[1-8]?)(x)?([a-h])([1-8])(?:=([QRBN]))?/);
  if (!m) return t;
  const [, piece, dis, x, f, r, promo] = m;
  const who = piece ? SPOKEN[piece] : (x ? 'pion' : '');
  const from = dis ? ` ${dis.split('').join(' ')}` : '';
  return `${who}${from}${x ? ' prend en' : ''} ${f} ${r}${promo ? `, promotion en ${SPOKEN[promo]}` : ''}${plus}`.trim();
}

const parseUci = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

export function walk(fen, ucis, max = 14) {
  const c = new Chess(fen);
  const steps = [];
  for (const u of (ucis || []).slice(0, max)) {
    try {
      const m = c.move(parseUci(u));
      steps.push({ m, fen: c.fen() });
    } catch { break; }
  }
  return steps;
}

export const lineOf = (steps, n = 3) => steps.slice(0, n).map((s) => tok(s.m.san)).join(', ');

// Bilan matériel le long d'une variante, arrêté quand les prises s'interrompent.
export function exchange(steps, mover) {
  const won = {}; const lost = {};
  let net = 0;
  const limit = Math.min(steps.length, 12);
  for (let i = 0; i < limit; i += 1) {
    const { m } = steps[i];
    const mine = m.color === mover;
    if (m.captured) {
      (mine ? won : lost)[m.captured] = ((mine ? won : lost)[m.captured] || 0) + 1;
      net += (mine ? 1 : -1) * V[m.captured];
    }
    if (m.promotion) net += (mine ? 1 : -1) * (V[m.promotion] - 1);
    const next = steps[i + 1];
    if (i >= 1 && (!next || !next.m.captured)) break;
  }
  for (const p of Object.keys(won)) {
    const k = Math.min(won[p], lost[p] || 0);
    won[p] -= k;
    if (lost[p]) lost[p] -= k;
  }
  return { net, won, lost };
}

const NUM = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit'];
function listPieces(bag) {
  const out = Object.keys(V).reverse().filter((p) => bag[p] > 0).map((p) => {
    const n = bag[p];
    const word = n === 1 ? (FEM[p] ? 'une' : 'un') : NUM[n];
    return `${word} ${NAME[p]}${n > 1 ? 's' : ''}`;
  });
  return out.length > 1 ? `${out.slice(0, -1).join(', ')} et ${out[out.length - 1]}` : out[0] || '';
}

function pieces(chess, color) {
  const out = [];
  chess.board().flat().forEach((sq) => { if (sq && sq.color === color) out.push(sq); });
  return out;
}

// Pièces ennemies réellement menacées par la pièce placée sur `from`.
export function targets(fen, from) {
  const c = new Chess(fen);
  const me = c.get(from);
  if (!me) return [];
  const list = [];
  for (const t of pieces(c, opp(me.color))) {
    if (!c.attackers(t.square, me.color).includes(from)) continue;
    const undefended = c.attackers(t.square, t.color).length === 0;
    if (t.type === 'k' || V[t.type] > V[me.type] || undefended) list.push(t);
  }
  return list.sort((a, b) => (b.type === 'k') - (a.type === 'k') || V[b.type] - V[a.type]);
}

const DIRS = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
DIRS.q = [...DIRS.b, ...DIRS.r];

export function pinBy(fen, from, raw = false) {
  const c = new Chess(fen);
  const me = c.get(from);
  if (!me || !DIRS[me.type]) return null;
  for (const [df, dr] of DIRS[me.type]) {
    let f = from.charCodeAt(0) - 97; let r = +from[1]; let first = null;
    for (;;) {
      f += df; r += dr;
      if (f < 0 || f > 7 || r < 1 || r > 8) break;
      const sq = String.fromCharCode(97 + f) + r;
      const p = c.get(sq);
      if (!p) continue;
      if (p.color === me.color) break;
      if (!first) { first = { ...p, square: sq }; continue; }
      const blockedPawn = first.type === 'p' && (p.type !== 'k' || df === 0);
      const worthIt = p.type === 'k' || p.type === 'q' || (V[p.type] > V[first.type] && c.attackers(sq, p.color).length === 0);
      if (raw && first.type !== 'k' && p.type === 'k') return { pinned: first, behind: { ...p, square: sq }, piece: me };
      if (first.type !== 'k' && !blockedPawn && worthIt && (p.type === 'k' || V[p.type] > V[first.type])) return { pinned: first, behind: { ...p, square: sq }, piece: me };
      break;
    }
  }
  return null;
}

function threatExisted(fenBefore, r) {
  const parts = fenBefore.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  try {
    const c = new Chess(parts.join(' '), { skipValidation: true });
    return c.moves({ verbose: true }).some((m) => m.from === r.from && m.to === r.to && m.captured === r.captured);
  } catch { return false; }
}

export function evalWords(score) {
  if (score.type === 'mate') {
    if (score.value === 0) return 'le mat';
    return `un mat en ${Math.abs(score.value)} pour ${side(score.value > 0 ? 'w' : 'b')}`;
  }
  const v = Math.abs(score.value) / 100;
  if (v < 0.3) return 'une position équilibrée';
  return `un avantage de ${v.toFixed(1).replace('.', ',')} pion${v >= 2 ? 's' : ''} pour ${side(score.value > 0 ? 'w' : 'b')}`;
}

// Matériel gagné au bout de la variante, une fois les prises terminées.
function lineDelta(startFen, steps, col, min = 8) {
  if (!steps.length) return 0;
  let i = Math.min(min, steps.length) - 1;
  while (i + 1 < steps.length && steps[i + 1].m.captured) i += 1;
  return materialFor(steps[i].fen, col) - materialFor(startFen, col);
}

const pts = (x) => {
  const n = Math.round(x);
  return n < 1 ? 'moins d’un point' : `${n} point${n > 1 ? 's' : ''}`;
};

function forkSentence(move, list, intro) {
  const [a, b] = list;
  return `${intro} attaque à la fois ${the(a.type, a.color)} en ${tok(a.square)} et ${the(b.type, b.color)} en ${tok(b.square)}.`;
}

function pinSentence(pin, intro) {
  return `${intro} cloue ${the(pin.pinned.type, pin.pinned.color)} en ${tok(pin.pinned.square)} devant ${the(pin.behind.type, pin.behind.color)} en ${tok(pin.behind.square)}.`;
}

const ELLE = (p) => (FEM[p] ? 'elle' : 'il');

// La pièce sur `sq` peut-elle encore aller quelque part sans se perdre ? (trait au camp de la pièce)
export function trappedAt(fen, sq) {
  const c = new Chess(fen);
  const p = c.get(sq);
  if (!p || !'qrbn'.includes(p.type) || c.inCheck()) return null;
  const moves = c.moves({ square: sq, verbose: true });
  const safe = moves.some((d) => {
    const next = new Chess(d.after);
    const caps = next.moves({ verbose: true }).filter((x) => x.to === d.to && x.captured);
    if (!caps.length) return true;
    const defended = next.attackers(d.to, p.color).length > 0;
    const cheapest = Math.min(...caps.map((x) => (x.piece === 'k' ? 10 : V[x.piece])));
    const gain = d.captured ? V[d.captured] : 0;
    return (defended && cheapest >= V[p.type]) || gain >= V[p.type];
  });
  if (safe) return null;
  const attacked = c.attackers(sq, opp(p.color)).length > 0;
  if (!attacked && p.type !== 'q') return null;
  return { piece: p, attacked };
}

function trapSentence(ply, mover, steps) {
  // Après la réponse adverse, puis un coup plus loin si la pièce n'a pas bougé.
  for (const i of [0, 2]) {
    const s = steps[i];
    if (!s) break;
    if (steps.slice(0, i + 1).some((x) => x.m.from === ply.to || x.m.to === ply.to)) break;
    const t = trappedAt(s.fen, ply.to);
    const lost = steps.slice(i, i + 10).some((x) => x.m.color !== mover && x.m.captured === t?.piece.type);
    if (t && lost) return `${cap(the(t.piece.type, mover))} en ${tok(ply.to)} est ${t.attacked ? 'piégé' : 'bloqué'}${FEM[t.piece.type] ? 'e' : ''} : ${ELLE(t.piece.type)} n’a plus aucune case sûre.`;
  }
  return null;
}

// Ce qui ne va pas dans un coup, d'après la réfutation.
function negative(ctx) {
  const { fenBefore, fenAfter, ply, after, mover } = ctx;
  const steps = walk(fenAfter, after.pv);
  const r = steps[0];
  const out = [];
  const sign = mover === 'w' ? 1 : -1;
  if (after.score.type === 'mate' && after.score.value * sign < 0) {
    const n = Math.abs(after.score.value);
    out.push(n === 1 ? `Ça permet un mat immédiat : ${tok(r ? r.m.san : '')}.` : `Ça permet un mat forcé en ${n} coups : ${lineOf(steps, 5)}.`);
    return { out, r };
  }
  if (!r) return { out, r };
  const trap = trapSentence(ply, mover, steps);
  if (trap) out.push(trap);
  const first = walk(fenBefore, [ply.uci])[0];
  const ex = exchange(first ? [first, ...steps] : steps, mover);
  const lineLoss = lineDelta(fenBefore, first ? [first, ...steps] : steps, mover);
  if (ex.net < 0 && lineLoss < 0) {
    const lost = listPieces(ex.lost);
    const won = listPieces(ex.won);
    let said = '';
    if (r.m.captured && r.m.to === ply.to && !first.m.captured) {
      if (!trap) out.push(`${cap(the(first.m.promotion || first.m.piece, mover))} se fait prendre en ${tok(ply.to)} par ${the(r.m.piece, opp(mover))}.`);
      said = listPieces({ [first.m.promotion || first.m.piece]: 1 });
    } else if (r.m.captured) {
      const was = threatExisted(fenBefore, r.m) ? `, alors qu’${ELLE(r.m.captured)} était déjà menacé${FEM[r.m.captured] ? 'e' : ''}` : '';
      out.push(`Ça laisse ${the(r.m.captured, mover)} en ${tok(r.m.to)} se faire prendre${was}.`);
      said = listPieces({ [r.m.captured]: 1 });
    } else if (!trap) {
      out.push(`Ça coûte du matériel : ${lineOf(steps, 4)}.`);
    }
    if (lost && (lost !== said || won)) out.push(`Au final, ${side(mover)} perdent ${lost}${won ? ` contre ${won}` : ''}.`);
    return { out, r };
  }
  if (lineLoss >= 0) return { out, r }; // sans perte réelle, un motif tactique n'explique rien
  const fork = targets(r.fen, r.m.to);
  if (fork.length >= 2) { out.push(`Ça permet ${tok(r.m.san)}, qui attaque à la fois ${the(fork[0].type, fork[0].color)} en ${tok(fork[0].square)} et ${the(fork[1].type, fork[1].color)} en ${tok(fork[1].square)}.`); return { out, r }; }
  const pin = pinBy(r.fen, r.m.to);
  if (pin) { out.push(`Ça permet ${tok(r.m.san)}, qui cloue ${the(pin.pinned.type, pin.pinned.color)} en ${tok(pin.pinned.square)} devant ${the(pin.behind.type, pin.behind.color)} en ${tok(pin.behind.square)}.`); return { out, r }; }
  const promo = steps.slice(0, 8).find((s) => s.m.promotion && s.m.color !== mover);
  if (promo) { out.push(`Ça laisse l’adversaire promouvoir : ${lineOf(steps, 5)}.`); return { out, r }; }
  const checks = steps.slice(0, 6).filter((s) => s.m.color !== mover && s.m.san.includes('+')).length;
  if (checks >= 2 && lineLoss <= -3) { out.push(`${cap(the('k', mover))} subit une série d’échecs : ${lineOf(steps, 5)}.`); return { out, r }; }
  return { out, r };
}

/* ---------- Faits de position ---------- */

const allPieces = (fen) => new Chess(fen).board().flat().filter(Boolean);
const fileIdx = (sq) => sq.charCodeAt(0) - 97;

export function pawnStats(fen, color) {
  const all = allPieces(fen);
  const mine = all.filter((p) => p.type === 'p' && p.color === color);
  const theirs = all.filter((p) => p.type === 'p' && p.color !== color);
  const files = Array(8).fill(0);
  mine.forEach((p) => { files[fileIdx(p.square)] += 1; });
  const doubled = files.reduce((s, n) => s + Math.max(0, n - 1), 0);
  const isolated = mine.filter((p) => { const f = fileIdx(p.square); return !files[f - 1] && !files[f + 1]; }).length;
  const passed = mine.filter((p) => {
    const f = fileIdx(p.square); const r = +p.square[1];
    return !theirs.some((t) => Math.abs(fileIdx(t.square) - f) <= 1 && (color === 'w' ? +t.square[1] > r : +t.square[1] < r));
  }).length;
  return { doubled, isolated, passed };
}

export function kingShield(fen, color) {
  const all = allPieces(fen);
  const k = all.find((p) => p.type === 'k' && p.color === color);
  const f = fileIdx(k.square);
  if (f >= 3 && f <= 4) return null; // roi au centre : pas de bouclier à comparer
  const r = +k.square[1];
  return all.filter((p) => p.type === 'p' && p.color === color && Math.abs(fileIdx(p.square) - f) <= 1 && (color === 'w' ? [r + 1, r + 2] : [r - 1, r - 2]).includes(+p.square[1])).length;
}

const countType = (fen, color, type) => allPieces(fen).filter((p) => p.color === color && p.type === type).length;

function materialFor(fen, color) {
  return allPieces(fen).reduce((s, p) => s + (p.color === color ? 1 : -1) * V[p.type], 0);
}

// Formulation d'un coup, pour ne pas le décrire deux fois.
export function moveAction(m) {
  if (m.san.startsWith('O-O-O')) return 'faire le grand roque';
  if (m.san.startsWith('O-O')) return 'roquer';
  if (m.promotion) return `promouvoir le pion en ${NAME[m.promotion]}`;
  if (m.captured) return `prendre ${FEM[m.captured] ? 'la' : 'le'} ${NAME[m.captured]} en ${tok(m.to)}${m.piece === 'p' ? '' : ` avec ${FEM[m.piece] ? 'la' : 'le'} ${NAME[m.piece]}`}`;
  if (m.san.endsWith('+')) return `donner échec avec ${FEM[m.piece] ? 'la' : 'le'} ${NAME[m.piece]} en ${tok(m.to)}`;
  if (m.piece === 'p') return `avancer le pion en ${tok(m.to)}`;
  return `jouer ${FEM[m.piece] ? 'la' : 'le'} ${NAME[m.piece]} en ${tok(m.to)}`;
}

function threatFragment(first, threat, mover, score, reply) {
  if (!threat || !threat.pv || !threat.pv.length) return null;
  if (threat.score.type === 'mate' && threat.score.value > 0 && threat.score.value <= 4) return `ça menace un mat en ${threat.score.value}`;
  const steps = walk(threat.fen, threat.pv);
  if (!steps.length) return null;
  const m = steps[0].m;
  const sign = mover === 'w' ? 1 : -1;
  const base = score.type === 'mate' ? (score.value * sign > 0 ? 3000 : -3000) : score.value * sign;
  const ifPass = threat.score.type === 'mate' ? (threat.score.value > 0 ? 3000 : -3000) : threat.score.value;
  if (ifPass - base < 40) return null; // l'adversaire n'a pas besoin d'y répondre
  // Une pièce attaquée qui s'écarte au coup suivant : la menace seule n'explique rien.
  if (m.captured && reply && reply.m.from === m.to) return null;
  if (m.captured && exchange(steps, mover).net > 0 && lineDelta(threat.fen, steps, mover, 4) >= 1) return `ça menace de prendre ${the(m.captured, opp(mover))} en ${tok(m.to)}`;
  if (m.promotion) return 'ça menace de promouvoir le pion';
  return null;
}

// Une prise impossible à cause d'un clouage, rendue possible par le coup : le cœur de la combinaison.
function unpinMotif(fenBefore, steps, mover) {
  const third = steps[2];
  if (!third || third.m.color !== mover || !third.m.captured || V[third.m.captured] < 3 || steps[0].m.to === third.m.from) return null;
  const c0 = new Chess(fenBefore);
  if (c0.turn() !== mover || c0.moves({ verbose: true }).some((x) => x.from === third.m.from && x.to === third.m.to)) return null;
  if (!c0.attackers(third.m.to, mover).includes(third.m.from)) return null;
  const foe = opp(mover);
  for (const p of allPieces(fenBefore)) {
    if (p.color !== foe || !'qrb'.includes(p.type)) continue;
    const pin = pinBy(fenBefore, p.square, true);
    if (pin && pin.pinned.square === third.m.from && pin.behind.type === 'k') {
      const chases = new Chess(steps[0].fen).attackers(p.square, mover).includes(steps[0].m.to);
      return { chases, pinner: p, pinned: pin.pinned, target: third.m.captured, targetSq: third.m.to, capture: third.m };
    }
  }
  return null;
}

// Double menace : le coup attaque une pièce qui doit s'écarter, et un autre coup gagnant suit ailleurs.
function doubleThreat(steps, mover) {
  const [first, reply, next] = steps;
  if (!first || !reply || !next || next.m.color !== mover) return null;
  const hit = targets(first.fen, first.m.to).filter((t) => t.type !== 'k' && V[t.type] >= 3)[0];
  if (!hit || reply.m.from !== hit.square) return null;
  if (!(next.m.captured || next.m.san.includes('+')) || next.m.to === reply.m.to) return null;
  const fork = targets(next.fen, next.m.to).filter((t) => t.type !== 'p');
  const forkTxt = fork.length >= 2 ? `, une fourchette sur ${FEM[fork[0].type] ? 'la' : 'le'} ${NAME[fork[0].type]} et ${FEM[fork[1].type] ? 'la' : 'le'} ${NAME[fork[1].type]}` : '';
  return `ça attaque ${the(hit.type, hit.color)} en ${tok(hit.square)} et menace en même temps ${tok(next.m.san)}${forkTxt}`;
}

// Raisons concrètes d'un coup, de la plus forte à la plus faible. Ne décrit jamais le coup lui-même.
function reasonsFor(ctx) {
  const { fenBefore, steps, mover, moveNumber, mateIn, prev, score, threat, playedRecapture } = ctx;
  const first = steps[0];
  if (!first) return [];
  const m = first.m;
  const foe = opp(mover);
  if (m.san.endsWith('#')) return ['c’est mat'];
  if (mateIn && mateIn <= 5) return [mateIn === 1 ? 'ça donne le mat au coup suivant' : `ça force le mat en ${mateIn} coups`];
  const out = [];
  const ex = exchange(steps, mover);
  const recapture = m.captured && prev && prev.captured && prev.to === m.to;
  if (recapture) {
    ex.net -= V[prev.captured];
    if (ex.won[prev.captured]) ex.won[prev.captured] -= 1;
    if (!playedRecapture) out.push(`sinon ${side(mover)} restent avec ${listPieces({ [prev.captured]: 1 })} de moins`);
  }
  const sign = mover === 'w' ? 1 : -1;
  const cp = score.type === 'mate' ? (score.value * sign > 0 ? 1e5 : -1e5) : score.value * sign;
  const realGain = lineDelta(fenBefore, steps, mover) - (recapture ? V[prev.captured] : 0);
  const unpin = realGain >= 1 ? unpinMotif(fenBefore, steps, mover) : null;
  if (unpin) {
    const cost = listPieces(ex.lost);
    out.push(`${unpin.chases ? 'ça chasse' : 'ça libère'} ${unpin.chases ? `${the(unpin.pinner.type, foe)} qui cloue ` : ''}${the(unpin.pinned.type, mover)} en ${tok(unpin.pinned.square)}, et ${the(unpin.target, foe)} en ${tok(unpin.targetSq)} tombe${cost ? `, même si ça coûte ${cost}` : ''}`);
  }
  const dbl = realGain >= 1 && !unpin ? doubleThreat(steps, mover) : null;
  if (dbl) out.push(dbl);
  if (ex.net > 0 && listPieces(ex.won) && cp >= ex.net * 50 && realGain >= 1 && !unpin && !dbl) {
    const lost = listPieces(ex.lost);
    out.push(`ça gagne ${listPieces(ex.won)}${lost ? ` contre ${lost}` : ''}`);
  }
  if (m.promotion) out.push('ça donne une nouvelle dame');

  // Défenseur retiré.
  if (m.captured && !recapture) {
    const c0 = new Chess(fenBefore); const c1 = new Chess(first.fen);
    const freed = allPieces(fenBefore).filter((p) => p.color === foe && V[p.type] >= 3 && p.square !== m.to
      && c0.attackers(p.square, foe).includes(m.to) && c1.attackers(p.square, foe).length === 0 && c1.attackers(p.square, mover).length > 0);
    if (freed.length && realGain >= 1) out.push(`ça retire le défenseur de ${the(freed[0].type, foe)} en ${tok(freed[0].square)}`);
  }

  const taken = steps[1] && steps[1].m.captured && steps[1].m.to === m.to;
  const fork = taken || realGain < 1 ? [] : targets(first.fen, m.to).filter((t) => t.type !== 'p');
  if (fork.length >= 2) out.push(`ça attaque à la fois ${the(fork[0].type, foe)} en ${tok(fork[0].square)} et ${the(fork[1].type, foe)} en ${tok(fork[1].square)}`);
  else if (!taken && realGain >= 1) {
    const pin = pinBy(first.fen, m.to);
    if (pin) out.push(`ça cloue ${the(pin.pinned.type, foe)} en ${tok(pin.pinned.square)} devant ${the(pin.behind.type, foe)} en ${tok(pin.behind.square)}`);
  }
  const t = threatFragment(first, threat, mover, score, steps[1]);
  if (t) out.push(t);

  // Conséquences sur la structure, mesurées à la fin des échanges.
  const end = (steps[3] || steps[steps.length - 1]).fen;
  const foe0 = pawnStats(fenBefore, foe); const foe1 = pawnStats(end, foe);
  const me0 = pawnStats(fenBefore, mover); const me1 = pawnStats(end, mover);
  const sh0 = kingShield(fenBefore, foe); const sh1 = kingShield(end, foe);
  const kingStill = (s) => allPieces(s).find((p) => p.type === 'k' && p.color === foe).square;
  const pawnTaken = steps.slice(0, 4).some((s) => s.m.color === mover && s.m.captured === 'p');
  if (sh0 != null && sh1 != null && sh1 < sh0 && pawnTaken && kingStill(fenBefore) === kingStill(end)) out.push(`ça affaiblit les pions devant ${the('k', foe)}`);
  if (m.captured && steps[1] && steps[1].m.piece === 'p' && steps[1].m.to === m.to && foe1.doubled > foe0.doubled) out.push('ça double les pions adverses');
  if (me1.passed > me0.passed) out.push('ça crée un pion passé');
  if (countType(fenBefore, foe, 'b') === 2 && countType(end, foe, 'b') === 1 && countType(end, mover, 'b') === 2) out.push('ça donne la paire de fous');
  if (m.captured && !recapture && materialFor(fenBefore, mover) >= 2 && !ex.net) out.push('avec du matériel en plus, chaque échange rapproche de la victoire');

  if (m.san.startsWith('O-O')) out.push('ça met le roi à l’abri et rapproche la tour du jeu');
  else if (moveNumber <= 12 && 'nb'.includes(m.piece) && m.from[1] === (mover === 'w' ? '1' : '8')) out.push('ça sort une pièce de plus avant de lancer le jeu');
  else if (moveNumber <= 15 && m.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(m.to) && !m.captured) out.push('ça prend de la place au centre');
  else if (m.piece === 'r' && m.from[0] !== m.to[0]) {
    const pawns = allPieces(first.fen).filter((p) => p.type === 'p' && p.square[0] === m.to[0]);
    if (!pawns.some((p) => p.color === mover)) out.push(`ça place la tour sur une colonne ${pawns.length ? 'semi-ouverte' : 'ouverte'}`);
  } else if (m.piece === 'p' && pawnStats(first.fen, mover).passed && (() => {
    const f = fileIdx(m.to); const r = +m.to[1];
    return !allPieces(first.fen).some((p) => p.type === 'p' && p.color === foe && Math.abs(fileIdx(p.square) - f) <= 1 && (mover === 'w' ? +p.square[1] > r : +p.square[1] < r));
  })()) out.push('ça rapproche un pion passé de la promotion');

  return [...new Set(out)];
}

// Phrase propre aux classes dont le badge ne dit pas tout.
function specialSentence(move, ply) {
  switch (move.kind) {
    case 'book': return `Coup de théorie${ply.opening ? ` : ${ply.opening}` : ''}.`;
    case 'forced': return 'Seul coup légal.';
    case 'brilliant': return `Sacrifice de ${NAME[ply.piece]}, et il tient.`;
    case 'great': return 'C’était le seul bon coup.';
    case 'miss': return 'L’adversaire venait de se tromper, et l’occasion passe.';
    default: return '';
  }
}

// Sacrifice : la pièce arrive sur une case où l'adversaire peut la prendre à perte pour elle.
export function isSacrifice(m) {
  if (!'nbrq'.includes(m.piece)) return false;
  const c = new Chess(m.after);
  const caps = c.moves({ verbose: true }).filter((x) => x.to === m.to && x.captured);
  if (!caps.length) return false;
  const defended = c.attackers(m.to, m.color).length > 0;
  const cheapest = Math.min(...caps.map((x) => (x.piece === 'k' ? 10 : V[x.piece])));
  const gain = m.captured ? V[m.captured] : 0;
  return (!defended || cheapest < V[m.piece]) && V[m.piece] - gain >= 2;
}

// Longueur de la ligne d'ouverture d'après l'URL ECO fournie par Chess.com.
export function bookFromEcoUrl(url, plies) {
  const slug = (url || '').split('/').pop();
  if (!slug) return { plies: 0, name: '' };
  const parts = slug.split('-');
  const firstNum = parts.findIndex((p) => /^\d+\.+/.test(p));
  const name = (firstNum < 0 ? parts : parts.slice(0, firstNum)).join(' ');
  let last = -1;
  parts.forEach((p, i) => { if (/^\d+\.+/.test(p)) last = i; });
  if (last < 0) return { plies: 0, name };
  const m = parts[last].match(/^(\d+)(\.+)(.+)$/);
  let ply = (+m[1] - 1) * 2 + (m[2].length > 1 ? 2 : 1);
  const clean = (s) => s.replace(/[+#]$/, '');
  if (!plies[ply - 1] || clean(plies[ply - 1].san) !== clean(m[3])) return { plies: 0, name };
  const tail = parts.slice(last + 1);
  for (const t of tail) {
    if (plies[ply] && clean(plies[ply].san) === clean(t)) ply += 1; else break;
  }
  return { plies: ply, name };
}

const sentence = (t) => `${t[0].toUpperCase()}${t.slice(1)}.`;

const legalOn = (fen, sq) => new Chess(fen).moves({ square: sq, verbose: true }).length;
function flipTurn(fen) {
  const p = fen.split(' '); p[1] = p[1] === 'w' ? 'b' : 'w'; p[3] = '-';
  return p.join(' ');
}
const unsafe = (c, sq, type, owner) => {
  const foes = c.attackers(sq, opp(owner));
  if (!foes.length) return false;
  if (!c.attackers(sq, owner).length) return true;
  return foes.some((s) => V[c.get(s).type] < V[type] && c.get(s).type !== 'k');
};

// Ce que fait un coup, décrit par son effet. Chaque phrase est un fait lu sur l'échiquier.
function purposes({ fenBefore, steps, mover, prev }) {
  const first = steps[0];
  if (!first) return [];
  const m = first.m; const foe = opp(mover); const out = [];
  const c0 = new Chess(fenBefore); const c1 = new Chess(first.fen);
  const board0 = c0.board().flat().filter(Boolean);
  if (c0.inCheck()) {
    const king = board0.find((p) => p.type === 'k' && p.color === mover).square;
    if (m.captured && c0.attackers(king, foe).includes(m.to)) out.push('ça élimine la pièce qui donnait échec');
    else out.push(m.piece === 'k' ? 'le roi se met hors de l’échec' : 'ça interpose une pièce pour parer l’échec');
  }
  if (m.captured && prev && prev.captured && prev.to === m.to) out.push('ça reprend la pièce qui vient de capturer');
  if (m.piece !== 'k' && unsafe(c0, m.from, m.piece, mover) && !unsafe(c1, m.to, m.piece, mover)) out.push(`ça met ${the(m.piece, mover)} à l’abri`);
  const guarded = board0.find((p) => p.color === mover && p.type !== 'k' && p.square !== m.from && c0.attackers(p.square, foe).length && !c0.attackers(p.square, mover).length && c1.attackers(p.square, mover).includes(m.to) && c1.get(p.square)?.type === p.type);
  if (guarded) out.push(`ça défend ${the(guarded.type, mover)} en ${tok(guarded.square)}`);
  const taken = steps[1] && steps[1].m.captured && steps[1].m.to === m.to;
  if (!taken && 'qrbn'.includes(m.piece)) {
    const same = c1.attackers(m.to, foe).find((s) => c1.get(s).type === m.piece);
    if (same && c1.attackers(m.to, mover).length) out.push(`ça propose l’échange ${FEM[m.piece] ? 'des' : 'des'} ${NAME[m.piece]}s`);
  }
  if (!taken) {
    const hit = targets(first.fen, m.to).filter((t) => t.type !== 'k');
    if (hit[0]) out.push(`ça attaque ${the(hit[0].type, foe)} en ${tok(hit[0].square)}`);
  }
  if (m.san.endsWith('+')) out.push('ça force le roi adverse à réagir');
  const pawns = c1.board().flat().filter((p) => p && p.type === 'p');
  if (m.piece === 'k' && pawns.length && !board0.some((p) => p.type === 'q')) {
    const dist = (sq) => Math.min(...pawns.map((p) => Math.max(Math.abs(fileIdx(p.square) - fileIdx(sq)), Math.abs(+p.square[1] - +sq[1]))));
    if (dist(m.to) < dist(m.from)) out.push('le roi se rapproche des pions');
    else if (Math.abs(fileIdx(m.to) - 3.5) < Math.abs(fileIdx(m.from) - 3.5)) out.push('le roi se rapproche du centre');
  }
  if (m.piece === 'p' && !m.captured && (mover === 'w' ? +m.to[1] >= 4 : +m.to[1] <= 5)) out.push('ça gagne de l’espace');
  if ('nbrq'.includes(m.piece)) {
    const before = legalOn(c0.turn() === mover ? fenBefore : flipTurn(fenBefore), m.from);
    let after = 0;
    if (!c1.inCheck()) { try { after = legalOn(flipTurn(first.fen), m.to); } catch { after = 0; } }
    if (after >= before + 3) out.push(`ça donne plus de cases ${FEM[m.piece] ? 'à la' : 'au'} ${NAME[m.piece]}`);
  }
  if (steps[2] && steps[2].m.color === mover) out.push(`l’idée est de continuer par ${tok(steps[2].m.san)}`);
  else if (steps[1]) out.push(`la réponse attendue est ${tok(steps[1].m.san)}`);
  return out;
}

// Pièce laissée en prise par le coup : l'adversaire peut la prendre et elle y perd.
export function enPrise(m) {
  if (!'nbrq'.includes(m.piece) || m.promotion) return null;
  const c = new Chess(m.after);
  const caps = c.moves({ verbose: true }).filter((x) => x.to === m.to && x.captured);
  if (!caps.length) return null;
  const defended = c.attackers(m.to, m.color).length > 0;
  const cheapest = Math.min(...caps.map((x) => (x.piece === 'k' ? 10 : V[x.piece])));
  if (defended && cheapest >= V[m.piece]) return null;
  const gain = m.captured ? V[m.captured] : 0;
  return { caps: caps.map((x) => x.from + x.to + (x.promotion || '')), sacrifice: V[m.piece] - gain >= 2 };
}

const le = (p) => `${FEM[p] ? 'la' : 'le'} ${NAME[p]}`;

// Le camp qui vient de jouer menace-t-il mat au coup suivant ?
function threatensMate(fen) {
  try {
    const c = new Chess(flipTurn(fen), { skipValidation: true });
    if (c.inCheck()) return false;
    return c.moves().some((s) => s.endsWith('#'));
  } catch { return false; }
}

// Un coup de la suite, dit en mots : qui fait quoi.
function clause(s, prevStep, { own, first }) {
  const m = s.m;
  // La couleur n'est précisée que là où on pourrait confondre : les rois, et deux pièces identiques à la suite.
  const who = m.piece === 'k' || (prevStep && prevStep.m.piece === m.piece) ? the(m.piece, m.color) : le(m.piece);
  const mate = m.san.endsWith('#'); const chk = m.san.endsWith('+');
  if (m.san.startsWith('O-O')) return `${side(m.color)} roquent`;
  if (first && !own && !(m.captured && prevStep.m.to === m.to) && !chk && !mate && !m.promotion) {
    return m.captured ? `après ${tok(m.san)}, où ${who} prend ${le(m.captured)}` : `sur ${who} en ${tok(m.to)}`;
  }
  const forced = !own && prevStep && new Chess(prevStep.fen).moves().length === 1;
  let base;
  if (m.promotion) base = `le pion arrive en ${tok(m.to)} et devient ${NAME[m.promotion]}`;
  else if (m.captured) {
    const re = prevStep && prevStep.m.to === m.to;
    if (first && re) base = `si ${who} prend`;
    else base = re ? `${who} ${prevStep.m.captured ? 'reprend' : 'prend'} en ${tok(m.to)}` : `${who} prend ${le(m.captured)} en ${tok(m.to)}`;
  } else base = `${who} ${forced ? 'n’a que la case' : 'va en'} ${tok(m.to)}`;
  if (mate) return m.captured || m.promotion ? `${base}, et c’est mat` : `${who} fait mat en ${tok(m.to)}`;
  if (chk) return m.captured || m.promotion ? `${base} avec échec` : `${who} donne échec en ${tok(m.to)}`;
  if (own && !m.captured) {
    if (threatensMate(s.fen)) return `${base} et menace mat`;
    const hit = targets(s.fen, m.to).filter((t) => t.type !== 'k' && V[t.type] >= 3)[0];
    if (hit) return `${base} et attaque ${le(hit.type)}`;
  }
  return base;
}

// Raconte la suite après le premier coup, jusqu'au mat ou jusqu'à ce que le matériel soit récupéré.
// Renvoie null si rien de décisif n'arrive dans les coups racontés : on ne promet pas ce que la suite ne montre pas.
export function narrate(startFen, steps, mover, { max = 8, mateIn = 0, winning = false } = {}) {
  if (steps.length < 2) return null;
  const base = materialFor(startFen, mover);
  const parts = [];
  let end = -1; let mate = false;
  for (let i = 1; i < steps.length && i <= max; i += 1) {
    const s = steps[i];
    parts.push(clause(s, steps[i - 1], { own: s.m.color === mover, first: i === 1 }));
    if (s.m.san.endsWith('#')) { end = i; mate = s.m.color === mover; break; }
    const next = steps[i + 1];
    const bal = materialFor(s.fen, mover) - base;
    if (mateIn) continue; // mat annoncé : on va jusqu'au mat, sans s'arrêter au matériel
    if (i >= 2 && bal >= 1 && s.m.color === mover && !(next && next.m.captured && steps[i + 2] === undefined)) {
      // la prise adverse qui suit éventuellement fait partie du décompte
      if (next && next.m.captured) continue;
      if (steps[i + 2] && steps[i + 2].m.captured && i + 2 <= max) continue; // le gain continue au coup suivant
      end = i; break;
    }
    if (i >= 3 && bal >= 1 && s.m.color !== mover && !(next && next.m.captured)) { end = i; break; }
  }
  if (end < 0) {
    // Rien de compté dans les coups racontés : on ne conclut que si le moteur annonce un mat ou un gain net.
    if (!mateIn && !winning) return null;
    let k = Math.min(5, steps.length - 1);
    if (steps[k].m.color !== mover) k -= 1;
    if (k < 2) return null;
    return { text: parts.slice(0, k).join(', '), outcome: mateIn ? `le mat suit, en ${mateIn} coups au total` : 'l’attaque rapporte plus que la pièce donnée', mate: false, end: k, net: 0, open: true, later: false };
  }
  if (steps[end].m.san.endsWith('#') && !mate) return null;
  if (mate && end > 6) {
    // Mat lointain : on raconte le début, le panneau écrit montre toute la suite.
    const k = steps[5].m.color === mover ? 5 : 4;
    return { text: parts.slice(0, k).join(', '), outcome: `le mat suit, en ${Math.ceil((end + 1) / 2)} coups au total`, mate: false, end: k, net: 0, open: true, later: false };
  }
  const shown = steps.slice(0, end + 1);
  const won = {}; const lost = {};
  shown.forEach((s) => { if (s.m.captured) { const bag = s.m.color === mover ? won : lost; bag[s.m.captured] = (bag[s.m.captured] || 0) + 1; } });
  Object.keys(won).forEach((p) => { const k = Math.min(won[p], lost[p] || 0); won[p] -= k; if (lost[p]) lost[p] -= k; });
  const a = listPieces(won); const b = listPieces(lost);
  const net = materialFor(steps[end].fen, mover) - base;
  const outcome = mate ? '' : (a ? `${side(mover)} en sortent avec ${a}${b ? ` contre ${b}` : ''}` : `${side(mover)} en sortent avec du matériel en plus`);
  // « later » : le gain n'est pas acquis dès le premier échange, la suite apporte donc une étape à comprendre.
  const after1 = materialFor(steps[1].fen, mover) - base;
  return { text: parts.slice(0, end).join(', '), outcome, mate, end, net, later: mate || net > Math.max(after1, 0) };
}

// Explication détaillée, écrite seulement : chaque ligne vient de la variante du moteur.
function stepLine(s, prevStep, mover) {
  const m = s.m;
  const parts = [];
  if (m.san.startsWith('O-O')) parts.push('roque');
  if (m.promotion) parts.push(`promotion en ${NAME[m.promotion]}`);
  if (m.captured) parts.push(prevStep && prevStep.m.captured && prevStep.m.to === m.to ? `reprend ${le(m.captured)}` : `prend ${le(m.captured)}`);
  if (m.san.endsWith('#')) parts.push('échec et mat');
  else if (m.san.endsWith('+')) parts.push('échec');
  else if (!m.captured) {
    if (m.color === mover && threatensMate(s.fen)) parts.push('menace mat');
    else {
      const hit = targets(s.fen, m.to).filter((t) => t.type !== 'k' && V[t.type] >= 3)[0];
      if (hit) parts.push(`attaque ${le(hit.type)}`);
    }
  }
  const ep = !m.san.endsWith('#') && enPrise(m);
  if (ep && ep.sacrifice) parts.push(`${le(m.piece)} s’offre`);
  if (prevStep && new Chess(prevStep.fen).moves().length === 1) parts.push('seul coup');
  return `${m.color === 'w' ? 'Blancs' : 'Noirs'} ${tok(m.san)}${parts.length ? ` : ${parts.join(', ')}` : ''}`;
}

function lineBlock(title, steps, mover, startFen, n = 8) {
  let k = Math.min(n, steps.length);
  while (k < steps.length && k < 12 && steps[k].m.captured) k += 1;
  const shown = steps.slice(0, k);
  const lines = shown.map((s, i) => ({ text: stepLine(s, shown[i - 1], mover), fen: s.fen, from: s.m.from, to: s.m.to, san: s.m.san }));
  const won = {}; const lost = {};
  shown.forEach((s) => { if (s.m.captured) { const bag = s.m.color === mover ? won : lost; bag[s.m.captured] = (bag[s.m.captured] || 0) + 1; } });
  Object.keys(won).forEach((p) => { const c = Math.min(won[p], lost[p] || 0); won[p] -= c; if (lost[p]) lost[p] -= c; });
  const a = listPieces(won); const b = listPieces(lost);
  const mate = shown.length && shown[shown.length - 1].m.san.endsWith('#');
  const tally = mate ? 'La suite se termine par un mat.' : a || b ? `Bilan pour ${side(mover)} : ${a ? `+ ${a}` : ''}${a && b ? ', ' : ''}${b ? `− ${b}` : ''}.` : 'Pas de changement de matériel sur cette suite.';
  return { title, startFen, lines, tally };
}

// Si le coup conseillé offre une pièce : la suite où l'adversaire la prend, celle qui explique le sacrifice.
function takenLine(fenBefore, bestSteps, before) {
  const first = bestSteps[0];
  if (!first) return null;
  const ep = first.m.san.endsWith('#') ? null : enPrise(first.m);
  if (!ep) return null;
  const accepted = bestSteps[1] && bestSteps[1].m.captured && bestSteps[1].m.to === first.m.to;
  if (accepted) return { ep, steps: bestSteps, accepted };
  if (!before.ifTaken || !before.ifTaken.pv || !before.ifTaken.pv.length) return { ep, steps: null, accepted };
  const steps = [first, ...walk(first.fen, before.ifTaken.pv)];
  return { ep, steps: steps.length > 1 ? steps : null, accepted };
}

function buildDetails({ fenBefore, mover, bestSteps, playedLine, before, after, played, story }) {
  const unpin = bestSteps.length ? unpinMotif(fenBefore, bestSteps, mover) : null;
  const key = unpin
    ? `La clé : ${the(unpin.pinned.type, mover)} en ${tok(unpin.pinned.square)} est cloué${FEM[unpin.pinned.type] ? 'e' : ''} devant le roi par ${the(unpin.pinner.type, opp(mover))} en ${tok(unpin.pinner.square)}. La prise ${tok(unpin.capture.san)} est donc impossible tant que ${FEM[unpin.pinner.type] ? 'celle-ci' : 'celui-ci'} reste sur cette ligne.`
    : (story || '');
  const blocks = [];
  if (bestSteps.length) blocks.push(lineBlock(played ? 'La suite calculée' : 'Avec le coup conseillé', bestSteps, mover, fenBefore));
  const tk = bestSteps.length ? takenLine(fenBefore, bestSteps, before) : null;
  if (tk && !tk.accepted && tk.steps) blocks.push(lineBlock(`Et si l’adversaire prend ${le(bestSteps[0].m.piece)} ?`, tk.steps, mover, fenBefore));
  if (!played) blocks.push(lineBlock('Avec le coup joué', playedLine, mover, fenBefore));
  const compare = played ? `Évaluation : ${evalWords(after.score)}.` : `Après le coup conseillé : ${evalWords(before.score)}. Après le coup joué : ${evalWords(after.score)}.`;
  return { key, blocks, compare };
}

// Le récit de la suite gagnante, pour ne pas sauter d'étape entre le coup et son résultat.
function storyOf(fenBefore, steps, before, mover) {
  const first = steps[0];
  if (!first) return null;
  const tk = takenLine(fenBefore, steps, before);
  const sign = mover === 'w' ? 1 : -1;
  const facts = (sc) => ({
    mateIn: sc.type === 'mate' && sc.value * sign > 0 ? sc.value * sign : 0,
    winning: sc.type === 'cp' && sc.value * sign >= 300,
  });
  if (tk && tk.steps) {
    const n = narrate(fenBefore, tk.steps, mover, facts(tk.accepted ? before.score : before.ifTaken.score));
    // suite secondaire : on ne la raconte que si elle est bien bonne pour le camp qui sacrifie
    const okScore = tk.accepted || (before.ifTaken && (before.ifTaken.score.type === 'mate' ? before.ifTaken.score.value * sign > 0 : before.ifTaken.score.value * sign >= 100));
    // Vrai sacrifice : après la prise et le coup suivant, le camp a toujours nettement moins de matériel.
    const probe = tk.steps[2] || tk.steps[1];
    const realSac = tk.ep.sacrifice && materialFor(probe.fen, mover) - materialFor(fenBefore, mover) <= -2;
    if (n && okScore && (n.mate || n.net >= 1 || n.open) && (tk.accepted || realSac)) return { ...n, sac: realSac, taken: true };
  }
  const n = narrate(fenBefore, steps, mover, { mateIn: facts(before.score).mateIn });
  return n ? { ...n, sac: false } : null;
}

function withStory(reason, st) {
  if (!st || !st.text) return reason;
  const tail = st.outcome ? `${st.text}, et ${st.outcome}` : st.text;
  return reason ? `${reason} : ${tail}` : tail;
}

// Le décompte de matériel n'est annoncé que si l'évaluation le confirme ; sinon on dit où mène la suite.
function settle(st, score, mover, deficit) {
  if (!st || st.mate || st.open || !st.outcome) return st;
  const sign = mover === 'w' ? 1 : -1;
  const cp = score.type === 'mate' ? (score.value * sign > 0 ? 1e5 : -1e5) : score.value * sign;
  if (cp >= st.net * 50) return st;
  if (Math.abs(cp) < 100) return { ...st, outcome: deficit ? 'la position redevient équilibrée' : 'la position reste équilibrée' };
  return { ...st, outcome: '' };
}

// Ce qu'un camp a de moins que l'autre, pièce par pièce.
function deficitOf(fen, color) {
  const less = {}; const more = {};
  for (const p of ['q', 'r', 'b', 'n', 'p']) {
    const d = countType(fen, opp(color), p) - countType(fen, color, p);
    if (d > 0) less[p] = d; else if (d < 0) more[p] = -d;
  }
  if (materialFor(fen, color) > -2) return null;
  const extra = listPieces(more);
  return `${listPieces(less)} de moins${extra ? ` (pour ${extra} de plus)` : ''}`;
}

const keyOf = (t) => t.split(' ').slice(0, 2).join(' ');
const pick = (list, avoid) => list.find((t) => keyOf(t) !== avoid) || list[0] || '';

// Pourquoi un coup proposé dans un problème est refusé, sans dévoiler la solution.
export function explainWrongMove({ fenBefore, fenAfter, ply, after, themes }) {
  const mover = ply.color;
  const neg = negative({ fenBefore, fenAfter, ply, after, mover });
  const out = neg.out.slice(0, 2);
  const sign = mover === 'w' ? 1 : -1;
  const cp = after.score.type === 'mate' ? (after.score.value * sign > 0 ? 3000 : -3000) : after.score.value * sign;
  if (!out.length && neg.r) {
    out.push(`L’adversaire répond ${tok(neg.r.m.san)}.`);
    if (cp < -100) out.push('Ta position devient mauvaise.');
    else if (cp < 100) out.push('Ton avantage disparaît : la position redevient équilibrée.');
    else out.push('Ce coup reste jouable, mais il laisse passer bien plus fort.');
  }
  const t = themes || [];
  if (t.some((x) => x.startsWith('mate'))) out.push('Il y a un mat à trouver.');
  else if (t.includes('equality')) out.push('Il faut trouver le coup qui sauve la partie.');
  else out.push('Un autre coup donne un avantage décisif.');
  return { sentences: out, refutation: neg.r ? neg.r.m.from + neg.r.m.to : null };
}

/**
 * Renvoie { sentences, spoken, line }.
 * La cause vient d'abord. Le coup conseillé et sa raison tiennent en une seule phrase.
 */
export function explainMove({ fenBefore, fenAfter, ply, before, after, move, index, prev, avoid }) {
  const mover = ply.color;
  const moveNumber = Math.floor(index / 2) + 1;
  const special = specialSentence(move, ply);
  if (move.kind === 'forced' || move.kind === 'book') return { sentences: [], notes: special ? [special] : [], line: '' };

  const sign = mover === 'w' ? 1 : -1;
  const mateFor = (s) => (s.type === 'mate' && s.value * sign > 0 ? s.value * sign : 0);
  const lead = special ? [special] : [];

  const STRONG = /\bmat(?![a-zé])|gagne|à la fois|cloue|défenseur|menace de prendre (le cavalier|le fou|la tour|la dame)|menace un mat/;

  const playedLine = [...walk(fenBefore, [ply.uci]), ...walk(fenAfter, after.pv)];
  const describe = (why) => [...why.filter((t) => !/^sinon/.test(t)), ...purposes({ fenBefore, steps: playedLine, mover, prev })];

  if (move.playedBest) {
    const why = reasonsFor({ fenBefore, steps: playedLine, mover, moveNumber, mateIn: mateFor(before.score), prev, score: before.score, threat: before.threat, playedRecapture: true });
    const strong = why.find((t) => STRONG.test(t));
    const chosen = strong || pick(describe(why), avoid);
    const showy = ['brilliant', 'great'].includes(move.kind);
    const st = settle(showy || (strong && /^ça gagne|^ça force le mat|tombe|en même temps/.test(strong)) ? storyOf(fenBefore, playedLine, before, mover) : null, before.score, mover, false);
    // Le récit n'est ajouté que s'il apporte une étape : sacrifice, ou gain et mat qui n'arrivent pas tout de suite.
    // Avec une raison déjà dite, il doit aller jusqu'au bout (mat ou gain), sinon il s'arrêterait en l'air.
    const tell = st && st.text && (strong && !st.sac ? st.later && !st.open : st.sac || st.later || (showy && st.open));
    const keep = strong && /en même temps/.test(strong);
    const said = tell ? withStory(strong && !st.sac ? strong : '', strong && !st.sac && !keep ? { ...st, outcome: '' } : st) : chosen;
    const details = showy || tell ? buildDetails({ fenBefore, mover, bestSteps: playedLine, playedLine, before, after, played: true, story: tell ? sentence(`En mots : ${withStory('', st)}`) : '' }) : null;
    return { sentences: [special, said ? sentence(said) : ''].filter(Boolean), notes: [], line: lineOf(playedLine.slice(1), 4), key: keyOf(chosen || ''), details };
  }

  const neg = negative({ fenBefore, fenAfter, ply, after, mover });
  const reasons = move.loss >= 5 ? neg.out : [];
  const bestSteps = walk(fenBefore, before.pv && before.pv.length ? before.pv : [before.best]);
  const playedRecapture = !!(ply.captured && prev && prev.captured && prev.to === ply.to);
  const why = bestSteps.length
    ? reasonsFor({ fenBefore, steps: bestSteps, mover, moveNumber, mateIn: mateFor(before.score), prev, score: before.score, threat: before.threat, playedRecapture })
    : [];
  // Les principes généraux ne sont pas prouvés par le calcul : jamais présentés comme la raison.
  const GENERAL = /l’abri|sort une pièce|place au centre|colonne|rapproche un pion|chaque échange/;
  const proven = why.filter((t) => !GENERAL.test(t));
  const general = why.filter((t) => GENERAL.test(t));
  if (!proven.length && neg.r && move.loss >= 5) {
    const r = neg.r;
    const hit = r.m.captured ? [] : targets(r.fen, r.m.to).filter((t) => t.type !== 'k' && V[t.type] >= 3);
    if (r.m.captured || hit[0]) proven.push(`sinon ${side(opp(mover))} jouent ${tok(r.m.san)}${hit[0] ? `, qui attaque ${the(hit[0].type, hit[0].color)} en ${tok(hit[0].square)}` : ''}`);
  }
  const line = lineOf(bestSteps.slice(1), 4);
  if (!bestSteps.length) return { sentences: [...lead, ...reasons], notes: [], line };
  const deficit = deficitOf(fenBefore, mover);
  const st = settle(move.loss >= 5 ? storyOf(fenBefore, bestSteps, before, mover) : null, before.score, mover, !!deficit);
  const b0 = bestSteps[0].m;
  const action = st && st.sac ? `sacrifier ${le(b0.piece)} en ${tok(b0.to)}` : moveAction(b0);
  if (move.loss < 5) {
    // Bon coup : on dit ce qu'il fait, la nuance reste écrite à part.
    const own = reasonsFor({ fenBefore, steps: playedLine, mover, moveNumber, mateIn: mateFor(after.score), prev, score: after.score, playedRecapture });
    const chosen = pick(describe(own), avoid);
    return { sentences: [special, chosen ? sentence(chosen) : ''].filter(Boolean), notes: [`Légèrement mieux : ${action}.`], line, key: keyOf(chosen || '') };
  }
  // Sans raison prouvée, on décrit l'effet du coup conseillé sans le présenter comme une preuve.
  const effect = !proven[0] ? purposes({ fenBefore, steps: bestSteps, mover, prev }).find((t) => !/^l’idée|^la réponse/.test(t)) || general[0] : '';
  let better;
  if (st && st.sac && st.text) better = `Mieux valait ${action} : ${withStory('', st)}.`;
  else if (st && st.text && st.later && !st.open && proven[0] && /en même temps/.test(proven[0])) better = `Mieux valait ${action} : ${proven[0]}. ${cap(withStory('', st))}.`;
  else if (st && st.text && st.later && !st.open && proven[0] && /^ça gagne|^ça force le mat|tombe/.test(proven[0])) better = `Mieux valait ${action}, car ${withStory(proven[0], { ...st, outcome: '' })}.`;
  else better = `Mieux valait ${action}${proven[0] ? `, car ${proven[0]}` : effect ? ` : ${effect}` : ''}.`;
  // Sans défaut concret dans le coup joué : on dit ce qui était en jeu.
  if (!reasons.length && !special && deficit && st && st.text && st.outcome && st.later && !st.open && st.net >= 2 && move.loss >= 10) {
    lead.push(`${Side(mover)} ont ${deficit} et pouvaient se rattraper ici.`);
    if (!/en même temps|^ça gagne|^ça force le mat|tombe/.test(proven[0] || '')) better = `Mieux valait ${action} : ${withStory('', st)}.`;
  }
  return {
    sentences: [...reasons.slice(0, 2), special && !reasons.length ? special : '', ...lead.filter((t) => t !== special), better].filter(Boolean),
    notes: [proven[1] ? `Et ${proven[1]}.` : '', general[0] && general[0] !== effect ? `Idée générale : ${general[0]}.` : ''].filter(Boolean),
    line,
    key: '',
    details: buildDetails({ fenBefore, mover, bestSteps, playedLine, before, after, played: false, story: st && st.text && (st.sac || st.later || st.open) ? sentence(`En mots : ${withStory('', st)}`) : '' }),
  };
}
