// Maia-3 tourne ici, hors du fil de l'interface : l'écran reste fluide pendant que l'adversaire réfléchit.
import * as ort from 'onnxruntime-web';
import { Maia3 } from 'maia3-js/web';

let maia = null;
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      // Le moteur de calcul ONNX est fourni par la page, qui l'a téléchargé avec reprise et mis en cache.
      if (data.wasm) ort.env.wasm.wasmBinary = data.wasm;
      const m = new Maia3({ modelBytes: data.bytes, wasmPaths: data.base, numThreads: 1 });
      await m.load();
      maia = m;
      self.postMessage({ id, ok: true });
    } else if (type === 'move') {
      const r = await maia.predict({ fen: data.fen, selfElo: data.selfElo, oppoElo: data.oppoElo, temperature: data.temperature, topP: 0.98 });
      self.postMessage({ id, ok: true, move: r.bestMove });
    } else if (type === 'policy') {
      // Toutes les probabilités de coups, sans tirage : la page choisit elle-même (bots au style personnalisé).
      // priorFens : jusqu'à 8 positions précédentes, de la plus ancienne à la plus récente (Maia tient compte du fil de la partie).
      const r = await maia.predict({ fen: data.fen, priorFens: data.priorFens && data.priorFens.length ? data.priorFens : undefined, selfElo: data.selfElo, oppoElo: data.oppoElo, temperature: 1, topP: 1, topK: 0 });
      self.postMessage({ id, ok: true, moves: [...r.moves.entries()] });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
