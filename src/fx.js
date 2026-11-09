// Sons de pièces synthétisés (aucun fichier audio) et effets visuels sur l'échiquier.
import { Chess } from 'chess.js';

export function kindOf(san) {
  if (san.endsWith('#')) return 'mate';
  if (san.endsWith('+')) return 'check';
  if (san.includes('x')) return 'capture';
  if (san.startsWith('O-O')) return 'castle';
  return 'move';
}

function noiseBuffer(ctx) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Un coup sur du bois : bruit bref filtré, plus une note grave pour le corps.
function knock(ctx, out, noise, t, { freq = 1150, q = 2.2, decay = 0.05, level = 0.9, body = 190 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass'; band.frequency.value = freq; band.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
  src.connect(band).connect(g).connect(out);
  src.start(t); src.stop(t + decay + 0.02);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(body * 1.25, t);
  o.frequency.exponentialRampToValueAtTime(body, t + 0.05);
  const gb = ctx.createGain();
  gb.gain.setValueAtTime(level * 0.55, t);
  gb.gain.exponentialRampToValueAtTime(0.0008, t + decay * 1.5);
  o.connect(gb).connect(out);
  o.start(t); o.stop(t + decay * 1.5 + 0.02);
}

function tone(ctx, out, t, freq, dur, level, type = 'triangle') {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0008, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur + 0.02);
}

export function schedule(kind, ctx, out, noise, t) {
  if (kind === 'move') knock(ctx, out, noise, t);
  else if (kind === 'castle') { knock(ctx, out, noise, t); knock(ctx, out, noise, t + 0.11, { freq: 1000, level: 0.8 }); }
  else if (kind === 'capture') { knock(ctx, out, noise, t, { freq: 1900, q: 1.4, decay: 0.035, level: 1 }); knock(ctx, out, noise, t + 0.022, { freq: 760, decay: 0.08, level: 0.95, body: 150 }); }
  else if (kind === 'check') { knock(ctx, out, noise, t); tone(ctx, out, t + 0.04, 880, 0.13, 0.2); tone(ctx, out, t + 0.12, 1175, 0.2, 0.2); }
  else if (kind === 'mate') { knock(ctx, out, noise, t, { freq: 800, decay: 0.1, level: 1, body: 130 }); tone(ctx, out, t + 0.08, 523, 0.26, 0.24); tone(ctx, out, t + 0.28, 392, 0.3, 0.24); tone(ctx, out, t + 0.5, 262, 0.55, 0.28); }
}

export function createFx(store) {
  let ctx = null; let noise = null; let master = null; let sleepTimer = 0;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enabled = () => store.get('sound') !== 'off';

  function ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!ctx) {
      ctx = new AC();
      noise = noiseBuffer(ctx);
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return true;
  }
  // Une sortie audio ouverte garde le circuit son du téléphone éveillé : on la met en veille
  // 3 s après le dernier son, et on la réveille au coup suivant.
  function sleepLater() {
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 3000);
  }
  // Les navigateurs mobiles n'autorisent le son qu'après un geste : le premier toucher le déverrouille.
  document.addEventListener('pointerdown', () => { if (enabled() && (!ctx || ctx.state !== 'running')) { ensure(); sleepLater(); } }, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden && ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); });

  function sound(kind, delay) {
    if (!enabled() || !ensure()) return;
    schedule(kind, ctx, master, noise, ctx.currentTime + delay / 1000 + 0.005);
    sleepLater();
  }

  function burst(el, square, orientation, cls, delay) {
    if (reduced()) return;
    let col = square.charCodeAt(0) - 97;
    let row = 8 - +square[1];
    if (orientation === 'black') { col = 7 - col; row = 7 - row; }
    const f = document.createElement('div');
    f.className = `fx ${cls}`;
    f.style.left = `${col * 12.5}%`;
    f.style.top = `${row * 12.5}%`;
    f.style.animationDelay = `${delay}ms`;
    el.append(f);
    setTimeout(() => f.remove(), delay + 900);
  }

  return {
    duration: () => (reduced() ? 0 : 230),
    enabled,
    setEnabled(on) { store.set('sound', on ? 'on' : 'off'); if (on) { ensure(); sound('move', 0); } },
    /** animated : la pièce glisse encore, le son attend son arrivée. */
    played({ san, to, fen, el, orientation, animated = true }) {
      const delay = animated && !reduced() ? 175 : 0;
      const kind = kindOf(san);
      sound(kind, delay);
      if (kind === 'capture') burst(el, to, orientation, 'fx-capture', delay);
      if (kind === 'mate') {
        const c = new Chess(fen);
        const king = c.board().flat().find((p) => p && p.type === 'k' && p.color === c.turn());
        if (king) burst(el, king.square, orientation, 'fx-mate', delay);
      }
    },
  };
}

if (__AUDIT__) {
  window.__render = async () => {
    const out = {};
    for (const k of ['move', 'capture', 'castle', 'check', 'mate']) {
      const ctx = new OfflineAudioContext(1, 44100 * 1.4, 44100);
      schedule(k, ctx, ctx.destination, noiseBuffer(ctx), 0.01);
      const b = await ctx.startRendering();
      const d = b.getChannelData(0);
      let peak = 0; let last = 0;
      for (let i = 0; i < d.length; i += 1) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a > 0.003) last = i; }
      out[k] = { peak: +peak.toFixed(2), ms: Math.round(last / 44.1) };
    }
    return out;
  };
}
