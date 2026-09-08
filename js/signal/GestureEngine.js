/**
 * GestureEngine.js — Dal segnale oculare all'intenzione.
 *
 * Riceve osservazioni per-occhio dal tracker, le filtra, le fonde e
 * produce eventi di gesto secondo la configurazione.
 *
 * Principio dei canali: un canale disattivato non viene CALCOLATO, non
 * viene solo scartato a valle. Per una persona con spasmi palpebrali
 * involontari il rilevamento del blink non è inutile: è dannoso.
 * Spegnerlo deve significare che non esiste.
 */

import { MedianWindow, LowPass, AdaptiveBaseline, Hysteresis, BlinkDetector, BlinkBurst, percentile } from './filters.js';

/** Assi monitorati: uno stato di filtri indipendente per ciascuno. */
/* ⚠️ TRE assi, non due.
 *
 * 'a' è l'APERTURA della palpebra, ed è un'informazione che finora
 * veniva usata solo per riconoscere una chiusura — cioè come
 * interruttore, non come misura.
 *
 * Ma alzando molto lo sguardo l'occhio si spalanca: la distanza fra le
 * palpebre cresce in modo netto e ben visibile. Per chi ha un occhio
 * abitualmente socchiuso, quel cambiamento è spesso PIÙ marcato dello
 * spostamento dell'iride — e per giunta non soffre del problema che
 * affligge l'iride, cioè la palpebra che la copre proprio quando il
 * gesto è al massimo.
 *
 * Trattandola come un asse a sé, l'apertura ottiene tutto ciò che
 * hanno gli altri: baseline propria, stima del rumore propria, soglia,
 * guadagno, isteresi. Ed è misurata in multipli del proprio rumore,
 * quindi confrontabile con gli altri canali. */
const AXES = ['y', 'x', 'a'];

/**
 * Canali del viso: espressione → canale di gesto.
 *
 * Passano dalla STESSA catena degli assi oculari — mediana,
 * passa-basso, baseline adattiva, isteresi, durata — quindi ereditano
 * senza costo tutto il lavoro fatto contro nistagmo, tremori e falsi
 * positivi. Sono segnali unipolari: a riposo valgono zero e possono
 * solo salire, quindi conta solo la direzione positiva.
 */
export const EXPR_CHECKS = [
  { id: 'mouthOpen', key: 'MOUTH_OPEN', label: 'Bocca aperta' },
  { id: 'smile',     key: 'SMILE',      label: 'Sorriso' },
  { id: 'pucker',    key: 'PUCKER',     label: 'Labbra a bacio' },
  { id: 'funnel',    key: 'FUNNEL',     label: 'Labbra a O' },
  { id: 'cheekPuff', key: 'CHEEK_PUFF', label: 'Guance gonfie' },
  { id: 'browUp',    key: 'BROW_UP',    label: 'Sopracciglia alzate' },
];

/** Direzioni monitorate e canali che vi corrispondono. */
const DIR_CHECKS = [
  { axis: 'y', sign: -1, id: 'up',    keys: ['UP', 'UP_LONG', 'UP_VERYLONG'] },
  { axis: 'y', sign: +1, id: 'down',  keys: ['DOWN'] },
  { axis: 'x', sign: -1, id: 'left',  keys: ['LEFT'] },
  { axis: 'x', sign: +1, id: 'right', keys: ['RIGHT'] },
  /* Apertura: si spalanca (segno +) o si socchiude (segno −).
   * Spenti di default come ogni canale nuovo: chi non li usa non deve
   * accorgersi che esistono. */
  { axis: 'a', sign: +1, id: 'wide',  keys: ['WIDE'] },
  { axis: 'a', sign: -1, id: 'narrow', keys: ['NARROW'] },
];
export const DIRECTIONS = DIR_CHECKS.map(d => ({ id: d.id, axis: d.axis, sign: d.sign }));

/**
 * ══════════════════════════════════════════════════════════════════
 * CANALE COMBINATO
 * ══════════════════════════════════════════════════════════════════
 *
 * Un solo movimento volontario produce spesso PIÙ segnali insieme:
 * alzando lo sguardo l'iride sale, la palpebra si spalanca, e a volte
 * il sopracciglio si solleva. Finora ciascuno veniva giudicato da
 * solo, e se nessuno superava la propria soglia il gesto andava perso
 * — anche quando tutti e tre dicevano la stessa cosa.
 *
 * Sommandoli si guadagna in modo preciso e prevedibile. I rumori dei
 * canali sono in buona parte indipendenti, quindi sommando k segnali
 * il rumore cresce come la RADICE di k mentre il segnale cresce come
 * k: il rapporto migliora di √k. Con due canali si guadagna il 41%,
 * con tre il 73%.
 *
 * ⚠️ La divisione per √(Σw²) non è un dettaglio estetico: senza, la
 * somma avrebbe un rumore più grande e le soglie tarate sui canali
 * singoli non varrebbero più. Così invece il canale combinato si
 * misura nella stessa unità di tutti gli altri, e le soglie restano
 * confrontabili.
 */
export function combina(valori, pesi) {
  let num = 0, den = 0;
  for (let i = 0; i < valori.length; i++) {
    const v = valori[i], w = pesi?.[i] ?? 1;
    if (!Number.isFinite(v) || w === 0) continue;
    num += w * v;
    den += w * w;
  }
  return den > 0 ? num / Math.sqrt(den) : 0;
}

class AxisState {
  constructor(cfg) {
    this.median = new MedianWindow(cfg.medianWindowMs);
    this.lp = new LowPass(cfg.lowPassHz);
    this.base = new AdaptiveBaseline(cfg.baselineTauSec, cfg.minSigma);
    // Una isteresi per DIREZIONE: alto e basso sono canali distinti e
    // devono poter essere attivi indipendentemente.
    // Un'isteresi per DIREZIONE, con la propria soglia: le direzioni
    // possono richiedere sensibilità diverse sulla stessa persona.
    this.hyst = { '-1': new Hysteresis(cfg.thresholdOn, cfg.thresholdOff),
                  '+1': new Hysteresis(cfg.thresholdOn, cfg.thresholdOff) };
    this.tRise = { '-1': 0, '+1': 0 };
    this.raw = 0; this.smooth = 0; this.baseline = 0; this.sigma = cfg.minSigma;
    this.disp = 0;
    this.activeDir = 0;
    this.valid = false;
  }
  reset() {
    this.median.reset(); this.lp.reset(); this.base.reset();
    this.hyst['-1'].reset(); this.hyst['+1'].reset();
    this.activeDir = 0; this.valid = false;
  }
  /**
   * Spostamento normalizzato in sigma, nella direzione richiesta.
   * @param gain guadagno della direzione (1 = nessuna correzione)
   */
  n(sign, gain = 1) { return (gain * sign * this.disp) / Math.max(1e-6, this.sigma); }
}

