#!/usr/bin/env python3
"""
costruisci.py — rigenera i tre file di dati dei "suggerimenti che capiscono
la frase":

    js/lang/semantica-it.js   significato delle parole   (vettori CC0)
    js/lang/grammatica-it.js  categorie e sequenze       (treebank UD liberi)
    js/lang/coppie-it.js      espressioni dell'italiano  (Common Voice, CC0)

Non serve per usare Aurora: serve solo a chi volesse rigenerarli o
migliorarli. Vedi LEGGIMI.md per le fonti, le licenze e come scaricarle.

uso:
    python3 costruisci.py DATI tutto            # i tre file
    python3 costruisci.py DATI semantica|grammatica|coppie

DATI è una cartella con:
    it_core_news_lg-3.7.0/   il modello spaCy scompattato (solo i VETTORI, CC0)
    UD_<nome>_<parte>.conllu i treebank: MarkIT train, TWITTIRO train,
                             PUD test, ParlaMint train e test
    cv/wiki.it.txt, cv/sentence-collector.txt   le frasi di Common Voice

Requisiti: numpy, scikit-learn, scipy, spacy (solo per leggere i vettori).
"""
import sys, os, re, math, base64, collections, warnings
import numpy as np

warnings.filterwarnings('ignore')
QUI = os.path.dirname(os.path.abspath(__file__))
AURORA = os.path.normpath(os.path.join(QUI, '..', '..'))
LANG = os.path.join(AURORA, 'js', 'lang')
TOK = re.compile(r"[a-zàáèéìíîòóùúç]+")


# ══════════════════════════════════════════════════════════════════
# Vocabolario dei suggerimenti — lo stesso di Predictor.js
# ══════════════════════════════════════════════════════════════════
def vocabolario():
    """Le parole di vocabolario-it.js, poi quelle di seed-it.js (SEED_WORDS),
    nello stesso ordine in cui le legge corpus() in Predictor.js."""
    voc = open(os.path.join(LANG, 'vocabolario-it.js'), encoding='utf8').read()
    i = voc.index('VOCABOLARIO_FREQ_IT = "') + len('VOCABOLARIO_FREQ_IT = "')
    testo = voc[i: voc.index('"', i)].replace('\\n', '\n')
    viste, parole = set(), []
    for riga in testo.split('\n'):
        if ':' not in riga:
            continue
        for w in riga.split(':', 1)[1].split(' '):
            if w and w not in viste:
                viste.add(w); parole.append(w)
    seed = open(os.path.join(LANG, 'seed-it.js'), encoding='utf8').read()
    blocco = seed[seed.index('export const SEED_WORDS'):]
    blocco = blocco[:blocco.index('};')]
    for w in re.findall(r"'([^']+)'\s*:", blocco):
        if w not in viste:
            viste.add(w); parole.append(w)
    return parole


def vettori(dati, parole):
    import spacy
    nlp = spacy.load(os.path.join(dati, 'it_core_news_lg-3.7.0'),
                     exclude=['tagger', 'parser', 'ner', 'morphologizer', 'lemmatizer',
                              'attribute_ruler', 'senter', 'tok2vec'])
    V = nlp.vocab
    X = np.zeros((len(parole), 300), np.float32)
    ok = np.zeros(len(parole), bool)
    for i, w in enumerate(parole):
        if V.has_vector(w):
            X[i] = V.get_vector(w); ok[i] = True
    return X, ok, V


# ══════════════════════════════════════════════════════════════════
# 1. SIGNIFICATO
# ══════════════════════════════════════════════════════════════════
def semantica(dati):
    parole = vocabolario()
    X, ok, _ = vettori(dati, parole)
    D = 64
    Xo = X[ok]; Xc = Xo - Xo.mean(0)
    _, _, Vt = np.linalg.svd(Xc[np.random.RandomState(0).choice(len(Xc), 12000, replace=False)],
                             full_matrices=False)
    P = Xc @ Vt[:D].T
    P /= np.linalg.norm(P, axis=1, keepdims=True)
    Q = np.round(P * 127).clip(-127, 127).astype(np.int8)
    ws = [w for w, o in zip(parole, ok) if o]
    # In ORDINE ALFABETICO, righe comprese: chi legge cerca con una ricerca binaria.
    ordine = sorted(range(len(ws)), key=lambda i: [ord(c) for c in ws[i]])
    ws = [ws[i] for i in ordine]; Q = Q[ordine]
    b64 = base64.b64encode(Q.tobytes()).decode()
    testa = open(os.path.join(QUI, 'testa-semantica.txt'), encoding='utf8').read()
    js = testa + f'export const SEMANTICA_IT = {{\n  D: {D},\n  parole: `' + '\n'.join(ws) + f'`,\n  dati: "{b64}",\n}};\n'
    open(os.path.join(LANG, 'semantica-it.js'), 'w', encoding='utf8').write(js)
    print('semantica-it.js', len(ws), 'parole,', len(js), 'byte')


