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
function targets(fen, from) {
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

function pinBy(fen, from) {
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
    if (t) return `${cap(the(t.piece.type, mover))} en ${tok(ply.to)} est ${t.attacked ? 'piégé' : 'bloqué'}${FEM[t.piece.type] ? 'e' : ''} : ${ELLE(t.piece.type)} n’a plus aucune case sûre.`;
  }
  return null;
}

// Pourquoi un coup coûte des chances de gain : on lit la réfutation.
function negative(ctx) {
  const { fenBefore, fenAfter, ply, after, mover } = ctx;
  const steps = walk(fenAfter, after.pv);
  const r = steps[0];
  const out = [];
  const sign = mover === 'w' ? 1 : -1;
  if (after.score.type === 'mate' && after.score.value * sign < 0) {
    const n = Math.abs(after.score.value);
    out.push(n === 1 ? `Il permet un mat immédiat avec ${tok(r ? r.m.san : '')}.` : `Il permet un mat forcé en ${n} coups : ${lineOf(steps, 5)}.`);
    return { out, r };
  }
  if (!r) return { out, r };
  const trap = trapSentence(ply, mover, steps);
  if (trap) out.push(trap);
  const first = walk(fenBefore, [ply.uci])[0];
  const ex = exchange(first ? [first, ...steps] : steps, mover);
  if (ex.net < 0) {
    const lost = listPieces(ex.lost);
    const won = listPieces(ex.won);
    if (r.m.captured && r.m.to === ply.to && !first.m.captured) {
      out.push(`Après ${tok(r.m.san)}, ${the(first.m.promotion || first.m.piece, mover)} qui vient d’arriver en ${tok(ply.to)} est pris${FEM[first.m.piece] ? 'e' : ''}.`);
    } else if (r.m.captured) {
      out.push(`La réponse ${tok(r.m.san)} prend ${the(r.m.captured, mover)} en ${tok(r.m.to)}.`);
    } else {
      if (!trap) out.push(`La suite : ${lineOf(steps, 4)}.`);
    }
    if (lost) out.push(`${Side(mover)} perdent ${lost}${won ? ` contre ${won}` : ''}.`);
    if (r.m.captured && threatExisted(fenBefore, r.m)) out.push('Cette menace existait déjà et le coup joué n’y répond pas.');
    return { out, r };
  }
  const fork = targets(r.fen, r.m.to);
  if (fork.length >= 2) { out.push(forkSentence(r.m, fork, `La réponse ${tok(r.m.san)}`)); return { out, r }; }
  const pin = pinBy(r.fen, r.m.to);
  if (pin) { out.push(pinSentence(pin, `La réponse ${tok(r.m.san)}`)); return { out, r }; }
  const promo = steps.slice(0, 8).find((s) => s.m.promotion && s.m.color !== mover);
  if (promo) { out.push(`L’adversaire va promouvoir : ${lineOf(steps, 5)}.`); return { out, r }; }
  const checks = steps.slice(0, 6).filter((s) => s.m.color !== mover && s.m.san.includes('+')).length;
  if (checks >= 2) { out.push(`${cap(the('k', mover))} subit une série d’échecs : ${lineOf(steps, 5)}.`); return { out, r }; }
  return { out, r };
}

