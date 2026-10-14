/**
 * Coppie.js — QUALI PAROLE VANNO INSIEME.
 *
 * Chi assiste Daniela ha in testa migliaia di espressioni sentite: dopo
 * "a pr…" in una frase sulla chiesa pensa "pregare", dopo "mal di…"
 * pensa "testa". Questo modulo dà ai suggerimenti la stessa memoria,
 * con le coppie e le terne di parole che nell'italiano reale vanno
 * insieme molto più spesso del caso (coppie-it.js).
 *
 * Solo legami POSITIVI: una coppia che non c'è non è una prova che sia
 * sbagliata (il testo di partenza non contiene tutto l'italiano). Quello
 * che non si può dire lo dice già la grammatica.
 *
 * ⚠️ Caricato al PRIMO uso, in modo asincrono e senza rete: finché non
 * è pronto i suggerimenti funzionano esattamente come prima. Se il
 * caricamento fallisse, restano come prima per sempre.
 */

let _promessa = null;
let _c = null;

export function caricaCoppie() {
  if (_promessa) return _promessa;
  _promessa = import('./coppie-it.js').then(({ COPPIE_IT: X }) => {
    const parole = X.parole.split('\n');
    const A = '0123456789abcdefghijklmnopqrstuvwxyz';
    const v = (ch) => A.indexOf(ch);
    /* Le righe restano testo finché non servono, e NON si costruisce
     * un indice: sono in ordine alfabetico, e una ricerca binaria trova
     * un contesto in una quindicina di confronti. Un indice di
     * sessantamila voci costava più di dieci MB di memoria, su un
     * tablet che fa già girare il riconoscimento del volto. */
    const R = X.righe;
    const inizi = [0];
    for (let i = R.indexOf('\n'); i >= 0; i = R.indexOf('\n', i + 1)) inizi.push(i + 1);
    const I = Int32Array.from(inizi);
    const chiaveDi = (j) => R.slice(I[j], R.indexOf('\t', I[j]));
    const trova = (k) => {
      let lo = 0, hi = I.length - 1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        const c = chiaveDi(m);
        if (c === k) return R.indexOf('\t', I[m]) + 1;
        if (c < k) lo = m + 1; else hi = m - 1;
      }
      return null;
    };
    const decodificate = new Map();
    const seguito = (k) => {
      let d = decodificate.get(k);
      if (d !== undefined) return d;
      const t = trova(k);
      let s = null;
      if (t != null) {
        let f = R.indexOf('\n', t);
        if (f < 0) f = R.length;
        s = R.slice(t, f);
      }
      d = null;
      if (s) {
        d = new Map();
        for (let i = 0; i + 3 < s.length; i += 4) {
          const ix = v(s[i]) * 1296 + v(s[i + 1]) * 36 + v(s[i + 2]);
          d.set(parole[ix], Number(s[i + 3]) * 0.5);
        }
      }
      if (decodificate.size > 2000) decodificate.clear();
      decodificate.set(k, d);
      return d;
    };
    _c = { seguito };
    return _c;
  }).catch(() => null);
  return _promessa;
}

export function coppie() {
  if (!_c) caricaCoppie();
  return _c;
}

/**
 * Le parole che vanno insieme a quelle appena scritte, con la forza del
 * legame (logaritmo di quante volte più del caso): dalla parola
 * precedente e, se c'è, dalla coppia precedente.
 * @returns {{ d1: Map|null, d2: Map|null }}
 */
export function legami(c, parole) {
  const n = parole.length;
  if (!n) return { d1: null, d2: null };
  const w1 = parole[n - 1], w2 = parole[n - 2];
  return { d1: c.seguito(w1), d2: w2 ? c.seguito(`${w2} ${w1}`) : null };
}
