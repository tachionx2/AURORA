/**
 * Inquadratura.js — COSA VEDE LA TELECAMERA, PER CENTRARLA.
 *
 * In Diagnostica i due riquadri degli occhi mostrano solo un ritaglio,
 * ingrandito per riempire il riquadro (l'occhio lontano dalla
 * telecamera, più piccolo nell'immagine, sembra perciò "zoomato").
 * Per centrare la telecamera serve invece l'immagine INTERA: questa
 * vista la disegna, a specchio come in uno specchio, con sopra:
 *  · una croce al centro e una cornice della zona consigliata;
 *  · il riquadro del volto, se MediaPipe lo riconosce;
 *  · i riquadri degli occhi, in qualunque modalità (RGB, IR, ibrida).
 *
 * ⚠️ Solo disegno: legge il fotogramma già acquisito e il risultato già
 * calcolato. Non tocca la telecamera, MediaPipe, né il rilevamento, e
 * funziona uguale in ogni modalità. Spenta, non costa nulla.
 */

export function disegnaInquadratura(canvas, frame, res, colors) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.font = '13px ui-monospace, monospace';

  if (!frame?.src || !frame.w || !frame.h) {
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'center';
    ctx.fillText('telecamera non attiva', W / 2, H / 2);
    ctx.textAlign = 'left';
    return;
  }

  // Immagine intera, adattata al riquadro senza deformarla.
  const sc = Math.min(W / frame.w, H / frame.h);
  const iw = frame.w * sc, ih = frame.h * sc;
  const ox = (W - iw) / 2, oy = (H - ih) / 2;
  // Da coordinate del fotogramma a coordinate del riquadro, a specchio.
  const X = (x) => ox + iw - x * sc;
  const Y = (y) => oy + y * sc;

  ctx.save();
  ctx.translate(ox + iw, oy);
  ctx.scale(-1, 1);
  try { ctx.drawImage(frame.src, 0, 0, frame.w, frame.h, 0, 0, iw, ih); }
  catch { /* fotogramma non ancora pronto */ }
  ctx.restore();

  // Guide: croce al centro e zona consigliata per il volto.
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(ox + iw / 2, oy); ctx.lineTo(ox + iw / 2, oy + ih);
  ctx.moveTo(ox, oy + ih / 2); ctx.lineTo(ox + iw, oy + ih / 2);
  ctx.stroke();
  ctx.strokeRect(ox + iw * 0.25, oy + ih * 0.15, iw * 0.5, ih * 0.7);
  ctx.setLineDash([]);

  // Riquadro del volto, dai punti di MediaPipe (coordinate 0–1).
  let volto = null;
  const lms = res?.landmarks;
  if (Array.isArray(lms) && lms.length) {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of lms) {
      if (!p) continue;
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    if (x1 > x0 && y1 > y0) volto = { x0: x0 * frame.w, y0: y0 * frame.h, x1: x1 * frame.w, y1: y1 * frame.h };
  }

  // Riquadri degli occhi, in qualunque modalità.
  const occhi = [];
  for (const lato of ['left', 'right']) {
    const r = res?.[lato]?.px?.roi;
    if (r && r.w > 0 && r.h > 0) occhi.push(r);
  }
  ctx.strokeStyle = colors.accent2;
  ctx.lineWidth = 2;
  for (const r of occhi) ctx.strokeRect(X(r.x + r.w), Y(r.y), r.w * sc, r.h * sc);

  // Il giudizio: dove sta il volto (o, senza volto, gli occhi).
  let msg, ok = false;
  let cx = null, cy = null, alt = null;
  if (volto) {
    cx = (volto.x0 + volto.x1) / 2; cy = (volto.y0 + volto.y1) / 2; alt = (volto.y1 - volto.y0) / frame.h;
  } else if (occhi.length) {
    cx = occhi.reduce((a, r) => a + r.x + r.w / 2, 0) / occhi.length;
    cy = occhi.reduce((a, r) => a + r.y + r.h / 2, 0) / occhi.length;
  }
  if (cx == null) {
    msg = 'nessun volto né occhio riconosciuto: inquadra il viso';
  } else {
    // Spostamento dal centro, come appare nell'immagine a specchio.
    const dx = (frame.w / 2 - cx) / frame.w;   // >0 = a destra nell'immagine a specchio
    const dy = (cy - frame.h / 2) / frame.h;   // >0 = in basso
    const parti = [];
    if (dx > 0.15) parti.push('volto troppo a destra');
    else if (dx < -0.15) parti.push('volto troppo a sinistra');
    if (dy > 0.18) parti.push('troppo in basso');
    else if (dy < -0.22) parti.push('troppo in alto');
    if (alt != null) {
      if (alt < 0.25) parti.push('troppo lontano (volto piccolo)');
      else if (alt > 0.8) parti.push('troppo vicino');
    }
    ok = parti.length === 0;
    msg = ok ? (volto ? 'volto ben inquadrato' : 'occhi al centro (volto non disponibile in questa modalità)')
             : parti.join(' · ');
  }
  if (volto) {
    ctx.strokeStyle = ok ? colors.accent2 : colors.warn;
    ctx.lineWidth = 2;
    ctx.strokeRect(X(volto.x1), Y(volto.y0), (volto.x1 - volto.x0) * sc, (volto.y1 - volto.y0) * sc);
  }

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, H - 24, W, 24);
  ctx.fillStyle = ok ? colors.accent2 : colors.warn;
  ctx.fillText(msg, 8, H - 8);
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.fillText(`${frame.w}×${frame.h} · a specchio`, W - 8, 16);
  ctx.textAlign = 'left';
}
