/**
 * AutoCorrect.js — Correzione automatica delle parole.
 *
 * ══════════════════════════════════════════════════════════════════
 * PERCHÉ ESISTE, E PERCHÉ VA FATTA BENE
 * ══════════════════════════════════════════════════════════════════
 *
 * Scrivere una parola con un solo gesto oculare costa fra i venti e i
 * sessanta secondi. Un errore di battitura, che per chiunque altro è
 * un istante di fastidio, qui costa un minuto per essere corretto —
 * o costringe a lasciarlo lì.
 *
 * Ma proprio perché scrivere costa così caro, una correzione SBAGLIATA
 * è peggio dell'errore: la persona ha speso un minuto per quella
 * parola e se la vede cambiare in un'altra. Per questo il criterio
 * guida non è "correggere il più possibile", ma:
 *
 *   NEL DUBBIO, NON CORREGGERE.
 *
 * Da qui tre regole rigide:
 *   1. le parole che ESISTONO non si toccano mai — nemmeno se una
 *      parola più frequente le somiglia;
 *   2. si corregge solo se il candidato migliore stacca nettamente il
 *      secondo: se due parole sono ugualmente plausibili, la scelta
 *      sarebbe una monetina;
 *   3. le parole molto corte non si correggono: fra parole di tre
 *      lettere la distanza di una modifica è quasi sempre ambigua.
 *
 * ══════════════════════════════════════════════════════════════════
 * MODULO PURO
 * ══════════════════════════════════════════════════════════════════
 *
 * Riceve un vocabolario e restituisce una proposta. Non conosce il
 * DOM, non tocca la configurazione, non ha effetti. Si verifica quindi
 * fuori dal browser su casi costruiti apposta.
 */

/**
 * Distanza di modifica con uscita anticipata.
 *
 * Se supera il massimo consentito si smette di calcolare: su
 * centinaia di candidati per parola, calcolare la distanza esatta
 * quando già si sa che è troppo grande sarebbe lavoro buttato.
 */
export function distanza(a, b, max = 2) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (a === b) return 0;

  let prec = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prec[j] = j;

  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let minRiga = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const costo = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prec[j] + 1, cur[j - 1] + 1, prec[j - 1] + costo);
      if (cur[j] < minRiga) minRiga = cur[j];
    }
    // Tutta la riga è già oltre il limite: non può che peggiorare.
    if (minRiga > max) return max + 1;
    const t = prec; prec = cur; cur = t;
  }
  return prec[lb];
}

/**
 * Due lettere adiacenti scambiate — `chi` invece di `hci`.
 * È l'errore più comune di chi digita, e la distanza di modifica lo
 * conta come due operazioni: senza questo riconoscimento verrebbe
 * trattato come una parola molto diversa.
 */
