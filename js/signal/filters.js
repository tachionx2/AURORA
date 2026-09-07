/**
 * filters.js — Blocchi elementari di elaborazione del segnale.
 *
 * Il problema, in una frase: il nistagmo produce un'oscillazione a 2–6 Hz
 * sulla posizione dell'occhio; il movimento volontario produce un GRADINO
 * sostenuto per ≥400 ms. Dobbiamo rilevare il gradino ignorando
 * l'oscillazione — cioè misurare lo spostamento della MEDIA
 * dell'oscillazione, non la posizione istantanea.
 *
 * Tutti i filtri lavorano su campioni con timestamp reale, non su un
 * indice di frame: il frame rate di una webcam non è mai costante, e
 * un filtro tarato "in frame" cambia comportamento quando il telefono
 * scalda e rallenta.
 */

/* ------------------------------------------------------------------ *
 * Mediana mobile su finestra temporale.
 * Perché mediana e non media: le fasi rapide del nistagmo sono impulsi
 * asimmetrici. La media li segue, la mediana li ignora.
 * ------------------------------------------------------------------ */
export class MedianWindow {
  constructor(windowMs = 250) { this.windowMs = windowMs; this.buf = []; }
  reset() { this.buf.length = 0; }
  push(t, v) {
    this.buf.push({ t, v });
    const cutoff = t - this.windowMs;
    while (this.buf.length && this.buf[0].t < cutoff) this.buf.shift();
    if (this.buf.length === 0) return v;
    const vals = this.buf.map(s => s.v).sort((a, b) => a - b);
    const m = vals.length >> 1;
    return vals.length % 2 ? vals[m] : 0.5 * (vals[m - 1] + vals[m]);
  }
  get size() { return this.buf.length; }
}

/* ------------------------------------------------------------------ *
 * Passa-basso a un polo, con dt reale.
 * alpha = dt / (dt + RC),  RC = 1 / (2*pi*fc)
 * Sufficiente qui: il segnale è già stato ripulito dalla mediana e non
 * serve una pendenza ripida, serve non introdurre ritardo di gruppo.
 * ------------------------------------------------------------------ */
export class LowPass {
  constructor(cutoffHz = 1.5) { this.fc = cutoffHz; this.y = null; this.tPrev = null; }
  reset() { this.y = null; this.tPrev = null; }
  push(t, v) {
    if (this.y === null) { this.y = v; this.tPrev = t; return v; }
    /* ⚠️ SALTO TEMPORALE.
     *
     * Cambiando scheda del browser i fotogrammi si fermano, ma
     * l'orologio continua. Al ritorno arriva un campione con mezzo
     * minuto di distanza dal precedente: senza limite, il filtro
     * calcola un coefficiente vicino a 1 e SALTA di colpo sul valore
     * corrente, come se avesse davvero seguito il segnale per tutto
     * quel tempo. Non l'ha seguito: non ha visto nulla.
     *
     * Un intervallo molto più lungo di un fotogramma non è un
     * fotogramma lento: è un buco. Si tratta come tale. */
    const dtVero = (t - this.tPrev) / 1000;
    this.tPrev = t;
    if (dtVero > 0.5) return this.y;          // buco: si tiene il valore
    const dt = Math.max(1e-4, dtVero);
    const rc = 1 / (2 * Math.PI * Math.max(0.01, this.fc));
    const a = dt / (dt + rc);
    this.y += a * (v - this.y);
    return this.y;
  }
}

/* ------------------------------------------------------------------ *
 * Stima robusta del rumore a riposo (deviazione assoluta mediana).
 *
 * Perché non una media esponenziale del quadrato dello scarto: quella
 * include anche i gesti, quindi ogni movimento ampio gonfia la stima
 * del rumore e il sistema diventa insensibile proprio dopo essere
 * stato usato. E limitare lo scarto a poche sigma crea l'effetto
 * opposto — una spirale al ribasso, perché una sigma piccola limita
 * ancora di più, e così via.
 *
 * La mediana degli scarti assoluti non ha questa retroazione: i gesti
 * sono una minoranza dei campioni, quindi la mediana continua a
 * descrivere il riposo qualunque cosa accada. Il fattore 1,4826 la
 * rende confrontabile con una deviazione standard.
 * ------------------------------------------------------------------ */
