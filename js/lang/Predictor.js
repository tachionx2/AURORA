/**
 * Predictor.js — Predizione + statistiche.
 *
 * Le due cose sono lo stesso sistema: le statistiche NON sono un
 * pannello informativo, sono il modello predittivo reso visibile e
 * modificabile a mano.
 *
 * Tre livelli, tutti locali:
 *   1. corpus italiano di partenza (frequenze generali)
 *   2. lessico personale con peso di recenza (emivita configurabile)
 *   3. frasi complete usate davvero
 *
 * Il livello 2 è quello che conta: dopo poche settimane domina il
 * corpus generico, perché segue la vita attuale della persona.
 */

import { SEED_WORDS, SEED_BIGRAMS, LETTER_FREQ_IT, VOCABOLARIO_IT, FREQ_FASCIA, FREQ_BASE } from './seed-it.js';
import { VOCABOLARIO_FREQ_IT } from './vocabolario-it.js';

const DAY_MS = 86400000;

/* ══════════════════════════════════════════════════════════════════
 * VOCABOLARIO DEI SUGGERIMENTI
 * ══════════════════════════════════════════════════════════════════
 *
 * Trentamila parole con la loro frequenza reale d'uso, più quelle del
 * registro di assistenza di seed-it.js, che tengono il proprio peso se
 * è maggiore (`sete`, `dolore`, `aspetta` contano più qui che nei
 * giornali).
 *
 * ⚠️ Costruito al PRIMO uso, non all'avvio: sono 260 KB da leggere e
 * chi non scrive non deve pagarli.
 *
 * ⚠️ Serve SOLO ai suggerimenti. L'autocorrezione continua a usare il
 * proprio vocabolario (`lessicoPerCorrezione`), che è stato tarato a
 * parte e non viene toccato.
 */
let _CORPUS = null;
function corpus() {
  if (_CORPUS) return _CORPUS;
  const freq = new Map();
  const perFrequenza = [];
  for (const riga of VOCABOLARIO_FREQ_IT.split('\n')) {
    const i = riga.indexOf(':');
    const F = Number(riga.slice(0, i));
    for (const w of riga.slice(i + 1).split(' ')) {
      if (w && !freq.has(w)) { freq.set(w, F); perFrequenza.push(w); }
    }
  }
  for (const [w, f] of Object.entries(SEED_WORDS)) {
    if (!freq.has(w)) perFrequenza.push(w);
    freq.set(w, Math.max(freq.get(w) || 0, f));
  }
  /* In ordine alfabetico per trovare un prefisso con una ricerca
   * binaria: le parole che cominciano allo stesso modo sono contigue,
   * e trovarle costa una ventina di confronti invece di trentamila. */
  const ordinate = [...freq.keys()].sort();
  /* Le parole più frequenti sono quasi tutte funzionali — di, che, per,
   * sono — e non dicono di cosa si sta parlando: non contano per il
   * contesto dell'argomento. */
  const vuote = new Set(perFrequenza.slice(0, 200));
  _CORPUS = { freq, ordinate, vuote };
  return _CORPUS;
}

/** Le parole di un testo, minuscole, senza punteggiatura. */
const TOKEN = /[a-zàáèéìíîòóùúç]+/g;
function token(testo) {
  return String(testo || '').toLowerCase().match(TOKEN) || [];
}

/** Un conteggio, oppure zero: protegge da valori corrotti nei dati salvati. */
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/**
 * Cosa mettere nella scansione per la parola in corso.
 *
 * ⚠️ Funzione unica, usata dal programma E dai test: se la scelta fosse
 * scritta due volte, col tempo le due copie divergerebbero e i test
 * verificherebbero qualcosa che il programma non fa più.
 *
 * @param predictor il modello
 * @param buffer    { letters, words } — la parola in corso e la frase
 * @param cfg       configurazione completa
 * @returns {{ proposte: string[], suggerimenti: string[] }}
 *   proposte      parole da dire a voce come prime voci (un gesto)
 *   suggerimenti  parole del gruppo "Suggerimenti", senza ripetere le
 *                 proposte
 */
