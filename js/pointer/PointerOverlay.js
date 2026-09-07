/**
 * PointerOverlay.js — Disegno a schermo intero sopra l'interfaccia.
 *
 * Un solo canvas per: cursore con anello di permanenza, bande del
 * cursore a scansione, bersagli di calibrazione, riscontro del braccio
 * robotico. Tenerli insieme evita quattro livelli sovrapposti e rende
 * banale spegnerli tutti.
 */

export class PointerOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.mode = 'off';          // off | pointer | stripe | calibrate | arm
    this.pointer = null;        // { x, y, dwell, state }
    this.stripe = null;
    this.calib = null;          // { target:{x,y}, index, total, collected, message }
    this.arm = null;            // { x, y, gripper, connected, stopped, status }
    this.colors = null;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = w; this.h = h;
  }

  setMode(mode) {
    this.mode = mode;
    this.canvas.style.display = mode === 'off' ? 'none' : 'block';
    // Il canvas non deve mai rubare i click all'interfaccia sotto.
    this.canvas.style.pointerEvents = 'none';
    if (mode === 'off') this.ctx.clearRect(0, 0, this.w, this.h);
  }

  draw(colors) {
    if (this.mode === 'off') return;
    this.colors = colors;
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    if (this.mode === 'calibrate') this._drawCalibration();
    if (this.mode === 'stripe') this._drawStripe();
    if (this.mode === 'arm') this._drawArm();
    if (this.pointer && (this.mode === 'pointer' || this.mode === 'arm')) this._drawCursor();
  }

  /* ------------------------------ Cursore ------------------------------ */

  _drawCursor() {
    const c = this.ctx, C = this.colors;
    const { x, y, dwell = 0 } = this.pointer;
    const R = 26;

    // Anello di permanenza: mostra QUANTO manca al click. Senza questo
    // riscontro il click sembra casuale e la persona non impara a
    // spostare lo sguardo in tempo per annullarlo.
    c.lineWidth = 5;
    c.strokeStyle = C.line;
    c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.stroke();
    if (dwell > 0) {
      c.strokeStyle = dwell >= 1 ? C.accent2 : C.accent;
      c.beginPath();
      c.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + dwell * Math.PI * 2);
      c.stroke();
    }

    c.fillStyle = C.accent;
    c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = C.ink; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.stroke();

    // Croce sottile: aiuta a giudicare l'allineamento su bersagli piccoli.
    c.strokeStyle = C.accent + '66'; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x - R - 14, y); c.lineTo(x - R - 4, y);
    c.moveTo(x + R + 4, y); c.lineTo(x + R + 14, y);
    c.moveTo(x, y - R - 14); c.lineTo(x, y - R - 4);
    c.moveTo(x, y + R + 4); c.lineTo(x, y + R + 14);
    c.stroke();
  }

  /* ------------------------------- Bande ------------------------------- */

  _drawStripe() {
    const s = this.stripe; if (!s?.active) return;
    const c = this.ctx, C = this.colors;

    // Zona esclusa dopo il primo passaggio: mostra visivamente che la
    // ricerca si è ristretta, altrimenti la seconda passata sembra un
    // malfunzionamento.
    c.fillStyle = C.ink + 'AA';
    if (s.range.x0 > 0.001) c.fillRect(0, 0, s.range.x0 * this.w, this.h);
    if (s.range.x1 < 0.999) c.fillRect(s.range.x1 * this.w, 0, this.w, this.h);
    if (s.phase === 'y') {
      if (s.range.y0 > 0.001) c.fillRect(0, 0, this.w, s.range.y0 * this.h);
      if (s.range.y1 < 0.999) c.fillRect(0, s.range.y1 * this.h, this.w, this.h);
    }

    const X = s.x * this.w, Y = s.y * this.h;
    c.lineWidth = 3;
    if (s.phase === 'x') {
      c.strokeStyle = C.accent;
      c.beginPath(); c.moveTo(X, 0); c.lineTo(X, this.h); c.stroke();
      c.fillStyle = C.accent + '22';
      c.fillRect(X - 22, 0, 44, this.h);
    } else if (s.phase === 'y') {
      c.strokeStyle = C.accent2;
      c.beginPath(); c.moveTo(0, Y); c.lineTo(this.w, Y); c.stroke();
      c.fillStyle = C.accent2 + '22';
      c.fillRect(0, Y - 22, this.w, 44);
      // La X è già fissata: si mostra dove.
      c.strokeStyle = C.accent + '99'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(X, 0); c.lineTo(X, this.h); c.stroke();
      c.fillStyle = C.accent2;
      c.beginPath(); c.arc(X, Y, 8, 0, Math.PI * 2); c.fill();
    }

    const label = s.phase === 'x'
      ? `orizzontale · passata ${s.pass + 1}`
      : `verticale · passata ${s.pass + 1}`;
    this._badge(label, 16, 16);
  }

  /* ---------------------------- Calibrazione ---------------------------- */

  _drawCalibration() {
    const k = this.calib; if (!k) return;
    const c = this.ctx, C = this.colors;
    c.fillStyle = C.ink + 'F2';
    c.fillRect(0, 0, this.w, this.h);

    const x = k.target.x * this.w, y = k.target.y * this.h;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);

    c.strokeStyle = C.accent; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, 26 + pulse * 10, 0, Math.PI * 2); c.stroke();
    c.fillStyle = C.accent;
    c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = C.ink;
    c.beginPath(); c.arc(x, y, 2.5, 0, Math.PI * 2); c.fill();

    if (k.progress > 0) {
      c.strokeStyle = C.accent2; c.lineWidth = 5;
      c.beginPath();
      c.arc(x, y, 34, -Math.PI / 2, -Math.PI / 2 + k.progress * Math.PI * 2);
      c.stroke();
    }

    c.fillStyle = C.text;
    c.font = '600 20px "Atkinson Hyperlegible", system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText(k.message || 'Guarda il punto', this.w / 2, this.h - 78);
    c.fillStyle = C.muted;
    c.font = '400 15px ui-monospace, monospace';
    c.fillText(`punto ${k.index + 1} di ${k.total}`, this.w / 2, this.h - 50);
    c.textAlign = 'left';
  }

  /* ------------------------- Braccio robotico ------------------------- */

  _drawArm() {
    const a = this.arm; if (!a) return;
    const c = this.ctx, C = this.colors;

    // Riquadro dello spazio di lavoro: mostrare i LIMITI è parte della
    // sicurezza, non decorazione. Chi assiste deve vedere dove il
    // braccio può e non può arrivare.
    const m = 40;
    const bx = m, by = m + 40, bw = this.w - 2 * m, bh = this.h - by - 150;
    c.strokeStyle = a.stopped ? C.hot : (a.connected ? C.accent2 : C.muted);
    c.lineWidth = 2; c.setLineDash([8, 6]);
    c.strokeRect(bx, by, bw, bh);
    c.setLineDash([]);

    if (a.limits) {
      c.strokeStyle = C.warn + '99'; c.lineWidth = 1;
      c.strokeRect(bx + a.limits.x0 * bw, by + a.limits.y0 * bh,
                   (a.limits.x1 - a.limits.x0) * bw, (a.limits.y1 - a.limits.y0) * bh);
    }

    // Posizione comandata
    const px = bx + a.x * bw, py = by + a.y * bh;
    c.strokeStyle = C.accent; c.lineWidth = 2;
    c.beginPath(); c.moveTo(bx, py); c.lineTo(bx + bw, py); c.stroke();
    c.beginPath(); c.moveTo(px, by); c.lineTo(px, by + bh); c.stroke();

    // Pinza: due ganasce che si aprono
    const g = (a.gripper || 0) / 100, span = 10 + g * 26;
    c.strokeStyle = a.stopped ? C.hot : C.accent2; c.lineWidth = 5;
    c.beginPath();
    c.moveTo(px - span, py - 20); c.lineTo(px - span, py + 20);
    c.moveTo(px + span, py - 20); c.lineTo(px + span, py + 20);
    c.stroke();
    c.fillStyle = C.accent;
    c.beginPath(); c.arc(px, py, 7, 0, Math.PI * 2); c.fill();

    // Posizione riportata dal dispositivo, se la invia: la differenza
    // dalla posizione comandata rivela ritardi o comandi rifiutati.
    if (a.status) {
      const sx = bx + a.status.x * bw, sy = by + a.status.y * bh;
      c.strokeStyle = C.muted; c.lineWidth = 2; c.setLineDash([3, 3]);
      c.beginPath(); c.arc(sx, sy, 11, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
    }

    const state = a.stopped ? 'ARRESTO' : (a.connected ? 'collegato' : 'non collegato');
    this._badge(`braccio · ${state} · pinza ${Math.round(a.gripper || 0)}%`, 16, 16,
                a.stopped ? C.hot : undefined);
  }

  _badge(text, x, y, bg) {
    const c = this.ctx, C = this.colors;
    c.font = '600 13px ui-monospace, monospace';
    const w = c.measureText(text).width + 18;
    c.fillStyle = bg || (C.raised + 'EE');
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, 26, 13); else c.rect(x, y, w, 26);
    c.fill();
    c.fillStyle = bg ? '#fff' : C.text;
    c.fillText(text, x + 9, y + 17);
  }
}
