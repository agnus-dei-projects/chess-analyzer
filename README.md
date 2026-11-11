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

## Tests du mode entraînement

- `tests/training.mjs` (compris dans `npm test`) contrôle sans navigateur les positions des mises en situation, leurs seuils, et la lecture des problèmes (deux sources, données abîmées, pannes).
- `node tests/navigateur/run.mjs` joue les parcours dans Chrome avec des pannes simulées : téléchargement coupé ou figé, fichier du moteur manquant, Maia ou le moteur qui ne répondent plus en pleine partie, cache abîmé, sources de problèmes en panne. Il demande Chrome et Playwright, qui ne sont pas installés par le projet (voir `tests/navigateur/outils.mjs`).

Règles du mode entraînement que ces tests protègent :

- Aucune attente sans limite : chaque chargement et chaque calcul a un délai, puis un second essai ou un message avec un bouton.
- Le modèle Maia (37 Mo avec son moteur de calcul) se télécharge avec reprise et se range dans le cache ; s'il reste indisponible, l'adversaire joue avec le moteur bridé à son Elo, et l'écran le dit.
- Un verdict donné par l'évaluation doit tenir deux tours de suite ; après le verdict, la partie peut se poursuivre librement jusqu'au mat.
- Après trois essais manqués sur une même position, on peut en changer.

## Bots (« Affronte un bot »)

Un bot imite un vrai joueur à partir de ses parties. Le modèle (`src/bots/<nom>.json`) contient trois choses, et rien d'autre : ni parties, ni pseudo.

- **Répertoire d'ouvertures** : pour chaque position qu'il a rencontrée en début de partie (ou au moins deux fois), les coups qu'il a joués et leur fréquence. Le bot tire selon ces fréquences.
- **Elo et netteté** : hors répertoire, le bot tire un coup de Maia à l'Elo du joueur, en lui donnant le fil de la partie (8 dernières positions). La netteté du tirage est réglée pour que le bot se trompe aussi souvent que le joueur.
- **Rythme** : le temps de réflexion affiché suit son temps médian par coup selon le stade de la partie, réduit.

jakbot, construit sur 104 parties rapides (10 min) de juin à octobre 2026, 4 346 coups. Mesures sur des parties mises de côté (5 groupes) :

| | Son coup = premier choix du modèle |
|---|---|
| Maia à son Elo, sans le fil de la partie | 55,8 % |
| Maia à son Elo, avec le fil de la partie | 57,9 % |
| Dans son répertoire : Maia / répertoire | 48 % / 97 % |
| Bot complet (répertoire + Maia) | 62,8 % |

- Netteté 1,75 : le bot perd en moyenne 0,52 pion par coup et 15,3 % de ses coups perdent au moins un pion, contre 0,51 et 15,3 % pour le joueur (Stockfish profondeur 10). Son coup est alors celui que tire le bot environ 54 % du temps hors répertoire, contre 48 % sans réglage.
- Essayé et écarté : repondérer les coups par des habitudes de jeu (échanges, échecs, pièces jouées, roques, jugement du moteur). Sur ces 104 parties, cela n'a pas rapproché le bot du joueur (59,0 % dans les deux cas hors répertoire).

Pour refaire ou ajouter un bot : `tests/bots/` (étapes numérotées en tête de chaque fichier). Les parties viennent de l'API publique de Chess.com et ne sont pas dans le dépôt.

## Signalements

Le bouton « Signaler ce commentaire » garde le signalement sur l'appareil (réglages, « Signalements »). « Tout copier » les exporte en un bloc. Avec un jeton GitHub limité aux tickets de ce dépôt, saisi dans les réglages et gardé sur l'appareil, ils sont envoyés comme tickets « [Signalement] ».

`node tests/signalements.mjs --github` (ou un fichier contenant le bloc copié) rejoue chaque signalement avec les calculs du moteur tels que l'appli les avait.