export function scegliSuggerimenti(predictor, buffer, cfg) {
  const S = cfg.scan || {};
  const quanti = Math.max(S.suggestionCount || 4, 1) + 3;
  const ris = cfg.prediction?.enabled
    ? predictor.suggerisci({ prefisso: buffer?.letters || '', parole: buffer?.words || [], n: quanti })
    : [];
  /* Proposta diretta: solo le parole che staccano nettamente le
   * altre. Chi assiste propone quando intuisce, non a ogni lettera. */
  const proposte = S.suggerimentiDiretti
    ? ris.filter(s => s.quota >= (S.suggerimentiDirettiSoglia ?? 0.35))
         .slice(0, Math.max(1, Math.min(3, S.suggerimentiDirettiN || 1)))
         .map(s => s.parola)
    : [];
  // Nel gruppo non si ripete ciò che è già stato proposto a voce.
  const suggerimenti = ris.map(s => s.parola)
    .filter(w => !proposte.includes(w))
    .slice(0, S.suggestionCount || 4);
  return { proposte, suggerimenti };
}

export class Predictor {
  constructor(cfg, saved = null) {
    this.cfg = cfg;
    this.words = new Map();      // parola → { n, last, pinned }
    this.bigrams = new Map();    // "a\tb" → n
    this.phrases = new Map();    // frase → { n, last, pinned }
    this.letters = new Map();    // "ctx\tchar" → n
    /* Contesto oltre la parola precedente.
     *   trigrammi: "a\tb\tc" → n — le due parole prima contano più di una;
     *   compresenze: "a\tb" (in ordine alfabetico) → n — parole dette
     *     nella stessa frase. È ciò che dà l'ARGOMENTO: se nella frase
     *     c'è "acqua", "bicchiere" diventa più probabile anche senza
     *     esserle accanto. */
    this.trigrams = new Map();
    this.cooc = new Map();
    // Cresce a ogni cambiamento delle statistiche: invalida le cache.
    this._ver = 0;
    this.load(saved);
  }

  updateConfig(cfg) { this.cfg = cfg; }

  load(saved) {
    if (!saved) return;
    const rehydrate = (obj, map) => {
      if (!obj) return;
      for (const [k, v] of Object.entries(obj)) map.set(k, v);
    };
    rehydrate(saved.words, this.words);
    rehydrate(saved.bigrams, this.bigrams);
    rehydrate(saved.phrases, this.phrases);
    rehydrate(saved.letters, this.letters);
    // Assenti nelle statistiche salvate prima che esistessero: restano vuoti.
    rehydrate(saved.trigrams, this.trigrams);
    rehydrate(saved.cooc, this.cooc);
    this._ver++;
  }

  /**
   * Sostituisce TUTTE le statistiche con quelle fornite.
   *
   * ⚠️ `load()` non basta: aggiunge alle mappe esistenti senza
   * svuotarle, ed è giusto così all'avvio, dove le mappe sono vuote e
   * si vuole solo idratarle. Ma per "importa e sostituisci" servirebbe
   * davvero azzerare, altrimenti si prometterebbe una cosa e se ne
   * farebbe un'altra — con la persona che ha appena confermato di
   * voler perdere il lessico e se lo ritrova mescolato.
   */
  replaceAll(data) {
    this.words.clear();
    this.bigrams.clear();
    this.phrases.clear();
    this.letters.clear();
    this.trigrams.clear();
    this.cooc.clear();
    this.load(data);
  }

