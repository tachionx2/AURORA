/**
 * IrTracker.js — Rilevamento sotto illuminazione infrarossa.
 *
 * Sotto IR (850 o 940 nm) la pupilla appare come un disco NERO ad
 * altissimo contrasto: la luce entra nell'occhio e non torna indietro.
 * La segmentazione diventa quasi banale e — cosa che conta molto di più —
 * INDIPENDENTE DALLA LUCE AMBIENTE. Funziona identicamente a mezzogiorno
 * e alle tre di notte.
 *
 * Il segnale qui è il vettore PCCR: centro pupilla − riflesso corneale
 * (glint). Il glint è generato dallo stesso illuminatore e si sposta
 * pochissimo quando l'occhio ruota, mentre la pupilla si sposta molto:
 * la differenza cancella le traslazioni di testa e di camera.
 *
 * Nessuna dipendenza esterna: soglia, etichettatura delle componenti
 * connesse e momenti sono implementati qui. OpenCV.js peserebbe 8 MB
 * per fare le stesse quattro operazioni.
 */

export class IrTracker {
  constructor(cfg) {
    this.cfg = cfg;
    this.canvas = null;
    this.ctx2d = null;
    this.lastDebug = { left: null, right: null };
  }

  updateConfig(cfg) { this.cfg = cfg; }

