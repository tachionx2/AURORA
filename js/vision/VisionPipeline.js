/**
 * VisionPipeline.js — Orchestrazione sorgente → tracker → osservazioni.
 *
 * Sceglie il tracker in base alla modalità e produce un flusso uniforme
 * di osservazioni normalizzate. Tutto ciò che sta a valle (filtri,
 * gesti, scansione) non sa e non deve sapere se il segnale viene da una
 * webcam in salotto o da un modulo IR a 940 nm montato su occhiali.
 *
 * È questo che rende il lavoro fatto adesso in RGB NON buttato quando
 * arriveranno i LED: cambia solo il modulo più in basso.
 */

import { createSource } from './FrameSource.js';
import { RgbTracker } from './RgbTracker.js';
import { IrTracker } from './IrTracker.js';

export class VisionPipeline {
  constructor(cfg, onObservation) {
    this.cfg = cfg;
    this.onObservation = onObservation;
    this.source = null;
    this.rgb = new RgbTracker(cfg);
    this.ir = new IrTracker(cfg);
    this.lastResult = null;
    this.lastFrame = null;
    this.fps = 0;
    this.procMs = 0;
    this._fpsAcc = []; this._lastT = 0;
    this.status = 'chiusa';
    this.error = null;
  }

  updateConfig(cfg) {
    this.cfg = cfg;
    this.rgb.updateConfig(cfg);
    this.ir.updateConfig(cfg);
  }

  async start(file = null) {
    await this.stop();
    this.error = null;
    this.status = 'apertura';
    try {
      if (this.cfg.detection.mode !== 'ir' && !this.rgb.ready) {
        this.status = 'caricamento modello';
        const ok = await this.rgb.init();
        if (!ok && this.cfg.detection.mode === 'rgb') {
          throw new Error('Modello MediaPipe non caricato. Serve una connessione al primo avvio.');
        }
      }
      this.source = createSource(this.cfg, file);
      this.source.onFrame = (src, t, info) => this._onFrame(src, t, info);
      const info = await this.source.open();
      this.status = 'attiva';
      return info;
    } catch (e) {
      this.error = e;
      this.status = 'errore';
      throw e;
    }
  }

  async stop() {
    if (this.source) { await this.source.close(); this.source = null; }
    this.status = 'chiusa';
  }

  _onFrame(src, tMs, info) {
    const t0 = performance.now();
    const w = info.width || src.videoWidth || src.width;
    const h = info.height || src.videoHeight || src.height;
    if (!w || !h) return;

    let res = { left: null, right: null, landmarks: null };
    const mode = this.cfg.detection.mode;

    try {
      if (mode === 'rgb') {
        res = this.rgb.detect(src, tMs, w, h);
      } else if (mode === 'ir') {
        res = this.ir.detect(src, w, h, null);
      } else {
        // auto / ibrido: MediaPipe individua le ROI degli occhi, il
        // tracker IR fa la misura fine dentro quelle ROI. È la
        // configurazione migliore per camera a distanza + illuminatore.
        const guide = this.rgb.ready ? this.rgb.detect(src, tMs, w, h) : null;
        const rois = guide ? { left: guide.left?.px.roi || null, right: guide.right?.px.roi || null } : null;
        res = this.ir.detect(src, w, h, rois);
        if (guide) {
          res.landmarks = guide.landmarks;
          // Anche in modalità ibrida le espressioni vengono dal
          // rilevatore in luce visibile: l'IR misura gli occhi, il viso
          // resta di competenza di MediaPipe.
          res.espressioni = guide.espressioni || null;
        }
      }
    } catch (e) {
      this.error = e;
    }

    this.lastFrame = { src, w, h };
    this.lastResult = res;
    this.procMs = performance.now() - t0;

    if (this._lastT) {
      this._fpsAcc.push(1000 / Math.max(1, tMs - this._lastT));
      if (this._fpsAcc.length > 30) this._fpsAcc.shift();
      this.fps = this._fpsAcc.reduce((a, b) => a + b, 0) / this._fpsAcc.length;
    }
    this._lastT = tMs;

    // ⚠️ Le espressioni del viso vanno inoltrate insieme agli occhi.
    // Costruendo l'osservazione con i soli due occhi venivano lette dal
    // rilevatore e poi buttate via qui, e i canali del viso non
    // potevano funzionare — senza alcun errore visibile.
    this.onObservation?.(tMs, {
      left: res.left, right: res.right,
      espressioni: res.espressioni || null,
    }, res);
  }
}

/* ------------------------------------------------------------------ *
 * Disegno diagnostico
 *
 * Non è un accessorio: senza il riscontro visivo di COSA il codice sta
 * vedendo, la taratura si fa alla cieca e non si capisce mai perché un
 * falso positivo sia avvenuto. Questa è la funzione che rende
 * scrivibile la guida di taratura.
 * ------------------------------------------------------------------ */