  /**
   * Unisce statistiche provenienti da un altro dispositivo o da un
   * backup, SENZA cancellare quelle attuali.
   *
   * È il modo giusto di importare: sostituire butta via settimane di
   * apprendimento, e chi importa un profilo per copiare una
   * configurazione non si aspetta di perdere il lessico.
   *
   * Regole di fusione, per ciascun tipo di voce:
   *   · conteggi → si sommano (due dispositivi, un solo utilizzatore);
   *   · ultimo uso → si tiene il più recente;
   *   · "fissata" → basta che lo sia da una parte;
   *   · ordine esplicito → vince quello LOCALE, perché è stato deciso
   *     su questo dispositivo e riflette come è disposto qui.
   *
   * @returns {{frasi:number, parole:number, coppie:number}} quante voci
   *          sono state aggiunte o aggiornate
   */
  merge(data) {
    const esito = { frasi: 0, parole: 0, coppie: 0 };
    if (!data || typeof data !== 'object') return esito;

    const fondi = (mappaLocale, voci, chiave) => {
      if (!voci) return 0;
      let n = 0;
      const entra = Array.isArray(voci) ? voci : Object.entries(voci);
      for (const el of entra) {
        const [k, v] = Array.isArray(el) ? el : [el.key, el];
        if (!k || !v) continue;
        const mio = mappaLocale.get(k);
        if (!mio) {
          const nuovo = { n: v.n || 0, last: v.last || Date.now() };
          if (v.pinned) nuovo.pinned = true;
          // L'ordine esplicito NON si importa: è una scelta locale.
          mappaLocale.set(k, nuovo);
        } else {
          mio.n = (mio.n || 0) + (v.n || 0);
          mio.last = Math.max(mio.last || 0, v.last || 0);
          if (v.pinned) mio.pinned = true;
          mappaLocale.set(k, mio);
        }
        n++;
      }
      esito[chiave] = n;
      return n;
    };

    fondi(this.phrases, data.phrases, 'frasi');
    fondi(this.words, data.words, 'parole');

    /* ⚠️ COPPIE DI PAROLE: il formato è PIATTO, "prima\tdopo" → conteggio.
     *
     * Difetto corretto: qui si leggeva un formato annidato
     * (prima → dopo → conteggio) che il programma non ha mai salvato.
     * Ogni coppia importata diventava una mappa vuota invece di un
     * numero, il suo contributo ai suggerimenti diventava NaN, e le
     * coppie già presenti non venivano sommate. L'"importa e unisci"
     * delle statistiche perdeva in silenzio tutto il contesto — proprio
     * la parte che rende i suggerimenti pertinenti.
     *
     * Si accetta anche il formato annidato, nel caso esistesse in
     * qualche file vecchio, e si risanano i valori corrotti già
     * presenti: `num()` li tratta come zero. */
    const fondiConteggi = (mappa, voci) => {
      let n = 0;
      if (!voci || typeof voci !== 'object') return 0;
      for (const [k, v] of Object.entries(voci)) {
        if (typeof v === 'number') {
          mappa.set(k, num(mappa.get(k)) + num(v));
          n++;
        } else if (v && typeof v === 'object') {
          for (const [dopo, c] of Object.entries(v)) {
            const kk = `${k}\t${dopo}`;
            mappa.set(kk, num(mappa.get(kk)) + num(Number(c)));
            n++;
          }
        }
      }
      return n;
    };
    esito.coppie = fondiConteggi(this.bigrams, data.bigrams);
    fondiConteggi(this.trigrams, data.trigrams);
    fondiConteggi(this.cooc, data.cooc);
    this._ver++;
    return esito;
  }

