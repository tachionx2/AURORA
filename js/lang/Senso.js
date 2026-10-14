/**
 * Senso.js — DI COSA SI STA PARLANDO.
 *
 * Chi assiste Daniela, sentendo "sono andata in chiesa a pr…", pensa
 * subito a "pregare": non perché "pregare" sia frequente, ma perché va
 * d'accordo con "chiesa". Questo modulo dà ai suggerimenti la stessa
 * intuizione, usando il significato delle parole in numeri
 * (semantica-it.js): due parole di argomento vicino hanno vettori simili.
 *
 * ⚠️ Caricato al PRIMO uso, in modo asincrono e senza rete (è un modulo
 * del programma, precaricato dal service worker): finché non è pronto i
 * suggerimenti funzionano esattamente come prima, senza questo fattore.
 * Se il caricamento fallisse, restano come prima per sempre: nessun
 * errore arriva mai a chi scrive.
 */

let _promessa = null;
let _senso = null;

/** Avvia il caricamento (una volta sola). Restituisce una promessa. */
export function caricaSenso() {
  if (_promessa) return _promessa;
  _promessa = import('./semantica-it.js').then(({ SEMANTICA_IT: S }) => {
    const bin = atob(S.dati);
    const v = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) v[i] = (bin.charCodeAt(i) << 24) >> 24;
    /* Nessun indice in memoria: le parole sono in ordine alfabetico e
     * si trovano con una ricerca binaria. Un indice di trentamila voci
     * costava alcuni MB su un tablet che fa già girare il
     * riconoscimento del volto. */
    const W = S.parole;
    const inizi = [0];
    for (let i = W.indexOf('\n'); i >= 0; i = W.indexOf('\n', i + 1)) inizi.push(i + 1);
    const I = Int32Array.from(inizi);
    const parola = (j) => { const f = W.indexOf('\n', I[j]); return W.slice(I[j], f < 0 ? W.length : f); };
    const riga = {
      get(w) {
        let lo = 0, hi = I.length - 1;
        while (lo <= hi) {
          const m = (lo + hi) >> 1;
          const c = parola(m);
          if (c === w) return m * S.D;
          if (c < w) lo = m + 1; else hi = m - 1;
        }
        return undefined;
      },
    };
    _senso = { D: S.D, v, riga };
    return _senso;
  }).catch(() => null);
  return _promessa;
}

/** Il modello, se già caricato; altrimenti null (e il caricamento parte). */
export function senso() {
  if (!_senso) caricaSenso();
  return _senso;
}

/** Affinità di significato fra due posizioni, fra -1 e 1. */
function coseno(M, a, b) {
  const v = M.v, D = M.D;
  let s = 0;
  for (let k = 0; k < D; k++) s += v[a + k] * v[b + k];
  return s / 16129;   // 127 × 127
}

/**
 * Prepara il contesto di una frase: le parole piene, pesate per
 * vicinanza — l'ultima conta di più, quelle lontane un po' meno — e,
 * se `pesoParola` lo dice, per quanto ciascuna porta l'argomento (un
 * nome come "chiesa" più di un verbo generico come "andata").
 * @param piene parole piene della frase, nell'ordine
 * @returns {{ M, ctx: [riga, peso, parola][] } | null}
 */
export function contestoDi(M, piene, decadimento = 0.85, pesoParola = null) {
  if (!M || !piene?.length) return null;
  const ctx = [];
  let peso = 1;
  for (let i = piene.length - 1; i >= 0 && ctx.length < 8; i--) {
    const r = M.riga.get(piene[i]);
    if (r == null) continue;
    const pp = pesoParola ? pesoParola(piene[i]) : 1;
    if (pp > 0) ctx.push([r, peso * pp, piene[i]]);
    peso *= decadimento;
  }
  return ctx.length ? { M, ctx } : null;
}

/**
 * Quanto la parola `w` va d'accordo con l'argomento della frase: la
 * media delle affinità con le sue parole piene, pesata per vicinanza.
 * null se la parola non ha un significato noto.
 *
 * ⚠️ Il numero da solo dice poco: alcune parole somigliano un po' a
 * tutto. Chi lo usa lo confronta con quello delle RIVALI (le altre
 * parole con le stesse lettere iniziali): conta quanto una parola si
 * distingue, non quanto vale in assoluto. Misurato su seimila casi
 * reali: la media batte il massimo, e il confronto con le rivali batte
 * il valore assoluto.
 */
export function affinita(C, w) {
  const r = C.M.riga.get(w);
  if (r == null) return null;
  let s = 0, pesi = 0;
  for (const [rc, peso, pc] of C.ctx) {
    if (pc === w) continue;   // ripetere la stessa parola non è "argomento"
    s += coseno(C.M, r, rc) * peso;
    pesi += peso;
  }
  return pesi > 0 ? s / pesi : null;
}
