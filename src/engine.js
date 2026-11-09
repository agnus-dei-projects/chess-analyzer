import { MATE_CP, parseInfo } from './analysis.js';

function engineUrl() {
  const b64 = document.getElementById('sf-wasm').textContent.trim();
  const js = atob(document.getElementById('sf-js').textContent.trim());
  // Le moteur réclame son .wasm par fetch : on le lui sert depuis la page,
  // ce qui permet d'ouvrir le fichier sans serveur.
  const prelude = `(function(){var s=atob("${b64}"),u=new Uint8Array(s.length);`
    + 'for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);'
    + 'self.fetch=function(){return Promise.resolve(new Response(u,{headers:{"Content-Type":"application/wasm"}}));};})();\n';
  return URL.createObjectURL(new Blob([prelude, js], { type: 'text/javascript' }));
}

let workerUrl = null;

export class Engine {
  constructor() {
    workerUrl = workerUrl || engineUrl();
    this.worker = new Worker(workerUrl);
    this.waiting = null;
    this.last = null;
    this.failed = new Promise((_, reject) => {
      this.worker.onerror = (e) => reject(new Error(e.message || 'moteur indisponible'));
    });
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
    const done = until
      ? new Promise((resolve) => { this.waiting = { test: (l) => l.startsWith(until), resolve }; })
      : null;
    this.worker.postMessage(cmd);
    return done ? Promise.race([done, this.failed]) : Promise.resolve();
  }

  async init() {
    await this.send('uci', 'uciok');
    await this.send('setoption name Hash value 32');
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

  stop() { this.worker.terminate(); }
}