  /**
   * Vocabolario per l'autocorrezione.
   *
   * Mette insieme tre fonti, in ordine di autorevolezza decrescente:
   * il lessico personale (segue la vita di questa persona, e contiene
   * i nomi propri che nessun dizionario avrebbe), il corpus con le
   * frequenze, e l'elenco delle parole italiane d'uso comune.
   *
   * ⚠️ Il lessico personale è ciò che rende possibile correggere i
   * NOMI: `franderco` diventa `Francesco` solo perché quel nome è già
   * stato scritto almeno una volta ed è stato imparato.
   */
  lessicoPerCorrezione() {
    const questo = this;
    let cache = null;
    const tutte = () => {
      if (cache) return cache;
      const s = new Set(VOCABOLARIO_IT);
      for (const w of Object.keys(SEED_WORDS)) s.add(w);
      for (const w of questo.words.keys()) s.add(w);
      cache = s;
      return s;
    };
    // Frequenza massima del lessico personale, per normalizzare.
    let maxPers = 1;
    for (const e of questo.words.values()) maxPers = Math.max(maxPers, e.n || 0);

    return {
      esiste: (w) => tutte().has(w),
      frequenza: (w) => {
        // Tre fonti, in ordine di autorevolezza. Il lessico personale
        // pesa di più: dopo qualche settimana descrive questa persona
        // meglio di qualunque corpus. Ma da solo non basta, perché
        // all'inizio è vuoto — e senza le frequenze generali il
        // correttore non saprebbe scegliere fra candidati equivalenti.
        const pers = questo.words.get(w)?.n || 0;
        const gen = SEED_WORDS[w] || 0;
        const fascia = FREQ_FASCIA[w] ?? (tutte().has(w) ? FREQ_BASE : 0);
        return Math.min(1,
          (pers / maxPers) * 0.55
          + Math.min(1, gen / 100) * 0.15
          + (fascia / 100) * 0.30);
      },
      bigramma: (prec, w) => {
        if (!prec) return 0;
        const chiave = `${prec}\t${w}`;
        const n = questo.bigrams.get(chiave) || SEED_BIGRAMS[chiave] || 0;
        return n > 0 ? Math.min(1, 0.4 + n / 10) : 0;
      },
      parole: () => tutte(),
      invalida: () => { cache = null; },
    };
  }

  serialize() {
    const dump = m => Object.fromEntries(m);
    return {
      words: dump(this.words), bigrams: dump(this.bigrams),
      phrases: dump(this.phrases), letters: dump(this.letters),
      trigrams: dump(this.trigrams), cooc: dump(this.cooc),
    };
  }

  /* ------------------------- Apprendimento ------------------------- */

  /** Registra una frase pronunciata: è l'unica etichetta di cui ci fidiamo. */
  learnSentence(text) {
    const clean = (text || '').trim();
    if (!clean) return;
    const now = Date.now();

    const ph = this.phrases.get(clean) || { n: 0, last: 0, pinned: false };
    ph.n++; ph.last = now;
    this.phrases.set(clean, ph);

    const ws = clean.toLowerCase().split(/\s+/).filter(Boolean);
    let prev = null;
    for (const w of ws) {
      const e = this.words.get(w) || { n: 0, last: 0, pinned: false };
      e.n++; e.last = now;
      this.words.set(w, e);
      if (prev) {
        const k = `${prev}\t${w}`;
        this.bigrams.set(k, (this.bigrams.get(k) || 0) + 1);
      }
      // n-gram di caratteri (ordine 3) per il riordino contestuale
      const padded = `^^${w}$`;
      for (let i = 2; i < padded.length; i++) {
        const k = `${padded.slice(i - 2, i)}\t${padded[i]}`;
        this.letters.set(k, (this.letters.get(k) || 0) + 1);
      }
      prev = w;
    }

    /* ── Contesto lungo ──
     * Sulle parole pulite dalla punteggiatura, le stesse che i
     * suggerimenti leggono dalla frase in composizione: altrimenti
     * "sete." imparata con il punto non corrisponderebbe mai a "sete". */
    const tk = token(clean);
    for (let i = 2; i < tk.length; i++) {
      const k = `${tk[i - 2]}\t${tk[i - 1]}\t${tk[i]}`;
      this.trigrams.set(k, num(this.trigrams.get(k)) + 1);
    }
    /* Compresenze: solo le parole che portano argomento. Un tetto alle
     * parole per frase evita che un testo lungo generi centinaia di
     * coppie in un colpo solo. */
    const C = corpus();
    const piene = [...new Set(tk.filter(w => w.length >= 3 && !C.vuote.has(w)))].slice(0, 12);
    for (let i = 0; i < piene.length; i++) {
      for (let j = i + 1; j < piene.length; j++) {
        const [a, b] = [piene[i], piene[j]].sort();
        const k = `${a}\t${b}`;
        this.cooc.set(k, num(this.cooc.get(k)) + 1);
      }
    }
    this._ver++;
    this.prune();
  }

