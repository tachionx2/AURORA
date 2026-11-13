/**
 * GraficoNorm.js — IL GRAFICO DELLA DIAGNOSTICA IN MODALITÀ NORMALIZZATA.
 *
 * Estende il grafico di sempre (`SignalPlot`, in vision/) SENZA
 * toccarlo: a modalità normalizzata spenta, `draw` chiama il disegno
 * originale con gli stessi argomenti, riga per riga identico a prima.
 *
 * Accesa, il grafico è in scala 0–1: 1 è il gesto tipico di questa
 * persona in questa sessione, le linee sono le frazioni scelte
 * (attiva, rilascia). Accanto a ogni occhio si legge se il gesto è già
 * stato imparato o quanti movimenti ha visto finora.
 *
 * In entrambe le modalità, accanto alla linea di fine gesto si scrive
 * PERCHÉ è (o non è) diventato un comando: l'azione eseguita, oppure
 * "occhio non attivo", "durata fuori finestra", "scansione sospesa"…
 */
import { SignalPlot, TRACE_STYLE, FACE_STYLE, BLINK_STYLE } from '../vision/VisionPipeline.js';

const NOMI_DIR = { up: '↑', down: '↓', left: '←', right: '→', wide: 'spalanca', narrow: 'socchiude', combo: 'comb.' };

export class GraficoSegnale extends SignalPlot {
  /**
   * Stessi argomenti di `SignalPlot.draw`, più `opz`:
   *   { normalizzato, normOn, normOff, insegna }
   * Senza `opz.normalizzato` il disegno è quello di sempre.
   */
  draw(colors, thrOn, thrOff, traces, blinks, showRaw, opz) {
    if (!opz?.normalizzato) {
      super.draw(colors, thrOn, thrOff, traces, blinks, showRaw);
      this._motivi(colors);
      return;
    }
    this._disegnaNorm(colors, opz, traces, blinks, showRaw);
    this._motivi(colors);
  }

  /** Valore da disegnare: in scala 0–1 se il motore lo fornisce. */
  static _v(d, grezzo) {
    if (!d) return NaN;
    const v = grezzo ? (d.nRawNorm ?? NaN) : (d.nNorm ?? NaN);
    return v;
  }

  _disegnaNorm(colors, opz, traces, blinks, showRaw) {
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
    const on = opz.normOn, off = opz.normOff;
    // Scala fissa 0–1 (con un po' di margine), allargata solo se il
    // segnale esce: il gesto tipico arriva a 1.
    let lo = -0.15, hi = 1.25;
    for (const f of this.frames)
      for (const id of traces) {
        const v = GraficoSegnale._v(f.ch?.[id], false);
        if (isFinite(v)) { lo = Math.min(lo, v - 0.05); hi = Math.max(hi, v + 0.05); }
      }
    this.scalaLo = lo; this.scalaHi = hi;
    const Y = v => H - ((v - lo) / (hi - lo)) * H;
    const X = i => (i / (this.max - 1)) * W;
    this._Y = Y; this._X = X;

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

    // Zero, gesto tipico (1), attiva, rilascia.
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke();
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(0, Y(1)); ctx.lineTo(W, Y(1)); ctx.stroke();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = colors.hot;
    ctx.beginPath(); ctx.moveTo(0, Y(on)); ctx.lineTo(W, Y(on)); ctx.stroke();
    ctx.strokeStyle = colors.warn;
    ctx.beginPath(); ctx.moveTo(0, Y(off)); ctx.lineTo(W, Y(off)); ctx.stroke();
    ctx.setLineDash([]);

    for (const id of traces) {
      const st = TRACE_STYLE[id] || FACE_STYLE[id]; if (!st) continue;
      if (showRaw) {
        ctx.strokeStyle = colors.muted + '99';
        ctx.lineWidth = 1; ctx.setLineDash(st.dash);
        ctx.beginPath();
        let started = false;
        this.frames.forEach((f, i) => {
          const v = GraficoSegnale._v(f.ch?.[id], true);
          if (!isFinite(v)) { started = false; return; }
          if (!started) { ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v));
        });
        ctx.stroke();
      }
      ctx.strokeStyle = st.color; ctx.lineWidth = 2; ctx.setLineDash(st.dash);
      ctx.beginPath();
      let started = false;
      this.frames.forEach((f, i) => {
        const v = GraficoSegnale._v(f.ch?.[id], false);
        if (!isFinite(v)) { started = false; return; }
        if (!started) { ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v));
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = st.color + '33';
      this.frames.forEach((f, i) => {
        if (f.ch?.[id]?.active) ctx.fillRect(X(i), Y(on), Math.max(1, W / this.max) + 0.5, H - Y(on));
      });
    }

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
    ctx.fillText('1 = gesto tipico', 4, Y(1) - 3);
    ctx.fillText(`${on.toFixed(2)} attiva`, 4, Y(on) - 3);
    ctx.fillText(`${off.toFixed(2)} rilascia`, 4, Y(off) - 3);

    // Stato dell'apprendimento, per ogni traccia disegnata.
    const ultimo = this.frames[this.frames.length - 1];
    const righe = [];
    for (const id of traces) {
      const d = ultimo?.ch?.[id];
      if (!d?.norm) continue;
      const [eye, dir] = id.split('.');
      const occhio = eye === 'left' ? 'SX' : 'DX';
      const stato = d.norm.attiva ? 'imparato' : `sto imparando ${d.norm.quanti} di 3`;
      righe.push({ testo: `${occhio} ${NOMI_DIR[dir] || dir}  ${stato}`, ok: d.norm.attiva });
    }
    if (opz.insegna?.attivo) righe.unshift({ testo: `INSEGNA IL GESTO: ${opz.insegna.quanti} di 3`, ok: false });
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'right';
    righe.forEach((r, k) => {
      ctx.fillStyle = r.ok ? colors.accent2 : colors.warn;
      ctx.fillText(r.testo, W - 6, 26 + k * 15);
    });
    ctx.textAlign = 'left';
  }

  /**
   * Scrive accanto a ogni fine gesto il suo esito. Funziona in entrambe
   * le modalità; senza motivi registrati non disegna nulla.
   */
  _motivi(colors) {
    const c = this.canvas; if (!c || this.frames.length < 2) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    const X = i => (i / (this.max - 1)) * W;
    ctx.font = '11px ui-monospace, monospace';
    let k = 0;
    this.frames.forEach((f, i) => {
      if (!f.evt?.length) return;
      for (const e of f.evt) {
        if (!e.motivo?.testo) continue;
        const testo = (e.motivo.ok ? '✓ ' : '✗ ') + e.motivo.testo;
        ctx.fillStyle = e.motivo.ok ? colors.accent2 : colors.hot;
        const x = X(i) + 3;
        const largo = ctx.measureText(testo).width;
        ctx.textAlign = x + largo > W ? 'right' : 'left';
        // Altezze alternate: due esiti vicini non si sovrappongono.
        ctx.fillText(testo, ctx.textAlign === 'right' ? X(i) - 3 : x, H - 8 - (k++ % 3) * 13);
        ctx.textAlign = 'left';
      }
    });
  }
}