export class RobustScale {
  constructor(windowMs = 20000, recomputeMs = 250, minSigma = 0.004) {
    this.windowMs = windowMs;
    this.recomputeMs = recomputeMs;
    this.minSigma = minSigma;
    this.buf = [];
    this.value = minSigma;
    this.tLast = -1e9;
  }
  reset() { this.buf.length = 0; this.value = this.minSigma; this.tLast = -1e9; }
  /**
   * @param quiet false mentre è in corso un gesto: quel campione NON
   * descrive il rumore a riposo e non deve entrare nella stima.
   *
   * Senza questo, usando il programma la stima cresce gesto dopo gesto:
   * sigma sale, l'ampiezza normalizzata cala, e dopo una decina di
   * gesti ravvicinati il movimento non supera più la soglia. Bastava
   * una pausa perché tutto tornasse normale — il sintomo che aveva
   * fatto sospettare un guasto casuale.
   */
  push(t, scarto, quiet = true) {
    if (quiet) this.buf.push({ t, v: Math.abs(scarto) });
    const taglio = t - this.windowMs;
    while (this.buf.length && this.buf[0].t < taglio) this.buf.shift();
    if (t - this.tLast < this.recomputeMs) return this.value;
    this.tLast = t;
    if (this.buf.length < 10) return this.value;
    const a = this.buf.map(x => x.v).sort((p, q) => p - q);
    // 40° percentile invece della mediana: doppia protezione, nel caso
    // qualche campione di gesto sfugga comunque al filtro sopra.
    const q40 = a[Math.floor(a.length * 0.4)];
    this.value = Math.max(this.minSigma, 1.4826 * q40 / 0.6745 * 0.6745);
    return this.value;
  }
}

/* ------------------------------------------------------------------ *
 * Baseline adattiva + deviazione standard corrente.
 *
 * ⚠️ IL PUNTO PIÙ DELICATO DELL'INTERA PIPELINE.
 *
 * La baseline deve inseguire le derive lente (postura, scivolamento del
 * supporto, cambio di illuminazione) ma NON deve inseguire il gesto.
 * Se si aggiorna durante il gesto, la baseline lo raggiunge e lo
 * cancella: il sistema "dimentica" che l'occhio è alzato dopo un paio
 * di secondi e i gesti lunghi diventano impossibili.
 *
 * Per questo `freeze()` viene chiamato dal GestureEngine appena il
 * segnale supera la soglia, e rilasciato al termine del gesto.
 * È il bug numero uno di questo tipo di filtri.
 * ------------------------------------------------------------------ */
export class AdaptiveBaseline {
  constructor(tauSec = 30, minSigma = 0.004) {
    this.tau = tauSec;
    this.minSigma = minSigma;
    this.mean = null;
    this.scala = new RobustScale(20000, 250, minSigma);
    this.frozen = false;
    this.tPrev = null;
    /* Oltre questo intervallo fra due campioni si parla di buco, non
     * di fotogramma lento: mezzo secondo è quindici volte il passo
     * normale a trenta fotogrammi al secondo. */
    this.maxDt = 0.5;
  }
  reset() { this.mean = null; this.scala.reset(); this.frozen = false; this.tPrev = null; }
  freeze() { this.frozen = true; }