  /** Precarica frasi raccolte intervistando la famiglia. */
  seedPhrases(list) {
    const now = Date.now();
    for (const p of list) {
      const c = (p || '').trim();
      if (!c) continue;
      const e = this.phrases.get(c) || { n: 0, last: now, pinned: true };
      e.pinned = true;
      if (!e.n) e.n = 3;          // parte con un po' di peso, non da zero
      this.phrases.set(c, e);
      this.learnSentenceSilent(c);
    }
  }

  learnSentenceSilent(text) {
    const ws = (text || '').toLowerCase().split(/\s+/).filter(Boolean);
    for (const w of ws) {
      const e = this.words.get(w) || { n: 0, last: Date.now(), pinned: false };
      e.n = Math.max(e.n, 2);
      this.words.set(w, e);
    }
    // Usata da chi aggiunge, rinomina o precarica frasi: i suggerimenti
    // che le continuano vanno ricalcolati.
    this._ver++;
  }

  /** Tetto alla crescita: le voci mai usate e non fissate decadono via. */
  prune(maxWords = 4000, maxPhrases = 600) {
    const trim = (map, max) => {
      if (map.size <= max) return;
      const arr = [...map.entries()]
        .filter(([, v]) => !v.pinned)
        .sort((a, b) => this._score(a[1]) - this._score(b[1]));
      const toDrop = map.size - max;
      for (let i = 0; i < toDrop && i < arr.length; i++) map.delete(arr[i][0]);
    };
    trim(this.words, maxWords);
    trim(this.phrases, maxPhrases);
    /* Tetto anche al contesto lungo, che cresce più in fretta: una frase
     * di dieci parole produce otto trigrammi e decine di compresenze.
     * Si tengono le più usate. */
    const taglia = (map, max) => {
      if (map.size <= max) return;
      const arr = [...map.entries()].sort((a, b) => num(a[1]) - num(b[1]));
      const via = map.size - max;
      for (let i = 0; i < via; i++) map.delete(arr[i][0]);
    };
    taglia(this.trigrams, 8000);
    taglia(this.cooc, 20000);
  }

  /* --------------------------- Punteggio --------------------------- */

  /** Frequenza pesata sulla recenza: emivita configurabile. */
  _score(entry) {
    if (!entry) return 0;
    const hl = Math.max(1, this.cfg.prediction.recencyHalfLifeDays);
    const ageDays = (Date.now() - (entry.last || 0)) / DAY_MS;
    const decay = Math.pow(0.5, ageDays / hl);
    const base = entry.n || 0;
    const w = this.cfg.prediction;
    return base * (w.personalWeight + w.recentWeight * decay) + (entry.pinned ? 5 : 0);
  }

  /* ------------------------- Completamenti ------------------------- */

  /**
   * Candidati di parola per il prefisso corrente — solo i nomi.
   *
   * Mantenuta per chi la usava: ora è un adattatore di `suggerisci`,
   * con la sola parola precedente come contesto.
   */
  completions(prefix, prevWord = null, n = 4) {
    return this.suggerisci({
      prefisso: prefix, parole: prevWord ? [prevWord] : [], n,
    }).map(s => s.parola);
  }

