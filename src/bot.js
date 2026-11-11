// Bots qui imitent un vrai joueur. Trois ingrédients, chacun mesuré sur ses parties (voir tests/bots/) :
// son répertoire d'ouvertures, les coups de Maia à son Elo (avec le fil de la partie), et une « netteté » du
// tirage réglée pour que le bot se trompe aussi souvent que lui.
// Les caractéristiques de style (features, weigh) ne servent qu'à l'étude dans tests/bots/ : repondérer les coups
// par des habitudes (échanges, échecs, jugement du moteur) n'a pas rapproché le bot du joueur, l'appli ne s'en sert pas.
import { Chess } from 'chess.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
// Coups que Maia juge trop improbables pour être envisagés, et nombre maximal de candidats.
export const MIN_PROB = 0.01;
export const MAX_CANDIDATES = 10;
const CLAMP_CP = 3000; // un mat annoncé compte comme un très gros avantage, pas plus
const MAX_LOSS = 5; // perte maximale prise en compte, en pions

export const bookKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

// Les caractéristiques d'un coup, dans l'ordre de FEATURES. m : coup détaillé de chess.js ; prevTo : case d'arrivée du coup précédent.
export const FEATURES = ['capture', 'check', 'knight', 'bishop', 'rook', 'queen', 'king', 'castleShort', 'castleLong', 'flankPawn', 'centerPawn', 'retreat', 'advance', 'evenTrade', 'queenTrade', 'winsMaterial', 'recapture', 'center', 'promotion', 'loss', 'best', 'mistake', 'blunder'];
export function features(m, prevTo, loss, isBest) {
  const white = m.color === 'w';
  const dr = (Number(m.to[1]) - Number(m.from[1])) * (white ? 1 : -1);
  const piece = m.piece;
  const cap = m.captured;
  const castle = m.flags.includes('k') ? 1 : m.flags.includes('q') ? 2 : 0;
  return [
    cap ? 1 : 0,
    /[+#]/.test(m.san) ? 1 : 0,
    piece === 'n' ? 1 : 0, piece === 'b' ? 1 : 0, piece === 'r' ? 1 : 0, piece === 'q' ? 1 : 0, piece === 'k' && !castle ? 1 : 0,
    castle === 1 ? 1 : 0, castle === 2 ? 1 : 0,
    piece === 'p' && !cap && 'abgh'.includes(m.from[0]) ? 1 : 0,
    piece === 'p' && !cap && 'de'.includes(m.from[0]) ? 1 : 0,
    piece !== 'p' && !castle && dr < 0 ? 1 : 0,
    piece !== 'p' && !castle && dr > 0 ? 1 : 0,
    cap && VALUE[cap] === VALUE[piece] ? 1 : 0,
    cap === 'q' && piece === 'q' ? 1 : 0,
    cap && VALUE[cap] > VALUE[piece] ? 1 : 0,
    cap && prevTo === m.to ? 1 : 0,
    ['d4', 'e4', 'd5', 'e5'].includes(m.to) ? 1 : 0,
    m.promotion ? 1 : 0,
    loss, isBest ? 1 : 0, loss >= 1 ? 1 : 0, loss >= 3 ? 1 : 0,
  ];
}

// Candidats d'une position : les coups que Maia juge plausibles.
export function candidatesOf(policy) {
  const sorted = policy.slice().sort((a, b) => b[1] - a[1]);
  const kept = sorted.filter((x) => x[1] >= MIN_PROB).slice(0, MAX_CANDIDATES);
  return kept.length ? kept : sorted.slice(0, 1);
}

// Poids (non normalisés) de chaque candidat. policy : [[coup, probabilité]] ; evals : Map coup → centipions (camp au trait), ou null.
export function weigh(model, fen, policy, evals, prevTo) {
  const c = new Chess(fen);
  const legal = new Map(c.moves({ verbose: true }).map((m) => [m.from + m.to + (m.promotion || ''), m]));
  const cand = policy.filter((x) => legal.has(x[0]));
  const cps = cand.map((x) => (evals && evals.has(x[0]) ? Math.max(-CLAMP_CP, Math.min(CLAMP_CP, evals.get(x[0]))) : null));
  const known = cps.filter((v) => v != null);
  const top = known.length ? Math.max(...known) : null;
  const w = FEATURES.map((k) => (model.weights || {})[k] || 0);
  return cand.map(([uci, p], i) => {
    // Sans évaluation du moteur pour ce coup, il est traité comme un coup moyen : ni le meilleur, ni une faute.
    const loss = cps[i] == null || top == null ? 0.3 : Math.min(MAX_LOSS, (top - cps[i]) / 100);
    const f = features(legal.get(uci), prevTo, loss, cps[i] != null && cps[i] === top);
    let s = model.alpha * Math.log(Math.max(p, 1e-4));
    for (let k = 0; k < f.length; k += 1) s += w[k] * f[k];
    return { uci, score: s, f };
  });
}

// Coup tiré parmi ceux que Maia juge plausibles. Une netteté au-dessus de 1 favorise ses premiers choix.
export function pickFromPolicy(model, policy, rnd = Math.random) {
  return sample(candidatesOf(policy).map(([uci, p]) => ({ uci, score: model.alpha * Math.log(Math.max(p, 1e-4)) })), rnd);
}

export function sample(scored, rnd = Math.random) {
  const max = Math.max(...scored.map((x) => x.score));
  const ws = scored.map((x) => Math.exp(x.score - max));
  let r = rnd() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < scored.length; i += 1) { r -= ws[i]; if (r <= 0) return scored[i].uci; }
  return scored[scored.length - 1].uci;
}

// Coup du répertoire : tiré selon la fréquence à laquelle il a été joué dans cette position. null hors répertoire.
export function bookMove(model, fen, rnd = Math.random) {
  const entry = model.book[bookKey(fen)];
  if (!entry) return null;
  const c = new Chess(fen);
  const legal = new Set(c.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')));
  const list = Object.entries(entry).filter(([u]) => legal.has(u));
  if (!list.length) return null;
  let r = rnd() * list.reduce((a, x) => a + x[1], 0);
  for (const [u, n] of list) { r -= n; if (r <= 0) return u; }
  return list[list.length - 1][0];
}

// Temps de réflexion affiché avant un coup, en millisecondes, d'après le rythme réel du joueur à ce stade de la partie.
export function thinkMs(model, ply, rnd = Math.random) {
  const t = model.tempo || [];
  const base = t[Math.min(t.length - 1, Math.floor(ply / 2 / 5))] || 2;
  return Math.round(Math.max(400, Math.min(3500, base * 250 * (0.6 + rnd() * 0.8))));
}
