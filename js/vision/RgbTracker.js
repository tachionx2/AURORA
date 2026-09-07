/**
 * RgbTracker.js — Rilevamento in luce visibile (MediaPipe Face Landmarker).
 *
 * ⚠️ PUNTO CHIAVE, spesso frainteso.
 *
 * In luce visibile la PUPILLA non è separabile in modo affidabile
 * dall'iride: con occhi scuri il contrasto pupilla/iride è quasi nullo.
 * Tutti i tutorial di "pupil detection" con webcam funzionano su occhi
 * chiari in luce controllata e crollano nel mondo reale.
 *
 * Quindi in RGB il segnale NON è il centro della pupilla, ma il centro
 * dell'IRIDE, normalizzato rispetto ai canti palpebrali. È l'equivalente
 * in luce visibile del PCCR: tollerante ai movimenti della testa e,
 * soprattutto, ALLA DISTANZA — perché tutto è diviso per la larghezza
 * dell'occhio.
 *
 * Conseguenza pratica: occhiali a 4 cm, fascia frontale, o braccio a
 * 40 cm dal letto producono lo STESSO segnale normalizzato. Nessun
 * parametro da cambiare quando si cambia montaggio.
 */

/* ══════════════════════════════════════════════════════════════════
 * DIPENDENZE LOCALI
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ La libreria e il codice WASM sono INCLUSI nel programma, non
 * scaricati da una rete di distribuzione esterna.
 *
 * Il motivo non è la velocità: è che Aurora è l'unico modo di
 * comunicare per chi lo usa. Dipendere da un server altrui significa
 * che il giorno in cui quel server è irraggiungibile — un guasto, un
 * blocco, una connessione caduta — la persona resta muta. Nessun
 * servizio esterno può avere quel potere.
 *
 * Il MODELLO invece pesa alcuni megabyte e non è ridistribuibile
 * insieme al programma: si scarica al primo avvio e viene poi
 * conservato nella cache del browser dal service worker. Dalla seconda
 * volta funziona senza rete.
 */
const MP_LOCAL = './vendor/mediapipe';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * Indici dei landmark, riferiti agli occhi DELLA PERSONA.
 *
 * ⚠️ Nella convenzione di MediaPipe i punti 33/133/159/145 e l'iride
 * 468–472 appartengono all'occhio che nell'IMMAGINE sta a sinistra —
 * che è l'occhio DESTRO di chi è ripreso, perché la telecamera guarda
 * la persona di fronte.
 *
 * Qui si usa l'anatomia, non l'immagine: "left" è l'occhio sinistro
 * DELLA PERSONA. Così un'etichetta "occhio sinistro" nella diagnostica
 * indica davvero il suo occhio sinistro, e chi assiste non deve fare
 * l'inversione a mente ogni volta.
 */
export const EYE_LM = {
  // occhio sinistro della persona = lato destro dell'immagine
  left:  { inner: 362, outer: 263, upper: 386, lower: 374, iris: [473, 474, 475, 476, 477] },
  // occhio destro della persona = lato sinistro dell'immagine
  right: { inner: 133, outer: 33,  upper: 159, lower: 145, iris: [468, 469, 470, 471, 472] },
};

/** Rampa lineare continua fra due estremi. */
const rampa = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));

/**
 * Qualità di un campione oculare, da 0 a 1.
 *
 * ══════════════════════════════════════════════════════════════════
 * PERCHÉ CINQUE TERMINI E NON UNO
 * ══════════════════════════════════════════════════════════════════
 *
 * MediaPipe non fornisce una confidenza per singolo punto: va dedotta.
 * Prima si guardavano solo due cose — raggio dell'iride entro limiti
 * larghissimi, e apertura palpebrale — e il risultato era che nella
 * fascia di lavoro normale la confidenza valeva SEMPRE 1: una costante,
 * quindi un'informazione nulla, e un cursore di soglia che non
 * regolava niente.
 *
 * Ora si misurano cinque cose indipendenti:
 *
 *  1. plausibilità assoluta del raggio — rete di sicurezza, larga;
 *  2. scostamento dal raggio TIPICO DI QUESTA PERSONA — un'iride che
 *     si discosta del 40% dal proprio normale è mal rilevata, e prima
 *     passava come perfetta;
 *  3. circolarità — un'iride coperta dalla palpebra viene stimata come
 *     ellisse schiacciata: è esattamente il caso da riconoscere;
 *  4. coerenza temporale — uno scatto oltre la velocità fisiologica
 *     non è un movimento, è un errore di tracciamento;
 *  5. apertura palpebrale — meno affidabile a occhio socchiuso.
 *
 * Si moltiplicano: basta che una cosa vada storta perché la fiducia
 * scenda, ma nessun termine da solo può azzerare un campione buono.
 *
 * @param m.rRatio      raggio iride / larghezza occhio
 * @param m.rif         raggio tipico di questa persona (null = non ancora noto)
 * @param m.circolarita distanza minima / massima fra i punti del perimetro
 * @param m.velocita    spostamento normalizzato al secondo (null = ignoto)
 * @param m.openness    apertura palpebrale normalizzata
 */
