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

const DAY_MS = 86400000;

export class Predictor {
  constructor(cfg, saved = null) {
    this.cfg = cfg;
    this.words = new Map();      // parola → { n, last, pinned }
    this.bigrams = new Map();    // "a\tb" → n
    this.phrases = new Map();    // frase → { n, last, pinned }
    this.letters = new Map();    // "ctx\tchar" → n
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

    // I bigrammi hanno struttura annidata: parola → successiva → conteggio
    if (data.bigrams) {
      let n = 0;
      for (const [prima, seguenti] of Object.entries(data.bigrams)) {
        const mia = this.bigrams.get(prima) || new Map();
        for (const [dopo, c] of Object.entries(seguenti)) {
          mia.set(dopo, (mia.get(dopo) || 0) + (c || 0));
          n++;
        }
        this.bigrams.set(prima, mia);
      }
      esito.coppie = n;
    }
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
   * Candidati di parola per il prefisso corrente.
   * Miscela: personale pesato sulla recenza + corpus italiano di base.
   */
  completions(prefix, prevWord = null, n = 4) {
    if (!this.cfg.prediction.enabled) return [];
    const p = (prefix || '').toLowerCase();
    if (p.length < this.cfg.prediction.minPrefixForWord) return [];

    const cand = new Map();
    const add = (w, s) => { if (w.startsWith(p)) cand.set(w, (cand.get(w) || 0) + s); };

    for (const [w, e] of this.words) add(w, this._score(e));
    const cw = this.cfg.prediction.corpusWeight;
    for (const [w, f] of Object.entries(SEED_WORDS)) add(w, f * cw);

    // Bonus di bigramma: se conosciamo la parola precedente, pesa molto.
    if (prevWord) {
      const pw = prevWord.toLowerCase();
      for (const [k, v] of this.bigrams) {
        const [a, b] = k.split('\t');
        if (a === pw) add(b, v * 3);
      }
      for (const [k, v] of Object.entries(SEED_BIGRAMS)) {
        const [a, b] = k.split(' ');
        if (a === pw) add(b, v * cw * 2);
      }
    }

    return [...cand.entries()]
      .filter(([w]) => w !== p)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([w]) => w);
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
  }

  remove(kind, key) {
    const m = kind === 'phrase' ? this.phrases : this.words;
    m.delete(key);
  }

  /** @param atTop true per metterla in cima, dove costa meno raggiungerla */
  addPhrase(text, atTop = false) {
    const c = (text || '').trim();
    if (!c) return false;
    this.phrases.set(c, { n: 5, last: Date.now(), pinned: true });
    this.learnSentenceSilent(c);
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
