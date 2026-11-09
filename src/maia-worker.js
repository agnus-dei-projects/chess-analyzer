// Maia-3 tourne ici, hors du fil de l'interface : l'écran reste fluide pendant que l'adversaire réfléchit.
import { Maia3 } from 'maia3-js/web';

let maia = null;
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      const m = new Maia3({ modelBytes: data.bytes, wasmPaths: data.base, numThreads: 1 });
      await m.load();
      maia = m;
      self.postMessage({ id, ok: true });
    } else if (type === 'move') {
      const r = await maia.predict({ fen: data.fen, selfElo: data.selfElo, oppoElo: data.oppoElo, temperature: data.temperature, topP: 0.98 });
      self.postMessage({ id, ok: true, move: r.bestMove });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