export class GestureEngine {
  /**
   * @param cfg config completa
   * @param onEvent callback (event) => void
   */
  constructor(cfg, onEvent) {
    this.cfg = cfg;
    this.onEvent = onEvent;
    this.eyes = { left: null, right: null };
    this.lastEventAt = 0;
    // Un rilevatore di ammiccamento PER OCCHIO: le palpebre possono
    // avere apertura di riposo diversa, e calibrarle insieme sarebbe
    // sbagliato per chiunque abbia asimmetria facciale.
    this.blink = { left: new BlinkDetector(), right: new BlinkDetector() };
    // Una raffica PER OCCHIO: sono due palpebre indipendenti.
    // Con un contatore solo, alimentato dall'OR dei due, un occhio
    // cronicamente chiuso teneva l'impulso aperto per sempre e
    // azzerava il conteggio dell'altro.
    this.burst = { left: new BlinkBurst(700), right: new BlinkBurst(700) };
    // Breve finestra per non contare due volte lo stesso ammiccamento
    // fatto con entrambi gli occhi.
    this.tUltimaRaffica = -1e9;
    this.snr = { left: 0, right: 0 };
    this.snrBuf = { left: [], right: [] };
    this.dominant = null;
    this.paused = false;
    this.diagnostics = false;   // in diagnostica si calcolano tutti gli assi
    this.misura = null;         // misura di calibrazione in corso
    // Canali del viso: uno stato per espressione, creato solo quando
    // servono. Vuoto = nessun costo, nessun comportamento aggiunto.
    this.espr = {};
    // Blocco temporaneo: mentre si detta a voce la bocca si muove di
    // continuo, e i canali labiali non devono poter comandare nulla.
    this.visoSospeso = false;
    this._pending = {};
    this.counters = {
      framesTotal: 0,
      latchReleased: 0,           // agganci sciolti d'ufficio
      burstAborted: 0,            // raffiche annullate: abbassamento sostenuto
      framesValid: 0,
      // Per occhio: rivela un occhio i cui campioni vengono scartati
      // più spesso, che è la causa più comune di un'ampiezza più bassa
      // senza che il movimento sia diverso.
      validiLeft: 0, validiRight: 0,
      scartatiLeft: 0, scartatiRight: 0,
      // Tempo con l'occhio chiuso, separato per occhio. Prima era un
      // unico conteggio di FOTOGRAMMI: arrivava a migliaia e non
      // significava nulla di leggibile. In secondi, e per occhio, si
      // capisce subito quanto tempo un occhio è rimasto chiuso.
      closedMsLeft: 0, closedMsRight: 0,
      blinkSingle: 0, blinkDouble: 0, blinkTriple: 0,
      blinkRejectedShort: 0, blinkRejectedLong: 0,
      gestures: {}, rejected: 0, lastRejectReason: '',
    };
    this._rebuild();
    this._syncBlink();
  }

  /**
   * Azzera TUTTO lo stato del rilevamento e riparte da zero.
   *
   * ⚠️ Serve un modo esplicito di ricominciare, e prima non c'era.
   *
   * Le stime del rumore, le baseline, i riferimenti di apertura e i
   * contatori si accumulano per tutta la sessione. È giusto: servono
   * tempo per essere affidabili. Ma significa che caricando un video
   * diverso, o passando a un'altra persona, si continua a misurare
   * con lo stato costruito su quello di prima — e se quello stato si
   * era guastato, non c'è modo di uscirne.
   *
   * Ricostruire i filtri cambiando un parametro lo faceva per caso, ed
   * è il motivo per cui "applica e poi ripristina" sembrava aggiustare
   * le cose: non era la configurazione, era l'azzeramento.
   *
   * Meglio poterlo chiedere direttamente.
   */
  nuovaSessione() {
    this._rebuild();
    for (const eye of ['left', 'right']) {
      this.blink[eye]?.reset?.();
      this.burst[eye]?.reset?.();
    }
    this._combo = null;
    this._comboN = null;
    this._comboDa = null;
    this._pending = {};
    this.dominant = 'left';
    for (const k of Object.keys(this.counters)) {
      if (typeof this.counters[k] === 'number') this.counters[k] = 0;
    }
    this.counters.lastRejectReason = null;
  }

  _rebuild() {
    const s = this.cfg.signal;
    // ⚠️ Filtri più LEGGERI per le espressioni del viso.
    //
    // Quelli oculari sono tarati contro il nistagmo — mediana lunga,
    // taglio basso — e allungano ogni evento di quattro o cinquecento
    // millisecondi. Sugli occhi è un prezzo accettabile; sulle
    // espressioni no, perché la DURATA è proprio ciò che distingue un
    // comando volontario da un movimento del parlato. Il viso non ha
    // nistagmo: non c'è nulla da sopprimere, e filtrarlo pesantemente
    // renderebbe indistinguibili una smorfia di mezzo secondo e una
    // tenuta di un secondo e mezzo.
    const sEspr = { ...s, medianWindowMs: 120, lowPassHz: 3.5, baselineTauSec: 45 };
    this.espr = {};
    for (const E of EXPR_CHECKS) this.espr[E.id] = new AxisState(sEspr);
    this._firmaFiltriCorrente = this._firmaFiltri(this.cfg);
    this.eyes.left = Object.fromEntries(AXES.map(a => [a, new AxisState(s)]));
    this.eyes.right = Object.fromEntries(AXES.map(a => [a, new AxisState(s)]));
    // Assestamento: finché baseline e sigma non hanno senso, il segnale
    // normalizzato è inaffidabile e produrrebbe scatti spuri. Si
    // continua a calcolare e a mostrare tutto, ma non si emettono gesti.
    this.settleUntil = null;
  }

  /** True se il segnale non è ancora attendibile dopo una ricostruzione. */
  get settling() {
    return this.settleUntil !== null && this._lastT < this.settleUntil;
  }

  /**
   * ⚠️ Punto delicato.
   *
   * Ricostruire la catena di filtri azzera baseline e sigma, e sigma
   * riparte dal valore minimo: il primo gesto dopo la ricostruzione
   * appare enorme (20σ invece di 12σ), poi l'ampiezza rientra man mano
   * che sigma si riassesta. Sembrava un difetto del rilevamento, ed era
   * invece l'effetto di aver toccato una QUALSIASI impostazione — anche
   * solo accendere una traccia nel grafico.
   *
   * Quindi si ricostruisce SOLO se cambiano i parametri che definiscono
   * i filtri. Tutto il resto (soglie, canali, tracce, audio) si applica
   * senza toccare lo stato del segnale.
   */
  updateConfig(cfg) {
    // ⚠️ La configurazione viene modificata SUL POSTO da set(), quindi
    // this.cfg e cfg sono lo stesso oggetto: confrontarli non
    // rileverebbe mai un cambiamento. Si conserva la firma calcolata
    // all'ultima ricostruzione e si confronta con quella.
    this.cfg = cfg;
    const dopo = this._firmaFiltri(cfg);
    if (dopo !== this._firmaFiltriCorrente) this._rebuild();
    else this._aggiornaSoglie();
    this._syncBlink();
  }

  /** Parametri che, cambiando, richiedono davvero nuovi filtri. */
  _firmaFiltri(cfg) {
    const s = cfg?.signal;
    if (!s) return '';
    return [s.medianWindowMs, s.lowPassHz, s.baselineTauSec, s.minSigma].join('|');
  }

  /** Applica le nuove soglie senza perdere baseline e sigma. */
  _aggiornaSoglie() {
    const s = this.cfg.signal;
    for (const eye of ['left', 'right']) {
      for (const d of DIR_CHECKS) {
        const A = this.eyes[eye][d.axis];
        if (!A) continue;
        const key = d.sign < 0 ? '-1' : '+1';
        A.hyst[key].onK = this.sogliaDi(d.id);
        A.hyst[key].offK = this.sogliaDi(d.id) * (s.thresholdOff / s.thresholdOn);
      }
    }
  }