export function qualitaCampione(m) {
  // 1. Plausibilità assoluta: larga di proposito, è solo una rete.
  const qAbs = Math.min(rampa(m.rRatio, 0.05, 0.10), 1 - rampa(m.rRatio, 0.42, 0.60));

  // 2. Scostamento dal proprio normale. Neutro finché non c'è un
  //    riferimento: meglio nessun giudizio che un giudizio inventato.
  let qRel = 1;
  if (m.rif && m.rif > 0) {
    const scarto = Math.abs(m.rRatio / m.rif - 1);
    qRel = 1 - 0.70 * rampa(scarto, 0.18, 0.55);
  }

  // 3. Circolarità. I quattro punti del perimetro dovrebbero essere
  //    equidistanti dal centro; se non lo sono, il rilevamento è
  //    deformato — tipicamente perché la palpebra copre l'iride.
  let qCirc = 1;
  if (Number.isFinite(m.circolarita) && m.circolarita > 0) {
    qCirc = 1 - 0.65 * (1 - rampa(m.circolarita, 0.40, 0.72));
  }

  // 4. Coerenza temporale. Una saccade normale sposta l'iride di circa
  //    un quarto della larghezza dell'occhio in quaranta millisecondi,
  //    cioè circa 6 unità al secondo. Oltre il doppio non è più un
  //    movimento oculare: è il rilevatore che ha perso il punto.
  let qTemp = 1;
  if (Number.isFinite(m.velocita) && m.velocita > 0) {
    qTemp = 1 - 0.65 * rampa(m.velocita, 8, 25);
  }

  // 5. Apertura palpebrale: penalità dolce, non un veto.
  const qApert = 0.45 + 0.55 * rampa(m.openness, 0.05, 0.14);

  const valore = Math.max(0, Math.min(1, qAbs * qRel * qCirc * qTemp * qApert));
  return { valore, qAbs, qRel, qCirc, qTemp, qApert };
}

/**
 * Espressioni facciali utilizzabili come comandi.
 *
 * Sono già fornite da MediaPipe con lo STESSO rilevamento che usiamo
 * per gli occhi — nessun secondo modello, nessuna passata aggiuntiva
 * sul fotogramma — e arrivano già normalizzate fra 0 e 1.
 *
 * Servono a chi non può usare gli occhi: esiti di ictus, paralisi che
 * risparmiano la muscolatura facciale inferiore, situazioni in cui lo
 * sguardo non è controllabile ma un sorriso o l'apertura della bocca
 * sì. Ogni movimento in più è una possibilità in più di comunicare.
 */
export const ESPRESSIONI = [
  { id: 'mouthOpen', shapes: ['jawOpen'],
    label: 'Bocca aperta', spoken: 'bocca aperta' },
  { id: 'smile', shapes: ['mouthSmileLeft', 'mouthSmileRight'],
    label: 'Sorriso', spoken: 'sorriso' },
  { id: 'pucker', shapes: ['mouthPucker'],
    label: 'Labbra a bacio', spoken: 'labbra' },
  { id: 'funnel', shapes: ['mouthFunnel'],
    label: 'Labbra a O', spoken: 'labbra a o' },
  { id: 'cheekPuff', shapes: ['cheekPuff'],
    label: 'Guance gonfie', spoken: 'guance' },
  { id: 'browUp', shapes: ['browInnerUp'],
    label: 'Sopracciglia alzate', spoken: 'sopracciglia' },
];

export class RgbTracker {
  constructor(cfg) {
    this.cfg = cfg;
    this.landmarker = null;
    this.ready = false;
    // Memoria per occhio: serve al riferimento adattivo del raggio e
    // alla coerenza temporale. Poche decine di numeri, nessun costo.
    this.stato = {
      left:  { raggi: [], ultimo: null },
      right: { raggi: [], ultimo: null },
    };
    this.lastError = null;
    this.canvas = null;
    this.ctx2d = null;
  }

  updateConfig(cfg) { this.cfg = cfg; }