export function drawEyeDebug(canvas, frame, obs, side, cfg, colors) {
  if (!canvas || !frame) return;
  const ctx = canvas.getContext('2d');
  const o = obs?.[side];
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);

  if (!o || !o.px) {
    ctx.fillStyle = colors.muted;
    ctx.font = '13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('nessun rilevamento', W / 2, H / 2);
    return;
  }

  // Ritaglio della ROI, ingrandito per riempire il riquadro.
  const roi = o.px.roi || { x: o.px.iris.x - 60, y: o.px.iris.y - 40, w: 120, h: 80 };
  const sx = Math.max(0, roi.x), sy = Math.max(0, roi.y);
  const sw = Math.max(8, roi.w), sh = Math.max(8, roi.h);
  const scale = Math.min(W / sw, H / sh);
  const ox = (W - sw * scale) / 2, oy = (H - sh * scale) / 2;

  try { ctx.drawImage(frame.src, sx, sy, sw, sh, ox, oy, sw * scale, sh * scale); }
  catch { /* frame non ancora pronto */ }

  const TX = x => ox + (x - sx) * scale;
  const TY = y => oy + (y - sy) * scale;

  // Contorno ROI
  ctx.strokeStyle = colors.muted; ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(ox, oy, sw * scale, sh * scale);
  ctx.setLineDash([]);

  // Canti palpebrali (solo in RGB)
  if (o.px.inner && o.px.outer) {
    ctx.strokeStyle = colors.accent2; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(TX(o.px.inner.x), TY(o.px.inner.y));
    ctx.lineTo(TX(o.px.outer.x), TY(o.px.outer.y));
    ctx.stroke();
    for (const p of [o.px.inner, o.px.outer, o.px.upper, o.px.lower]) {
      if (!p) continue;
      ctx.fillStyle = colors.accent2;
      ctx.beginPath(); ctx.arc(TX(p.x), TY(p.y), 2.5, 0, 7); ctx.fill();
    }
  }

  // Ellisse pupilla (IR) o cerchio iride (RGB)
  ctx.strokeStyle = colors.accent; ctx.lineWidth = 2;
  ctx.beginPath();
  if (o.px.axes) {
    ctx.ellipse(TX(o.px.iris.x), TY(o.px.iris.y),
      Math.max(2, o.px.axes.a / 2 * scale), Math.max(2, o.px.axes.b / 2 * scale),
      o.px.axes.angle, 0, Math.PI * 2);
  } else {
    ctx.arc(TX(o.px.iris.x), TY(o.px.iris.y), Math.max(3, (o.px.irisRadius || 8) * scale), 0, Math.PI * 2);
  }
  ctx.stroke();

  // Croce del centroide
  const cx = TX(o.px.iris.x), cy = TY(o.px.iris.y);
  ctx.strokeStyle = colors.hot; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
  ctx.stroke();

  // Glint (PCCR)
  if (o.px.glint) {
    ctx.fillStyle = colors.warn;
    ctx.beginPath(); ctx.arc(TX(o.px.glint.x), TY(o.px.glint.y), 3.5, 0, 7); ctx.fill();
    ctx.strokeStyle = colors.warn; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(TX(o.px.glint.x), TY(o.px.glint.y));
    ctx.lineTo(cx, cy);
    ctx.stroke();
  }

  // Dati numerici
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.text;
  const lines = [
    `x ${o.x >= 0 ? '+' : ''}${o.x.toFixed(4)}`,
    `y ${o.y >= 0 ? '+' : ''}${o.y.toFixed(4)}`,
    `apert ${o.openness.toFixed(3)}`,
    `conf ${o.confidence.toFixed(2)}`,
  ];
  if (o.px.area) lines.push(`area ${o.px.area}`);
  if (o.px.threshold !== undefined) lines.push(`soglia ${o.px.threshold}`);
  // Contrasto pupilla-iride: è il numero con cui si sceglie la
  // combinazione di canali, guardando invece di indovinare.
  if (o.px.contrasto !== undefined) lines.push(`contr ${(o.px.contrasto * 100).toFixed(0)}%`);
  // Dettaglio della qualità: quando la fiducia scende, dice QUALE dei
  // termini è responsabile. Senza, si vede solo un numero che cala e
  // non c'è modo di capire cosa correggere.
  const q = o.px.qualita;
  if (q) {
    const peggiore = [['raggio', q.qRel], ['forma', q.qCirc], ['scatto', q.qTemp], ['apert', q.qApert]]
      .reduce((a, b) => (b[1] < a[1] ? b : a));
    if (peggiore[1] < 0.95) lines.push(`↓ ${peggiore[0]} ${peggiore[1].toFixed(2)}`);
  }
  lines.forEach((s, i) => {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(4, 4 + i * 14, ctx.measureText(s).width + 8, 13);
    ctx.fillStyle = colors.text;
    ctx.fillText(s, 8, 14 + i * 14);
  });
}