  /**
   * Aggiorna gli stati delle espressioni facciali.
   *
   * Un valore assente non è zero: significa "non misurato", e azzerare
   * farebbe apparire un movimento inesistente al ritorno del dato.
   */
  _processaEspressioni(t, espressioni) {
    if (!espressioni) return;
    const s = this.cfg.signal;
    for (const E of EXPR_CHECKS) {
      const v = espressioni[E.id];
      const A = this.espr[E.id];
      if (!A) continue;
      if (!Number.isFinite(v)) { A.valid = false; continue; }
      A.raw = v;
      A.smooth = A.lp.push(t, A.median.push(t, v));
      const b = A.base.push(t, A.smooth);
      A.baseline = b.baseline;
      A.sigma = Math.max(s.minSigma, b.sigma);
      A.disp = A.smooth - A.baseline;
      A.valid = true;
    }
  }

  /**
   * Congela o libera un asse di UN occhio.
   *
   * ⚠️ Prima il congelamento avveniva solo dentro il ciclo sugli occhi
   * IN GIOCO. L'altro occhio non veniva mai protetto: la sua baseline
   * assorbiva ogni movimento e il suo rumore stimato includeva i
   * campioni del gesto.
   *
   * Con lo STESSO identico movimento su entrambi, l'occhio in gioco
   * restava a 22σ e l'altro scendeva a 2σ, con il rumore cresciuto di
   * otto volte. In diagnostica si vedeva un occhio funzionare e
   * l'altro degradare senza alcuna ragione visibile.
   *
   * E non è un problema estetico: se il programma cambia occhio
   * dominante — perché quello in uso si chiude, o la luce cambia — si
   * ritrova a lavorare con un occhio la cui taratura è stata rovinata
   * mentre non lo guardava nessuno.
   *
   * ⚠️ La protezione è PER OCCHIO e indipendente: non si può assumere
   * che gli occhi facciano sempre la stessa cosa. Si può ammiccare con
   * uno solo, uno può essere paralizzato, uno può non essere rilevato
   * per via della luce. Ogni occhio decide in base al PROPRIO segnale.
   *
   * La correzione sta altrove: la valutazione del gesto — e quindi la
   * decisione di congelare — viene ora eseguita per TUTTI E DUE gli
   * occhi, mentre solo quelli in gioco possono EMETTERE un comando.
   */
  _congelaAsse(eye, axis, congela) {
    const A = this.eyes[eye]?.[axis];
    if (!A) return;
    if (congela) A.base.freeze(); else A.base.release();

    /* ══════════════════════════════════════════════════════════════
     * LA STIMA DEL RUMORE SI SOSPENDE SU ENTRAMBI GLI OCCHI
     * ══════════════════════════════════════════════════════════════
     *
     * ⚠️ È la correzione del difetto più ostinato di questo progetto.
     *
     * Quando un occhio è più debole — più coperto, più obliquo, meno
     * illuminato — la sua ampiezza può non superare la soglia del
     * gesto. Allora per lui il gesto non esiste, i suoi campioni non
     * vengono esclusi dalla stima del rumore, e quella si gonfia: da
     * lì l'ampiezza cala, il gesto scatta ancora meno, e non si
     * risale più. Misurato: da 3,5σ a 2,0σ con il rumore cresciuto da
     * 0,004 a 0,050, mentre l'altro occhio restava stabile.
     *
     * La via d'uscita sta in una legge della fisiologia: gli occhi
     * ruotano SEMPRE insieme (legge di Hering). Un movimento dello
     * sguardo è un evento di entrambi, anche quando uno solo lo
     * mostra abbastanza da essere riconosciuto.
     *
     * Quindi: se un occhio riconosce un gesto, per ENTRAMBI si sospende
     * l'apprendimento del rumore. La baseline invece resta per occhio,
     * perché quella descrive dove sta il riposo di ciascuno.
     *
     * ⚠️ Non vale per gli ammiccamenti, che possono essere di un occhio
     * solo: qui si parla di direzione dello sguardo.
     */
    for (const altro of ['left', 'right']) {
      const B = this.eyes[altro]?.[axis];
      if (B) B.base.congelaScala(congela);
    }
  }

  /**
   * Valuta il canale combinato: somma i canali scelti e li giudica
   * come un gesto a sé.
   *
   * ⚠️ Non tocca in alcun modo i canali singoli, che continuano a
   * funzionare esattamente come prima. A combinazione spenta questo
   * metodo esce subito.
   */
  _valutaCombinato(t, g, inGioco, out) {
    const K = this.cfg.gestures?.COMBO;
    const sorg = this.cfg.signal?.comboCanali;
    if (!K?.enabled || !Array.isArray(sorg) || sorg.length < 2) return;

    const ch = this.channels();
    for (const eye of ['left', 'right']) {
      const valori = [], pesi = [];
      for (const id of sorg) {
        // Un canale del viso o una direzione: entrambi vanno bene.
        const c1 = ch[`${eye}.${id}`] || ch[id];
        if (!c1) continue;
        valori.push(c1.n);
        pesi.push(this.cfg.signal?.comboPesi?.[id] ?? 1);
      }
      if (valori.length < 2) continue;

      const n = combina(valori, pesi);
      this._combo ||= {};
      this._combo[eye] ||= new Hysteresis(this.cfg.signal.thresholdOn, this.cfg.signal.thresholdOff);
      const hyst = this._combo[eye];
      hyst.onK = this.sogliaDi('combo') ?? this.cfg.signal.thresholdOn;
      hyst.offK = this.cfg.signal.thresholdOff;
      // Il valore è già in multipli del rumore: si passa 1 come scala.
      const ev = hyst.update(n, 1);

      this._comboN ||= {};
      this._comboN[eye] = n;

      if (ev === 'rise') {
        this._comboDa ||= {};
        this._comboDa[eye] = t;
      } else if (ev === 'fall' && this._comboDa?.[eye] != null) {
        const dur = t - this._comboDa[eye];
        this._comboDa[eye] = null;
        out.candidates.push({ eye, axis: 'combo', sign: +1, phase: 'fall', durMs: dur, t });
        if (inGioco.includes(eye)) {
          this._resolve(t, eye, { axis: 'combo', sign: +1, id: 'combo', keys: ['COMBO'] },
                        dur, ['COMBO'], false, out);
        }
      }
    }
  }

  /** Soglia di un'espressione, o quella globale se non impostata. */
  sogliaEspr(id) {
    const v = this.cfg.signal.thresholdExpr?.[id];
    return (typeof v === 'number' && isFinite(v)) ? v : this.cfg.signal.thresholdOn;
  }

  /** Guadagno di un'espressione. */
  guadagnoEspr(id) {
    const v = this.cfg.signal.gainExpr?.[id];
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 1;
  }

  /** Blocca o sblocca i canali del viso (es. durante la dettatura). */
  setVisoSospeso(on) { this.visoSospeso = !!on; }

  /** Soglia della direzione, o quella globale se non impostata. */
  sogliaDi(dirId) {
    const s = this.cfg.signal;
    const v = s.thresholdDir?.[dirId];
    return (typeof v === 'number' && isFinite(v)) ? v : s.thresholdOn;
  }

  /** Guadagno della direzione (1 = nessuna correzione). */
  guadagnoDi(dirId) {
    const v = this.cfg.signal.gainDir?.[dirId];
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 1;
  }