# ══════════════════════════════════════════════════════════════════
# 2. GRAMMATICA
# ══════════════════════════════════════════════════════════════════
TREEBANK = ['UD_MarkIT_train.conllu', 'UD_TWITTIRO_train.conllu', 'UD_PUD_test.conllu',
            'UD_ParlaMint_train.conllu', 'UD_ParlaMint_test.conllu']


def _gn(f):
    return {'Masc': 'm', 'Fem': 'f'}.get(f.get('Gender'), '') + {'Sing': 's', 'Plur': 'p'}.get(f.get('Number'), '')


def _tag(up, f, form=''):
    if up in ('NOUN', 'ADJ'): return up[0] + '-' + _gn(f)
    if up == 'PROPN': return 'PROPN'
    if up in ('VERB', 'AUX'):
        vf = f.get('VerbForm')
        if not vf:   # alcuni treebank non la indicano: la si ricava dalla desinenza
            if re.search(r'(are|ere|ire|rre)$', form): vf = 'Inf'
            elif form.endswith('ndo'): vf = 'Ger'
            else: vf = 'Fin'
        if vf == 'Inf': return 'V-inf'
        if vf == 'Ger': return 'V-ger'
        if vf == 'Part': return 'V-part-' + _gn(f)
        pn = f.get('Person', '') + {'Sing': 's', 'Plur': 'p'}.get(f.get('Number'), '')
        return 'V-fin-' + (pn if len(pn) == 2 else '3s')
    if up == 'DET': return 'DET-' + _gn(f)
    if up in ('PRON', 'PUNCT'): return up
    return up


def _tag_composto(parti, sf):
    ups = [p[0] for p in parti]
    if ups[:1] == ['ADP'] and len(parti) > 1 and parti[1][0] == 'DET': return 'ADPDET-' + _gn(parti[1][1])
    if ups[0] in ('VERB', 'AUX'): return _tag(parti[0][0], parti[0][1], sf)   # verbo + clitico
    return 'PRON' if 'PRON' in ups else ups[0]


def leggi_conllu(files):
    frasi = []
    for f in files:
        fr, mwt = [], {}
        for r in open(f, encoding='utf8'):
            r = r.rstrip('\n')
            if not r:
                if fr: frasi.append(fr)
                fr, mwt = [], {}; continue
            if r.startswith('#'): continue
            c = r.split('\t')
            if '.' in c[0]: continue
            if '-' in c[0]:
                a, b = map(int, c[0].split('-')); mwt[a] = (b, c[1].lower(), []); continue
            i = int(c[0]); form = c[1].lower(); up = c[3]
            feats = dict(x.split('=') for x in c[5].split('|') if '=' in x)
            dentro = None
            for a, (b, sf, parti) in mwt.items():
                if a <= i <= b: dentro = a; parti.append((up, feats))
            if dentro is not None:
                b, sf, parti = mwt[dentro]
                if i == b: fr.append((sf, _tag_composto(parti, sf)))
                continue
            fr.append((form, _tag(up, feats, form)))
        if fr: frasi.append(fr)
    return frasi


