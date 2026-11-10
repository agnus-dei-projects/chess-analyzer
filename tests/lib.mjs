// Outils communs aux tests : charge le code de l'appli tel quel (src/explain.js, src/analysis.js).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import esbuild from 'esbuild';
export const here = path.dirname(fileURLToPath(import.meta.url)); export const root = path.join(here, '..');
const tmp = fs.mkdtempSync('/tmp/chess-tests-');
await esbuild.build({ entryPoints: [path.join(root, 'src/explain.js')], bundle: true, format: 'esm', platform: 'node', outfile: tmp + '/ex.mjs', logLevel: 'error' });
await esbuild.build({ entryPoints: [path.join(root, 'src/analysis.js')], bundle: true, format: 'esm', platform: 'node', outfile: tmp + '/an.mjs', logLevel: 'error' });
export const X = await import(tmp + '/ex.mjs'); export const A = await import(tmp + '/an.mjs');
export const plain = (ex) => [...ex.sentences, ...ex.notes.map((n) => `(${n})`)].join(' ').replace(/\[\[|\]\]/g, '');
