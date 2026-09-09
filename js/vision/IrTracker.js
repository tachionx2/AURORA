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

    /* ══════════════════════════════════════════════════════════════
     * PREPARAZIONE DELL'IMMAGINE — tutta facoltativa
     * ══════════════════════════════════════════════════════════════
     *
     * ⚠️ Riguarda SOLO la modalità infrarossa. MediaPipe non passa da
     * qui e non condivide una riga di questo codice.
     *
     * ⚠️ E riguarda solo ciò che CAMBIA L'ORDINE dei pixel.
     * Normalizzazione, stretch dell'istogramma ed equalizzazione
     * spostano i valori ma lasciano l'ordine intatto — e siccome la
     * soglia qui è un PERCENTILE ("il 12% più scuro"), il risultato
     * sarebbe identico prima e dopo. Sono fatica per zero effetto, e
     * per questo non ci sono.
     *
     * Tutto spento di default: chi non lo accende ha esattamente il
     * comportamento di prima.
     */
    const D2 = this.cfg.detection || {};
    const adesso = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    /* ── 1. Sfocatura leggera ──
     *
     * Il rumore del sensore fa cadere pixel isolati dentro il
     * percentile scuro, e quelli attaccano ciglia e ombre alla
     * pupilla. Una sfocatura di uno o due pixel li toglie; sui bordi
     * veri, che sono ampi, non incide.
     *
     * Separabile — prima le righe, poi le colonne — perché una
     * sfocatura quadrata costerebbe il quadrato del raggio invece del
     * doppio. */
    const raggio = Math.max(0, Math.round(D2.irBlur || 0));
    if (raggio > 0) {
      const tmp = new Uint8Array(n);
      const lato = raggio * 2 + 1;
      for (let y = 0; y < h; y++) {
        let somma = 0;
        for (let dx = -raggio; dx <= raggio; dx++) {
          somma += gray[y * w + Math.min(w - 1, Math.max(0, dx))];
        }
        for (let x = 0; x < w; x++) {
          tmp[y * w + x] = somma / lato;
          const esce = Math.min(w - 1, Math.max(0, x - raggio));
          const entra = Math.min(w - 1, Math.max(0, x + raggio + 1));
          somma += gray[y * w + entra] - gray[y * w + esce];
        }
      }
      for (let x = 0; x < w; x++) {
        let somma = 0;
        for (let dy = -raggio; dy <= raggio; dy++) {
          somma += tmp[Math.min(h - 1, Math.max(0, dy)) * w + x];
        }
        for (let y = 0; y < h; y++) {
          gray[y * w + x] = somma / lato;
          const esce = Math.min(h - 1, Math.max(0, y - raggio));
          const entra = Math.min(h - 1, Math.max(0, y + raggio + 1));
          somma += tmp[entra * w + x] - tmp[esce * w + x];
        }
      }
    }

    /* ── 6. CLAHE: contrasto locale ──
     *
     * ⚠️ È l'unico filtro di immagine che aggiunge davvero
     * informazione, perché NON conserva l'ordine dei pixel: equalizza
     * ogni riquadro per conto suo, quindi cambia i rapporti fra zone
     * diverse. Normalizzazione ed equalizzazione globale l'ordine lo
     * conservano, e con una soglia per percentile non cambiano nulla.
     *
     * Serve quando un lato dell'occhio è in ombra: lì l'iride può
     * essere più chiara della sclera in ombra dall'altra parte, e
     * nessuna soglia globale può separarle. Equalizzando a riquadri,
     * ciascuna zona viene giudicata rispetto a sé stessa.
     *
     * ⚠️ Amplifica anche il rumore: da usare con la sfocatura, e
     * spento di default.
     *
     * Il limite di taglio è ciò che distingue CLAHE dall'equalizzazione
     * semplice: senza, in una zona quasi uniforme il contrasto verrebbe
     * amplificato a dismisura e il rumore diventerebbe struttura.
     */
    const clahe = Math.max(0, Number(D2.irClahe) || 0);
    if (clahe > 0 && w >= 16 && h >= 16) {
      const nx = Math.max(1, Math.min(8, Math.round(D2.irClaheRiquadri || 4)));
      const ny = nx;
      const tw = Math.ceil(w / nx), th = Math.ceil(h / ny);
      // Una tabella di conversione per riquadro.
      const mappe = [];
      for (let ty = 0; ty < ny; ty++) {
        for (let tx = 0; tx < nx; tx++) {
          const x1 = tx * tw, y1 = ty * th;
          const x2 = Math.min(w, x1 + tw), y2 = Math.min(h, y1 + th);
          const ist = new Uint32Array(256);
          let tot = 0;
          for (let y = y1; y < y2; y++) {
            for (let x = x1; x < x2; x++) { ist[gray[y * w + x]]++; tot++; }
          }
          if (!tot) { mappe.push(null); continue; }
          /* Taglio: ciò che eccede il limite viene ridistribuito su
           * tutti i livelli, invece di essere buttato via. */
          const limite = Math.max(1, Math.round(clahe * tot / 256));
          let eccesso = 0;
          for (let v = 0; v < 256; v++) {
            if (ist[v] > limite) { eccesso += ist[v] - limite; ist[v] = limite; }
          }
          const quota = Math.floor(eccesso / 256);
          for (let v = 0; v < 256; v++) ist[v] += quota;
          const mappa = new Uint8Array(256);
          let acc = 0;
          for (let v = 0; v < 256; v++) { acc += ist[v]; mappa[v] = (255 * acc) / tot; }
          mappe.push(mappa);
        }
      }
      /* Interpolazione fra i riquadri vicini: senza, i bordi fra un
       * riquadro e l'altro diventerebbero gradini visibili, e un
       * gradino è esattamente ciò che il rilevamento di bordi
       * scambierebbe per il contorno della pupilla. */
      const fuori = new Uint8Array(n);
      for (let y = 0; y < h; y++) {
        const fy = y / th - 0.5;
        const ty0 = Math.max(0, Math.min(ny - 1, Math.floor(fy)));
        const ty1 = Math.max(0, Math.min(ny - 1, ty0 + 1));
        const wy = Math.max(0, Math.min(1, fy - ty0));
        for (let x = 0; x < w; x++) {
          const fx = x / tw - 0.5;
          const tx0 = Math.max(0, Math.min(nx - 1, Math.floor(fx)));
          const tx1 = Math.max(0, Math.min(nx - 1, tx0 + 1));
          const wx = Math.max(0, Math.min(1, fx - tx0));
          const v = gray[y * w + x];
          const m00 = mappe[ty0 * nx + tx0], m01 = mappe[ty0 * nx + tx1];
          const m10 = mappe[ty1 * nx + tx0], m11 = mappe[ty1 * nx + tx1];
          const a0 = m00 ? m00[v] : v, a1 = m01 ? m01[v] : v;
          const b0 = m10 ? m10[v] : v, b1 = m11 ? m11[v] : v;
          fuori[y * w + x] = (a0 * (1 - wx) + a1 * wx) * (1 - wy)
                           + (b0 * (1 - wx) + b1 * wx) * wy;
        }
      }
      gray.set(fuori);
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

    /* ── 2. Apertura morfologica ──
     *
     * Erosione seguita da dilatazione: stacca la pupilla da ciò che la
     * tocca per un filo di pixel, e ripristina poi la dimensione
     * originale. È il rimedio diretto al caso in cui le ciglia fanno
     * da ponte e la regione trovata si allunga fino a diventare
     * un'ellisse che esce dall'occhio.
     *
     * ⚠️ La maschera si costruisce SEMPRE, anche a filtro spento: così
     * il resto del codice legge sempre da lì, e con il filtro spento
     * contiene esattamente `gray <= soglia` come prima. Nessuna
     * differenza di comportamento per chi non lo accende.
     */
    const scuro = new Uint8Array(n);
    for (let i = 0; i < n; i++) scuro[i] = gray[i] <= thr ? 1 : 0;

    const apertura = Math.max(0, Math.round(D2.irApertura || 0));
    if (apertura > 0) {
      const passa = (dentro, fuori, tieni) => {
        // tieni = 1 → erosione (serve tutto il vicinato)
        // tieni = 0 → dilatazione (basta un vicino)
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let v = tieni;
            for (let dy = -apertura; dy <= apertura && v === tieni; dy++) {
              const yy = y + dy;
              if (yy < 0 || yy >= h) continue;
              for (let dx = -apertura; dx <= apertura; dx++) {
                const xx = x + dx;
                if (xx < 0 || xx >= w) continue;
                if (dentro[yy * w + xx] !== tieni) { v = 1 - tieni; break; }
              }
            }
            fuori[y * w + x] = v;
          }
        }
      };
      const t1 = new Uint8Array(n);
      passa(scuro, t1, 1);      // erosione
      passa(t1, scuro, 0);      // dilatazione
    }

    // --- Componenti connesse sui pixel scuri ------------------------
    const labels = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    let best = null, riserva = null, nextLabel = 0;

    for (let i = 0; i < n; i++) {
      if (!scuro[i] || labels[i] !== -1) continue;
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
        if (px > 0     && labels[p - 1] === -1 && scuro[p - 1]) { labels[p - 1] = lab; stack[sp++] = p - 1; }
        if (px < w - 1 && labels[p + 1] === -1 && scuro[p + 1]) { labels[p + 1] = lab; stack[sp++] = p + 1; }
        if (py > 0     && labels[p - w] === -1 && scuro[p - w]) { labels[p - w] = lab; stack[sp++] = p - w; }
        if (py < h - 1 && labels[p + w] === -1 && scuro[p + w]) { labels[p + w] = lab; stack[sp++] = p + w; }
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

      /* ⚠️ Una forma sbagliata va SCARTATA, non solo penalizzata.
       *
       * I criteri esistevano già ma erano morbidi: una regione lunga e
       * stretta prendeva un punteggio basso e vinceva lo stesso, se era
       * l'unica. Il risultato è il bordo allungato che si vede nei
       * fotogrammi — le ciglia o l'ombra dell'orbita scambiate per
       * iride, con il centro che finisce sul bordo rosa.
       *
       * Un'iride resta TONDA anche tagliata dalla palpebra: il taglio
       * le toglie una calotta senza allungarla. Quindi una regione
       * molto più lunga che larga non è un'iride, e nessun punteggio
       * dovrebbe poterla far vincere.
       *
       * ⚠️ Con il limite regolabile e generoso di default: scartare
       * troppo significa non trovare nulla, che è peggio che trovare
       * male. */
      /* ⚠️ Il candidato migliore si tiene da parte SEMPRE, anche se
       * la forma lo esclude.
       *
       * Scartare per forma è giusto, ma se i filtri si sommano —
       * sfocatura che unisce la pupilla alle ciglia, poi la forma che
       * scarta l'unione — si finisce per non trovare NULLA. E non
       * trovare nulla è peggio che trovare male: il segnale si
       * interrompe invece di essere impreciso.
       *
       * Si tiene quindi una riserva, usata solo se nessun candidato
       * supera i controlli. */
      if (!riserva || score > riserva.score) {
        riserva = { cx, cy, a, b, angle, count, score, fillRatio, aspect,
                    bbox: { x: minX, y: minY, w: bw, h: bh }, meanI: sumI / count };
      }

      const maxAllung = this.cfg.detection.irMaxAllungamento ?? 2.6;
      if (maxAllung > 0 && aspect > maxAllung) continue;

      /* ── 3. Preferire la regione vicina al CENTRO ──
       *
       * Il riquadro è centrato sull'occhio, quindi la pupilla sta
       * vicino al centro mentre ombre e ciglia stanno ai bordi.
       * Scoraggiare ciò che è periferico toglie proprio le regioni che
       * oggi vincono a torto e portano il segno rosso sul bordo rosa.
       *
       * ⚠️ Scoraggia, non esclude: chi guarda molto in alto porta la
       * pupilla verso il bordo, e escluderla la perderebbe proprio nel
       * momento del gesto. */
      let punteggio = score;
      const pesoCentro = D2.irPesoCentro || 0;
      if (pesoCentro > 0) {
        const dx2 = (cx - w / 2) / (w / 2), dy2 = (cy - h / 2) / (h / 2);
        const dist = Math.min(1, Math.hypot(dx2, dy2));
        punteggio *= (1 - pesoCentro * dist);
      }

      /* ── 4. Continuità nel tempo ──
       *
       * La pupilla non salta di venti pixel in trentatré millesimi di
       * secondo. Preferire ciò che sta vicino a dove era il fotogramma
       * prima toglie gran parte della frammentazione del segnale.
       *
       * ⚠️ Con una scadenza: se il rilevamento si perde, questo lo
       * terrebbe ancorato al posto sbagliato per sempre. Dopo mezzo
       * secondo senza un buon riscontro si ricomincia liberi. */
      const pesoCont = D2.irPesoContinuita || 0;
      const ultimo = this._ultimoCentro?.[side];
      if (pesoCont > 0 && ultimo && (adesso - ultimo.t) < (D2.irContinuitaMs ?? 500)) {
        const d = Math.hypot(cx - ultimo.x, cy - ultimo.y) / Math.max(1, Math.min(w, h));
        punteggio *= (1 - pesoCont * Math.min(1, d * 2));
      }

      if (!best || punteggio > best.score) {
        best = { cx, cy, a, b, angle, count, score: punteggio, fillRatio, aspect,
                 bbox: { x: minX, y: minY, w: bw, h: bh }, meanI: sumI / count };
      }
    }

    /* Nessun candidato ha superato i controlli: si usa la riserva.
     * Un rilevamento impreciso si può correggere con i parametri; un
     * segnale che si interrompe no. */
    if (!best && riserva) best = riserva;
    if (!best) { this.lastDebug[side] = { thr, found: false }; return null; }

    /* ══════════════════════════════════════════════════════════════
     * 5. RAFFINAMENTO SUL BORDO
     * ══════════════════════════════════════════════════════════════
     *
     * ⚠️ È il cambio di principio: la soglia dice quali pixel sono
     * scuri, il gradiente dice DOVE la luminanza cambia. Il bordo
     * della pupilla è dove cambia più bruscamente, e quel punto non
     * dipende da dove è stata messa la soglia.
     *
     * È la strada dei tracciatori professionali, e la ragione è che
     * una soglia sbagliata di poco sposta il centro di molto — mentre
     * il massimo del gradiente resta dov'è.
     *
     * Come funziona: dal centro trovato si parte lungo raggi in tutte
     * le direzioni; su ciascuno si cerca il punto in cui la luminanza
     * sale più in fretta (dentro è scuro, fuori è chiaro). Quei punti
     * sono il contorno vero, e il loro baricentro è il centro vero.
     *
     * ⚠️ I raggi che attraversano la palpebra vanno SCARTATI, non
     * mediati: un raggio che incontra la palpebra trova un gradiente
     * fortissimo nel punto sbagliato, e includerlo tirerebbe il centro
     * proprio dove non deve andare. Si tengono i punti a distanza
     * plausibile dagli altri, e si scartano gli isolati.
     */
    if ((D2.irRaffinaBordo || 0) > 0) {
      const nRaggi = Math.max(8, Math.min(64, Math.round(D2.irRaggi || 24)));
      const rMax = Math.min(w, h) / 2;
      // ⚠️ Dagli assi di `best`, non dalle variabili del ciclo: quelle
      // appartengono all'ultima regione esaminata, non a quella scelta.
      const rMin = Math.max(2, Math.min(best.a, best.b) * 0.3);
      const punti = [];

      const lum = (x, y) => {
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) return null;
        return gray[yi * w + xi];
      };

      for (let k = 0; k < nRaggi; k++) {
        const ang = (2 * Math.PI * k) / nRaggi;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        let migliore = 0, rBest = -1;
        for (let r = rMin; r <= rMax - 1; r += 0.5) {
          const dentro = lum(best.cx + cs * (r - 1), best.cy + sn * (r - 1));
          const fuoriL = lum(best.cx + cs * (r + 1), best.cy + sn * (r + 1));
          if (dentro == null || fuoriL == null) break;
          // Positivo = si passa da scuro a chiaro, cioè si esce.
          const grad = fuoriL - dentro;
          if (grad > migliore) { migliore = grad; rBest = r; }
        }
        if (rBest > 0 && migliore >= (D2.irGradienteMin ?? 12)) {
          punti.push({ x: best.cx + cs * rBest, y: best.cy + sn * rBest, r: rBest });
        }
      }

      if (punti.length >= Math.max(6, nRaggi * 0.35)) {
        /* Si scartano i raggi anomali: la mediana dei raggi è il
         * riferimento, e ciò che se ne allontana troppo ha incontrato
         * la palpebra invece del bordo dell'iride. */
        const raggi = punti.map(p2 => p2.r).sort((u, v) => u - v);
        const rMed = raggi[raggi.length >> 1];
        const buoni = punti.filter(p2 => Math.abs(p2.r - rMed) <= rMed * 0.35);

        if (buoni.length >= Math.max(5, nRaggi * 0.3)) {
          let sx2 = 0, sy2 = 0;
          for (const p2 of buoni) { sx2 += p2.x; sy2 += p2.y; }
          const ncx = sx2 / buoni.length, ncy = sy2 / buoni.length;
          /* ⚠️ Solo se lo spostamento è ragionevole: un centro che
           * salta lontano è un raffinamento andato male, e tenersi
           * quello di prima è meglio che seguirlo. */
          const salto = Math.hypot(ncx - best.cx, ncy - best.cy);
          if (salto < rMed) {
            best = { ...best, cx: ncx, cy: ncy,
                     a: rMed * 2, b: rMed * 2, raffinato: buoni.length };
          }
        }
      }
    }

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

    /* Si ricorda dove si era arrivati, per occhio: serve alla
     * continuità nel fotogramma successivo. Scritto sempre, così
     * accendendo la continuità è già disponibile. */
    this._ultimoCentro = this._ultimoCentro || {};
    this._ultimoCentro[side] = { x: best.cx, y: best.cy, t: adesso };

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
