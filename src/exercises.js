// Exercices : problèmes notés et mises en situation contre Maia.
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import { createPool, updateElo } from './puzzles.js';
import { toWhiteScore } from './analysis.js';
import POSITIONS from './situations.json';

export const SITUATIONS = [
  { id: 'pawn', icon: '♟', title: 'Finale de pions', goal: 'Gagne cette finale.', blurb: 'Roi et pions : opposition, pion passé, course à la promotion.', cap: 80, winAt: 1500, lossAt: -700, capWin: 700, capDraw: 0 },
  { id: 'rook', icon: '♜', title: 'Finale de tours', goal: 'Fais valoir ton avantage.', blurb: 'Activité de la tour, coupure du roi, pions passés.', cap: 80, winAt: 1500, lossAt: -700, capWin: 600, capDraw: 0 },
  { id: 'opening', icon: '♞', title: 'Ouverture agressive', goal: 'Lance l’attaque et prends l’avantage.', blurb: 'Gambits : de l’activité en échange d’un pion.', cap: 30, winAt: 600, lossAt: -600, capWin: 150, capDraw: -60 },
  { id: 'attack', icon: '♛', title: 'Attaque sur le roque', goal: 'Fais tomber le roi adverse.', blurb: 'Tes pièces visent le roque : à toi de conclure.', cap: 36, winAt: 800, lossAt: -500, capWin: 400, capDraw: 100 },
  { id: 'defend', icon: '♚', title: 'Tenir une position difficile', goal: 'Résiste et ne perds pas.', blurb: 'Tu es moins bien : défends-toi sans craquer.', cap: 36, winAt: 300, lossAt: -650, capWin: -150, capDraw: -350, drawIsWin: true },
];

const THEMES = { mate: 'Mat', mateIn1: 'Mat en 1', mateIn2: 'Mat en 2', mateIn3: 'Mat en 3', mateIn4: 'Mat en 4', fork: 'Fourchette', pin: 'Clouage', skewer: 'Enfilade', sacrifice: 'Sacrifice', discoveredAttack: 'Attaque à la découverte', deflection: 'Déviation', attraction: 'Attraction', hangingPiece: 'Pièce en prise', trappedPiece: 'Pièce piégée', backRankMate: 'Mat du couloir', promotion: 'Promotion', endgame: 'Finale', opening: 'Ouverture', middlegame: 'Milieu de partie', kingsideAttack: 'Attaque sur le roque', defensiveMove: 'Coup défensif', quietMove: 'Coup tranquille' };

const START = 1200;
const SK = (id) => `elo-${id}`;
const parse = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

function destsOf(c) {
  const d = new Map();
  c.moves({ verbose: true }).forEach((m) => { if (!d.has(m.from)) d.set(m.from, []); d.get(m.from).push(m.to); });
  return d;
}
const colorName = (t) => (t === 'w' ? 'white' : 'black');

