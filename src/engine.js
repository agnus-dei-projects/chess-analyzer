import { MATE_CP, parseInfo } from './analysis.js';

// Stockfish (version à un seul fil) est servi en fichiers à part, mis en cache par le service worker :
// la page reste légère et le navigateur garde le code compilé d'une ouverture à l'autre.
// Le multi-fil de Stockfish a été écarté : à profondeur fixe, il double le calcul sans finir plus tôt.
const URL_SF = new URL('sf/stockfish-19-lite-single.js', location.href).href;

// Nombre de moteurs pour analyser une partie : chacun prend des positions différentes.
// Même quantité de calcul au total, terminée plus vite sur un téléphone à plusieurs cœurs.
export const POOL_SIZE = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 2));

export class Engine {
  constructor(hash = 32) {
    this.hash = hash;
    this.worker = new Worker(URL_SF);
    this.waiting = null;
    this.last = null;
    this.failed = new Promise((_, reject) => {
      this.worker.onerror = (e) => reject(new Error(e.message || 'moteur indisponible'));
    });
    this.failed.catch(() => {});
    this.worker.onmessage = (e) => this.onLine(String(e.data));
  }

  onLine(line) {
    const info = parseInfo(line);
    if (info) this.last = info.pv.length || !this.last ? info : { ...info, pv: this.last.pv };
    if (info && this.multi && info.pv.length) this.multi.set(info.multipv, info);
    if (this.waiting && this.waiting.test(line)) {
      const { resolve } = this.waiting;
      this.waiting = null;
      resolve(line);
    }
  }

  send(cmd, until) {
    if (this.stopped) return Promise.reject(new Error('moteur arrêté'));
    const done = until
      ? new Promise((resolve, reject) => { this.waiting = { test: (l) => l.startsWith(until), resolve, reject }; })
      : null;
    this.worker.postMessage(cmd);
    return done ? Promise.race([done, this.failed]) : Promise.resolve();
  }

  async init() {
    await this.send('uci', 'uciok');
    await this.send(`setoption name Hash value ${this.hash}`);
    await this.send('ucinewgame');
    await this.send('isready', 'readyok');
  }

  async evaluate(fen, depth, only, moves) {
    this.last = null;
    await this.send(`position fen ${fen}${moves && moves.length ? ` moves ${moves.join(' ')}` : ''}`);
    const line = await this.send(`go depth ${depth}${only ? ` searchmoves ${only.join(' ')}` : ''}`, 'bestmove');
    const l = this.last || { type: 'cp', value: 0, pv: [] };
    return { score: { type: l.type, value: l.value }, pv: l.pv, best: line.split(' ')[1] };
  }

  // Les meilleurs coups de la position, du point de vue du camp au trait.
  async candidates(fen, moves, depth, count) {
    await this.send(`setoption name MultiPV value ${count}`);
    this.multi = new Map();
    await this.send(`position fen ${fen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
    await this.send(`go depth ${depth}`, 'bestmove');
    const found = [...this.multi.values()];
    this.multi = null;
    await this.send('setoption name MultiPV value 1');
    return found.map((i) => ({ uci: i.pv[0], cp: i.type === 'cp' ? i.value : (i.value > 0 ? MATE_CP : -MATE_CP) }));
  }

  // Arrête le calcul et libère la mémoire ; une attente en cours échoue au lieu de rester bloquée.
  stop() {
    this.stopped = true;
    this.worker.terminate();
    if (this.waiting) { const { reject } = this.waiting; this.waiting = null; reject(new Error('moteur arrêté')); }
  }
}
