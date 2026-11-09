import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import {
  buildReport, formatScore, GLYPHS, KINDS, LABELS, MATE_CP, parseInfo, pickHuman, scoreToCp, toWhiteScore, winPct, FAIR_RESULTS,
} from './analysis.js';
import { Engine } from './engine.js';
import { createTrainer } from './exercises.js';
import { bookFromEcoUrl, explainMove, isSacrifice, sanToSpeech } from './explain.js';

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

const state = { game: null, evals: [], report: null, cursor: 0, flipped: false, games: [], selectedUrl: null, username: '' };
const cache = new Map();
let job = null; // analyse en cours

const cg = Chessground($('board'), {
  viewOnly: true, coordinates: true, animation: { enabled: true, duration: 140 },
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

function renderBoard() {
  const { game, cursor, report } = state;
  if (!game) { renderVerdict(); renderGuide(); return; }
  const ply = cursor > 0 ? game.plies[cursor - 1] : null;
  const judged = ply && report ? report.moves[cursor - 1] : null;
  cg.set({
    fen: game.fens[cursor],
    orientation: orientation(),
    lastMove: ply ? [ply.from, ply.to] : undefined,
    turnColor: game.fens[cursor].split(' ')[1] === 'w' ? 'white' : 'black',
    check: false,
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
  renderVerdict();
  renderGuide();
}

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
  try {
    return explainMove({
      fenBefore: game.fens[i], fenAfter: game.fens[i + 1], ply: game.plies[i], before: evals[i], after: evals[i + 1], move, index: i, prev: game.plies[i - 1],
    });
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
  if (ex.line) body.append(h('p', { class: 'v-line' }, 'Suite prévue : ', display(ex.line)));
  if (state.variation && state.variation.ended && cursor === game.plies.length) body.append(h('p', { class: 'v-text' }, h('strong', {}, state.variation.ended)));
  box.append(body);
}

function renderMoves() {
  const { game, report, cursor } = state;
  const list = $('moves');
  const top = list.scrollTop;
  const strip = $('strip');
  list.replaceChildren();
  strip.replaceChildren();
  if (!game) return;
  game.plies.forEach((p, i) => {
    if (i % 2 === 0) list.append(h('span', { class: 'num' }, `${moveNo(i)}.`));
    else if (i === 0) list.append(h('span', { class: 'num' }, '1.'), h('span', {}));
    const m = report ? report.moves[i] : null;
    const kind = m && !m.pending ? m.kind : '';
    strip.append(h('button', {
      type: 'button', class: `chip${cursor === i + 1 ? ' on' : ''}${inVariation(i) ? ' var' : ''}`, onclick: () => go(i + 1, true),
    }, i % 2 === 0 ? h('span', { class: 'num' }, `${moveNo(i)}.`) : null, fig(p.san), kind ? h('span', { class: 'mark tiny', 'data-kind': kind }, GLYPHS[kind]) : null));
    list.append(h('button', {
      type: 'button', class: `mv${cursor === i + 1 ? ' on' : ''}${inVariation(i) ? ' var' : ''}`, 'data-kind': kind || null, onclick: () => go(i + 1, true),
      'aria-label': `${moveLabel(i, p.san)}${kind ? ` : ${LABELS[kind]}` : ''}`,
    }, fig(p.san), kind ? h('span', { class: 'mark tiny', 'data-kind': kind, 'aria-hidden': 'true' }, GLYPHS[kind]) : null));
  });
  const onChip = strip.querySelector('.on');
  if (onChip) strip.scrollLeft = onChip.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + onChip.offsetWidth / 2;
  list.scrollTop = top;
  const on = list.querySelector('.on');
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
  svg.append(s('line', { x1: x(cursor), x2: x(cursor), y1: PAD.t, y2: H - PAD.b, class: 'c-cursor' }));
  if (report) {
    const R = { inaccuracy: 4, mistake: 4.5, miss: 4.5, blunder: 5.5 };
    report.moves.forEach((m, i) => {
      if (m.pending || !R[m.kind] || !evals[i + 1]) return;
      svg.append(s('circle', { cx: x(i + 1), cy: y(winPct(scoreToCp(evals[i + 1].score))), r: R[m.kind], class: `c-pt ${m.kind}` }));
    });
  }
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

function go(i, fromUser) {
  if (!state.game) return;
  const next = Math.max(0, Math.min(state.game.plies.length, i));
  const moved = next !== state.cursor;
  state.cursor = next;
  renderBoard();
  renderMoves();
  renderChart();
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

function refreshAll() {
  state.report = state.game ? buildReport(state.game.plies, state.evals, state.game.bookPlies) : null;
  renderStats();
  renderBoard();
  renderMoves();
  renderChart();
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
  if (job) { job.engine.stop(); job.cancelled = true; job = null; }
  $('progress').hidden = true;
}

async function analyze(game, key) {
  stopJob();
  const depth = +$('depth').value;
  const cacheKey = `${key}@${depth}`;
  if (cache.has(cacheKey)) {
    state.evals = cache.get(cacheKey);
    setStatus(`Analyse à la profondeur ${depth}, déjà calculée.`);
    refreshAll();
    return;
  }
  const engine = new Engine();
  const me = { engine, cancelled: false };
  job = me;
  state.evals = [];
  $('progress').hidden = false;
  $('bar-fill').style.width = '0%';
  refreshAll();
  const n = game.fens.length;
  const t0 = performance.now();
  try {
    await engine.init();
    for (let i = 0; i < n; i += 1) {
      if (me.cancelled) return;
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
      $('bar-fill').style.width = `${((i + 1) / n) * 100}%`;
      $('progress-text').textContent = `Analyse : position ${i + 1} sur ${n}`;
      refreshAll();
    }
    await refine(game, engine, depth, me);
    if (me.cancelled) return;
    await findAlternatives(game, engine, depth, me);
    if (me.cancelled) return;
    $('progress-text').textContent = 'Recherche des raisons de chaque coup…';
    for (let i = game.bookPlies; i < game.plies.length; i += 1) {
      if (game.plies[i].legal < 2) continue;
      await computeThreat(engine, game.fens[i], state.evals[i]);
      if (me.cancelled) return;
    }
    cache.set(cacheKey, state.evals);
    window.__lastAnalysis = { evals: state.evals, ms: performance.now() - t0 };
    setStatus(`Analyse terminée à la profondeur ${depth} en ${Math.round((performance.now() - t0) / 1000)} s.`);
  } catch (err) {
    if (!me.cancelled) setStatus(`Le moteur n’a pas pu démarrer (${err.message}). Recharge la page, puis réessaie.`, true);
  } finally {
    if (job === me) { job = null; $('progress').hidden = true; engine.stop(); refreshAll(); }
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
async function findAlternatives(game, engine, depth, me) {
  const report = buildReport(game.plies, state.evals, game.bookPlies);
  $('progress-text').textContent = 'Recherche des coups brillants et décisifs…';
  for (let i = 0; i < game.plies.length; i += 1) {
    const ply = game.plies[i];
    const m = report.moves[i];
    if (m.pending || m.kind === 'book' || ply.legal < 2 || m.loss >= 2) continue;
    if (!ply.sacrifice && (ply.recapture || m.moverAfter < 40)) continue;
    const others = new Chess(game.fens[i]).moves({ verbose: true }).map((x) => x.from + x.to + (x.promotion || '')).filter((u) => u !== ply.uci);
    const r = await engine.evaluate(game.fens[i], depth, others);
    if (me.cancelled) return;
    state.evals[i].second = toWhiteScore(r.score, ply.color === 'w');
  }
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
  const level = $('my-level').value;
  const v = {
    base, main, me, engine: new Engine(), active: true, ended: null, busy: false, pending: null,
    oppElo: rating(me === 'w' ? 'b' : 'w'),
    myElo: level === 'max' ? null : rating(me) + +level,
    myRating: rating(me), loadPct: 0, maiaFailed: false,
    mainReport: buildReport(g.plies, main.evals, g.bookPlies),
  };
  state.variation = v;
  state.game = { ...g, fens: g.fens.slice(0, base + 1), plies: g.plies.slice(0, base), bookPlies: Math.min(g.bookPlies, base) };
  state.evals = main.evals.slice(0, base + 1);
  v.ready = Promise.all([v.engine.init(), loadMaia(v).catch(() => { v.maiaFailed = true; v.loadPct = null; })]);
  v.ready.then(() => { if (v.active) renderGuide(); }).catch(() => {});
  v.pending = prepareNext(v);
  v.pending.catch(() => {});
  refreshAll();
}

// Calcule à l'avance le coup suivant : la touche › répond alors tout de suite.
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
      const temperature = mine ? (elo >= 2000 ? 0.25 : 0.5) : 1;
      const other = mine ? v.oppElo : (v.myElo || v.myRating);
      uci = await maiaModule.move(c.fen(), elo, other, temperature);
    } else {
      const list = await engine.candidates(game.fens[0], ucis, CANDIDATE_DEPTH, CANDIDATE_COUNT);
      if (list.length) uci = pickHuman(list, elo);
    }
  }
  const legal = c.moves().length;
  const prev = game.plies[n - 1];
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
    refreshAll();
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
  voice.stop();
  refreshAll();
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
  const levels = `Toi ${v.myElo == null ? 'max' : v.myElo} · Adversaire ${v.oppElo}`;
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
  setTab('analyse');
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
$('my-level').value = store.get('my-level') || '400';
$('my-level').addEventListener('change', (e) => store.set('my-level', e.target.value));
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
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.go)));

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
if (__AUDIT__) window.__state = state;
setTab('parties');
refreshAll();

/* ---------- Navigation ---------- */

const trainer = createTrainer({
  h, store, Engine, ensureMaia,
  openGame: (pgn) => { location.hash = 'analyse'; openGame(pgn, `train:${Date.now()}`); },
  username: () => state.username || store.get('username') || '',
});
const SCREENS = {
  '': { id: 'home', title: 'Chess Analyzer' },
  analyse: { id: 'analyse', title: 'Analyse de partie', back: '' },
  exercices: { id: 'hub', title: 'Exercices', back: '' },
  problemes: { id: 'train', title: 'Problèmes', back: 'exercices' },
};
function route() {
  const key = location.hash.slice(1);
  const sit = key.startsWith('situation-') ? key.slice(10) : null;
  const def = sit ? { id: 'train', title: trainer.titleOf(sit), back: 'exercices' } : (SCREENS[key] || SCREENS['']);
  document.body.dataset.screen = def.id;
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== `screen-${def.id}`; });
  $('bar-title').textContent = def.title;
  $('bar-back').hidden = def.back === undefined;
  $('bar-back').onclick = () => { location.hash = def.back; };
  voice.stop();
  if (def.id === 'hub' || def.id === 'home') trainer.renderHub();
  if (def.id === 'train') trainer.open(sit || 'puzzle'); else trainer.close();
  if (def.id === 'analyse') { cg.redrawAll(); renderChart(); }
}
window.addEventListener('hashchange', route);
route();