  /**
   * Riancora la baseline alla posizione corrente.
   *
   * Serve dopo un aggancio sciolto d'ufficio: se l'occhio si è
   * stabilizzato in una posizione diversa da quella di partenza, la
   * costante di tempo lunga (trenta secondi, giusta per le derive
   * lente) impiegherebbe un minuto ad adattarsi — e per tutto quel
   * tempo il segnale resterebbe sopra la soglia, bloccando ogni gesto.
   *
   * Oltre il tempo massimo di aggancio non si può più distinguere "il
   * segnale è rimasto incastrato" da "questa è la nuova posizione di
   * riposo": si assume la seconda, che è l'unica da cui si può
   * ripartire.
   */
  riancora(v, frazione = 0.5) {
    /* ⚠️ Riancoraggio PARZIALE, e la scala NON si azzera.
     *
     * La prima versione spostava la baseline esattamente sulla
     * posizione corrente e azzerava la stima del rumore. Effetto: se
     * la persona TENEVA l'occhio alzato oltre il tempo massimo, quella
     * posizione diventava il nuovo zero e il gesto spariva — da 16σ a
     * meno di 1σ. E la stima del rumore, ricostruita da zero sui
     * campioni successivi, includeva l'intera escursione del ritorno:
     * il sigma cresceva di sei volte, dividendo per sei l'ampiezza di
     * ogni gesto futuro.
     *
     * Insieme, le due cose rendevano il programma cieco proprio a chi
     * usa gesti lunghi e decisi — cioè a chi lo usa bene.
     *
     * Ora si sposta solo a metà strada, e la stima del rumore resta
     * quella buona costruita a riposo. Il recupero è più lento ma non
     * distrugge la taratura, e se la persona torna davvero al riposo
     * la baseline ci arriva da sola.
     */
    if (Number.isFinite(v)) {
      const f = Math.max(0, Math.min(1, frazione));
      this.mean = this.mean + (v - this.mean) * f;
    }
    this.frozen = false;
  }
  release() { this.frozen = false; }

  push(t, v) {
    if (this.mean === null) {
      this.mean = v; this.tPrev = t; this.scala.reset();
      return { baseline: v, sigma: this.minSigma };
    }
    /* ⚠️ SALTO TEMPORALE — il difetto più insidioso di tutti.
     *
     * Cambiando scheda del browser i fotogrammi si fermano, ma
     * l'orologio continua. Al ritorno arriva un campione con anche
     * mezzo minuto di distanza dal precedente. Con una costante di
     * tempo di trenta secondi, il coefficiente diventa 0,63: la
     * baseline salta in UN SOLO FOTOGRAMMA al 63% della strada verso
     * la posizione corrente.
     *
     * Se in quell'istante l'occhio era alzato, quella posizione
     * diventa quasi il nuovo zero — e da lì in poi ogni movimento
     * risulta molto più piccolo. È esattamente il crollo di ampiezza
     * che si vede tornando su Aurora dopo essere stati altrove.
     *
     * Non ha nemmeno senso logico: la baseline avrebbe dovuto seguire
     * il segnale per trenta secondi, ma in quei trenta secondi non ha
     * visto NULLA. Un buco non è un fotogramma lento.
     */
    const dtVero = (t - this.tPrev) / 1000;
    this.tPrev = t;
    if (dtVero > this.maxDt) {
      // Buco: si riprende da dove si era, senza inventare adattamento.
      return { baseline: this.mean, sigma: this.scala.value };
    }
    const dt = Math.max(1e-4, dtVero);
    const d = v - this.mean;
    if (!this.frozen) {
      const a = 1 - Math.exp(-dt / Math.max(0.1, this.tau));
      this.mean += a * d;
    }
    // La scala NON si aggiorna durante un gesto: sigma deve descrivere
    // il rumore a riposo. `frozen` è già alzato dal motore all'inizio
    // del gesto e abbassato alla fine.
    const sigma = this.scala.push(t, d, !this.frozen);
    return { baseline: this.mean, sigma };
  }
}

/* ------------------------------------------------------------------ *
 * Trigger con isteresi.
 * Soglia di attivazione più alta di quella di rilascio: senza, il
 * segnale "sfarfalla" attorno alla soglia e genera raffiche di eventi.
 * ------------------------------------------------------------------ */
export class Hysteresis {
  constructor(onK = 3.5, offK = 1.5) { this.onK = onK; this.offK = offK; this.active = false; }
  reset() { this.active = false; }
  /** @returns {'rise'|'fall'|null} transizione, o null se stabile */
  update(displacement, sigma) {
    const s = Math.max(1e-6, sigma);
    const n = displacement / s;
    if (!this.active && n >= this.onK) { this.active = true; return 'rise'; }
    if (this.active && n < this.offK) { this.active = false; return 'fall'; }
    return null;
  }
  normalized(displacement, sigma) { return displacement / Math.max(1e-6, sigma); }
}

