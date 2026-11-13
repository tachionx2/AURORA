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

import { SEED_WORDS, SEED_BIGRAMS, SEED_BIGRAMS_PARLATO, LETTER_FREQ_IT, VOCABOLARIO_IT, FREQ_FASCIA, FREQ_BASE } from './seed-it.js';
import { VOCABOLARIO_FREQ_IT } from './vocabolario-it.js';
import { senso, caricaSenso, contestoDi, affinita } from './Senso.js';
import { grammatica, caricaGrammatica, attese, fattoreGrammatica, quantoNome, numeroNominale, quantoProprio, genereSingolare } from './Grammatica.js';
import { coppie, caricaCoppie, legami } from './Coppie.js';

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

/**
 * Le parole di un testo divise per FRASE, minuscole, senza la
 * punteggiatura attaccata ("sete." → "sete"). Un punto chiude la frase:
 * la parola dopo non è "seguita" a quella prima.
 *
 * Un testo senza punteggiatura — tutto ciò che si scriveva prima che
 * esistesse il PUNTO — dà esattamente le parole di sempre, in una frase
 * sola.
 */
function frasiDi(testo) {
  const out = [];
  let cur = [];
  for (const grezza of String(testo || '').toLowerCase().split(/\s+/)) {
    if (!grezza) continue;
    const fine = /[.!?]+["')\]]*$/.test(grezza);
    const w = grezza.replace(/^[("'\[«]+/, '').replace(/[.,;:!?"')\]»…]+$/, '');
    if (w) cur.push(w);
    if (fine && cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Le parole della frase IN CORSO: quelle dopo l'ultimo punto. */
export function fraseInCorso(parole) {
  const ws = parole || [];
  let da = 0;
  for (let i = 0; i < ws.length; i++) if (/[.!?]$/.test(String(ws[i]))) da = i + 1;
  return da ? ws.slice(da) : ws;
}

/** Le parole di un testo, minuscole, senza punteggiatura. */
const TOKEN = /[a-zàáèéìíîòóùúç]+/g;
function token(testo) {
  return String(testo || '').toLowerCase().match(TOKEN) || [];
}

/** Un conteggio, oppure zero: protegge da valori corrotti nei dati salvati. */
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/* ══════════════════════════════════════════════════════════════════
 * ACCORDO GRAMMATICALE
 * ══════════════════════════════════════════════════════════════════
 *
 * L'italiano dice molto con la parola precedente: dopo "la" viene
 * quasi sempre un femminile singolare, dopo "dei" un maschile plurale,
 * dopo "io" un verbo in -o. Prima i suggerimenti lo ignoravano del
 * tutto: "le ca…" proponeva "caldo", "dei fi…" proponeva "fine".
 *
 * Un fattore, non un filtro: la parola che concorda sale, quella che
 * stride scende un po', ma nessuna sparisce — l'italiano ha eccezioni,
 * e ciò che Daniela dice davvero (le sue frasi, le sue coppie di
 * parole) pesa comunque di più.
 *
 * ⚠️ "la", "lo", "le", "gli" sono anche PRONOMI davanti a un verbo —
 * "la vedo", "lo so", "gli dico". Per quelle si favorisce la forma che
 * concorda ma non si penalizza nulla: penalizzare "voglio" dopo "la"
 * renderebbe più difficile "la voglio".
 */
const DETERMINANTI = (() => {
  const m = new Map();
  const metti = (lista, tipo, sicuro) => {
    for (const w of lista.split(' ')) m.set(w, { tipo, sicuro });
  };
  metti('una della alla dalla nella sulla questa quella mia tua sua nostra vostra nessuna alcuna ogni', 'fs', true);
  metti('la', 'fs', false);
  metti('il un uno del dello al allo dal dallo nel nello sul sullo questo quello quel mio tuo suo nostro vostro nessun nessuno alcun', 'ms', true);
  metti('lo', 'ms', false);
  metti('delle alle dalle nelle sulle queste quelle mie tue sue nostre vostre alcune', 'fp', true);
  metti('le', 'fp', false);
  metti('i dei degli ai agli dai dagli nei negli sui sugli questi quelli quei quegli miei tuoi suoi nostri vostri alcuni', 'mp', true);
  metti('gli', 'mp', false);
  // "ogni" vuole il singolare ma non il genere: si tratta a parte.
  m.delete('ogni');
  return m;
})();
// Eccezioni frequenti: femminili in -o, maschili in -a, plurali irregolari.
const FEMMINILI_IN_O = new Set('mano radio foto moto auto eco dinamo'.split(' '));
const MASCHILI_IN_A = new Set('problema problemi sistema sistemi programma programmi tema temi schema dramma clima cinema pigiama papà pianeta poeta diploma'.split(' '));
const PLURALI_IRREGOLARI_F = new Set('mani radio foto moto auto'.split(' '));
/* Soggetto → desinenza del verbo, con la forza che merita: -iamo dopo
 * "noi" è quasi una certezza, -o dopo "io" lo è molto meno (tantissime
 * parole finiscono in -o). */
const SOGGETTI = new Map([
  ['io', [/o$/, 1.4]], ['tu', [/i$/, 1.4]],
  ['noi', [/iamo$/, 2.0]], ['voi', [/(ate|ete|ite)$/, 1.8]],
]);
// Un infinito finisce in -e ma non è un femminile plurale.
const INFINITO = /(are|ere|ire)$/;
/* Parole che non sono MAI un nome né un aggettivo: dopo un articolo
 * sono impossibili. Volutamente esclusi "tanto", "poco", "solo",
 * "proprio", "tutto", "altro", "prima": dopo un articolo possono
 * esserci ("il solo", "la prima"). */
const NON_NOMI = new Set(('senza sopra sotto dentro fuori contro verso dopo durante mentre '
  + 'sempre anche ancora ora allora ecco come dove quando perché quindi poi già più meno '
  + 'molto troppo forse mai ormai appena oppure però infatti inoltre circa quasi insieme '
  + 'subito presto tardi spesso adesso oggi ieri domani qui qua lì là così cioè anzi '
  + 'neanche nemmeno neppure tuttavia comunque eppure finché siccome sebbene affinché '
  + 'oltre tranne fra tra per con della delle degli dello sul sulla nel nella non che '
  + 'ma se anzitutto altrimenti benché nonché ovvero ossia purché qualora').split(' '));

/* Segni di PLURALE nelle parole appena scritte: articoli e determinanti
 * plurali, numeri, quantità, soggetti plurali. Servono a non anteporre
 * il singolare quando la frase vuole il plurale ("i bambi…" → bambini). */
const SEGNI_PLURALE = new Set(('i gli le dei degli delle ai agli alle dai dagli dalle nei negli '
  + 'nelle sui sugli sulle coi questi queste quelli quelle quei quegli miei mie tuoi tue suoi '
  + 'sue nostri nostre vostri vostre alcuni alcune molti molte tanti tante pochi poche '
  + 'tutti tutte troppi troppe parecchi parecchie certi certe vari varie diversi diverse altri '
  + 'altre entrambi entrambe ambedue due tre quattro cinque sei sette otto nove dieci undici '
  + 'dodici venti cento mille noi voi siamo siete').split(' '));
/* ── Chi scrive sta parlando di SÉ? ──
 * Verbi in prima persona singolare che vogliono un aggettivo o un
 * participio accordato con chi parla. "ho" NON c'è: "ho mangiato" non
 * si accorda. */
const VERBI_DI_SE = new Set('sono ero sarò sarei sto stavo starò sembro resto rimango divento diventerò'.split(' '));
const AVVERBI_IN_MEZZO = new Set(('molto troppo tanto poco più meno così già sempre ancora proprio davvero '
  + 'abbastanza piuttosto non mai un po quasi tutta tutto veramente ora adesso oggi').split(' '));
export function parlaDiSe(S) {
  let i = S.length - 1, saltati = 0;
  while (i >= 0 && AVVERBI_IN_MEZZO.has(S[i]) && saltati < 3) { i--; saltati++; }
  if (i < 0) return false;
  const w = S[i], prima = S[i - 1], primaAncora = S[i - 2];
  // Un soggetto diverso da "io" subito prima: non parla di sé.
  const altri = new Set('tu lui lei noi voi loro essi esse egli ella che chi'.split(' '));
  if (VERBI_DI_SE.has(w)) return !(prima && altri.has(prima)) && !contestoPlurale(S.slice(0, i));
  // "mi sento …", "mi sono …" è già coperto da "sono"; "sono stata/stato …"
  if (w === 'sento' && prima === 'mi') return true;
  if ((w === 'stata' || w === 'stato') && (prima === 'sono' || prima === 'ero' || prima === 'sarei')) {
    return !(primaAncora && altri.has(primaAncora));
  }
  return false;
}

/** C'è un segno chiaro di plurale fra le ultime tre parole? ("sono" no:
 *  per Daniela è quasi sempre "io sono".) */
function contestoPlurale(S) {
  for (let k = 1; k <= 3; k++) if (SEGNI_PLURALE.has(S[S.length - k])) return true;
  return false;
}

/**
 * Quanto la parola `w` concorda con la parola che la precede.
 * @param vuote parole funzionali (di, senza, anche…): dopo un articolo
 *        non vengono mai, quindi non ricevono alcun favore.
 * @returns un fattore: 1 = nessuna informazione, >1 concorda, <1 stride.
 */
function fattoreAccordo(prima, w, vuote) {
  if (!prima || !w) return 1;
  const sogg = SOGGETTI.get(prima);
  if (sogg) return sogg[0].test(w) ? sogg[1] : 1;
  const d = DETERMINANTI.get(prima);
  if (!d) return 1;
  /* "questa senza", "la anche": un articolo non introduce mai una
   * preposizione, una congiunzione o un avverbio.
   *
   * ⚠️ Serve un ELENCO, non la frequenza: fra le parole più frequenti
   * ci sono anche nomi come "casa" e "vita", e "senza" finisce in -a
   * proprio come "casa". Con il primo tentativo — escludere le parole
   * più frequenti — "la ca…" aveva smesso di proporre "casa". */
  if (NON_NOMI.has(w)) return d.sicuro ? 0.5 : 1;
  const fine = w[w.length - 1];
  let concorda = false, stride = false;
  switch (d.tipo) {
    case 'fs':
      concorda = fine === 'a' || FEMMINILI_IN_O.has(w);
      stride = (fine === 'o' && !FEMMINILI_IN_O.has(w)) || fine === 'i';
      break;
    case 'ms':
      concorda = fine === 'o' || MASCHILI_IN_A.has(w);
      stride = (fine === 'a' && !MASCHILI_IN_A.has(w)) || fine === 'i';
      break;
    case 'fp':
      concorda = (fine === 'e' && !INFINITO.test(w)) || PLURALI_IRREGOLARI_F.has(w);
      stride = ((fine === 'o' || fine === 'a' || fine === 'i') && !PLURALI_IRREGOLARI_F.has(w))
        || INFINITO.test(w);
      break;
    case 'mp':
      concorda = fine === 'i';
      stride = fine === 'o' || fine === 'a';
      break;
  }
  if (concorda) return 1.4;
  if (stride && d.sicuro) return 0.7;
  return 1;
}

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
  // Dopo un PUNTO comincia una frase nuova: il contesto riparte da lì.
  const ris = cfg.prediction?.enabled
    ? predictor.suggerisci({ prefisso: buffer?.letters || '', parole: fraseInCorso(buffer?.words), n: quanti })
    : [];
  /* Proposta diretta: solo le parole che staccano nettamente le
   * altre. Chi assiste propone quando intuisce, non a ogni lettera. */
  const proposte = S.suggerimentiDiretti
    ? ris.filter(s => s.quota >= (S.suggerimentiDirettiSoglia ?? 0.35))
         .slice(0, Math.max(1, Math.min(3, S.suggerimentiDirettiN || 1)))
         .map(s => s.parola)
    : [];
  /* ⚠️ Nel gruppo la parola proposta a voce C'È, ed è la PRIMA.
   *
   * Prima veniva tolta ("non si ripete ciò che è già stato detto"), e
   * il risultato era un inganno: la voce diceva "sono", chi entrava in
   * Suggerimenti un attimo dopo trovava per prima "solo" — e scriveva
   * "solo". Ciò che si è sentito proporre deve essere ciò che si
   * trova: l'elenco è la classifica, dalla migliore in giù.
   *
   * Le parole proposte a voce si AGGIUNGONO in testa: le alternative
   * restano tante quante prima (misurato: togliendone una, la parola
   * giusta usciva dall'elenco tre volte su cento). */
  const suggerimenti = ris.map(s => s.parola).slice(0, (S.suggestionCount || 4) + proposte.length);
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
    /* ⚠️ TUTTO il vocabolario, non solo le 437 parole di partenza.
     *
     * Per mesi il correttore ha conosciuto solo quelle, più il lessico
     * personale: ogni altra parola italiana per lui era un errore.
     * "chiesa" diventava "chiama", "fianco" "stanco", "andata"
     * "andate". Misurato su frasi di assistenza scritte GIUSTE: toccava
     * una parola sana su sette. Con le trentamila parole dei
     * suggerimenti scende a una su cinquecento. */
    const tutte = () => {
      if (cache) return cache;
      const s = new Set(VOCABOLARIO_IT);
      for (const w of Object.keys(SEED_WORDS)) s.add(w);
      for (const w of questo.words.keys()) s.add(w);
      /* Le parole CORTE e RARISSIME restano fuori: "cao", "aqua",
       * "farm" stanno nel vocabolario (un cognome, una marca, una
       * parola straniera) ma chi le scrive con Aurora ha quasi sempre
       * sbagliato "ciao", "acqua", "fame". Tenendole, quegli errori
       * risultavano parole giuste e non venivano mai corretti. */
      for (const [w, F] of corpus().freq) {
        if (w.length <= 4 && F < 12 && !s.has(w)) continue;
        s.add(w);
      }
      cache = s;
      return s;
    };
    const piccolo = new Set(VOCABOLARIO_IT);
    for (const w of Object.keys(SEED_WORDS)) piccolo.add(w);
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
        // Per le parole fuori dall'elenco di partenza, la frequenza
        // reale d'uso (tarata sul banco dei refusi: 0,4).
        const fascia = FREQ_FASCIA[w]
          ?? ((piccolo.has(w) || questo.words.has(w)) ? FREQ_BASE : 0) + (corpus().freq.get(w) || 0) * 0.4;
        return Math.min(1,
          (pers / maxPers) * 0.55
          + Math.min(1, gen / 100) * 0.15
          + (fascia / 100) * 0.30);
      },
      bigramma: (prec, w) => {
        if (!prec) return 0;
        const chiave = `${prec}\t${w}`;
        const n = questo.bigrams.get(chiave) || SEED_BIGRAMS[chiave] || 0;
        if (n > 0) return Math.min(1, 0.4 + n / 10);
        /* Il parlato di chi è assistito: "mi manchi", "hai ragione".
         * Vale meno delle coppie che Daniela ha scritto davvero, ma dice
         * al correttore quale di due parole vicine è quella sensata.
         *
         * ⚠️ Provati anche la grammatica e le espressioni dell'italiano
         * generico (quelle dei suggerimenti): correggevano il 2-3% in
         * più, ma RADDOPPIAVANO le correzioni sbagliate. Per un
         * correttore il conto non torna: lasciate fuori. */
        const k2 = `${prec} ${w}`;
        return SEED_BIGRAMS_PARLATO[k2] ? Math.min(1, 0.4 + SEED_BIGRAMS_PARLATO[k2] / 60) : 0;
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

    /* ⚠️ Parole SENZA la punteggiatura attaccata, e una frase alla volta:
     * altrimenti "sete." entrerebbe nel lessico come parola a sé — e
     * verrebbe poi suggerita col punto — e la prima parola di una frase
     * risulterebbe "seguita" all'ultima della precedente. */
    for (const ws of frasiDi(clean)) {
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
    }

    /* ── Contesto lungo ──
     * Sulle parole pulite dalla punteggiatura, le stesse che i
     * suggerimenti leggono dalla frase in composizione: altrimenti
     * "sete." imparata con il punto non corrisponderebbe mai a "sete". */
    const tk = token(clean);
    for (const fr of frasiDi(clean)) {
      const t3 = fr.flatMap(w => token(w));
      for (let i = 2; i < t3.length; i++) {
        const k = `${t3[i - 2]}\t${t3[i - 1]}\t${t3[i]}`;
        this.trigrams.set(k, num(this.trigrams.get(k)) + 1);
      }
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
    const ws = frasiDi(text).flat();
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
  /**
   * Forme VICINE a una parola appena scelta: "staccare" → "staccarsi",
   * "staccarmi"; "andato" → "andata", "andati"; "bello" → "bella".
   *
   * Sono le parole del vocabolario con la stessa radice — tutta la
   * parola meno l'ultima lettera — e di lunghezza vicina, ordinate come
   * ogni altro suggerimento: per frequenza, grammatica e senso della
   * frase. Mai la parola stessa.
   */
  varianti(parola, parolePrima = [], n = 3) {
    const w = token(parola).join('');
    if (w.length < 4) return [];
    const radice = w.slice(0, -1);
    const P = this.cfg.prediction;
    let ris = [];
    try {
      ris = this.suggerisci({ prefisso: radice, parole: fraseInCorso(parolePrima), n: 40 });
    } catch { ris = []; }
    // Parole corte: solo il cambio di desinenza (casa → case, caso), non
    // tutta la famiglia (cassa, castello). Lunghe: fino a 4 lettere in più.
    const piu = w.length <= 5 ? 1 : 4;
    return ris.map(x => x.parola)
      .filter(c => c !== w && c.length >= w.length - 1 && c.length <= w.length + piu)
      .slice(0, Math.max(1, n));
  }

  /**
   * La forma ACCORDATA con chi scrive, se quella scritta è del genere
   * sbagliato: "sono stanco", scritto da una donna, → "stanca".
   *
   * Per la correzione automatica. Restituisce la parola da mettere, o
   * null — che è la risposta in tutti i casi dubbi:
   *   · il genere non è indicato nelle impostazioni;
   *   · la frase non parla di chi scrive ("sono", "mi sento", "ero"…);
   *   · la parola non finisce in -o / -a, o la gemella non esiste;
   *   · né la parola né la gemella sono aggettivi o participi;
   *   · dopo viene un altro aggettivo ("sono solo stanca": "solo" lì è
   *     un avverbio, non va toccato).
   */
  accordoConChiScrive(parolePrima, parola, parolaDopo = null) {
    const P = this.cfg.prediction;
    const genere = P.genereUtente === 'f' || P.genereUtente === 'm' ? P.genereUtente : null;
    const Gm = P.contestoFrase !== false ? grammatica() : null;
    if (!genere || !Gm) return null;
    const w = token(parola).join('');
    if (w.length < 4 || w !== String(parola).toLowerCase().replace(/[.,;:!?]+$/, '')) return null;
    const [sbagliata, giusta] = genere === 'f' ? ['o', 'a'] : ['a', 'o'];
    if (!w.endsWith(sbagliata)) return null;
    const S = fraseInCorso(parolePrima).flatMap(x => token(x));
    if (!parlaDiSe(S)) return null;
    const gemella = w.slice(0, -1) + giusta;
    const C = corpus();
    if (!C.freq.has(gemella) && !this.words.has(gemella)) return null;
    const agg = (x) => { const q = genereSingolare(Gm, x); return q ? q.f + q.m : 0; };
    if (agg(w) < 0.3 && agg(gemella) < 0.3) return null;
    // Un nome non si accorda: "sono maestro" resta com'è solo se non è aggettivo.
    if (parolaDopo) {
      const d = token(parolaDopo).join('');
      if (d && agg(d) >= 0.3 && agg(w) < 0.5) return null;   // "solo" + aggettivo: avverbio
    }
    return gemella;
  }

  /** Carica il significato delle parole; per chi vuole aspettarlo (test). */
  preparaContesto() { return Promise.all([caricaSenso(), caricaGrammatica(), caricaCoppie()]); }

  suggerisci({ prefisso = '', parole = [], n = 4 } = {}) {
    const P = this.cfg.prediction;
    if (!P?.enabled) return [];
    const p = String(prefisso || '').toLowerCase().trim();
    /* ⚠️ Mai senza almeno una lettera della parola: i suggerimenti
     * riguardano la parola che si sta scrivendo. Dopo uno spazio non
     * si propone nulla finché non comincia la parola nuova. */
    if (!p || p.length < Math.max(1, P.minPrefixForWord || 1)) return [];

    const S = (parole || []).flatMap(w => token(w));
    /* Grammatica, significato e coppie dell'italiano, se già caricati
     * (altrimenti il caricamento parte ora e intanto si fa senza).
     * Spegnendo `contestoFrase` i suggerimenti sono quelli di prima. */
    const ctxOn = P.contestoFrase !== false;
    const M = ctxOn && P.significato !== false ? senso() : null;
    const Gm = ctxOn && P.grammatica !== false ? grammatica() : null;
    const Cp = ctxOn && P.coppie !== false ? coppie() : null;
    // Stessa domanda, stesse statistiche: stessa risposta, senza ricalcolare.
    const chiave = `${this._ver}|${p}|${S.join(' ')}|${n}|${P.corpusWeight}|${M ? 1 : 0}|${Gm ? 1 : 0}|${Cp ? 1 : 0}|${P.coppieK}|${P.coppieK3}|${P.puntiMin}|${P.gramMax}|${P.singolarePrima}|${P.pluraleK}|${P.cortePrima}|${P.corteK}|${P.genereUtente}|${P.propriK}|${P.sonoSingolare}|${P.sensoBeta}|${P.sensoSoglia}|${P.sensoMax}|${P.gramK}|${P.sensoNomi}|${P.sensoForte}|${P.sensoZForte}`;
    if (this._cache?.chiave === chiave) return this._cache.esito;

    const C = corpus();
    const cand = new Map();
    const add = (w, s) => {
      if (!(s > 0) || w === p || !w.startsWith(p)) return;
      cand.set(w, (cand.get(w) || 0) + s);
    };

    // 1. Frequenza dell'italiano — ricerca binaria sul prefisso.
    const cw = P.corpusWeight ?? 0.2;
    // La parte "italiano generico" di ogni punteggio, tenuta a parte:
    // è la sola che significato, grammatica e coppie possono affinare.
    const generico = new Map();
    let lo = 0, hi = C.ordinate.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (C.ordinate[m] < p) lo = m + 1; else hi = m; }
    for (let i = lo; i < C.ordinate.length && C.ordinate[i].startsWith(p); i++) {
      const w = C.ordinate[i];
      add(w, cw * C.freq.get(w));
      if (w !== p) generico.set(w, cw * C.freq.get(w));
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
      // Il parlato in prima persona: contrappeso di grammatica e
      // significato, che vengono da testi scritti. Solo insieme a loro.
      if (ctxOn) {
        for (const [k, v] of Object.entries(SEED_BIGRAMS_PARLATO)) {
          const [a, b] = k.split(' ');
          if (a === w1) add(b, v * cw * 2);
        }
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

    const prima7 = new Map(cand);
    // 7. Accordo con la parola precedente: articolo → nome, soggetto → verbo.
    if (w1) {
      for (const [w, s] of cand) {
        const f = fattoreAccordo(w1, w, C.vuote);
        if (f !== 1) cand.set(w, s * f);
      }
    }

    /* ══ Fonti 8-10: significato, grammatica, coppie dell'italiano ══
     *
     * ⚠️ Ognuna aggiunge PUNTI DI FREQUENZA alla parola, e i punti si
     * SOMMANO, applicati una volta sola alla fine. La frequenza è su
     * scala logaritmica: sommare punti lì equivale a moltiplicare la
     * probabilità reale, ed è il modo giusto di combinare indizi.
     * Il primo tentativo applicava le tre fonti una sopra l'altra: per
     * una parola rara come "cornea" tre spinte moderate diventavano
     * enormi, e "ho freddo mettimi la co…" proponeva "cornea" invece di
     * "coperta". */
    const punti = new Map();
    const piu = (w, b) => { if (b) punti.set(w, (punti.get(w) || 0) + b); };

    // 8. Argomento della frase, dal SIGNIFICATO delle parole.
    if (M) {
      const piene = S.filter(w => w.length >= 3 && !C.vuote.has(w));
      /* L'argomento lo portano soprattutto i NOMI: "sono andata in
       * chiesa" parla di chiesa, non di andare. Senza questo peso
       * "andata" attirava altri verbi di movimento. */
      const pn = P.sensoNomi ?? 0.8;
      const pesoParola = Gm ? (w) => { const q = quantoNome(Gm, w); return q == null ? 1 : (1 - pn) + pn * q; } : null;
      const Cx = contestoDi(M, piene, 0.85, pesoParola);
      if (Cx) {
        // Affinità di ogni candidata con la frase…
        const aff = [];
        for (const w of cand.keys()) {
          if (C.vuote.has(w)) continue;
          const a = affinita(Cx, w);
          if (a != null) aff.push([w, a]);
        }
        // …confrontata con quella delle rivali: conta chi si distingue.
        if (aff.length >= 3) {
          let m = 0; for (const [, a] of aff) m += a; m /= aff.length;
          let v = 0; for (const [, a] of aff) v += (a - m) ** 2;
          const ds = Math.sqrt(v / aff.length) || 1;
          /* ⚠️ Il significato si SOMMA sulla scala della frequenza, non
           * la moltiplica. Quella scala è logaritmica: "per" vale 90 e
           * "petto" 29, ma "per" è diecimila volte più frequente. Un
           * moltiplicatore 4 su quella scala equivale a ×10000 nella
           * realtà: il primo tentativo faceva perdere il primo posto a
           * "per", "con", "che", "non". Misurato, e corretto così: ogni
           * scarto di affinità vale `kappa` punti di frequenza. */
          const kappa = P.sensoBeta ?? 4, zMin = P.sensoSoglia ?? -2, zMax = P.sensoMax ?? 3;
          /* Un legame NETTO con l'argomento — "chiesa" e "pregare",
           * "dottore" e "terapia" — vale più della somma dei legami
           * deboli: chi assiste, in quei casi, pensa subito a quella
           * parola. La spinta in più scatta solo oltre `zForte` scarti. */
          const k2 = P.sensoForte ?? 25, zf = P.sensoZForte ?? 3;
          for (const [w, a] of aff) {
            const zr = (a - m) / ds;
            const z = Math.min(zMax, Math.max(zMin, zr));
            const extra = k2 * Math.max(0, Math.min(5, zr) - zf);
            piu(w, kappa * z + extra);
          }
        }
      }
    }

    // 9. Che tipo di parola può venire adesso, dalle due precedenti.
    /* ⚠️ "la", "lo", "le", "gli" sono anche PRONOMI: "la voglio", "lo
     * so", "gli dico". Nei testi scritti sono quasi sempre articoli, e la
     * grammatica spingeva i nomi fino a far sparire "voglio" dopo "la".
     * Lì decide l'accordo (fonte 7), che è stato tarato apposta su
     * questa ambiguità: la grammatica si astiene. */
    const ultima = S[S.length - 1];
    const astieni = DETERMINANTI.get(ultima)?.sicuro === false || ultima === 'l';
    /* ⚠️ "sono", per Daniela, è "IO sono": nei testi scritti da cui
     * vengono grammatica ed espressioni è quasi sempre "LORO sono", e
     * "sono andat…" proponeva "andate, andati" prima di "andata". Per
     * grammatica ed espressioni "sono" si legge come la forma singolare
     * "è": dopo, ci si aspetta "andata", "stata", "stanca". */
    const Sp = P.sonoSingolare !== false ? S.map(w => (w === 'sono' ? 'è' : w)) : S;
    if (Gm && !astieni) {
      const d = attese(Gm, Sp);
      if (d) {
        const kg = P.gramK ?? 10;
        for (const w of cand.keys()) {
          const g = fattoreGrammatica(Gm, d, w);
          if (g === 1) continue;
          /* ⚠️ Asimmetrico: ciò che la grammatica dice IMPOSSIBILE ("in
           * basta") scende fino a e⁻³; ciò che dice TIPICO sale al massimo
           * di e^1,5. I testi da cui viene sono scritti, e lì "sono" è
           * quasi sempre "sono stati", "hai" quasi sempre "hai fatto":
           * spinte più forti travolgevano "sono stanca", "hai ragione". */
          const lg = Math.min(P.gramMax ?? 1.5, Math.max(-3, Math.log(g)));
          piu(w, kg * lg);
        }
      }
    }

    // 10. Parole che nell'italiano reale vanno insieme a quelle appena scritte.
    if (Cp && S.length) {
      const { d1, d2 } = legami(Cp, Sp);
      if (d1 || d2) {
        const kb = P.coppieK ?? 7, kt = P.coppieK3 ?? 18;
        for (const w of cand.keys()) {
          piu(w, kb * (d1?.get(w) || 0) + kt * (d2?.get(w) || 0));
        }
      }
    }

    /* 11. Il SINGOLARE prima del plurale, se il contesto non dice plurale.
     *
     * Nel parlato il singolare è il caso normale: "andata" prima di
     * "andati", "montagna" prima di "montagne". I testi scritti da cui
     * vengono grammatica e coppie dicevano il contrario dopo "sono", che
     * lì è quasi sempre "sono andati": per Daniela è "io sono".
     * Scende solo un plurale il cui SINGOLARE è fra le candidate (stessa
     * radice): "occhiali" o "spaghetti", che un singolare non hanno, non
     * vengono toccati. Se nelle parole precedenti c'è un segno chiaro di
     * plurale — "i", "le", "dei", "questi", "tanti", "due", "noi",
     * "siamo" — non scende nulla. */
    if (Gm && P.singolarePrima !== false && !contestoPlurale(S)) {
      const kn = P.pluraleK ?? 6;
      const singolari = new Set();
      for (const w of cand.keys()) {
        const n = w.length > 3 ? numeroNominale(Gm, w) : null;
        if (n && n.sing > 0.5) singolari.add(w.slice(0, -1));
      }
      for (const w of cand.keys()) {
        if (w.length <= 3 || !singolari.has(w.slice(0, -1))) continue;
        const n = numeroNominale(Gm, w);
        if (n && n.plur > 0.5) piu(w, -kn * n.plur);
      }
    }

    /* 12. Le parole CORTE prima (facoltativo, `cortePrima`).
     *
     * ⚠️ SPENTO di default, e per una ragione misurata: la frequenza
     * mette già prima le parole corte ("no…" → non, noi, nostro), perché
     * in ogni lingua le parole più usate sono le più corte. Forzarlo
     * oltre toglie il primo posto a parole lunghe ma giuste: su 1500
     * parole di prova la proposta giusta al primo colpo scendeva di
     * uno-due punti a OGNI intensità provata (anche come semplice
     * spareggio). Resta come scelta per chi lo preferisce. */
    if (ctxOn && P.cortePrima) {
      const kl = P.corteK ?? 1;
      for (const w of cand.keys()) piu(w, -kl * Math.max(0, w.length - p.length - 1));
    }

    /* 13. I NOMI PROPRI dopo le parole comuni.
     *
     * I testi da cui viene la grammatica cominciano spesso con un nome
     * ("Maria ha detto…"): a inizio frase "ma…" proponeva "maria" e
     * "max" prima di "mamma". Chi scrive con Aurora i nomi dei suoi li
     * ha nel lessico personale, che non viene toccato. */
    if (Gm && ctxOn) {
      const kp = P.propriK ?? 4;
      if (kp > 0) for (const w of cand.keys()) {
        if (this.words.has(w)) continue;
        const q = quantoProprio(Gm, w);
        if (q && q > 0.4) piu(w, -kp * q);
      }
    }

    /* 14. Concordanza con CHI SCRIVE, quando parla di sé.
     *
     * "sono stan…" → "stanca" se chi scrive è una donna, "stanco" se è
     * un uomo. Vale solo dopo un verbo in prima persona che vuole un
     * aggettivo o un participio accordato ("sono", "mi sento", "sono
     * stata", "ero"…), e solo se il genere è indicato nelle impostazioni. */
    const genere = P.genereUtente === 'f' || P.genereUtente === 'm' ? P.genereUtente : null;
    /* ⚠️ Agisce su TUTTO il punteggio, non solo sulla parte generica
     * come le altre fonti: "stanco" e "stanca" sono parole dell'assistenza,
     * forti di loro, e una spinta sulla sola frequenza non le scambiava.
     * È una regola di accordo, come quella fra articolo e nome. */
    const perGenere = new Map();
    if (Gm && ctxOn && genere && parlaDiSe(S)) {
      /* Scende SOLO la forma del genere sbagliato, e solo se la sua
       * gemella giusta esiste fra le candidate: "stanco" per una donna
       * quando c'è "stanca". Si guarda la DESINENZA (-o / -a), non
       * l'etichetta del lessico, che per gli aggettivi in -e ("triste",
       * "felice", uguali per tutti) è inaffidabile: la prima versione
       * li faceva scendere. Le forme giuste non salgono: spingendole,
       * ogni participio accordato superava le parole senza genere
       * ("sono tr…" → "trovata" prima di "triste"). */
      const [sbagliata, giusta] = genere === 'f' ? ['o', 'a'] : ['a', 'o'];
      const aggettivo = (w) => { const q = genereSingolare(Gm, w); return !!q && (q.f + q.m) > 0.3; };
      for (const w of cand.keys()) {
        if (w.length < 4 || !w.endsWith(sbagliata)) continue;
        const gemella = w.slice(0, -1) + giusta;
        if (!cand.has(gemella)) continue;
        if (!aggettivo(w) && !aggettivo(gemella)) continue;
        perGenere.set(w, gemella);
      }
    }

    /* I punti raccolti, applicati una volta sola — e SOLO alla parte
     * generica del punteggio.
     *
     * ⚠️ Significato, grammatica e coppie vengono da testi scritti, dove
     * "per" è seguito quasi sempre da un infinito e "sono" da "stato".
     * Applicati a tutto il punteggio, travolgevano le prove più preziose
     * — il lessico e le frasi di Daniela, le coppie dell'assistenza:
     * "per fa…" proponeva "fare" invece di "favore", "sono st…" perdeva
     * "stanca". Ciò che Daniela dice davvero resta com'è: l'italiano
     * generico affina solo ciò che è generico. */
    const fMin = P.puntiMin ?? 0.15;
    for (const [w, b] of punti) {
      const F = Math.max(5, C.freq.get(w) || 0);
      const f = Math.max(fMin, (F + b) / F);
      const tot = cand.get(w);
      // La parte generica ha già subito l'accordo (fonte 7) insieme al resto.
      const g0 = generico.get(w) || 0;
      const quota = Math.min(1, g0 / (prima7.get(w) || tot || 1));
      const g = tot * quota;
      cand.set(w, (tot - g) + g * f);
    }
    /* La forma giusta PRENDE IL POSTO di quella sbagliata, se valeva
     * meno: "stanca" sale dove stava "stanco", che scende di `kq`. */
    for (const [w, gemella] of perGenere) {
      const a = cand.get(w), b = cand.get(gemella);
      if (b < a) cand.set(gemella, a);
      cand.set(w, Math.min(a, b) * Math.exp(-(P.genereK ?? 0.7)));
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