  /**
   * ══════════════════════════════════════════════════════════════════
   * SUGGERIMENTI DI PAROLA, DALL'INTERA FRASE
   * ══════════════════════════════════════════════════════════════════
   *
   * Ciò che fa una persona attenta che assiste Daniela: guarda le
   * lettere della parola in corso, ma anche TUTTO quello che è già
   * stato detto nella frase, e quello che Daniela dice di solito.
   * Si ricalcola a ogni lettera: con la quarta il campo si restringe e
   * i suggerimenti cambiano, con la quinta di nuovo.
   *
   * Sei fonti, sommate. Dalla più debole alla più forte:
   *
   *   1. FREQUENZA DELL'ITALIANO — trentamila parole. È la rete che
   *      garantisce un suggerimento a qualunque lunghezza del prefisso.
   *   2. LESSICO PERSONALE — le parole che Daniela usa, pesate sulla
   *      recenza. Dopo poche settimane domina il corpus generale.
   *   3. PAROLA PRECEDENTE — "ho" → "sete", "fame", "dolore".
   *   4. DUE PAROLE PRECEDENTI — "mi fa" → "male".
   *   5. ARGOMENTO DELLA FRASE — parole dette insieme in passato: se
   *      nella frase c'è "acqua", "bicchiere" sale anche senza esserle
   *      accanto.
   *   6. CONTINUAZIONE DI UNA FRASE NOTA — se ciò che si sta scrivendo
   *      ricalca una frase già detta, o una delle frasi preparate dalla
   *      famiglia, la parola che segue in quella frase è la candidata
   *      più forte di tutte. È la fonte che più assomiglia all'intuito
   *      di chi la conosce, e pesa di più quanto più lunga è la parte
   *      che coincide.
   *
   * @param prefisso le lettere della parola in corso
   * @param parole   le parole GIÀ scritte nella frase, nell'ordine
   * @param n        quanti candidati restituire
   * @returns [{ parola, punteggio, quota }] — `quota` è la parte del
   *          punteggio totale che spetta a quella parola, fra 0 e 1:
   *          misura quanto il suggerimento è sicuro, ed è ciò che
   *          decide se vale la pena proporlo a voce.
   */
  suggerisci({ prefisso = '', parole = [], n = 4 } = {}) {
    const P = this.cfg.prediction;
    if (!P?.enabled) return [];
    const p = String(prefisso || '').toLowerCase().trim();
    /* ⚠️ Mai senza almeno una lettera della parola: i suggerimenti
     * riguardano la parola che si sta scrivendo. Dopo uno spazio non
     * si propone nulla finché non comincia la parola nuova. */
    if (!p || p.length < Math.max(1, P.minPrefixForWord || 1)) return [];

    const S = (parole || []).flatMap(w => token(w));
    // Stessa domanda, stesse statistiche: stessa risposta, senza ricalcolare.
    const chiave = `${this._ver}|${p}|${S.join(' ')}|${n}|${P.corpusWeight}`;
    if (this._cache?.chiave === chiave) return this._cache.esito;

    const C = corpus();
    const cand = new Map();
    const add = (w, s) => {
      if (!(s > 0) || w === p || !w.startsWith(p)) return;
      cand.set(w, (cand.get(w) || 0) + s);
    };

    // 1. Frequenza dell'italiano — ricerca binaria sul prefisso.
    const cw = P.corpusWeight ?? 0.2;
    let lo = 0, hi = C.ordinate.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (C.ordinate[m] < p) lo = m + 1; else hi = m; }
    for (let i = lo; i < C.ordinate.length && C.ordinate[i].startsWith(p); i++) {
      const w = C.ordinate[i];
      add(w, cw * C.freq.get(w));
    }

    // 2. Lessico personale: pesa tre volte il suo punteggio, perché una
    //    parola usata davvero da Daniela vale più di una parola comune.
    for (const [w, e] of this.words) add(w, 3 * this._score(e));

    // 3. Parola precedente.
    const w1 = S[S.length - 1];
    const w2 = S[S.length - 2];
    if (w1) {
      for (const [k, v] of this.bigrams) {
        const t = k.indexOf('\t');
        if (t > 0 && k.slice(0, t) === w1) add(k.slice(t + 1), 6 * num(v));
      }
      for (const [k, v] of Object.entries(SEED_BIGRAMS)) {
        const [a, b] = k.split(' ');
        if (a === w1) add(b, v * cw * 2);
      }
    }

    // 4. Due parole precedenti.
    if (w1 && w2) {
      const pre = `${w2}\t${w1}\t`;
      for (const [k, v] of this.trigrams) {
        if (k.startsWith(pre)) add(k.slice(pre.length), 12 * num(v));
      }
    }

    // 5. Argomento della frase.
    const piene = [...new Set(S.filter(w => w.length >= 3 && !C.vuote.has(w)))];
    if (piene.length) {
      const bonus = new Map();
      for (const [k, v] of this.cooc) {
        const t = k.indexOf('\t');
        const a = k.slice(0, t), b = k.slice(t + 1);
        if (piene.includes(a) && b.startsWith(p)) bonus.set(b, (bonus.get(b) || 0) + num(v));
        else if (piene.includes(b) && a.startsWith(p)) bonus.set(a, (bonus.get(a) || 0) + num(v));
      }
      // Un tetto: l'argomento orienta, non deve travolgere tutto il resto.
      for (const [w, v] of bonus) add(w, Math.min(30, 1.5 * v));
    }

