// Problèmes : base Lichess (6 millions, CC0), servie par le jeu de données public Hugging Face.
import { Chess } from 'chess.js';

const ROWS = 'https://datasets-server.huggingface.co/rows?dataset=Lichess/chess-puzzles&config=default&split=train';
const TOTAL = 6150000;
const POOL_MAX = 500;
const SEEN_MAX = 30000;

export const expected = (r, opp) => 1 / (1 + 10 ** ((opp - r) / 400));

export function updateElo(rec, opp, score) {
  const K = rec.n < 20 ? 40 : rec.n < 60 ? 24 : 16;
  const delta = Math.round(K * (score - expected(rec.r, opp)));
  return { r: Math.max(100, rec.r + delta), n: rec.n + 1, delta };
}

export function fromRow(row) {
  const moves = String(row.Moves).trim().split(/\s+/);
  const c = new Chess(row.FEN);
  c.move({ from: moves[0].slice(0, 2), to: moves[0].slice(2, 4), promotion: moves[0][4] });
  return { id: row.PuzzleId, start: c.fen(), lastMove: moves[0], solution: moves.slice(1), rating: row.Rating, themes: row.Themes || [] };
}

function fromLichess(j) {
  return { id: j.puzzle.id, start: j.puzzle.fen, lastMove: j.puzzle.lastMove, solution: j.puzzle.solution, rating: j.puzzle.rating, themes: j.puzzle.themes || [] };
}

export function createPool(store) {
  const load = (k, d) => { try { return JSON.parse(store.get(k)) || d; } catch { return d; } };
  let pool = load('puzzle-pool', []);
  let seen = new Set(load('puzzle-seen', []));
  let filling = null;
  const save = () => { store.set('puzzle-pool', JSON.stringify(pool)); };

  async function fetchRows() {
    const offset = Math.floor(Math.random() * (TOTAL - 100));
    const res = await fetch(`${ROWS}&offset=${offset}&length=100`);
    if (!res.ok) throw new Error(`rows ${res.status}`);
    const j = await res.json();
    return j.rows.map((x) => x.row).filter((r) => r.Popularity >= 50 && r.NbPlays >= 30 && r.RatingDeviation <= 110).map(fromRow);
  }
  async function fetchLichess(target) {
    const diff = target < 1050 ? 'easiest' : target < 1350 ? 'easier' : target < 1650 ? 'normal' : target < 1950 ? 'harder' : 'hardest';
    const res = await fetch(`https://lichess.org/api/puzzle/next?difficulty=${diff}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`lichess ${res.status}`);
    return [fromLichess(await res.json())];
  }
  function refill(target) {
    if (!filling) {
      filling = (async () => {
        let got = [];
        try { got = await fetchRows(); } catch { got = await fetchLichess(target); }
        const known = new Set(pool.map((p) => p.id));
        got.filter((p) => !seen.has(p.id) && !known.has(p.id)).forEach((p) => pool.push(p));
        if (pool.length > POOL_MAX) pool = pool.slice(-POOL_MAX);
        save();
      })().finally(() => { filling = null; });
    }
    return filling;
  }
  const near = (t, w) => pool.filter((p) => Math.abs(p.rating - t) <= w);

  return {
    async next(rating) {
      // Légère variation autour de ton Elo, pour alterner difficulté et réussite.
      const target = rating + (Math.random() * 200 - 90);
      for (let i = 0; i < 6 && near(target, 120).length < 1; i += 1) {
        try { await refill(target); } catch (err) { if (!pool.length) throw err; break; }
      }
      if (!pool.length) throw new Error('vide');
      const pick = pool.slice().sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target))[0];
      pool = pool.filter((p) => p !== pick);
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
