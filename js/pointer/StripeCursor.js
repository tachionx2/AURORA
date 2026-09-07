/**
 * StripeCursor.js — Puntamento con UN SOLO gesto.
 *
 * Questa è la modalità che serve a chi non ha controllo oculare su due
 * assi: la stessa persona che usa la scansione uditiva può comunque
 * raggiungere qualunque punto dello schermo.
 *
 * Meccanismo, a raffinamento progressivo:
 *   1. una banda VERTICALE scorre da sinistra a destra → un gesto la
 *      ferma e fissa la coordinata X;
 *   2. una banda ORIZZONTALE scorre dall'alto in basso → un gesto la
 *      ferma e fissa la coordinata Y;
 *   3. click.
 *
 * Con `passes: 2` ogni asse viene ripetuto su un intervallo ristretto
 * attorno alla prima scelta: due gesti in più, ma precisione al pixel
 * invece che alla banda. È il compromesso da regolare in base a quanto
 * sono affidabili i gesti della persona.
 *
 * Costo: 2 gesti (una passata) o 4 gesti (due passate) per un punto
 * qualsiasi, contro i 2 del puntatore a sguardo. Sorprendentemente
 * competitivo, e non richiede nessuna calibrazione.
 */

export const StripePhase = {
  IDLE: 'idle',
  X: 'x',
  Y: 'y',
  DONE: 'done',
};

export class StripeCursor {
  constructor(cfg, onEvent) {
    this.cfg = cfg;
    this.onEvent = onEvent;
    this.phase = StripePhase.IDLE;
    this.viewport = { w: 1, h: 1 };
    this.pass = 0;
    this.range = { x0: 0, x1: 1, y0: 0, y1: 1 };
    this.pos = { x: 0.5, y: 0.5 };
    this.sweepStart = 0;
    this.direction = 1;
    this.counters = { clicks: 0, cancels: 0, sweeps: 0 };
  }

  updateConfig(cfg) { this.cfg = cfg; }
  setViewport(w, h) { this.viewport = { w, h }; }

  get active() { return this.phase !== StripePhase.IDLE && this.phase !== StripePhase.DONE; }

  start(now) {
    this.phase = StripePhase.X;
    this.pass = 0;
    this.range = { x0: 0, x1: 1, y0: 0, y1: 1 };
    this.sweepStart = now;
    this.direction = 1;
    this._notify();
  }

  cancel() {
    this.phase = StripePhase.IDLE;
    this.counters.cancels++;
    this._notify();
  }

  /** Posizione corrente della banda, in frazioni di schermo. */
  tick(now) {
    if (!this.active) return;
    const dur = Math.max(300, this.cfg.pointer.stripeSpeedMs);
    const elapsed = now - this.sweepStart;
    let f = (elapsed % dur) / dur;
    // Scorrimento avanti-indietro: un solo verso costringerebbe ad
    // aspettare un intero ciclo dopo ogni bersaglio mancato.
    const cycle = Math.floor(elapsed / dur);
    if (cycle % 2 === 1) f = 1 - f;
    if (cycle > 0 && cycle % 2 === 0 && this._lastCycle !== cycle) {
      this._lastCycle = cycle;
      this.counters.sweeps++;
      // Dopo un numero di passate a vuoto si esce da solo, invece di
      // lasciare la banda a scorrere all'infinito.
      if (this.counters.sweeps > (this.cfg.pointer.stripeMaxSweeps || 4)) { this.cancel(); return; }
    }

    if (this.phase === StripePhase.X) {
      this.pos.x = this.range.x0 + f * (this.range.x1 - this.range.x0);
    } else if (this.phase === StripePhase.Y) {
      this.pos.y = this.range.y0 + f * (this.range.y1 - this.range.y0);
    }
    this._notify();
  }

  /** Un gesto: ferma la banda corrente e passa alla fase successiva. */
  select(now) {
    if (!this.active) { this.start(now); return null; }
    const passes = Math.max(1, this.cfg.pointer.stripePasses || 2);
    this.counters.sweeps = 0;
    this._lastCycle = -1;

    if (this.phase === StripePhase.X) {
      if (this.pass < passes - 1 && this._narrowX()) {
        // Stessa fase, intervallo ristretto: seconda passata più fine.
        this.sweepStart = now;
        this._notify();
        return null;
      }
      this.phase = StripePhase.Y;
      this.pass = 0;
      this.sweepStart = now;
      this._notify();
      return null;
    }

    if (this.phase === StripePhase.Y) {
      if (this.pass < passes - 1 && this._narrowY()) {
        this.sweepStart = now;
        this._notify();
        return null;
      }
      this.phase = StripePhase.DONE;
      this.counters.clicks++;
      const e = {
        type: 'click',
        x: this.pos.x * this.viewport.w,
        y: this.pos.y * this.viewport.h,
        t: now,
      };
      this.onEvent?.(e);
      // Riparte subito: chi ha un solo gesto non deve doverlo riattivare.
      this.phase = StripePhase.X;
      this.pass = 0;
      this.range = { x0: 0, x1: 1, y0: 0, y1: 1 };
      this.sweepStart = now;
      this._notify();
      return e;
    }
    return null;
  }

  _narrowX() {
    const half = (this.range.x1 - this.range.x0) * 0.15;
    this.range.x0 = Math.max(0, this.pos.x - half);
    this.range.x1 = Math.min(1, this.pos.x + half);
    this.pass++;
    return true;
  }

  _narrowY() {
    const half = (this.range.y1 - this.range.y0) * 0.15;
    this.range.y0 = Math.max(0, this.pos.y - half);
    this.range.y1 = Math.min(1, this.pos.y + half);
    this.pass++;
    return true;
  }

  /** Stato per il disegno dell'overlay. */
  snapshot() {
    return {
      phase: this.phase, pass: this.pass,
      x: this.pos.x, y: this.pos.y,
      range: { ...this.range },
      active: this.active,
    };
  }

  _notify() { this.onEvent?.({ type: 'stripe', snapshot: this.snapshot() }); }
}
