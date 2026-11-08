// Modèle Maia-3 5M (CSSLab, AGPL-3.0), chargé uniquement quand on rejoue une partie.
import { Maia3 } from 'maia3-js/web';

const MODEL_BYTES = 22550022;
let maia = null;
let loading = null;

async function fetchModel(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`modèle indisponible (${res.status})`);
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(99, Math.round((received / MODEL_BYTES) * 100)));
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out.buffer;
}

export function load(base, onProgress) {
  if (maia) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      const modelBytes = await fetchModel(`${base}m.onnx`, onProgress);
      const m = new Maia3({ modelBytes, wasmPaths: base, numThreads: 1 });
      await m.load();
      maia = m;
    })().catch((err) => { loading = null; throw err; });
  }
  return loading;
}

export async function move(fen, selfElo, oppoElo, temperature) {
  const r = await maia.predict({ fen, selfElo, oppoElo, temperature, topP: 0.98 });
  return r.bestMove;
}
