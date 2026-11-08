# Chess Analyzer

Webapp personnelle d'analyse de parties d'échecs, installable sur téléphone.
Le moteur tourne sur l'appareil. Les parties viennent de l'API publique de Chess.com.

Outil indépendant, sans affiliation avec Chess.com.

- `src/` : code de l'application
- `pwa/` : manifest, service worker, icônes
- `docs/` : version construite, servie par GitHub Pages
- `npm install && node build.js` reconstruit `dist/app`

## Licences

Moteur : [Stockfish](https://github.com/official-stockfish/Stockfish) via
[stockfish.js](https://github.com/nmrugg/stockfish.js), GPL v3. Échiquier :
[chessground](https://github.com/lichess-org/chessground), GPL v3. Ce projet est distribué sous GPL v3.

Le mode « Rejouer » utilise [Maia-3](https://github.com/CSSLab/maia3) (CSSLab, Université de Toronto) :
le modèle 5M et son code sont sous AGPL-3.0 (voir `LICENSE-AGPL-3.0.txt`). Le modèle est servi depuis `docs/maia/`.
Il est chargé via [maia3-js](https://www.npmjs.com/package/maia3-js) (MIT) et onnxruntime-web (MIT).
