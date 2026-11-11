const fs = require('fs');
const esbuild = require('esbuild');
const r = (p) => fs.readFileSync(p);
const js = esbuild.buildSync({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', define: { __AUDIT__: process.env.AUDIT ? 'true' : 'false' } }).outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const a = 'node_modules/chessground/assets/';
const css = r(a + 'chessground.base.css').toString() + r(a + 'chessground.cburnett.css').toString();
const out = r('src/template.html').toString()
  .replace('/*CHESSGROUND*/', () => css)
  .replace('/*BUNDLE*/', () => js);
const crypto = require('crypto');
const version = crypto.createHash('sha1').update(out).update(r('pwa/sw.js')).update(r('src/engine-worker.js')).update(r('src/maia.js')).update(r('src/maia-worker.js')).update(r('node_modules/stockfish/package.json')).digest('hex').slice(0, 10);
fs.mkdirSync('dist/app', { recursive: true });
fs.writeFileSync('dist/app/index.html', out);
for (const f of fs.readdirSync('pwa')) {
  const body = fs.readFileSync('pwa/' + f);
  fs.writeFileSync('dist/app/' + f, f === 'sw.js' ? body.toString().replace('__VERSION__', version) : body);
}
// Stockfish et polices : fichiers à part, mis en cache par le service worker.
fs.mkdirSync('dist/app/sf', { recursive: true });
fs.rmSync('dist/app/sf', { recursive: true, force: true });
fs.mkdirSync('dist/app/sf', { recursive: true });
fs.copyFileSync('src/engine-worker.js', 'dist/app/sf/engine.js');
fs.copyFileSync('node_modules/stockfish/bin/stockfish-19-lite-single.js', 'dist/app/sf/stockfish.js');
fs.copyFileSync('node_modules/stockfish/bin/stockfish-19-lite-single.wasm', 'dist/app/sf/engine.wasm');
fs.mkdirSync('dist/app/fonts', { recursive: true });
for (const [pkg, file] of [['young-serif', 'young-serif-400'], ['instrument-sans', 'instrument-sans-400'], ['instrument-sans', 'instrument-sans-500'], ['instrument-sans', 'instrument-sans-600'], ['jetbrains-mono', 'jetbrains-mono-400'], ['jetbrains-mono', 'jetbrains-mono-600']]) {
  const w = file.split('-').pop();
  fs.copyFileSync(`node_modules/@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`, `dist/app/fonts/${file}.woff2`);
}
// Maia-3 : fichiers à part, téléchargés seulement quand on rejoue une partie.
fs.mkdirSync('dist/app/maia', { recursive: true });
const size = (p) => String(fs.statSync(p).size);
const MAIA_MODEL = 'node_modules/maia3-js/models/maia3_5m.onnx';
const MAIA_WASM = 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm';
esbuild.buildSync({ entryPoints: ['src/maia.js'], bundle: true, minify: true, format: 'esm', outfile: 'dist/app/maia/maia.mjs', target: 'es2020', define: { __MAIA_MODEL_BYTES__: size(MAIA_MODEL), __MAIA_WASM_BYTES__: size(MAIA_WASM) } });
esbuild.buildSync({ entryPoints: ['src/maia-worker.js'], bundle: true, minify: true, format: 'esm', outfile: 'dist/app/maia/maia-worker.mjs', external: ['onnxruntime-node'], alias: { 'onnxruntime-web': 'onnxruntime-web/wasm' }, target: 'es2020' });
fs.copyFileSync('node_modules/maia3-js/models/maia3_5m.onnx', 'dist/app/maia/m.onnx');
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) fs.copyFileSync('node_modules/onnxruntime-web/dist/' + f, 'dist/app/maia/' + f);
console.log((out.length / 1e6).toFixed(2) + ' MB');
