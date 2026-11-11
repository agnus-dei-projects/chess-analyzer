// Enveloppe du moteur : Stockfish envoie des dizaines de lignes par position, et chacune réveillait
// l'interface. Seules la dernière ligne utile de chaque recherche et la réponse finale sont transmises.
const post = self.postMessage.bind(self);
const last = new Map();
self.postMessage = (line) => {
  if (typeof line === 'string' && line.startsWith('info')) {
    if (line.includes(' pv ')) { const m = line.match(/ multipv (\d+)/); last.set(m ? m[1] : '1', line); } else if (line.includes(' score ')) post(line);
    return;
  }
  if (typeof line === 'string' && line.startsWith('bestmove')) { last.forEach((l) => post(l)); last.clear(); }
  post(line);
};
// Une panne au chargement (fichier .wasm introuvable, mémoire) ne remonte pas toute seule à la page :
// sans ce signal, elle attendrait une réponse qui ne viendra jamais.
self.addEventListener('unhandledrejection', (e) => post(`fatal ${(e.reason && e.reason.message) || e.reason || ''}`));
// Stockfish cherche son fichier .wasm sous le nom de ce script (engine.js → engine.wasm).
importScripts('stockfish.js');