  async init() {
    try {
      // Percorso assoluto ricavato dalla pagina: funziona sia in
      // sottocartella sia alla radice del sito.
      const base = new URL(MP_LOCAL, document.baseURI).href;
      const vision = await import(/* @vite-ignore */ `${base}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
      this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        // ⚠️ Le espressioni facciali si calcolano SOLO se qualcuno le
        // usa: a canali del viso spenti il costo aggiuntivo è zero, e
        // il comportamento resta identico a prima che esistessero.
        outputFaceBlendshapes: !!this.cfg.detection?.faceChannels,
        outputFacialTransformationMatrixes: false,
      });
      this.ready = true;
      return true;
    } catch (e) {
      this.lastError = e;
      console.error('[RgbTracker] init fallito:', e);
      return false;
    }
  }

  /**
   * @returns {{left:EyeObs|null, right:EyeObs|null, landmarks:Array|null}}
   *   EyeObs = { x, y, openness, confidence, px:{...} }  px = pixel, per il debug
   */
  detect(source, tMs, width, height) {
    if (!this.ready) return { left: null, right: null, landmarks: null };
    let res;
    if (this._daRicostruire) {
      this._daRicostruire = false;
      this.ready = false;
      this.landmarker = null;
      this.init().catch(() => {});
      return { left: null, right: null, espressioni: null };
    }
    this._t0 = (globalThis.performance?.now?.() ?? 0);
    try { res = this.landmarker.detectForVideo(source, tMs); }
    catch (e) { this.lastError = e; return { left: null, right: null, landmarks: null }; }

    const lms = res?.faceLandmarks?.[0];
    if (!lms || lms.length < 478) return { left: null, right: null, landmarks: null };

    const P = i => ({ x: lms[i].x * width, y: lms[i].y * height });
    const out = { left: null, right: null, landmarks: lms };

    for (const side of ['left', 'right']) {
      const M = EYE_LM[side];
      const inner = P(M.inner), outer = P(M.outer);
      const upper = P(M.upper), lower = P(M.lower);

      const ex = outer.x - inner.x, ey = outer.y - inner.y;
      const eyeWidth = Math.hypot(ex, ey);
      if (eyeWidth < 4) continue;

      // ⚠️ CONVENZIONE DEGLI ASSI — punto che era sbagliato.
      //
      // Il vettore interno→esterno punta verso il lato TEMPORALE
      // dell'occhio: a destra nell'immagine per un occhio, a sinistra
      // per l'altro. Usandolo così com'è, "x positivo" significava
      // direzioni opposte per i due occhi, e uno dei due risultava
      // invertito.
      //
      // Si orienta quindi u sempre verso destra NELL'IMMAGINE, e poi si
      // nega: la telecamera guarda la persona di fronte, quindi la
      // destra dell'immagine è la SUA sinistra.
      //
      // Convenzione finale, uguale per entrambi gli occhi:
      //   x positivo = la persona guarda alla PROPRIA destra
      //   y positivo = la persona guarda in BASSO
      let ux = ex / eyeWidth, uy = ey / eyeWidth;
      if (ux < 0) { ux = -ux; uy = -uy; }
      const vx = -uy, vy = ux;              // +v punta verso il BASSO

      let ix = 0, iy = 0;
      for (const k of M.iris) { const p = P(k); ix += p.x; iy += p.y; }
      ix /= M.iris.length; iy /= M.iris.length;

      const cx = (inner.x + outer.x) / 2, cy = (inner.y + outer.y) / 2;

      const lidGap = Math.hypot(upper.x - lower.x, upper.y - lower.y);
      const openness = lidGap / eyeWidth;

      // Raggio dell'iride, dai soli punti del PERIMETRO.
      // ⚠️ Il primo indice (468 / 473) è il CENTRO dell'iride, non un
      // punto del bordo: includerlo darebbe distanza zero e la
      // circolarità risulterebbe sempre nulla.
      let rmax = 0, rmin = Infinity;
      for (let i = 1; i < M.iris.length; i++) {
        const p = P(M.iris[i]);
        const d = Math.hypot(p.x - ix, p.y - iy);
        if (d > rmax) rmax = d;
        if (d < rmin) rmin = d;
      }

      /* ══════════════════════════════════════════════════════════════
       * CORREZIONE DELL'IRIDE COPERTA DALLA PALPEBRA
       * ══════════════════════════════════════════════════════════════
       *
       * Chi ha muscoli oculari forti alza lo sguardo fino a portare la
       * pupilla quasi sotto la palpebra superiore. A quel punto della
       * corsa succede una cosa che rovina la misura proprio dove
       * servirebbe di più: l'iride è coperta per metà, e il centro
       * stimato scivola verso il basso, verso la parte ancora visibile.
       * Il segno resta indietro, finisce nel bianco dell'occhio, e il
       * movimento risulta più piccolo di quanto sia davvero.
       *
       * La geometria offre però una via d'uscita. La palpebra taglia
       * l'iride ORIZZONTALMENTE, dall'alto o dal basso: i punti
       * laterali non vengono mai coperti. Il raggio misurato da lato a
       * lato è quindi sempre attendibile, e conoscendo il raggio vero e
       * il bordo ancora visibile si ricostruisce dove sta il centro.
       *
       * ⚠️ Si corregge SOLO quando il taglio è evidente: se l'iride è
       * intera, non si tocca nulla. Una correzione applicata quando non
       * serve sposterebbe il segno di continuo, che è peggio del
       * problema che cura.
       */
      let correzione = 0;
      if (this.cfg.detection?.irisOcclusionFix !== false && M.iris.length >= 5) {
        // Proiezione dei punti del perimetro sugli assi DELL'OCCHIO:
        // u lungo la rima palpebrale, v perpendicolare.
        const proiez = [];
        for (let i = 1; i < M.iris.length; i++) {
          const p = P(M.iris[i]);
          const dx2 = p.x - ix, dy2 = p.y - iy;
          proiez.push({ u: dx2 * ux + dy2 * uy, v: dx2 * vx + dy2 * vy });
        }
        // Raggio orizzontale: la media dei due scostamenti laterali.
        // Non è mai tagliato dalla palpebra.
        const lat = proiez.map(q => Math.abs(q.u)).sort((a, b) => b - a);
        const rOriz = lat.length >= 2 ? (lat[0] + lat[1]) / 2 : 0;
        // Estremi verticali: quanto l'iride si estende sopra e sotto.
        const vs = proiez.map(q => q.v);
        const alto = Math.min(...vs);      // negativo = verso l'alto
        const basso = Math.max(...vs);

        if (rOriz > 1e-6) {
          /* ⚠️ Il segno del taglio NON è un'asimmetria fra alto e basso.
           *
           * Il modello restituisce comunque un cerchio simmetrico
           * attorno al proprio centro: coprendo l'iride in alto, quel
           * cerchio diventa più PICCOLO in verticale e scivola verso il
           * basso, ma resta simmetrico. Cercare un'asimmetria fra i due
           * bordi non trova nulla — l'ho verificato, e la correzione non
           * scattava mai.
           *
           * Il segno vero è lo SCHIACCIAMENTO: il raggio verticale
           * diventa più corto di quello orizzontale, che la palpebra non
           * tocca mai. */
          const rVert = (Math.abs(alto) + Math.abs(basso)) / 2;
          const schiacciamento = rVert / rOriz;

          // Si conta SEMPRE quanto l'iride risulta schiacciata, anche a
          // correzione spenta: è il numero che dice se la soglia è
          // sensata prima ancora di accenderla.
          const S2 = this.stato[side];
          S2.schiacc = (S2.schiacc || []);
          S2.schiacc.push(schiacciamento);
          if (S2.schiacc.length > 120) S2.schiacc.shift();

          if (schiacciamento < (this.cfg.detection?.irisOcclusionSoglia ?? 0.78)) {
            S2.corretti = (S2.corretti || 0) + 1;
            /* Quale palpebra sta tagliando? Lo dice la vicinanza: si
             * guarda quale bordo dell'occhio è più prossimo all'iride
             * lungo l'asse verticale. */
            const su = P(M.upper), giu = P(M.lower);
            const vSu = (su.x - ix) * vx + (su.y - iy) * vy;
            const vGiu = (giu.x - ix) * vx + (giu.y - iy) * vy;
            const tagliaSopra = Math.abs(vSu) < Math.abs(vGiu);

            /* Il bordo NON tagliato è affidabile: il centro vero sta
             * esattamente un raggio orizzontale più in là. */
            correzione = tagliaSopra ? (basso - rOriz) : (alto + rOriz);
          }
          S2.totali = (S2.totali || 0) + 1;
          // Tetto di sicurezza: mai più di mezzo raggio, così un
          // rilevamento sbagliato non può far volare il segno.
          const max = rOriz * 0.5;
          correzione = Math.max(-max, Math.min(max, correzione));
        }
      }
      if (correzione !== 0) {
        ix += correzione * vx;
        iy += correzione * vy;
      }

      /* ⚠️ La posizione si calcola QUI, DOPO la correzione del centro.
       *
       * Prima veniva calcolata subito dopo il centroide, e la
       * correzione — pur giusta — arrivava quando il numero era già
       * stato prodotto: non cambiava nulla. Un errore silenzioso, di
       * quelli che si scoprono solo misurando. */
      const dx = ix - cx, dy = iy - cy;
      // Normalizzazione sulla larghezza dell'occhio → invariante alla distanza
      const specchio = this.cfg.detection.swapEyes ? -1 : 1;
      const nx = -specchio * (dx * ux + dy * uy) / eyeWidth;
      const ny = (dx * vx + dy * vy) / eyeWidth;
      const rRatio = rmax / eyeWidth;
      const circolarita = rmax > 0 ? rmin / rmax : 0;

      // Riferimento adattivo: il raggio TIPICO di questa persona.
      const S = this.stato[side];
      S.raggi.push(rRatio);
      if (S.raggi.length > 240) S.raggi.shift();
      let rif = null;
      if (S.raggi.length >= 60) {
        const ord = [...S.raggi].sort((a, b) => a - b);
        rif = ord[ord.length >> 1];
      }

      // Velocità dell'iride, normalizzata sulla larghezza dell'occhio.
      let velocita = null;
      if (S.ultimo && tMs > S.ultimo.t) {
        const dt = (tMs - S.ultimo.t) / 1000;
        // Un salto temporale grande (telecamera ripresa, scheda
        // riattivata) non è un movimento: si salta il giudizio.
        if (dt > 0 && dt < 0.25) {
          velocita = Math.hypot(ix - S.ultimo.x, iy - S.ultimo.y) / eyeWidth / dt;
        }
      }
      S.ultimo = { x: ix, y: iy, t: tMs };

      // ⚠️ Confidenza CONTINUA, non a gradini.
      //
      // Prima valeva 1, 0.5, 0.3 o 0.15 e nient'altro: quattro valori
      // secchi. Con soli quattro gradini la soglia non è un regolatore
      // ma un interruttore — passare da 0.40 a 0.50 non affinava nulla,
      // buttava via di colpo TUTTI i fotogrammi con apertura ridotta,
      // cioè proprio quelli di uno sguardo verso il basso.
      //
      // Ora degrada con continuità: fuori dai limiti plausibili la
      // fiducia scende gradualmente, e la soglia si comporta come ci si
      // aspetta da un cursore.
      const q = qualitaCampione({ rRatio, rif, circolarita, velocita, openness });
      const confidence = q.valore;

      out[side] = {
        x: nx, y: ny, openness, confidence,
        px: {
          iris: { x: ix, y: iy }, inner, outer, upper, lower,
          eyeWidth, irisRadius: rmax,
          // Dettaglio della qualità: serve in diagnostica per capire
          // PERCHÉ la fiducia è scesa, invece di vedere solo un numero.
          qualita: q, circolarita, rifRaggio: rif, velocita,
          roi: {
            x: Math.min(inner.x, outer.x) - eyeWidth * (this.cfg.detection.roiPadding - 1) / 2,
            y: cy - eyeWidth * this.cfg.detection.roiPadding / 3,
            w: eyeWidth * this.cfg.detection.roiPadding,
            h: eyeWidth * this.cfg.detection.roiPadding * 0.66,
          },
        },
      };
    }
    // ── Espressioni facciali ──
    // Calcolate solo se richieste. Più forme per la stessa espressione
    // (sorriso destro e sinistro) si mediano: un sorriso asimmetrico —
    // frequente dopo un ictus — resta comunque rilevabile.
    const bs = res?.faceBlendshapes?.[0]?.categories;
    if (bs && bs.length) {
      const per = {};
      for (const c of bs) per[c.categoryName] = c.score;
      const e = {};
      for (const E of ESPRESSIONI) {
        let somma = 0, n = 0;
        for (const k of E.shapes) {
          const v = per[k];
          if (Number.isFinite(v)) { somma += v; n++; }
        }
        e[E.id] = n ? somma / n : null;
      }
      out.espressioni = e;
    } else out.espressioni = null;

    // Costo del rilevamento, MISURATO: dice quanto costano davvero le
    // espressioni su questo dispositivo, invece di ipotizzarlo.
    const dt = (globalThis.performance?.now?.() ?? 0) - (this._t0 ?? 0);
    this.msUltimo = dt;
    this.msMedio = this.msMedio === undefined ? dt : this.msMedio + (dt - this.msMedio) * 0.05;

    return out;
  }

  close() { try { this.landmarker?.close(); } catch {} this.ready = false; }
}