/* ------------------------------------------------------------------ *
 * Grafico multi-traccia.
 *
 * Ogni canale (occhio × direzione) è una traccia indipendente, perché
 * ogni canale ha la sua soglia: fondere le curve nasconderebbe proprio
 * l'informazione che serve per capire perché un gesto non è stato
 * rilevato.
 *
 * Codifica visiva: il COLORE indica la direzione, il TRATTO indica
 * l'occhio (continuo = sinistro, tratteggiato = destro). Così anche
 * otto tracce restano leggibili senza otto colori diversi.
 * ------------------------------------------------------------------ */

/**
 * Le etichette SX/DX indicano gli occhi DELLA PERSONA.
 * Il colore indica la direzione, il tratto indica l'occhio: continuo
 * per il sinistro, tratteggiato per il destro. Il campo `dash` è usato
 * sia dal grafico sia dai pulsanti di selezione, così l'aspetto del
 * pulsante corrisponde esattamente alla linea che accende.
 */
export const TRACE_STYLE = {
  'left.up':     { color: '#F5B942', dash: [],     label: 'SX ↑' },
  'left.down':   { color: '#5FD3A0', dash: [],     label: 'SX ↓' },
  'left.left':   { color: '#6BA8FF', dash: [],     label: 'SX ←' },
  'left.right':  { color: '#C88BFF', dash: [],     label: 'SX →' },
  'right.up':    { color: '#F5B942', dash: [6, 4], label: 'DX ↑' },
  'right.down':  { color: '#5FD3A0', dash: [6, 4], label: 'DX ↓' },
  'right.left':  { color: '#6BA8FF', dash: [6, 4], label: 'DX ←' },
  'right.right': { color: '#C88BFF', dash: [6, 4], label: 'DX →' },
  /* Apertura della palpebra: colore distinto dagli assi dell'iride,
   * perché è una grandezza di natura diversa — non dove guarda
   * l'occhio, ma quanto è aperto. */
  'left.wide':    { color: '#FF8A5B', dash: [],     label: 'SX ⬍+' },
  'left.narrow':  { color: '#FF8A5B', dash: [2, 3], label: 'SX ⬍−' },
  'right.wide':   { color: '#FF8A5B', dash: [6, 4], label: 'DX ⬍+' },
  'right.narrow': { color: '#FF8A5B', dash: [1, 4], label: 'DX ⬍−' },
  // Canale combinato: colore proprio, perché non è un movimento ma la
  // somma di più movimenti.
  'left.combo':   { color: '#FFE24D', dash: [],     label: 'SX Σ' },
  'right.combo':  { color: '#FFE24D', dash: [6, 4], label: 'DX Σ' },
};

/**
 * Tracce dei canali del viso.
 * Colori diversi da quelli oculari e tratto punteggiato: guardando il
 * grafico si deve capire in un istante se un segnale viene dagli occhi
 * o dal viso, senza leggere la legenda.
 */
export const FACE_STYLE = {
  'expr.mouthOpen': { color: '#7FE0C8', dash: [2, 3], label: 'Bocca' },
  'expr.smile':     { color: '#FFB37A', dash: [2, 3], label: 'Sorriso' },
  'expr.pucker':    { color: '#FF8FB1', dash: [2, 3], label: 'Labbra' },
  'expr.funnel':    { color: '#B49CFF', dash: [2, 3], label: 'Labbra O' },
  'expr.cheekPuff': { color: '#9AD17B', dash: [2, 3], label: 'Guance' },
  'expr.browUp':    { color: '#FFD966', dash: [2, 3], label: 'Sopracc.' },
};

export const BLINK_STYLE = {
  'left.blink':  { color: '#FF6B5B', dash: [],     label: 'SX chiuso' },
  'right.blink': { color: '#FF9E5B', dash: [6, 4], label: 'DX chiuso' },
};

export class SignalPlot {
  constructor(canvas, maxPoints = 320) {
    this.canvas = canvas;
    this.max = maxPoints;
    this.frames = [];        // [{ ch: {id:{n,nRaw,active}}, blink:{id:bool}, evt:[] }]
  }

  push(frame) {
    this.frames.push(frame);
    while (this.frames.length > this.max) this.frames.shift();
  }
  clear() { this.frames.length = 0; }