// Ce qu'apporte un coup, d'après sa variante.
function positive(ctx) {
  const { fenBefore, steps, mover, moveNumber, mateIn, threat, prev, score } = ctx;
  const first = steps[0];
  if (!first) return [];
  const m = first.m;
  const out = [];
  if (m.san.endsWith('#')) return ['C’est échec et mat.'];
  if (mateIn) return [mateIn === 1 ? 'Il donne le mat au coup suivant.' : `Il force le mat en ${mateIn} coups : ${lineOf(steps, 5)}.`];

  const ex = exchange(steps, mover);
  if (m.promotion) out.push(`Il promeut le pion en ${NAME[m.promotion]}.`);
  const recapture = m.captured && prev && prev.captured && prev.to === m.to;
  if (recapture) {
    out.push(`Il reprend ${the(m.captured, opp(mover))} en ${tok(m.to)}.`);
    ex.net -= V[prev.captured];
    if (ex.won[prev.captured]) ex.won[prev.captured] -= 1;
  } else if (m.captured) {
    const undefended = new Chess(fenBefore).attackers(m.to, opp(mover)).length === 0;
    out.push(`Il prend ${the(m.captured, opp(mover))}${undefended ? ' non défendu' + (FEM[m.captured] ? 'e' : '') : ''} en ${tok(m.to)}.`);
  }
  const sign = mover === 'w' ? 1 : -1;
  const cp = score.type === 'mate' ? (score.value * sign > 0 ? 1e5 : -1e5) : score.value * sign;
  if (ex.net > 0 && listPieces(ex.won) && cp >= ex.net * 50) {
    const lost = listPieces(ex.lost);
    out.push(`${Side(mover)} gagnent ${listPieces(ex.won)}${lost ? ` contre ${lost}` : ''}.`);
  }
  if (threat && threat.m && threat.played !== m.from + m.to) {
    const replies = steps[1] ? steps[1].m.from + steps[1].m.to : '';
    if (replies !== threat.m.from + threat.m.to && (threat.m.captured || threat.m.san.includes('+'))) out.push(`Il évite la réponse ${tok(threat.m.san)}.`);
  }
  const taken = steps[1] && steps[1].m.captured && steps[1].m.to === m.to;
  const fork = taken ? [] : targets(first.fen, m.to);
  if (fork.length >= 2) out.push(forkSentence(m, fork, 'Il'));
  else if (!taken) {
    const pin = pinBy(first.fen, m.to);
    if (pin) out.push(pinSentence(pin, 'Il'));
  }
  if (out.length >= 2) return out.slice(0, 3);

  if (m.san.startsWith('O-O')) out.push('Il met le roi à l’abri en roquant.');
  else if (moveNumber <= 12 && 'nb'.includes(m.piece) && m.from[1] === (mover === 'w' ? '1' : '8')) out.push(`Il développe ${the(m.piece, mover)} vers ${tok(m.to)}.`);
  else if (moveNumber <= 15 && m.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(m.to) && !m.captured) out.push('Il occupe le centre avec un pion.');
  else if (m.piece === 'r' || m.piece === 'p') {
    const c = new Chess(first.fen);
    const board = c.board().flat().filter(Boolean);
    const onFile = (f, col) => board.filter((p) => p.type === 'p' && p.color === col && p.square[0] === f);
    if (m.piece === 'r' && !onFile(m.to[0], mover).length && m.from[0] !== m.to[0]) out.push(`Il place la tour sur une colonne ${onFile(m.to[0], opp(mover)).length ? 'semi-ouverte' : 'ouverte'}.`);
    if (m.piece === 'p') {
      const fi = m.to.charCodeAt(0);
      const rank = +m.to[1];
      const ahead = (p) => (mover === 'w' ? +p.square[1] > rank : +p.square[1] < rank);
      const blockers = board.filter((p) => p.type === 'p' && p.color === opp(mover) && Math.abs(p.square.charCodeAt(0) - fi) <= 1 && ahead(p));
      if (!blockers.length) out.push('Il avance un pion passé.');
    }
  }
  if (m.san.endsWith('+')) out.push('Il donne échec et garde l’initiative.');
  else if (fork.length === 1) out.push(`Il attaque ${the(fork[0].type, fork[0].color)} en ${tok(fork[0].square)}.`);
  return out.slice(0, 3);
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

/**
 * Renvoie { sentences, spoken, line }.
 * `spoken` commence par ce qui compte le plus et reste court.
 */
export function explainMove({ fenBefore, fenAfter, ply, before, after, move, index, prev }) {
  const mover = ply.color;
  const moveNumber = Math.floor(index / 2) + 1;
  const special = specialSentence(move, ply);
  if (move.kind === 'forced' || move.kind === 'book') return { sentences: [special], spoken: [], line: '' };

  const sign = mover === 'w' ? 1 : -1;
  const mateFor = (s) => (s.type === 'mate' && s.value * sign > 0 ? s.value * sign : 0);
  const playedSteps = [...walk(fenBefore, [ply.uci]), ...walk(fenAfter, after.pv)];
  const lead = special ? [special] : [];

  if (move.playedBest) {
    const pos = positive({ fenBefore, steps: playedSteps, mover, moveNumber, mateIn: mateFor(before.score), prev, score: before.score });
    return {
      sentences: [...lead, ...pos],
      spoken: [special, ...pos.slice(0, 1)].filter(Boolean),
      line: lineOf(playedSteps.slice(1), 4),
    };
  }

  // Coup imparfait : la cause d'abord, le coup à jouer ensuite.
  let threat = null;
  let reasons = [];
  const neg = negative({ fenBefore, fenAfter, ply, after, mover });
  if (neg.r) threat = { m: neg.r.m, played: ply.from + ply.to };
  if (move.loss >= 5) reasons = neg.out;
  else reasons = neg.out.filter((t) => /piégé|bloqué/.test(t));

  const bestSteps = walk(fenBefore, before.pv && before.pv.length ? before.pv : [before.best]);
  const better = bestSteps.length ? `Mieux valait ${tok(bestSteps[0].m.san)}.` : '';
  const why = bestSteps.length
    ? positive({ fenBefore, steps: bestSteps, mover, moveNumber, mateIn: mateFor(before.score), threat: move.loss >= 5 ? threat : null, prev, score: before.score })
    : [];

  const praise = move.loss < 5 ? positive({ fenBefore, steps: playedSteps, mover, moveNumber, mateIn: mateFor(after.score), prev, score: after.score }).slice(0, 1) : [];
  const sentences = [...lead, ...reasons, ...praise, better, ...why].filter(Boolean);

  const opening = reasons.length ? reasons.slice(0, 2) : [special];
  const prefix = reasons.length && special ? [special] : [];
  return {
    sentences,
    spoken: [...opening, ...prefix, better, ...why.slice(0, 1)].filter(Boolean),
    line: lineOf(bestSteps.slice(1), 4),
  };
}
