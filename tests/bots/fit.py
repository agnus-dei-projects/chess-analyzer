# Étape 5. Usage : python3 tests/bots/fit.py <dossier des données>
# Écrit model.json (répertoire, rythme) et mesure, sur des parties mises de côté, ce que chaque ingrédient apporte.
# Ajuste le style par maximum de vraisemblance et mesure la ressemblance sur des parties mises de côté.
import json, sys, numpy as np, collections
D = sys.argv[1]; d = json.load(open(D + '/dataset.json')); F = d['features']; rows = d['rows']; nf = len(F)
BOOK_MIN = int(sys.argv[2]) if len(sys.argv) > 2 else 2
K = max(len(r['f']) for r in rows)
X = np.zeros((len(rows), K, nf + 1)); mask = np.zeros((len(rows), K), bool); y = np.array([r['his'] for r in rows]); g = np.array([r['g'] for r in rows])
for i, r in enumerate(rows):
    k = len(r['f']); X[i, :k, 0] = r['logp']; X[i, :k, 1:] = r['f']; mask[i, :k] = True
EARLY = 24  # demi-coups : en début de partie, une seule occurrence suffit pour entrer au répertoire
def make_book(idx):
    c = collections.defaultdict(collections.Counter); early = set()
    for i in idx:
        c[rows[i]['key']][rows[i]['uci']] += 1
        if rows[i]['ply'] < EARLY: early.add(rows[i]['key'])
    return {k: v for k, v in c.items() if sum(v.values()) >= BOOK_MIN or k in early}
def probs(w, Xs, ms):
    s = Xs @ w; s[~ms] = -1e9; s -= s.max(1, keepdims=True); e = np.exp(s); return e / e.sum(1, keepdims=True)
def fit(idx, free, l2=1.0, steps=1500, lr=0.05):
    w = np.zeros(nf + 1); w[0] = 1.0; Xs, ms, ys = X[idx], mask[idx], y[idx]; m = np.zeros_like(w); v = np.zeros_like(w)
    onehot = np.zeros(ms.shape); onehot[np.arange(len(ys)), ys] = 1
    for t in range(1, steps + 1):
        p = probs(w, Xs, ms); grad = ((onehot - p)[:, :, None] * Xs).sum((0, 1)) / len(ys); reg = l2 * w / len(ys); reg[0] = 0; grad -= reg
        grad[~free] = 0; m = 0.9 * m + 0.1 * grad; v = 0.999 * v + 0.001 * grad ** 2; w += lr * (m / (1 - 0.9 ** t)) / (np.sqrt(v / (1 - 0.999 ** t)) + 1e-8)
    return w
def metrics(w, idx):
    p = probs(w, X[idx], mask[idx]); ph = p[np.arange(len(idx)), y[idx]]
    return np.log(ph).mean(), (p.argmax(1) == y[idx]).mean(), ph.mean()
games = sorted(set(g)); rng = np.random.default_rng(0); perm = rng.permutation(games); folds = [set(perm[i::5]) for i in range(5)]
all_free = np.ones(nf + 1, bool); only_alpha = np.zeros(nf + 1, bool); only_alpha[0] = True; none = np.zeros(nf + 1, bool)
no_sf = all_free.copy(); 
for k in ['loss', 'best', 'mistake', 'blunder']: no_sf[1 + F.index(k)] = False
res = collections.defaultdict(list); bookstats = collections.Counter()
for fold in folds:
    te = np.array([i for i in range(len(rows)) if g[i] in fold]); tr = np.array([i for i in range(len(rows)) if g[i] not in fold])
    # répertoire construit sur les parties d'ajustement seulement
    book = make_book(tr)
    inb = np.array([rows[i]['key'] in book for i in te])
    for name, free in [('Maia seule', none), ('Maia + netteté', only_alpha), ('Maia + style sans moteur', no_sf), ('modèle complet', all_free)]:
        w = fit(tr, free) if free.any() else np.r_[1.0, np.zeros(nf)]
        res[name].append(metrics(w, te)); res[name + ' (hors répertoire)'].append(metrics(w, te[~inb]))
        if name == 'modèle complet':
            # bot complet : répertoire quand la position est connue, modèle sinon
            p = probs(w, X[te], mask[te]); ph = p[np.arange(len(te)), y[te]].copy(); top = (p.argmax(1) == y[te]).astype(float)
            for j, i in enumerate(te):
                if inb[j]:
                    c = book[rows[i]['key']]; n = sum(c.values()); ph[j] = c[rows[i]['uci']] / n; top[j] = float(c.most_common(1)[0][0] == rows[i]['uci'])
            res['BOT (répertoire + modèle)'].append((np.log(np.maximum(ph, 1e-4)).mean(), top.mean(), ph.mean()))
            pm = probs(np.r_[1.0, np.zeros(nf)], X[te], mask[te]); res['Maia seule, dans le répertoire'].append((0, (pm.argmax(1) == y[te])[inb].mean(), pm[np.arange(len(te)), y[te]][inb].mean()))
            res['répertoire, dans le répertoire'].append((0, top[inb].mean(), ph[inb].mean())); bookstats['in'] += inb.sum(); bookstats['n'] += len(te)
print(f"positions : {len(rows)}, parties : {len(games)} ; répertoire : {bookstats['in']}/{bookstats['n']} = {bookstats['in']/bookstats['n']:.1%} des coups")
print(f"{'':42} {'coup le plus probable = le sien':>32} {'proba moyenne de son coup':>27} {'log-vrais.':>11}")
for k, v in res.items():
    a = np.array(v).mean(0); print(f"{k:42} {a[1]:>32.1%} {a[2]:>27.1%} {a[0]:>11.3f}")
w = fit(np.arange(len(rows)), all_free)
print('\nalpha (netteté) =', round(w[0], 3)); 
for k, x in sorted(zip(F, w[1:]), key=lambda t: -abs(t[1])): print(f"  {k:14} {x:+.3f}")
book = {k: dict(c) for k, c in make_book(range(len(rows))).items()}
sp = collections.defaultdict(list)
for r in rows:
    if r['spent'] is not None: sp[min(11, r['ply'] // 2 // 5)].append(r['spent'])
tempo = [round(float(np.median(sp[b])), 1) for b in range(12) if sp[b]]
json.dump({'alpha': round(float(w[0]), 4), 'weights': {k: round(float(x), 4) for k, x in zip(F, w[1:])}, 'book': book, 'tempo': tempo}, open(D + '/model.json', 'w'))
print('répertoire :', len(book), 'positions ; rythme médian (s/coup par tranche de 5 coups) :', tempo)
