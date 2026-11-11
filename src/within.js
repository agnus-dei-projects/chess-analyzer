// Fait échouer une attente qui dure trop longtemps, au lieu de laisser l'écran bloqué.
export function within(promise, ms, message) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => { const e = new Error(message); e.timeout = true; reject(e); }, ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