export function createTrainer({ h, store, Engine, ensureMaia, openGame, username }) {
  const $ = (id) => document.getElementById(id);
  const getElo = (id) => { try { return JSON.parse(store.get(SK(id))) || { r: START, n: 0 }; } catch { return { r: START, n: 0 }; } };
  const setElo = (id, v) => store.set(SK(id), JSON.stringify(v));
  const pool = createPool(store);
  let cg = null;
  let session = 0;
  let engine = null;
  let stats = { streak: 0 };
  const P = {}; // état de l'exercice courant
  if (__AUDIT__) window.__P = P;

  const msg = (text, tone = '') => { const m = $('t-msg'); m.textContent = text; m.dataset.tone = tone; };
  const actions = (list) => {
    const box = $('t-actions');
    box.replaceChildren(...list.map(([label, fn, main]) => h('button', { type: 'button', class: main ? 'btn' : 'ghost', onclick: fn }, label)));
  };
  const head = (title, sub) => { $('t-title').textContent = title; $('t-sub').textContent = sub; };
  const showElo = (id, delta) => {
    const e = getElo(id);
    $('t-elo').textContent = e.r;
    $('t-delta').textContent = delta == null ? '' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}`;
    $('t-delta').dataset.tone = delta == null ? '' : delta >= 0 ? 'good' : 'bad';
  };

  function board() {
    if (!cg) {
      cg = Chessground($('tboard'), { coordinates: true, animation: { enabled: true, duration: 170 }, movable: { free: false, showDests: true }, premovable: { enabled: false }, drawable: { enabled: true, visible: true }, highlight: { lastMove: true, check: true } });
      new ResizeObserver(() => cg.redrawAll()).observe($('tboard'));
    }
    return cg;
  }
  function setBoard(c, orientation, last, canMove, after) {
    board().set({
      fen: c.fen(), orientation, turnColor: colorName(c.turn()), check: c.inCheck() ? colorName(c.turn()) : false,
      lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : undefined,
      movable: { free: false, color: canMove ? colorName(c.turn()) : undefined, dests: canMove ? destsOf(c) : new Map(), showDests: true, events: { after } },
    });
    board().setAutoShapes([]);
  }

  /* ---------- Problèmes ---------- */

  async function nextPuzzle() {
    const my = ++session;
    actions([]);
    head('Problèmes', 'Chargement…');
    showElo('puzzle');
    msg('Recherche d’un problème à ton niveau…');
    board().set({ movable: { color: undefined } });
    let p;
    try { p = await pool.next(getElo('puzzle').r); } catch {
      if (my === session) { msg('Impossible de charger un problème. Vérifie ta connexion, puis réessaie.', 'bad'); actions([['Réessayer', nextPuzzle, true]]); }
      return;
    }
    if (my !== session) return;
    const c = new Chess(p.start);
    Object.assign(P, { p, c, idx: 0, failed: false, done: false, my, orient: colorName(c.turn()), lastPlayed: null });
    head('Problèmes', `Trait aux ${c.turn() === 'w' ? 'Blancs' : 'Noirs'}`);
    msg('Trouve la meilleure suite.');
    setBoard(c, P.orient, p.lastMove, true, onPuzzleMove);
    actions([['Voir la solution', revealSolution]]);
  }

  function rate(score) {
    const e = getElo('puzzle');
    const r = updateElo(e, P.p.rating, score);
    setElo('puzzle', { r: r.r, n: r.n });
    showElo('puzzle', r.delta);
  }

  function finishPuzzle(text, tone) {
    P.done = true;
    const themes = P.p.themes.map((t) => THEMES[t]).filter(Boolean).slice(0, 3).join(' · ');
    head('Problèmes', `Problème ${P.p.rating}${themes ? ` · ${themes}` : ''}`);
    msg(text, tone);
    setBoard(P.c, P.orient, P.lastPlayed || P.p.lastMove, false);
    actions([['Problème suivant', nextPuzzle, true]]);
  }

  async function onPuzzleMove(orig, dest) {
    if (P.done) return;
    const want = P.p.solution[P.idx];
    const piece = P.c.get(orig);
    const promoting = piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1');
    const promo = promoting ? (want.startsWith(orig + dest) && want[4] ? want[4] : 'q') : '';
    const uci = orig + dest + promo;
    const trial = new Chess(P.c.fen());
    trial.move(parse(uci));
    const lastOne = P.idx === P.p.solution.length - 1;
    const ok = uci === want || (lastOne && trial.isCheckmate());
    const my = P.my;
    if (!ok) {
      if (!P.failed) { P.failed = true; stats.streak = 0; rate(0); }
      msg('Ce n’est pas le bon coup. Réessaie.', 'bad');
      await pause(280);
      if (my === session && !P.done) setBoard(P.c, P.orient, P.lastPlayed || P.p.lastMove, true, onPuzzleMove);
      return;
    }
    P.c.move(parse(uci));
    P.idx += 1;
    P.lastPlayed = uci;
    if (P.idx >= P.p.solution.length) {
      if (!P.failed) { stats.streak += 1; rate(1); finishPuzzle(stats.streak > 1 ? `Résolu du premier coup. Série de ${stats.streak}.` : 'Résolu du premier coup.', 'good'); } else finishPuzzle('Résolu, mais pas du premier coup : pas de points gagnés.', '');
      return;
    }
    msg('Bien joué. Continue.', 'good');
    setBoard(P.c, P.orient, uci, false);
    await pause(420);
    if (my !== session) return;
    const reply = P.p.solution[P.idx];
    P.c.move(parse(reply));
    P.idx += 1;
    P.lastPlayed = reply;
    setBoard(P.c, P.orient, reply, true, onPuzzleMove);
  }

  async function revealSolution() {
    if (P.done) return;
    const my = P.my;
    if (!P.failed) { P.failed = true; stats.streak = 0; rate(0); }
    P.done = true;
    actions([]);
    msg('Voici la solution.');
    while (P.idx < P.p.solution.length) {
      const u = P.p.solution[P.idx];
      P.c.move(parse(u));
      P.idx += 1;
      P.lastPlayed = u;
      setBoard(P.c, P.orient, u, false);
      await pause(800);
      if (my !== session) return;
    }
    finishPuzzle('Solution affichée.', '');
  }

  /* ---------- Mises en situation ---------- */

  async function evalFor(fen, user) {
    const r = await engine.evaluate(fen, 11);
    const w = toWhiteScore(r.score, fen.split(' ')[1] === 'w');
    const cp = w.type === 'cp' ? w.value : (w.value > 0 ? 20000 : -20000);
    return user === 'w' ? cp : -cp;
  }

  async function startSituation(id) {
    const my = ++session;
    const def = SITUATIONS.find((s) => s.id === id);
    const list = POSITIONS[id] || [];
    actions([]);
    showElo(id);
    head(def.title, 'Préparation…');
    if (!list.length) { msg('Aucune position disponible pour le moment.', 'bad'); return; }
    const recent = (() => { try { return JSON.parse(store.get(`recent-${id}`)) || []; } catch { return []; } })();
    const fresh = list.filter((x) => !recent.includes(x.fen));
    const item = (fresh.length ? fresh : list)[Math.floor(Math.random() * (fresh.length || list.length))];
    store.set(`recent-${id}`, JSON.stringify([...recent, item.fen].slice(-Math.floor(list.length * 0.8))));
    const c = new Chess(item.fen);
    const user = c.turn();
    Object.assign(P, { def, id, c, user, my, ply: 0, done: false, startFen: item.fen, thinking: true, orient: colorName(user), lastPlayed: null });
    setBoard(c, P.orient, null, false);
    try {
      msg('Chargement de l’adversaire…');
      await ensureMaia((pct) => { if (my === session) msg(`Chargement de l’adversaire : ${pct} %`); });
      if (!engine) { engine = new Engine(); await engine.init(); }
    } catch {
      if (my === session) { msg('Impossible de charger l’adversaire. Vérifie ta connexion, puis réessaie.', 'bad'); actions([['Réessayer', () => startSituation(id), true]]); }
      return;
    }
    if (my !== session) return;
    P.thinking = false;
    subtitle();
    msg(`${item.title ? `${item.title}. ` : ''}${def.goal}`);
    setBoard(c, P.orient, null, true, onSituationMove);
    actions([['Abandonner', () => endSituation(0, 'Partie abandonnée.')]]);
  }

  const subtitle = () => { const left = Math.max(0, Math.ceil((P.def.cap - P.ply) / 2)); head(P.def.title, `Adversaire ${getElo(P.id).r} · ${left} coups restants · ${P.user === 'w' ? 'Blancs' : 'Noirs'}`); };

  function gameEnd(c) {
    if (c.isCheckmate()) return c.turn() === P.user ? [0, 'Tu es mat.'] : [1, 'Échec et mat, bravo.'];
    if (c.isDraw()) return [P.def.drawIsWin ? 1 : 0.5, P.def.drawIsWin ? 'Partie nulle : mission réussie.' : 'Partie nulle.'];
    return null;
  }

  async function onSituationMove(orig, dest) {
    if (P.done || P.thinking) return;
    const my = P.my;
    const piece = P.c.get(orig);
    const promo = piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : undefined;
    P.c.move({ from: orig, to: dest, promotion: promo });
    P.ply += 1;
    P.lastPlayed = orig + dest + (promo || '');
    P.thinking = true;
    setBoard(P.c, P.orient, P.lastPlayed, false);
    let end = gameEnd(P.c);
    if (end) { endSituation(end[0], end[1]); return; }
    msg('L’adversaire réfléchit…');
    await pause(250);
    const elo = getElo(P.id).r;
    let reply;
    try { reply = await (await ensureMaia(() => {})).move(P.c.fen(), elo, elo, 1); } catch { reply = null; }
    if (my !== session) return;
    if (!reply) { const r = await engine.evaluate(P.c.fen(), 8); reply = r.best; if (my !== session) return; }
    P.c.move(parse(reply));
    P.ply += 1;
    P.lastPlayed = reply;
    end = gameEnd(P.c);
    if (end) { setBoard(P.c, P.orient, reply, false); endSituation(end[0], end[1]); return; }
    setBoard(P.c, P.orient, reply, false);
    const ev = await evalFor(P.c.fen(), P.user);
    if (my !== session) return;
    const d = P.def;
    if (ev >= d.winAt) { endSituation(1, 'Position gagnante atteinte, objectif rempli.'); return; }
    if (ev <= d.lossAt) { endSituation(0, 'La position est perdue.'); return; }
    if (P.ply >= d.cap) {
      if (ev >= d.capWin) endSituation(1, 'Objectif rempli à la fin du temps imparti.');
      else if (ev >= d.capDraw) endSituation(0.5, 'Résultat moyen : tu n’as pas atteint l’objectif, mais tu tiens encore.');
      else endSituation(0, 'Objectif manqué.');
      return;
    }
    P.thinking = false;
    subtitle();
    msg(P.c.inCheck() ? 'Échec. À toi de jouer.' : 'À toi de jouer.');
    setBoard(P.c, P.orient, reply, true, onSituationMove);
  }

  function pgnOfGame(score) {
    const g = new Chess(P.startFen);
    const c = new Chess(P.startFen);
    P.c.history({ verbose: true }).forEach((m) => c.move({ from: m.from, to: m.to, promotion: m.promotion }));
    g.loadPgn(c.pgn());
    const me = username() || 'Toi';
    const white = P.user === 'w';
    const elo = String(getElo(P.id).r);
    const won = score === 1 ? P.user : score === 0 ? (white ? 'b' : 'w') : null;
    const res = won === 'w' ? '1-0' : won === 'b' ? '0-1' : '1/2-1/2';
    const headers = { White: white ? me : 'Maia', Black: white ? 'Maia' : me, WhiteElo: elo, BlackElo: elo, Result: res };
    Object.entries(headers).forEach(([k, v]) => g.setHeader(k, v));
    return g.pgn();
  }

  function endSituation(score, text) {
    if (P.done) return;
    P.done = true;
    session += 1;
    const id = P.id;
    const e = getElo(id);
    const r = updateElo(e, e.r, score);
    setElo(id, { r: r.r, n: r.n });
    showElo(id, r.delta);
    head(P.def.title, score === 1 ? 'Réussi' : score === 0.5 ? 'Résultat moyen' : 'Raté');
    msg(text, score === 1 ? 'good' : score === 0 ? 'bad' : '');
    setBoard(P.c, P.orient, P.lastPlayed, false);
    const hasMoves = P.c.history().length > 0;
    actions([['Situation suivante', () => startSituation(id), true], ...(hasMoves ? [['Analyser cette partie', () => openGame(pgnOfGame(score))]] : [])]);
  }

  /* ---------- Accueil des exercices ---------- */

  function renderHub() {
    const box = $('hub-sits');
    if (!box) return;
    $('hub-puzzle-elo').textContent = getElo('puzzle').r;
    $('home-puzzle-elo').textContent = getElo('puzzle').r;
    box.replaceChildren(...SITUATIONS.map((s) => h('a', { class: 'tile', href: `#situation-${s.id}` },
      h('span', { class: 'tile-ic', 'aria-hidden': 'true' }, s.icon),
      h('span', { class: 'tile-main' }, h('strong', {}, s.title), h('small', {}, s.blurb)),
      h('span', { class: 'elo-chip' }, String(getElo(s.id).r)))));
  }

  return {
    renderHub,
    titleOf: (id) => (SITUATIONS.find((s) => s.id === id) || {}).title || 'Mise en situation',
    open(id) { if (id === 'puzzle') nextPuzzle(); else startSituation(id); },
    close() { session += 1; },
  };
}
