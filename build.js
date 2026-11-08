const fs = require('fs');
const esbuild = require('esbuild');
const r = (p) => fs.readFileSync(p);
if (!fs.existsSync('src/sample.json')) fs.writeFileSync('src/sample.json', 'null');
const js = esbuild.buildSync({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020' }).outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const a = 'node_modules/chessground/assets/';
const css = r(a + 'chessground.base.css').toString() + r(a + 'chessground.cburnett.css').toString();
const sf = 'node_modules/stockfish/bin/stockfish-19-lite-single';
const out = r('src/template.html').toString()
  .replace('/*CHESSGROUND*/', () => css)
  .replace('/*SF_JS*/', () => r(sf + '.js').toString('base64'))
  .replace('/*SF_WASM*/', () => r(sf + '.wasm').toString('base64'))
  .replace('/*BUNDLE*/', () => js);
const crypto = require('crypto');
const version = crypto.createHash('sha1').update(out).digest('hex').slice(0, 10);
fs.mkdirSync('dist/app', { recursive: true });
fs.writeFileSync('dist/app/index.html', out);
for (const f of fs.readdirSync('pwa')) {
  const body = fs.readFileSync('pwa/' + f);
  fs.writeFileSync('dist/app/' + f, f === 'sw.js' ? body.toString().replace('__VERSION__', version) : body);
}
console.log((out.length / 1e6).toFixed(2) + ' MB');