  /**
   * Guadagno del singolo occhio.
   *
   * ⚠️ Due occhi possono misurare diversamente lo stesso movimento
   * fisico: uno più coperto dalla palpebra, uno più obliquo, uno
   * abitualmente socchiuso. Il rapporto fra le loro ampiezze grezze è
   * stabile e misurabile, e questo lo pareggia — come si tarano due
   * microfoni diversi perché registrino allo stesso livello.
   */
  guadagnoOcchio(eye) {
    const v = this.cfg.signal.gainEye?.[eye];
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 1;
  }

  _syncBlink() {
    const s = this.cfg.signal, g = this.cfg.gestures;
    for (const eye of ['left', 'right']) {
      this.blink[eye].configure(
        s.blinkRatio, s.blinkFloor, s.blinkDiscriminate, s.blinkSustainedMs,
        s.blinkAutoCalibrate ? null : s.blinkLidThreshold, s.blinkClosedRatio,
        s.blinkRichiedeIride, s.blinkSogliaIride, s.blinkSmentiSopra,
        s.blinkSmentiVelocita);
    }
    for (const eye of ['left', 'right'])
      this.burst[eye].configure(g.blinkBurstMs, g.blinkMinPulseMs, g.blinkMaxPulseMs);
  }

  /** Stato della calibrazione ammiccamento, per la diagnostica. */
  blinkStatus() {
    const b = this.blink;
    return {
      left:  { openRef: b.left.openRef,  threshold: b.left.threshold,  calibrated: b.left.calibrated },
      right: { openRef: b.right.openRef, threshold: b.right.threshold, calibrated: b.right.calibrated },
      burst: { ...this.burst.left.stats },
      burstLeft: { ...this.burst.left.stats },
      burstRight: { ...this.burst.right.stats },
    };
  }
  reset() {
    for (const eye of ['left', 'right']) {
      for (const a of AXES) this.eyes[eye][a].reset();
      this.blink[eye].reset();
    }
    this.burst.reset();
  }

  /** Canali di direzione effettivamente abilitati (nessun calcolo se spenti). */
  _enabledDirs() {
    const g = this.cfg.gestures;
    return {
      yNeg: g.UP?.enabled || g.UP_LONG?.enabled || g.UP_VERYLONG?.enabled,
      yPos: g.DOWN?.enabled,
      xNeg: g.LEFT?.enabled,
      xPos: g.RIGHT?.enabled,
      aPos: g.WIDE?.enabled,
      aNeg: g.NARROW?.enabled,
      lid: g.BLINK?.enabled || g.DOUBLE_BLINK?.enabled || g.TRIPLE_BLINK?.enabled || g.LONG_CLOSE?.enabled,
    };
  }

