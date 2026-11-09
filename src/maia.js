// Modèle Maia-3 5M (CSSLab, AGPL-3.0), chargé uniquement quand on en a besoin.
// Le calcul tourne dans un worker (maia-worker.mjs) ; ce module ne fait que lui parler.
const MODEL_BYTES = 22550022;
let worker = null;
let loading = null;
let seq = 0;
const calls = new Map();

async function fetchModel(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`modèle indisponible (${res.status})`);
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const out = new Uint8Array(MODEL_BYTES);
  let received = 0;
  let chunks = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!chunks && received + value.length <= MODEL_BYTES) out.set(value, received);
    else { chunks = chunks || [out.subarray(0, received)]; chunks.push(value); }
    received += value.length;
    onProgress(Math.min(99, Math.round((received / MODEL_BYTES) * 100)));
  }
  if (!chunks) return received === MODEL_BYTES ? out.buffer : out.slice(0, received).buffer;
  const all = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return all.buffer;
}

function call(msg, transfer) {
  return new Promise((resolve, reject) => {
    seq += 1;
    calls.set(seq, { resolve, reject });
    worker.postMessage({ ...msg, id: seq }, transfer || []);
  });
}

export function load(base, onProgress) {
  if (!loading) {
    loading = (async () => {
      const bytes = await fetchModel(`${base}m.onnx`, onProgress);
      worker = new Worker(`${base}maia-worker.mjs`, { type: 'module' });
      worker.onmessage = ({ data }) => {
        const c = calls.get(data.id);
        if (!c) return;
        calls.delete(data.id);
        if (data.ok) c.resolve(data); else c.reject(new Error(data.error));
      };
      worker.onerror = (e) => { calls.forEach((c) => c.reject(new Error(e.message || 'Maia indisponible'))); calls.clear(); };
      await call({ type: 'load', bytes, base }, [bytes]);
    })().catch((err) => {
      if (worker) worker.terminate();
      worker = null;
      loading = null;
      throw err;
    });
  }
  return loading;
}

export async function move(fen, selfElo, oppoElo, temperature) {
  const r = await call({ type: 'move', fen, selfElo, oppoElo, temperature });
  return r.move;
}
