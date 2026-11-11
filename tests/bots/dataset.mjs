// Étape 4. Usage : node tests/bots/dataset.mjs <dossier des données>
// Assemble le jeu d'ajustement : pour chaque position, les candidats avec leurs caractéristiques, et celui qu'il a joué.
import fs from 'fs'; import esbuild from 'esbuild';
const D = process.argv[2]; const R = new URL('../..', import.meta.url).pathname;
await esbuild.build({ entryPoints: [R + '/src/bot.js'], bundle: true, format: 'esm', platform: 'node', outfile: D + '/bot.mjs', logLevel: 'error' });
const B = await import(D + '/bot.mjs');
const rows = JSON.parse(fs.readFileSync(D + '/positions.json')); const M = JSON.parse(fs.readFileSync(D + '/maia.json'));
const SF = { ...JSON.parse(fs.readFileSync(D + '/sf0.json')), ...JSON.parse(fs.readFileSync(D + '/sf1.json')) };
const out = []; let outside = 0; let lowp = 0; const neutral = { alpha: 0, weights: {} };
rows.forEach((r, i) => {
  let cand = B.candidatesOf(M[i]);
  const inMaia = M[i].find((x) => x[0] === r.uci);
  if (!cand.some((x) => x[0] === r.uci)) { outside += 1; if (!inMaia) lowp += 1; cand = [...cand, [r.uci, inMaia ? inMaia[1] : 0.0005]]; }
  const evals = new Map(SF[i] || []);
  const sc = B.weigh(neutral, r.fen, cand, evals, r.prevTo);
  out.push({ g: r.g, ply: r.ply, key: B.bookKey(r.fen), uci: r.uci, his: sc.findIndex((x) => x.uci === r.uci), logp: sc.map((x) => Math.log(Math.max(cand.find((c) => c[0] === x.uci)[1], 1e-4))), f: sc.map((x) => x.f), u: sc.map((x) => x.uci), spent: r.spent });
});
fs.writeFileSync(D + '/dataset.json', JSON.stringify({ features: B.FEATURES, rows: out }));
console.log(out.length, 'positions ; coup joué hors des candidats de Maia (<1 %) :', outside, '; dont absent même à 0,1 % :', lowp, '; sans éval :', rows.filter((_, i) => !SF[i]).length);
