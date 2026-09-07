/**
 * GazePointer.js — Puntatore controllato dallo sguardo.
 *
 * Trasforma il segnale oculare in una posizione sullo schermo e in
 * eventi di click. Serve chi ha controllo oculare su DUE assi.
 *
 * Chi ha un solo gesto usa invece StripeCursor: stesso risultato
 * (raggiungere un punto qualsiasi), meccanismo completamente diverso.
 *
 * Il click avviene per permanenza (dwell): si resta fermi su un
 * bersaglio e dopo un tempo configurabile scatta il click. È l'unico
 * metodo praticabile quando non esiste un pulsante fisico, ma ha un
 * difetto noto — il "click di Mida": si clicca anche solo guardando.
 * Le contromisure sono tre e sono tutte configurabili:
 *   1. raggio di tolleranza: uscire dal raggio annulla il conteggio;
 *   2. zona morta: sotto una certa velocità il puntatore non si muove,
 *      così il tremore non fa perdere il bersaglio;
 *   3. periodo refrattario dopo ogni click.
 */

export const PointerState = {
  IDLE: 'idle',
  MOVING: 'moving',
  DWELLING: 'dwelling',
  CLICKED: 'clicked',
};

export class GazePointer {
  /**
   * @param cfg configurazione completa
   * @param onEvent (evt) => void — { type:'move'|'click'|'dblclick'|'hold', x, y }
   */
  constructor(cfg, onEvent) {
    this.cfg = cfg;
    this.onEvent = onEvent;
    this.calib = null;              // istanza GazeCalibration
    this.raw = { x: 0, y: 0 };
    this.pos = { x: 0, y: 0 };
    this.state = PointerState.IDLE;
    this.anchor = null;             // punto di inizio permanenza
    this.dwellStart = 0;
    this.lastClickAt = 0;
    this.lastClickPos = null;
    this.lastEmitAt = 0;
    this.enabled = false;
    this.viewport = { w: 1, h: 1 };
    this.counters = { moves: 0, clicks: 0, dblclicks: 0, holds: 0, aborted: 0 };
  }

  updateConfig(cfg) { this.cfg = cfg; }
  setCalibration(c) { this.calib = c; }
  setViewport(w, h) { this.viewport = { w, h }; }
  setEnabled(on) {
    this.enabled = on;
    if (!on) { this.state = PointerState.IDLE; this.anchor = null; }
  }

  /** Percentuale di completamento della permanenza, per l'anello grafico. */
  get dwellProgress() {
    if (this.state !== PointerState.DWELLING) return 0;
    const d = this.cfg.pointer.dwellClickMs;
    return Math.min(1, (this._now - this.dwellStart) / Math.max(1, d));
  }

  /**
   * @param t timestamp ms
   * @param eye { x, y } segnale normalizzato dell'occhio dominante
   */
  update(t, eye) {
    this._now = t;
    if (!this.enabled || !eye || !this.calib?.ready) return null;

    const p = this.calib.map(eye.x, eye.y);
    if (!p) return null;

    // Limita ai bordi: fuori schermo il puntatore sarebbe irraggiungibile.
    this.raw.x = Math.max(0, Math.min(this.viewport.w, p.x));
    this.raw.y = Math.max(0, Math.min(this.viewport.h, p.y));

    // --- Smorzamento esponenziale -------------------------------------
    // Non è cosmetico: il nistagmo e il micro-tremore renderebbero il
    // puntatore inutilizzabile. Più alto = più stabile ma più lento a
    // raggiungere un nuovo bersaglio.
    const a = 1 - Math.max(0, Math.min(0.98, this.cfg.pointer.smoothing));
    this.pos.x += a * (this.raw.x - this.pos.x);
    this.pos.y += a * (this.raw.y - this.pos.y);

    return this._advance(t);
  }

  _advance(t) {
    const P = this.cfg.pointer;
    const radius = P.dwellRadiusPx || 60;

    if (!this.anchor) {
      this.anchor = { x: this.pos.x, y: this.pos.y };
      this.dwellStart = t;
      this.state = PointerState.DWELLING;
      return this._emit('move', t);
    }

    const dist = Math.hypot(this.pos.x - this.anchor.x, this.pos.y - this.anchor.y);

    if (dist > radius) {
      // Uscito dalla tolleranza: la permanenza riparte da capo.
      // Si conta come "annullata" solo se aveva superato un terzo del
      // percorso: è la metrica che serve per tarare il raggio e il
      // tempo, perché indica quante volte la persona stava per
      // cliccare e non ci è riuscita.
      const held = t - this.dwellStart;
      if (this.state === PointerState.DWELLING && held > 0.33 * P.dwellClickMs) {
        this.counters.aborted++;
      }
      this.anchor = { x: this.pos.x, y: this.pos.y };
      this.dwellStart = t;
      this.state = PointerState.MOVING;
      return this._emit('move', t);
    }

    if (this.state === PointerState.CLICKED) {
      if (t - this.lastClickAt < (P.refractoryMs || 500)) return this._emit('move', t);
      this.state = PointerState.DWELLING;
      this.dwellStart = t;
      return this._emit('move', t);
    }

    this.state = PointerState.DWELLING;
    const held = t - this.dwellStart;

    // Permanenza molto lunga → "hold" (click destro / trascinamento).
    if (P.holdMs > 0 && held >= P.holdMs) {
      this.state = PointerState.CLICKED;
      this.lastClickAt = t;
      this.counters.holds++;
      return this._fire('hold', t);
    }

    if (held >= P.dwellClickMs) {
      this.state = PointerState.CLICKED;
      this.lastClickAt = t;

      // Doppio click: seconda permanenza completata vicino alla prima,
      // entro la finestra configurata.
      const near = this.lastClickPos &&
        Math.hypot(this.pos.x - this.lastClickPos.x, this.pos.y - this.lastClickPos.y) < radius;
      const soon = this.lastClickPos && (t - this.lastClickPos.t) < (P.doubleWindowMs || 900);
      this.lastClickPos = { x: this.pos.x, y: this.pos.y, t };

      if (P.doubleClickEnabled && near && soon) {
        this.counters.dblclicks++;
        return this._fire('dblclick', t);
      }
      this.counters.clicks++;
      return this._fire('click', t);
    }

    return this._emit('move', t);
  }

  _emit(type, t) {
    // Il movimento si emette al massimo a 60 Hz: oltre è solo lavoro
    // sprecato per il disegno.
    if (type === 'move' && t - this.lastEmitAt < 16) return null;
    this.lastEmitAt = t;
    this.counters.moves++;
    const e = { type, x: this.pos.x, y: this.pos.y, t, dwell: this.dwellProgress };
    this.onEvent?.(e);
    return e;
  }

  _fire(type, t) {
    const e = { type, x: this.pos.x, y: this.pos.y, t, dwell: 1 };
    this.onEvent?.(e);
    return e;
  }
}