  /**
   * @param t timestamp ms (dal momento di CATTURA del frame)
   * @param obs { left: EyeObs|null, right: EyeObs|null }
   *
   * ARCHITETTURA — punto importante.
   * Ogni occhio ha la sua catena di filtri COMPLETA e la sua soglia.
   * La fusione avviene sugli EVENTI, non sul segnale.
   *
   * Fondere i segnali prima dei filtri (come faceva la versione
   * precedente) causava due guasti reali:
   *   1. la baseline veniva congelata per un occhio solo, quindi
   *      durante il gesto quella dell'altro continuava a inseguire e
   *      trascinava giù la media, accorciando o annullando il gesto;
   *   2. chiudendo un occhio il segnale fuso faceva un salto che
   *      scombinava l'isteresi, e il gesto dell'occhio rimasto aperto
   *      non veniva più rilevato.
   * Con catene separate ogni occhio è autonomo e la diagnostica può
   * mostrare che cosa vede ciascuno.
   */
  process(t, obs) {
    this.counters.framesTotal++;
    this._lastT = t;
    if (this.settleUntil === null) this.settleUntil = t + (this.cfg.signal.settleMs || 2000);
    const s = this.cfg.signal;
    const need = this._neededAxes();
    const out = { t, eyes: {}, fused: null, blink: false, candidates: [] };
    let anyClosed = false;
    // Contato una volta per FOTOGRAMMA, non una per occhio: con due
    // occhi la percentuale mostrata in diagnostica arrivava al 200%.
    let almenoUnoValido = false;
    let sostenuto = false;
    // Stato per occhio. `null` significa "non so": campione assente o
    // scartato. Non è "aperto", e non deve chiudere un impulso in corso.
    const chiuso = { left: null, right: null };

    for (const eye of ['left', 'right']) {
      const o = obs[eye];
      if (!o || o.confidence < this.cfg.detection.minConfidence) {
        /* ⚠️ Si CONTA lo scarto, per occhio.
         *
         * Un occhio i cui campioni vengono scartati spesso — luce
         * peggiore, iride più coperta dalla palpebra, angolo della
         * telecamera — mostra un'ampiezza più bassa senza che il
         * movimento sia diverso: i suoi filtri si aggiornano meno, e
         * il picco del gesto viene semplicemente perso.
         *
         * Senza questo numero sembrerebbe che quell'occhio si muova di
         * meno, e si cercherebbe il difetto nel posto sbagliato. */
        if (eye === 'left') this.counters.scartatiLeft++; else this.counters.scartatiRight++;
        out.eyes[eye] = null;
        for (const a of AXES) this.eyes[eye][a].valid = false;
        continue;
      }

      // --- Maschera ammiccamento ---
      // ⚠️ Un solo percorso, qualunque sia l'origine della soglia.
      // Prima la distinzione fra ammiccamento e sguardo in basso era
      // applicata SOLO con l'auto-calibrazione accesa: a soglia fissa
      // si tornava al confronto secco, e uno sguardo in basso tenuto
      // due secondi restava mascherato per due secondi interi.
      // Come si sceglie la soglia e come si interpreta ciò che sta
      // sotto sono due questioni indipendenti.
      // ⚠️ La confidenza dice se l'iride si vede ancora: distingue un
      // ammiccamento vero da un'apertura che si stringe perché lo
      // sguardo è andato in alto.
      const bstat = this.blink[eye].update(o.openness, t, o.confidence);
      const closed = bstat.closed;
      if (bstat.parziale) sostenuto = true;
      if (eye === 'left') this.counters.validiLeft++; else this.counters.validiRight++;
      chiuso[eye] = closed;
      if (closed) {
        anyClosed = true;
        const dt = this._tPrevFrame ? Math.min(200, t - this._tPrevFrame) : 0;
        if (eye === 'left') this.counters.closedMsLeft += dt;
        else this.counters.closedMsRight += dt;
        out.eyes[eye] = { blink: true, openness: o.openness, confidence: o.confidence };
        for (const a of AXES) this.eyes[eye][a].valid = false;
        continue;
      }

      const st = this.eyes[eye];
      const res = { openness: o.openness, confidence: o.confidence, blink: false, axes: {} };

      for (const axis of AXES) {
        if (!need[axis]) { st[axis].valid = false; res.axes[axis] = null; continue; }
        const A = st[axis];
        /* L'apertura arriva in un campo con un altro nome: è la stessa
         * misura che serve al riconoscimento della chiusura, qui però
         * usata come segnale continuo invece che come interruttore. */
        A.raw = axis === 'a' ? o.openness : o[axis];
        A.smooth = A.lp.push(t, A.median.push(t, A.raw));
        /* ── Baseline alimentata solo dalla QUIETE ──
         *
         * Oggi si congela fra l'aggancio e il rilascio del gesto, ma i
         * FIANCHI — la salita prima di superare la soglia e la discesa
         * dopo essere rientrati — la alimentano lo stesso. Ripetendo
         * molti gesti, quei fianchi la trascinano verso la direzione
         * del gesto, e l'escursione misurata si accorcia.
         *
         * Con questa opzione la baseline impara solo quando il segnale
         * è davvero fermo: descrive il riposo vero della persona,
         * non una media fra riposo e movimento. */
        /* ══════════════════════════════════════════════════════════
         * PROTEZIONE LEGATA AL MOVIMENTO, NON AL GESTO RICONOSCIUTO
         * ══════════════════════════════════════════════════════════
         *
         * ⚠️ Il circolo vizioso che faceva calare un occhio solo.
         *
         * Finora la baseline veniva congelata quando SCATTAVA
         * l'aggancio del gesto, cioè sopra la soglia di attivazione.
         * Ma se l'ampiezza di un occhio scende sotto quella soglia —
         * perché quell'occhio è più coperto, più obliquo, meno
         * illuminato — l'aggancio non scatta più, la baseline smette
         * di essere protetta e comincia ad assorbire il movimento.
         * Il gesto successivo risulta più piccolo, quindi ancora più
         * lontano dalla soglia: da lì in giù non risale più.
         *
         * Misurato: un occhio che parte a 3,4σ scendeva a 1,9σ in una
         * quarantina di ripetizioni, mentre l'altro restava a 22σ con
         * lo STESSO movimento fisico.
         *
         * La protezione va quindi legata al MOVIMENTO, non al suo
         * riconoscimento: basta che il segnale superi la soglia di
         * rilascio — molto più bassa — perché la baseline si fermi.
         * Un occhio debole resta così protetto e può risalire.
         *
         * ⚠️ Con un TETTO alla durata: una deriva vera — la testa
         * scivolata, la telecamera urtata — terrebbe la baseline
         * congelata per sempre, e il segnale resterebbe spostato.
         */
        if (s.baselineFreezeDuringGesture) {
          const rap = Math.abs(A.disp) / Math.max(1e-9, A.sigma);
          const agganciato = A.hyst
            && Object.values(A.hyst).some(h => h && h.active);
          if (A._nonProteggere) {
            // Protezione sospesa dopo un rilascio d'ufficio: si
            // riprende solo quando il segnale è tornato a riposo.
            if (rap <= (s.baselineFreezeSigma || s.thresholdOff)) A._nonProteggere = false;
            A._congDa = null;
            A.base.release();
          } else if (agganciato) {
            /* ⚠️ Gesto RICONOSCIUTO: si congela senza tetto.
             *
             * Il tetto qui sarebbe un danno: chi tiene l'occhio alzato
             * mezzo minuto — per riposare, per pensare — si vedrebbe
             * quella posizione promossa a nuovo riposo, e il gesto
             * sparirebbe. Da un aggancio che non si scioglie difende
             * già il rilascio d'ufficio, che è il posto giusto. */
            A._congDa = null;
            A.base.freeze();
          } else if (s.baselineFreezeSigma > 0 && rap > s.baselineFreezeSigma) {
            /* Movimento visibile ma non riconosciuto come gesto: si
             * protegge lo stesso, ma CON tetto. È il criterio debole,
             * e senza limite una deriva vera lo terrebbe attivo per
             * sempre. */
            if (A._congDa == null) A._congDa = t;
            if (t - A._congDa < (s.baselineFreezeMaxMs || 20000)) A.base.freeze();
            else A.base.release();
          } else {
            A._congDa = null;
            A.base.release();
          }
        }
        /* I parametri della stima del rumore sono regolabili: si
         * applicano qui, a ogni fotogramma, così una modifica ha
         * effetto subito senza ricostruire nulla. */
        if (A.base?.scala) {
          A.base.scala.perc = s.sigmaPercentile ?? 0.25;
          A.base.scala.ritaratura = s.sigmaRitaratura ?? 1.577;
          if (s.sigmaFinestraMs) A.base.scala.windowMs = s.sigmaFinestraMs;
        }
        const b = A.base.push(t, A.smooth);
        A.baseline = b.baseline;
        /* ⚠️ Normalizzazione sul rumore: si può SPEGNERE.
         *
         * Accesa (predefinito), ogni gesto è misurato in multipli del
         * rumore di quella persona: le soglie valgono per chiunque,
         * indipendentemente da distanza, illuminazione e telecamera.
         *
         * Spenta, si usa un valore fisso e le soglie diventano
         * spostamenti ASSOLUTI. Serve quando il rumore è così basso o
         * così irregolare che normalizzare confonde invece di aiutare.
         * ⚠️ Spegnendola le soglie vanno ritarate da capo: 3,5 non
         * vorrà più dire "tre volte e mezzo il rumore". */
        A.sigma = s.normalizzaSuRumore === false
          ? Math.max(s.minSigma, s.sigmaFisso ?? 0.02)
          : b.sigma;
        A.disp = A.smooth - A.baseline;
        A.valid = true;
        res.axes[axis] = {
          raw: A.raw, smooth: A.smooth, baseline: A.baseline, sigma: A.sigma,
          disp: A.disp,
          nRaw: (A.raw - A.baseline) / Math.max(1e-6, A.sigma),
          n: A.disp / Math.max(1e-6, A.sigma),
        };
      }
      out.eyes[eye] = res;
      almenoUnoValido = true;

      // SNR: ampiezza tipica / rumore a riposo. Serve a scegliere
      // dinamicamente l'occhio con il segnale migliore.
      const ay = st.y;
      if (ay?.valid && ay.sigma > 0) {
        const buf = this.snrBuf[eye];
        buf.push(Math.abs(ay.disp) / ay.sigma);
        if (buf.length > 300) buf.shift();
        this.snr[eye] = percentile(buf, 95);
      }
    }

    out.blink = anyClosed;
    if (almenoUnoValido) this.counters.framesValid++;
    this._tPrevFrame = t;

    this._pickDominant();
    out.dominant = this.dominant;
    out.snr = { ...this.snr };
    out.fused = this._fusedView(out.eyes);

    // ── Canali del viso ──
    // Elaborati sempre che ci siano dati, così la diagnostica li mostra
    // anche a canali spenti; l'EMISSIONE resta subordinata al canale.
    this._processaEspressioni(t, obs?.espressioni);

    out.settling = this.settling;
    if (this.misura) {
      // Durante la misura non si emettono gesti: si osserva soltanto.
      this._aggiornaMisura();
      out.misura = { ...this.misura };
      return out;
    }
    if (this.settling) {
      // Si aggiornano comunque i filtri (sopra) e la diagnostica, ma
      // nessun evento esce finché il segnale non è attendibile.
      return out;
    }
    /**
     * ⚠️ Il CONTEGGIO degli ammiccamenti gira SEMPRE — anche in pausa,
     * anche a canali spenti — perché la diagnostica deve mostrare cosa
     * sta succedendo indipendentemente dallo stato della scansione.
     *
     * Prima stava dentro il ramo "non in pausa": bastava che la
     * scansione si mettesse in pausa da sola dopo tre giri a vuoto
     * perché i contatori si fermassero, mentre grafico e bande — che
     * sono calcolati più in alto — continuavano a funzionare
     * perfettamente. Sembrava che i contatori fossero rotti.
     *
     * L'EMISSIONE degli eventi resta invece subordinata alla pausa e ai
     * canali, esattamente come prima: in pausa non deve uscire nulla
     * che non sia un risveglio.
     */
    const raffiche = (this._blinkEnabled() || this.diagnostics)
      ? this._contaBlink(t, chiuso, sostenuto)
      : null;

    if (this.paused) {
      this._evaluate(t, out, true);
      this._valutaEspressioni(t, out, true);
    } else {
      this._evaluate(t, out, false);
      this._valutaEspressioni(t, out, false);
      // Il CONTEGGIO degli ammiccamenti gira sempre in diagnostica,
      // anche a canali spenti: serve proprio a decidere se accenderli e
      // con quali tempi. L'EMISSIONE degli eventi resta subordinata al
      // canale, quindi nulla può scattare per sbaglio.
      // Un abbassamento sostenuto annulla la raffica in corso: non era
      // un ammiccamento. Si CONTA però, altrimenti in diagnostica non
      // si capisce dove sia finita la chiusura che si è appena vista, e
      // sembra che i contatori non funzionino.
      //
      // Si conta sul FRONTE, una volta per episodio: un abbassamento
      // tenuto tre secondi è un evento solo, non centocinquanta.
      this._emettiBlink(t, raffiche);
    }
    return out;
  }