/* ------------------------------------------------------------------ *
 * Rilevatore di impulsi (ammiccamento) con conteggio a raffica.
 * Un blink singolo, doppio e triplo sono lo stesso evento contato in
 * una finestra: si emette solo alla scadenza della finestra, perché
 * altrimenti un doppio verrebbe segnalato prima come singolo.
 * ------------------------------------------------------------------ */
export class PulseCounter {
  constructor(burstWindowMs = 600) {
    this.window = burstWindowMs;
    this.count = 0;
    this.tFirst = 0;
    this.inPulse = false;
  }
  reset() { this.count = 0; this.inPulse = false; }
  /**
   * @param closed true se l'occhio è chiuso in questo istante
   * @returns {{count:number}|null} emesso alla chiusura della finestra
   */
  update(t, closed) {
    if (closed && !this.inPulse) {
      this.inPulse = true;
      if (this.count === 0) this.tFirst = t;
      this.count++;
    } else if (!closed && this.inPulse) {
      this.inPulse = false;
    }
    if (this.count > 0 && !this.inPulse && (t - this.tFirst) > this.window) {
      const c = this.count; this.count = 0;
      return { count: c };
    }
    return null;
  }
}

/** Percentile su array (per il timing adattivo e la soglia IR). */
export function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const idx = Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))));
  return a[idx];
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/* ------------------------------------------------------------------ *
 * Rilevatore di ammiccamento con AUTO-CALIBRAZIONE.
 *
 * Perché non basta una soglia fissa: `openness` è la distanza fra le
 * palpebre divisa per la larghezza dell'occhio. Il valore tipico di un
 * occhio APERTO è 0,25–0,35; chiuso è 0,04–0,12. Ma dipende dalla
 * persona, dall'angolo della camera e dalla forma dell'occhio: una
 * soglia assoluta sbagliata di poco classifica come "chiuso" ogni
 * fotogramma, e allora la maschera ammiccamento invalida tutto il
 * segnale e NIENTE funziona più.
 *
 * Quindi si misura il riferimento "occhio aperto" della persona (alto
 * percentile scorrevole) e si chiude relativamente a quello.
 * ------------------------------------------------------------------ */
export class BlinkDetector {
  constructor(ratio = 0.55, absoluteFloor = 0.08, windowSize = 300) {
    this.ratio = ratio;              // frazione dell'apertura di riposo
    this.floor = absoluteFloor;      // rete di sicurezza assoluta
    this.win = windowSize;
    this.buf = [];
    this.openRef = null;
    this.calibrated = false;
    // ── Distinzione fra ammiccamento e sguardo in basso ──
    // Un ammiccamento è un transitorio RAPIDO: l'apertura crolla in
    // 100–200 ms. Guardare in basso abbassa la palpebra in modo
    // GRADUALE e la tiene lì. Le due cose vanno trattate all'opposto:
    // l'ammiccamento va mascherato (sposterebbe il centroide e
    // simulerebbe un movimento inesistente), lo sguardo in basso NO,
    // perché è proprio il movimento che si vuole rilevare.
    // Il criterio è la DURATA della chiusura, non la velocità della
    // discesa: la velocità non separa in modo affidabile, perché
    // abbassare la palpebra guardando in basso richiede 200-400 ms,
    // troppo vicino ai 100-200 ms di un ammiccamento.
    // Un ammiccamento invece dura poco e finisce; una palpebra
    // abbassata perché si guarda in basso resta lì per secondi.
    this.discriminaVelocita = true;
    this.sustainedMs = 500;          // oltre: non è un ammiccamento
    // ⚠️ Soglia di CHIUSURA VERA, relativa all'apertura di riposo.
    //
    // Distinguere "occhio chiuso" da "sguardo in basso" con un
    // pavimento assoluto non funziona: quanto vale l'apertura a occhio
    // chiuso dipende dalla persona, dalla telecamera e dalla distanza.
    // Con un pavimento troppo basso un occhio davvero chiuso finisce
    // sopra di esso, viene scambiato per sguardo in basso e dopo mezzo
    // secondo torna "aperto" — anche se resta chiuso per dieci secondi.
    //
    // Il rapporto invece è stabile: guardando in basso l'apertura
    // scende al 40-60% del riposo, chiudendo scende sotto il 25%.
    this.ratioChiuso = 0.25;
    this.tSottoSoglia = null;        // da quando siamo sotto soglia
    // Soglia fissa, quando l'auto-calibrazione è spenta. La logica di
    // durata resta la STESSA: distinguere un ammiccamento da uno
    // sguardo in basso non ha nulla a che vedere con il modo in cui la
    // soglia è stata scelta.
    this.sogliaFissa = null;
  }
  reset() {
    this.buf.length = 0; this.openRef = null; this.calibrated = false;
    this.tSottoSoglia = null;
  }
  configure(ratio, floor, discrimina, sustainedMs, sogliaFissa, ratioChiuso) {
    this.ratio = ratio; this.floor = floor;
    if (discrimina !== undefined) this.discriminaVelocita = !!discrimina;
    if (sustainedMs !== undefined) this.sustainedMs = sustainedMs;
    if (sogliaFissa !== undefined) this.sogliaFissa = sogliaFissa;
    if (ratioChiuso !== undefined) this.ratioChiuso = ratioChiuso;
  }

