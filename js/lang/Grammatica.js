/**
 * Grammatica.js — CHE TIPO DI PAROLA PUÒ VENIRE ADESSO.
 *
 * Chi assiste Daniela non pensa a tutte le parole che cominciano con
 * "pr": dopo "sono andata in chiesa a…" sa che arriva un verbo
 * all'infinito. Questo modulo dà ai suggerimenti la stessa attesa,
 * usando le statistiche di grammatica-it.js (categorie delle parole e
 * cosa segue a cosa, da testi italiani annotati a mano).
 *
 * Generalizza le regole scritte a mano di `fattoreAccordo` (articolo →
 * nome, soggetto → verbo), che restano: questa è la statistica su
 * TUTTE le sequenze, quelle sono le eccezioni note.
 *
 * ⚠️ Caricato al PRIMO uso, in modo asincrono e senza rete: finché non
 * è pronto i suggerimenti funzionano esattamente come prima. Se il
 * caricamento fallisse, restano come prima per sempre.
 */

let _promessa = null;
let _g = null;

export function caricaGrammatica() {
  if (_promessa) return _promessa;
  _promessa = import('./grammatica-it.js').then(({ GRAMMATICA_IT: G }) => {
    const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const T = G.TAGS.length;
    const decodifica = (s, cifre, scala) => {
      const p = [];
      for (let i = 0; i + cifre < s.length + 1; i += cifre + 1) {
        p.push([CH.indexOf(s[i]), Number(s.slice(i + 1, i + 1 + cifre)) / scala]);
      }
      return p;
    };
    const priori = Float64Array.from(G.PRIORI.split(',').map(Number));
    /* Il lessico resta testo: per ogni parola si ricorda solo DOVE sta,
     * e la si decodifica quando serve. Trasformarlo tutto subito in
     * oggetti costava una decina di MB di memoria per trentamila parole,
     * quasi tutte mai usate. */
    const L = G.LESSICO;
    const dove = new Map();
    for (let i = 0; i < L.length;) {
      const t = L.indexOf('\t', i);
      let f = L.indexOf('\n', t);
      if (f < 0) f = L.length;
      dove.set(L.slice(i, t), t + 1);
      i = f + 1;
    }
    const cache = new Map();
    const lessico = {
      get(w) {
        let v = cache.get(w);
        if (v !== undefined) return v;
        const t = dove.get(w);
        if (t == null) return undefined;
        let f = L.indexOf('\n', t);
        if (f < 0) f = L.length;
        v = decodifica(L.slice(t, f), 2, 99);
        if (cache.size > 5000) cache.clear();
        cache.set(w, v);
        return v;
      },
    };
    const contesti = new Map();
    for (const riga of G.CONTESTI.split('\n')) {
      const t = riga.indexOf('\t');
      const d = new Float64Array(T).fill(0.0005);   // mai zero: l'italiano sorprende
      for (const [i, p] of decodifica(riga.slice(t + 1), 4, 10000)) d[i] = Math.max(p, 0.0005);
      contesti.set(riga.slice(0, t), d);
    }
    _g = { T, priori, lessico, contesti, nomiTag: G.TAGS, lessicali: new Set(G.LESSICALI.split(' ')) };
    return _g;
  }).catch(() => null);
  return _promessa;
}

export function grammatica() {
  if (!_g) caricaGrammatica();
  return _g;
}

/** Come il modello vede una parola già scritta: sé stessa se è
 *  grammaticale, altrimenti la sua categoria più probabile. */
function classe(g, w) {
  if (!w) return '<s>';
  if (g.lessicali.has(w)) return w;
  const p = g.lessico.get(w);
  if (!p?.length) return null;
  let m = p[0];
  for (const x of p) if (x[1] > m[1]) m = x;
  return `#${m[0]}`;
}

/**
 * La distribuzione delle categorie attese dopo le parole già scritte.
 * null se il contesto non dice nulla (parola mai vista).
 */
export function attese(g, parole) {
  const n = parole.length;
  const b = classe(g, parole[n - 1]);
  if (b == null) return null;
  // Come nell'addestramento: prima della frase ci sono due "inizi".
  const a = n >= 2 ? classe(g, parole[n - 2]) : '<s>';
  const k1 = nome(g, b);
  const k2 = a != null ? `${nome(g, a)} ${k1}` : null;
  return (k2 && g.contesti.get(k2)) || g.contesti.get(k1) || null;
}

/** Nome della classe come compare nelle chiavi dei CONTESTI: le
 *  categorie per nome ("V-inf"), le parole grammaticali per sé. */
function nome(g, c) {
  return c.startsWith('#') ? g.nomiTag[Number(c.slice(1))] : c;
}

/**
 * Quanto la parola `w` è attesa in quel punto della frase, rispetto a
 * quanto lo sarebbe in generale: >1 attesa, <1 inattesa, 1 se non si sa.
 */
export function fattoreGrammatica(g, d, w) {
  const p = g.lessico.get(w);
  if (!d || !p?.length) return 1;
  let s = 0, tot = 0;
  for (const [i, q] of p) { s += q * d[i] / g.priori[i]; tot += q; }
  return tot > 0 ? s / tot : 1;
}

/**
 * Quanto una parola è un NOME (o un aggettivo, o un nome proprio), fra
 * 0 e 1. Sono le parole che dicono di cosa si sta parlando: "chiesa",
 * "dottore", "pranzo" — non "andata", "vorrei", "fatto". null se la
 * parola non è nel lessico.
 */
export function quantoNome(g, w) {
  const p = g.lessico.get(w);
  if (!p?.length) return null;
  let s = 0, tot = 0;
  for (const [i, q] of p) {
    const t = g.nomiTag[i];
    if (t.startsWith('N-') || t.startsWith('A-') || t === 'PROPN') s += q;
    tot += q;
  }
  return tot > 0 ? s / tot : null;
}
