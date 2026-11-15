// Pièges classiques ajoutés à la main. Chacun est vérifié par Stockfish dans construire.mjs (profondeur 16) : le coup
// fautif doit perdre au moins 0,9 pion, et chaque coup de la punition doit être à moins de 0,5 pion du meilleur.
// line : depuis la position initiale ; bait : rang (à partir de 0) du coup fautif dans line ; la suite montre la punition.

export const CLASSIC_TRAPS = [
  { opening: 'philidor', title: 'Piège de Légal', line: 'e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5 Bxd1 Bxf7+ Ke7 Nd5#', bait: 9,
    text: 'Le cavalier e5 semble abandonner la dame, mais prendre la dame (…Bxd1) permet un mat en deux coups avec Bxf7+ et Nd5#.' },
  { opening: 'deux-cavaliers', title: 'Attaque du foie frit', line: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3', bait: 9,
    text: 'Reprendre en d5 avec le cavalier n’est pas une gaffe pour le moteur (environ un pion de moins que …Na5), mais c’est très dangereux en pratique : le sacrifice Nxf7 puis Qf3+ attire le roi noir au centre sous une attaque durable. Le coup recommandé est …Na5.' },
  { opening: 'petrov', title: 'Le piège de la copie', line: 'e4 e5 Nf3 Nf6 Nxe5 Nxe4 Qe2 Nf6 Nc6+', bait: 7,
    text: 'Copier les Blancs avec …Nxe4 est imprécis mais jouable. En revanche, reculer ensuite le cavalier (…Nf6) ouvre la colonne e : Nc6+ est un échec à la découverte qui gagne la dame. Après Qe2, il faut jouer …Qe7.' },
  { opening: 'gambit-roi', title: 'Le pion empoisonné du gambit refusé', line: 'e4 e5 f4 Bc5 fxe5 Qh4+ g3 Qxe4+', bait: 4,
    text: 'Contre le gambit refusé (…Bc5), prendre en e5 ouvre la diagonale du roi : …Qh4+ puis …Qxe4+ fourche le roi et la tour h1.' },
  { opening: 'italienne', title: 'Gambit Blackburne Shilling', line: 'e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5 Qg5 Nxf7 Qxg2 Rf1 Qxe4+ Be2 Nf3#', bait: 8,
    text: 'Après …Nd4, prendre e5 est déjà risqué ; continuer avec Nxf7 (fourche dame-tour) ignore la menace sur g2 : la dame noire entre et mate en f3.' },
  { opening: 'espagnole', title: 'Piège de l’arche de Noé', line: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 d6 d4 b5 Bb3 Nxd4 Nxd4 exd4 Qxd4 c5 Qd5 Be6 Qc6+ Bd7 Qd5 c4', bait: 14,
    text: 'Reprendre le pion d4 avec la dame permet …c5 puis …c4 : le fou b3 est enfermé par les pions noirs et sera perdu.' },
  { opening: 'gambit-dame', title: 'Piège de l’éléphant', line: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Nbd7 cxd5 exd5 Nxd5 Nxd5 Bxd8 Bb4+ Qd2 Bxd2+ Kxd2 Kxd8', bait: 10,
    text: 'Le cavalier d7 semble laisser d5 sans défense à cause du clouage, mais Nxd5 échoue : …Nxd5 abandonne la dame, puis …Bb4+ la récupère, et les Noirs gagnent une pièce contre un pion.' },
  { opening: 'gambit-dame', title: 'Garder le pion du gambit accepté', line: 'd4 d5 c4 dxc4 e3 b5 a4 c6 axb5 cxb5 Qf3', bait: 9,
    text: 'Défendre le pion c4 avec …b5 est déjà douteux. Après a4 c6 axb5, reprendre avec …cxb5 ouvre la grande diagonale : Qf3 attaque la tour a8 et les Noirs perdent au moins une pièce.' },
  { opening: 'caro-kann', title: 'Le mat étouffé en d6', line: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7 Qe2 Ngf6 Nd6#', bait: 9,
    text: 'Avec la dame en e2 sur la colonne e, le pion e7 est cloué : le cavalier en d6 donne mat, le roi étant entouré de ses propres pièces.' },
  { opening: 'francaise', title: 'Piège de la variante d’avance', line: 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 Bd3 cxd4 cxd4 Nxd4 Nxd4 Qxd4 Bb5+', bait: 15,
    text: 'Le pion d4 a l’air gratuit, mais après …Qxd4 l’échec à la découverte Bb5+ laisse la dame noire en prise à la dame d1.' },
  { opening: 'hollandaise', title: 'Le mat en g6', line: 'd4 f5 Bg5 h6 Bh4 g5 Bg3 f4 e3 h5 Bd3 Rh6 Qxh5+ Rxh5 Bg6#', bait: 11,
    text: 'Les pions f, g et h avancés ont ouvert la diagonale du roi noir : Qxh5+ sacrifie la dame pour un mat avec Bg6#.' },
  { opening: 'bird', title: 'Mat du gambit From', line: 'f4 e5 fxe5 d6 exd6 Bxd6 Nc3 Qh4+ g3 Qxg3+ hxg3 Bxg3#', bait: 6,
    text: 'Contre le gambit From, Nf3 est indispensable pour couvrir h4. Sans lui, …Qh4+ puis …Qxg3+ et …Bxg3# donnent mat.' },
  { opening: 'smith-morra', title: 'Piège sibérien', line: 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 e6 Bc4 Qc7 Qe2 Nf6 O-O Ng4 h3 Nd4', bait: 16,
    text: 'Chasser le cavalier g4 avec h3 est naturel mais perd : …Nd4 attaque la dame. Si Nxd4, …Qh2# (le cavalier f3 ne défend plus h2). Selon Stockfish, la meilleure défense des Blancs consiste à donner la dame contre un cavalier.' },
];
