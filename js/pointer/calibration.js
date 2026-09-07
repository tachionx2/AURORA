/**
 * calibration.js — Mappatura sguardo → schermo.
 *
 * Il tracker fornisce la posizione dell'occhio normalizzata sulla
 * larghezza dell'occhio stesso (ex, ey). Serve trasformarla in
 * coordinate di schermo (sx, sy).
 *
 * La relazione NON è lineare: la superficie dell'occhio è curva, la
 * telecamera introduce distorsione prospettica e lo schermo è piano.
 * Si usa quindi una regressione polinomiale di secondo grado, che è lo
 * standard nell'eye tracking a bassa complessità:
 *
 *   sx = a0 + a1·ex + a2·ey + a3·ex² + a4·ey² + a5·ex·ey
 *
 * Con 5 punti di calibrazione si usa il modello bilineare (4 termini),
 * con 9 o 13 il polinomio completo (6 termini). Servono sempre almeno
 * tanti punti quanti sono i termini, meglio se di più.
 *
 * Nessuna dipendenza esterna: i minimi quadrati si risolvono con le
 * equazioni normali e l'eliminazione di Gauss su una matrice 6×6.
 */

/** Termini del modello per un campione. */
function terms(ex, ey, full) {
  return full
    ? [1, ex, ey, ex * ex, ey * ey, ex * ey]
    : [1, ex, ey, ex * ey];
}

/**
 * Risolve A·x = b con eliminazione di Gauss e pivoting parziale.
 * @returns {number[]|null} null se la matrice è singolare (punti degeneri)
 */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Minimi quadrati tramite equazioni normali: (AᵀA)·x = Aᵀb */
function leastSquares(rows, targets) {
  const k = rows[0].length;
  const ATA = Array.from({ length: k }, () => new Array(k).fill(0));
  const ATb = new Array(k).fill(0);
  for (let s = 0; s < rows.length; s++) {
    const r = rows[s], t = targets[s];
    for (let i = 0; i < k; i++) {
      ATb[i] += r[i] * t;
      for (let j = 0; j < k; j++) ATA[i][j] += r[i] * r[j];
    }
  }
  // Regolarizzazione di Tikhonov molto leggera: stabilizza quando i
  // punti di calibrazione sono quasi allineati, cosa frequente con chi
  // ha escursione oculare ridotta.
  for (let i = 0; i < k; i++) ATA[i][i] += 1e-9;
  return solve(ATA, ATb);
}

export class GazeCalibration {
  constructor() {
    this.samples = [];      // { ex, ey, sx, sy }
    this.coefX = null;
    this.coefY = null;
    this.full = true;
    this.error = null;      // errore medio in px, dopo l'addestramento
    this.perPoint = [];     // errore residuo di ciascun bersaglio
    this.ready = false;
    // Correzione di deriva: scostamento costante applicato dopo la
    // trasformazione. La testa si sposta, la montatura scivola, il
    // braccio del letto viene urtato — dopo qualche ora il puntatore
    // è sistematicamente spostato di qualche centimetro. Ricalibrare
    // tutto sarebbe faticoso; qui basta guardare UN punto.
    this.offset = { x: 0, y: 0 };
    // Escursione minima accettabile fra i bersagli. Configurabile:
    // chi ha un controllo oculare ridotto ha escursioni piccole ma
    // ancora utilizzabili, e una soglia fissa lo escluderebbe.
    this.minSpan = 0.02;
  }

  reset() {
    this.samples.length = 0;
    this.coefX = this.coefY = null;
    this.ready = false;
    this.error = null;
    this.perPoint = [];
    this.offset = { x: 0, y: 0 };
  }

  /** Aggiunge un campione: sguardo osservato ↔ punto guardato. */
  add(ex, ey, sx, sy) {
    if (![ex, ey, sx, sy].every(Number.isFinite)) return false;
    this.samples.push({ ex, ey, sx, sy });
    return true;
  }

  get count() { return this.samples.length; }

