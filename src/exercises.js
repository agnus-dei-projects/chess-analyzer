// Exercices : problèmes notés et mises en situation contre Maia.
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import { createPool, updateElo, validPuzzle } from './puzzles.js';
import { pickHuman, toWhiteScore } from './analysis.js';
import { within } from './within.js';
import { explainWrongMove } from './explain.js';
import POSITIONS from './situations.json';
import { bookMove, pickFromPolicy, thinkMs } from './bot.js';
import JAKBOT from './bots/jakbot.json';

// Bots : chacun imite un vrai joueur, d'après ses parties (voir tests/bots/ pour la construction du modèle).
export const BOTS = [
  { id: 'jakbot', name: 'jakbot', icon: '♚', elo: JAKBOT.elo, blurb: `Imite un vrai joueur d’environ ${JAKBOT.elo} Elo en rapide : ses ouvertures, ses habitudes, sa précision.`, model: JAKBOT },
];
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const SITUATIONS = [
  { id: 'pawn', icon: '♟', title: 'Finale de pions', goal: 'Gagne cette finale.', blurb: 'Roi et pions : opposition, pion passé, course à la promotion.', cap: 80, winAt: 1500, lossAt: -700, capWin: 700, capDraw: 0 },
  { id: 'rook', icon: '♜', title: 'Finale de tours', goal: 'Fais valoir ton avantage.', blurb: 'Activité de la tour, coupure du roi, pions passés.', cap: 80, winAt: 1500, lossAt: -700, capWin: 600, capDraw: 0 },
  { id: 'opening', icon: '♞', title: 'Ouverture agressive', goal: 'Lance l’attaque et prends l’avantage.', blurb: 'Gambits : de l’activité en échange d’un pion.', cap: 30, winAt: 600, lossAt: -600, capWin: 150, capDraw: -60 },
  { id: 'attack', icon: '♛', title: 'Attaque sur le roque', goal: 'Fais tomber le roi adverse.', blurb: 'Tes pièces visent le roque : à toi de conclure.', cap: 36, winAt: 800, lossAt: -500, capWin: 400, capDraw: 100 },
  { id: 'defend', icon: '♚', title: 'Tenir une position difficile', goal: 'Résiste et ne perds pas.', blurb: 'Tu es moins bien : défends-toi sans craquer.', cap: 36, winAt: 300, lossAt: -650, capWin: -150, capDraw: -350, drawIsWin: true },
];

const THEMES = { mate: 'Mat', mateIn1: 'Mat en 1', mateIn2: 'Mat en 2', mateIn3: 'Mat en 3', mateIn4: 'Mat en 4', fork: 'Fourchette', pin: 'Clouage', skewer: 'Enfilade', sacrifice: 'Sacrifice', discoveredAttack: 'Attaque à la découverte', deflection: 'Déviation', attraction: 'Attraction', hangingPiece: 'Pièce en prise', trappedPiece: 'Pièce piégée', backRankMate: 'Mat du couloir', promotion: 'Promotion', endgame: 'Finale', opening: 'Ouverture', middlegame: 'Milieu de partie', kingsideAttack: 'Attaque sur le roque', defensiveMove: 'Coup défensif', quietMove: 'Coup tranquille' };

const START = 800;
// Au-delà de ce délai sans réponse, le moteur est relancé au lieu de laisser l'exercice figé.
const EVAL_MS = 15000;
// Adversaire de secours quand Maia est indisponible : un coup « humain » tiré parmi les meilleurs du moteur.
const CANDIDATE_DEPTH = 10;
const CANDIDATE_COUNT = 8;
// Un verdict donné par l'évaluation doit tenir deux tours de suite : un seul coup ne décide pas de l'essai.
const CONFIRM_TURNS = 2;
// Après ce nombre d'essais manqués sur une même position, on peut en changer.
const SKIP_AFTER = 3;
// Cause d'une panne, en clair : elle s'affiche à l'écran pour qu'une capture suffise à comprendre.
const reason = (err) => {
  const t = String((err && err.message) || err || 'erreur inconnue').replace(/\.$/, '');
  const http = t.match(/\b(?:HTTP |\()(\d{3})\b/);
  if (/importScripts|Failed to fetch|NetworkError|Load failed|HTTP \d{3}/i.test(t)) return `fichier inaccessible${http ? `, erreur ${http[1]}` : ''}`;
  return t.length > 90 ? `${t.slice(0, 90)}…` : t;
};
const SK = (id) => `elo-${id}`;
const parse = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });

function destsOf(c) {
  const d = new Map();
  c.moves({ verbose: true }).forEach((m) => { if (!d.has(m.from)) d.set(m.from, []); d.get(m.from).push(m.to); });
  return d;
}
const colorName = (t) => (t === 'w' ? 'white' : 'black');
const themesOf = (p) => (Array.isArray(p.themes) ? p.themes : String(p.themes || '').split(/\s+/).filter(Boolean));