def grammatica(dati):
    from sklearn.linear_model import LogisticRegression
    from sklearn.feature_extraction import FeatureHasher
    from scipy.sparse import hstack, csr_matrix

    tr = leggi_conllu([os.path.join(dati, f) for f in TREEBANK])
    # Daniela non scrive punteggiatura: le frasi scorrono senza punti, e il
    # modello deve conoscere anche "stanca vorrei". Si tolgono punteggiatura,
    # simboli e ciò che non è fatto di lettere.
    frasi = []
    for f in tr:
        cur = [(w, t) for w, t in f if t not in ('PUNCT', 'SYM', 'X') and re.fullmatch(TOK, w)]
        if cur: frasi.append(cur)
    wc = collections.Counter(w for f in frasi for w, _ in f)
    wt = collections.defaultdict(collections.Counter)
    for f in frasi:
        for w, t in f: wt[w][t] += 1
    aperta = lambda t: t.split('-')[0] in ('N', 'A', 'PROPN', 'NUM', 'INTJ')
    lessicali = [w for w, c in wc.most_common() if not aperta(wt[w].most_common(1)[0][0])][:260]
    extra = ('vorrei voglio vuoi vuole devo deve puoi può posso possiamo dobbiamo vogliamo fammi dammi '
             'ho hai ha abbiamo sono sei è siamo mi ti ci vi si non io tu noi voi lei lui me te sto stai '
             'sta stiamo vado vai va andare fare essere avere come quando dove perché cosa chi molto più '
             'troppo poco ancora già sempre').split()
    for w in extra:
        if w not in lessicali: lessicali.append(w)
    L = set(lessicali)

    # ── categorie di ogni parola: conteggi + classificatore (vettori CC0 + desinenze) ──
    parole = vocabolario()
    _, _, V = vettori(dati, parole[:1])
    vec = lambda w: V.get_vector(w) if V.has_vector(w) else np.zeros(300, np.float32)
    H = FeatureHasher(4096, input_type='string')

    def X(ws):
        M = np.array([vec(w) for w in ws]); M = M / np.maximum(np.linalg.norm(M, axis=1, keepdims=True), 1e-6)
        S = H.transform([[f's1={w[-1:]}', f's2={w[-2:]}', f's3={w[-3:]}', f's4={w[-4:]}',
                          f'len={min(len(w), 12)}'] for w in ws])
        return hstack([csr_matrix(M * 3), S]).tocsr()

    viste = list(wt)
    y = [wt[w].most_common(1)[0][0] for w in viste]
    cnt = np.array([sum(wt[w].values()) for w in viste])
    clf = LogisticRegression(max_iter=600, C=4)
    clf.fit(X(viste), np.array(y), sample_weight=np.sqrt(cnt))
    TAGS = [str(c) for c in clf.classes_]; ti = {t: i for i, t in enumerate(TAGS)}
    Pc = clf.predict_proba(X(parole))
    ALPHA = 3.0
    lex = {}
    for i, w in enumerate(parole):
        p = ALPHA * Pc[i].copy(); n = ALPHA
        for t, c in wt.get(w, {}).items():
            if t in ti: p[ti[t]] += c; n += c
        lex[w] = p / n

    # ── cosa segue a cosa ──
    def classe(w):
        if w in L: return w
        if w in lex: return TAGS[int(np.argmax(lex[w]))]
        t = wt.get(w); return t.most_common(1)[0][0] if t else None
    c1 = collections.defaultdict(collections.Counter); c2 = collections.defaultdict(collections.Counter)
    prior = collections.Counter()
    for f in frasi:
        cl = ['<s>', '<s>'] + [classe(w) for w, _ in f]
        for k, (w, t) in enumerate(f):
            if t not in ti: continue
            a, b = cl[k], cl[k + 1]
            prior[t] += 1
            if b: c1[b][t] += 1
            if a and b: c2[a + ' ' + b][t] += 1
    N = sum(prior.values())
    P0 = np.array([(prior[t] + 0.5) / (N + 0.5 * len(TAGS)) for t in TAGS])

    def wb(cnt, base):   # Witten-Bell
        n = sum(cnt.values()); u = len(cnt); lam = n / (n + u) if n else 0
        ml = np.array([cnt.get(t, 0) for t in TAGS], float) / max(n, 1)
        return lam * ml + (1 - lam) * base
    D1 = {k: wb(v, P0) for k, v in c1.items() if sum(v.values()) >= 3}
    D2 = {k: wb(v, D1.get(k.split(' ')[1], P0)) for k, v in c2.items()
          if sum(v.values()) >= 6 and k.split(' ')[1] in D1}

    CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    assert len(TAGS) <= len(CH)

    def cod_lex(p):
        idx = [i for i in np.argsort(-p) if p[i] >= 0.03][:4]
        s = sum(p[i] for i in idx)
        return ''.join(CH[i] + f'{min(99, max(1, round(99 * p[i] / s))):02d}' for i in idx)

    def cod_ctx(d):
        return ''.join(CH[i] + f'{min(9999, round(10000 * d[i])):04d}' for i in range(len(TAGS)) if d[i] >= 0.001)
    lessico = '\n'.join(f'{w}\t{cod_lex(lex[w])}' for w in parole)
    ctx = '\n'.join(f'{k}\t{cod_ctx(v)}' for k, v in list(D1.items()) + list(D2.items()))
    assert '`' not in lessico + ctx and '${' not in lessico + ctx
    testa = open(os.path.join(QUI, 'testa-grammatica.txt'), encoding='utf8').read()
    js = testa + 'export const GRAMMATICA_IT = {\n'
    js += '  TAGS: ' + repr(TAGS).replace("'", '"') + ',\n'
    js += '  LESSICALI: "' + ' '.join(sorted(L)) + '",\n'
    js += '  PRIORI: "' + ','.join(f'{x:.5f}' for x in P0) + '",\n'
    js += '  LESSICO: `' + lessico + '`,\n'
    js += '  CONTESTI: `' + ctx + '`,\n};\n'
    open(os.path.join(LANG, 'grammatica-it.js'), 'w', encoding='utf8').write(js)
    print('grammatica-it.js', len(TAGS), 'categorie,', len(D1) + len(D2), 'contesti,', len(js), 'byte')


