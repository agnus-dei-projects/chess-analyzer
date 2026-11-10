import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import {
  buildReport, formatScore, GLYPHS, KINDS, LABELS, MATE_CP, parseInfo, pickHuman, scoreToCp, toWhiteScore, winPct, FAIR_RESULTS,
} from './analysis.js';
import { Engine, POOL_SIZE } from './engine.js';
import { createTrainer } from './exercises.js';
import { createFx } from './fx.js';
import { bookFromEcoUrl, enPrise, explainMove, isSacrifice, sanToSpeech, walk } from './explain.js';

const API = 'https://api.chess.com/pub/player/';
const FIGURINES = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };
const fig = (san) => san.replace(/[KQRBN]/g, (c) => FIGURINES[c]);
const $ = (id) => document.getElementById(id);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) el.append(c);
  return el;
}

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* facultatif */ } },
};

/* ---------- Partie ---------- */

function parseGame(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  if (!history.length) throw new Error('empty');
  const fens = [history[0].before, ...history.map((m) => m.after)];
  const plies = history.map((m) => ({
    san: m.san, color: m.color, from: m.from, to: m.to, uci: m.from + m.to + (m.promotion || ''),
    legal: new Chess(m.before).moves().length,
    captured: m.captured,
    piece: m.piece,
    sacrifice: isSacrifice(m),
  }));
  plies.forEach((p, i) => { p.recapture = !!(p.captured && i > 0 && plies[i - 1].captured && plies[i - 1].to === p.to); });
  const tag = (name) => (pgn.match(new RegExp(`\\[${name} "([^"]*)"\\]`)) || [])[1] || '';
  const book = bookFromEcoUrl(tag('ECOUrl'), plies);
  plies.forEach((p) => { p.opening = book.name; });
  return {
    fens, plies, bookPlies: book.plies, result: tag('Result'),
    white: tag('White') || 'Blancs', black: tag('Black') || 'Noirs',
    whiteElo: tag('WhiteElo'), blackElo: tag('BlackElo'),
    finalCheckmate: chess.isCheckmate(), finalDrawn: chess.isStalemate() || chess.isInsufficientMaterial(),
    finalTurn: chess.turn(),
  };
}

const state = { exCache: new Map(), game: null, evals: [], report: null, cursor: 0, flipped: false, games: [], selectedUrl: null, username: '' };
const cache = new Map();
let job = null; // analyse en cours

const fx = createFx(store);
const cg = Chessground($('board'), {
  viewOnly: true, coordinates: true, animation: { enabled: true, duration: fx.duration() },
  drawable: { enabled: false, visible: true },
});
new ResizeObserver(() => cg.redrawAll()).observe($('board'));

function orientation() {
  const g = state.game;
  const u = state.username.toLowerCase();
  const asBlack = g && u && g.black.toLowerCase() === u;
  const base = asBlack ? 'black' : 'white';
  return state.flipped ? (base === 'white' ? 'black' : 'white') : base;
}