  /** Assi da calcolare: quelli usati da un canale acceso, o tutti in diagnostica. */
  _neededAxes() {
    const d = this._enabledDirs();
    const diag = this.cfg.ui.debugMode || this.diagnostics;
    /* ⚠️ Il canale combinato ha bisogno dei suoi ingressi.
     *
     * Gli assi si calcolano solo se qualcuno li usa — è ciò che
     * mantiene leggero il programma. Ma il combinato li usa
     * indirettamente: senza questa riga sommava canali mai calcolati e
     * restava a zero, silenziosamente. */
    const need = { y: diag || d.yNeg || d.yPos, x: diag || d.xNeg || d.xPos,
                   a: diag || d.aPos || d.aNeg };
    if (this.cfg.gestures?.COMBO?.enabled) {
      for (const id of (this.cfg.signal?.comboCanali || [])) {
        const dir = DIR_CHECKS.find(c => c.id === id);
        if (dir) need[dir.axis] = true;
      }
    }
    return need;
  }

  _blinkEnabled() {
    const g = this.cfg.gestures;
    return g.BLINK?.enabled || g.DOUBLE_BLINK?.enabled || g.TRIPLE_BLINK?.enabled || g.LONG_CLOSE?.enabled;
  }

  /** Occhio con il segnale migliore, ricalcolato di continuo. */
  _pickDominant() {
    const act = this.cfg.detection.activeEye;
    if (act === 'left' || act === 'right') { this.dominant = act; return; }
    const okL = this.eyes.left.y.valid, okR = this.eyes.right.y.valid;
    if (okL && !okR) this.dominant = 'left';
    else if (okR && !okL) this.dominant = 'right';
    else if (!okL && !okR) this.dominant = null;
    else this.dominant = this.snr.left >= this.snr.right ? 'left' : 'right';
  }

  /** Vista aggregata solo per l'interfaccia: NON usata per decidere i gesti. */
  _fusedView(eyes) {
    const d = this.dominant;
    if (!d || !eyes[d] || eyes[d].blink) {
      const alt = d === 'left' ? 'right' : 'left';
      if (eyes[alt] && !eyes[alt].blink) return { ...eyes[alt], eye: alt };
      return null;
    }
    return { ...eyes[d], eye: d };
  }

  /* --------------- Valutazione, per occhio e per direzione --------------- */

  _evaluate(t, out, wakeOnly) {
    const g = this.cfg.gestures;
    const s = this.cfg.signal;
    /* Si valutano SEMPRE entrambi gli occhi: ciascuno deve proteggere
     * la propria taratura, anche quando non è lui a comandare.
     * L'emissione resta riservata a quelli in gioco. */
    const inGioco = this._eyesInPlay();

    /* ── Canale combinato ──
     * Un solo movimento produce spesso più segnali insieme. Sommandoli
     * il rapporto segnale-rumore migliora della radice del numero di
     * canali: due danno +41%, tre +73%. */
    this._valutaCombinato(t, g, inGioco, out);

    for (const eye of ['left', 'right']) {
      for (const c of DIR_CHECKS) {
        const keys = c.keys.filter(k => g[k]?.enabled);
        if (!keys.length) continue;
        const A = this.eyes[eye][c.axis];
        if (!A.valid) continue;

        const chiave = c.sign < 0 ? '-1' : '+1';
        const hyst = A.hyst[chiave];
        const disp = this.guadagnoDi(c.id) * this.guadagnoOcchio(eye) * c.sign * A.disp;

        /**
         * ⚠️ RILASCIO D'UFFICIO DOPO UN AGGANCIO TROPPO LUNGO.
         *
         * Se l'occhio non torna del tutto alla posizione di riposo — e
         * ripetendo lo stesso movimento in fretta succede — il segnale
         * non scende mai sotto la soglia di rilascio. Il gesto non
         * "finisce" mai: resta agganciato, la baseline resta congelata,
         * e nessun gesto successivo può più essere riconosciuto.
         *
         * Il programma diventerebbe muto senza che nulla lo spieghi.
         * Oltre il tempo massimo si rilascia d'ufficio: NESSUN evento
         * viene emesso (non si sa cosa sia stato), ma la baseline
         * riprende ad adattarsi alla nuova posizione di riposo e il
         * rilevamento riparte da solo.
         */
        const maxAggancio = s.maxLatchMs || 0;
        if (maxAggancio > 0 && hyst.active) {
          const da = t - (A.tRise[chiave] || t);
          if (da > maxAggancio) {
            hyst.active = false;
            A.activeDir = 0;
            /* ⚠️ Si RILASCIA soltanto, senza spostare la baseline.
             *
             * Spostarla sembrava sensato — recupero più rapido — ma
             * fa un danno grave: se la persona sta semplicemente
             * TENENDO l'occhio alzato, quella posizione diventa il
             * nuovo zero e il gesto sparisce. E ripetendosi, ogni
             * scadenza sposta ancora, fino a rendere il programma
             * cieco proprio a chi usa gesti lunghi e decisi.
             *
             * Senza spostamento, la baseline si adatta da sola con la
             * sua costante di tempo: più lenta, ma non distrugge mai
             * la taratura. E se la persona torna davvero al riposo, ci
             * arriva senza che nessuno la spinga. */
            this._congelaAsse(eye, c.axis, false);
            /* ⚠️ Dopo un rilascio d'ufficio si SOSPENDE la protezione
             * finché il segnale non torna a riposo almeno una volta.
             *
             * Senza, il canale si riagganciava al fotogramma dopo — il
             * segnale è ancora alto — e la baseline restava congelata
             * per sempre: una deriva vera, come la telecamera urtata,
             * non veniva mai seguita e il programma non tornava più a
             * posto.
             *
             * Il senso è: "sei fermo lassù da troppo tempo, smetto di
             * proteggerti finché non torni giù". */
            A._nonProteggere = true;
            this.counters.latchReleased = (this.counters.latchReleased || 0) + 1;
            out.candidates.push({ eye, axis: c.axis, sign: c.sign, phase: 'timeout', durMs: da, t });
            continue;
          }
        }

        const trans = hyst.update(disp, A.sigma);

        if (trans === 'rise') {
          A.tRise[c.sign < 0 ? '-1' : '+1'] = t;
          A.activeDir = c.sign;
          // Congela la baseline DI QUESTO OCCHIO: se si aggiornasse
          // durante il gesto lo inseguirebbe e lo cancellerebbe.
          if (s.baselineFreezeDuringGesture) this._congelaAsse(eye, c.axis, true);
          out.candidates.push({ eye, axis: c.axis, sign: c.sign, phase: 'rise', t });
        } else if (trans === 'fall') {
          const dur = t - A.tRise[c.sign < 0 ? '-1' : '+1'];
          A.activeDir = 0;
          this._congelaAsse(eye, c.axis, false);
          out.candidates.push({ eye, axis: c.axis, sign: c.sign, phase: 'fall', durMs: dur, t });
          /* ⚠️ Solo gli occhi IN GIOCO emettono un comando.
           *
           * Ma TUTTI E DUE arrivano fin qui, perché ciascuno deve
           * poter proteggere la propria baseline e la propria stima
           * del rumore. Prima l'occhio non in gioco non veniva
           * nemmeno valutato: la sua taratura si rovinava di nascosto,
           * e quando il programma cambiava occhio dominante si
           * ritrovava a lavorare con uno strumento starato. */
          if (inGioco.includes(eye)) this._resolve(t, eye, c, dur, keys, wakeOnly, out);
        }
      }
    }
  }

