/**
 * AutoTune.js — Taratura automatica dei parametri di rilevamento.
 *
 * ══════════════════════════════════════════════════════════════════
 * A COSA SERVE
 * ══════════════════════════════════════════════════════════════════
 *
 * I parametri di rilevamento sono molti e interdipendenti: finestra
 * mediana, taglio del passa-basso, costante della baseline, soglie,
 * pavimento del rumore, soglie di ammiccamento. Trovarli per tentativi
 * richiede ore, e chi assiste non ha né il tempo né gli strumenti per
 * capire se una modifica ha migliorato o peggiorato.
 *
 * Qui si osserva la persona A RIPOSO per qualche decina di secondi e
 * si ricavano dai dati:
 *   · l'ampiezza e la FREQUENZA della sua oscillazione involontaria
 *     (nistagmo, tremore) → da cui i filtri;
 *   · il rumore residuo dopo quei filtri → da cui il pavimento di sigma;
 *   · l'escursione massima raggiunta dal rumore in unità di sigma
 *     → da cui la soglia, scelta perché A RIPOSO non scatti MAI;
 *   · l'apertura palpebrale tipica → da cui le soglie di ammiccamento;
 *   · la confidenza e la continuità del tracciamento → da cui la
 *     confidenza minima, e un giudizio sull'illuminazione.
 *
 * ══════════════════════════════════════════════════════════════════
 * PRINCIPIO DI PROGETTO
 * ══════════════════════════════════════════════════════════════════
 *
 * Questo modulo è PURO: riceve campioni, restituisce una proposta.
 * Non tocca la configurazione, non conosce il DOM, non ha effetti.
 * Così può essere verificato su segnali costruiti apposta — nistagmo
 * forte, tremore lento, tracciamento scadente — e si sa esattamente
 * cosa proporrebbe in ciascun caso.
 *
 * E propone un PUNTO DI PARTENZA, non un risultato definitivo: la
 * taratura fine resta un lavoro da fare con la persona.
 */

import { MedianWindow, LowPass, AdaptiveBaseline, percentile } from './filters.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Mediana di un array (non lo modifica). */
function mediana(a) {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  return b[b.length >> 1];
}

/** Deviazione assoluta mediana, riportata a scala di deviazione standard. */
function mad(a) {
  if (a.length < 4) return 0;
  const m = mediana(a);
  return 1.4826 * mediana(a.map(v => Math.abs(v - m)));
}

/**
 * Frequenza dominante stimata dagli attraversamenti dello zero.
 *
 * Non serve una trasformata: interessa solo l'ordine di grandezza —
 * distinguere un nistagmo a 4 Hz da un tremore lento a 0,5 Hz — e per
 * quello il conteggio degli attraversamenti è sufficiente e robusto.
 */
function frequenzaDominante(valori, durataMs) {
  if (valori.length < 8 || durataMs <= 0) return 0;
  const m = mediana(valori);
  let attraversamenti = 0;
  let prec = valori[0] - m;
  for (let i = 1; i < valori.length; i++) {
    const v = valori[i] - m;
    if ((prec < 0 && v >= 0) || (prec > 0 && v <= 0)) attraversamenti++;
    prec = v;
  }
  return attraversamenti / 2 / (durataMs / 1000);
}

/**
 * Simula la catena di filtri sui campioni registrati e restituisce il
 * segnale normalizzato in sigma, esattamente come lo vedrebbe il
 * motore dei gesti con quei parametri.
 */
function simulaFiltri(campioni, chiave, par) {
  const med = new MedianWindow(par.medianWindowMs);
  const lp = new LowPass(par.lowPassHz);
  const base = new AdaptiveBaseline(par.baselineTauSec, par.minSigma);
  const n = [];
  for (const c of campioni) {
    const v = c[chiave];
    if (!Number.isFinite(v)) continue;
    const s = lp.push(c.t, med.push(c.t, v));
    const b = base.push(c.t, s);
    n.push(Math.abs(s - b.baseline) / Math.max(1e-6, b.sigma));
  }
  return n;
}

