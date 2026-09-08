/**
 * SessionStats.js — Statistiche cliniche della sessione.
 *
 * ══════════════════════════════════════════════════════════════════
 * A COSA SERVE
 * ══════════════════════════════════════════════════════════════════
 *
 * La taratura automatica osserva venticinque secondi. Una sessione può
 * durare ore, e su ore si misura ciò che venticinque secondi non
 * possono vedere: come cambia il nistagmo con la stanchezza, se i
 * tremori aumentano di sera, quanto spesso una soglia viene superata
 * senza che segua una selezione — cioè i falsi positivi veri.
 *
 * Serve a due scopi distinti:
 *   · dare a chi cura un quadro obiettivo del comportamento oculare;
 *   · ricavare parametri di rilevamento su una base molto più solida
 *     di una manciata di secondi.
 *
 * ══════════════════════════════════════════════════════════════════
 * PRINCIPI DI PROGETTO
 * ══════════════════════════════════════════════════════════════════
 *
 * 1. MEMORIA COSTANTE. Nessun campione grezzo viene conservato: tutto
 *    finisce in istogrammi a caselle fisse e in un riepilogo per ora.
 *    Una sessione di dieci ore occupa pochi kilobyte, una di tre giorni
 *    pure. Senza questo vincolo il programma finirebbe la memoria
 *    proprio nelle sessioni lunghe, che sono quelle che interessano.
 *
 * 2. MODULO PURO. Riceve numeri, restituisce numeri. Non conosce il
 *    DOM, non tocca la configurazione, non ha effetti collaterali.
 *    Così si verifica fuori dal browser su segnali costruiti apposta,
 *    e si sa esattamente cosa produce in ogni caso.
 *
 * 3. COSTO TRASCURABILE NEL CICLO. `push` fa qualche incremento intero;
 *    i calcoli veri (frequenza, ampiezza) avvengono una volta al
 *    secondo su una finestra breve. Il ciclo video gira trenta volte al
 *    secondo e ogni ritardo si somma alla latenza del gesto.
 */

/* ── Bande di frequenza dell'oscillazione involontaria ──
 * I confini non sono arbitrari: seguono la letteratura clinica.
 *   deriva   < 0,5 Hz  — spostamenti lenti, posizionamento, sonnolenza
 *   tremore  0,5-2 Hz  — tremori e micro-movimenti volontari residui
 *   nistagmo 2-8 Hz    — la banda tipica del nistagmo
 *   rapido   > 8 Hz    — di solito rumore del rilevatore o vibrazioni
 */
