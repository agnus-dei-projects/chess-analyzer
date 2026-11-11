# Étape 8 (facultative). Usage : python3 tests/bots/bookexp.py   (depuis le dossier qui contient data/)
# Mesure ce que les parties plus anciennes apportent au répertoire, sur les parties récentes mises de côté.
import json, numpy as np, collections, datetime, sys
d=json.load(open('data/dataset.json')); rows=d['rows']; old=json.load(open('data/oldpos.json'))
g=np.array([r['g'] for r in rows]); games=sorted(set(g)); rng=np.random.default_rng(0); perm=rng.permutation(games); folds=[set(perm[i::5]) for i in range(5)]
A=1.75
top=np.array([int(np.argmax(r['logp']))==r['his'] for r in rows],float)
def pa(r):
    p=np.exp(A*np.array(r['logp'])); p/=p.sum(); return p[r['his']]
samp=np.array([pa(r) for r in rows])
ts=lambda s: datetime.datetime.strptime(s,'%Y-%m-%d').timestamp()
def run(since, blitz, m, E, wold=1.0, label=''):
    res=[]
    for fold in folds:
        c=collections.defaultdict(collections.Counter); early=set()
        if since:
            t0=ts(since)
            for gi,ply,key,uci,end,rapid in old:
                if end>=t0 and (rapid or blitz):
                    c[key][uci]+=wold
                    if ply<E: early.add(key)
        for i,r in enumerate(rows):
            if r['g'] in fold: continue
            c[r['key']][r['uci']]+=1
            if r['ply']<E: early.add(r['key'])
        te=[i for i,r in enumerate(rows) if r['g'] in fold]
        inb=[]; t1=[]; sm=[]
        for i in te:
            r=rows[i]; e=c.get(r['key']); n=sum(e.values()) if e else 0
            if e and (n>=m or r['key'] in early):
                inb.append(1); t1.append(float(e.most_common(1)[0][0]==r['uci'])); sm.append(e[r['uci']]/n)
            else: inb.append(0); t1.append(top[i]); sm.append(samp[i])
        inb=np.array(inb,bool); t1=np.array(t1); sm=np.array(sm)
        res.append((inb.mean(), t1[inb].mean() if inb.any() else 0, sm[inb].mean() if inb.any() else 0, t1.mean(), sm.mean()))
    a=np.array(res).mean(0); print(f"{label:58} {a[0]:>8.1%} {a[1]:>9.1%} {a[2]:>9.1%} {a[3]:>10.1%} {a[4]:>10.1%}")
print(f"{'répertoire construit sur':58} {'couvert':>8} {'1er choix':>9} {'tirage':>9} {'BOT 1er':>10} {'BOT tirage':>10}")
run(None,0,2,24,label='6 derniers mois seuls (actuel)')
for since in ['2025-06-01','2024-06-01','2023-01-01']:
    run(since,0,2,24,label=f'+ rapides depuis {since}')
    run(since,1,2,24,label=f'+ rapides et blitz depuis {since}')
print('--- règle d\'entrée (rapides+blitz depuis 2023) : nb minimal d\'occurrences m, ou début de partie avant le demi-coup E')
for m,E in [(1,0),(2,0),(3,0),(2,24),(2,40),(3,24),(5,24)]:
    run('2023-01-01',1,m,E,label=f'm={m}, E={E}')
print('--- poids des anciennes parties (rapides+blitz depuis 2023, m=2, E=24)')
for w in [0.25,0.5,1.0]: run('2023-01-01',1,2,24,wold=w,label=f'poids {w}')
print('--- répertoire à deux étages : les 6 derniers mois d\'abord ; sinon les anciennes parties si la position y est assez vue et son choix assez constant')
def run2(since, blitz, m_old, conc, label):
    t0=ts(since); oc=collections.defaultdict(collections.Counter)
    for gi,ply,key,uci,end,rapid in old:
        if end>=t0 and (rapid or blitz): oc[key][uci]+=1
    oc={k:v for k,v in oc.items() if sum(v.values())>=m_old and v.most_common(1)[0][1]/sum(v.values())>=conc}
    res=[]
    for fold in folds:
        c=collections.defaultdict(collections.Counter); early=set()
        for i,r in enumerate(rows):
            if r['g'] in fold: continue
            c[r['key']][r['uci']]+=1
            if r['ply']<24: early.add(r['key'])
        te=[i for i,r in enumerate(rows) if r['g'] in fold]; inb=[]; t1=[]; sm=[]; src=[]
        for i in te:
            r=rows[i]; e=c.get(r['key']); n=sum(e.values()) if e else 0
            if e and (n>=2 or r['key'] in early): pass
            elif r['key'] in oc: e=oc[r['key']]; n=sum(e.values())
            else: e=None
            if e: inb.append(1); t1.append(float(e.most_common(1)[0][0]==r['uci'])); sm.append(e[r['uci']]/n)
            else: inb.append(0); t1.append(top[i]); sm.append(samp[i])
        inb=np.array(inb,bool); t1=np.array(t1); sm=np.array(sm)
        res.append((inb.mean(), t1[inb].mean(), sm[inb].mean(), t1.mean(), sm.mean()))
    a=np.array(res).mean(0); print(f"{label:58} {a[0]:>8.1%} {a[1]:>9.1%} {a[2]:>9.1%} {a[3]:>10.1%} {a[4]:>10.1%}   ({len(oc)} positions anciennes)")
for since in ['2024-06-01','2023-01-01']:
  for blitz in (0,1):
    for m_old,conc in [(1,0),(2,0),(2,0.7),(3,0.7),(3,0.8),(5,0.8)]:
        run2(since,blitz,m_old,conc,f"depuis {since[:4]}{' +blitz' if blitz else ''}, vue ≥{m_old} fois, constance ≥{conc}")