  /**
   * Calcola la trasformazione.
   * @returns {{ok:boolean, error?:number, reason?:string}}
   */
  fit() {
    const n = this.samples.length;
    if (n < 4) return { ok: false, reason: 'servono almeno 4 punti' };

    // Controllo di degenerazione ESPLICITO.
    // La regolarizzazione rende la matrice sempre invertibile, quindi
    // senza questo controllo una calibrazione fatta con lo sguardo
    // fermo verrebbe accettata e produrrebbe un puntatore impazzito.
    // Meglio rifiutare e dirlo, che consegnare qualcosa di inutilizzabile.
    const xs = this.samples.map(s => s.ex), ys = this.samples.map(s => s.ey);
    const span = a => Math.max(...a) - Math.min(...a);
    const spanX = span(xs), spanY = span(ys);
    const min = this.minSpan ?? 0.02;
    if (spanX < min && spanY < min) {
      return { ok: false, spanX, spanY,
        reason: 'lo sguardo non è cambiato fra i bersagli: verifica che la telecamera veda gli occhi e che la persona guardi davvero i punti' };
    }
    if (spanX < min || spanY < min) {
      return { ok: false, spanX, spanY, reason: spanX < min
        ? 'movimento orizzontale troppo piccolo per il puntatore a due assi'
        : 'movimento verticale troppo piccolo per il puntatore a due assi' };
    }
    this.full = n >= 6;
    const rows = this.samples.map(s => terms(s.ex, s.ey, this.full));
    const cx = leastSquares(rows, this.samples.map(s => s.sx));
    const cy = leastSquares(rows, this.samples.map(s => s.sy));
    if (!cx || !cy) return { ok: false, reason: 'punti degeneri: lo sguardo non è cambiato abbastanza fra i bersagli' };
    this.coefX = cx; this.coefY = cy;
    this.ready = true;

    // Errore residuo, medio e per singolo bersaglio.
    // Il dettaglio per punto è ciò che rende la calibrazione
    // riparabile: se un solo angolo è sbagliato si ripete quello,
    // invece di rifare tutto da capo.
    this.offset = { x: 0, y: 0 };
    let sum = 0;
    this.perPoint = this.samples.map((s, i) => {
      const p = this.map(s.ex, s.ey);
      const e = Math.hypot(p.x - s.sx, p.y - s.sy);
      sum += e;
      return { index: i, error: e, sx: s.sx, sy: s.sy };
    });
    this.error = sum / n;
    const worst = this.perPoint.reduce((a, b) => (b.error > a.error ? b : a));
    return { ok: true, error: this.error, worst };
  }

  /** @returns {{x:number,y:number}|null} */
  map(ex, ey) {
    if (!this.ready) return null;
    const t = terms(ex, ey, this.full);
    let x = 0, y = 0;
    for (let i = 0; i < t.length; i++) { x += t[i] * this.coefX[i]; y += t[i] * this.coefY[i]; }
    return { x: x + this.offset.x, y: y + this.offset.y };
  }

  /**
   * Ricentratura a UN punto: la persona guarda un bersaglio noto e la
   * differenza diventa uno scostamento costante. Dieci secondi invece
   * di due minuti, e recupera la deriva che è di gran lunga la causa
   * più frequente di peggioramento nel corso della giornata.
   * @returns {{ok:boolean, shift?:number, reason?:string}}
   */
  recenter(ex, ey, sx, sy, maxShiftPx = 400) {
    if (!this.ready) return { ok: false, reason: 'nessuna calibrazione da correggere' };
    const t = terms(ex, ey, this.full);
    let x = 0, y = 0;
    for (let i = 0; i < t.length; i++) { x += t[i] * this.coefX[i]; y += t[i] * this.coefY[i]; }
    const dx = sx - x, dy = sy - y;
    const shift = Math.hypot(dx, dy);
    // Uno scostamento enorme non è deriva: è una calibrazione da
    // rifare, o la persona non stava guardando il bersaglio.
    if (shift > maxShiftPx) {
      return { ok: false, shift, reason: 'scostamento troppo grande: serve una calibrazione completa' };
    }
    this.offset = { x: dx, y: dy };
    return { ok: true, shift };
  }

  /**
   * Verifica su bersagli NON usati per la calibrazione. È l'unica
   * misura onesta della precisione: l'errore residuo sui punti di
   * addestramento è sempre ottimistico.
   */
  validate(checks) {
    if (!this.ready || !checks?.length) return null;
    let sum = 0, worst = 0;
    for (const c of checks) {
      const p = this.map(c.ex, c.ey);
      const e = Math.hypot(p.x - c.sx, p.y - c.sy);
      sum += e; worst = Math.max(worst, e);
    }
    return { mean: sum / checks.length, worst, count: checks.length };
  }

  serialize() {
    return {
      samples: this.samples, coefX: this.coefX, coefY: this.coefY,
      full: this.full, error: this.error, offset: this.offset, perPoint: this.perPoint,
    };
  }

  load(data) {
    if (!data?.coefX || !data?.coefY) return false;
    this.samples = data.samples || [];
    this.coefX = data.coefX; this.coefY = data.coefY;
    this.full = !!data.full; this.error = data.error ?? null;
    this.offset = data.offset || { x: 0, y: 0 };
    this.perPoint = data.perPoint || [];
    this.ready = true;
    return true;
  }
}

/**
 * Disposizione dei bersagli di calibrazione, in frazioni di schermo.
 * Il margine tiene i punti lontani dai bordi: guardare esattamente
 * l'angolo è scomodo e produce campioni rumorosi.
 */
export function calibrationTargets(count, margin = 0.12) {
  const a = margin, b = 0.5, c = 1 - margin;
  const grid3 = [[a,a],[b,a],[c,a],[a,b],[b,b],[c,b],[a,c],[b,c],[c,c]];
  switch (count) {
    case 5:  return [[b,b],[a,a],[c,a],[a,c],[c,c]].map(([x,y]) => ({ x, y }));
    case 13: return [...grid3, [0.3,0.3],[0.7,0.3],[0.3,0.7],[0.7,0.7]].map(([x,y]) => ({ x, y }));
    default: return grid3.map(([x,y]) => ({ x, y }));
  }
}