# ══════════════════════════════════════════════════════════════════
# 3. COPPIE DELL'ITALIANO
# ══════════════════════════════════════════════════════════════════
def coppie(dati, MINC=4, RMIN=2.0):
    parole = vocabolario(); Vs = set(parole)
    uni = collections.Counter(); bi = collections.Counter(); tri = collections.Counter(); N = 0
    for f in ['cv/wiki.it.txt', 'cv/sentence-collector.txt']:
        for r in open(os.path.join(dati, f), encoding='utf8'):
            # la punteggiatura forte spezza la frase
            for parte in re.split(r'[.!?;:]', r):
                t = TOK.findall(parte.lower().replace('’', "'"))
                if len(t) < 2: continue
                N += len(t); uni.update(t)
                for a, b in zip(t, t[1:]):
                    if b in Vs: bi[(a, b)] += 1
                for a, b, c in zip(t, t[1:], t[2:]):
                    if c in Vs: tri[(a, b, c)] += 1
    cw1 = collections.Counter()
    for (a, b), c in bi.items(): cw1[a] += c
    c12 = collections.Counter()
    for (a, b, c), k in tri.items(): c12[(a, b)] += k
    B, T = {}, {}
    for (a, b), c in bi.items():
        if c < MINC or (a not in Vs and len(a) > 1): continue
        r = ((c - 0.75) / cw1[a]) / (uni[b] / N)
        if r >= RMIN: B.setdefault(a, {})[b] = min(4.5, math.log(r))
    for (a, b, c), k in tri.items():
        if k < MINC or (a, b) not in bi or bi[(a, b)] < MINC: continue
        if (a not in Vs and len(a) > 1) or (b not in Vs and len(b) > 1): continue
        r = ((k - 0.75) / c12[(a, b)]) / (max(bi.get((b, c), 0) - 0.75, 0.25) / max(cw1[b], 1))
        if r >= RMIN: T.setdefault(a + ' ' + b, {})[c] = min(4.5, math.log(r))
    ix = {w: i for i, w in enumerate(parole)}
    A = '0123456789abcdefghijklmnopqrstuvwxyz'
    c3 = lambda i: A[i // 1296] + A[(i // 36) % 36] + A[i % 36]

    def riga(k, d):
        return k + '\t' + ''.join(c3(ix[w]) + str(max(1, min(9, round(v / 0.5))))
                                  for w, v in sorted(d.items(), key=lambda x: -x[1]))
    righe = [riga(k, d) for k, d in B.items()] + [riga(k, d) for k, d in T.items()]
    # ORDINATE per contesto: chi legge le cerca con una ricerca binaria.
    righe.sort(key=lambda r: [ord(c) for c in r.split('\t')[0]])
    testo = '\n'.join(righe)
    assert '`' not in testo and '${' not in testo
    testa = open(os.path.join(QUI, 'testa-coppie.txt'), encoding='utf8').read()
    testa = testa.replace('{MINC}', str(MINC)).replace('{RMIN}', str(RMIN))
    js = testa + 'export const COPPIE_IT = {\n  parole: `' + '\n'.join(parole) + '`,\n  righe: `' + testo + '`,\n};\n'
    open(os.path.join(LANG, 'coppie-it.js'), 'w', encoding='utf8').write(js)
    print('coppie-it.js', len(righe), 'contesti,', len(js), 'byte')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    dati, cosa = sys.argv[1], sys.argv[2]
    if cosa in ('semantica', 'tutto'): semantica(dati)
    if cosa in ('grammatica', 'tutto'): grammatica(dati)
    if cosa in ('coppie', 'tutto'): coppie(dati)
