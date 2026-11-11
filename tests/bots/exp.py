# Étape 6. Usage : python3 tests/bots/exp.py <dossier des données>
# Compare les nettetés du tirage, avec et sans la couche de style, sur des parties mises de côté.
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
def fit(idx, free, l2=1.0, steps=800, lr=0.05, a0=1.0):
    w = np.zeros(nf + 1); w[0] = a0; Xs, ms, ys = X[idx], mask[idx], y[idx]; m = np.zeros_like(w); v = np.zeros_like(w)
    onehot = np.zeros(ms.shape); onehot[np.arange(len(ys)), ys] = 1
    for t in range(1, steps + 1):
        p = probs(w, Xs, ms); grad = ((onehot - p)[:, :, None] * Xs).sum((0, 1)) / len(ys); reg = l2 * w / len(ys); reg[0] = 0; grad -= reg
        grad[~free] = 0; m = 0.9 * m + 0.1 * grad; v = 0.999 * v + 0.001 * grad ** 2; w += lr * (m / (1 - 0.9 ** t)) / (np.sqrt(v / (1 - 0.999 ** t)) + 1e-8)
    return w
def metrics(w, idx):
    p = probs(w, X[idx], mask[idx]); ph = p[np.arange(len(idx)), y[idx]]
    return np.log(ph).mean(), (p.argmax(1) == y[idx]).mean(), ph.mean()

games = sorted(set(g)); rng = np.random.default_rng(0); perm = rng.permutation(games); folds = [set(perm[i::5]) for i in range(5)]
feat = np.ones(nf + 1, bool); feat[0] = False
print(f"{'':34} {'son coup = tirage du bot':>26} {'son coup = 1er choix':>22} {'log-vrais.':>11}   (positions hors répertoire)")
for a in [1.0, 1.5, 2.0, 3.0]:
    for name, free in [('Maia seule', None), ('+ style et moteur', feat)]:
        out = []
        for fold in folds:
            te = np.array([i for i in range(len(rows)) if g[i] in fold]); tr = np.array([i for i in range(len(rows)) if g[i] not in fold])
            book = make_book(tr); te = np.array([i for i in te if rows[i]['key'] not in book]); trn = np.array([i for i in tr if True])
            w = fit(trn, free, a0=a) if free is not None else np.r_[a, np.zeros(nf)]
            out.append(metrics(w, te))
        m = np.array(out).mean(0); print(f"netteté {a:<4} {name:22} {m[2]:>26.1%} {m[1]:>22.1%} {m[0]:>11.3f}")
