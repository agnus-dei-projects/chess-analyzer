// Calculs d'analyse, sans dépendance au navigateur.
// Formules Win% et précision : https://lichess.org/page/accuracy

// Points attendus perdus, barème publié par Chess.com (x100) :
// https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-move
export const THRESHOLDS = { excellent: 2, good: 5, inaccuracy: 10, mistake: 20 };

// Réglages internes : Chess.com publie les critères de ces coups, pas leurs seuils.
export const SPECIAL = {
  brilliantMaxLoss: 2, brilliantMinAfter: 50, alreadyWinning: 97,
  greatGap: 15, greatSecondBelow: 45, greatMinAfter: 40,
  missBefore: 65, missAfter: 55, missMinLoss: 5,
};

export const KINDS = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder', 'forced'];

export const LABELS = {
  brilliant: 'Brillant',
  great: 'Décisif',
  best: 'Meilleur',
  excellent: 'Excellent',
  good: 'Bon',
  book: 'Théorie',
  inaccuracy: 'Imprécision',
  mistake: 'Erreur',
  miss: 'Occasion manquée',
  blunder: 'Gaffe',
  forced: 'Forcé',
};

export const GLYPHS = {
  brilliant: '!!', great: '!', best: '★\uFE0E', excellent: '✓✓', good: '✓\uFE0E', book: '≡', inaccuracy: '?!', mistake: '?', miss: '×', blunder: '??', forced: '□',
};

export const MATE_CP = 100000;

export function winPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function moveAccuracy(before, after) {
  const loss = Math.max(0, before - after);
  const a = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return Math.min(100, Math.max(0, a));
}

// Convertit un score UCI (vu du camp au trait) en score vu des Blancs.
export function toWhiteScore(score, whiteToMove) {
  return whiteToMove ? score : { type: score.type, value: -score.value };
}

export function scoreToCp(s) {
  if (s.type === 'cp') return s.value;
  if (s.value === 0) return s.mated === 'white' ? -MATE_CP : MATE_CP;
  return s.value > 0 ? MATE_CP : -MATE_CP;
}

export function formatScore(s) {
  if (!s) return '…';
  if (s.type === 'mate') {
    if (s.value === 0) return 'Mat';
    return (s.value > 0 ? '+M' : '−M') + Math.abs(s.value);
  }
  const v = s.value / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
}

export function classify(loss, playedBest, legal) {
  if (legal === 1) return 'forced';
  if (playedBest) return 'best';
  if (loss >= THRESHOLDS.mistake) return 'blunder';
  if (loss >= THRESHOLDS.inaccuracy) return 'mistake';
  if (loss >= THRESHOLDS.good) return 'inaccuracy';
  if (loss >= THRESHOLDS.excellent) return 'good';
  return 'excellent';
}

function special(base, ply, m, secondPct, prevKind) {
  if (base === 'forced') return base;
  const S = SPECIAL;
  if (secondPct != null && ply.sacrifice && m.loss < S.brilliantMaxLoss && m.moverAfter >= S.brilliantMinAfter && secondPct < S.alreadyWinning) return 'brilliant';
  if (secondPct != null && !ply.recapture && !ply.san.endsWith('#') && m.loss < S.brilliantMaxLoss && m.moverAfter - secondPct >= S.greatGap && secondPct < S.greatSecondBelow && m.moverAfter >= S.greatMinAfter) return 'great';
  if (['mistake', 'blunder', 'miss'].includes(prevKind) && m.loss >= S.missMinLoss && m.moverBefore >= S.missBefore && m.moverAfter <= S.missAfter) return 'miss';
  return base;
}

/**
 * plies : [{ san, uci, color: 'w'|'b' }], un par coup joué
 * evals : [{ score (vu des Blancs), best (UCI) }], un par position, plies.length + 1 au maximum
 * Un coup n'est jugé que si les évaluations avant et après sont connues.
 */
export function buildReport(plies, evals, bookPlies = 0) {
  const moves = [];
  plies.forEach((ply, i) => {
    moves.push(judge(ply, i));
  });
  function judge(ply, i) {
    const before = evals[i];
    const after = evals[i + 1];
    if (!before || !after) return { ...ply, pending: true };
    const wb = winPct(scoreToCp(before.score));
    const wa = winPct(scoreToCp(after.score));
    const moverBefore = ply.color === 'w' ? wb : 100 - wb;
    const moverAfter = ply.color === 'w' ? wa : 100 - wa;
    const loss = Math.max(0, moverBefore - moverAfter);
    const playedBest = before.best === ply.uci;
    const secondPct = before.second ? (ply.color === 'w' ? winPct(scoreToCp(before.second)) : 100 - winPct(scoreToCp(before.second))) : null;
    const base = classify(loss, playedBest, ply.legal);
    const m = {
      ...ply,
      moverBefore,
      moverAfter,
      loss,
      playedBest,
      bestUci: before.best,
      secondPct,
      accuracy: moveAccuracy(moverBefore, moverAfter),
    };
    const prev = moves[i - 1];
    m.kind = i < bookPlies ? 'book' : special(base, ply, m, secondPct, prev && !prev.pending ? prev.kind : null);
    return m;
  }

  const summarize = (color) => {
    const done = moves.filter((m) => m.color === color && !m.pending);
    const counts = Object.fromEntries(KINDS.map((k) => [k, done.filter((m) => m.kind === k).length]));
    return {
      moves: done.length,
      accuracy: done.length ? done.reduce((s, m) => s + m.accuracy, 0) / done.length : null,
      counts,
    };
  };

  return { moves, white: summarize('w'), black: summarize('b') };
}

// Extrait la dernière évaluation et le meilleur coup de la sortie UCI.
export function parseInfo(line) {
  if (!line.startsWith('info') || !line.includes(' score ')) return null;
  const m = line.match(/ score (cp|mate) (-?\d+)/);
  if (!m) return null;
  const pv = line.match(/ pv (.+)$/);
  return { type: m[1], value: parseInt(m[2], 10), pv: pv ? pv[1].trim().split(/\s+/) : [] };
}

export const FAIR_RESULTS = ['1-0', '0-1', '1/2-1/2'];