/**
 * @param registrazione array di { t, left, right } dove ciascun occhio è
 *        { x, y, openness, confidence } oppure null
 * @param opzioni { correnti } configurazione attuale, usata come base
 * @returns {{ok, motivo?, proposta, rapporto, qualita}}
 */
export function analizza(registrazione, opzioni = {}) {
  const cur = opzioni.correnti || {};
  const rapporto = [];
  const campioni = (registrazione || []).filter(c => Number.isFinite(c?.t));

  if (campioni.length < 60) {
    return { ok: false, motivo: 'registrazione troppo breve: servono almeno un paio di secondi di dati' };
  }
  const durataMs = campioni[campioni.length - 1].t - campioni[0].t;
  const fps = campioni.length / Math.max(0.001, durataMs / 1000);

  /* ───────── Disponibilità e qualità del tracciamento ───────── */
  const perOcchio = {};
  for (const eye of ['left', 'right']) {
    const validi = campioni.filter(c => c[eye]);
    perOcchio[eye] = {
      presenza: validi.length / campioni.length,
      confidenze: validi.map(c => c[eye].confidence).filter(Number.isFinite),
      aperture: validi.map(c => c[eye].openness).filter(Number.isFinite),
      x: validi.map(c => ({ t: c.t, v: c[eye].x })),
      y: validi.map(c => ({ t: c.t, v: c[eye].y })),
    };
  }

  const presenzaMax = Math.max(perOcchio.left.presenza, perOcchio.right.presenza);
  if (presenzaMax < 0.4) {
    return { ok: false, motivo: `occhi rilevati solo nel ${Math.round(presenzaMax * 100)}% dei fotogrammi: sistema la telecamera o la luce prima di tarare` };
  }

  /* ───────── Scelta dell'occhio di riferimento ───────── */
  // Si preferisce quello visto più spesso; a parità, quello con meno
  // rumore. Non è una scelta definitiva: serve solo per misurare.
  const rumoreDi = (eye) => mad(perOcchio[eye].y.map(p => p.v));
  let rif = perOcchio.left.presenza >= perOcchio.right.presenza ? 'left' : 'right';
  if (Math.abs(perOcchio.left.presenza - perOcchio.right.presenza) < 0.05) {
    const rl = rumoreDi('left'), rr = rumoreDi('right');
    if (rl > 0 && rr > 0) rif = rl <= rr ? 'left' : 'right';
  }
  const E = perOcchio[rif];
  rapporto.push(`occhio di riferimento: ${rif === 'left' ? 'sinistro' : 'destro'} (visto nel ${Math.round(E.presenza * 100)}% dei fotogrammi)`);

  /* ───────── Oscillazione involontaria: ampiezza e frequenza ───────── */
  const grezzoY = E.y.map(p => p.v);
  const grezzoX = E.x.map(p => p.v);
  const ampY = mad(grezzoY), ampX = mad(grezzoX);
  const fY = frequenzaDominante(grezzoY, durataMs);
  const fX = frequenzaDominante(grezzoX, durataMs);
  const f = Math.max(fY, fX);
  rapporto.push(`oscillazione a riposo: ampiezza ${ampY.toFixed(4)} · frequenza ~${f.toFixed(1)} Hz`);

  /* ───────── Filtri: derivati dalla frequenza misurata ───────── */
  // La finestra mediana deve coprire circa un periodo e mezzo
  // dell'oscillazione: più corta non la rimuove, molto più lunga
  // aggiunge solo ritardo — e il ritardo si paga su OGNI gesto.
  //
  // Se però l'oscillazione è debole non c'è nulla da rimuovere: una
  // finestra lunga aggiungerebbe ritardo senza alcun beneficio.
  const oscillaPoco = ampY < 0.006;
  const medianWindowMs = oscillaPoco
    ? 200
    : (f > 0.3 ? clamp(Math.round(1500 / f / 50) * 50, 120, 600)
               : (cur.signal?.medianWindowMs ?? 250));
  // Il taglio va ben sotto l'oscillazione ma sopra il gradino
  // volontario, che dura centinaia di millisecondi.
  const lowPassHz = oscillaPoco
    ? 2.0
    : (f > 0.3 ? clamp(Math.round((f / 3) * 10) / 10, 0.8, 3.0)
               : (cur.signal?.lowPassHz ?? 1.5));
  if (oscillaPoco) rapporto.push('oscillazione debole: filtri leggeri, per non aggiungere ritardo inutile');
  rapporto.push(`filtri proposti: mediana ${medianWindowMs} ms · passa-basso ${lowPassHz} Hz`);

  /* ───────── Rumore residuo dopo i filtri → pavimento di sigma ───────── */
  const parProva = {
    medianWindowMs, lowPassHz,
    baselineTauSec: cur.signal?.baselineTauSec ?? 30,
    minSigma: 1e-6,           // senza pavimento, per misurare il vero residuo
  };
  const campEye = campioni.filter(c => c[rif]).map(c => ({ t: c.t, y: c[rif].y, x: c[rif].x }));
  const medFilt = new MedianWindow(medianWindowMs);
  const lpFilt = new LowPass(lowPassHz);
  const residuo = [];
  const baseFilt = new AdaptiveBaseline(parProva.baselineTauSec, 1e-6);
  for (const c of campEye) {
    const s = lpFilt.push(c.t, medFilt.push(c.t, c.y));
    const b = baseFilt.push(c.t, s);
    residuo.push(s - b.baseline);
  }
  const rumoreFiltrato = mad(residuo);
  // Il pavimento impedisce a sigma di collassare quando la persona è
  // perfettamente immobile, cosa che renderebbe tutto un falso positivo.
  const minSigma = clamp(rumoreFiltrato * 0.6, 0.0008, 0.03);
  rapporto.push(`rumore dopo i filtri: ${rumoreFiltrato.toFixed(5)} → pavimento sigma ${minSigma.toFixed(4)}`);

  /* ───────── Soglia: scelta perché a riposo NON scatti mai ───────── */
  const nRiposo = simulaFiltri(campEye, 'y', { medianWindowMs, lowPassHz, baselineTauSec: parProva.baselineTauSec, minSigma });
  // Si scarta l'inizio: baseline e sigma si stanno ancora assestando.
  const stabile = nRiposo.slice(Math.floor(nRiposo.length * 0.25));
  const picco = stabile.length ? Math.max(...stabile) : 0;
  const p99 = stabile.length ? percentile(stabile, 99) : 0;
  // Margine del 40% sopra il picco osservato: il riposo osservato è un
  // campione, non tutto ciò che può accadere.
  // Minimo 3σ anche se il riposo osservato è quietissimo: qualche
  // decina di secondi non contengono tutto ciò che può capitare in una
  // giornata — un colpo di tosse, un riposizionamento, una risata.
  const thresholdOn = clamp(Math.ceil(Math.max(picco, p99 * 1.2) * 1.4 * 2) / 2, 3.0, 12);
  const thresholdOff = Math.round(thresholdOn * 0.45 * 10) / 10;
  rapporto.push(`escursione massima a riposo ${picco.toFixed(1)}σ → soglia ${thresholdOn}σ (rilascio ${thresholdOff}σ)`);

  /* ───────── Ammiccamento: dalle aperture osservate ───────── */
  const aperture = E.aperture;
  const apRiposo = aperture.length ? percentile(aperture, 85) : 0.3;
  const apBassa = aperture.length ? percentile(aperture, 3) : 0.1;
  // ⚠️ Se durante l'osservazione la persona non ha mai chiuso l'occhio,
  // l'apertura resta quasi costante e da quei dati NON si può dedurre
  // nulla sull'ammiccamento. Proporre un valore comunque sarebbe
  // peggio che non proporlo: un rapporto troppo alto scambierebbe lo
  // sguardo in basso per una chiusura. In quel caso si lascia il
  // valore attuale e lo si dice.
  const escursioneApertura = 1 - (apBassa / Math.max(1e-6, apRiposo));
  let blinkRatio = null, blinkFloor = null;
  if (escursioneApertura > 0.25) {
    blinkRatio = clamp((apBassa / Math.max(1e-6, apRiposo)) * 1.25, 0.30, 0.65);
    blinkFloor = clamp(apBassa * 0.7, 0.02, 0.20);
    rapporto.push(`apertura palpebrale: riposo ${apRiposo.toFixed(3)} · minimo ${apBassa.toFixed(3)} → chiusura sotto il ${Math.round(blinkRatio * 100)}%`);
  } else {
    rapporto.push(`apertura palpebrale quasi costante (${apRiposo.toFixed(3)}): nessun ammiccamento osservato, soglie lasciate come sono`);
  }

  /* ───────── Confidenza minima ───────── */
  const conf = E.confidenze;
  const confBassa = conf.length ? percentile(conf, 10) : 0.5;
  // ⚠️ Tetto a 0.40, il valore predefinito.
  //
  // Alzare la confidenza minima non affina il rilevamento: lo restringe.
  // E restringe proprio dove serve di più, perché la fiducia cala
  // quando la palpebra si abbassa — cioè durante uno sguardo verso il
  // basso, che è il movimento da misurare. Un guasto silenzioso: il
  // segnale sparisce a metà del gesto e nulla lo spiega.
  // La taratura può quindi solo ABBASSARLA, mai alzarla.
  const minConfidence = clamp(confBassa * 0.7, 0.15, 0.40);
  rapporto.push(`confidenza del tracciamento: 10° percentile ${confBassa.toFixed(2)} → minimo ${minConfidence.toFixed(2)}`);

  /* ───────── Giudizio sulla qualità ───────── */
  const confMedia = conf.length ? mediana(conf) : 0;
  const qualita = {
    presenza: E.presenza,
    confidenza: confMedia,
    rumore: rumoreFiltrato,
    frequenza: f,
    fps,
    voto: 'buona',
    avvisi: [],
  };
  if (E.presenza < 0.85) qualita.avvisi.push('il tracciamento si interrompe spesso: controlla inquadratura e stabilità del supporto');
  if (confMedia < 0.55) qualita.avvisi.push('confidenza bassa: probabile luce insufficiente o riflessi sugli occhiali');
  if (rumoreFiltrato > 0.012) qualita.avvisi.push('rumore alto anche dopo i filtri: l\'illuminazione infrarossa migliorerebbe molto');
  if (fps < 15) qualita.avvisi.push(`solo ${fps.toFixed(0)} fotogrammi al secondo: il rilevamento perde precisione`);
  if (f > 7) qualita.avvisi.push('oscillazione molto rapida: verifica che la telecamera non stia vibrando');
  if (qualita.avvisi.length >= 3) qualita.voto = 'scarsa';
  else if (qualita.avvisi.length >= 1) qualita.voto = 'discreta';

  /* ───────── Proposta ───────── */
  const proposta = {
    'signal.medianWindowMs': medianWindowMs,
    'signal.lowPassHz': lowPassHz,
    'signal.minSigma': Math.round(minSigma * 10000) / 10000,
    'signal.thresholdOn': thresholdOn,
    'signal.thresholdOff': thresholdOff,
    'detection.minConfidence': Math.round(minConfidence * 100) / 100,
  };
  if (blinkRatio !== null) {
    proposta['signal.blinkRatio'] = Math.round(blinkRatio * 100) / 100;
    proposta['signal.blinkFloor'] = Math.round(blinkFloor * 1000) / 1000;
  }

  // Se un occhio è quasi sempre assente, si concentra su quello buono:
  // fondere un occhio che non c'è aggiunge solo incertezza.
  const altro = rif === 'left' ? 'right' : 'left';
  if (perOcchio[altro].presenza < 0.35 && E.presenza > 0.7) {
    proposta['detection.activeEye'] = rif;
    rapporto.push(`l'altro occhio è visibile solo nel ${Math.round(perOcchio[altro].presenza * 100)}% dei fotogrammi: si usa il solo ${rif === 'left' ? 'sinistro' : 'destro'}`);
  }

  return { ok: true, proposta, rapporto, qualita, occhio: rif, durataMs, campioni: campioni.length };
}
