// Filet anti-régression des commentaires, sur 16 parties analysées par l'appli (tests/corpus/states.json).
//  1. Règles : des propriétés que tout commentaire doit respecter. Une violation fait échouer le test.
//  2. Instantané : le texte de chaque commentaire est comparé à la version validée (snapshot.json).
//     Tout changement fait échouer le test et est listé dans tests/corpus/diff.txt, à relire ;
//     « node tests/corpus.mjs --accept » enregistre la nouvelle version une fois la relecture faite.
import fs from 'fs'; import path from 'path'; import { X, A, here, plain } from './lib.mjs';
const dir = path.join(here, 'corpus'); const S = JSON.parse(fs.readFileSync(path.join(dir, 'states.json')));
const accept = process.argv.includes('--accept');
const WEAK = /double les pions|paire de fous|pion passé|pion isolé|plus de cases|gagne de l’espace|force le roi adverse|à l’abri|sort une pièce|prend de la place/;
const now = {}; const broken = []; let n = 0; let ms = 0;
const fail = (key, rule, text) => broken.push(`${key} — ${rule}\n      ${text.slice(0, 260)}`);
S.forEach((g, gi) => {
  const r = A.buildReport(g.plies, g.evals, g.bookPlies); const keys = {};
  g.plies.forEach((ply, i) => {
    const move = r.moves[i]; if (move.pending) return;
    const key = `P${gi + 1} ${Math.floor(i / 2) + 1}${ply.color === 'w' ? '.' : '…'}${ply.san}`;
    let ex; const t = performance.now();
    try { ex = X.explainMove({ fenBefore: g.fens[i], fenAfter: g.fens[i + 1], ply, before: g.evals[i], after: g.evals[i + 1], move, index: i, prev: g.plies[i - 1], avoid: keys[i - 2] || null }); } catch (e) { fail(key, `exception : ${e.message}`, ''); return; }
    ms += performance.now() - t; keys[i] = ex.key; n += 1;
    const text = plain(ex); now[key] = `[${move.kind}] ${text}`;
    if (['book', 'forced'].includes(move.kind)) return;
    const first = ex.sentences[0] || ''; const grave = !move.playedBest && move.loss >= 10;
    // --- Règles ---
    if (!ex.sentences.length) fail(key, 'aucun commentaire', text);
    if (/undefined|NaN|\[object|\bnull\b| de le | à le | de les | à les |  |,\s*,|: \.|\(\)/.test(text)) fail(key, 'texte mal formé', text);
    if (text.length > 700) fail(key, 'commentaire trop long (> 700 caractères)', text);
    if (grave && /^Mieux valait/.test(first)) fail(key, 'erreur ou gaffe sans raison sur le coup joué', text);
    if (grave) { const b = ex.sentences.find((s) => /^Mieux valait/.test(s)) || ''; const why = b.split(/, car | : /)[1] || ''; if (WEAK.test(why) && !/empêche|ne marche plus|pare le mat/.test(why)) fail(key, 'erreur ou gaffe expliquée par une remarque faible', text); }
    if (ply.san.endsWith('#') && !/mat/.test(text)) fail(key, 'mat non annoncé', text);
    if (ply.san.endsWith('#') && /Légèrement mieux|Mieux valait/.test(text)) fail(key, 'un mat ne peut pas être amélioré', text);
    if (move.playedBest && /Mieux valait/.test(text)) fail(key, 'meilleur coup avec « mieux valait »', text);
    const line = X.walk(g.fens[i], [ply.uci, ...((g.evals[i + 1] && g.evals[i + 1].pv) || [])]);
    const retaken = line[1] && line[1].m.captured && line[1].m.to === ply.to;
    if (move.playedBest && retaken && /menace|fourchette|cloue|à la fois/.test(first)) fail(key, 'menace prêtée à une pièce prise au coup suivant', text);
    if (/hors de l’échec|parer l’échec/.test((ex.sentences.find((s) => /^Mieux valait/.test(s)) || ''))) fail(key, 'parer l’échec donné comme raison d’un meilleur coup', text);
    if (/(car|:) ça échange.*donne plus de cases|plus de cases à la dame/.test(text) && ply.captured === 'q') fail(key, 'échange de dames décrit de travers', text);
    if (ex.details && typeof ex.details !== 'function') fail(key, 'détails calculés d’avance (coût inutile)', text);
    if (ex.details) { try { const d = ex.details(); if (!d.blocks.length || d.blocks.some((b) => !b.lines.length)) fail(key, 'panneau « Comprendre » vide', text); } catch (e) { fail(key, `panneau « Comprendre » en erreur : ${e.message}`, text); } }
  });
});
const snapFile = path.join(dir, 'snapshot.json'); const old = fs.existsSync(snapFile) ? JSON.parse(fs.readFileSync(snapFile)) : null;
const changed = old ? Object.keys(now).filter((k) => old[k] !== now[k]) : [];
console.log(`${n} commentaires sur ${S.length} parties, ${(ms / n).toFixed(1)} ms par commentaire`);
console.log(broken.length ? `RÈGLES : ${broken.length} violation(s)\n   ${broken.join('\n   ')}` : 'RÈGLES : aucune violation');
if (ms / n > 20) { console.log('LENTEUR : plus de 20 ms par commentaire'); broken.push('lenteur'); }
if (!old || accept) { fs.writeFileSync(snapFile, JSON.stringify(now, null, 0).replace(/","/g, '",\n"')); fs.rmSync(path.join(dir, 'diff.txt'), { force: true }); console.log(`INSTANTANÉ : ${old ? `${changed.length} changement(s) enregistré(s)` : 'créé'}`); process.exit(broken.length ? 1 : 0); }
if (changed.length) fs.writeFileSync(path.join(dir, 'diff.txt'), changed.map((k) => `${k}\n  AVANT ${old[k]}\n  APRÈS ${now[k]}`).join('\n'));
console.log(changed.length ? `INSTANTANÉ : ${changed.length} commentaire(s) ont changé — à relire dans tests/corpus/diff.txt, puis --accept` : 'INSTANTANÉ : identique à la version validée');
process.exit(broken.length || changed.length ? 1 : 0);