  _ensureCanvas(w, h) {
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = w; this.canvas.height = h;
      this.ctx2d = this.canvas.getContext('2d', { willReadFrequently: true });
    }
  }

  /**
   * @param source elemento video/canvas
   * @param rois { left:{x,y,w,h}|null, right:{...}|null }
   *        Se null, si usa l'intero frame diviso in due metà: è il caso
   *        della camera ravvicinata su occhiali, dove non c'è un volto
   *        da rilevare e MediaPipe non servirebbe a nulla.
   */
  detect(source, width, height, rois = null) {
    this._ensureCanvas(width, height);
    this.ctx2d.drawImage(source, 0, 0, width, height);

    // Anche qui le chiavi sono gli occhi DELLA PERSONA: la metà sinistra
    // dell'immagine inquadra il suo occhio destro. Se la telecamera è
    // montata specchiata, l'assistente inverte con detection.swapEyes.
    const swap = !!this.cfg.detection.swapEyes;
    const metaA = { x: 0,         y: 0, w: width / 2, h: height };
    const metaB = { x: width / 2, y: 0, w: width / 2, h: height };
    const boxes = rois && (rois.left || rois.right)
      ? { left: rois.left, right: rois.right }
      : (swap ? { left: metaA, right: metaB } : { left: metaB, right: metaA });

    const out = { left: null, right: null, landmarks: null };
    for (const side of ['left', 'right']) {
      const b = boxes[side];
      if (!b || b.w < 8 || b.h < 8) continue;
      out[side] = this._detectInBox(b, width, height, side);
    }
    return out;
  }

  _detectInBox(box, fw, fh, side) {
    const x0 = Math.max(0, Math.round(box.x));
    const y0 = Math.max(0, Math.round(box.y));
    const w = Math.min(fw - x0, Math.round(box.w));
    const h = Math.min(fh - y0, Math.round(box.h));
    if (w < 8 || h < 8) return null;

    const img = this.ctx2d.getImageData(x0, y0, w, h);
    const n = w * h;
    const gray = new Uint8Array(n);
    const inv = this.cfg.detection.irInvert;

    /* ── Miscelazione dei canali ──
     * Tre costanti diventano tre variabili: nessuna passata in più,
     * nessuna memoria, nessun ramo aggiuntivo. Con i coefficienti
     * predefiniti il risultato è identico a prima, bit per bit.
     *
     * Due normalizzazioni, secondo il caso:
     *   · somma positiva → si divide per la somma, così la luminosità
     *     media resta confrontabile e la soglia per percentile non va
     *     ritarata cambiando combinazione;
     *   · somma nulla o negativa (differenza fra canali) → si centra
     *     su 128, perché una differenza può essere negativa e
     *     altrimenti verrebbe tagliata a zero.
     */
    const mix = this.cfg.detection.channelMix || { r: 0.299, g: 0.587, b: 0.114 };
    const kr = Number.isFinite(mix.r) ? mix.r : 0.299;
    const kg = Number.isFinite(mix.g) ? mix.g : 0.587;
    const kb = Number.isFinite(mix.b) ? mix.b : 0.114;
    const somma = kr + kg + kb;
    const differenza = somma <= 0.001;
    const scala = differenza ? 0.5 : 1 / somma;
    const offset = differenza ? 128 : 0;

    for (let i = 0, j = 0; i < n; i++, j += 4) {
      let g = (img.data[j] * kr + img.data[j + 1] * kg + img.data[j + 2] * kb) * scala + offset;
      g = g < 0 ? 0 : (g > 255 ? 255 : g) | 0;
      gray[i] = inv ? 255 - g : g;
    }

    /* ── Contrasto pupilla-iride, MISURATO ──
     * È il numero che rende scegliibile la combinazione di canali:
     * si prova, si guarda quale dà il valore più alto su QUESTA
     * persona, e si tiene quella. Senza, si potrebbe solo indovinare.
     *
     * Definizione: quanto è più scura la parte più scura della ROI
     * (la pupilla) rispetto al resto (iride e sclera), in percentuale
     * dell'escursione totale. Costa una passata sull'istogramma, che
     * viene comunque costruito qui sotto.
     */

    // --- Soglia adattiva per percentile -----------------------------
    // Non una soglia fissa: l'esposizione cambia fra montaggi, persone
    // e momenti. Il percentile dice "il 12% più scuro di questa ROI",
    // che è una definizione stabile di "pupilla".
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[gray[i]]++;
    const target = (this.cfg.detection.irDarkPercentile / 100) * n;
    let acc = 0, thr = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) { thr = v; break; } }

    /* Contrasto PUPILLA contro IRIDE.
     *
     * ⚠️ Non pupilla contro "tutto il resto": la sclera è molto più
     * chiara dell'iride e dominerebbe la misura, facendo sembrare
     * migliore proprio la combinazione che separa peggio le due cose
     * che contano. Ciò che va separato è la pupilla dall'iride che la
     * circonda — la sclera è un problema diverso e già risolto.
     *
     * Si confronta quindi la banda più scura (pupilla, fino alla
     * soglia) con la banda immediatamente sopra (iride, fino a circa
     * il 45° percentile), lasciando fuori la sclera.
     */
    // ⚠️ Bande FISSE, indipendenti dalla soglia di lavoro: quella
    // dipende dall'ampiezza della regione inquadrata, e su una regione
    // larga cade dentro l'iride invece che sul bordo della pupilla —
    // la misura finirebbe per confrontare iride e sclera, cioè la cosa
    // sbagliata. Il 3% più scuro è pupilla di sicuro; la banda fra il
    // 10% e il 30% è iride di sicuro.
    const perc = (frazione) => {
      let a = 0; const bersaglio = frazione * n;
      for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= bersaglio) return v; }
      return 255;
    };
    const pPup = perc(0.03), pIriA = perc(0.10), pIriB = perc(0.30);
    let sPup = 0, nPup = 0, sIri = 0, nIri = 0;
    for (let v = 0; v < 256; v++) {
      if (!hist[v]) continue;
      if (v <= pPup) { sPup += v * hist[v]; nPup += hist[v]; }
      else if (v >= pIriA && v <= pIriB) { sIri += v * hist[v]; nIri += hist[v]; }
    }
    const mPup = nPup ? sPup / nPup : 0;
    const mIri = nIri ? sIri / nIri : 0;
    const contrasto = mIri > 0 ? Math.max(0, (mIri - mPup) / mIri) : 0;

    // --- Componenti connesse sui pixel scuri ------------------------
    const labels = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    let best = null, nextLabel = 0;

    for (let i = 0; i < n; i++) {
      if (gray[i] > thr || labels[i] !== -1) continue;
      const lab = nextLabel++;
      let sp = 0; stack[sp++] = i;
      labels[i] = lab;
      let count = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      let minX = w, maxX = 0, minY = h, maxY = 0, sumI = 0;

      while (sp > 0) {
        const p = stack[--sp];
        const px = p % w, py = (p / w) | 0;
        count++; sx += px; sy += py; sxx += px * px; syy += py * py; sxy += px * py;
        sumI += gray[p];
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        // 4-connessione: più veloce e sufficiente su un disco pieno
        if (px > 0     && labels[p - 1] === -1 && gray[p - 1] <= thr) { labels[p - 1] = lab; stack[sp++] = p - 1; }
        if (px < w - 1 && labels[p + 1] === -1 && gray[p + 1] <= thr) { labels[p + 1] = lab; stack[sp++] = p + 1; }
        if (py > 0     && labels[p - w] === -1 && gray[p - w] <= thr) { labels[p - w] = lab; stack[sp++] = p - w; }
        if (py < h - 1 && labels[p + w] === -1 && gray[p + w] <= thr) { labels[p + w] = lab; stack[sp++] = p + w; }
      }

      if (count < this.cfg.detection.irMinArea || count > this.cfg.detection.irMaxArea) continue;

      // Momenti centrali → ellisse equivalente
      const cx = sx / count, cy = sy / count;
      const mxx = sxx / count - cx * cx;
      const myy = syy / count - cy * cy;
      const mxy = sxy / count - cx * cy;
      const tr = mxx + myy, det = mxx * myy - mxy * mxy;
      const disc = Math.max(0, tr * tr / 4 - det);
      const l1 = tr / 2 + Math.sqrt(disc), l2 = tr / 2 - Math.sqrt(disc);
      // Assi COMPLETI dell'ellisse equivalente, non semiassi.
      // Per un disco pieno di raggio R il momento secondo vale R²/4,
      // quindi la radice è R/2 e serve il fattore 4 per ottenere il
      // diametro 2R. Col fattore 2 l'ellisse disegnata sulla pupilla
      // risultava larga la metà, e la circolarità calcolata veniva 4
      // invece di 1 — abbassando la confidenza di un rilevamento
      // perfettamente corretto.
      const a = 4 * Math.sqrt(Math.max(0, l1)), b = 4 * Math.sqrt(Math.max(0, l2));
      const angle = 0.5 * Math.atan2(2 * mxy, mxx - myy);

      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      const fillRatio = count / (bw * bh);
      const aspect = b > 0 ? a / b : 99;
      // Una pupilla è compatta e quasi circolare. Palpebre e ciglia no.
      const circularity = count / (Math.PI * Math.max(1, (a / 2) * (b / 2)));
      const score = fillRatio * (aspect < 2.2 ? 1 : 0.25)
                  * (circularity > 0.6 && circularity < 1.6 ? 1 : 0.4)
                  * Math.min(1, count / 200);

      if (!best || score > best.score) {
        best = { cx, cy, a, b, angle, count, score, fillRatio, aspect,
                 bbox: { x: minX, y: minY, w: bw, h: bh }, meanI: sumI / count };
      }
    }

    if (!best) { this.lastDebug[side] = { thr, found: false }; return null; }

    // --- Glint: massimo locale luminoso vicino alla pupilla ---------
    let glint = null;
    if (this.cfg.detection.irUseGlint) {
      const R = Math.max(8, best.a);
      const gx0 = Math.max(0, Math.round(best.cx - R)), gx1 = Math.min(w - 1, Math.round(best.cx + R));
      const gy0 = Math.max(0, Math.round(best.cy - R)), gy1 = Math.min(h - 1, Math.round(best.cy + R));
      let bright = 0, gsx = 0, gsy = 0, gc = 0;
      for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) bright = Math.max(bright, gray[y * w + x]);
      const gThr = Math.max(200, bright - 12);
      for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) {
        if (gray[y * w + x] >= gThr) { gsx += x; gsy += y; gc++; }
      }
      if (gc > 0 && gc < 400) glint = { x: gsx / gc, y: gsy / gc, n: gc };
    }

    // Scala di riferimento: senza landmark facciali usiamo il diametro
    // della pupilla. Cambia poco (la dilatazione è lenta), quindi
    // funziona bene come unità di normalizzazione.
    const scale = Math.max(6, best.a);
    const refX = glint ? glint.x : w / 2;
    const refY = glint ? glint.y : h / 2;
    // Stessa convenzione del tracker in luce visibile: x positivo =
    // la persona guarda alla PROPRIA destra. Nell'immagine la sua
    // destra sta a sinistra, quindi si nega.
    const specchio = this.cfg.detection.swapEyes ? -1 : 1;
    const nx = -specchio * (best.cx - refX) / scale;
    const ny = (best.cy - refY) / scale;

    // Apertura palpebrale approssimata: se la palpebra copre la pupilla,
    // l'altezza del blob crolla mentre la larghezza resta.
    const openness = Math.min(1, best.bbox.h / Math.max(1, best.bbox.w));

    const confidence = Math.max(0, Math.min(1, best.score));
    this.lastDebug[side] = {
      thr, found: true, area: best.count, fillRatio: best.fillRatio,
      aspect: best.aspect, glint: !!glint,
    };

    return {
      x: nx, y: ny, openness, confidence,
      px: {
        iris: { x: x0 + best.cx, y: y0 + best.cy },
        axes: { a: best.a, b: best.b, angle: best.angle },
        glint: glint ? { x: x0 + glint.x, y: y0 + glint.y } : null,
        roi: { x: x0, y: y0, w, h },
        threshold: thr, area: best.count,
        // Contrasto misurato: serve a scegliere la combinazione di
        // canali guardando un numero invece di indovinare.
        contrasto,
      },
    };
  }
}
