// Tests du mode entraînement dans un vrai navigateur, pannes simulées comprises.
// Usage : node tests/navigateur/run.mjs   (Chrome et Playwright requis, voir outils.mjs)
// Construit une version de test, la sert en local, lance les scénarios, puis reconstruit la version normale.
import { spawn, execFileSync } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.join(here, '..', '..'); const port = process.env.PORT || '8766';
execFileSync('node', ['build.js'], { cwd: root, env: { ...process.env, AUDIT: '1' }, stdio: 'ignore' });
const server = spawn('node', [path.join(here, 'serveur.mjs'), path.join(root, 'dist/app'), port], { stdio: 'ignore' });
await new Promise((r) => { setTimeout(r, 800); });
let bad = 0;
for (const f of ['pannes.mjs', 'parcours.mjs', 'bot.mjs']) {
  const code = await new Promise((r) => { spawn('node', [path.join(here, f)], { stdio: 'inherit', env: { ...process.env, BASE: `http://localhost:${port}/` } }).on('exit', r); });
  if (code) bad += 1;
}
server.kill();
execFileSync('node', ['build.js'], { cwd: root, stdio: 'ignore' });
console.log(bad ? '\nDes scénarios sont en échec.' : '\nTous les scénarios passent.');
process.exit(bad ? 1 : 0);