    // 6. Continuazione di una frase nota.
    const kMax = Math.min(4, S.length);
    for (const [T, peso] of this._frasiNote()) {
      if (!S.length) {
        // A inizio frase: le parole con cui Daniela comincia a parlare.
        add(T[0], 3 * peso);
        continue;
      }
      let trovata = false;
      for (let k = kMax; k >= 1 && !trovata; k--) {
        const coda = S.slice(S.length - k);
        for (let j = 0; j + k < T.length; j++) {
          let uguale = true;
          for (let q = 0; q < k; q++) if (T[j + q] !== coda[q]) { uguale = false; break; }
          if (!uguale) continue;
          const w = T[j + k];
          if (w !== p && w.startsWith(p)) { add(w, 8 * k * peso); trovata = true; break; }
        }
      }
    }

    const tutti = [...cand.entries()].sort((a, b) => b[1] - a[1]);
    /* ⚠️ La sicurezza si misura fra le RIVALI VERE, le prime cinque.
     *
     * Sommando su tutto il dizionario, con due lettere ci sono migliaia
     * di candidati e anche una parola ovvia risultava al 6%: "male"
     * dopo "mi fa". Una persona che assiste non pensa a tutte le parole
     * italiane, pensa a quelle due o tre che potrebbero essere: se una
     * stacca nettamente le altre, la propone. */
    const somma = tutti.slice(0, 5).reduce((s, [, v]) => s + v, 0) || 1;
    const esito = tutti.slice(0, n).map(([parola, punteggio]) => ({
      parola, punteggio, quota: punteggio / somma,
    }));
    this._cache = { chiave, esito };
    return esito;
  }

  /**
   * Le frasi conosciute, già spezzate in parole, con il loro peso.
   *
   * Due fonti: le frasi dette davvero (pesate sul loro uso) e quelle
   * preparate dalla famiglia nei gruppi di frasi, che valgono come
   * frasi già dette alcune volte. Ricalcolate solo quando cambiano.
   */
  _frasiNote() {
    const gruppi = this.cfg.scan?.phraseGroups || [];
    const firma = `${this._ver}|${JSON.stringify(gruppi)}`;
    if (this._frasiCache?.firma === firma) return this._frasiCache.lista;
    const lista = [];
    const viste = new Set();
    for (const [testo, e] of this.phrases) {
      const T = token(testo);
      const k = T.join(' ');
      if (T.length < 2 || viste.has(k)) continue;
      viste.add(k);
      lista.push([T, 1 + this._score(e)]);
    }
    for (const g of gruppi) {
      for (const f of g.phrases || []) {
        const T = token(f);
        const k = T.join(' ');
        if (T.length < 2 || viste.has(k)) continue;
        viste.add(k);
        lista.push([T, 3]);
      }
    }
    this._frasiCache = { firma, lista };
    return lista;
  }

  /**
   * Frasi da mostrare nel menu rapido.
   *
   * L'ordine ESPLICITO vince sempre sul punteggio: in scansione la
   * posizione è il costo, e chi assiste sa meglio di qualunque
   * statistica quali frasi servono per prime a questa persona. Le
   * frasi senza ordine assegnato seguono, per punteggio.
   */
  topPhrases(n = 12) {
    const all = [...this.phrases.entries()];
    const fixed = all.filter(([, v]) => Number.isFinite(v.order))
                     .sort((a, b) => a[1].order - b[1].order);
    const rest = all.filter(([, v]) => !Number.isFinite(v.order))
                    .sort((a, b) => this._score(b[1]) - this._score(a[1]));
    return [...fixed, ...rest].slice(0, n).map(([p]) => p);
  }

  /** Elenco completo per la gestione, con l'ordine effettivo. */
  phraseList() {
    const ordered = this.topPhrases(9999);
    return ordered.map((key, i) => {
      const v = this.phrases.get(key);
      return { key, index: i, count: v.n, pinned: !!v.pinned, ordered: Number.isFinite(v.order) };
    });
  }

  /** Sposta una frase di una posizione, fissando l'ordine di tutte. */
  movePhrase(key, delta) {
    const list = this.topPhrases(9999);
    const i = list.indexOf(key);
    if (i < 0) return false;
    const j = Math.max(0, Math.min(list.length - 1, i + delta));
    if (i === j) return false;
    list.splice(j, 0, list.splice(i, 1)[0]);
    // Congela l'ordine di tutte: senza, le frasi non toccate
    // scivolerebbero da sole al variare del punteggio.
    list.forEach((k, idx) => {
      const e = this.phrases.get(k);
      if (e) { e.order = idx; this.phrases.set(k, e); }
    });
    return true;
  }

  /** Riporta l'ordinamento automatico per punteggio. */
  clearPhraseOrder() {
    for (const [k, v] of this.phrases) { delete v.order; this.phrases.set(k, v); }
  }

  /** Rinomina conservando posizione, conteggio e stato. */
  renamePhrase(oldKey, newKey) {
    const clean = (newKey || '').trim();
    if (!clean || clean === oldKey) return false;
    const e = this.phrases.get(oldKey);
    if (!e) return false;
    this.phrases.delete(oldKey);
    this.phrases.set(clean, e);
    this.learnSentenceSilent(clean);
    return true;
  }

  /**
   * Distribuzione della lettera successiva dato il contesto.
   * Usata per il riordino dinamico dei gruppi, che di default è SPENTO:
   * riordinare a ogni lettera distrugge la memoria motoria che la
   * persona ha costruito in mesi. Si accende solo con misura alla mano.
   */
  nextCharDistribution(context) {
    const ctx = ('^^' + (context || '').toLowerCase()).slice(-2);
    const out = new Map();
    for (const [k, v] of this.letters) {
      const [c, ch] = k.split('\t');
      if (c === ctx) out.set(ch.toUpperCase(), (out.get(ch.toUpperCase()) || 0) + v);
    }
    const w = this.cfg.prediction.corpusWeight;
    for (const [ch, f] of Object.entries(LETTER_FREQ_IT))
      out.set(ch, (out.get(ch) || 0) + f * w);
    return out;
  }

  /* -------------------------- Statistiche -------------------------- */

  stats() {
    const topOf = (m, n) => [...m.entries()]
      .sort((a, b) => this._score(b[1]) - this._score(a[1]))
      .slice(0, n)
      .map(([k, v]) => ({ key: k, count: v.n, last: v.last, pinned: !!v.pinned }));

    const letterCounts = new Map();
    for (const [k, v] of this.letters) {
      const ch = k.split('\t')[1];
      if (/[a-zàèéìòù]/i.test(ch)) letterCounts.set(ch.toUpperCase(), (letterCounts.get(ch.toUpperCase()) || 0) + v);
    }

    return {
      words: topOf(this.words, 40),
      phrases: topOf(this.phrases, 30),
      letters: [...letterCounts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count })),
      totals: { words: this.words.size, phrases: this.phrases.size, bigrams: this.bigrams.size },
    };
  }

  pin(kind, key, value = true) {
    const m = kind === 'phrase' ? this.phrases : this.words;
    const e = m.get(key);
    if (e) { e.pinned = value; m.set(key, e); }
    this._ver++;
  }

  remove(kind, key) {
    const m = kind === 'phrase' ? this.phrases : this.words;
    m.delete(key);
    this._ver++;
  }

  /** @param atTop true per metterla in cima, dove costa meno raggiungerla */
  addPhrase(text, atTop = false) {
    const c = (text || '').trim();
    if (!c) return false;
    this.phrases.set(c, { n: 5, last: Date.now(), pinned: true });
    this.learnSentenceSilent(c);
    this._ver++;
    if (atTop) {
      const list = this.topPhrases(9999).filter(k => k !== c);
      [c, ...list].forEach((k, i) => {
        const e = this.phrases.get(k);
        if (e) { e.order = i; this.phrases.set(k, e); }
      });
    }
    return true;
  }
}
