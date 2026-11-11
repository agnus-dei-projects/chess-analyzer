// Modèle Maia-3 5M (CSSLab, AGPL-3.0), chargé uniquement quand on en a besoin.
// Le calcul tourne dans un worker (maia-worker.mjs) ; ce module ne fait que lui parler.
import { within } from './within.js';

// Les deux gros fichiers (37 Mo au total) : le modèle et le moteur de calcul ONNX.
// Leur taille exacte, relevée à la construction, sert à la progression et à vérifier le fichier reçu.
const FILES = [['m.onnx', __MAIA_MODEL_BYTES__], ['ort-wasm-simd-threaded.wasm', __MAIA_WASM_BYTES__]];
const TOTAL = FILES.reduce((n, f) => n + f[1], 0);
const CACHE = 'chess-analyzer-maia-5m-v1'; // même nom que dans le service worker
const STALL_MS = 15000; // sans aucun octet reçu pendant ce temps, la connexion est relancée
const TRIES = 3; // essais de suite sans le moindre progrès avant d'abandonner
const LOAD_MS = 60000;
const MOVE_MS = 8000;

let worker = null;
let loading = null;
let seq = 0;
const calls = new Map();
const listeners = new Set();
// Un téléchargement interrompu reprend où il s'était arrêté, même après un « Réessayer ».
const partial = new Map();
let pct = 0;

const pause = (ms) => new Promise((r) => { setTimeout(r, ms); });
const have = new Map(); // octets déjà là, par fichier
const report = (name, bytes) => {
  have.set(name, bytes);
  let got = 0;
  FILES.forEach(([n, size]) => { got += Math.min(have.get(n) || 0, size); });
  pct = Math.min(99, Math.round((got / TOTAL) * 100));
  listeners.forEach((fn) => fn(pct));
};

async function openCache() {
  try { return typeof caches === 'undefined' ? null : await caches.open(CACHE); } catch { return null; }
}

async function download(url, name, size) {
  const st = partial.get(name) || { buf: new Uint8Array(size), got: 0 };
  partial.set(name, st);
  let tries = 0;
  for (;;) {
    const ctl = new AbortController();
    let timer = null;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), STALL_MS); };
    try {
      arm();
      const res = await fetch(url, { signal: ctl.signal, headers: st.got ? { Range: `bytes=${st.got}-` } : undefined });
      if (!res.ok) {
        const err = new Error(`fichier indisponible (${res.status})`);
        if (res.status === 416) st.got = 0; else err.fatal = res.status >= 400 && res.status < 500;
        throw err;
      }
      const resumed = res.status === 206;
      if (!resumed) st.got = 0; // le serveur renvoie tout le fichier : on repart du début
      const push = (value) => {
        if (st.got + value.length > st.buf.length) {
          const bigger = new Uint8Array(Math.max(st.buf.length * 2, st.got + value.length));
          bigger.set(st.buf.subarray(0, st.got));
          st.buf = bigger;
        }
        st.buf.set(value, st.got);
        st.got += value.length;
        tries = 0;
        report(name, st.got);
      };
      if (!res.body) push(new Uint8Array(await res.arrayBuffer()));
      else {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          arm();
          push(value);
        }
      }
      clearTimeout(timer);
      if (st.got !== size) {
        // Taille inattendue : après une reprise on repart de zéro ; sur un fichier reçu d'une traite, inutile d'insister.
        const err = new Error('fichier inattendu');
        err.fatal = !resumed;
        st.got = 0;
        throw err;
      }
      partial.delete(name);
      return st.buf.buffer;
    } catch (err) {
      clearTimeout(timer);
      tries += 1;
      if (err.fatal) throw err;
      if (tries >= TRIES) throw new Error('téléchargement interrompu');
      await pause(700 * 2 ** (tries - 1));
    }
  }
}

// Le fichier vient du cache s'il y est entier ; sinon il est téléchargé puis rangé dans le cache.
async function getFile(base, name, size) {
  const url = `${base}${name}`;
  const cache = await openCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const bytes = await hit.arrayBuffer();
        if (bytes.byteLength === size) { report(name, size); return bytes; }
        await cache.delete(url);
      }
    } catch { /* cache illisible : on télécharge */ }
  }
  const bytes = await download(url, name, size);
  // La copie rangée dans le cache est faite avant que les octets ne partent vers le worker.
  if (cache) cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) } })).catch(() => {});
  return bytes;
}

function call(msg, transfer) {
  return new Promise((resolve, reject) => {
    seq += 1;
    calls.set(seq, { resolve, reject });
    worker.postMessage({ ...msg, id: seq }, transfer || []);
  });
}

// Arrête le worker ; le prochain chargement en recrée un (les fichiers sont alors dans le cache).
function reset(err) {
  if (worker) worker.terminate();
  worker = null;
  loading = null;
  calls.forEach((c) => c.reject(err || new Error('Maia indisponible')));
  calls.clear();
}

export function load(base, onProgress) {
  if (onProgress) { listeners.add(onProgress); if (loading) onProgress(pct); }
  if (!loading) {
    loading = (async () => {
      const [model, wasm] = await Promise.all(FILES.map(([name, size]) => getFile(base, name, size)));
      try {
        worker = new Worker(`${base}maia-worker.mjs`, { type: 'module' });
        worker.onmessage = ({ data }) => {
          const c = calls.get(data.id);
          if (!c) return;
          calls.delete(data.id);
          if (data.ok) c.resolve(data); else c.reject(new Error(data.error));
        };
        worker.onerror = (e) => reset(new Error(e.message || 'Maia indisponible'));
        await within(call({ type: 'load', bytes: model, wasm, base }, [model, wasm]), LOAD_MS, 'le modèle ne démarre pas');
      } catch (err) {
        // Des fichiers abîmés dans le cache seraient resservis à chaque essai : on les retire.
        if (!err.timeout) { const cache = await openCache(); if (cache) await Promise.all(FILES.map(([name]) => cache.delete(`${base}${name}`))).catch(() => {}); }
        throw err;
      }
    })().then(() => { listeners.clear(); }, (err) => {
      listeners.clear();
      reset(err);
      throw err;
    });
  }
  return loading;
}

export async function move(fen, selfElo, oppoElo, temperature) {
  if (!worker) throw new Error('Maia indisponible');
  try {
    return (await within(call({ type: 'move', fen, selfElo, oppoElo, temperature }), MOVE_MS, 'Maia ne répond plus')).move;
  } catch (err) {
    if (err.timeout) reset(err);
    throw err;
  }
}

// Probabilité de chaque coup légal selon Maia, sous forme de liste [coup, probabilité].
export async function policy(fen, selfElo, oppoElo, priorFens) {
  if (!worker) throw new Error('Maia indisponible');
  try {
    return (await within(call({ type: 'policy', fen, selfElo, oppoElo, priorFens }), MOVE_MS, 'Maia ne répond plus')).moves;
  } catch (err) {
    if (err.timeout) reset(err);
    throw err;
  }
}