function sanOf(fen, uci) {
  try {
    const c = new Chess(fen);
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch { return uci; }
}

const moveNo = (i) => Math.floor(i / 2) + 1;
const moveLabel = (i, san) => `${moveNo(i)}${i % 2 ? '…' : '.'} ${fig(san)}`;

function renderBoard(boardOnly) {
  const { game, cursor, report } = state;
  if (!game) { renderVerdict(); renderGuide(); return; }
  const ply = cursor > 0 ? game.plies[cursor - 1] : null;
  const judged = ply && report ? report.moves[cursor - 1] : null;
  // Une suite est affichée sur l'échiquier : un simple rafraîchissement ne la remplace pas.
  if (state.preview && state.preview.game === game && state.preview.cursor === cursor && $('verdict').querySelector('.v-more')) return;
  state.preview = null;
  cg.set({
    fen: game.fens[cursor],
    orientation: orientation(),
    lastMove: ply ? [ply.from, ply.to] : undefined,
    turnColor: game.fens[cursor].split(' ')[1] === 'w' ? 'white' : 'black',
    check: ply && /[+#]$/.test(ply.san) ? (game.fens[cursor].split(' ')[1] === 'w' ? 'white' : 'black') : false,
  });
  const showBetter = judged && !judged.pending && !judged.playedBest && judged.kind !== 'forced' && judged.bestUci;
  cg.setAutoShapes(showBetter ? [{ orig: judged.bestUci.slice(0, 2), dest: judged.bestUci.slice(2, 4), brush: 'green' }] : []);

  const ev = state.evals[cursor];
  const w = ev ? winPct(scoreToCp(ev.score)) : 50;
  $('bar').style.setProperty('--w', `${w}%`);
  $('bar').classList.toggle('flip', orientation() === 'black');
  $('bar-value').textContent = ev ? formatScore(ev.score) : '…';
  const delta = $('bar-delta');
  if (judged && !judged.pending) {
    const d = Math.round(judged.moverAfter - judged.moverBefore);
    delta.hidden = false;
    delta.dataset.kind = judged.kind;
    delta.textContent = d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0';
  } else delta.hidden = true;
  renderBadge(ply, judged);
  if (boardOnly) return;
  renderVerdict();
  renderGuide();
}
const renderBoardOnly = () => renderBoard(true);

const inVariation = (i) => !!state.variation && i >= state.variation.base;

function renderBadge(ply, judged) {
  const b = $('badge');
  if (!ply || !judged || judged.pending) { b.hidden = true; return; }
  let col = ply.to.charCodeAt(0) - 97;
  let row = 8 - +ply.to[1];
  if (orientation() === 'black') { col = 7 - col; row = 7 - row; }
  b.hidden = false;
  b.dataset.kind = judged.kind;
  b.textContent = GLYPHS[judged.kind];
  b.title = LABELS[judged.kind];
  b.style.left = `${(col + 1) * 12.5 - 6.2}%`;
  b.style.top = `${row * 12.5 + 0.4}%`;
}

function explanation(i) {
  const { game, evals, report } = state;
  const move = report && report.moves[i];
  if (!move || move.pending) return null;
  if (state.exCache.has(i)) return state.exCache.get(i);
  // On évite de répéter la même formule que le coup précédent du même camp.
  const previous = i >= 2 ? explanation(i - 2) : null;
  const avoid = previous ? previous.key : null;
  try {
    const out = explainMove({
      fenBefore: game.fens[i], fenAfter: game.fens[i + 1], ply: game.plies[i], before: evals[i], after: evals[i + 1], move, index: i, prev: game.plies[i - 1], avoid,
    });
    state.exCache.set(i, out);
    return out;
  } catch (err) {
    console.warn(err);
    return { sentences: [], notes: [], line: '' };
  }
}

const display = (t) => t.replace(/\[\[(.+?)\]\]/g, (_, s) => fig(s));
const spoken = (t) => t.replace(/\[\[(.+?)\]\]/g, (_, s) => sanToSpeech(s));

function renderVerdict() {
  const { game, cursor, report } = state;
  const box = $('verdict');
  box.replaceChildren();
  box.removeAttribute('data-kind');
  if (!game) {
    box.append(h('p', { class: 'v-text' }, 'Choisis une partie dans l’onglet Parties.'));
    return;
  }
  if (cursor === 0) {
    box.append(h('p', { class: 'v-title' }, 'Position de départ'), h('p', { class: 'v-text' }, 'Navigue avec les flèches du clavier ou clique sur un coup.'));
    return;
  }
  const m = report ? report.moves[cursor - 1] : null;
  const title = moveLabel(cursor - 1, game.plies[cursor - 1].san);
  if (!m || m.pending) {
    box.append(h('p', { class: 'v-title' }, title), h('p', { class: 'v-text' }, job ? 'Analyse en cours…' : 'Ce coup n’a pas été analysé.'));
    return;
  }
  const ex = explanation(cursor - 1);
  box.dataset.kind = m.kind;
  box.append(h('div', { class: 'v-head' },
    h('span', { class: 'mark', 'data-kind': m.kind, 'aria-hidden': 'true' }, GLYPHS[m.kind]),
    h('p', { class: 'v-title' }, title, h('span', { class: 'v-kind' }, LABELS[m.kind])),
    voice.available && ex.sentences.length ? h('button', { type: 'button', class: 'ghost listen', onclick: () => speakCurrent() }, 'Écouter') : null));
  const body = h('div', { class: 'v-body' });
  ex.sentences.forEach((t) => body.append(h('p', { class: 'v-text' }, display(t))));
  if (!ex.sentences.length) body.append(h('p', { class: 'v-silent' }, 'Coup sans commentaire'));
  (ex.notes || []).forEach((t) => body.append(h('p', { class: 'v-note' }, display(t))));
  if (ex.details) {
    const more = h('details', { class: 'v-more' }, h('summary', {}, 'Comprendre ce coup'));
    more.addEventListener('toggle', () => {
      // Sur téléphone, le panneau s'ouvre sous l'échiquier, qui reste visible pour suivre les coups.
      box.style.setProperty('--sheet-top', `${Math.round($('board').getBoundingClientRect().bottom + 6)}px`);
      if (!more.open) leavePreview();
    });
    if (ex.details.key) more.append(h('p', { class: 'v-key' }, display(ex.details.key)));
    more.append(h('p', { class: 'v-hint' }, 'Touche un coup pour le voir sur l’échiquier.'));
    ex.details.blocks.forEach((b) => {
      const list = h('ol', { class: 'v-steps' });
      const show = (k) => showStep(b, k, list);
      list.append(...b.lines.map((l, k) => h('li', {}, h('button', { type: 'button', class: 'v-step', onclick: () => show(k) }, display(l.text)))));
      more.append(h('div', { class: 'v-blk' }, h('span', {}, b.title),
        h('button', { type: 'button', class: 'ghost v-play', onclick: () => playLine(b, list) }, '▶ Dérouler')));
      more.append(list);
      more.append(h('p', { class: 'v-tally' }, b.tally));
    });
    more.append(h('p', { class: 'v-tally' }, ex.details.compare));
    more.append(h('button', { type: 'button', class: 'ghost v-back', onclick: () => leavePreview() }, 'Revenir à la position de la partie'));
    body.append(more);
  }
  if (ex.line) body.append(h('p', { class: 'v-line' }, 'Suite prévue : ', display(ex.line)));
  if (state.variation && state.variation.ended && cursor === game.plies.length) body.append(h('p', { class: 'v-text' }, h('strong', {}, state.variation.ended)));
  const flag = h('button', { type: 'button', class: 'v-flag', onclick: () => reportComment(cursor - 1, ex, flag) }, 'Signaler ce commentaire');
  body.append(flag);
  box.append(body);
}

// Copie tout ce qu'il faut pour reproduire un commentaire douteux : position exacte, coup, texte, calculs du moteur.
async function reportComment(i, ex, btn) {
  const { game, report } = state;
  const m = report.moves[i];
  const slim = (ev) => ev && { score: ev.score, best: ev.best, pv: ev.pv, second: ev.second, threat: ev.threat, ifTaken: ev.ifTaken, afterRef: ev.afterRef, noRecapture: ev.noRecapture };
  const text = `Signalement Chess Analyzer\n${JSON.stringify({
    coup: `${Math.floor(i / 2) + 1}${game.plies[i].color === 'w' ? '.' : '…'}${game.plies[i].san}`,
    classement: m.kind,
    commentaire: [...ex.sentences, ...ex.notes].join(' ').replace(/\[\[|\]\]/g, ''),
    fen: game.fens[i], uci: game.plies[i].uci, prev: game.plies[i - 1] ? game.plies[i - 1].uci : null,
    profondeur: +$('depth').value, rejoue: !!state.variation,
    avant: slim(state.evals[i]), apres: slim(state.evals[i + 1]),
  })}`;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text; document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  btn.textContent = ok ? 'Copié : colle-le dans la conversation' : 'Copie impossible sur ce navigateur';
  setTimeout(() => { if (btn.isConnected) btn.textContent = 'Signaler ce commentaire'; }, 4000);
}

/* ---------- Suites à voir sur l'échiquier ---------- */

let lineTimer = 0;
function showStep(block, k, list) {
  const { game, cursor } = state;
  const l = block.lines[k];
  const was = state.preview;
  // Depuis un autre endroit que le coup précédent de la même suite : on repart du coup d'avant, sans animation,
  // pour que seul le coup touché se déplace.
  const prevFen = k > 0 ? block.lines[k - 1].fen : block.startFen;
  if (!was || was.fen !== prevFen) {
    cg.set({ animation: { enabled: false } });
    cg.set({ fen: prevFen, lastMove: undefined, check: false });
    cg.set({ animation: { enabled: true } });
  }
  const white = l.fen.split(' ')[1] === 'w';
  state.preview = { game, cursor, fen: l.fen };
  cg.set({ fen: l.fen, lastMove: [l.from, l.to], turnColor: white ? 'white' : 'black', check: /[+#]$/.test(l.san) ? (white ? 'white' : 'black') : false });
  cg.setAutoShapes([]);
  $('badge').hidden = true;
  fx.played({ san: l.san, to: l.to, fen: l.fen, el: $('board'), orientation: orientation() });
  $('verdict').querySelectorAll('.v-step.on').forEach((b) => b.classList.remove('on'));
  const btn = list.children[k].firstChild;
  btn.classList.add('on');
  btn.scrollIntoView({ block: 'nearest' });
  $('verdict').classList.add('previewing');
}

function playLine(block, list) {
  clearInterval(lineTimer);
  let k = 0;
  const step = () => {
    if (!list.isConnected || k >= block.lines.length) { clearInterval(lineTimer); return; }
    showStep(block, k, list);
    k += 1;
  };
  step();
  lineTimer = setInterval(step, 1100);
}

function leavePreview() {
  clearInterval(lineTimer);
  $('verdict').classList.remove('previewing');
  $('verdict').querySelectorAll('.v-step.on').forEach((b) => b.classList.remove('on'));
  if (!state.preview) return;
  state.preview = null;
  cg.set({ animation: { enabled: false } });
  renderBoardOnly();
  cg.set({ animation: { enabled: true } });
}

let movesSig = '';
function renderMoves() {
  const { game, report, cursor } = state;
  const list = $('moves');
  const strip = $('strip');
  const sig = game ? `${game.plies.length}|${state.variation ? state.variation.base : -1}|${report ? report.moves.map((x) => (x.pending ? '' : x.kind)).join(',') : ''}` : '';
  if (game && sig === movesSig) { markCursor(list, strip, cursor); return; }
  movesSig = sig;
  const top = list.scrollTop;
  list.replaceChildren();
  strip.replaceChildren();
  if (!game) return;
  game.plies.forEach((p, i) => {
    if (i % 2 === 0) list.append(h('span', { class: 'num' }, `${moveNo(i)}.`));
    else if (i === 0) list.append(h('span', { class: 'num' }, '1.'), h('span', {}));
    const m = report ? report.moves[i] : null;
    const kind = m && !m.pending ? m.kind : '';
    strip.append(h('button', {
      type: 'button', class: `chip${inVariation(i) ? ' var' : ''}`, 'data-i': i + 1, onclick: () => go(i + 1, true),
    }, i % 2 === 0 ? h('span', { class: 'num' }, `${moveNo(i)}.`) : null, fig(p.san), kind ? h('span', { class: 'mark tiny', 'data-kind': kind }, GLYPHS[kind]) : null));
    list.append(h('button', {
      type: 'button', class: `mv${inVariation(i) ? ' var' : ''}`, 'data-i': i + 1, 'data-kind': kind || null, onclick: () => go(i + 1, true),
      'aria-label': `${moveLabel(i, p.san)}${kind ? ` : ${LABELS[kind]}` : ''}`,
    }, fig(p.san), kind ? h('span', { class: 'mark tiny', 'data-kind': kind, 'aria-hidden': 'true' }, GLYPHS[kind]) : null));
  });
  list.scrollTop = top;
  markCursor(list, strip, cursor);
}

// Déplace seulement la surbrillance du coup courant, sans reconstruire les listes.
function markCursor(list, strip, cursor) {
  [list, strip].forEach((box) => {
    const was = box.querySelector('.on');
    if (was && +was.dataset.i !== cursor) was.classList.remove('on');
    const el = cursor > 0 ? box.querySelector(`[data-i="${cursor}"]`) : null;
    if (el) el.classList.add('on');
  });
  const onChip = strip.querySelector('.on');
  if (onChip && strip.offsetParent) strip.scrollLeft = onChip.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + onChip.offsetWidth / 2;
  const on = list.offsetParent ? list.querySelector('.on') : null;
  if (on) {
    const a = on.offsetTop - list.offsetTop;
    if (a < list.scrollTop) list.scrollTop = a - 8;
    else if (a + on.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = a - list.clientHeight + on.offsetHeight + 8;
  }
}

function renderStats() {
  const { game, report } = state;
  const body = $('stats');
  body.replaceChildren();
  if (!game || !report) return;
  $('p-white').textContent = game.white + (game.whiteElo ? ` (${game.whiteElo})` : '');
  $('p-black').textContent = game.black + (game.blackElo ? ` (${game.blackElo})` : '');
  $('m-white').textContent = $('p-white').textContent;
  $('m-black').textContent = $('p-black').textContent;
  $('p-result').textContent = game.result.replace('1/2-1/2', '½–½').replace('-', '–');
  const { white: w, black: b } = state.variation ? state.variation.mainReport : report;
  const acc = (s) => (s.accuracy == null ? '–' : `${s.accuracy.toFixed(1)} %`);
  body.append(h('tr', {}, h('td', {}, acc(w)), h('th', { scope: 'row' }, 'Précision'), h('td', {}, acc(b))));
  KINDS.forEach((k) => body.append(h('tr', {},
    h('td', {}, w.counts[k]),
    h('th', { scope: 'row' }, h('span', { class: 'mark tiny', 'data-kind': k, 'aria-hidden': 'true' }, GLYPHS[k]), ` ${LABELS[k]}`),
    h('td', {}, b.counts[k]))));
}

/* ---------- Courbe ---------- */

const PAD = { l: 8, r: 8, t: 8, b: 8 };
const SVGNS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

function chartScale() {
  const svg = $('chart');
  const W = svg.clientWidth || 340;
  const H = svg.clientHeight || 140;
  const n = state.game ? state.game.plies.length : 1;
  return {
    W, H,
    x: (i) => PAD.l + (i / n) * (W - PAD.l - PAD.r),
    y: (p) => PAD.t + (1 - p / 100) * (H - PAD.t - PAD.b),
    inv: (px) => Math.max(0, Math.min(n, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * n))),
  };
}

function renderChart() {
  const svg = $('chart');
  svg.replaceChildren();
  const { game, evals, report, cursor } = state;
  if (!game) return;
  const { W, H, x, y } = chartScale();
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.append(s('line', { x1: PAD.l, x2: W - PAD.r, y1: y(50), y2: y(50), class: 'c-mid' }));

  const pts = [];
  for (let i = 0; i < evals.length && evals[i]; i += 1) pts.push([x(i), y(winPct(scoreToCp(evals[i].score)))]);
  if (pts.length) {
    const line = pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' L');
    svg.append(s('path', { d: `M${pts[0][0]},${y(0)} L${line} L${pts[pts.length - 1][0]},${y(0)} Z`, class: 'c-area' }));
    svg.append(s('path', { d: `M${line}`, class: 'c-line' }));
  }
  svg.append(s('line', { x1: x(cursor), x2: x(cursor), y1: PAD.t, y2: H - PAD.b, class: 'c-cursor', id: 'c-cursor' }));
  if (report) {
    const R = { inaccuracy: 4, mistake: 4.5, miss: 4.5, blunder: 5.5 };
    report.moves.forEach((m, i) => {
      if (m.pending || !R[m.kind] || !evals[i + 1]) return;
      svg.append(s('circle', { cx: x(i + 1), cy: y(winPct(scoreToCp(evals[i + 1].score))), r: R[m.kind], class: `c-pt ${m.kind}` }));
    });
  }
}

function moveChartCursor() {
  const line = $('c-cursor');
  if (!line || !state.game) { renderChart(); return; }
  const px = chartScale().x(state.cursor);
  line.setAttribute('x1', px); line.setAttribute('x2', px);
}

function chartHover(e) {
  if (!state.game) return;
  const rect = $('chart').getBoundingClientRect();
  const i = chartScale().inv(e.clientX - rect.left);
  const ev = state.evals[i];
  const tip = $('tip');
  if (!ev) { tip.hidden = true; return; }
  tip.replaceChildren(h('strong', {}, formatScore(ev.score)), h('span', {}, i === 0 ? 'Départ' : moveLabel(i - 1, state.game.plies[i - 1].san)));
  tip.hidden = false;
  const px = e.clientX - rect.left;
  tip.style.left = `${Math.min(Math.max(px - 40, 0), rect.width - 96)}px`;
}

/* ---------- Navigation ---------- */

function playedFx(i) {
  const ply = state.game.plies[i];
  fx.played({ san: ply.san, to: ply.to, fen: state.game.fens[i + 1], el: $('board'), orientation: orientation() });
}

function go(i, fromUser) {
  if (!state.game) return;
  const next = Math.max(0, Math.min(state.game.plies.length, i));
  const moved = next !== state.cursor;
  const stepped = next === state.cursor + 1;
  state.cursor = next;
  clearInterval(lineTimer);
  state.preview = null;
  $('verdict').classList.remove('previewing');
  renderBoard();
  renderMoves();
  moveChartCursor();
  if (fromUser && stepped) playedFx(next - 1);
  if (fromUser && moved) {
    if (voice.auto) speakCurrent(); else voice.stop();
  }
}

/* ---------- Voix ---------- */

const voice = {
  synth: window.speechSynthesis || null,
  chosen: null,
  auto: store.get('voice') !== 'off',
  primed: false,
  run: 0,
  get available() { return !!this.synth; },
  rate: +(store.get('voice-rate') || 1.25),
  pitch: +(store.get('voice-pitch') || 1),
  list: [],
  pick() {
    if (!this.synth) return;
    const lang = (v) => v.lang.toLowerCase().replace('_', '-');
    this.list = this.synth.getVoices().filter((v) => lang(v).startsWith('fr'));
    const saved = store.get('voice-uri');
    this.chosen = this.list.find((v) => v.voiceURI === saved)
      || this.list.find((v) => lang(v) === 'fr-fr' && v.default) || this.list.find((v) => lang(v) === 'fr-fr') || this.list[0] || null;
    renderVoiceList();
  },
  // Safari exige un premier appel pendant un geste de l'utilisateur.
  prime() {
    if (!this.synth || this.primed) return;
    this.primed = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    if (this.chosen) u.voice = this.chosen;
    this.synth.speak(u);
  },
  stop() {
    if (!this.synth) return;
    this.run += 1;
    this.current = null;
    if (this.synth.speaking || this.synth.pending) { this.synth.cancel(); this.cancelledAt = performance.now(); }
  },
  say(sentences) {
    if (!this.synth) return;
    this.stop();
    if (!sentences.length) return;
    if (!this.chosen) this.pick();
    if (this.synth.resume) this.synth.resume(); // un navigateur peut rester en pause après une mise en arrière-plan
    const run = this.run;
    // Enchaîner speak() juste après cancel() peut faire perdre la phrase : on laisse un court délai.
    const wait = Math.max(0, 140 - (performance.now() - (this.cancelledAt || -1e6)));
    const start = () => this.speakFrom(sentences, 0, 0, run);
    if (wait > 0) setTimeout(start, wait); else start();
  },
  speakFrom(sentences, i, attempt, run) {
    if (run !== this.run || i >= sentences.length) return;
    const u = new SpeechSynthesisUtterance(sentences[i]);
    this.current = u; // référence gardée : sans elle, la fin de phrase peut ne jamais être signalée
    u.lang = 'fr-FR';
    if (this.chosen) u.voice = this.chosen;
    u.rate = this.rate; u.pitch = this.pitch;
    let started = false;
    u.onstart = () => { started = true; };
    const next = () => { if (this.current === u && run === this.run) this.speakFrom(sentences, i + 1, 0, run); };
    u.onend = next;
    u.onerror = (e) => { if (e.error !== 'canceled' && e.error !== 'interrupted') next(); };
    this.synth.speak(u);
    setTimeout(() => {
      if (started || this.current !== u || run !== this.run || attempt >= 2) return;
      this.current = null;
      this.synth.cancel();
      if (this.synth.resume) this.synth.resume();
      setTimeout(() => this.speakFrom(sentences, i, attempt + 1, run), 140);
    }, 1800);
  },
};

function speakCurrent() {
  if (state.cursor === 0) { voice.stop(); return; }
  const ex = explanation(state.cursor - 1);
  if (!ex) { voice.stop(); return; }
  voice.say(ex.sentences.map((t) => spoken(t.replace(/ : \[\[.*$/, '.'))));
}

const REGION = { 'fr-fr': 'France', 'fr-ca': 'Québec', 'fr-be': 'Belgique', 'fr-ch': 'Suisse' };

function renderVoiceList() {
  const sel = $('voice-name');
  sel.replaceChildren(...voice.list.map((v) => {
    const region = REGION[v.lang.toLowerCase().replace('_', '-')] || v.lang;
    return h('option', { value: v.voiceURI, selected: voice.chosen === v ? 'selected' : null }, `${v.name} · ${region}`);
  }));
  $('voice-settings').hidden = !voice.list.length;
  $('voice-empty').hidden = !!voice.list.length;
}

function renderVoiceToggle() {
  const b = $('voice');
  b.hidden = !voice.available;
  b.setAttribute('aria-pressed', voice.auto ? 'true' : 'false');
  b.textContent = voice.auto ? 'Voix : oui' : 'Voix : non';
}

// Une explication dépend des évaluations autour du coup et de la précédente du même camp :
// quand l'évaluation n° k change, seules les explications à partir du coup k − 1 sont à refaire.
function forgetFrom(k) {
  for (const i of [...state.exCache.keys()]) if (i >= k - 1) state.exCache.delete(i);
}

// Pendant l'analyse, un seul rendu par quart de seconde, et aucun quand l'écran est caché.
let redrawSoon = false;
function refreshFrom(k) {
  forgetFrom(k);
  if (redrawSoon) return;
  redrawSoon = true;
  setTimeout(() => requestAnimationFrame(() => { redrawSoon = false; redraw(); }), 250);
}

function refreshAll() {
  state.exCache = new Map();
  redraw();
}

function redraw() {
  state.report = state.game ? buildReport(state.game.plies, state.evals, state.game.bookPlies) : null;
  renderStats();
  renderBoard();
  renderMoves();
  renderChart();
}

// Prépare les explications pendant les temps morts : sauter loin dans la partie reste instantané.
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(() => fn(null), 40));
function warmExplanations() {
  const g = state.game;
  let i = 0;
  const step = (dl) => {
    if (state.game !== g || job || state.variation) return;
    do { explanation(i); i += 1; } while (i < g.plies.length && (dl ? dl.timeRemaining() > 6 : i % 3));
    if (i < g.plies.length) idle(step);
  };
  idle(step);
}

/* ---------- Analyse ---------- */

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

function terminalScore(game) {
  if (game.finalCheckmate) return { type: 'mate', value: 0, mated: game.finalTurn === 'w' ? 'white' : 'black' };
  if (game.finalDrawn) return { type: 'cp', value: 0 };
  return null;
}

function stopJob() {
  if (job) { job.cancelled = true; job.engines.forEach((e) => e.stop()); job = null; }
  $('progress').hidden = true;
}

// Répartit des positions entre les moteurs, par blocs de positions voisines :
// chaque moteur réutilise ce qu'il vient de calculer sur la position précédente.
async function share(engines, items, block, me, work) {
  let next = 0;
  await Promise.all(engines.map(async (engine) => {
    while (next < items.length && !me.cancelled) {
      const start = next;
      next += block;
      for (const item of items.slice(start, start + block)) {
        if (me.cancelled) return;
        await work(engine, item);
      }
    }
  }));
}

async function analyze(game, key) {
  stopJob();
  const depth = +$('depth').value;
  const cacheKey = `${key}@${depth}`;
  if (cache.has(cacheKey)) {
    state.evals = cache.get(cacheKey);
    setStatus(`Analyse à la profondeur ${depth}, déjà calculée.`);
    refreshAll();
    warmExplanations();
    return;
  }
  const n = game.fens.length;
  const count = Math.max(1, Math.min(POOL_SIZE, Math.floor(n / 16)));
  const engines = Array.from({ length: count }, () => new Engine());
  const me = { engines, cancelled: false };
  job = me;
  state.evals = [];
  $('progress').hidden = false;
  $('bar-fill').style.width = '0%';
  refreshAll();
  const t0 = performance.now();
  try {
    await Promise.all(engines.map((e) => e.init()));
    let done = 0;
    // Chaque moteur prend une portion continue de la partie et calcule d'abord la position
    // qui la précède : il démarre avec la même mémoire qu'un moteur unique arrivé là.
    const span = Math.ceil(n / count);
    await Promise.all(engines.map(async (engine, k) => {
      if (k > 0) await engine.evaluate(game.fens[k * span - 1], depth);
    }));
    await share(engines, [...Array(n).keys()], span, me, async (engine, i) => {
      const white = game.fens[i].split(' ')[1] === 'w';
      const end = i === n - 1 ? terminalScore(game) : null;
      let ev;
      if (end) ev = { score: end, best: null };
      else {
        const r = await engine.evaluate(game.fens[i], depth);
        if (me.cancelled) return;
        ev = { score: toWhiteScore(r.score, white), best: r.best, pv: r.pv };
      }
      state.evals[i] = ev;
      done += 1;
      $('bar-fill').style.width = `${(done / n) * 100}%`;
      $('progress-text').textContent = `Analyse : position ${done} sur ${n}`;
      refreshFrom(i);
    });
    if (me.cancelled) return;
    await refine(game, engines[0], depth, me);
    if (me.cancelled) return;
    await findAlternatives(game, engines, depth, me);
    if (me.cancelled) return;
    await deepen(game, engines, depth, me);
    if (me.cancelled) return;
    $('progress-text').textContent = 'Recherche des raisons de chaque coup…';
    const todo = [];
    for (let i = game.bookPlies; i < game.plies.length; i += 1) if (game.plies[i].legal >= 2) todo.push(i);
    await share(engines, todo, 4, me, (engine, i) => computeThreat(engine, game.fens[i], state.evals[i]));
    if (me.cancelled) return;
    cache.set(cacheKey, state.evals);
    window.__lastAnalysis = { evals: state.evals, ms: performance.now() - t0, engines: count };
    setStatus(`Analyse terminée à la profondeur ${depth} en ${Math.round((performance.now() - t0) / 1000)} s.`);
  } catch (err) {
    if (!me.cancelled) setStatus(`Le moteur n’a pas pu démarrer (${err.message}). Recharge la page, puis réessaie.`, true);
  } finally {
    if (job === me) { job = null; $('progress').hidden = true; engines.forEach((e) => e.stop()); refreshAll(); warmExplanations(); }
  }
}

// À profondeur fixe, le moteur peut recommander un coup dont la position suivante révèle
// une catastrophe (mat manqué à l'horizon). On re-cherche alors parmi les autres coups.
async function refine(game, engine, depth, me) {
  const pctFor = (ev, color) => { const w = winPct(scoreToCp(ev.score)); return color === 'w' ? w : 100 - w; };
  for (let i = game.plies.length - 1; i >= 0; i -= 1) {
    const ply = game.plies[i];
    const here = state.evals[i];
    const next = state.evals[i + 1];
    if (here.best !== ply.uci || ply.legal < 2) continue;
    if (pctFor(here, ply.color) - pctFor(next, ply.color) < 10) continue;
    $('progress-text').textContent = 'Vérification des coups douteux…';
    const others = new Chess(game.fens[i]).moves({ verbose: true }).map((x) => x.from + x.to + (x.promotion || '')).filter((u) => u !== ply.uci);
    const r = await engine.evaluate(game.fens[i], depth, others);
    if (me.cancelled) return;
    const alt = { score: toWhiteScore(r.score, ply.color === 'w'), best: r.best, pv: r.pv };
    state.evals[i] = pctFor(alt, ply.color) > pctFor(next, ply.color)
      ? alt
      : { score: next.score, best: ply.uci, pv: [ply.uci, ...(next.pv || [])] };
  }
}

// Que menacerait le meilleur coup si l'adversaire passait son tour ? On rejoue le même camp.
async function computeThreat(engine, fen, ev) {
  if (!ev || !ev.best || ev.threat !== undefined) return;
  ev.threat = null;
  const c = new Chess(fen);
  c.move({ from: ev.best.slice(0, 2), to: ev.best.slice(2, 4), promotion: ev.best[4] });
  if (c.isGameOver() || c.inCheck()) return;
  const parts = c.fen().split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const flipped = parts.join(' ');
  const r = await engine.evaluate(flipped, THREAT_DEPTH);
  ev.threat = { fen: flipped, score: r.score, pv: r.pv };
}

// Évalue le meilleur coup autre que celui joué : critère des coups brillants et décisifs.
async function findAlternatives(game, engines, depth, me) {
  const report = buildReport(game.plies, state.evals, game.bookPlies);
  $('progress-text').textContent = 'Recherche des coups brillants et décisifs…';
  const todo = [];
  for (let i = 0; i < game.plies.length; i += 1) {
    const ply = game.plies[i];
    const m = report.moves[i];
    if (m.pending || m.kind === 'book' || ply.legal < 2 || m.loss >= 2) continue;
    if (!ply.sacrifice && (ply.recapture || m.moverAfter < 40)) continue;
    todo.push(i);
  }
  await share(engines, todo, 4, me, async (engine, i) => {
    const ply = game.plies[i];
    const others = new Chess(game.fens[i]).moves({ verbose: true }).map((x) => x.from + x.to + (x.promotion || '')).filter((u) => u !== ply.uci);
    const r = await engine.evaluate(game.fens[i], depth, others);
    if (me.cancelled) return;
    state.evals[i].second = toWhiteScore(r.score, ply.color === 'w');
  });
}

// Pour les coups à expliquer : prolonge les variantes trop courtes et, quand le coup conseillé
// offre une pièce que la variante ne prend pas, calcule la suite où l'adversaire la prend.
async function deepen(game, engines, depth, me) {
  const report = buildReport(game.plies, state.evals, game.bookPlies);
  $('progress-text').textContent = 'Calcul des suites à expliquer…';
  const todo = [];
  report.moves.forEach((m, i) => {
    if (m.pending || m.kind === 'book' || game.plies[i].legal < 2) return;
    if ((!m.playedBest && m.loss >= 5) || ['brilliant', 'great'].includes(m.kind)) todo.push(i);
  });
  const d = Math.max(10, depth - 2);
  const extend = async (engine, idx) => {
    const ev = state.evals[idx];
    if (!ev || !ev.pv || ev.extended) return;
    ev.extended = true;
    for (let k = 0; k < 2; k += 1) {
      const steps = walk(game.fens[idx], ev.pv, 30);
      if (!steps.length || steps.length >= 9) break;
      const end = steps[steps.length - 1].fen;
      if (new Chess(end).isGameOver()) break;
      const r = await engine.evaluate(end, d);
      if (me.cancelled || !r.pv.length) return;
      ev.pv = [...ev.pv.slice(0, steps.length), ...r.pv];
    }
  };
  // Sondes « pourquoi pas ? » : le moteur calcule lui-même les réponses que le commentaire affirmerait.
  const ORDER = 'pnbrqk';
  const probe = async (engine, i, ev) => {
    const nx = state.evals[i + 1];
    if (report.moves[i].playedBest || !ev.best || !nx || !nx.pv || !nx.pv.length) return;
    const rU = nx.pv[0];
    // 1. La réponse qui punit le coup joué marche-t-elle encore après le coup conseillé ?
    const cb = new Chess(game.fens[i]);
    cb.move({ from: ev.best.slice(0, 2), to: ev.best.slice(2, 4), promotion: ev.best[4] });
    if (!cb.isGameOver()) {
      if (cb.moves({ verbose: true }).some((x) => x.from + x.to + (x.promotion || '') === rU)) {
        const r = await engine.evaluate(cb.fen(), d, [rU]);
        if (me.cancelled) return;
        ev.afterRef = { uci: rU, legal: true, score: toWhiteScore(r.score, cb.turn() === 'w'), pv: r.pv };
      } else ev.afterRef = { uci: rU, legal: false };
    }
    // 2. L'adversaire prend, et la suite ne reprend pas : que se passe-t-il si on reprend ?
    const cr = new Chess(game.fens[i + 1]);
    const rm = cr.move({ from: rU.slice(0, 2), to: rU.slice(2, 4), promotion: rU[4] });
    if (!rm.captured || (nx.pv[1] && nx.pv[1].slice(2, 4) === rm.to)) return;
    const recs = cr.moves({ verbose: true }).filter((x) => x.to === rm.to && x.captured).sort((a, b) => ORDER.indexOf(a.piece) - ORDER.indexOf(b.piece));
    if (!recs.length) return;
    const c2 = new Chess(recs[0].after);
    if (c2.isGameOver()) return;
    const r2 = await engine.evaluate(recs[0].after, d);
    if (me.cancelled) return;
    nx.noRecapture = { uci: recs[0].from + recs[0].to + (recs[0].promotion || ''), pv: r2.pv, score: toWhiteScore(r2.score, c2.turn() === 'w') };
  };
  await share(engines, todo, 2, me, async (engine, i) => {
    await extend(engine, i);
    if (me.cancelled) return;
    if (!report.moves[i].playedBest) await extend(engine, i + 1);
    if (me.cancelled) return;
    const ev = state.evals[i];
    await probe(engine, i, ev);
    if (me.cancelled) return;
    const first = walk(game.fens[i], ev.pv, 2);
    if (!first[0] || first[0].m.san.endsWith('#')) return;
    const ep = enPrise(first[0].m);
    const accepted = first[1] && first[1].m.captured && first[1].m.to === first[0].m.to;
    if (!ep || accepted) return;
    const r = await engine.evaluate(first[0].fen, d, ep.caps);
    if (me.cancelled) return;
    let pv = r.pv;
    const sub = walk(first[0].fen, pv, 30);
    if (sub.length && sub.length < 8 && !new Chess(sub[sub.length - 1].fen).isGameOver()) {
      const more = await engine.evaluate(sub[sub.length - 1].fen, d);
      if (me.cancelled) return;
      pv = [...pv.slice(0, sub.length), ...more.pv];
    }
    ev.ifTaken = { pv, score: toWhiteScore(r.score, first[0].fen.split(' ')[1] === 'w') };
  });
}

/* ---------- Reprise : toi plus fort, l'adversaire à son Elo ---------- */

const VARIATION_MAX_PLIES = 300;
const THREAT_DEPTH = 8;
let maiaModule = null;

async function ensureMaia(onProgress) {
  const base = new URL('maia/', location.href).href;
  maiaModule = maiaModule || await import(`${base}maia.mjs`);
  await maiaModule.load(base, onProgress);
  return maiaModule;
}

async function loadMaia(v) {
  await ensureMaia((pct) => { if (v.active) { v.loadPct = pct; renderGuide(); } });
  v.loadPct = null;
}

const CANDIDATE_DEPTH = 10;
const CANDIDATE_COUNT = 8;
const DEFAULT_ELO = 1500;

function endText(c) {
  if (c.isCheckmate()) return `Mat : les ${c.turn() === 'w' ? 'Noirs' : 'Blancs'} gagnent.`;
  if (c.isStalemate()) return 'Pat : partie nulle.';
  if (c.isInsufficientMaterial()) return 'Partie nulle : matériel insuffisant.';
  if (c.isThreefoldRepetition()) return 'Partie nulle par répétition.';
  if (c.isDraw()) return 'Partie nulle : règle des 50 coups.';
  return null;
}

function replayTo(game, n) {
  const c = new Chess(game.fens[0]);
  game.plies.slice(0, n).forEach((p) => c.move({ from: p.from, to: p.to, promotion: p.uci[4] }));
  return c;
}

function startVariation() {
  if (job || state.variation || !state.game) return;
  const base = state.cursor;
  const ev = state.evals[base];
  if (!ev || !ev.best) return;
  voice.stop();
  const main = { game: state.game, evals: state.evals, cursor: base };
  const g = main.game;
  const u = state.username.toLowerCase();
  const turn = g.fens[base].split(' ')[1];
  const me = u && g.white.toLowerCase() === u ? 'w' : u && g.black.toLowerCase() === u ? 'b' : turn;
  const rating = (c) => +(c === 'w' ? g.whiteElo : g.blackElo) || DEFAULT_ELO;
  const v = {
    base, main, me, engine: new Engine(), active: true, ended: null, busy: false, pending: null,
    oppElo: rating(me === 'w' ? 'b' : 'w'),
    myElo: MAIA_TOP,
    myRating: rating(me), loadPct: 0, maiaFailed: false,
    mainReport: buildReport(g.plies, main.evals, g.bookPlies),
    mainEx: new Map(state.exCache),
  };
  state.variation = v;
  state.game = { ...g, fens: g.fens.slice(0, base + 1), plies: g.plies.slice(0, base), bookPlies: Math.min(g.bookPlies, base) };
  state.evals = main.evals.slice(0, base + 1);
  v.ready = Promise.all([v.engine.init(), loadMaia(v).catch(() => { v.maiaFailed = true; v.loadPct = null; })]);
  v.ready.then(() => { if (v.active) renderGuide(); }).catch(() => {});
  v.pending = prepareNext(v);
  v.pending.catch(() => {});
  forgetFrom(base);
  redraw();
}

// Calcule à l'avance le coup suivant : la touche › répond alors tout de suite.
// Ton côté est joué par Maia à son plus fort : le réglage où elle rejoint le plus souvent le choix
// de Stockfish (mesuré sur 240 positions : plafond vers 2400, au-delà elle ne progresse plus),
// sans part de hasard. L'adversaire garde son Elo réel et ses coups humains.
const MAIA_TOP = 2400;
const MAIA_TOP_TEMPERATURE = 0.01;
// Même à ce niveau Maia peut se tromper lourdement : au-delà de ce seuil (points de chance de gain
// perdus, celui d'une « erreur »), ton côté joue le coup du moteur à la place.
const MY_MAX_LOSS = 10;

async function prepareNext(v) {
  await v.ready;
  const { engine } = v;
  const game = state.game;
  const n = game.plies.length;
  const c = replayTo(game, n);
  const ucis = game.plies.map((p) => p.uci);
  const elo = c.turn() === v.me ? v.myElo : v.oppElo;
  await computeThreat(engine, game.fens[n], state.evals[n]);
  let uci = state.evals[n].best;
  if (elo != null) {
    const mine = c.turn() === v.me;
    if (!v.maiaFailed) {
      // L'adversaire joue comme à son Elo ; ton côté choisit plus souvent le coup principal.
      const temperature = mine ? MAIA_TOP_TEMPERATURE : 1;
      const other = mine ? v.oppElo : (v.myElo || v.myRating);
      uci = await maiaModule.move(c.fen(), elo, other, temperature);
    } else {
      const list = await engine.candidates(game.fens[0], ucis, CANDIDATE_DEPTH, CANDIDATE_COUNT);
      if (list.length) uci = pickHuman(list, elo);
    }
  }
  const legal = c.moves().length;
  const prev = game.plies[n - 1];
  const mine = c.turn() === v.me;
  const play = async (uci) => {
    const c = replayTo(game, n);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const ply = {
      san: m.san, color: m.color, from: m.from, to: m.to, uci: m.from + m.to + (m.promotion || ''), legal, captured: m.captured, piece: m.piece,
      sacrifice: isSacrifice(m), recapture: !!(m.captured && prev && prev.captured && prev.to === m.to), opening: '',
    };
    let ended = endText(c);
    let ev;
    if (ended) {
      ev = { score: c.isCheckmate() ? { type: 'mate', value: 0, mated: c.turn() === 'w' ? 'white' : 'black' } : { type: 'cp', value: 0 }, best: null };
    } else {
      const r = await engine.evaluate(game.fens[0], +$('depth').value, null, [...ucis, ply.uci]);
      ev = { score: toWhiteScore(r.score, c.turn() === 'w'), best: r.best, pv: r.pv };
      if (n + 1 - v.base >= VARIATION_MAX_PLIES) ended = `Arrêt après ${VARIATION_MAX_PLIES} coups.`;
    }
      return { ply, fen: c.fen(), ev, ended };
  };
  let out = await play(uci);
  const best = state.evals[n].best;
  if (mine && best && uci !== best) {
    const w0 = winPct(scoreToCp(state.evals[n].score)); const w1 = winPct(scoreToCp(out.ev.score));
    const loss = v.me === 'w' ? w0 - w1 : w1 - w0;
    if (loss >= MY_MAX_LOSS) out = await play(best);
  }
  return out;
}

async function advanceVariation() {
  const v = state.variation;
  if (!v || v.busy || v.ended) return;
  v.busy = true;
  renderGuide();
  try {
    const next = await v.pending;
    if (!v.active) return;
    state.game.plies.push(next.ply);
    state.game.fens.push(next.fen);
    state.evals.push(next.ev);
    v.ended = next.ended;
    v.busy = false;
    state.cursor = state.game.plies.length;
    forgetFrom(state.cursor);
    redraw();
    playedFx(state.cursor - 1);
    if (voice.auto) speakCurrent(); else voice.stop();
    if (v.ended) v.engine.stop();
    else { v.pending = prepareNext(v); v.pending.catch(() => {}); }
  } catch (err) {
    if (v.active) { v.busy = false; v.ended = 'Le moteur s’est arrêté. Reviens à la partie, puis réessaie.'; refreshAll(); }
  }
}

function stepForward() {
  const v = state.variation;
  if (v && !v.ended && state.cursor === state.game.plies.length) advanceVariation();
  else go(state.cursor + 1, true);
}

function exitVariation() {
  const v = state.variation;
  if (!v) return;
  v.active = false;
  v.engine.stop();
  state.variation = null;
  state.game = v.main.game;
  state.evals = v.main.evals;
  state.cursor = v.main.cursor;
  state.exCache = v.mainEx;
  voice.stop();
  redraw();
}

function renderGuide() {
  const v = state.variation;
  $('guide-start').hidden = !!v;
  $('guide-run').hidden = !v;
  if (!v) {
    const ev = state.game ? state.evals[state.cursor] : null;
    $('guide-start').disabled = !!job || !ev || !ev.best;
    return;
  }
  const levels = `Toi : niveau maximal · Adversaire ${v.oppElo}`;
  const loading = v.loadPct != null && !v.maiaFailed ? `Modèle humain : ${v.loadPct} %` : '';
  const note = v.maiaFailed ? ' · modèle humain indisponible' : '';
  $('guide-text').textContent = v.ended || loading || (v.busy ? 'Le coup arrive…' : `${levels}${note} · touche ›`);
}

function openGame(pgn, key, { run = true, url = null } = {}) {
  let game;
  try { game = parseGame(pgn); } catch {
    setStatus('Ce PGN est illisible. Vérifie qu’il contient bien la liste des coups.', true);
    return;
  }
  if (!FAIR_RESULTS.includes(game.result)) {
    setStatus('Cette partie n’a pas de résultat final. L’analyse est réservée aux parties terminées.', true);
    return;
  }
  stopJob();
  exitVariation();
  state.game = game;
  state.evals = [];
  state.cursor = 0;
  state.selectedUrl = url;
  state.key = key;
  voice.stop();
  setStatus('');
  renderGames();
  refreshAll();
  showAnalysis();
  if (run) analyze(game, key);
}

/* ---------- Chess.com ---------- */

async function getJson(url) {
  let res;
  try { res = await fetch(url); } catch {
    throw new Error('Impossible de joindre Chess.com. Vérifie ta connexion, puis réessaie.');
  }
  if (res.status === 404) throw Object.assign(new Error('notfound'), { code: 404 });
  if (res.status === 429) throw new Error('Chess.com limite les requêtes pour le moment. Réessaie dans une minute.');
  if (!res.ok) throw new Error(`Chess.com a répondu avec une erreur (${res.status}). Réessaie plus tard.`);
  return res.json();
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const CLASS = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Daily' };

async function loadPlayer(e) {
  e.preventDefault();
  const name = $('username').value.trim().toLowerCase();
  if (!name) return;
  const btn = $('load');
  btn.disabled = true;
  setList('Chargement des parties…');
  try {
    const { archives } = await getJson(`${API}${encodeURIComponent(name)}/games/archives`);
    if (!archives.length) { setList('Ce joueur n’a aucune partie archivée.'); return; }
    state.username = name;
    store.set('username', name);
    const sel = $('month');
    sel.replaceChildren(...archives.slice().reverse().map((url) => {
      const [y, m] = url.split('/').slice(-2);
      return h('option', { value: url }, `${MONTHS[+m - 1]} ${y}`);
    }));
    $('month-row').hidden = false;
    await loadMonth(archives[archives.length - 1]);
  } catch (err) {
    setList(err.code === 404 ? `Aucun joueur « ${name} » sur Chess.com. Vérifie l’orthographe.` : err.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function loadMonth(url) {
  setList('Chargement des parties…');
  try {
    const { games } = await getJson(url);
    state.games = games.filter((g) => g.rules === 'chess' && g.pgn).reverse();
    if (!state.games.length) setList('Aucune partie standard terminée ce mois-ci. Choisis un autre mois.');
    else { $('list-msg').hidden = true; renderGames(); }
  } catch (err) {
    setList(err.code === 404 ? 'Ce mois n’est pas disponible.' : err.message, true);
  }
}

function setList(text, isError) {
  $('games').replaceChildren();
  const m = $('list-msg');
  m.hidden = false;
  m.textContent = text;
  m.classList.toggle('error', !!isError);
}

const OUTCOME = (r) => (r === 'win' ? ['G', 'win', 'Gagnée'] : ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(r) ? ['N', 'draw', 'Nulle'] : ['P', 'loss', 'Perdue']);

function renderGames() {
  const box = $('games');
  box.replaceChildren();
  const u = state.username;
  state.games.forEach((g) => {
    const asWhite = g.white.username.toLowerCase() === u;
    const me = asWhite ? g.white : g.black;
    const opp = asWhite ? g.black : g.white;
    const [letter, cls, word] = OUTCOME(me.result);
    const d = new Date(g.end_time * 1000);
    box.append(h('button', {
      type: 'button', class: `game${state.selectedUrl === g.url ? ' on' : ''}`,
      onclick: () => openGame(g.pgn, g.url, { url: g.url }),
    },
    h('span', { class: `res ${cls}`, title: word, 'aria-label': word }, letter),
    h('span', { class: 'g-main' },
      h('span', { class: 'g-opp' }, h('i', { class: `side ${asWhite ? 'w' : 'b'}`, title: asWhite ? 'Tu avais les Blancs' : 'Tu avais les Noirs' }), opp.username),
      h('span', { class: 'g-meta' }, `${opp.rating} · ${CLASS[g.time_class] || g.time_class} · ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`))));
  });
}

/* ---------- Démarrage ---------- */

$('player-form').addEventListener('submit', loadPlayer);
$('month').addEventListener('change', (e) => loadMonth(e.target.value));
$('pgn-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const pgn = $('pgn').value.trim();
  if (pgn) openGame(pgn, `pgn:${pgn.length}:${pgn.slice(-40)}`);
});
$('depth').addEventListener('change', () => {
  if (!state.game) return;
  exitVariation();
  store.set('depth', $('depth').value);
  analyze(state.game, state.key);
});
$('cancel').addEventListener('click', () => { stopJob(); setStatus('Analyse arrêtée. Les coups déjà calculés restent affichés.'); refreshAll(); });
$('first').addEventListener('click', () => go(0, true));
$('prev').addEventListener('click', () => go(state.cursor - 1, true));
$('next').addEventListener('click', stepForward);
$('last').addEventListener('click', () => go(1e4, true));
$('guide-start').addEventListener('click', startVariation);
$('sound').value = fx.enabled() ? 'on' : 'off';
$('sound').addEventListener('change', (e) => fx.setEnabled(e.target.value === 'on'));
$('guide-exit').addEventListener('click', exitVariation);
$('voice').addEventListener('click', () => {
  voice.auto = !voice.auto;
  store.set('voice', voice.auto ? 'on' : 'off');
  renderVoiceToggle();
  if (voice.auto) speakCurrent(); else voice.stop();
});
document.addEventListener('pointerdown', () => voice.prime(), { once: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) voice.stop(); });
if (voice.synth) {
  voice.pick();
  voice.synth.addEventListener?.('voiceschanged', () => voice.pick());
}
renderVoiceToggle();
$('voice-rate').value = String(voice.rate);
$('voice-pitch').value = String(voice.pitch);
$('voice-name').addEventListener('change', (e) => {
  store.set('voice-uri', e.target.value);
  voice.pick();
  voice.say(['Voici ma voix.']);
});
$('voice-rate').addEventListener('change', (e) => { voice.rate = +e.target.value; store.set('voice-rate', e.target.value); voice.say(['Voici ma vitesse.']); });
$('voice-pitch').addEventListener('change', (e) => { voice.pitch = +e.target.value; store.set('voice-pitch', e.target.value); voice.say(['Voici mon timbre.']); });

function setTab(name) {
  document.body.dataset.tab = name;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.go === name ? 'true' : 'false'));
  renderChart();
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.go; }));
function showAnalysis() {
  if (location.hash === '#analyse') setTab('analyse'); else location.hash = 'analyse';
}

// Glisser sur l'échiquier pour changer de coup.
let swipeX = null;
const boardEl = $('board');
boardEl.addEventListener('touchstart', (e) => { swipeX = e.changedTouches[0].clientX; }, { passive: true });
boardEl.addEventListener('touchend', (e) => {
  if (swipeX == null) return;
  const dx = e.changedTouches[0].clientX - swipeX;
  swipeX = null;
  if (Math.abs(dx) > 40) { if (dx < 0) stepForward(); else go(state.cursor - 1, true); }
}, { passive: true });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
$('flip').addEventListener('click', () => { state.flipped = !state.flipped; renderBoard(); });

const chart = $('chart');
chart.addEventListener('pointermove', chartHover);
chart.addEventListener('pointerleave', () => { $('tip').hidden = true; });
chart.addEventListener('click', (e) => go(chartScale().inv(e.clientX - chart.getBoundingClientRect().left), true));
new ResizeObserver(renderChart).observe(chart);

document.addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const map = { ArrowLeft: state.cursor - 1, ArrowRight: state.cursor + 1, Home: 0, End: 1e4 };
  if (e.key === 'ArrowRight') { e.preventDefault(); stepForward(); return; }
  if (e.key in map) { e.preventDefault(); go(map[e.key], true); }
});

const savedName = store.get('username');
if (savedName) $('username').value = savedName;
const savedDepth = store.get('depth');
if (savedDepth && [...$('depth').options].some((o) => o.value === savedDepth)) $('depth').value = savedDepth;

window.__openPgn = openGame;
if (__AUDIT__) { window.__state = state; window.__cg = cg; window.__explain = (i) => explanation(i); }
setTab('parties');
refreshAll();

/* ---------- Navigation ---------- */

const trainer = createTrainer({
  h, store, Engine, ensureMaia, display, fx,
  say: (list) => { if (voice.auto) voice.say(list.map((t) => spoken(t))); else voice.stop(); },
  hush: () => voice.stop(),
  openGame: (pgn) => { location.hash = 'analyse'; openGame(pgn, `train:${Date.now()}`); },
  username: () => state.username || store.get('username') || '',
});
const phone = () => window.matchMedia('(max-width: 780px)').matches;
const SCREENS = {
  '': { id: 'home', title: 'Chess Analyzer' },
  parties: { id: 'analyse', tab: 'parties', title: 'Analyse de partie', back: () => '' },
  // Sur téléphone, Analyse et Bilan sont des écrans successifs ; sur ordinateur, tout est visible d'un coup.
  analyse: { id: 'analyse', tab: 'analyse', title: 'Analyse de partie', back: () => (phone() ? 'parties' : '') },
  bilan: { id: 'analyse', tab: 'bilan', title: 'Analyse de partie', back: () => (phone() ? 'analyse' : '') },
  exercices: { id: 'hub', title: 'Exercices', back: () => '' },
  problemes: { id: 'train', title: 'Problèmes', back: () => 'exercices' },
};
function route() {
  const key = location.hash.slice(1);
  if (key === 'analyse' && !state.game) { location.replace('#parties'); return; }
  const sit = key.startsWith('situation-') ? key.slice(10) : null;
  const def = sit ? { id: 'train', title: trainer.titleOf(sit), back: () => 'exercices' } : (SCREENS[key] || SCREENS['']);
  document.body.dataset.screen = def.id;
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== `screen-${def.id}`; });
  $('bar-title').textContent = def.title;
  $('bar-back').hidden = !def.back;
  $('bar-back').onclick = () => {
    // En « Rejouer », le retour ramène d'abord à la partie analysée.
    if (key === 'analyse' && state.variation) exitVariation();
    else location.hash = def.back();
  };
  $('bar-resume').hidden = !state.game || key === 'analyse';
  voice.stop();
  if (def.tab) setTab(def.tab);
  if (def.id === 'hub' || def.id === 'home') trainer.renderHub();
  if (def.id === 'train') trainer.open(sit || 'puzzle'); else trainer.close();
  if (def.id === 'analyse') { cg.redrawAll(); renderChart(); }
}
$('bar-resume').addEventListener('click', () => { location.hash = 'analyse'; });
window.addEventListener('hashchange', route);
route();