export function scambioAdiacente(a, b) {
  if (a.length !== b.length) return false;
  const diff = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  return diff.length === 2 && diff[1] === diff[0] + 1
    && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

/** Toglie gli accenti per il confronto: `perche` trova `perché`. */
export function senzaAccenti(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Modello degli errori della SCANSIONE.
 *
 * ══════════════════════════════════════════════════════════════════
 * PERCHÉ NON BASTA LA DISTANZA DI MODIFICA
 * ══════════════════════════════════════════════════════════════════
 *
 * Su una tastiera gli errori sono di dito: si preme il tasto accanto.
 * Qui non c'è nessun tasto. Le lettere vengono annunciate una alla
 * volta dentro gruppi decisi dall'assistente, e si sceglie con un
 * gesto. Gli errori che ne derivano sono di TIPO COMPLETAMENTE DIVERSO:
 *
 *   · gesto un istante troppo presto o troppo tardi → si prende la
 *     lettera VICINA NELLO STESSO GRUPPO. È di gran lunga l'errore
 *     più frequente;
 *   · gesto non rilevato → la lettera MANCA del tutto;
 *   · gesto rilevato due volte → la lettera è RADDOPPIATA;
 *   · gruppo sbagliato → lettera da un altro gruppo. Molto più raro,
 *     perché scegliere il gruppo richiede un gesto a sé.
 *
 * Trattare tutte le sostituzioni come ugualmente probabili butta via
 * questa informazione — che è gratis, perché la struttura dei gruppi
 * è già nella configurazione e l'ha scelta l'assistente proprio per
 * questa persona.
 */
export function mappaLettere(gruppi) {
  const m = new Map();
  // ⚠️ Tollerante a qualunque cosa: i gruppi arrivano dalla
  // configurazione, che può essere importata da un altro dispositivo,
  // scritta a mano o venire da una versione diversa del programma. Un
  // gruppo malformato non deve far cadere l'autocorrezione — al
  // massimo la lascia senza quel pezzo di informazione.
  if (!Array.isArray(gruppi)) return m;
  gruppi.forEach((g, ig) => {
    const items = (g && Array.isArray(g.items)) ? g.items : null;
    if (!items) return;
    items.forEach((ch, i) => {
      if (ch === null || ch === undefined) return;
      const c = String(ch).toLowerCase().trim();
      // Solo lettere singole: lo spazio non è una lettera, e un
      // digramma non descrive una posizione di scelta singola.
      if (c.length !== 1 || c === '␣') return;
      // Se una lettera compare in più gruppi vince la PRIMA: è quella
      // che si raggiunge con meno gesti, quindi quella davvero usata.
      if (!m.has(c)) m.set(c, { gruppo: ig, indice: i });
    });
  });
  return m;
}

/**
 * Quanto è plausibile che, volendo scrivere `giusta`, sia uscito
 * `scritto`? Da 0 (implausibile) a 1 (l'errore tipico di questo modo
 * di scrivere).
 */
export function plausibilita(scritto, giusta, mappa) {
  if (!mappa || mappa.size === 0) return 0.75;      // struttura ignota: neutro
  const a = scritto, b = giusta;

  // ── Raddoppio: la stessa lettera due volte di fila ──
  if (a.length === b.length + 1) {
    for (let i = 0; i < b.length + 1; i++) {
      if (a.slice(0, i) + a.slice(i + 1) === b) {
        const doppia = (i > 0 && a[i] === a[i - 1]) || (i < a.length - 1 && a[i] === a[i + 1]);
        // Un gesto contato due volte è un errore tipico; una lettera
        // in più a caso lo è molto meno.
        return doppia ? 0.95 : 0.55;
      }
    }
  }

  // ── Lettera mancante: gesto non rilevato. Molto comune. ──
  if (b.length === a.length + 1) {
    for (let i = 0; i < a.length + 1; i++) {
      if (b.slice(0, i) + b.slice(i + 1) === a) return 0.9;
    }
  }

  // ── Sostituzione: è qui che la struttura dice quasi tutto ──
  if (a.length === b.length) {
    const diff = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) {
      const pa = mappa.get(a[diff[0]]);
      const pb = mappa.get(b[diff[0]]);
      if (!pa || !pb) return 0.6;
      if (pa.gruppo === pb.gruppo) {
        const salto = Math.abs(pa.indice - pb.indice);
        // Vicina nello stesso gruppo: è l'errore di tempismo, il più
        // frequente di tutti.
        if (salto === 1) return 1;
        if (salto === 2) return 0.8;
        return 0.65;
      }
      // Gruppo diverso: richiede un gesto sbagliato in più, quindi è
      // molto meno probabile.
      return 0.4;
    }
    // Due lettere adiacenti scambiate: gesti nell'ordine sbagliato.
    if (diff.length === 2 && diff[1] === diff[0] + 1
        && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]) return 0.85;
  }

  return 0.5;
}

export class Correttore {
  /**
   * @param lessico {{
   *   esiste(parola): boolean,
   *   frequenza(parola): number,     // 0..1, peso relativo
   *   bigramma(prec, parola): number,// 0..1, quanto è probabile dopo `prec`
   *   parole(): Iterable<string>,
   * }}
   */
  constructor(lessico, gruppi = null) {
    this.lessico = lessico;
    this._indice = null;
    this._versione = -1;
    // Struttura di scansione: dice quali errori sono probabili per
    // QUESTA persona, con i gruppi che l'assistente ha scelto per lei.
    this.mappa = gruppi ? mappaLettere(gruppi) : new Map();
  }

  /** Aggiorna la struttura quando l'assistente cambia i gruppi. */
  setGruppi(gruppi) { this.mappa = gruppi ? mappaLettere(gruppi) : new Map(); }