  /** Occhi che possono generare eventi, secondo la politica di fusione. */
  _eyesInPlay() {
    const act = this.cfg.detection.activeEye;
    if (act === 'left') return ['left'];
    if (act === 'right') return ['right'];
    const mode = this.cfg.signal.eyeFusion;
    if (mode === 'left') return ['left'];
    if (mode === 'right') return ['right'];
    if (mode === 'best') return this.dominant ? [this.dominant] : [];
    return ['left', 'right'];        // 'any' e 'both'
  }

  /**
   * Politica di combinazione fra i due occhi, applicata sugli EVENTI.
   *   any  → basta un occhio. È il default: funziona anche se l'altro
   *          è chiuso, non rilevato o inutilizzabile.
   *   both → servono entrambi entro una finestra breve. Riduce i falsi
   *          positivi per chi muove gli occhi in modo coniugato, ma si
   *          blocca se un occhio non viene rilevato.
   *   best → solo l'occhio con il segnale migliore.
   */
  _resolve(t, eye, c, durMs, keys, wakeOnly, out) {
    const mode = this.cfg.signal.eyeFusion;
    const act = this.cfg.detection.activeEye;
    const dual = act === 'both' && (mode === 'both');

    if (dual) {
      const other = eye === 'left' ? 'right' : 'left';
      const key = `${c.axis}${c.sign}`;
      this._pending = this._pending || {};
      const p = this._pending[key];
      if (p && p.eye === other && (t - p.t) < this.cfg.signal.dualWindowMs) {
        delete this._pending[key];
        this._emitForDuration(t, keys, Math.max(durMs, p.durMs), wakeOnly, out, 'both');
        return;
      }
      this._pending[key] = { eye, t, durMs };
      this.counters.awaitingSecondEye = (this.counters.awaitingSecondEye || 0) + 1;
      return;
    }
    this._emitForDuration(t, keys, durMs, wakeOnly, out, eye);
  }

  /**
   * Sceglie il canale in base alla DURATA. Stesso movimento, durate
   * diverse: SELECT 400 ms, UNDO 2200 ms, WAKE 3400 ms.
   */
  _emitForDuration(t, keys, durMs, wakeOnly, out, eye) {
    const g = this.cfg.gestures;
    let chosen = null;
    for (const k of keys) {
      const c = g[k];
      if (durMs >= c.dwellMs && durMs < c.maxMs) { chosen = { key: k, cfg: c }; break; }
    }
    out.gestureEnd = { durMs, matched: chosen?.key || null, eye };
    if (!chosen) {
      this.counters.rejected++;
      this.counters.lastRejectReason = `durata ${Math.round(durMs)} ms fuori da ogni finestra`;
      return;
    }
    // In pausa possono uscire SOLO i comandi che risvegliano: tutto il
    // resto resterebbe senza effetto e rischierebbe di confondere.
    if (wakeOnly && chosen.cfg.action !== 'WAKE' && chosen.cfg.action !== 'TOGGLE_PAUSE') return;
    this._emit(t, chosen.key, chosen.cfg.action, { durMs, eye });
  }


  /* --------------- Valutazione dei canali direzionali --------------- */



  /**
   * Conta gli ammiccamenti, un occhio alla volta.
   * @param chiuso { left, right } — `null` = stato ignoto, l'impulso in
   *        corso NON viene chiuso: un campione scartato non è un occhio
   *        che si riapre.
   * @returns le raffiche completate in questo fotogramma, per occhio
   */
  _contaBlink(t, chiuso, sostenuto) {
    // Un abbassamento sostenuto non è un ammiccamento: si annulla
    // l'impulso in corso, ma solo sul FRONTE, altrimenti un occhio
    // stabilmente nella fascia ambigua azzererebbe tutto a ogni
    // fotogramma.
    if (sostenuto && !this._sostenutoPrec) {
      this.counters.burstAborted++;
      for (const eye of ['left', 'right']) this.burst[eye].annulla();
    }
    this._sostenutoPrec = sostenuto;

    const fatte = {};
    for (const eye of ['left', 'right']) {
      if (chiuso[eye] === null) continue;          // stato ignoto: non si tocca
      const r = this.burst[eye].update(t, chiuso[eye]);
      if (r) fatte[eye] = r;
      const st = this.burst[eye].stats;
      const S = eye === 'left' ? 'Left' : 'Right';
      this.counters[`blinkSingle${S}`] = st.single;
      this.counters[`blinkDouble${S}`] = st.double;
      this.counters[`blinkTriple${S}`] = st.triple;
      this.counters[`blinkShort${S}`] = st.rejectedShort;
      this.counters[`blinkLong${S}`] = st.rejectedLong;
    }

    // Totali: il MASSIMO fra i due occhi, non la somma. Un ammiccamento
    // normale è bilaterale, e sommarlo lo conterebbe due volte.
    const B = this.burst;
    this.counters.blinkSingle = Math.max(B.left.stats.single, B.right.stats.single);
    this.counters.blinkDouble = Math.max(B.left.stats.double, B.right.stats.double);
    this.counters.blinkTriple = Math.max(B.left.stats.triple, B.right.stats.triple);
    this.counters.blinkRejectedShort = Math.max(B.left.stats.rejectedShort, B.right.stats.rejectedShort);
    this.counters.blinkRejectedLong = Math.max(B.left.stats.rejectedLong, B.right.stats.rejectedLong);
    return fatte;
  }

