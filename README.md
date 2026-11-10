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

Polices Young Serif, Instrument Sans et JetBrains Mono (SIL Open Font License 1.1), servies depuis `docs/fonts/` via Fontsource.

Problèmes : [base de problèmes Lichess](https://database.lichess.org/) (CC0), lue via le jeu de données public Hugging Face `Lichess/chess-puzzles`.

## Tests des commentaires

`npm test` lance deux contrôles, à faire passer avant toute mise en ligne :

- `tests/run.mjs` rejoue chaque position signalée (`tests/cases.json`) comme dans l'appli et vérifie ce que le commentaire doit dire et ne doit plus dire.
- `tests/corpus.mjs` recalcule les commentaires de 16 parties analysées (`tests/corpus/states.json`), vérifie des règles valables pour tout commentaire, et compare chaque texte à la version validée (`tests/corpus/snapshot.json`). Tout changement est listé dans `tests/corpus/diff.txt` pour relecture ; `node tests/corpus.mjs --accept` l'enregistre ensuite.

## Signalements

Le bouton « Signaler ce commentaire » garde le signalement sur l'appareil (réglages, « Signalements »). « Tout copier » les exporte en un bloc. Avec un jeton GitHub limité aux tickets de ce dépôt, saisi dans les réglages et gardé sur l'appareil, ils sont envoyés comme tickets « [Signalement] ».

`node tests/signalements.mjs --github` (ou un fichier contenant le bloc copié) rejoue chaque signalement avec les calculs du moteur tels que l'appli les avait.