export const BANDE = [
  { id: 'deriva',   min: 0,   max: 0.5, nome: 'Deriva lenta' },
  { id: 'tremore',  min: 0.5, max: 2,   nome: 'Tremore' },
  { id: 'nistagmo', min: 2,   max: 8,   nome: 'Nistagmo' },
  { id: 'rapido',   min: 8,   max: 1e9, nome: 'Oscillazione rapida' },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Istogramma a caselle fisse: memoria costante, qualunque sia la durata. */
class Istogramma {
  constructor(min, max, n) {
    this.min = min; this.max = max; this.n = n;
    this.bin = new Array(n).fill(0);
    this.tot = 0; this.somma = 0; this.massimo = -Infinity; this.minimo = Infinity;
  }
  add(v, peso = 1) {
    if (!Number.isFinite(v)) return;
    const i = clamp(Math.floor((v - this.min) / (this.max - this.min) * this.n), 0, this.n - 1);
    this.bin[i] += peso;
    this.tot += peso; this.somma += v * peso;
    if (v > this.massimo) this.massimo = v;
    if (v < this.minimo) this.minimo = v;
  }
  get media() { return this.tot ? this.somma / this.tot : 0; }
  /** Valore sotto cui cade la frazione indicata dei campioni. */
  percentile(p) {
    if (!this.tot) return 0;
    const soglia = this.tot * clamp(p, 0, 1);
    let cum = 0;
    for (let i = 0; i < this.n; i++) {
      cum += this.bin[i];
      if (cum >= soglia) return this.min + (i + 0.5) * (this.max - this.min) / this.n;
    }
    return this.max;
  }
  serialize() {
    return { min: this.min, max: this.max, n: this.n, bin: [...this.bin],
             tot: this.tot, somma: this.somma,
             massimo: this.massimo === -Infinity ? null : this.massimo,
             minimo: this.minimo === Infinity ? null : this.minimo };
  }
  static load(d) {
    const h = new Istogramma(d.min, d.max, d.n);
    h.bin = [...d.bin]; h.tot = d.tot; h.somma = d.somma;
    h.massimo = d.massimo ?? -Infinity; h.minimo = d.minimo ?? Infinity;
    return h;
  }
  /** Fonde un altro istogramma con gli stessi confini. */
  merge(o) {
    if (!o || o.n !== this.n || o.min !== this.min) return false;
    for (let i = 0; i < this.n; i++) this.bin[i] += o.bin[i];
    this.tot += o.tot; this.somma += o.somma;
    if (o.massimo !== null && o.massimo > this.massimo) this.massimo = o.massimo;
    if (o.minimo !== null && o.minimo < this.minimo) this.minimo = o.minimo;
    return true;
  }
}

/** Mediana di una finestra breve, senza modificare l'originale. */
function mediana(a) {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  return b[b.length >> 1];
}

/** Deviazione assoluta mediana, riportata a scala di deviazione standard. */
function mad(a) {
  if (a.length < 4) return 0;
  const m = mediana(a);
  return 1.4826 * mediana(a.map(v => Math.abs(v - m)));
}

/** Frequenza dominante dagli attraversamenti dello zero. */
function frequenza(valori, durataMs) {
  if (valori.length < 8 || durataMs <= 0) return 0;
  const m = mediana(valori);
  let cross = 0, prec = valori[0] - m;
  for (let i = 1; i < valori.length; i++) {
    const v = valori[i] - m;
    if ((prec < 0 && v >= 0) || (prec > 0 && v <= 0)) cross++;
    prec = v;
  }
  return cross / 2 / (durataMs / 1000);
}

export class SessionStats {
  constructor(opzioni = {}) {
    this.inizio = null;
    this.fine = null;
    this.finestraMs = opzioni.finestraMs || 4000;   // per ampiezza e frequenza
    this.passoAnalisiMs = opzioni.passoAnalisiMs || 1000;

    // Finestre scorrevoli, una per occhio: sono le uniche liste, e
    // hanno lunghezza limitata dal tempo, non dalla durata della sessione.
    this.win = { left: [], right: [] };
    this.tUltimaAnalisi = 0;

    // ── Istogrammi (memoria costante) ──
    this.ampiezza = { left: new Istogramma(0, 0.08, 40), right: new Istogramma(0, 0.08, 40) };
    this.frequenza = { left: new Istogramma(0, 15, 30), right: new Istogramma(0, 15, 30) };
    this.confidenza = { left: new Istogramma(0, 1, 20), right: new Istogramma(0, 1, 20) };
    this.apertura = { left: new Istogramma(0, 0.6, 30), right: new Istogramma(0, 0.6, 30) };
    this.riposoSigma = new Istogramma(0, 20, 40);     // |n| quando NON c'è gesto

    /* ══════════════════════════════════════════════════════════════
     * MISURE SUL SEGNALE GREZZO
     * ══════════════════════════════════════════════════════════════
     *
     * ⚠️ Le soglie venivano calcolate dal segnale GIÀ corretto e
     * normalizzato. È un anello: se il rumore stimato è gonfiato, il
     * segnale normalizzato risulta piccolo, la soglia consigliata
     * scende, e la diagnosi successiva parte da una configurazione
     * diversa — applicandola due volte si ottengono valori diversi.
     *
     * Queste misure guardano invece la posizione GREZZA, come esce dal
     * rilevatore, prima di ogni filtro, baseline o normalizzazione.
     * Da lì si ricava tutto: quanto vale il rumore, quanto vale il
     * gesto, e quindi dove mettere la soglia — senza che il risultato
     * dipenda da come il programma è configurato adesso.
     *
     * È la differenza fra "misurare la persona" e "misurare la
     * propria configurazione".
     */
    this.grezzoValori = { left: new Istogramma(-1, 1, 200), right: new Istogramma(-1, 1, 200) };
    this.grezzoRiposo = { left: new Istogramma(0, 0.5, 100), right: new Istogramma(0, 0.5, 100) };
    this.grezzoGesto  = { left: new Istogramma(0, 0.5, 100), right: new Istogramma(0, 0.5, 100) };
    /* Tutti gli scarti, senza distinguere gesto da riposo: serve a
     * misurare QUANTO la persona si muove senza chiederlo alle soglie,
     * che sono proprio ciò che stiamo cercando di tarare. */
    this.grezzoTutti  = { left: new Istogramma(0, 0.5, 100), right: new Istogramma(0, 0.5, 100) };
    this.campioniInGesto = 0;
    this.campioniTotali = 0;
    this.durataGesti = new Istogramma(0, 6000, 30);   // ms
    this.durataChiusure = new Istogramma(0, 3000, 30);// ms

    // Tempo (ms) trascorso in ciascuna banda di oscillazione
    this.bande = Object.fromEntries(BANDE.map(b => [b.id, 0]));

    // ── Conteggi ──
    this.c = {
      campioni: 0, validi: 0, persi: 0,
      gesti: 0, gestiPerAzione: {},
      soglieSuperate: 0, selezioniFatte: 0,
      chiusureSx: 0, chiusureDx: 0,
      msChiusoSx: 0, msChiusoDx: 0,
      msTotali: 0,
    };

    // ── Riepilogo per ORA: una riga l'ora, non una per fotogramma ──
    this.ore = [];        // { ora, campioni, ampiezza, frequenza, confidenza, gesti }
    this._oraCorrente = null;

    this._tPrec = null;
    this._chiusoDa = { left: null, right: null };
  }

  /**
   * Un campione. Chiamato a ogni fotogramma: deve costare pochissimo.
   *
   * @param t     millisecondi
   * @param obs   { left, right } osservazione GREZZA (funziona su ogni
   *              scheda, non solo in diagnostica)
   * @param n     |segnale normalizzato| del canale dominante, o null
   * @param inGesto true se un gesto è attualmente agganciato
   */
  push(t, obs, n = null, inGesto = false) {
    if (this.inizio === null) this.inizio = t;
    this.fine = t;
    const dt = this._tPrec === null ? 0 : Math.min(200, t - this._tPrec);
    this._tPrec = t;
    this.c.msTotali += dt;
    this.c.campioni++;

    let almenoUno = false;
    for (const eye of ['left', 'right']) {
      const o = obs?.[eye];
      if (!o || !Number.isFinite(o.y)) {
        this.c.persi += 0;   // conteggio per occhio non necessario qui
        continue;
      }
      almenoUno = true;
      if (Number.isFinite(o.confidence)) this.confidenza[eye].add(o.confidence);
      if (Number.isFinite(o.openness)) {
        this.apertura[eye].add(o.openness);
        // Chiusure: si misura la DURATA, non i fotogrammi.
        const chiuso = o.openness < 0.10;
        const da = this._chiusoDa[eye];
        if (chiuso && da === null) this._chiusoDa[eye] = t;
        else if (!chiuso && da !== null) {
          const durata = t - da;
          this.durataChiusure.add(durata);
          this._chiusoDa[eye] = null;
          if (eye === 'left') this.c.chiusureSx++; else this.c.chiusureDx++;
        }
        if (chiuso) {
          if (eye === 'left') this.c.msChiusoSx += dt; else this.c.msChiusoDx += dt;
        }
      }
      // Finestra scorrevole per ampiezza e frequenza
      const w = this.win[eye];
      w.push({ t, v: o.y });
      const taglio = t - this.finestraMs;
      while (w.length && w[0].t < taglio) w.shift();
    }
    if (almenoUno) this.c.validi++;

    // Il segnale a riposo è ciò che determina la soglia: si accumula
    // solo quando NON c'è un gesto in corso.
    if (!inGesto && Number.isFinite(n)) this.riposoSigma.add(Math.abs(n));

    /* Misure sul GREZZO, indipendenti dalla configurazione.
     * La mediana di tutti i valori è la posizione di riposo: la
     * persona sta ferma la maggior parte del tempo, e la mediana non
     * si lascia spostare dai gesti. */
    this.campioniTotali++;
    if (inGesto) this.campioniInGesto++;
    for (const eye of ['left', 'right']) {
      const o2 = obs?.[eye];
      if (!o2 || !Number.isFinite(o2.y)) continue;
      this.grezzoValori[eye].add(o2.y);
      const riposo = this.grezzoValori[eye].tot > 200
        ? this.grezzoValori[eye].percentile(0.5) : 0;
      const scarto = Math.abs(o2.y - riposo);
      (inGesto ? this.grezzoGesto[eye] : this.grezzoRiposo[eye]).add(scarto);
      this.grezzoTutti[eye].add(scarto);
    }

    // Analisi periodica: una volta al secondo, non a ogni fotogramma.
    if (t - this.tUltimaAnalisi >= this.passoAnalisiMs) {
      this.tUltimaAnalisi = t;
      this._analizzaFinestra(t, dt);
    }
  }

  _analizzaFinestra(t) {
    const passo = this.passoAnalisiMs;
    for (const eye of ['left', 'right']) {
      const w = this.win[eye];
      if (w.length < 20) continue;
      const vals = w.map(x => x.v);
      const durata = w[w.length - 1].t - w[0].t;
      const amp = mad(vals);
      const f = frequenza(vals, durata);
      this.ampiezza[eye].add(amp);
      this.frequenza[eye].add(f);
      // Il tempo si attribuisce alla banda dell'occhio dominante per
      // ampiezza: sommarlo per entrambi lo conterebbe due volte.
      if (eye === 'left') {
        const b = BANDE.find(x => f >= x.min && f < x.max);
        if (b) this.bande[b.id] += passo;
      }
    }
    this._aggiornaOra(t);
  }

  _aggiornaOra(t) {
    const ora = Math.floor((t - this.inizio) / 3600000);
    if (this._oraCorrente?.ora !== ora) {
      this._oraCorrente = {
        ora, campioni: 0, ampiezza: 0, frequenza: 0, confidenza: 0, gesti: 0,
      };
      this.ore.push(this._oraCorrente);
      // Tetto di sicurezza: una settimana continua resta gestibile.
      if (this.ore.length > 200) this.ore.shift();
    }
    const O = this._oraCorrente;
    const w = this.win.left.length ? this.win.left : this.win.right;
    if (w.length >= 20) {
      const vals = w.map(x => x.v);
      const amp = mad(vals);
      const f = frequenza(vals, w[w.length - 1].t - w[0].t);
      O.campioni++;
      O.ampiezza += (amp - O.ampiezza) / O.campioni;
      O.frequenza += (f - O.frequenza) / O.campioni;
    }
  }

  /** Un gesto riconosciuto. */
  gesto(e) {
    this.c.gesti++;
    if (Number.isFinite(e?.durMs)) this.durataGesti.add(e.durMs);
    const a = e?.action || 'ALTRO';
    this.c.gestiPerAzione[a] = (this.c.gestiPerAzione[a] || 0) + 1;
    if (this._oraCorrente) this._oraCorrente.gesti++;
  }

  /** Una soglia superata (con o senza gesto riconosciuto a seguire). */
  sogliaSuperata() { this.c.soglieSuperate++; }

  /** Una selezione effettivamente compiuta dalla persona. */
  selezione() { this.c.selezioniFatte++; }

  get durataMs() { return this.inizio === null ? 0 : this.fine - this.inizio; }

  /* ------------------------------ Riepilogo ------------------------------ */

  riepilogo() {
    const ore = this.durataMs / 3600000;
    const fps = this.c.msTotali > 0 ? this.c.campioni / (this.c.msTotali / 1000) : 0;
    const minuti = this.c.msTotali / 60000;

    const perOcchio = {};
    for (const eye of ['left', 'right']) {
      perOcchio[eye] = {
        ampiezzaMediana: this.ampiezza[eye].percentile(0.5),
        ampiezza90: this.ampiezza[eye].percentile(0.9),
        frequenzaMediana: this.frequenza[eye].percentile(0.5),
        confidenzaMediana: this.confidenza[eye].percentile(0.5),
        confidenza10: this.confidenza[eye].percentile(0.1),
        aperturaRiposo: this.apertura[eye].percentile(0.85),
        /* ⚠️ ESCURSIONE dell'apertura, non solo il riposo.
         *
         * Alzando lo sguardo l'occhio si spalanca: la differenza fra
         * quanto si apre al massimo e quanto sta a riposo dice se
         * quell'occhio può comandare con l'apertura. Per chi ha un
         * occhio abitualmente socchiuso questa escursione è spesso più
         * ampia dello spostamento dell'iride. */
        aperturaMin: this.apertura[eye].percentile(0.05),
        aperturaMax: this.apertura[eye].percentile(0.97),
        /* ⚠️ Il riferimento è la MEDIANA, non l'85° percentile.
         *
         * L'85° percentile descrive l'occhio ben aperto, ed è giusto
         * per decidere se è chiuso. Ma chi spalanca l'occhio per
         * comandare ci sta anche un terzo del tempo: quel percentile
         * finisce DENTRO il gesto, e l'escursione risulta zero.
         * La mediana invece cade nel riposo, dove la persona sta la
         * maggior parte del tempo. */
        escursioneApertura: Math.max(0,
          this.apertura[eye].percentile(0.97) - this.apertura[eye].percentile(0.50)),
        // Il minimo OSSERVATO, non un percentile: gli ammiccamenti sono
        // pochi per definizione — poche decine di millisecondi ogni
        // pochi secondi — e un percentile al 3% li manca del tutto.
        aperturaMinima: this.apertura[eye].minimo === Infinity
          ? this.apertura[eye].percentile(0.03)
          : this.apertura[eye].minimo,
      };
    }

    const tempoBande = Object.values(this.bande).reduce((a, b) => a + b, 0) || 1;
    const bande = BANDE.map(b => ({
      id: b.id, nome: b.nome,
      ms: this.bande[b.id],
      percentuale: 100 * this.bande[b.id] / tempoBande,
    }));

    // Falsi positivi stimati: soglie superate senza che sia seguita una
    // selezione. È la misura che serve davvero per tarare, e nessuna
    // osservazione breve può darla.
    const falsiPositivi = Math.max(0, this.c.soglieSuperate - this.c.selezioniFatte);
    const tassoFalsi = minuti > 0 ? falsiPositivi / minuti : 0;

    return {
      durataMs: this.durataMs,
      ore: Math.round(ore * 100) / 100,
      fps: Math.round(fps * 10) / 10,
      campioni: this.c.campioni,
      validiPercento: this.c.campioni ? 100 * this.c.validi / this.c.campioni : 0,
      perOcchio,
      bande,
      gesti: this.c.gesti,
      gestiPerAzione: { ...this.c.gestiPerAzione },
      gestiAlMinuto: minuti > 0 ? this.c.gesti / minuti : 0,
      durataGestiMediana: this.durataGesti.percentile(0.5),
      durataGesti10: this.durataGesti.percentile(0.1),
      durataGesti90: this.durataGesti.percentile(0.9),
      chiusure: { sx: this.c.chiusureSx, dx: this.c.chiusureDx },
      chiusureAlMinuto: minuti > 0 ? (this.c.chiusureSx + this.c.chiusureDx) / 2 / minuti : 0,
      durataChiusuraMediana: this.durataChiusure.percentile(0.5),
      msChiuso: { sx: this.c.msChiusoSx, dx: this.c.msChiusoDx },
      riposoMediana: this.riposoSigma.percentile(0.5),
      riposo99: this.riposoSigma.percentile(0.99),
      riposoMassimo: this.riposoSigma.massimo === -Infinity ? 0 : this.riposoSigma.massimo,
      falsiPositivi, tassoFalsiAlMinuto: tassoFalsi,
      ore_dettaglio: this.ore.map(o => ({ ...o })),
    };
  }

  /* ------------------------- Parametri consigliati ------------------------- */

  /**
   * Parametri di rilevamento ricavati dall'osservazione lunga.
   *
   * Stessa logica della taratura automatica, ma su ore invece che su
   * venticinque secondi — e con l'indicazione di QUANTO sono
   * affidabili, perché una soglia misurata su sei ore è un'altra cosa
   * rispetto a una misurata su mezzo minuto.
   */
  parametriConsigliati(correnti = {}) {
    const r = this.riepilogo();
    const motivi = [];
    const p = {};

    // Affidabilità: sotto certi tempi non si propone nulla.
    const minuti = this.c.msTotali / 60000;
    const affidabilita = minuti < 2 ? 'insufficiente'
      : minuti < 15 ? 'indicativa'
      : minuti < 60 ? 'buona' : 'solida';
    if (minuti < 2) {
      return { ok: false, affidabilita, minuti,
        motivo: 'Osservazione troppo breve: servono almeno due minuti di monitoraggio.' };
    }

    // Occhio di riferimento: quello con confidenza migliore.
    const rif = r.perOcchio.left.confidenzaMediana >= r.perOcchio.right.confidenzaMediana ? 'left' : 'right';
    const E = r.perOcchio[rif];
    motivi.push(`occhio di riferimento: ${rif === 'left' ? 'sinistro' : 'destro'} (confidenza mediana ${E.confidenzaMediana.toFixed(2)})`);

    // Filtri dalla frequenza dominante osservata su tutta la sessione.
    const f = E.frequenzaMediana;
    const debole = E.ampiezzaMediana < 0.006;
    if (debole) {
      p['signal.medianWindowMs'] = 200;
      p['signal.lowPassHz'] = 3.0;
      motivi.push('oscillazione debole: filtri leggeri, per non aggiungere ritardo inutile');
    } else if (f > 0.3) {
      /* ══════════════════════════════════════════════════════════════
       * ⚠️ I FILTRI NON DEVONO MANGIARSI IL GESTO
       * ══════════════════════════════════════════════════════════════
       *
       * Le formule precedenti guardavano solo l'oscillazione da
       * togliere. Con un tremore a 0,8 Hz proponevano passa-basso a
       * 0,8 Hz e mediana da 600 ms — e un gesto che dura poco più di
       * un secondo ha la sua energia proprio lì attorno.
       *
       * Misurato: con quei valori l'ampiezza partiva da 34σ e crollava
       * a 16σ nel giro di venticinque ripetizioni. Peggio, i parametri
       * applicati restano salvati: una taratura sbagliata rovinava
       * anche tutte le sessioni successive, e sembrava un difetto del
       * programma.
       *
       * Il gesto va quindi PROTETTO con due limiti invalicabili:
       *
       *  · la mediana deve essere MOLTO più corta del gesto, altrimenti
       *    ne appiattisce la salita. Metà del tempo di permanenza
       *    richiesto è già generoso;
       *  · il passa-basso deve restare BEN SOPRA la banda del gesto.
       *    Un gesto di un secondo ha energia fino a circa 1,5 Hz:
       *    sotto i 2,5 Hz si comincia a tagliare il segnale utile
       *    invece del rumore.
       *
       * Filtrare meno e alzare la soglia è sempre preferibile a
       * filtrare tanto: la soglia scarta il rumore, il filtro scarta
       * anche il gesto. */
      const dwell = this.cfgDwellMs || 400;
      const medianaMax = clamp(Math.round(dwell / 2 / 50) * 50, 120, 350);
      p['signal.medianWindowMs'] = clamp(Math.round(1500 / f / 50) * 50, 120, medianaMax);
      p['signal.lowPassHz'] = clamp(Math.round((f / 3) * 10) / 10, 2.5, 6.0);
      if (f / 3 < 2.5) {
        motivi.push(
          `⚠️ l'oscillazione è a ${f.toFixed(1)} Hz, vicina alla banda del gesto: `
          + 'il filtro resta a 2,5 Hz per non tagliare anche il movimento — '
          + 'meglio alzare la soglia che filtrare più a fondo');
      }
      motivi.push(`oscillazione mediana ${f.toFixed(1)} Hz, ampiezza ${E.ampiezzaMediana.toFixed(4)}`);
    }

    // Soglia dal segnale a riposo osservato per ore. Il 99° percentile
    // è più solido del massimo: un singolo urto non deve dettare legge.
    if (this.riposoSigma.tot > 500) {
      /* ══════════════════════════════════════════════════════════════
       * SOGLIE CALCOLATE DAL SEGNALE GREZZO
       * ══════════════════════════════════════════════════════════════
       *
       * ⚠️ Prima si partiva da |n|, cioè dal segnale già normalizzato
       * sulla stima corrente del rumore. Un anello: rumore stimato
       * male → segnale normalizzato piccolo → soglia bassa → alla
       * diagnosi successiva i numeri sono di nuovo diversi. Applicando
       * due volte si ottenevano due risultati.
       *
       * Ora si parte dalla posizione GREZZA. Si misurano due cose che
       * non dipendono da come il programma è configurato:
       *   · quanto si scosta il segnale quando la persona è ferma;
       *   · quanto si scosta quando compie il gesto.
       *
       * Dal primo si ricostruisce quale rumore stimerebbe il
       * programma, con lo stesso metodo che usa davvero. Il rapporto
       * fra i due dice a quanti "sigma" corrisponde il gesto, e la
       * soglia si mette a metà strada — abbastanza sopra il rumore da
       * non scattare a vuoto, abbastanza sotto il gesto da non
       * perderlo.
       *
       * Il risultato non cambia riapplicandolo: è la stessa persona
       * misurata due volte, non la configurazione che si insegue.
       */
      const eyeRif = E === r.perOcchio?.left ? 'left' : 'right';
      const hRip = this.grezzoRiposo[eyeRif], hGes = this.grezzoGesto[eyeRif];
      /* ⚠️ Basta avere abbastanza CAMPIONI, non abbastanza gesti
       * riconosciuti.
       *
       * Prima servivano cento campioni dentro gesti riconosciuti: se
       * la soglia era troppo alta non se ne riconosceva nessuno, la
       * condizione non era mai soddisfatta e la diagnostica smetteva
       * di proporre proprio quando serviva di più — cioè quando la
       * taratura era sbagliata. */
      const hTutti = this.grezzoTutti[eyeRif];
      const abbastanza = hTutti.tot > 400;
      // Stessa formula che il programma usa per stimare il rumore.
      // Serve sia alle soglie sia alla misura del movimento.
      const sigmaGrezzo = hRip.tot > 100
        ? Math.max(1e-6, 1.4826 * hRip.percentile(0.25) * 1.577) : 0;

      if (abbastanza) {
        /* L'ampiezza del gesto si legge dalla CODA della distribuzione
         * di tutti gli scarti: i momenti in cui la persona si è
         * scostata di più sono i suoi gesti, che li si sia riconosciuti
         * o no. Nessuna dipendenza da soglie. */
        const gestoN = Math.max(
          hTutti.percentile(0.97),
          hGes.tot > 100 ? hGes.percentile(0.75) : 0,
        ) / sigmaGrezzo;
        /* ⚠️ Il riferimento non è il rumore MEDIO ma il suo PICCO.
         *
         * Una soglia messa a metà fra rumore medio e gesto scatterebbe
         * su ogni sussulto: il rumore ha punte molto più alte della
         * propria media, ed è quelle che fanno scrivere lettere che
         * nessuno voleva. Si guarda quindi quanto il segnale arriva a
         * scostarsi nel 99% del tempo di quiete. */
        const picco99 = hRip.percentile(0.99) / sigmaGrezzo;
        // Punto di mezzo geometrico: resta lontano da entrambi anche
        // quando la distanza fra i due è grande.
        let soglia = Math.sqrt(Math.max(1.2, picco99) * Math.max(2, gestoN));
        // E comunque mai troppo vicina al picco del rumore.
        soglia = Math.max(soglia, picco99 * 1.25);
        p['signal.thresholdOn'] = clamp(Math.round(soglia * 2) / 2, 2.5, 12);
        p['signal.thresholdOff'] = Math.round(p['signal.thresholdOn'] * 0.45 * 10) / 10;
        motivi.push(
          `misurato sul segnale grezzo: il gesto vale ${gestoN.toFixed(1)} volte il rumore, `
          + `che a riposo arriva a ${picco99.toFixed(1)} — soglia posta in mezzo`);
      } else {
        const base = Math.max(r.riposo99, r.riposoMediana * 3);
        p['signal.thresholdOn'] = clamp(Math.ceil(base * 1.25 * 2) / 2, 3.0, 12);
        p['signal.thresholdOff'] = Math.round(p['signal.thresholdOn'] * 0.45 * 10) / 10;
        motivi.push(`pochi gesti osservati: soglia stimata dal comportamento a riposo (sotto ${r.riposo99.toFixed(1)}σ nel 99% del tempo)`);
      }

      /* ── Percentile della stima del rumore ──
       * Dipende da quanto tempo la persona passa in movimento: se i
       * gesti occupano più della frazione osservata, la stima si
       * gonfia e non torna più indietro. */
      /* ⚠️ Frazione di tempo in movimento, misurata sul GREZZO.
       *
       * Prima si contavano i gesti RICONOSCIUTI, che dipendono dalla
       * soglia corrente: alzando la soglia il conteggio crollava e il
       * parametro spariva dalla proposta. Un altro anello — e quello
       * che faceva sparire due parametri dopo il terzo minuto.
       *
       * Ora si conta quanti campioni si scostano dal riposo più di tre
       * volte il rumore, misurato anch'esso sul grezzo. Non dipende da
       * nessuna soglia. */
      const hTut = this.grezzoTutti[eyeRif];
      let inMov = 0;
      if (hTut.tot > 200 && Number.isFinite(sigmaGrezzo) && sigmaGrezzo > 0) {
        const limite = sigmaGrezzo * 3;
        let sopra = 0;
        for (let i = 0; i < hTut.n; i++) {
          const centro = hTut.min + (i + 0.5) * (hTut.max - hTut.min) / hTut.n;
          if (centro > limite) sopra += hTut.bin[i];
        }
        inMov = sopra / hTut.tot;
      }
      if (inMov > 0.05) {
        const quiete = 1 - inMov;
        // Si resta ben dentro la parte quieta, con margine.
        const percCons = clamp(Math.round(quiete * 0.6 * 100) / 100, 0.10, 0.40);
        p['signal.sigmaPercentile'] = percCons;
        // La ritaratura è legata al percentile: sono una coppia.
        p['signal.sigmaRitaratura'] = Math.round((0.40 / percCons) * 0.985 * 100) / 100;
        motivi.push(
          `la persona è in movimento il ${(inMov * 100).toFixed(0)}% del tempo: `
          + `la stima del rumore guarda il ${(percCons * 100).toFixed(0)}% più quieto del segnale`);
      }
      if (r.tassoFalsiAlMinuto > 0.5) {
        motivi.push(`⚠️ ${r.tassoFalsiAlMinuto.toFixed(1)} superamenti a vuoto al minuto: soglia probabilmente bassa`);
      }
    }

    // Durate dei gesti dalla distribuzione reale della persona.
    if (this.durataGesti.tot >= 20) {
      const d10 = r.durataGesti10;
      p['gestures.UP.dwellMs'] = clamp(Math.round(d10 * 0.7 / 50) * 50, 200, 2000);
      motivi.push(`durata dei gesti: mediana ${Math.round(r.durataGestiMediana)} ms, il 10% più corto sotto ${Math.round(d10)} ms`);
    }

    // Ammiccamento dalle aperture osservate, solo se ne sono avvenuti.
    const escursione = 1 - (E.aperturaMinima / Math.max(1e-6, E.aperturaRiposo));
    if (escursione > 0.25 && (this.c.chiusureSx + this.c.chiusureDx) > 10) {
      p['signal.blinkRatio'] = clamp((E.aperturaMinima / E.aperturaRiposo) * 1.25, 0.30, 0.65);
      p['signal.blinkRatio'] = Math.round(p['signal.blinkRatio'] * 100) / 100;
      motivi.push(`apertura: riposo ${E.aperturaRiposo.toFixed(3)}, minima ${E.aperturaMinima.toFixed(3)}`);
      if (this.durataChiusure.tot >= 10) {
        const d90 = this.durataChiusure.percentile(0.9);
        p['gestures.blinkMaxPulseMs'] = clamp(Math.round(d90 * 1.3 / 50) * 50, 200, 2000);
        motivi.push(`chiusure: il 90% dura meno di ${Math.round(d90)} ms`);
      }
    } else {
      motivi.push('pochi ammiccamenti osservati: soglie di chiusura lasciate come sono');
    }

    /* ══════════════════════════════════════════════════════════════
     * SQUILIBRIO FRA I DUE OCCHI
     * ══════════════════════════════════════════════════════════════
     *
     * ⚠️ È la diagnosi che mancava, e che avrebbe risparmiato giorni.
     *
     * Quando un occhio viene dichiarato chiuso molto più dell'altro, e
     * la sua confidenza resta comunque alta, quasi sempre non sta
     * ammiccando: sta stringendo la palpebra perché lo sguardo va in
     * alto, o perché quell'occhio è abitualmente socchiuso. Ogni falsa
     * chiusura maschera il gesto proprio mentre avviene, e il suo
     * transitorio gonfia la stima del rumore: da lì l'ampiezza di
     * quell'occhio cala e non risale più.
     *
     * Si propone quindi di allargare la distinzione, che è il rimedio
     * diretto, e lo si SPIEGA — perché un parametro proposto senza
     * ragione non viene applicato da nessuno.
     */
    {
      const cs = this.c.chiusureSx || 0, cd = this.c.chiusureDx || 0;
      const tot = cs + cd;
      const sbil = tot > 6 ? Math.abs(cs - cd) / tot : 0;
      const confBassa = Math.min(E.confidenza10 ?? 1, 1);
      if (sbil > 0.6) {
        const molti = cs > cd ? 'sinistro' : 'destro';
        p['signal.blinkRichiedeIride'] = true;
        p['signal.blinkSmentiSopra'] = 0.20;
        motivi.push(
          `l'occhio ${molti} risulta chiuso molto più dell'altro (${Math.max(cs, cd)} contro ${Math.min(cs, cd)}): `
          + 'quasi certamente stringe la palpebra invece di ammiccare, si allarga la distinzione');
        if (confBassa > 0.7) {
          p['signal.blinkSogliaIride'] = Math.max(0.35, Math.round((confBassa - 0.25) * 20) / 20);
          motivi.push(`confidenza alta anche nelle presunte chiusure (${confBassa.toFixed(2)}): soglia dell'iride adeguata`);
        }
      }
    }

    /* Ampiezze molto diverse fra i due occhi a parità di movimento:
     * segnala la copertura della palpebra, che fa misurare al ribasso
     * proprio l'occhio più socchiuso. */
    {
      const aS = r.perOcchio?.left?.ampiezzaMediana || 0;
      const aD = r.perOcchio?.right?.ampiezzaMediana || 0;
      if (aS > 0 && aD > 0) {
        const rapporto = Math.min(aS, aD) / Math.max(aS, aD);
        if (rapporto < 0.7) {
          const debole = aS < aD ? 'sinistro' : 'destro';
          motivi.push(
            `ampiezza dell'occhio ${debole} al ${(rapporto * 100).toFixed(0)}% dell'altro: `
            + 'guarda in diagnostica "Palpebra copre iride" — se su quell\'occhio è alta, '
            + 'accendi la compensazione della palpebra');
        }
      }
    }

    /* ── L'apertura come canale di comando ──
     * Se l'escursione è ampia rispetto al riposo, quel canale è
     * utilizzabile — e per chi ha un occhio socchiuso spesso è il
     * migliore. Si segnala, senza accenderlo d'ufficio: assegnare un
     * comando è una decisione di chi assiste. */
    for (const eye of ['left', 'right']) {
      const E2 = r.perOcchio?.[eye];
      if (!E2 || !E2.aperturaRiposo) continue;
      const rel = E2.escursioneApertura / Math.max(1e-6, E2.aperturaRiposo);
      if (rel > 0.15) {
        motivi.push(
          `apertura dell'occhio ${eye === 'left' ? 'sinistro' : 'destro'}: si spalanca del `
          + `${(rel * 100).toFixed(0)}% oltre il riposo — canale "Occhio spalancato" utilizzabile`);
      }
    }

    // Confidenza minima: si può solo abbassare, mai alzare.
    if (this.confidenza[rif].tot > 500) {
      p['detection.minConfidence'] = clamp(Math.round(E.confidenza10 * 0.7 * 100) / 100, 0.15, 0.40);
      motivi.push(`confidenza: 10° percentile ${E.confidenza10.toFixed(2)}`);
    }

    // Avvisi clinici
    const avvisi = [];
    const nist = r.bande.find(b => b.id === 'nistagmo');
    const trem = r.bande.find(b => b.id === 'tremore');
    const rapid = r.bande.find(b => b.id === 'rapido');
    if (nist && nist.percentuale > 40) avvisi.push(`nistagmo prevalente: ${nist.percentuale.toFixed(0)}% del tempo nella banda 2-8 Hz`);
    if (trem && trem.percentuale > 40) avvisi.push(`tremore prevalente: ${trem.percentuale.toFixed(0)}% del tempo nella banda 0,5-2 Hz`);
    if (rapid && rapid.percentuale > 25) avvisi.push(`oscillazione oltre 8 Hz per il ${rapid.percentuale.toFixed(0)}% del tempo: verifica che la telecamera non vibri`);
    if (r.validiPercento < 85) avvisi.push(`tracciamento interrotto nel ${(100 - r.validiPercento).toFixed(0)}% dei fotogrammi`);
    if (E.confidenzaMediana < 0.55) avvisi.push('confidenza bassa: probabile luce insufficiente o riflessi');
    if (r.fps < 15) avvisi.push(`solo ${r.fps.toFixed(0)} fotogrammi al secondo`);
    // Andamento nel tempo: è ciò che l'osservazione breve non può vedere.
    if (this.ore.length >= 2) {
      const primo = this.ore[0], ultimo = this.ore[this.ore.length - 1];
      if (primo.ampiezza > 0 && ultimo.ampiezza > primo.ampiezza * 1.4) {
        avvisi.push(`l'oscillazione è cresciuta del ${Math.round(100 * (ultimo.ampiezza / primo.ampiezza - 1))}% dall'inizio della sessione: possibile affaticamento`);
      }
    }

    /* ══════════════════════════════════════════════════════════════
     * LA PROPOSTA SI ACCUMULA, NON SI SOSTITUISCE
     * ══════════════════════════════════════════════════════════════
     *
     * ⚠️ Ogni analisi restituiva solo i parametri che quel momento
     * poteva stimare. Osservando più a lungo, alcuni sparivano — e chi
     * assiste non poteva più applicare ciò che il programma aveva
     * proposto poco prima. Un consiglio che scompare mentre lo si
     * legge non è un consiglio.
     *
     * Ora si conserva tutto ciò che è stato misurato durante la
     * sessione: i valori nuovi sostituiscono i vecchi dello stesso
     * parametro — sono più informati — ma nulla viene mai tolto.
     */
    this._propostaCum = { ...(this._propostaCum || {}), ...p };
    const completa = { ...this._propostaCum };

    return {
      ok: true, affidabilita, minuti: Math.round(minuti),
      proposta: completa, motivi, avvisi, riepilogo: r,
    };
  }

  /* -------------------------------- Scambio -------------------------------- */

  serialize() {
    const ist = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.serialize()]));
    return {
      aurora_diag: true, versione: 1,
      inizio: this.inizio, fine: this.fine,
      ampiezza: ist(this.ampiezza), frequenza: ist(this.frequenza),
      confidenza: ist(this.confidenza), apertura: ist(this.apertura),
      riposoSigma: this.riposoSigma.serialize(),
      durataGesti: this.durataGesti.serialize(),
      durataChiusure: this.durataChiusure.serialize(),
      bande: { ...this.bande },
      c: { ...this.c, gestiPerAzione: { ...this.c.gestiPerAzione } },
      ore: this.ore.map(o => ({ ...o })),
    };
  }

  /** Fonde una sessione precedente: è così che nasce il cumulativo. */
  merge(d) {
    if (!d || d.aurora_diag !== true) return false;
    const fondi = (mio, suo) => {
      for (const k of Object.keys(mio)) if (suo?.[k]) mio[k].merge(suo[k]);
    };
    fondi(this.ampiezza, d.ampiezza);
    fondi(this.frequenza, d.frequenza);
    fondi(this.confidenza, d.confidenza);
    fondi(this.apertura, d.apertura);
    this.riposoSigma.merge(d.riposoSigma);
    this.durataGesti.merge(d.durataGesti);
    this.durataChiusure.merge(d.durataChiusure);
    for (const b of Object.keys(this.bande)) this.bande[b] += d.bande?.[b] || 0;
    for (const k of Object.keys(this.c)) {
      if (k === 'gestiPerAzione') continue;
      if (typeof this.c[k] === 'number') this.c[k] += d.c?.[k] || 0;
    }
    for (const [a, n] of Object.entries(d.c?.gestiPerAzione || {})) {
      this.c.gestiPerAzione[a] = (this.c.gestiPerAzione[a] || 0) + n;
    }
    // Le ore si accodano, rinumerate: sessioni diverse, tempo diverso.
    const off = this.ore.length;
    for (const o of d.ore || []) this.ore.push({ ...o, ora: off + o.ora });
    if (this.ore.length > 200) this.ore = this.ore.slice(-200);
    return true;
  }

  static load(d) {
    const s = new SessionStats();
    s.merge(d);
    s.inizio = 0;
    s.fine = d.c?.msTotali || 0;
    return s;
  }
}