  /**
   * Valuta i canali del viso, con la stessa isteresi e la stessa
   * logica di durata dei canali oculari.
   */
  _valutaEspressioni(t, out, soloRisveglio) {
    if (!this.cfg.detection?.faceChannels) return;
    const s = this.cfg.signal;
    const g = this.cfg.gestures;
    for (const E of EXPR_CHECKS) {
      const A = this.espr[E.id];
      if (!A?.valid) continue;
      const cfgCanale = g[E.key];
      const hyst = A.hyst['+1'];
      const disp = this.guadagnoEspr(E.id) * A.disp;
      hyst.onK = this.sogliaEspr(E.id);
      hyst.offK = this.sogliaEspr(E.id) * (s.thresholdOff / s.thresholdOn);

      // Rilascio d'ufficio, come per gli occhi: un'espressione tenuta
      // troppo a lungo non deve bloccare il canale per sempre.
      const maxAgg = s.maxLatchMs || 0;
      if (maxAgg > 0 && hyst.active && t - (A.tRise['+1'] || t) > maxAgg) {
        hyst.active = false;
        A.base.riancora(A.smooth);
        this.counters.latchReleased = (this.counters.latchReleased || 0) + 1;
        continue;
      }

      const trans = hyst.update(disp, A.sigma);
      if (trans === 'rise') {
        A.tRise['+1'] = t;
        if (s.baselineFreezeDuringGesture) A.base.freeze();
        out.candidates.push({ espressione: E.id, phase: 'rise', t });
      } else if (trans === 'fall') {
        const durMs = t - (A.tRise['+1'] || t);
        A.base.release();
        out.candidates.push({ espressione: E.id, phase: 'fall', durMs, t });
        // Emissione: solo a canale acceso, non in pausa (salvo
        // risveglio) e non mentre si sta dettando a voce.
        if (!cfgCanale?.enabled) continue;
        if (this.visoSospeso) { this.counters.visoSoppressi = (this.counters.visoSoppressi || 0) + 1; continue; }
        if (soloRisveglio && cfgCanale.action !== 'WAKE' && cfgCanale.action !== 'TOGGLE_PAUSE') continue;
        const dwell = cfgCanale.dwellMs ?? 600;
        const max = cfgCanale.maxMs ?? 6000;
        if (durMs < dwell) { this.counters.rejected++; this.counters.lastRejectReason = 'troppo breve'; continue; }
        if (durMs > max) { this.counters.rejected++; this.counters.lastRejectReason = 'troppo lungo'; continue; }
        this._emit(t, E.key, cfgCanale.action, { durMs, espressione: E.id });
      }
    }
  }

  /** Emette l'evento corrispondente, se un canale lo prevede. */
  _emettiBlink(t, fatte) {
    if (!fatte || !this._blinkEnabled()) return;
    const inGioco = this._eyesInPlay();
    // Un ammiccamento bilaterale completa su entrambi gli occhi a
    // pochi millisecondi di distanza: si emette una volta sola.
    for (const eye of inGioco) {
      const r = fatte[eye];
      if (!r) continue;
      if (t - this.tUltimaRaffica < (this.cfg.gestures.blinkBurstMs || 500)) return;
      this.tUltimaRaffica = t;
      const g = this.cfg.gestures;
      const map = { 1: 'BLINK', 2: 'DOUBLE_BLINK', 3: 'TRIPLE_BLINK' };
      const key = map[Math.min(3, r.count)];
      if (key && g[key]?.enabled) this._emit(t, key, g[key].action, { count: r.count, eye });
      return;
    }
  }


  _emit(t, channel, action, meta) {
    if (action === 'NONE') return;
    if (t - this.lastEventAt < this.cfg.gestures.refractoryMs) {
      this.counters.rejected++;
      this.counters.lastRejectReason = 'periodo refrattario';
      return;
    }
    this.lastEventAt = t;
    this.counters.gestures[channel] = (this.counters.gestures[channel] || 0) + 1;
    this.onEvent({ t, channel, action, ...meta });
  }

  /** Input da tastiera (modalità debug): entra dalla stessa porta dei gesti. */
  injectKey(action, meta = {}) {
    this.counters.gestures['KEY'] = (this.counters.gestures['KEY'] || 0) + 1;
    this.onEvent({ t: performance.now(), channel: 'KEY', action, ...meta });
  }

  setPaused(p) { this.paused = p; }
  setDiagnostics(on) { this.diagnostics = on; }

  /* ------------------- Calibrazione dei movimenti ------------------- *
   * Misura l'escursione REALE di ciascuna direzione su questa persona,
   * e ne ricava un guadagno che le renda tutte ugualmente raggiungibili.
   *
   * È la risposta al problema di fondo: "su" arriva a 12σ e "giù" a 3σ
   * non perché il codice sia sbilanciato — l'ho verificato, è simmetrico
   * — ma perché il movimento fisico è diverso. Un guadagno per direzione
   * corregge esattamente questo, e solo per la persona che lo ha
   * misurato.
   * ------------------------------------------------------------------ */

  /** Avvia la misura di una direzione. Non emette gesti nel frattempo. */
  iniziaMisura(dirId) {
    this.misura = { dirId, picco: 0, campioni: 0 };
  }

  /** @returns {{dirId,picco,campioni}|null} */
  fermaMisura() {
    const m = this.misura;
    this.misura = null;
    return m;
  }

  get inMisura() { return !!this.misura; }

  _aggiornaMisura() {
    const m = this.misura;
    if (!m) return;
    const eye = this.dominant || 'left';
    const d = DIR_CHECKS.find(x => x.id === m.dirId);
    if (!d) return;
    const A = this.eyes[eye][d.axis];
    if (!A?.valid) return;
    // Si misura SENZA guadagno: serve l'escursione grezza in sigma.
    const n = A.n(d.sign, 1);
    if (n > m.picco) m.picco = n;
    m.campioni++;
  }

  /**
   * Fotografia completa per la diagnostica: ogni occhio, ogni asse,
   * ogni direzione. È ciò che permette al grafico di mostrare canali
   * separati invece di un solo segnale già fuso.
   */
  channels() {
    const outs = {};
    // Il combinato si aggiunge in coda, così è visibile in diagnostica
    // e tracciabile nel grafico come ogni altro canale.
    if (this._comboN) {
      for (const eye of ['left', 'right']) {
        if (this._comboN[eye] == null) continue;
        outs[`${eye}.combo`] = {
          n: this._comboN[eye], nRaw: this._comboN[eye],
          soglia: this.sogliaDi('combo') ?? this.cfg.signal.thresholdOn,
          guadagno: 1, active: !!this._combo?.[eye]?.active,
          sigma: 1, baseline: 0,
        };
      }
    }
    for (const eye of ['left', 'right']) {
      for (const d of DIR_CHECKS) {
        const A = this.eyes[eye][d.axis];
        const g = this.guadagnoDi(d.id) * this.guadagnoOcchio(eye);
        outs[`${eye}.${d.id}`] = A.valid ? {
          n: A.n(d.sign, g),
          nRaw: (g * d.sign * (A.raw - A.baseline)) / Math.max(1e-6, A.sigma),
          soglia: this.sogliaDi(d.id), guadagno: g,
          active: A.hyst[d.sign < 0 ? '-1' : '+1'].active,
          sigma: A.sigma, baseline: A.baseline,
        } : null;
      }
      outs[`${eye}.blink`] = {
        closed: !this.eyes[eye].y.valid,
        openRef: this.blink[eye].openRef,
        threshold: this.blink[eye].threshold,
      };
    }
    // Canali del viso: presenti solo se attivi, così il grafico non si
    // riempie di tracce vuote per chi non li usa.
    if (this.cfg.detection?.faceChannels) {
      for (const E of EXPR_CHECKS) {
        const A = this.espr[E.id];
        const gg = this.guadagnoEspr(E.id);
        outs[`expr.${E.id}`] = A?.valid ? {
          n: (gg * A.disp) / Math.max(1e-6, A.sigma),
          nRaw: (gg * (A.raw - A.baseline)) / Math.max(1e-6, A.sigma),
          soglia: this.sogliaEspr(E.id), guadagno: gg,
          active: A.hyst['+1'].active,
          sigma: A.sigma, baseline: A.baseline, grezzo: A.raw,
        } : null;
      }
    }
    return outs;
  }
}