  /** Sotto questa apertura l'occhio è CHIUSO, non abbassato. */
  get sogliaChiusura() {
    const rif = this.openRef;
    const rel = rif ? rif * this.ratioChiuso : 0;
    // Il pavimento assoluto resta come rete di sicurezza, ma non è più
    // l'unico criterio: si prende il più alto dei due.
    return Math.max(this.floor, rel);
  }

  /**
   * @param t timestamp ms
   * @returns {{closed, blink, parziale, openRef, threshold, calibrated}}
   *   closed  → il campione va invalidato
   *   blink   → è stato riconosciuto un ammiccamento (chiusura rapida)
   *   parziale→ palpebra abbassata ma non un ammiccamento: campione
   *             VALIDO, perché è quello che succede guardando in basso
   */
  update(openness, t = 0) {
    if (!isFinite(openness) || openness <= 0) {
      return { closed: false, blink: false, parziale: false,
               openRef: this.openRef, threshold: this.threshold, calibrated: this.calibrated };
    }
    // ⚠️ Il riferimento descrive l'occhio APERTO, e va difeso.
    //
    // Alimentandolo a ogni fotogramma, una chiusura prolungata riempie
    // la finestra di valori bassi: il riferimento collassa, le soglie
    // scendono con lui, e dopo qualche secondo l'occhio chiuso risulta
    // "aperto". Tenere un occhio chiuso dieci secondi ne mostrava
    // cinque. Gli ammiccamenti brevi non danno il problema perché sono
    // una minoranza; una chiusura lunga sì.
    //
    // Quindi: mentre l'occhio è giudicato chiuso, il riferimento non si
    // aggiorna. Resta ancorato a com'era prima della chiusura.
    const giaGiudicabile = this.calibrated && this.openRef;
    const oraChiuso = giaGiudicabile && openness < this.sogliaChiusura;
    if (!oraChiuso) {
      this.buf.push(openness);
      if (this.buf.length > this.win) this.buf.shift();
    }

    // 85° percentile: robusto rispetto a picchi spuri, e non viene
    // trascinato in basso dagli ammiccamenti (che sono una minoranza
    // dei fotogrammi).
    if (this.buf.length >= 20) {
      this.openRef = percentile(this.buf, 85);
      this.calibrated = true;
    }
    const thr = this.threshold;
    const rif = this.openRef ?? openness;

    const sottoSoglia = openness < thr;
    if (!sottoSoglia) {
      this.tSottoSoglia = null;
      return { closed: false, blink: false, parziale: false,
               openRef: this.openRef, threshold: thr, calibrated: this.calibrated };
    }
    if (this.tSottoSoglia === null) this.tSottoSoglia = t;
    const durata = t - this.tSottoSoglia;

    // Occhio davvero chiuso: si maschera SEMPRE, per tutta la durata.
    // Tenere un occhio chiuso dieci secondi deve risultare dieci
    // secondi, non mezzo.
    if (openness < this.sogliaChiusura) {
      return { closed: true, blink: durata < this.sustainedMs, parziale: false,
               openRef: this.openRef, threshold: thr, calibrated: this.calibrated };
    }

    if (!this.discriminaVelocita) {
      return { closed: true, blink: true, parziale: false,
               openRef: this.openRef, threshold: thr, calibrated: this.calibrated };
    }

    // Zona intermedia. All'inizio si maschera comunque: potrebbe essere
    // un ammiccamento, e mascherare per mezzo secondo non costa nulla.
    // Se però la palpebra RESTA abbassata oltre quel tempo, non è un
    // ammiccamento: è lo sguardo in basso, e i campioni tornano validi.
    if (durata < this.sustainedMs) {
      return { closed: true, blink: true, parziale: false,
               openRef: this.openRef, threshold: thr, calibrated: this.calibrated };
    }
    return { closed: false, blink: false, parziale: true,
             openRef: this.openRef, threshold: thr, calibrated: this.calibrated };
  }

