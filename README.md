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

Coups de théorie : [ouvertures nommées de Lichess](https://github.com/lichess-org/chess-openings) (CC0).

Problèmes : [base de problèmes Lichess](https://database.lichess.org/) (CC0), lue via le jeu de données public Hugging Face `Lichess/chess-puzzles`.

## Coups de théorie

Un coup est « de théorie » d'après deux sources, la plus longue l'emporte :

- le lien d'ouverture que Chess.com joint à la partie (`ECOUrl`), lu jusqu'au dernier coup qui correspond à la partie (roques compris) ;
- la base des ouvertures nommées de Lichess (3 865 lignes, 7 982 positions, `data/lichess-openings/`, domaine public), par position : un autre ordre de coups compte, jusqu'à la dernière position de la base atteinte dans les 40 premiers demi-coups. `src/book.json` est construit par `node tests/ouvertures/livre.mjs`.

La théorie s'arrête au premier coup que le moteur juge imprécis ou pire : une ligne nommée peut être perdante (le mat du lion en fait partie). Sur 202 parties rapides récentes de roipionnier, 43 n'avaient aucun coup de théorie avec le seul lien Chess.com (lien sans coups, roque dans le lien, autre ordre de coups) ; aucune avec les deux sources. Contrôles : `tests/livre.mjs`.

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

## Elo des exercices

- Chaque exercice (problèmes, chaque thème de mise en situation) a son Elo. Seul le premier essai d'une position ou d'un problème compte.
- L'Elo bouge vite au début (±50 à niveau égal pendant les 15 premiers essais, ±25 jusqu'au 30e) puis se stabilise (±12, puis ±8 après 80 essais).
- Un thème jamais joué démarre à la moyenne des Elo déjà stabilisés (au moins 15 essais), problèmes compris ; à défaut, à 800.
- Mesures (novembre 2026) :
  - Problèmes, joueurs simulés de force fixe, difficultés tirées de la vraie base : un joueur de 2000 parti de 800 atteint 1850 en 40 problèmes (1450 avec l'ancien réglage) ; de 500 à 2400, l'Elo finit à ±50 du vrai niveau, avec 46 à 54 % de réussite. Au-delà de 2400, la base manque de problèmes assez durs (moins de 2 % au-dessus de 2600).
  - Mises en situation, joueurs simulés Maia 1100 et 1900 dont l'Elo des problèmes est établi : 56 % et 48 % de réussite sur leurs 50 premières parties. Médiane de 8 à 23 coups selon le thème ; 1 partie sur 100 finie en 2 coups ou moins (gaffe ou gain net, confirmé sur deux tours) ; aucune partie bloquée. Aucune des 234 positions de départ n'est déjà au-delà d'un seuil de réussite ou d'échec (Stockfish profondeur 14).
  - Le thème « Ouverture agressive » n'a que 15 positions : elles reviennent vite.

## Ouvertures

Menu Exercices → Ouvertures : 30 ouvertures (15 des Blancs, 15 défenses des Noirs), chacune avec un cours et un entraînement avec l'une ou l'autre couleur.

- **Cours** : idée, ligne principale, forces et faiblesses (textes rédigés dans `src/openings-def.js`) ; puis, calculés : les coups principaux contre l'ouverture (évaluation Stockfish et part des joueurs de 2000 qui les jouent selon Maia), les réponses les plus jouées avec la meilleure réplique, les pièges, et les variantes nommées par Lichess. Chaque coup cité est cliquable.
- **Entraînement** : les coups de départ sont joués d'office ; l'adversaire suit ensuite les variantes connues (16 demi-coups), tirées selon leur popularité, en favorisant les pièges de l'ouverture, puis joue avec Maia à ton niveau. Tes 10 coups suivants sont vérifiés par Stockfish (profondeur 12) : un coup qui perd au moins 0,9 pion (1,5 pour un coup de variante nommée) est signalé avec le meilleur coup, et tu peux le rejouer. Un piège connu est reconnu et expliqué. La partie peut ensuite continuer librement.
- **Données** (`src/openings.json`, construit par `tests/ouvertures/construire.mjs`, étapes en tête du fichier) :
  - variantes : 3 600 lignes nommées de la base Lichess (github.com/lichess-org/chess-openings, domaine public), 4 081 positions ;
  - popularité : Maia-3 à 2000 Elo (réglable : variable ELO des scripts) ; l'explorateur d'ouvertures de Lichess n'a pas pu être interrogé ;
  - lignes principales : chaque coup contrôlé par Stockfish (profondeur 16) ; aucun ne perd plus de 0,6 pion ;
  - 13 pièges classiques (`tests/ouvertures/pieges-classiques.mjs`) : le coup fautif perd au moins 0,9 pion et chaque coup de la punition est à moins de 0,5 pion du meilleur selon Stockfish (profondeur 16) ; deux textes ont été corrigés après vérification (piège sibérien, gambit dame accepté), deux autres nuancés (Petrov, foie frit) ;
  - 52 pièges trouvés automatiquement : un coup que Maia 2000 joue au moins une fois sur dix, dans une position équilibrée, et qui perd au moins deux pions (profondeur 12, confirmé à 16). Leur texte ne contient que la perte chiffrée et la suite du moteur.
  - Londres, catalane, Réti, Trompowsky, Blackmar-Diemer, Pirc et Benoni n'ont aucun piège : aucun coup joué au moins une fois sur dix par Maia 2000 n'y perd deux pions dans les variantes retenues.
- **Forces et faiblesses vérifiées** (`tests/ouvertures/simuler.mjs` puis `verifier.mjs`) : 1 200 parties simulées (40 par ouverture) entre deux joueurs de 2000 (Maia), 15 coups chacun après les coups de départ, chaque position évaluée par Stockfish (profondeur 10). Chaque affirmation est reliée à une mesure (développement, roque, espace, pions centraux, gaffes, échecs reçus, cases attaquées, variantes nommées…) ou, pour ce qui relève du jeu correct (« les Noirs égalisent »), à l'évaluation de Stockfish sur la ligne principale ; les faits de position (« Ng5 attaque f7 ») sont vérifiés sur la position.
  - Premier passage : la méthode a été corrigée avant tout changement de texte (médianes au lieu de moyennes d'évaluation, faussées par les gaffes ; marge d'erreur à 90 % ; variantes nommées comparées à des ouvertures de longueur proche ; mesure de diversité saturée remplacée).
  - Résultat à 1500 (premier passage) : 10 affirmations contredites ont été réécrites (italienne ×2, espagnole, gambit dame, catalane, Réti, Smith-Morra, scandinave, est-indienne, Grünfeld). Sur 118 : 76 confirmées, 33 non tranchées (écart dans la marge d'erreur de 40 parties), 9 non mesurables (réputation, compréhension demandée…). Le cours affiche le verdict et la mesure sous chaque affirmation.
  - Passage de 1500 à 2000 : 8 affirmations contredites à 2000 ont été réécrites (espagnole, Londres, Trompowsky, Bird, Petrov ×2 fusionnées en une, est-indienne, hollandaise), en s'appuyant sur des faits de position vérifiés plutôt que sur des tendances de parties. Sur 117 : 79 confirmées, 30 non tranchées, 8 non mesurables, 0 contredite.
  - Limite : les parties sont celles de joueurs de 2000 ; une affirmation peut être vraie à un autre niveau et non tranchée ici.

## Bots (« Affronte un bot »)

Un bot imite un vrai joueur à partir de ses parties. Le modèle (`src/bots/<nom>.json`) contient trois choses, et rien d'autre : ni parties, ni pseudo.

- **Répertoire d'ouvertures** : pour chaque position qu'il a rencontrée en début de partie (ou au moins deux fois), les coups qu'il a joués et leur fréquence. Le bot tire selon ces fréquences.
- **Elo et netteté** : hors répertoire, le bot tire un coup de Maia à l'Elo du joueur, en lui donnant le fil de la partie (8 dernières positions). La netteté du tirage est réglée pour que le bot se trompe aussi souvent que le joueur.
- **Rythme** : le temps de réflexion affiché suit son temps médian par coup selon le stade de la partie, réduit.

jakbot, construit sur 104 parties rapides (10 min) de juin à octobre 2026, 4 346 coups. Mesures sur des parties mises de côté (5 groupes) :

| | Son coup = premier choix du modèle | Son coup = coup joué par le bot |
|---|---|---|
| Maia à son Elo, sans le fil de la partie | 55,8 % | |
| Maia à son Elo, avec le fil de la partie | 57,9 % | |
| Bot, répertoire des 6 mois, netteté 1,75 | 62,7 % | 58,4 % |
| Bot actuel : répertoire à deux étages, netteté 3 | 63,4 % | 61,6 % |

- **Répertoire à deux étages** : les 6 derniers mois d'abord (885 positions) ; à défaut, les positions de ses parties rapides et blitz depuis juin 2024 (1 709 parties) vues au moins deux fois et où il joue le même coup au moins 7 fois sur 10 (815 positions). Le répertoire couvre 13,5 % de ses coups (10,1 % avant) et il y joue le coup prévu 95 % du temps.
- **Netteté 3** : le bot joue plus souvent le premier choix de Maia. Contrepartie mesurée : il se trompe un peu moins que le joueur (13,9 % de coups perdant au moins un pion contre 15,3 %, Stockfish profondeur 10) et varie moins. À 1,75 les taux d'erreur étaient égaux, mais son coup était moins souvent celui du bot.
- **Plafond** : hors répertoire, le premier choix de Maia est son coup 58,4 % du temps, et son coup est parmi les trois premiers choix 86 % du temps. Maia elle-même n'accorde en moyenne que 60 % à son premier choix : dans la plupart des positions, plusieurs coups sont plausibles pour un même joueur.
- Essayé et écarté, faute de gain mesurable : repondérer les coups par des habitudes de jeu (échanges, échecs, pièces jouées, roques, jugement du moteur) ; régler Maia sur un autre Elo que le sien (1900, 2400, 2700).
- **Taille du modèle Maia**, essayée puis écartée (mêmes 3 761 coups hors répertoire, netteté 3) : son coup est celui joué par le bot 61,5 % du temps avec le 5M (23 Mo), 63,0 % avec le 23M (93 Mo, calcul 3 fois plus lent), 63,8 % avec le 79M (313 Mo, 10 fois plus lent). Gain jugé trop faible pour le poids : jakbot garde le 5M livré avec l'appli.
- Non essayé : un réentraînement de Maia sur ses parties (la publication de référence n'obtient un gain, de 4 à 5 points, qu'à partir de 5 000 parties par joueur).

Pour refaire ou ajouter un bot : `tests/bots/` (étapes numérotées en tête de chaque fichier). Les parties viennent de l'API publique de Chess.com et ne sont pas dans le dépôt.

## Signalements

Le bouton « Signaler ce commentaire » garde le signalement sur l'appareil (réglages, « Signalements »). « Tout copier » les exporte en un bloc. Avec un jeton GitHub limité aux tickets de ce dépôt, saisi dans les réglages et gardé sur l'appareil, ils sont envoyés comme tickets « [Signalement] ».

`node tests/signalements.mjs --github` (ou un fichier contenant le bloc copié) rejoue chaque signalement avec les calculs du moteur tels que l'appli les avait.