export function createTrainer({ h, store, Engine, ensureMaia, openGame, username, display, say, hush, fx }) {
  const $ = (id) => document.getElementById(id);
  const getElo = (id) => { try { return JSON.parse(store.get(SK(id))) || { r: START, n: 0 }; } catch { return { r: START, n: 0 }; } };
  const setElo = (id, v) => store.set(SK(id), JSON.stringify(v));
  // Les problèmes démarrent désormais à 800 : remise à niveau unique des anciens profils.
  if (!store.get('puzzle-start-800')) { store.set(SK('puzzle'), JSON.stringify({ r: START, n: 0 })); store.set('puzzle-start-800', '1'); }
  if (!store.get('situations-start-800')) { SITUATIONS.forEach((s) => store.set(SK(s.id), JSON.stringify({ r: START, n: 0 }))); store.set('situations-start-800', '1'); }
  const readJson = (k) => { try { return JSON.parse(store.get(k)); } catch { return null; } };
  const pool = createPool(store);
  let cg = null;
  let session = 0;
  let cancelPromo = null;
  let engine = null;
  let stats = { streak: 0 };
  const P = {}; // état de l'exercice courant
  if (__AUDIT__) { window.__P = P; window.__fx = fx; window.__redraw = () => setBoard(P.c, P.orient, null, true, onSituationMove); window.__move = (o, d) => onSituationMove(o, d); window.__pmove = (o, d) => onPuzzleMove(o, d); }

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
      cg = Chessground($('tboard'), { coordinates: true, animation: { enabled: true, duration: fx.duration() }, movable: { free: false, showDests: true }, premovable: { enabled: false }, drawable: { enabled: true, visible: true }, highlight: { lastMove: true, check: true } });
      new ResizeObserver(() => cg.redrawAll()).observe($('tboard'));
    }
    return cg;
  }
  function setBoard(c, orientation, last, canMove, after) {
    if (cancelPromo) cancelPromo();
    board().set({
      fen: c.fen(), orientation, turnColor: colorName(c.turn()), check: c.inCheck() ? colorName(c.turn()) : false,
      lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : undefined,
      movable: { free: false, color: canMove ? colorName(c.turn()) : undefined, dests: canMove ? destsOf(c) : new Map(), showDests: true, events: { after } },
    });
    board().setAutoShapes([]);
  }

  // Son et effet d'un coup. animated = false quand le joueur vient de poser la pièce lui-même.
  const moveFx = (m, c, animated = true) => fx.played({ san: m.san, to: m.to, fen: c.fen(), el: $('tboard'), orientation: P.orient, animated });

  /* ---------- Problèmes ---------- */

  let starting = null;
  // Un moteur qui n'a pas démarré est oublié : l'essai suivant en crée un neuf au lieu de buter sur le même échec.
  async function ensureEngine() {
    if (!engine) {
      const e = new Engine();
      engine = e;
      starting = e.init().catch((err) => { if (engine === e) engine = null; throw err; });
      starting.catch(() => {});
    }
    await starting;
    return engine;
  }
  const dropEngine = () => { if (engine) { engine.stop(); engine = null; } };

  // Calcul du moteur avec un second essai sur un moteur neuf : une panne passagère ne fige pas l'exercice.
  let computing = 0;
  async function compute(my, run) {
    for (let attempt = 0; ; attempt += 1) {
      if (my !== session) throw new Error('écran quitté');
      computing += 1;
      try {
        const e = await ensureEngine();
        if (my !== session || !e) throw new Error('écran quitté');
        return await within(run(e), EVAL_MS, 'le moteur ne répond plus');
      } catch (err) {
        if (my !== session || attempt) throw err;
        dropEngine();
      } finally { computing -= 1; }
    }
  }
  // Un nouvel exercice ne partage pas le moteur avec un calcul encore en cours pour le précédent :
  // les deux réponses se mélangeraient.
  const freshSession = () => { if (computing) dropEngine(); session += 1; return session; };

  function presentPuzzle() {
    P.c = new Chess(P.p.start);
    P.idx = 0;
    P.done = false;
    P.busy = false;
    P.lastPlayed = null;
    head('Problèmes', `Trait aux ${P.c.turn() === 'w' ? 'Blancs' : 'Noirs'}`);
    setBoard(P.c, P.orient, P.p.lastMove, true, onPuzzleMove);
    actions([['Voir la solution', revealSolution]]);
  }

  // Un problème reste en cours tant qu'il n'est pas réussi, même si on quitte l'écran.
  const savePuzzle = () => store.set('puzzle-current', JSON.stringify({ p: P.p, failed: P.failed }));

  async function nextPuzzle() {
    const my = freshSession();
    actions([]);
    head('Problèmes', 'Chargement…');
    showElo('puzzle');
    board().set({ movable: { color: undefined } });
    let saved = readJson('puzzle-current');
    // Un problème enregistré illisible (données abîmées) est abandonné plutôt que de bloquer l'écran.
    if (saved && !validPuzzle(saved.p)) { saved = null; store.set('puzzle-current', 'null'); }
    let p = saved && saved.p;
    if (!p) {
      msg('Recherche d’un problème à ton niveau…');
      try { p = await pool.next(getElo('puzzle').r); } catch {
        if (my === session) { msg('Impossible de charger un problème. Vérifie ta connexion, puis réessaie.', 'bad'); actions([['Réessayer', nextPuzzle, true]]); }
        return;
      }
      if (my !== session) return;
    }
    Object.assign(P, { p, my, failed: !!(saved && saved.failed), orient: colorName(new Chess(p.start).turn()) });
    savePuzzle();
    presentPuzzle();
    msg(P.failed ? 'Problème à terminer. Trouve la bonne suite.' : 'Trouve la meilleure suite.');
  }

  function rate(score) {
    const e = getElo('puzzle');
    const r = updateElo(e, P.p.rating, score);
    setElo('puzzle', { r: r.r, n: r.n });
    showElo('puzzle', r.delta);
  }

  function markFailed() {
    if (P.failed) return;
    P.failed = true;
    stats.streak = 0;
    rate(0);
    savePuzzle();
  }

  function finishPuzzle(text, tone) {
    P.done = true;
    store.set('puzzle-current', 'null');
    const themes = themesOf(P.p).map((t) => THEMES[t]).filter(Boolean).slice(0, 3).join(' · ');
    head('Problèmes', `Problème ${P.p.rating}${themes ? ` · ${themes}` : ''}`);
    msg(text, tone);
    setBoard(P.c, P.orient, P.lastPlayed || P.p.lastMove, false);
    actions([['Problème suivant', nextPuzzle, true]]);
  }

  function retryPuzzle() {
    hush();
    P.busy = false;
    msg('Cherche encore.');
    setBoard(P.c, P.orient, P.lastPlayed || P.p.lastMove, true, onPuzzleMove);
    actions([['Voir la solution', revealSolution]]);
  }

  // Le coup reste affiché avec sa réfutation, le temps de comprendre l'erreur.
  async function explainWrong(uci, trial, my) {
    P.busy = true;
    markFailed();
    actions([]);
    msg('Ce n’est pas le bon coup…', 'bad');
    setBoard(trial, P.orient, uci, false);
    let ex = null;
    if (!trial.isGameOver()) {
      try {
        const r = await compute(my, (e) => e.evaluate(trial.fen(), 12));
        if (my !== session) return;
        const mover = P.c.turn();
        ex = explainWrongMove({
          fenBefore: P.c.fen(), fenAfter: trial.fen(), themes: themesOf(P.p),
          ply: { uci, from: uci.slice(0, 2), to: uci.slice(2, 4), color: mover },
          after: { score: toWhiteScore(r.score, trial.turn() === 'w'), pv: r.pv },
        });
      } catch { ex = null; }
    }
    if (my !== session) return;
    if (ex && ex.refutation) board().setAutoShapes([{ orig: ex.refutation.slice(0, 2), dest: ex.refutation.slice(2, 4), brush: 'red' }]);
    const sentences = ex ? ex.sentences : ['Ce coup ne résout pas le problème.'];
    msg(sentences.map(display).join(' '), 'bad');
    say(sentences.map((t) => t.replace(/ : \[\[.*$/, '.')));
    actions([['Réessayer', retryPuzzle, true]]);
  }

  async function onPuzzleMove(orig, dest) {
    if (P.done || P.busy) return;
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
    if (!ok) { fx.played({ san: trial.history().slice(-1)[0], to: dest, fen: trial.fen(), el: $('tboard'), orientation: P.orient, animated: false }); await explainWrong(uci, trial, my); return; }
    hush();
    moveFx(P.c.move(parse(uci)), P.c, false);
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
    moveFx(P.c.move(parse(reply)), P.c);
    P.idx += 1;
    P.lastPlayed = reply;
    setBoard(P.c, P.orient, reply, true, onPuzzleMove);
  }

  // La solution se regarde, puis se rejoue : on ne passe au suivant qu'après l'avoir jouée.
  async function revealSolution() {
    if (P.done || P.busy) return;
    const my = P.my;
    markFailed();
    P.busy = true;
    hush();
    actions([]);
    msg('Regarde bien la solution.');
    const c = new Chess(P.p.start);
    setBoard(c, P.orient, P.p.lastMove, false);
    for (const u of P.p.solution) {
      await pause(850);
      if (my !== session) return;
      moveFx(c.move(parse(u)), c);
      setBoard(c, P.orient, u, false);
    }
    await pause(1100);
    if (my !== session) return;
    presentPuzzle();
    msg('À toi de la rejouer pour terminer le problème.');
  }

  /* ---------- Mises en situation ---------- */

  // Évaluation de la position du point de vue du joueur, en centipions.
  async function evalFor(fen, user, my) {
    const r = await compute(my, (e) => e.evaluate(fen, 11));
    const w = toWhiteScore(r.score, fen.split(' ')[1] === 'w');
    const cp = w.type === 'cp' ? w.value : (w.value > 0 ? 20000 : -20000);
    return user === 'w' ? cp : -cp;
  }

  const saveCurrent = (id, v) => store.set(`current-${id}`, JSON.stringify(v));

  async function startSituation(id, skip) {
    const my = freshSession();
    const def = SITUATIONS.find((s) => s.id === id);
    const list = (def && POSITIONS[id]) || [];
    actions([]);
    if (!def) { head('Mise en situation', ''); msg('Cette mise en situation n’existe pas.', 'bad'); return; }
    showElo(id);
    head(def.title, 'Préparation…');
    if (!list.length) { msg('Aucune position disponible pour le moment.', 'bad'); return; }
    // Une position reste à résoudre tant qu'elle n'est pas réussie.
    let current = skip ? null : readJson(`current-${id}`);
    if (!current || !list.some((p) => p.fen === current.fen)) {
      const recent = readJson(`recent-${id}`) || [];
      const fresh = list.filter((p) => !recent.includes(p.fen));
      const chosen = (fresh.length ? fresh : list)[Math.floor(Math.random() * (fresh.length || list.length))];
      store.set(`recent-${id}`, JSON.stringify([...recent, chosen.fen].slice(-Math.floor(list.length * 0.8))));
      current = { fen: chosen.fen, rated: false, tries: 0 };
      saveCurrent(id, current);
    }
    const item = list.find((p) => p.fen === current.fen);
    const c = new Chess(item.fen);
    const user = c.turn();
    Object.assign(P, {
      def, id, c, user, my, ply: 0, done: false, startFen: item.fen, thinking: true, orient: colorName(user), lastPlayed: null,
      retry: !!current.rated, tries: current.tries || 0, free: false, verdict: 0, streak: 0, result: null, maia: true, bot: null,
    });
    setBoard(c, P.orient, null, false);
    msg('Chargement de l’adversaire…');
    // Maia et le moteur se chargent en même temps. Seul le moteur est indispensable :
    // si Maia ne vient pas, l'adversaire joue avec le moteur, bridé à son Elo.
    let maiaError = null;
    let waiting = true;
    const human = ensureMaia((pct) => { if (my === session && waiting) msg(`Chargement de l’adversaire : ${pct} %`); })
      .then(() => true, (err) => { maiaError = err; return false; });
    try {
      await ensureEngine();
    } catch (err) {
      waiting = false;
      if (my === session) {
        msg(`Le moteur d’échecs n’a pas pu démarrer (${reason(err)}). Vérifie ta connexion, puis réessaie.`, 'bad');
        actions([['Réessayer', () => startSituation(id), true]]);
      }
      return;
    }
    const maiaReady = await human;
    waiting = false;
    if (my !== session) return;
    P.maia = maiaReady;
    P.thinking = false;
    subtitle();
    const note = P.maia ? '' : ` Adversaire de secours : le modèle humain n’a pas pu être chargé (${reason(maiaError)}).`;
    msg(`${current.rated ? 'Nouvel essai. ' : ''}${item.title ? `${item.title}. ` : ''}${def.goal}${note}`);
    setBoard(c, P.orient, null, true, onSituationMove);
    actions([abandon()]);
  }

  const abandon = () => ['Abandonner cet essai', () => endSituation(0, 'Essai abandonné.', false)];
  const sideName = () => (P.user === 'w' ? 'Blancs' : 'Noirs');
  const subtitle = () => {
    if (P.bot) { head(P.bot.name, `Tu as les ${sideName()}${P.maia ? '' : ' · moteur seul'} · ${recordText(P.id)}`); return; }
    const rival = `Adversaire ${getElo(P.id).r}${P.maia ? '' : ' (moteur)'}`;
    if (P.free) { head(P.def.title, `Partie libre · ${rival} · ${sideName()}`); return; }
    const left = Math.max(0, Math.ceil((P.def.cap - P.ply) / 2));
    head(P.def.title, `${rival} · ${left} coup${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''} · ${sideName()}`);
  };

  function gameEnd(c) {
    if (c.isCheckmate()) return c.turn() === P.user ? [0, 'Tu es mat.'] : [1, 'Échec et mat, bravo.'];
    if (c.isDraw()) return [P.def.drawIsWin ? 1 : 0.5, P.def.drawIsWin ? 'Partie nulle : mission réussie.' : 'Partie nulle.'];
    return null;
  }

  // Choix de la pièce, posé sur la colonne de promotion. Toucher à côté annule le coup.
  function choosePromotion(dest, color) {
    return new Promise((resolve) => {
      const wrap = $('tboard');
      const col = P.orient === 'white' ? dest.charCodeAt(0) - 97 : 7 - (dest.charCodeAt(0) - 97);
      const done = (v) => { cancelPromo = null; layer.remove(); resolve(v); };
      cancelPromo = () => done(null);
      const layer = h('div', { class: 'promo-layer', onpointerdown: (e) => { if (e.target === layer) done(null); } });
      const stack = h('div', { class: 'promo', style: `left:${col * 12.5}%` });
      [['q', 'queen', 'Dame'], ['r', 'rook', 'Tour'], ['b', 'bishop', 'Fou'], ['n', 'knight', 'Cavalier']].forEach(([l, name, label]) => {
        stack.append(h('button', { type: 'button', 'aria-label': label, onclick: () => done(l) }, h('piece', { class: `${name} ${color === 'w' ? 'white' : 'black'}` })));
      });
      layer.append(stack);
      wrap.append(layer);
    });
  }

  const legalIn = (fen, u) => { try { return !!(u && new Chess(fen).move(parse(u))); } catch { return false; } };

  // Coup de l'adversaire : Maia à l'Elo du thème. Si elle ne répond plus, elle est rechargée une fois,
  // puis le moteur prend le relais avec un coup « humain » tiré parmi ses meilleurs.
  async function opponentMove(my) {
    const fen = P.c.fen();
    if (P.bot) {
      const u = await botMove(my);
      if (u || my !== session) return u;
    }
    const elo = P.bot ? P.bot.elo : getElo(P.id).r;
    for (let attempt = 0; !P.bot && P.maia && attempt < 2; attempt += 1) {
      try {
        const m = await ensureMaia();
        if (my !== session) return null;
        const u = await m.move(fen, elo, elo, 1);
        if (my !== session) return null;
        if (legalIn(fen, u)) return u;
      } catch { /* second essai, puis moteur */ }
      if (my !== session) return null;
    }
    P.maia = false;
    const list = (await compute(my, (e) => e.candidates(fen, [], CANDIDATE_DEPTH, CANDIDATE_COUNT))).filter((x) => legalIn(fen, x.uci));
    if (my !== session) return null;
    if (list.length) return pickHuman(list, elo);
    const best = (await compute(my, (e) => e.evaluate(fen, 8))).best;
    if (!legalIn(fen, best)) throw new Error('aucun coup trouvé');
    return best;
  }

  // Coup d'un bot : son répertoire d'ouvertures d'abord, puis un coup de Maia à son Elo, tiré avec sa netteté.
  // Renvoie null si Maia est indisponible (le moteur prend alors le relais).
  async function botMove(my) {
    const { model, elo } = P.bot;
    const fen = P.c.fen();
    const t0 = Date.now();
    const wait = thinkMs(model, P.ply);
    let uci = bookMove(model, fen);
    if (!uci) {
      let policy = null;
      // Maia tient compte du fil de la partie : on lui donne les 8 dernières positions.
      const prior = P.c.history({ verbose: true }).slice(-8).map((m) => m.before);
      for (let attempt = 0; P.maia && !policy && attempt < 2; attempt += 1) {
        try {
          const m = await ensureMaia();
          if (my !== session) return null;
          policy = (await m.policy(fen, elo, elo, prior)).filter((x) => legalIn(fen, x[0]));
        } catch { policy = null; }
        if (my !== session) return null;
      }
      if (!policy || !policy.length) { P.maia = false; return null; }
      uci = pickFromPolicy(model, policy);
    }
    await pause(Math.max(0, wait - (Date.now() - t0)));
    return my === session ? uci : null;
  }

  async function onSituationMove(orig, dest) {
    if (P.done || P.thinking) return;
    const my = P.my;
    const piece = P.c.get(orig);
    let promo;
    if (piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
      P.thinking = true;
      promo = await choosePromotion(dest, piece.color);
      if (my !== session || P.done) return;
      P.thinking = false;
      if (!promo) { setBoard(P.c, P.orient, P.lastPlayed, true, onSituationMove); return; }
    }
    let played;
    try { played = P.c.move({ from: orig, to: dest, promotion: promo }); } catch { played = null; }
    // Coup refusé (ne devrait pas arriver) : l'échiquier est remis d'aplomb et on rejoue.
    if (!played) { setBoard(P.c, P.orient, P.lastPlayed, true, onSituationMove); return; }
    moveFx(played, P.c, false);
    P.ply += 1;
    P.lastPlayed = orig + dest + (promo || '');
    P.thinking = true;
    setBoard(P.c, P.orient, P.lastPlayed, false);
    saveBotGame();
    const end = gameEnd(P.c);
    if (end) { endSituation(end[0], end[1], true); return; }
    await opponentTurn(my);
  }

  async function opponentTurn(my) {
    if (my !== session || P.done) return;
    P.thinking = true;
    msg(P.bot ? `${P.bot.name} réfléchit…` : 'L’adversaire réfléchit…');
    actions(liveActions());
    await pause(250);
    if (my !== session) return;
    let reply;
    try { reply = await opponentMove(my); } catch (err) {
      // Ni Maia ni le moteur ne répondent : la partie est gardée telle quelle, on peut relancer l'adversaire.
      if (my !== session) return;
      msg(`L’adversaire ne répond plus (${reason(err)}). La partie est conservée.`, 'bad');
      actions([['Relancer l’adversaire', () => opponentTurn(my), true], ...liveActions()]);
      return;
    }
    if (my !== session || !reply) return;
    moveFx(P.c.move(parse(reply)), P.c);
    P.ply += 1;
    P.lastPlayed = reply;
    setBoard(P.c, P.orient, reply, false);
    saveBotGame();
    const end = gameEnd(P.c);
    if (end) { endSituation(end[0], end[1], true); return; }
    if (!P.free) {
      // Sans évaluation (moteur en panne), la partie continue : le verdict attendra le tour suivant.
      let ev = null;
      try { ev = await evalFor(P.c.fen(), P.user, my); } catch { ev = null; }
      if (my !== session) return;
      const d = P.def;
      if (ev != null) {
        const side = ev >= d.winAt ? 1 : ev <= d.lossAt ? -1 : 0;
        P.streak = side && side === P.verdict ? P.streak + 1 : side ? 1 : 0;
        P.verdict = side;
        if (P.streak >= CONFIRM_TURNS) {
          if (side > 0) endSituation(1, 'Position gagnante confirmée, objectif rempli.');
          else endSituation(0, 'La position est perdue.');
          return;
        }
        if (P.ply >= d.cap) {
          if (ev >= d.capWin) endSituation(1, 'Objectif rempli à la fin du temps imparti.');
          else if (ev >= d.capDraw) endSituation(0.5, 'Résultat moyen : tu n’as pas atteint l’objectif, mais tu tiens encore.');
          else endSituation(0, 'Objectif manqué.');
          return;
        }
      }
    }
    P.thinking = false;
    subtitle();
    msg(P.c.inCheck() ? 'Échec. À toi de jouer.' : 'À toi de jouer.');
    setBoard(P.c, P.orient, reply, true, onSituationMove);
    if (P.free) actions(liveActions());
  }

  function pgnOfGame() {
    const g = new Chess(P.startFen);
    const c = new Chess(P.startFen);
    P.c.history({ verbose: true }).forEach((m) => c.move({ from: m.from, to: m.to, promotion: m.promotion }));
    g.loadPgn(c.pgn());
    const me = username() || 'Toi';
    const white = P.user === 'w';
    const elo = String(P.bot ? P.bot.elo : getElo(P.id).r);
    const rival = P.bot ? P.bot.name : 'Maia';
    // Le résultat est celui de l'échiquier s'il y en a un (mat, nulle), sinon celui du verdict.
    const score = P.c.isCheckmate() ? (P.c.turn() === P.user ? 0 : 1) : P.c.isDraw() ? 0.5 : P.result;
    const won = score === 1 ? P.user : score === 0 ? (white ? 'b' : 'w') : null;
    const res = won === 'w' ? '1-0' : won === 'b' ? '0-1' : '1/2-1/2';
    const headers = { White: white ? me : rival, Black: white ? rival : me, WhiteElo: elo, BlackElo: elo, Result: res };
    Object.entries(headers).forEach(([k, v]) => g.setHeader(k, v));
    return g.pgn();
  }

  // Boutons une fois le résultat compté : suite ou nouvel essai, analyse, et changement de position après plusieurs échecs.
  function afterActions(canContinue) {
    const id = P.id;
    const solved = P.result === 1;
    const hasMoves = P.c.history().length > 0;
    return [
      solved ? ['Situation suivante', () => startSituation(id), true] : ['Réessayer', () => startSituation(id), true],
      ...(canContinue ? [['Continuer la partie', continueFree]] : []),
      ...(hasMoves ? [['Analyser cette partie', () => openGame(pgnOfGame())]] : []),
      ...(!solved && P.tries >= SKIP_AFTER ? [['Passer cette position', () => startSituation(id, true)]] : []),
    ];
  }

  // over : la partie est réellement finie (mat, nulle). Sinon on peut la poursuivre librement, résultat déjà compté.
  function endSituation(score, text, over) {
    if (P.done) return;
    P.done = true;
    session += 1;
    const id = P.id;
    if (P.bot) {
      // Fin d'une partie contre un bot : le bilan des parties est mis à jour, la partie en cours est effacée.
      P.result = score;
      const rec = botRecord(id);
      rec[score === 1 ? 'w' : score === 0 ? 'l' : 'd'] += 1;
      store.set(`bot-record-${id}`, JSON.stringify(rec));
      store.set(`bot-game-${id}`, 'null');
      head(P.bot.name, `${score === 1 ? 'Victoire' : score === 0 ? 'Défaite' : 'Nulle'} · ${recordText(id)}`);
      msg(text, score === 1 ? 'good' : score === 0 ? 'bad' : '');
      setBoard(P.c, P.orient, P.lastPlayed, false);
      actions([['Revanche', () => startBot(id), true], ['Analyser cette partie', () => openGame(pgnOfGame())]]);
      return;
    }
    if (P.free) {
      // Fin d'une partie libre : rien n'est recompté.
      head(P.def.title, P.result === 1 ? 'Réussi' : 'À refaire');
      msg(`${text} Le résultat de l’essai était déjà compté.`, '');
      setBoard(P.c, P.orient, P.lastPlayed, false);
      actions(afterActions());
      return;
    }
    P.result = score;
    const solved = score === 1;
    // Seul le premier essai compte pour l'Elo, comme pour les problèmes.
    if (P.retry) {
      showElo(id);
    } else {
      const e = getElo(id);
      const r = updateElo(e, e.r, score);
      setElo(id, { r: r.r, n: r.n });
      showElo(id, r.delta);
    }
    if (solved) store.set(`current-${id}`, 'null');
    else { P.tries += 1; saveCurrent(id, { fen: P.startFen, rated: true, tries: P.tries }); }
    head(P.def.title, solved ? 'Réussi' : 'À refaire');
    msg(solved ? text : `${text} Il faut réussir cette position pour passer à la suivante.`, solved ? 'good' : score === 0 ? 'bad' : '');
    setBoard(P.c, P.orient, P.lastPlayed, false);
    actions(afterActions(over === undefined && P.c.turn() === P.user && !P.c.isGameOver()));
  }

  // Après le verdict, la partie peut se poursuivre jusqu'au mat : plus de limite de coups, plus d'Elo en jeu.
  function continueFree() {
    if (!P.done || P.c.isGameOver()) return;
    P.done = false;
    P.free = true;
    P.thinking = false;
    P.my = ++session;
    subtitle();
    msg('Partie libre : le résultat est déjà compté. À toi de jouer.');
    setBoard(P.c, P.orient, P.lastPlayed, true, onSituationMove);
    actions(afterActions());
  }

  /* ---------- Affronte un bot ---------- */

  const botRecord = (id) => ({ w: 0, d: 0, l: 0, ...(readJson(`bot-record-${id}`) || {}) });
  const recordText = (id) => { const r = botRecord(id); return `Bilan : ${r.w} V · ${r.d} N · ${r.l} D`; };
  const saveBotGame = () => { if (P.bot && !P.done) store.set(`bot-game-${P.id}`, JSON.stringify({ user: P.user, moves: P.c.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || '')) })); };
  // Abandon : une partie à peine commencée est simplement annulée, sans compter comme une défaite.
  const resign = () => ['Abandonner', () => {
    if (P.c.history().length < 2) { store.set(`bot-game-${P.id}`, 'null'); startBot(P.id); } else endSituation(0, 'Tu as abandonné.', true);
  }];
  const liveActions = () => (P.bot ? [resign()] : P.free ? afterActions() : [abandon()]);

  // Partie en cours enregistrée : rejouée coup par coup, ignorée si elle n'est plus lisible.
  function savedBotGame(id) {
    const s = readJson(`bot-game-${id}`);
    if (!s || !Array.isArray(s.moves) || !s.moves.length || !['w', 'b'].includes(s.user)) return null;
    try {
      const c = new Chess();
      s.moves.forEach((u) => c.move(parse(u)));
      return c.isGameOver() ? null : { c, user: s.user, last: s.moves[s.moves.length - 1] };
    } catch { return null; }
  }

  // color : 'w', 'b', 'resume' pour reprendre la partie enregistrée ; sans couleur, l'écran de choix s'affiche.
  async function startBot(id, color) {
    const my = freshSession();
    const bot = BOTS.find((b) => b.id === id);
    actions([]);
    if (!bot) { head('Affronte un bot', ''); $('t-elo').textContent = ''; $('t-delta').textContent = ''; msg('Ce bot n’existe pas.', 'bad'); return; }
    $('t-elo').textContent = bot.elo;
    $('t-delta').textContent = '';
    const saved = savedBotGame(id);
    Object.assign(P, { def: { title: bot.name }, id, bot, c: new Chess(), user: 'w', my, ply: 0, done: true, startFen: START_FEN, thinking: false, orient: 'white', lastPlayed: null, retry: false, tries: 0, free: true, verdict: 0, streak: 0, result: null, maia: true });
    if (!color) {
      head(bot.name, recordText(id));
      setBoard(saved ? saved.c : P.c, saved ? colorName(saved.user) : 'white', saved ? saved.last : null, false);
      if (saved) {
        msg('Une partie est en cours contre ce bot.');
        actions([['Reprendre la partie', () => startBot(id, 'resume'), true], ['Nouvelle partie', () => { store.set(`bot-game-${id}`, 'null'); startBot(id); }]]);
      } else {
        msg('Choisis ta couleur.');
        actions([['Blancs', () => startBot(id, 'w'), true], ['Noirs', () => startBot(id, 'b'), true], ['Au hasard', () => startBot(id, Math.random() < 0.5 ? 'w' : 'b')]]);
      }
      return;
    }
    const resumed = color === 'resume' && saved;
    const c = resumed ? saved.c : new Chess();
    const user = resumed ? saved.user : color === 'b' ? 'b' : 'w';
    Object.assign(P, { c, user, ply: c.history().length, done: false, thinking: true, orient: colorName(user), lastPlayed: resumed ? saved.last : null });
    setBoard(c, P.orient, P.lastPlayed, false);
    head(bot.name, 'Préparation…');
    msg(`Chargement de ${bot.name}…`);
    let maiaError = null;
    let waiting = true;
    const human = ensureMaia((pct) => { if (my === session && waiting) msg(`Chargement de ${bot.name} : ${pct} %`); })
      .then(() => true, (err) => { maiaError = err; return false; });
    // Le bot joue avec Maia ; le moteur n'est que son remplaçant. Il suffit que l'un des deux soit là.
    let engineError = null;
    const [maiaReady] = await Promise.all([human, ensureEngine().catch((err) => { engineError = err; })]);
    waiting = false;
    if (my !== session) return;
    if (!maiaReady && engineError) {
      msg(`${bot.name} n’a pas pu être chargé (${reason(maiaError)}). Vérifie ta connexion, puis réessaie.`, 'bad');
      actions([['Réessayer', () => startBot(id, resumed ? 'resume' : user), true]]);
      return;
    }
    P.maia = maiaReady;
    subtitle();
    const note = P.maia ? '' : ` Le modèle de ${bot.name} n’a pas pu être chargé (${reason(maiaError)}) : il joue avec le moteur seul, sans son style.`;
    if (c.turn() === user) {
      P.thinking = false;
      msg(`${resumed ? 'Partie reprise. ' : ''}À toi de jouer.${note}`);
      setBoard(c, P.orient, P.lastPlayed, true, onSituationMove);
      actions(liveActions());
    } else {
      if (note) msg(note.trim());
      await opponentTurn(my);
    }
  }

  /* ---------- Accueil des exercices ---------- */

  function renderHub() {
    const bots = $('bots-list');
    if (bots) bots.replaceChildren(...BOTS.map((b) => h('a', { class: 'tile', href: `#bot-${b.id}` },
      h('span', { class: 'tile-ic', 'aria-hidden': 'true' }, b.icon),
      h('span', { class: 'tile-main' }, h('strong', {}, b.name), h('small', {}, b.blurb)),
      h('span', { class: 'elo-chip' }, String(b.elo)))));
    const box = $('hub-sits');
    if (!box) return;
    $('hub-puzzle-elo').textContent = getElo('puzzle').r;
    box.replaceChildren(...SITUATIONS.map((s) => h('a', { class: 'tile', href: `#situation-${s.id}` },
      h('span', { class: 'tile-ic', 'aria-hidden': 'true' }, s.icon),
      h('span', { class: 'tile-main' }, h('strong', {}, s.title), h('small', {}, s.blurb)),
      h('span', { class: 'elo-chip' }, String(getElo(s.id).r)))));
  }

  return {
    renderHub,
    titleOf: (id) => (id.startsWith('bot:') ? (BOTS.find((b) => b.id === id.slice(4)) || {}).name || 'Affronte un bot' : (SITUATIONS.find((s) => s.id === id) || {}).title || 'Mise en situation'),
    open(id) { if (id === 'puzzle') nextPuzzle(); else if (id.startsWith('bot:')) startBot(id.slice(4)); else startSituation(id); },
    close() {
      session += 1;
      if (cancelPromo) cancelPromo();
      dropEngine();
    },
  };
}