  /**
   * Indice per lunghezza: per una parola di N lettere basta guardare
   * quelle da N-2 a N+2. Su un lessico di qualche migliaio di voci
   * riduce i candidati da esaminare di un ordine di grandezza, e si
   * ricostruisce solo quando il lessico cambia davvero.
   */
  _costruisciIndice() {
    const idx = new Map();
    for (const w of this.lessico.parole()) {
      const L = w.length;
      if (!idx.has(L)) idx.set(L, []);
      idx.get(L).push(w);
    }
    this._indice = idx;
  }

  invalidaIndice() { this._indice = null; }

  _candidati(parola, maxDist) {
    if (!this._indice) this._costruisciIndice();
    const L = parola.length;
    const out = [];
    for (let l = L - maxDist; l <= L + maxDist; l++) {
      const lista = this._indice.get(l);
      if (lista) out.push(...lista);
    }
    return out;
  }

  /**
   * Corregge una parola, se conviene farlo.
   *
   * @param parola     la parola scritta
   * @param precedente parola che la precede (per il contesto), o null
   * @param opt { minLen, maxDist, margine }
   * @returns {{parola, originale, distanza, punteggio, margine}|null}
   *          null significa "non correggo", ed è la risposta giusta
   *          ogni volta che c'è il minimo dubbio.
   */
  correggi(parola, precedente = null, opt = {}) {
    const minLen = opt.minLen ?? 4;
    const maxDist = Math.max(1, Math.min(2, opt.maxDist ?? 2));
    const margineMin = opt.margine ?? 0.12;

    const orig = String(parola || '');
    const w = orig.toLowerCase();

    // ── Casi in cui non si tocca nulla ──
    if (w.length < minLen) return null;                    // troppo corta: ambigua
    if (/[0-9]/.test(w)) return null;                      // numeri: mai
    if (/^[^a-zàèéìòùç']+$/.test(w)) return null;          // punteggiatura
    if (this.lessico.esiste(w)) return null;               // ESISTE: non si tocca
    // Anche senza accenti: `perche` è `perché`, non un errore da
    // trasformare in `perde`.
    const senza = senzaAccenti(w);
    if (senza !== w && this.lessico.esiste(senza)) return null;

    /* ⚠️ Se esiste anche UN SOLO candidato a una modifica di distanza,
     * quelli a due modifiche non si considerano affatto.
     *
     * Sbagliare una lettera è molto più probabile che sbagliarne due, e
     * senza questa regola una parola comunissima a distanza 2 batte una
     * parola rara a distanza 1 — che è quasi sempre la risposta
     * sbagliata. È il caso di `cao`: `ciao` dista una lettera, `che`
     * due, ma `che` è trenta volte più frequente e vinceva.
     *
     * È la regola usata da tutti i correttori seri, e va applicata
     * prima del punteggio, non dentro. */
    const tutti = this._candidati(w, maxDist);
    const vicini = [];
    const lontani = [];
    for (const c of tutti) {
      if (c === w) return null;
      const d = distanza(w, c, maxDist);
      if (d > maxDist) continue;
      // Uno scambio di lettere adiacenti vale come UNA modifica: è
      // l'errore di digitazione più comune di tutti.
      const dEff = (d === 2 && scambioAdiacente(w, c)) ? 1 : d;
      (dEff === 1 ? vicini : lontani).push([c, dEff]);
    }
    const candidati = vicini.length ? vicini : lontani;

    let migliore = null, secondo = -Infinity;

    for (const [c, dEff] of candidati) {

      /* ── Punteggio ──
       *
       * ⚠️ La frequenza è MOLTIPLICATIVA, non additiva.
       *
       * Sommandola, due candidati alla stessa distanza restavano quasi
       * pari anche quando uno era il doppio più comune dell'altro: fra
       * `sono` e `suo` il divario finiva sotto il margine e il
       * correttore rinunciava. Ma fra due parole ugualmente vicine è
       * proprio la frequenza a dover decidere, e deve farlo in
       * proporzione — non aggiungendo una briciola.
       *
       * La vicinanza resta il fattore dominante, ma come
       * MOLTIPLICATORE: una parola a due modifiche di distanza parte
       * da un terzo del punteggio, qualunque sia la sua frequenza. */
      const freq = this.lessico.frequenza(c);
      const contesto = precedente ? this.lessico.bigramma(precedente, c) : 0;

      // Base: una briciola per tutti (esistere conta), poi frequenza e
      // contesto, che sono ciò che distingue davvero.
      const base = 0.15 + freq * 0.85 + contesto * 0.60;

      const vicinanza = dEff === 1 ? 1 : 0.34;
      // Prima lettera uguale: chi sbaglia raramente sbaglia l'inizio.
      const inizio = c[0] === w[0] ? 1.12 : 1;
      // Lunghezza simile: preferisce una correzione a una parola diversa.
      const lung = 1 - Math.min(1, Math.abs(c.length - w.length) / 3) * 0.12;
      /* Candidato più corto della soglia minima: penalizzato forte.
       * Se `sno` diventasse `no`, si starebbe "correggendo" verso una
       * parola che il correttore stesso si rifiuterebbe di toccare
       * perché troppo corta e ambigua — e chi scrive tre lettere
       * quasi sempre ne voleva scrivere almeno tre. */
      const troppoCorto = c.length < minLen ? 0.45 : 1;

      /* Plausibilità dell'errore secondo la STRUTTURA DI SCANSIONE.
       * È l'informazione che distingue questo correttore da uno
       * generico: sa come si scrive qui, e quindi quali errori sono
       * tipici e quali quasi impossibili. */
      const plaus = plausibilita(w, c, this.mappa);

      const punteggio = base * vicinanza * inizio * lung * troppoCorto * plaus;

      if (!migliore || punteggio > migliore.punteggio) {
        if (migliore) secondo = Math.max(secondo, migliore.punteggio);
        migliore = { parola: c, distanza: dEff, punteggio };
      } else if (punteggio > secondo) secondo = punteggio;
    }

    if (!migliore) return null;

    /* ── Il margine: è questa la difesa contro le correzioni sbagliate ──
     *
     * RELATIVO, non assoluto: "il migliore stacca il secondo del 12%"
     * ha senso qualunque sia la scala dei punteggi, mentre una
     * differenza fissa è severissima quando i punteggi sono bassi e
     * permissiva quando sono alti — cioè si comporta in modo diverso
     * su parole diverse senza alcuna ragione.
     *
     * Se il secondo è quasi altrettanto plausibile, scegliere sarebbe
     * tirare una monetina: meglio lasciare la parola com'è. */
    const margine = secondo === -Infinity ? 1
      : (migliore.punteggio - secondo) / Math.max(1e-6, migliore.punteggio);
    if (margine < margineMin) return null;

    return {
      parola: rispettaMaiuscole(orig, migliore.parola),
      originale: orig,
      distanza: migliore.distanza,
      punteggio: migliore.punteggio,
      margine,
    };
  }

  /**
   * Corregge una frase intera.
   *
   * Vale più della somma delle correzioni singole: avendo tutta la
   * frase, ogni parola ha un contesto a sinistra già corretto, e le
   * ambiguità che parola per parola resterebbero irrisolte qui si
   * sciolgono.
   *
   * @returns {{parole, testo, correzioni}}
   */
  correggiFrase(testo, opt = {}) {
    const parole = String(testo || '').split(/\s+/).filter(Boolean);
    const fuori = [];
    const correzioni = [];
    for (let i = 0; i < parole.length; i++) {
      // Il contesto usa la parola precedente GIÀ CORRETTA: un errore
      // corretto migliora la scelta su quello successivo.
      const prec = i > 0 ? fuori[i - 1].toLowerCase() : null;
      const r = this.correggi(parole[i], prec, opt);
      if (r) { fuori.push(r.parola); correzioni.push({ da: r.originale, a: r.parola, indice: i }); }
      else fuori.push(parole[i]);
    }
    return { parole: fuori, testo: fuori.join(' '), correzioni };
  }
}

/** Conserva le maiuscole dell'originale sulla parola corretta. */
export function rispettaMaiuscole(originale, corretta) {
  if (originale === originale.toUpperCase() && originale.length > 1) return corretta.toUpperCase();
  if (originale[0] === originale[0]?.toUpperCase()) {
    return corretta[0].toUpperCase() + corretta.slice(1);
  }
  return corretta;
}