  /**
   * @param traces elenco di id da disegnare, es. ['left.up','right.up']
   * @param blinks elenco di id ammiccamento da evidenziare come bande
   */
  draw(colors, thrOn, thrOff, traces, blinks, showRaw) {
    const c = this.canvas; if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
    if (this.frames.length < 2) {
      ctx.fillStyle = colors.muted;
      ctx.font = '13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('in attesa di segnale…', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }

    // Scala verticale in SIGMA: è l'unità in cui ragionano le soglie,
    // quindi le linee di soglia restano orizzontali e confrontabili
    // fra tracce diverse.
    /* ⚠️ La scala si adatta al segnale, e questo inganna l'occhio.
     *
     * Alzando la soglia da 3,5 a 10 le linee tratteggiate si spostano,
     * ma il grafico si ridimensiona insieme a loro e il rapporto fra
     * curva e soglie SEMBRA identico. Si conclude che le soglie non
     * facciano nulla, mentre invece stanno facendo esattamente il loro
     * lavoro.
     *
     * Si mostrano quindi i valori numerici sull'asse, così il
     * ridimensionamento si vede invece di essere subito. */
    let lo = -1.5, hi = thrOn + 1.5;
    for (const f of this.frames)
      for (const id of traces) {
        const d = f.ch?.[id]; if (!d) continue;
        if (isFinite(d.n)) { lo = Math.min(lo, d.n - 0.5); hi = Math.max(hi, d.n + 0.5); }
      }
    this.scalaLo = lo; this.scalaHi = hi;
    const Y = v => H - ((v - lo) / (hi - lo)) * H;
    const X = i => (i / (this.max - 1)) * W;

    // --- bande di occhio chiuso, sul bordo -------------------------
    let band = 0;
    for (const id of blinks) {
      const st = BLINK_STYLE[id]; if (!st) continue;
      const yTop = band * 7, hBand = 5;
      ctx.fillStyle = st.color + '55';
      this.frames.forEach((f, i) => {
        if (f.blink?.[id]) ctx.fillRect(X(i), yTop, Math.max(1, W / this.max) + 0.5, hBand);
      });
      band++;
    }

    // --- griglia e soglie ------------------------------------------
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = colors.hot;
    ctx.beginPath(); ctx.moveTo(0, Y(thrOn)); ctx.lineTo(W, Y(thrOn)); ctx.stroke();
    ctx.strokeStyle = colors.warn;
    ctx.beginPath(); ctx.moveTo(0, Y(thrOff)); ctx.lineTo(W, Y(thrOff)); ctx.stroke();
    ctx.setLineDash([]);

    // --- tracce ----------------------------------------------------
    for (const id of traces) {
      // I canali del viso si disegnano come gli altri: stessa scala in
      // sigma, stesso riferimento alle soglie.
      const st = TRACE_STYLE[id] || FACE_STYLE[id]; if (!st) continue;

      if (showRaw) {
        // Grezzo: distanza dalla baseline PRIMA dei filtri. Lo scarto
        // rispetto alla curva piena è esattamente il nistagmo rimosso.
        ctx.strokeStyle = colors.muted + '99';
        ctx.lineWidth = 1; ctx.setLineDash(st.dash);
        ctx.beginPath();
        let started = false;
        this.frames.forEach((f, i) => {
          const d = f.ch?.[id];
          if (!d || !isFinite(d.nRaw)) { started = false; return; }
          if (!started) { ctx.moveTo(X(i), Y(d.nRaw)); started = true; }
          else ctx.lineTo(X(i), Y(d.nRaw));
        });
        ctx.stroke();
      }

      ctx.strokeStyle = st.color; ctx.lineWidth = 2; ctx.setLineDash(st.dash);
      ctx.beginPath();
      let started = false;
      this.frames.forEach((f, i) => {
        const d = f.ch?.[id];
        if (!d || !isFinite(d.n)) { started = false; return; }
        if (!started) { ctx.moveTo(X(i), Y(d.n)); started = true; }
        else ctx.lineTo(X(i), Y(d.n));
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Evidenzia i tratti in cui la soglia è superata.
      ctx.fillStyle = st.color + '33';
      this.frames.forEach((f, i) => {
        if (f.ch?.[id]?.active) ctx.fillRect(X(i), Y(thrOn), Math.max(1, W / this.max) + 0.5, H - Y(thrOn));
      });
    }

    // --- marcatori di evento ---------------------------------------
    this.frames.forEach((f, i) => {
      if (!f.evt?.length) return;
      for (const e of f.evt) {
        ctx.strokeStyle = e.phase === 'rise' ? colors.hot : colors.accent2;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(e.eye === 'right' ? [4, 3] : []);
        ctx.beginPath(); ctx.moveTo(X(i), 0); ctx.lineTo(X(i), H); ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    ctx.fillStyle = colors.muted;
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`${thrOn.toFixed(1)}σ attiva`, 4, Y(thrOn) - 3);
    ctx.fillText(`${thrOff.toFixed(1)}σ rilascia`, 4, Y(thrOff) - 3);
  }
}