  get threshold() {
    // Soglia fissa scelta a mano: ha la precedenza, ma tutto il resto
    // del ragionamento resta identico.
    if (this.sogliaFissa !== null && this.sogliaFissa !== undefined) return this.sogliaFissa;
    if (this.openRef === null) return this.floor;
    return Math.max(this.floor, this.openRef * this.ratio);
  }
}

/* ------------------------------------------------------------------ *
 * Contatore di raffiche di ammiccamento, con finestra configurabile.
 * Emette solo alla chiusura della finestra: altrimenti un doppio
 * verrebbe segnalato prima come singolo.
 * ------------------------------------------------------------------ */
export class BlinkBurst {
  constructor(windowMs = 700, minPulseMs = 40, maxPulseMs = 600) {
    this.windowMs = windowMs;
    this.minPulseMs = minPulseMs;   // sotto: rumore, non un ammiccamento
    this.maxPulseMs = maxPulseMs;   // sopra: occhio chiuso, non un ammiccamento
    this.count = 0; this.tFirst = 0;
    this.inPulse = false; this.tPulseStart = 0;
    this.stats = { single: 0, double: 0, triple: 0, rejectedShort: 0, rejectedLong: 0 };
  }
  configure(windowMs, minPulseMs, maxPulseMs) {
    this.windowMs = windowMs;
    if (minPulseMs !== undefined) this.minPulseMs = minPulseMs;
    if (maxPulseMs !== undefined) this.maxPulseMs = maxPulseMs;
  }
  reset() { this.count = 0; this.inPulse = false; }

  update(t, closed) {
    // La scadenza si verifica PRIMA di elaborare il nuovo impulso.
    // Altrimenti, se le chiamate sono rade, due ammiccamenti lontani
    // fra loro verrebbero fusi in una raffica solo perché nessuna
    // chiamata è caduta nell'intervallo in mezzo.
    let scaduta = null;
    if (this.count > 0 && !this.inPulse && (t - this.tFirst) > this.windowMs) {
      scaduta = this._chiudi();
    }
    if (closed && !this.inPulse) {
      this.inPulse = true; this.tPulseStart = t;
    } else if (!closed && this.inPulse) {
      this.inPulse = false;
      const dur = t - this.tPulseStart;
      if (dur < this.minPulseMs) { this.stats.rejectedShort++; }
      else if (dur > this.maxPulseMs) { this.stats.rejectedLong++; }
      else {
        if (this.count === 0) this.tFirst = t;
        this.count++;
      }
    }
    if (this.count > 0 && !this.inPulse && (t - this.tFirst) > this.windowMs) {
      return this._chiudi();
    }
    return scaduta;
  }

  /**
   * Scarta l'impulso in corso SENZA contarlo.
   *
   * Serve quando la chiusura si rivela un abbassamento sostenuto —
   * cioè uno sguardo in basso, non un ammiccamento. Senza questo, le
   * due logiche si contraddicono: la maschera decide "non è un
   * ammiccamento" dopo mezzo secondo, ma il contatore ne ha già
   * registrato uno, perché mezzo secondo sta sotto la durata massima
   * di un ammiccamento.
   */
  annulla() {
    this.inPulse = false;
    this.count = 0;
    this.tPulseStart = null;
  }

  _chiudi() {
    const c = this.count; this.count = 0;
    if (c === 1) this.stats.single++;
    else if (c === 2) this.stats.double++;
    else if (c >= 3) this.stats.triple++;
    return { count: c };
  }
}
