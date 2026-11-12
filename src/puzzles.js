// Problèmes : base Lichess (6 millions, CC0), servie par le jeu de données public Hugging Face.
import { Chess } from 'chess.js';

const ROWS = 'https://datasets-server.huggingface.co/rows?dataset=Lichess/chess-puzzles&config=default&split=train';
const TOTAL = 6150000;
const POOL_MAX = 500;
const SEEN_MAX = 30000;
const FETCH_MS = 8000; // une connexion qui traîne passe à la source suivante au lieu d'attendre sans fin

async function getJson(url, headers) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_MS);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) throw new Error(`réponse ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

const step = (c, u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

// Un problème n'est proposé que si sa position se charge et que toute sa solution est jouable.
export function validPuzzle(p) {
  try {
    if (!p || !Array.isArray(p.solution) || !p.solution.length || !Number.isFinite(p.rating)) return false;
    const c = new Chess(p.start);
    p.solution.forEach((u) => step(c, u));
    return true;
  } catch { return false; }
}

export const expected = (r, opp) => 1 / (1 + 10 ** ((opp - r) / 400));

// L'Elo bouge vite au début pour rejoindre ton niveau en une trentaine d'essais, puis se stabilise.
// (Simulation : avec l'ancien réglage, un joueur de 2000 parti de 800 n'était qu'à 1450 après 40 problèmes.)
export function updateElo(rec, opp, score) {
  const K = rec.n < 15 ? 100 : rec.n < 30 ? 50 : rec.n < 80 ? 24 : 16;
  const delta = Math.round(K * (score - expected(rec.r, opp)));
  return { r: Math.max(100, rec.r + delta), n: rec.n + 1, delta };
}

export function fromRow(row) {
  const moves = String(row.Moves).trim().split(/\s+/);
  const c = new Chess(row.FEN);
  step(c, moves[0]);
  const themes = Array.isArray(row.Themes) ? row.Themes : String(row.Themes || '').split(/\s+/).filter(Boolean);
  return { id: row.PuzzleId, start: c.fen(), lastMove: moves[0], solution: moves.slice(1), rating: row.Rating, themes };
}

// Lichess donne toujours la partie d'origine et le rang du dernier coup avant le problème, et parfois en plus
// la position toute faite. La partie fait foi ; la position fournie ne sert que si la partie ne donne rien de jouable.
export function fromLichess(j) {
  const z = j.puzzle;
  const make = (start, lastMove) => ({ id: z.id, start, lastMove, solution: z.solution, rating: z.rating, themes: z.themes || [] });
  let fromGame = null;
  try {
    const c = new Chess();
    c.loadPgn(j.game.pgn);
    const all = c.history({ verbose: true });
    const last = all[z.initialPly] || all[all.length - 1];
    fromGame = make(last.after, last.from + last.to + (last.promotion || ''));
  } catch { fromGame = null; }
  if (validPuzzle(fromGame)) return fromGame;
  return make(z.fen, z.lastMove);
}

export function createPool(store) {
  const load = (k, d) => { try { return JSON.parse(store.get(k)) || d; } catch { return d; } };
  let pool = load('puzzle-pool', []);
  let seen = new Set(load('puzzle-seen', []));
  let filling = null;
  const save = () => { store.set('puzzle-pool', JSON.stringify(pool)); };

  async function fetchRows() {
    const offset = Math.floor(Math.random() * (TOTAL - 100));
    const j = await getJson(`${ROWS}&offset=${offset}&length=100`);
    const rows = j.rows.map((x) => x.row).filter((r) => r.Popularity >= 50 && r.NbPlays >= 30 && r.RatingDeviation <= 110);
    // Une ligne illisible est ignorée : elle ne fait pas échouer tout le lot.
    return rows.map((r) => { try { return fromRow(r); } catch { return null; } }).filter(validPuzzle);
  }
  async function fetchLichess(target) {
    const diff = target < 1050 ? 'easiest' : target < 1350 ? 'easier' : target < 1650 ? 'normal' : target < 1950 ? 'harder' : 'hardest';
    const p = fromLichess(await getJson(`https://lichess.org/api/puzzle/next?difficulty=${diff}`, { Accept: 'application/json' }));
    if (!validPuzzle(p)) throw new Error('problème illisible');
    return [p];
  }
  function refill(target) {
    if (!filling) {
      filling = (async () => {
        let got = [];
        let source = 'base';
        try { got = await fetchRows(); } catch { source = 'secours'; got = await fetchLichess(target); }
        const known = new Set(pool.map((p) => p.id));
        got.filter((p) => !seen.has(p.id) && !known.has(p.id)).forEach((p) => pool.push(p));
        if (pool.length > POOL_MAX) pool = pool.slice(-POOL_MAX);
        save();
        return source;
      })().finally(() => { filling = null; });
    }
    return filling;
  }
  const near = (t, w) => pool.filter((p) => Math.abs(p.rating - t) <= w);

  return {
    async next(rating) {
      // Légère variation autour de ton Elo, pour alterner difficulté et réussite.
      const target = rating + (Math.random() * 200 - 90);
      // Un problème gardé en réserve mais illisible (données abîmées) est écarté au moment du choix ;
      // si la réserve se vide ainsi, on la remplit de nouveau avant de renoncer.
      let pick = null;
      for (let round = 0; round < 3 && !pick; round += 1) {
        // La base principale en panne, la source de secours ne donne qu'un problème à la fois : on s'en contente.
        let backup = false;
        for (let i = 0; i < 6 && !backup && near(target, 120).length < 1; i += 1) {
          try { backup = (await refill(target)) === 'secours'; } catch (err) { if (!pool.length) throw err; break; }
        }
        while (pool.length && !pick) {
          const best = pool.slice().sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target))[0];
          pool = pool.filter((p) => p !== best);
          if (validPuzzle(best)) pick = best;
        }
      }
      if (!pick) { save(); throw new Error('vide'); }
      seen.add(pick.id);
      if (seen.size > SEEN_MAX) seen = new Set([...seen].slice(-SEEN_MAX));
      store.set('puzzle-seen', JSON.stringify([...seen]));
      save();
      if (near(rating, 150).length < 8) refill(rating).catch(() => {}); // on garde de l'avance, utile hors connexion
      return pick;
    },
    size: () => pool.length,
    seenCount: () => seen.size,
  };
}
