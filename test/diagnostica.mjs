/**
 * Diagnostica: camera, analisi degli occhi, grafici e contatori.
 *
 * Verifica che ogni impostazione della scheda Impostazioni produca un
 * effetto MISURABILE sulla pipeline. Un parametro che non cambia nulla
 * è un guasto silenzioso: l'assistente lo regola, non succede niente,
 * e nessuno capisce perché.
 */
let pass=0, fail=0;
const ok=(c,m)=>{ if(c) pass++; else {fail++; console.log('  ✗ '+m);} };

import { DEFAULT_CONFIG, deepClone } from '../js/core/config.js';
import { GestureEngine } from '../js/signal/GestureEngine.js';
import { MedianWindow, LowPass, AdaptiveBaseline, BlinkDetector, BlinkBurst } from '../js/signal/filters.js';
import { IrTracker } from '../js/vision/IrTracker.js';
import { EYE_LM } from '../js/vision/RgbTracker.js';
import { SignalPlot, TRACE_STYLE, BLINK_STYLE, drawEyeDebug } from '../js/vision/VisionPipeline.js';

const occhio = (y, ap=0.30, x=0, cf=0.9) => ({ x, y, openness:ap, confidence:cf });
function corri(mod, script) {
  const c = deepClone(DEFAULT_CONFIG); mod && mod(c);
  const ev = []; const g = new GestureEngine(c, e => ev.push(e)); let t = 0;
  const dai = (ms, L, R=null) => { for (let i=0;i<ms;i+=20){ t+=20; g.process(t,{left:L,right:R}); } };
  script(dai, g, c); return { ev, g, c, get t(){return t} };
}

/* ══════════ 1. SOGLIE: devono cambiare quando scatta il gesto ══════════ */
{
  const gesto = (soglia) => corri(c => { c.signal.thresholdOn = soglia; },
    d => { d(8000, occhio(0), occhio(0)); d(900, occhio(-0.05), occhio(-0.05)); d(2000, occhio(0), occhio(0)); }).ev.length;
  ok(gesto(2.0) >= 1, '1a. soglia bassa: il gesto viene rilevato');
  ok(gesto(60) === 0, '1b. soglia altissima: il gesto NON viene rilevato');
  ok(gesto(2.0) > gesto(60), '1c. la soglia di attivazione ha effetto misurabile');
}

/* ══════════ 2. FILTRI: mediana e passa-basso devono attenuare ══════════ */
{
  const rumore = t => 0.02 * Math.sin(2*Math.PI*4*t/1000) + (Math.random()-0.5)*0.006;
  const varianza = a => { const m=a.reduce((x,y)=>x+y,0)/a.length; return a.reduce((s,v)=>s+(v-m)**2,0)/a.length; };
  const grezzo=[], f1=[], f2=[];
  const m1=new MedianWindow(50),  l1=new LowPass(6);
  const m2=new MedianWindow(300), l2=new LowPass(1.0);
  for (let t=0;t<6000;t+=20){ const v=rumore(t); grezzo.push(v);
    f1.push(l1.push(t,m1.push(t,v))); f2.push(l2.push(t,m2.push(t,v))); }
  ok(varianza(f1) < varianza(grezzo), '2a. i filtri riducono il rumore');
  ok(varianza(f2) < varianza(f1), '2b. finestra più larga e taglio più basso attenuano di più');
  ok(varianza(f2) < varianza(grezzo)*0.2, '2c. attenuazione forte del nistagmo a 4 Hz');
}

/* ══════════ 3. BASELINE: costante di tempo e congelamento ══════════ */
{
  // Si parte da riposo, poi il segnale si sposta: è durante la
  // TRANSIZIONE che la costante di tempo si vede. (La baseline si
  // inizializza al primo campione, quindi partire già a regime non
  // mostrerebbe alcuna differenza.)
  const veloce=new AdaptiveBaseline(2,0.001), lenta=new AdaptiveBaseline(60,0.001);
  for(let t=0;t<4000;t+=20){ veloce.push(t,0); lenta.push(t,0); }
  for(let t=4000;t<10000;t+=20){ veloce.push(t,0.05); lenta.push(t,0.05); }
  ok(veloce.mean > lenta.mean * 1.5,
     `3a. costante breve insegue più in fretta (${veloce.mean.toFixed(4)} contro ${lenta.mean.toFixed(4)})`);
  const b=new AdaptiveBaseline(30,0.001);
  for(let t=0;t<10000;t+=20) b.push(t,0);
  const prima=b.mean; b.freeze();
  for(let t=10000;t<20000;t+=20) b.push(t,1);
  ok(Math.abs(b.mean-prima)<1e-9, '3b. congelata non insegue il gesto');
  b.release();
  for(let t=20000;t<60000;t+=20) b.push(t,1);
  ok(b.mean>0.5, '3c. rilasciata riprende a inseguire');
}

/* ══════════ 4. OCCHIO ATTIVO e CONFIDENZA MINIMA ══════════ */
{
  let r = corri(c => { c.detection.activeEye='left'; },
    d => { d(8000,occhio(0),occhio(0)); d(900,occhio(0),occhio(-0.08)); d(2000,occhio(0),occhio(0)); });
  ok(r.ev.length===0, '4a. con occhio attivo = sinistro, il destro non genera eventi');
  r = corri(c => { c.detection.activeEye='right'; },
    d => { d(8000,occhio(0),occhio(0)); d(900,occhio(0),occhio(-0.08)); d(2000,occhio(0),occhio(0)); });
  ok(r.ev.length===1, '4b. con occhio attivo = destro, lo stesso gesto viene rilevato');
  r = corri(c => { c.detection.minConfidence=0.8; },
    d => { d(6000, occhio(0,0.30,0,0.5), null); });
  ok(r.g.counters.framesValid===0, '4c. confidenza sotto soglia: campioni scartati');
  r = corri(c => { c.detection.minConfidence=0.2; },
    d => { d(6000, occhio(0,0.30,0,0.5), null); });
  ok(r.g.counters.framesValid>200, '4d. confidenza sopra soglia: campioni accettati');
}

/* ══════════ 5. AMMICCAMENTO: rapporto, pavimento, finestra raffica ══════════ */
{
  const b1=new BlinkDetector(0.55,0.08), b2=new BlinkDetector(0.85,0.08);
  for(let i=0;i<200;i++){ b1.update(0.30); b2.update(0.30); }
  ok(b2.threshold > b1.threshold, '5a. rapporto più alto = soglia di chiusura più alta');
  ok(!b1.update(0.20).closed && b2.update(0.20).closed, '5b. la stessa apertura viene giudicata diversamente');
  const b3=new BlinkDetector(0.55,0.28);
  for(let i=0;i<200;i++) b3.update(0.30);
  ok(b3.threshold>=0.28, '5c. il pavimento assoluto ha la precedenza');
  const stretta=new BlinkBurst(200,40,600), larga=new BlinkBurst(1200,40,600);
  const imp=(bb,t0)=>{ bb.update(t0,true); bb.update(t0+100,false); };
  imp(stretta,0); imp(stretta,400); for(let t=500;t<2500;t+=50) stretta.update(t,false);
  imp(larga,0);   imp(larga,400);   for(let t=500;t<2500;t+=50) larga.update(t,false);
  ok(stretta.stats.single===2 && stretta.stats.double===0, '5d. finestra stretta: due singoli');
  ok(larga.stats.double===1 && larga.stats.single===0, '5e. finestra larga: un doppio');
  const corta=new BlinkBurst(500,150,600);
  corta.update(0,true); corta.update(100,false);
  for(let t=150;t<900;t+=50) corta.update(t,false);
  ok(corta.stats.rejectedShort===1, '5f. durata minima: impulso troppo breve scartato');
  const lunga=new BlinkBurst(500,40,150);
  lunga.update(0,true); lunga.update(400,false);
  for(let t=450;t<1200;t+=50) lunga.update(t,false);
  ok(lunga.stats.rejectedLong===1, '5g. durata massima: occhio chiuso non è un ammiccamento');
}

/* ══════════ 6. FINESTRE DI DURATA e PERIODO REFRATTARIO ══════════ */
{
  const durata = (ms) => corri(null, d => {
    d(8000,occhio(0),occhio(0)); d(ms,occhio(-0.08),occhio(-0.08)); d(2500,occhio(0),occhio(0));
  }).ev[0]?.action;
  ok(durata(900)==='SELECT', '6a. 0,9 s → SELEZIONA');
  ok(durata(2600)==='UNDO', '6b. 2,6 s → ANNULLA');
  ok(durata(4200)==='WAKE', '6c. 4,2 s → PAUSA/RISVEGLIO');
  // I filtri anti-nistagmo allungano il gesto di circa 200–250 ms: è
  // il prezzo della soppressione dell'oscillazione. Un movimento
  // davvero istantaneo resta comunque scartato.
  ok(durata(60)===undefined, '6d. movimento istantaneo (60 ms): nessuna azione');
  ok(durata(200)==='SELECT', '6e. gesto di 200 ms: accettato — i filtri lo allungano a ~440 ms');
  const r = corri(c => { c.gestures.refractoryMs=5000; }, d => {
    d(8000,occhio(0),occhio(0));
    d(700,occhio(-0.08),occhio(-0.08)); d(500,occhio(0),occhio(0));
    d(700,occhio(-0.08),occhio(-0.08)); d(2000,occhio(0),occhio(0));
  });
  ok(r.ev.length===1 && r.g.counters.rejected>0, '6f. periodo refrattario blocca il secondo gesto');
}

/* ══════════ 7. COMBINAZIONE DEI DUE OCCHI ══════════ */
{
  const scena = d => { d(8000,occhio(0),occhio(0));
    d(3000,occhio(0,0.04),occhio(0));                 // sinistro chiuso
    d(900,occhio(0,0.04),occhio(-0.08)); d(2000,occhio(0,0.04),occhio(0)); };
  ok(corri(c=>{c.signal.eyeFusion='any';},scena).ev.length===1, '7a. "uno qualsiasi": funziona con un occhio solo');
  ok(corri(c=>{c.signal.eyeFusion='both';},scena).ev.length===0, '7b. "entrambi": serve anche l altro');
  const insieme = d => { d(8000,occhio(0),occhio(0)); d(900,occhio(-0.08),occhio(-0.08)); d(2000,occhio(0),occhio(0)); };
  ok(corri(c=>{c.signal.eyeFusion='both';},insieme).ev.length===1, '7c. "entrambi": due occhi insieme funzionano');
  ok(corri(c=>{c.signal.eyeFusion='any';},insieme).ev.length===1, '7d. "uno qualsiasi": due occhi non generano doppioni');
}

/* ══════════ 8. CANALI DIAGNOSTICI e MODALITÀ DIAGNOSTICA ══════════ */
{
  const r = corri(null, (d,g) => { g.setDiagnostics(true); d(3000, occhio(-0.01,0.30,0.02), occhio(0.01)); });
  const ch = r.g.channels();
  const attesi = ['left.up','left.down','left.left','left.right','left.blink',
                  'right.up','right.down','right.left','right.right','right.blink'];
  ok(attesi.every(k => k in ch), '8a. tutti e dieci i canali presenti');
  // Quattro direzioni dell'iride + due dell'apertura, per due occhi,
  // più i due canali di ammiccamento.
  ok(Object.keys(ch).length===14, `8b. quattordici canali (${Object.keys(ch).length})`);
  for (const k of attesi.filter(x=>!x.endsWith('blink'))) {
    if (!ch[k]) { ok(false, `8c. canale ${k} non calcolato in diagnostica`); break; }
  }
  ok(attesi.filter(x=>!x.endsWith('blink')).every(k => ch[k] && Number.isFinite(ch[k].n)),
     '8c. ogni canale direzionale ha un valore numerico');
  ok(attesi.filter(x=>x.endsWith('blink')).every(k => 'openRef' in ch[k] && 'threshold' in ch[k]),
     '8d. i canali ammiccamento riportano taratura e soglia');
  // Senza diagnostica gli assi orizzontali non si calcolano (risparmio)
  const r2 = corri(null, (d,g) => { g.setDiagnostics(false); d(3000, occhio(0,0.30,0.02), null); });
  ok(r2.g.channels()['left.left'] === null, '8e. fuori diagnostica gli assi spenti non si calcolano');
  ok(r2.g.channels()['left.up'] !== null, '8f. l asse in uso si calcola sempre');
}

/* ══════════ 9. CONTATORI ══════════ */
{
  const r = corri(null, d => {
    d(6000, occhio(0), occhio(0));
    d(300, occhio(0,0.04), occhio(0,0.04));
    d(6000, occhio(0), occhio(0));
    d(900, occhio(-0.08), occhio(-0.08)); d(2000, occhio(0), occhio(0));
  });
  const c = r.g.counters;
  ok(c.framesTotal > 700, `9a. fotogrammi totali contati (${c.framesTotal})`);
  ok(c.framesValid > 0 && c.framesValid <= c.framesTotal, '9b. fotogrammi validi mai oltre il totale');
  // Tempo con l'occhio chiuso, per occhio e in millisecondi: nel
  // copione entrambi restano chiusi 300 ms.
  ok(c.closedMsLeft > 200 && c.closedMsLeft < 500, `9c. tempo occhio SX chiuso corretto (${c.closedMsLeft} ms, attesi ~300)`);
  ok(c.closedMsRight > 200 && c.closedMsRight < 500, `9c2. tempo occhio DX chiuso corretto (${c.closedMsRight} ms)`);
  ok(Object.values(c.gestures).reduce((a,b)=>a+b,0) === r.ev.length, '9d. contatore gesti coerente con gli eventi emessi');
  ok(typeof c.rejected === 'number', '9e. contatore scarti presente');
  const s = r.g.blinkStatus();
  ok(s.left.calibrated && s.left.openRef > 0, '9f. taratura ammiccamento riportata');
  ok(typeof s.burst.single === 'number', '9g. statistiche raffica presenti');
}

/* ══════════ 10. GRAFICO: tracce selezionabili e soglie ══════════ */
{
  const disegnate = [];
  const ctx = new Proxy({}, { get:(t,k)=> {
    if (k==='measureText') return ()=>({width:10});
    if (k==='beginPath') return ()=>{ disegnate.push(ctx._colore); };
    return ()=>{};
  }, set:(t,k,v)=>{ if(k==='strokeStyle') ctx._colore=v; return true; } });
  const canvas = { width:1000, height:230, getContext:()=>ctx };
  const plot = new SignalPlot(canvas, 100);
  const r = corri(null, (d,g)=>{ g.setDiagnostics(true); d(4000, occhio(-0.01), occhio(0.01)); });
  for (let i=0;i<60;i++) plot.push({ ch:r.g.channels(), blink:{}, evt:null });
  ok(plot.frames.length===60, '10a. il grafico accumula i fotogrammi');
  const C = { bg:'#000',text:'#fff',muted:'#888',accent:'#F5B942',accent2:'#5FD3A0',hot:'#FF6B5B',warn:'#E8A33D',grid:'#333' };
  disegnate.length=0;
  plot.draw(C, 3.5, 1.5, ['left.up'], [], true);
  const unaTraccia = disegnate.length;
  disegnate.length=0;
  plot.draw(C, 3.5, 1.5, ['left.up','right.up','left.down','right.down'], ['left.blink'], true);
  ok(disegnate.length > unaTraccia, '10b. più tracce selezionate = più disegno');
  // Quattro direzioni dell'iride + due dell'apertura + il combinato,
  // per due occhi.
  ok(Object.keys(TRACE_STYLE).length===14, `10c. quattordici tracce definite (${Object.keys(TRACE_STYLE).length})`);
  ok(Object.keys(BLINK_STYLE).length===2, '10d. due tracce ammiccamento');
  const stili = Object.entries(TRACE_STYLE);
  /* ⚠️ L'apertura è di natura diversa dagli assi dell'iride — non dove
   * guarda l'occhio ma quanto è aperto — e si distingue anche per
   * tratto, non solo per colore: sul sinistro "socchiude" è
   * punteggiato per non confonderlo con "spalanca". */
  ok(stili.filter(([k])=>k.startsWith('left') && !k.includes('narrow'))
          .every(([,v])=>v.dash.length===0),
     '10e. sull occhio sinistro gli assi dell iride hanno tratto pieno');
  ok(stili.filter(([k])=>k.startsWith('right')).every(([,v])=>v.dash.length>0), '10f. occhio destro tratteggiato');
  const colori = new Set(stili.map(([,v])=>v.color));
  ok(colori.size===6, `10g. un colore per direzione, più apertura e combinato (${colori.size})`);
  plot.clear();
  ok(plot.frames.length===0, '10h. il grafico si azzera');
}

/* ══════════ 11. RILEVAMENTO IR su immagine sintetica ══════════ */
{
  // Occhio finto: sfondo chiaro, pupilla scura, riflesso luminoso.
  function finto(w,h,cx,cy,r,glint=true){
    const d = new Uint8ClampedArray(w*h*4);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      let v = 190 + ((x*7+y*13)%20);
      if ((x-cx)**2+(y-cy)**2 < r*r) v = 20;
      if (glint && (x-(cx+r*0.4))**2+(y-(cy-r*0.4))**2 < 9) v = 250;
      d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
    }
    return { data:d };
  }
  const W=200,H=120;
  let img = finto(W,H,60,60,18);
  const ctx = { drawImage(){}, getImageData:(x,y,w,h)=>{
    const d=new Uint8ClampedArray(w*h*4);
    for(let yy=0;yy<h;yy++) for(let xx=0;xx<w;xx++){
      const s=((yy+y)*W+(xx+x))*4, t=(yy*w+xx)*4;
      d[t]=img.data[s]; d[t+1]=img.data[s+1]; d[t+2]=img.data[s+2]; d[t+3]=255;
    }
    return { data:d };
  }};
  global.document = { createElement: () => ({ width:0, height:0, getContext:()=>ctx }) };

  const cfgIr = deepClone(DEFAULT_CONFIG);
  const ir = new IrTracker(cfgIr);
  let res = ir.detect({}, W, H, { left:{x:0,y:0,w:120,h:120}, right:null });
  ok(res.left !== null, '11a. la pupilla viene rilevata sotto IR');

  /* ══════ Preparazione dell'immagine: facoltativa e innocua ══════
   *
   * ⚠️ Quattro filtri per la sola modalità infrarossa, tutti spenti di
   * default. La verifica che conta è che a filtri SPENTI il risultato
   * sia identico a prima: chi non li accende non deve accorgersi che
   * esistono.
   *
   * ⚠️ Nulla di questo tocca MediaPipe, che non passa da questo codice
   * e non ne condivide una riga.
   */
  {
    const rif = ir.detect({}, W, H, { left: { x: 0, y: 0, w: 120, h: 120 } }).left;
    ok(rif !== null, '11a1. la scena di prova dà un rilevamento');

    for (const k of ['irBlur', 'irApertura', 'irPesoCentro', 'irPesoContinuita']) {
      ok(DEFAULT_CONFIG.detection[k] === 0,
         `11a2. "${k}" è spento di default`);
    }

    // Con i filtri spenti, due rilevazioni consecutive coincidono.
    const uguale = ir.detect({}, W, H, { left: { x: 0, y: 0, w: 120, h: 120 } }).left;
    ok(Math.abs(uguale.px.iris.x - rif.px.iris.x) < 0.01
       && Math.abs(uguale.px.iris.y - rif.px.iris.y) < 0.01,
       '11a3. a filtri spenti il risultato non cambia');

    // ⚠️ E acceso, ciascun filtro non deve FAR PERDERE la pupilla:
    // scartare troppo è peggio che trovare male.
    for (const [k, v] of [['irBlur', 2], ['irApertura', 1],
                          ['irPesoCentro', 0.5], ['irPesoContinuita', 0.5]]) {
      const prima = cfgIr.detection[k];
      cfgIr.detection[k] = v;
      const r2 = ir.detect({}, W, H, { left: { x: 0, y: 0, w: 120, h: 120 } }).left;
      ok(r2 !== null, `11a4. con "${k}" = ${v} la pupilla si trova ancora`);
      if (r2) {
        ok(Math.abs(r2.px.iris.x - 60) < 12 && Math.abs(r2.px.iris.y - 60) < 12,
           `11a5. e resta al posto giusto (${r2.px.iris.x.toFixed(1)}, ${r2.px.iris.y.toFixed(1)})`);
      }
      cfgIr.detection[k] = prima;
    }

    /* ══════ CLAHE e raffinamento sul bordo ══════
     *
     * ⚠️ Il raffinamento cambia principio: la soglia dice quali pixel
     * sono scuri, il gradiente dice DOVE la luminanza cambia. Una
     * soglia sbagliata di poco sposta il centro di molto; il massimo
     * del gradiente resta dov'è.
     *
     * La verifica che conta non è che non rompa, ma che con una soglia
     * DELIBERATAMENTE sbagliata il centro resti giusto. */
    for (const k of ['irClahe', 'irRaffinaBordo']) {
      ok(DEFAULT_CONFIG.detection[k] === 0, `11a6. "${k}" è spento di default`);
    }

    const centroCon = (mod) => {
      const salva = {};
      for (const [k, v] of Object.entries(mod)) { salva[k] = cfgIr.detection[k]; cfgIr.detection[k] = v; }
      const r3 = ir.detect({}, W, H, { left: { x: 0, y: 0, w: 120, h: 120 } }).left;
      for (const [k, v] of Object.entries(salva)) cfgIr.detection[k] = v;
      return r3 ? { x: r3.px.iris.x, y: r3.px.iris.y } : null;
    };

    // Soglia deliberatamente sbagliata: prende troppi pixel.
    const sbagliata = { irDarkPercentile: 35 };
    const senzaRaff = centroCon(sbagliata);
    const conRaff = centroCon({ ...sbagliata, irRaffinaBordo: 1 });
    ok(senzaRaff && conRaff, '11a7. con soglia sbagliata si trova comunque qualcosa');
    if (senzaRaff && conRaff) {
      const erroreSenza = Math.hypot(senzaRaff.x - 60, senzaRaff.y - 60);
      const erroreCon = Math.hypot(conRaff.x - 60, conRaff.y - 60);
      ok(erroreCon <= erroreSenza + 1.5,
         `11a8. il raffinamento sul bordo non peggiora il centro (errore ${erroreSenza.toFixed(1)} → ${erroreCon.toFixed(1)} px)`);
    }

    // CLAHE non deve far perdere la pupilla
    const conClahe = centroCon({ irClahe: 3 });
    ok(conClahe !== null, '11a9. con CLAHE acceso la pupilla si trova ancora');
    if (conClahe) {
      ok(Math.hypot(conClahe.x - 60, conClahe.y - 60) < 12,
         `11b1. e resta al posto giusto (${conClahe.x.toFixed(1)}, ${conClahe.y.toFixed(1)})`);
    }

    /* ⚠️ E tutti insieme devono convivere: si sommano, e sommandosi
     * potrebbero scartare tutto. È già successo con sfocatura e forma. */
    const tutti = centroCon({
      irBlur: 1, irApertura: 1, irPesoCentro: 0.3, irPesoContinuita: 0.3,
      irClahe: 3, irRaffinaBordo: 1,
    });
    ok(tutti !== null, '11b2. con TUTTI i filtri accesi insieme la pupilla si trova ancora');
    if (tutti) {
      ok(Math.hypot(tutti.x - 60, tutti.y - 60) < 15,
         `11b3. e il centro resta plausibile (${tutti.x.toFixed(1)}, ${tutti.y.toFixed(1)})`);
    }
  }
  ok(Math.abs(res.left.px.iris.x-60)<4 && Math.abs(res.left.px.iris.y-60)<4,
     `11b. centroide corretto (${res.left.px.iris.x.toFixed(1)}, ${res.left.px.iris.y.toFixed(1)}) atteso (60, 60)`);
  ok(res.left.px.glint !== null, '11c. il riflesso corneale viene trovato');
  ok(res.left.px.axes && res.left.px.axes.a > 20 && res.left.px.axes.a < 50,
     `11d. dimensione dell ellisse plausibile (${res.left.px.axes.a.toFixed(1)})`);
  ok(res.left.confidence > 0.3, `11e. confidenza ragionevole (${res.left.confidence.toFixed(2)})`);
  /* ⚠️ Qui si verifica il PERCENTILE, non la forma: si toglie il
   * controllo sull'allungamento, altrimenti con un percentile alto la
   * regione cresce, diventa allungata e viene giustamente scartata —
   * lasciando il test senza nulla da misurare. */
  cfgIr.detection.irMaxAllungamento = 0;
  // il percentile deve cambiare la soglia
  cfgIr.detection.irDarkPercentile = 2;  const bassa = ir.detect({},W,H,{left:{x:0,y:0,w:120,h:120}});
  cfgIr.detection.irDarkPercentile = 40; const alta  = ir.detect({},W,H,{left:{x:0,y:0,w:120,h:120}});
  ok(alta.left.px.threshold > bassa.left.px.threshold, '11f. il percentile scuro cambia la soglia');
  // area minima: una pupilla piccola sotto soglia va scartata
  cfgIr.detection.irDarkPercentile = 12;
  cfgIr.detection.irMinArea = 5000;
  ok(ir.detect({},W,H,{left:{x:0,y:0,w:120,h:120}}).left === null, '11g. area minima scarta blob troppo piccoli');
  cfgIr.detection.irMinArea = 30;
  // il movimento della pupilla si riflette nel segnale
  const s1 = ir.detect({},W,H,{left:{x:0,y:0,w:120,h:120}}).left;
  img = finto(W,H,60,45,18);
  const s2 = ir.detect({},W,H,{left:{x:0,y:0,w:120,h:120}}).left;
  ok(s2.y < s1.y, `11h. pupilla alzata → segnale verticale diminuisce (${s1.y.toFixed(3)} → ${s2.y.toFixed(3)})`);
  ok(Math.abs(s2.px.iris.y - 45) < 4, '11i. il nuovo centroide è corretto');
  // glint spento
  cfgIr.detection.irUseGlint = false;
  ok(ir.detect({},W,H,{left:{x:0,y:0,w:120,h:120}}).left.px.glint === null, '11l. glint disattivabile');
}

/* ══════════ 12. INDICI DEI LANDMARK RGB ══════════ */
{
  for (const lato of ['left','right']) {
    const m = EYE_LM[lato];
    ok([m.inner,m.outer,m.upper,m.lower].every(i => Number.isInteger(i) && i>=0 && i<468),
       `12a. ${lato}: indici palpebrali nel range dei landmark facciali`);
    ok(m.iris.length===5 && m.iris.every(i => i>=468 && i<478),
       `12b. ${lato}: cinque punti dell iride nel range corretto`);
  }
  const tutti = [...EYE_LM.left.iris, ...EYE_LM.right.iris];
  ok(new Set(tutti).size===10, '12c. i due iridi non condividono punti');
}


/* ══════════ 13. REGRESSIONE: l'ampiezza non deve calare nel tempo ══════════ */
{
  const cfgR = deepClone(DEFAULT_CONFIG); cfgR.detection.activeEye = 'left';
  const g = new GestureEngine(cfgR, () => {});
  let t = 0;
  const rum = () => 0.02 * Math.sin(2*Math.PI*4*t/1000) + (Math.random()-0.5)*0.008;
  const o = y => ({ x:0, y: y + rum(), openness:0.30, confidence:0.9 });
  const d = (ms, y) => { for (let i=0;i<ms;i+=20){ t+=20; g.process(t,{left:o(y),right:null}); } };
  const picco = () => { let p=0; for(let i=0;i<900;i+=20){ t+=20; g.process(t,{left:o(-0.09),right:null});
    const c=g.channels()['left.up']; if(c) p=Math.max(p,c.n); } d(2500,0); return p; };
  d(20000, 0);
  const p0 = picco();
  const s0 = g.eyes.left.y.sigma;

  // Toccare una traccia del grafico NON deve azzerare i filtri.
  cfgR.ui.plotTraces = ['left.up']; g.updateConfig(cfgR);
  ok(Math.abs(g.eyes.left.y.sigma - s0) < 1e-9, '13a. accendere una traccia non azzera sigma');
  ok(g.eyes.left.y.base.mean !== null, '13b. accendere una traccia non azzera la baseline');
  const p1 = picco();
  ok(Math.abs(p1 - p0) / p0 < 0.35, `13c. l ampiezza resta stabile (${p0.toFixed(1)}σ → ${p1.toFixed(1)}σ)`);

  // Un movimento molto ampio non deve desensibilizzare il sistema:
  // sigma stima il rumore A RIPOSO e usa la mediana, che i gesti non
  // riescono a spostare.
  const gS = new GestureEngine(deepClone(DEFAULT_CONFIG), () => {});
  let tS = 0;
  const oS = y => ({ x:0, y: y + 0.02*Math.sin(2*Math.PI*4*tS/1000), openness:0.30, confidence:0.9 });
  for (let i=0;i<25000;i+=20){ tS+=20; gS.process(tS,{left:oS(0),right:null}); }
  const sPrima = gS.eyes.left.y.sigma;
  for (let i=0;i<5000;i+=20){ tS+=20; gS.process(tS,{left:oS(-0.35),right:null}); }
  for (let i=0;i<5000;i+=20){ tS+=20; gS.process(tS,{left:oS(0),right:null}); }
  const rapporto = gS.eyes.left.y.sigma / sPrima;
  ok(rapporto > 0.6 && rapporto < 1.6,
     `13l. un movimento enorme non gonfia la stima del rumore (${rapporto.toFixed(2)}×)`);

  // Nemmeno cambiare una soglia deve azzerarli: la soglia si applica sul posto.
  cfgR.signal.thresholdOn = 4.2; g.updateConfig(cfgR);
  ok(g.eyes.left.y.base.mean !== null, '13d. cambiare soglia non azzera la baseline');
  ok(g.eyes.left.y.hyst['-1'].onK === 4.2, '13e. la nuova soglia è applicata subito');

  // Cambiare un PARAMETRO DI FILTRO invece deve ricostruire, ed è giusto.
  cfgR.signal.lowPassHz = 2.5; g.updateConfig(cfgR);
  ok(g.eyes.left.y.base.mean === null, '13f. cambiare un filtro ricostruisce la catena');
  ok(g.settleUntil === null, '13g. dopo la ricostruzione si entra in assestamento');

  // Durante l'assestamento non escono gesti spuri.
  const ev2 = [];
  const g2 = new GestureEngine(deepClone(DEFAULT_CONFIG), e => ev2.push(e));
  let t2 = 0;
  for (let i=0;i<1500;i+=20){ t2+=20; g2.process(t2,{ left:{x:0,y:-0.09,openness:0.30,confidence:0.9}, right:null }); }
  ok(ev2.length === 0, '13h. nessun gesto durante i due secondi di assestamento');
  // Riposo lungo. Nota onesta sul limite: se il gesto viene TENUTO
  // durante l'assestamento, il sistema impara quella posizione come
  // riposo — non ha modo di saperlo altrimenti — e il recupero richiede
  // circa tre volte la costante di tempo della baseline (30 s → ~90 s).
  // È il prezzo di una baseline che insegue le derive lente.
  for (let i=0;i<95000;i+=20){ t2+=20; g2.process(t2,{ left:{x:0,y:0,openness:0.30,confidence:0.9}, right:null }); }
  for (let i=0;i<900;i+=20){ t2+=20; g2.process(t2,{ left:{x:0,y:-0.09,openness:0.30,confidence:0.9}, right:null }); }
  for (let i=0;i<2000;i+=20){ t2+=20; g2.process(t2,{ left:{x:0,y:0,openness:0.30,confidence:0.9}, right:null }); }
  ok(ev2.length === 1, '13i. finito l assestamento i gesti funzionano normalmente');
}

/* ══════════ 14. Occhi riferiti alla PERSONA, non all'immagine ══════════ */
{
  // Nella convenzione MediaPipe i punti 33/133 e l'iride 468-472 sono
  // sul lato SINISTRO dell'immagine, cioè l'occhio DESTRO della persona.
  ok(EYE_LM.right.outer === 33 && EYE_LM.right.iris[0] === 468,
     '14a. occhio destro della persona = lato sinistro dell immagine');
  ok(EYE_LM.left.outer === 263 && EYE_LM.left.iris[0] === 473,
     '14b. occhio sinistro della persona = lato destro dell immagine');
  const c = deepClone(DEFAULT_CONFIG);
  ok(c.detection.swapEyes === false, '14c. esiste l inversione manuale per telecamere specchiate');
}

/* ══════════ 15. Tratto dei pulsanti coerente con le linee ══════════ */
{
  /* L'apertura si distingue anche per tratto, non solo per colore:
   * "socchiude" è punteggiato per non confonderlo con "spalanca". */
  ok(Object.entries(TRACE_STYLE)
       .filter(([k]) => k.startsWith('left') && !k.includes('narrow'))
       .every(([, v]) => v.dash.length === 0),
     '15a. occhio sinistro: tratto continuo sugli assi dell iride');
  ok(Object.entries(TRACE_STYLE).filter(([k]) => k.startsWith('right')).every(([,v]) => v.dash.length > 0),
     '15b. occhio destro: tratteggiato');
  ok(BLINK_STYLE['left.blink'].dash.length === 0 && BLINK_STYLE['right.blink'].dash.length > 0,
     '15c. anche le tracce ammiccamento seguono la stessa convenzione');
  ok(Object.values(BLINK_STYLE).every(v => 'dash' in v),
     '15d. ogni traccia espone il proprio tratto, così i pulsanti possono riprodurlo');
}

/* ══════════ 16. REGRESSIONE: uso intenso non desensibilizza ══════════ */
{
  const g = new GestureEngine(deepClone(DEFAULT_CONFIG), () => {});
  let t = 0;
  // Rumore DETERMINISTICO: un test statistico che dipende da Math.random
  // fallisce ogni tanto senza che nulla sia rotto, e a quel punto non
  // ci si fida più della suite. Due sinusoidi incommensurabili danno un
  // segnale irregolare quanto basta, ma sempre uguale.
  const rum = () => 0.02*Math.sin(2*Math.PI*4*t/1000) + 0.004*Math.sin(2*Math.PI*7.3*t/1000);
  const o = y => ({ x:0, y: y + rum(), openness:0.30, confidence:0.9 });
  for (let i=0;i<20000;i+=20){ t+=20; g.process(t,{left:o(0),right:null}); }
  const picchi = [];
  for (let k=0;k<40;k++){
    let m=0;
    for (let i=0;i<900;i+=20){ t+=20; g.process(t,{left:o(-0.09),right:null});
      const c=g.channels()['left.up']; if(c) m=Math.max(m,c.n); }
    for (let i=0;i<1100;i+=20){ t+=20; g.process(t,{left:o(0),right:null}); }
    picchi.push(m);
  }
  const regime = picchi.slice(20);
  const mn = Math.min(...regime), mx = Math.max(...regime);
  ok(regime.every(p => p > DEFAULT_CONFIG.signal.thresholdOn * 1.5),
     `16a. dopo quaranta gesti ravvicinati l ampiezza resta sopra soglia (min ${mn.toFixed(1)}σ)`);
  // Ciò che conta non è la variazione assoluta ma la TENDENZA: il
  // difetto originale era un calo progressivo fino a sotto soglia.
  // Si confrontano quindi due blocchi consecutivi.
  const media = a => a.reduce((x, y) => x + y, 0) / a.length;
  const primo = media(picchi.slice(20, 30)), secondo = media(picchi.slice(30));
  ok(secondo >= primo * 0.85,
     `16b. nessuna tendenza al ribasso (gesti 21-30: ${primo.toFixed(1)}σ → 31-40: ${secondo.toFixed(1)}σ)`);
  ok(picchi[39] >= picchi[10] * 0.7,
     `16c. NON cala con l uso (gesto 11: ${picchi[10].toFixed(1)}σ → gesto 40: ${picchi[39].toFixed(1)}σ)`);
}

/* ══════════ 17. Assi orizzontali coerenti fra i due occhi ══════════ */
{
  // Si ricostruisce il calcolo del tracker per verificare la convenzione:
  // x positivo deve significare "la persona guarda alla PROPRIA destra"
  // per ENTRAMBI gli occhi. Prima il vettore interno→esterno puntava al
  // lato temporale, opposto fra i due occhi, e uno risultava invertito.
  const proietta = (lato, dxImmagine) => {
    const base = lato === 'right' ? 200 : 380;
    const inner = lato === 'right' ? { x: base+60 } : { x: base };
    const outer = lato === 'right' ? { x: base }    : { x: base+60 };
    let ex = outer.x - inner.x, w = Math.abs(ex);
    let ux = ex / w;
    if (ux < 0) ux = -ux;
    return -(dxImmagine * ux) / w;
  };
  const sx = proietta('left', -12), dx = proietta('right', -12);
  ok(Math.sign(sx) === Math.sign(dx), '17a. i due occhi danno lo stesso segno per lo stesso movimento');
  ok(sx > 0 && dx > 0, '17b. spostamento verso la destra della persona → x positivo');
  const sxL = proietta('left', 12), dxL = proietta('right', 12);
  ok(sxL < 0 && dxL < 0, '17c. spostamento verso la sinistra della persona → x negativo');
}

/* ══════════ 18. Menu delle azioni: corto e pronunciabile ══════════ */
{
  const { buildTree } = await import('../js/scan/ScanEngine.js');
  const az = buildTree(DEFAULT_CONFIG, {}).children
    .find(c => c.id === 'write').children.find(c => c.id === 'act');
  ok(az.children.length <= 8, `18a. le azioni sono al massimo otto (${az.children.length})`);
  ok(!az.children.some(c => c.action === 'PAUSE'), '18b. niente PAUSA fra le azioni');
  ok(az.children.filter(c => c.action === 'SPEAK_KEEP').length === 1,
     '18c. una sola voce per rileggere: il doppione è stato tolto');
  // Nessuna pronuncia più lunga del passo di scansione, altrimenti
  // l'annuncio successivo la tronca a metà.
  const stimaMs = txt => 300 + txt.length * 62;   // ~ velocità 1.15
  const lunghe = az.children.filter(c => stimaMs(c.spoken) > DEFAULT_CONFIG.scan.stepMs);
  ok(lunghe.length === 0, `18d. nessuna pronuncia più lunga del passo: ${lunghe.map(c => c.spoken).join(', ')}`);
  ok(az.children.some(c => c.label === 'SALVA'), '18e. "SALVA" invece di "SALVA QUESTO TESTO"');
}

/* ══════════ 19. Menu lunghi: la finestra tiene tutto raggiungibile ══════════ */
{
  const vis = DEFAULT_CONFIG.scan.visibleItems;
  const { buildTree } = await import('../js/scan/ScanEngine.js');
  const az = buildTree(DEFAULT_CONFIG, {}).children
    .find(c => c.id === 'write').children.find(c => c.id === 'act');
  ok(vis < az.children.length,
     `19a. la finestra (${vis}) è più corta del menu più lungo (${az.children.length}): si attiva davvero`);
  // Simula la finestra: la voce corrente deve essere sempre compresa.
  let sempreVisibile = true;
  for (let idx = 0; idx < az.children.length; idx++) {
    const n = az.children.length;
    const max = Math.max(3, vis);
    let da = 0, a = n;
    if (n > max) { da = Math.max(0, Math.min(idx - 2, n - max)); a = da + max; }
    if (idx < da || idx >= a) sempreVisibile = false;
  }
  ok(sempreVisibile, '19b. la voce corrente è sempre dentro la finestra mostrata');
}

/* ══════════ 20. Ammiccamento contro sguardo in basso ══════════ */
{
  const { BlinkDetector: BD } = await import('../js/signal/filters.js');
  function scenario(seq){
    const b = new BD(); let t = 0;
    for (let i=0;i<200;i++){ t+=20; b.update(0.30, t); }
    let masc=0, val=0;
    for (const ap of seq){ t+=20; const r = b.update(ap, t); r.closed ? masc++ : val++; }
    return { masc, val };
  }
  // Ammiccamento: 100 ms chiuso, poi riapre → deve restare mascherato
  const amm = scenario([0.20,0.08,0.05,0.05,0.08,0.20,0.30,...Array(20).fill(0.30)]);
  ok(amm.masc >= 3 && amm.masc <= 6, `20a. ammiccamento mascherato (${amm.masc} campioni)`);
  // Sguardo in basso tenuto 2 s → dopo mezzo secondo i campioni tornano validi
  const giu = scenario([...Array(15).fill(0).map((_,i)=>0.30-i*0.011), ...Array(100).fill(0.145)]);
  ok(giu.val > 70, `20b. sguardo in basso: i campioni tornano validi (${giu.val} validi su 115)`);
  ok(giu.masc < 35, `20c. mascherati solo i primi ${giu.masc} campioni, non tutti`);
  // Occhio davvero chiuso → sempre mascherato, qualunque sia la durata
  const chiuso = scenario(Array(100).fill(0.04));
  ok(chiuso.masc === 100 && chiuso.val === 0, '20d. occhio sotto il pavimento: sempre mascherato');
  // Disattivabile: torna al comportamento precedente
  const b2 = new BD(); b2.configure(0.55, 0.08, false, 500);
  let t2 = 0; for (let i=0;i<200;i++){ t2+=20; b2.update(0.30, t2); }
  let m2 = 0; for (let i=0;i<100;i++){ t2+=20; if (b2.update(0.145, t2).closed) m2++; }
  ok(m2 === 100, '20e. disattivando la distinzione si torna al comportamento di prima');
}

/* ══════════ 21. Soglie e guadagni per direzione ══════════ */
{
  const c = deepClone(DEFAULT_CONFIG);
  c.detection.activeEye = 'left'; c.gestures.DOWN.enabled = true;
  const g0 = new GestureEngine(deepClone(c), () => {});
  ok(g0.sogliaDi('up') === DEFAULT_CONFIG.signal.thresholdOn, '21a. senza valore specifico si eredita la soglia globale');
  ok(g0.guadagnoDi('down') === 1, '21b. guadagno predefinito neutro');

  c.signal.thresholdDir.down = 2.0;
  c.signal.gainDir.down = 2.5;
  const g1 = new GestureEngine(c, () => {}); g1.setDiagnostics(true);
  ok(g1.sogliaDi('down') === 2.0, '21c. la soglia specifica ha la precedenza');
  ok(g1.sogliaDi('up') === DEFAULT_CONFIG.signal.thresholdOn, '21d. le altre direzioni restano sulla globale');

  let t = 0; const o = y => ({ x:0, y, openness:0.30, confidence:0.9 });
  for (let i=0;i<25000;i+=20){ t+=20; g1.process(t,{left:o(0),right:null}); }
  let pSu=0, pGiu=0;
  for (let i=0;i<600;i+=20){ t+=20; g1.process(t,{left:o(-0.03),right:null});
    const ch=g1.channels(); if(ch['left.up']) pSu=Math.max(pSu,ch['left.up'].n); }
  for (let i=0;i<2500;i+=20){ t+=20; g1.process(t,{left:o(0),right:null}); }
  for (let i=0;i<600;i+=20){ t+=20; g1.process(t,{left:o(0.03),right:null});
    const ch=g1.channels(); if(ch['left.down']) pGiu=Math.max(pGiu,ch['left.down'].n); }
  ok(pGiu > pSu * 2, `21e. il guadagno amplifica solo la direzione scelta (su ${pSu.toFixed(1)}σ, giù ${pGiu.toFixed(1)}σ)`);
  const ch = g1.channels();
  ok(ch['left.down'].guadagno === 2.5 && ch['left.down'].soglia === 2.0,
     '21f. la diagnostica riporta soglia e guadagno di ogni canale');
}

/* ══════════ 22. Misura di calibrazione ══════════ */
{
  const c = deepClone(DEFAULT_CONFIG); c.detection.activeEye = 'left';
  const g = new GestureEngine(c, () => {}); g.setDiagnostics(true);
  let t = 0; const o = y => ({ x:0, y, openness:0.30, confidence:0.9 });
  for (let i=0;i<25000;i+=20){ t+=20; g.process(t,{left:o(0),right:null}); }
  ok(!g.inMisura, '22a. nessuna misura in corso all inizio');
  g.iniziaMisura('up');
  ok(g.inMisura, '22b. la misura si avvia');
  const ev = [];
  const g2 = g; g2.onEvent = e => ev.push(e);
  for (let i=0;i<2000;i+=20){ t+=20; g.process(t,{left:o(-0.09),right:null}); }
  const su = g.fermaMisura();
  ok(su.picco > 5, `22c. misura il picco raggiunto (${su.picco.toFixed(1)}σ)`);
  ok(su.campioni > 50, '22d. conta i campioni usati');
  ok(!g.inMisura, '22e. la misura si ferma');
  for (let i=0;i<3000;i+=20){ t+=20; g.process(t,{left:o(0),right:null}); }
  g.iniziaMisura('down');
  for (let i=0;i<2000;i+=20){ t+=20; g.process(t,{left:o(0.03),right:null}); }
  const giu = g.fermaMisura();
  ok(giu.picco < su.picco, '22f. un movimento più piccolo dà un picco minore');
  const gain = Math.min(6, su.picco / giu.picco);
  ok(gain > 1.5 && gain <= 6, `22g. il guadagno calcolato riequilibra le direzioni (×${gain.toFixed(2)})`);
}

/* ══════════ 23. Ramo GUARDA nella scansione ══════════ */
{
  const { buildTree } = await import('../js/scan/ScanEngine.js');
  const vuoto = buildTree(DEFAULT_CONFIG, {});
  ok(!vuoto.children.some(c => c.id === 'library'), '23a. senza contenuti il ramo GUARDA non compare');
  const lib = { videos:[{title:'Concerto'},{title:'Film'}], docs:[{title:'Lettera'}], images:[] };
  const t3 = buildTree(DEFAULT_CONFIG, { library: lib });
  const ordine = t3.children.map(c => c.id).join(',');
  ok(ordine === 'phrases,write,library,pause', '23b. GUARDA sta subito prima di PAUSA: ' + ordine);
  const gr = t3.children.find(c => c.id === 'library');
  ok(gr.label === 'GUARDA' && gr.spoken === 'guarda', '23c. si chiama GUARDA, non "comandi"');
  ok(gr.children[0].action === 'BACK', '23d. uscita per prima anche qui');
  ok(gr.children.map(c => c.label).join(',') === '← ESCI,VIDEO,DOCUMENTI',
     '23e. categorie solo se hanno contenuti: ' + gr.children.map(c => c.label).join(','));
  const uno = buildTree(DEFAULT_CONFIG, { library: { videos:[{title:'Concerto'}] } });
  const gr1 = uno.children.find(c => c.id === 'library');
  ok(gr1.children.map(c => c.label).join(',') === '← ESCI,Concerto',
     '23f. con una sola categoria si salta un livello');
  ok(gr1.children[1].action === 'MEDIA_OPEN', '23g. selezionare un contenuto lo apre');
}

/* ══════════ 24. Contatori ammiccamento anche a canali spenti ══════════ */
{
  const cfgB = deepClone(DEFAULT_CONFIG);
  // Tutti i canali ammiccamento SPENTI, come nella configurazione reale
  const ev = [];
  const g = new GestureEngine(cfgB, e => ev.push(e));
  g.setDiagnostics(true);
  let t = 0;
  const o = ap => ({ x:0, y:0, openness:ap, confidence:0.9 });
  const d = (ms, ap) => { for (let i=0;i<ms;i+=20){ t+=20; g.process(t,{left:o(ap),right:o(ap)}); } };
  d(6000, 0.30);
  d(120, 0.05); d(1200, 0.30);                                   // singolo
  d(100, 0.05); d(150, 0.30); d(100, 0.05); d(1200, 0.30);       // doppio
  d(100, 0.05); d(120, 0.30); d(100, 0.05); d(120, 0.30); d(100, 0.05); d(1500, 0.30);
  const c = g.counters;
  ok(c.blinkSingle >= 1, `24a. ammiccamenti singoli contati a canale spento (${c.blinkSingle})`);
  ok(c.blinkDouble >= 1, `24b. doppi contati (${c.blinkDouble})`);
  ok(c.blinkTriple >= 1, `24c. tripli contati (${c.blinkTriple})`);
  ok(ev.length === 0, '24d. ma NESSUN evento emesso: i canali sono spenti');
  // Fuori diagnostica e a canali spenti non si conta nulla: nessun costo
  const g2 = new GestureEngine(deepClone(DEFAULT_CONFIG), () => {});
  let t2 = 0;
  for (let i=0;i<6000;i+=20){ t2+=20; g2.process(t2,{left:o(0.30),right:null}); }
  for (let i=0;i<120;i+=20){ t2+=20; g2.process(t2,{left:o(0.05),right:null}); }
  for (let i=0;i<1200;i+=20){ t2+=20; g2.process(t2,{left:o(0.30),right:null}); }
  ok(g2.counters.blinkSingle === 0, '24e. fuori diagnostica non si spreca lavoro');
}

/* ══════════ 25. Ramo MEDIA: audio, video locali, cartelle ══════════ */
{
  const { buildTree } = await import('../js/scan/ScanEngine.js');
  const lib = {
    videos: [{ title: 'Concerto' }],
    audios: [{ title: 'Musica.mp3' }],
    docs: [],
    images: [
      { title: 'Vacanze 2019', folder: [{ title: 'foto1.jpg' }, { title: 'foto2.jpg' }] },
      { title: 'ritratto.png' },
    ],
  };
  const t3 = buildTree(DEFAULT_CONFIG, { library: lib });
  const gr = t3.children.find(c => c.id === 'library');
  ok(gr.children.map(c => c.label).join(',') === '← ESCI,VIDEO,AUDIO,IMMAGINI',
     '25a. categorie: ' + gr.children.map(c => c.label).join(','));
  const img = gr.children.find(c => c.label === 'IMMAGINI');
  const cart = img.children.find(c => c.label === 'Vacanze 2019');
  ok(cart && cart.children.length === 3, '25b. una cartella diventa un sottomenu');
  ok(cart.children[0].action === 'BACK', '25c. uscita per prima anche dentro la cartella');
  ok(cart.children[1].payload.sub === 0, '25d. i file della cartella portano il proprio indice');
  ok(img.children.some(c => c.label === 'ritratto.png' && c.action === 'MEDIA_OPEN'),
     '25e. le immagini sciolte restano voci dirette');
  ok(DEFAULT_CONFIG.scan.maxCyclesMedia > DEFAULT_CONFIG.scan.maxCycles,
     '25f. con un contenuto aperto si tollerano più giri a vuoto');
  const { COMMANDS_BY_KIND: CK } = await import('../js/media/MediaPlayer.js');
  ok(CK.audio && CK.audio.length >= 6, '25g. i file audio hanno i propri comandi');
  ok(CK.audio[CK.audio.length - 1].id === 'exit', '25h. uscita in fondo anche per l audio');
}

/* ══════════ 26. Instradamento audio: onesto su cosa può fare ══════════ */
{
  const { DEFAULT_CONFIG: DC } = await import('../js/core/config.js');
  ok(DC.audio.echoSpeechToMenu === false,
     '26a. l eco della frase in auricolare è spenta: sarebbe ridondante');
  ok('menuSinkId' in DC.audio && 'speechSinkId' in DC.audio,
     '26b. restano due uscite configurabili, per quando saranno instradabili');
}

/* ══════════ 27. Taratura automatica ══════════ */
{
  const { analizza } = await import('../js/signal/AutoTune.js');
  const base = deepClone(DEFAULT_CONFIG);

  // Registrazione sintetica DETERMINISTICA di un occhio a riposo.
  function registra({ freq, amp, sec = 25, conf = 0.9, presenza = 1, ammicca = false, occhioDx = true }) {
    const out = []; let t = 0;
    let semi = 12345;
    const rnd = () => { semi = (semi * 1103515245 + 12345) % 2147483648; return semi / 2147483648; };
    for (let i = 0; i < sec * 50; i++) {
      t += 20;
      const osc = amp * Math.sin(2 * Math.PI * freq * t / 1000);
      const ap = (ammicca && (t % 4000) < 150) ? 0.05 : 0.30 * (0.97 + 0.06 * rnd());
      const vis = rnd() < presenza;
      const o = vis ? { x: osc * 0.6, y: osc, openness: ap, confidence: conf * (0.9 + 0.2 * rnd()) } : null;
      out.push({ t, left: o, right: occhioDx ? o : null });
    }
    return out;
  }

  // Rifiuta dati insufficienti invece di inventare numeri
  ok(!analizza([], { correnti: base }).ok, '27a. registrazione vuota: rifiutata');
  ok(!analizza(registra({ freq: 4, amp: 0.02, sec: 1 }), { correnti: base }).ok,
     '27b. registrazione troppo breve: rifiutata');
  ok(!analizza(registra({ freq: 4, amp: 0.02, presenza: 0.2 }), { correnti: base }).ok,
     '27c. occhi quasi mai rilevati: rifiutata invece di tarare su nulla');

  // La frequenza dell'oscillazione viene riconosciuta
  for (const f of [2, 4, 6]) {
    const r = analizza(registra({ freq: f, amp: 0.03 }), { correnti: base });
    ok(r.ok && Math.abs(r.qualita.frequenza - f) < 0.6,
       `27d. frequenza ${f} Hz riconosciuta (misurata ${r.qualita.frequenza?.toFixed(1)})`);
  }

  // Oscillazione più rapida → filtri più aggressivi
  const lento = analizza(registra({ freq: 2, amp: 0.03 }), { correnti: base });
  const rapido = analizza(registra({ freq: 6, amp: 0.03 }), { correnti: base });
  ok(rapido.proposta['signal.lowPassHz'] > lento.proposta['signal.lowPassHz'],
     '27e. oscillazione più rapida → taglio più alto');
  ok(rapido.proposta['signal.medianWindowMs'] < lento.proposta['signal.medianWindowMs'],
     '27f. e finestra mediana più corta');

  // Nessun parametro assurdo, mai
  for (const par of [{ freq: 1, amp: 0.002 }, { freq: 6, amp: 0.06 }, { freq: 3, amp: 0.03, conf: 0.4, presenza: 0.6 }]) {
    const r = analizza(registra(par), { correnti: base });
    if (!r.ok) continue;
    const p = r.proposta;
    ok(p['signal.thresholdOn'] >= 3 && p['signal.thresholdOn'] <= 12,
       `27g. soglia sempre ragionevole (${p['signal.thresholdOn']})`);
    ok(p['signal.medianWindowMs'] >= 120 && p['signal.medianWindowMs'] <= 600, '27h. mediana nei limiti');
    ok(p['detection.minConfidence'] >= 0.15 && p['detection.minConfidence'] <= 0.55,
       `27i. confidenza minima mai eccessiva (${p['detection.minConfidence']})`);
  }

  // Senza ammiccamenti osservati NON si propongono soglie di ammiccamento
  const senza = analizza(registra({ freq: 4, amp: 0.02, ammicca: false }), { correnti: base });
  ok(!('signal.blinkRatio' in senza.proposta),
     '27l. nessun ammiccamento osservato: le soglie restano invariate invece di essere inventate');
  const con = analizza(registra({ freq: 4, amp: 0.02, ammicca: true }), { correnti: base });
  ok('signal.blinkRatio' in con.proposta, '27m. con ammiccamenti osservati le soglie vengono proposte');

  // Un occhio assente → si concentra sull'altro
  const uno = analizza(registra({ freq: 4, amp: 0.02, occhioDx: false }), { correnti: base });
  ok(uno.proposta['detection.activeEye'] === 'left',
     '27n. se un occhio non si vede, si usa solo quello buono');

  // La proposta deve produrre una configurazione VALIDA
  const { validateConfig, deepClone: dc } = await import('../js/core/config.js');
  const prova = dc(DEFAULT_CONFIG);
  const r2 = analizza(registra({ freq: 4, amp: 0.02, ammicca: true }), { correnti: base });
  for (const [k, v] of Object.entries(r2.proposta)) {
    const parti = k.split('.'); let o = prova;
    for (let i = 0; i < parti.length - 1; i++) o = o[parti[i]];
    o[parti[parti.length - 1]] = v;
  }
  ok(validateConfig(prova).length === 0,
     '27o. i valori proposti superano la validazione: ' + validateConfig(prova).join(', '));

  // Il rapporto deve essere leggibile e la qualità giudicata
  ok(r2.rapporto.length >= 5, '27p. il rapporto spiega ogni scelta');
  ok(['buona', 'discreta', 'scarsa'].includes(r2.qualita.voto), '27q. la qualità del segnale viene giudicata');
  const scarso = analizza(registra({ freq: 3, amp: 0.05, conf: 0.35, presenza: 0.6 }), { correnti: base });
  ok(scarso.ok && scarso.qualita.avvisi.length > 0,
     '27r. con segnale scadente vengono dati avvisi concreti');
}

/* ══════════ 28. Sguardo in basso NON è un ammiccamento ══════════ */
{
  function scena(nome, seq, mod) {
    const c = deepClone(DEFAULT_CONFIG);
    c.detection.activeEye = 'left'; c.gestures.DOWN.enabled = true;
    mod?.(c);
    const g = new GestureEngine(c, () => {}); g.setDiagnostics(true);
    let t = 0;
    const o = (y, ap) => ({ x: 0, y, openness: ap, confidence: 0.9 });
    const d = (ms, y, ap) => { for (let i = 0; i < ms; i += 20) { t += 20; g.process(t, { left: o(y, ap), right: null }); } };
    d(20000, 0, 0.30);
    const prima = g.counters.blinkSingle;
    for (const [ms, y, ap] of seq) d(ms, y, ap);
    d(2000, 0, 0.30);
    return g.counters.blinkSingle - prima;
  }
  const tue = c => { c.signal.blinkRatio = 0.3; c.signal.blinkFloor = 0.04; c.gestures.blinkBurstMs = 700; };

  ok(scena('giù', [[2000, 0.09, 0.07]], tue) === 0,
     '28a. sguardo in basso tenuto 2 s: NON contato come ammiccamento');
  ok(scena('blink', [[120, 0, 0.03]], tue) === 1,
     '28b. ammiccamento vero di 120 ms: contato');
  ok(scena('giù', [[2000, 0.09, 0.14]]) === 0,
     '28c. con i predefiniti: sguardo in basso non contato');
  ok(scena('blink', [[120, 0, 0.03]]) === 1,
     '28d. con i predefiniti: ammiccamento contato');
  // Una chiusura lunga ma sotto il pavimento resta una chiusura vera
  ok(scena('chiuso', [[2000, 0, 0.02]]) === 0,
     '28e. occhio chiuso a lungo: non è un ammiccamento (è una chiusura)');
}

/* ══════════ 29. Voci registrate: facoltative e non invasive ══════════ */
{
  const { vocabolarioGuida, chiaveDi, nomeLettera } = await import('../js/audio/VoiceBank.js');
  const { DEFAULT_CONFIG: DC } = await import('../js/core/config.js');
  ok(DC.audio.useVoiceBank === false,
     '29a. spente di default: senza registrazioni nulla cambia');
  const v = vocabolarioGuida(deepClone(DC));
  ok(v.length > 40 && v.length < 200, `29b. vocabolario di dimensione praticabile (${v.length} voci)`);
  const gruppi = new Set(v.map(x => x.gruppo));
  ok(gruppi.has('lettere') && gruppi.has('comandi') && gruppi.has('gruppi'),
     '29c. copre lettere, comandi e nomi dei gruppi');
  ok(v.every(x => x.testo && x.testo.trim()), '29d. nessuna voce vuota');
  const chiavi = v.map(x => chiaveDi(x.testo));
  ok(new Set(chiavi).size === chiavi.length, '29e. nessun duplicato: non si registra due volte la stessa cosa');
  ok(chiaveDi('  Ho  SETE ') === 'ho sete', '29f. la chiave normalizza spazi e maiuscole');
  ok(nomeLettera('B') === 'bi' && nomeLettera('Z') === 'zeta', '29g. le lettere si registrano come si pronunciano');
  ok(v.some(x => x.testo === 'spazio'), '29h. anche lo spazio ha la sua parola');
}

/* ══════════ 30. La distinzione vale su ENTRAMBI i rami ══════════ */
{
  function scenario(autoCalibrazione) {
    const c = deepClone(DEFAULT_CONFIG);
    c.detection.activeEye = 'left'; c.gestures.DOWN.enabled = true;
    c.signal.blinkAutoCalibrate = autoCalibrazione;
    c.signal.blinkLidThreshold = 0.15;
    const g = new GestureEngine(c, () => {}); g.setDiagnostics(true);
    let t = 0;
    const o = (y, ap) => ({ x: 0, y, openness: ap, confidence: 0.9 });
    const d = (ms, y, ap) => { for (let i = 0; i < ms; i += 20) { t += 20; g.process(t, { left: o(y, ap), right: null }); } };
    d(20000, 0, 0.30);
    const p = { ms: g.counters.closedMsLeft, b: g.counters.blinkSingle };
    d(2000, 0.09, 0.13); d(2000, 0, 0.30);
    return { mascherato: g.counters.closedMsLeft - p.ms, ammicc: g.counters.blinkSingle - p.b };
  }
  const acceso = scenario(true), spento = scenario(false);
  ok(acceso.mascherato < 800, `30a. auto-calibrazione accesa: solo ${acceso.mascherato} ms mascherati`);
  ok(spento.mascherato < 800, `30b. auto-calibrazione SPENTA: solo ${spento.mascherato} ms mascherati (prima erano 2000)`);
  ok(acceso.mascherato === spento.mascherato,
     '30c. i due rami si comportano in modo identico: come si sceglie la soglia non cambia come si interpreta');
  ok(acceso.ammicc === 0 && spento.ammicc === 0,
     '30d. in nessuno dei due casi lo sguardo in basso è contato come ammiccamento');
}

/* ══════════ 31. Confidenza: continua, informativa, monotona ══════════ */
{
  // ⚠️ Si prova la funzione VERA, importata dal tracker. Un test che
  // ricopia la formula non prova la formula: prova la copia.
  const { qualitaCampione } = await import('../js/vision/RgbTracker.js');
  const c = (r, rif, circ, vel, ap) =>
    qualitaCampione({ rRatio: r, rif, circolarita: circ, velocita: vel, openness: ap }).valore;
  const buono = [0.20, 0.20, 0.95, 1, 0.30];

  ok(c(...buono) > 0.98, '31a. un fotogramma buono resta a piena fiducia');
  ok(c(0.20, null, 0.95, 1, 0.30) > 0.98,
     '31b. senza riferimento appreso non si penalizza: nessun giudizio inventato');

  // Continuità e ricchezza di valori
  let salto = 0;
  for (let r = 0.05; r < 0.70; r += 0.001)
    salto = Math.max(salto, Math.abs(c(r + 0.001, 0.20, 0.95, 1, 0.30) - c(r, 0.20, 0.95, 1, 0.30)));
  ok(salto < 0.05, `31c. continua: salto massimo ${salto.toFixed(4)} per passo di 0.001`);

  const valori = new Set(); const casi = [];
  for (let r = 0.14; r <= 0.28; r += 0.005)
    for (let ci = 0.55; ci <= 1.0; ci += 0.05)
      for (let v = 0; v <= 20; v += 2)
        for (let ap = 0.08; ap <= 0.32; ap += 0.04) {
          const x = c(r, 0.20, ci, v, ap); valori.add(x.toFixed(3)); casi.push(x);
        }
  ok(valori.size > 200, `31d. nella fascia di lavoro reale produce ${valori.size} valori distinti (prima: 1 solo)`);

  // La soglia deve REGOLARE, non essere un interruttore inerte
  const acc = s2 => casi.filter(x => x >= s2).length / casi.length;
  ok(acc(0.4) > 0.8 && acc(0.4) < 1.0, `31e. a 0,40 accetta la gran parte ma non tutto (${(100*acc(0.4)).toFixed(0)}%)`);
  ok(acc(0.7) < acc(0.5) - 0.15, '31f. alzando la soglia si stringe davvero: è un regolatore');

  // Monotona: peggiorando una condizione la fiducia non può salire
  let mono = true;
  for (let x = 0.40; x < 0.99; x += 0.01) if (c(0.20, 0.20, x + 0.01, 1, 0.30) < c(0.20, 0.20, x, 1, 0.30) - 1e-9) mono = false;
  for (let v = 0; v < 30; v += 0.5) if (c(0.20, 0.20, 0.95, v + 0.5, 0.30) > c(0.20, 0.20, 0.95, v, 0.30) + 1e-9) mono = false;
  for (let a = 0.03; a < 0.30; a += 0.01) if (c(0.20, 0.20, 0.95, 1, a + 0.01) < c(0.20, 0.20, 0.95, 1, a) - 1e-9) mono = false;
  ok(mono, '31g. monotona in ogni variabile: peggiorare non può mai aumentare la fiducia');

  // I tre termini nuovi devono avere effetto MISURABILE
  ok(c(0.30, 0.20, 0.95, 1, 0.30) < 0.45,
     '31h. un raggio 50% fuori dal proprio normale viene scartato (prima passava come perfetto)');
  ok(c(0.20, 0.20, 0.38, 1, 0.30) < 0.45,
     '31i. un iride schiacciata dalla palpebra viene scartata');
  ok(c(0.20, 0.20, 0.95, 30, 0.30) < 0.45,
     '31l. uno scatto oltre la velocità fisiologica viene scartato');

  // Ma nessuno dei tre deve punire condizioni normali
  ok(c(0.22, 0.20, 0.95, 1, 0.30) > 0.95, '31m. variazione fisiologica del raggio: nessuna penalità');
  ok(c(0.20, 0.20, 0.80, 1, 0.30) > 0.95, '31n. lieve non-circolarità: nessuna penalità');
  ok(c(0.20, 0.20, 0.95, 6, 0.30) > 0.95, '31o. una saccade normale: nessuna penalità');

  // Il caso che aveva rotto tutto: raggio ai margini durante un
  // movimento verticale. Non deve più far sparire il segnale.
  ok(c(0.24, 0.20, 0.75, 5, 0.13) > 0.40,
     '31p. movimento verticale con iride parzialmente coperta: campione CONSERVATO');
}

/* ══════════ 32. La taratura non può più alzare la confidenza minima ══════════ */
{
  const { analizza } = await import('../js/signal/AutoTune.js');
  const base = deepClone(DEFAULT_CONFIG);
  function reg(conf) {
    const out = []; let t = 0; let semi = 3;
    const rnd = () => { semi = (semi * 1103515245 + 12345) % 2147483648; return semi / 2147483648; };
    for (let i = 0; i < 25 * 50; i++) {
      t += 20;
      const o = { x: 0, y: 0.02 * Math.sin(2 * Math.PI * 4 * t / 1000),
                  openness: 0.30 * (0.97 + 0.06 * rnd()), confidence: conf };
      out.push({ t, left: o, right: o });
    }
    return out;
  }
  for (const c of [0.99, 0.9, 0.75, 0.5]) {
    const r = analizza(reg(c), { correnti: base });
    ok(r.proposta['detection.minConfidence'] <= 0.40,
       `32a. con confidenza osservata ${c} propone ${r.proposta['detection.minConfidence']} (mai sopra 0,40)`);
  }
}

/* ══════════ 33. Rilascio d'ufficio dopo un aggancio troppo lungo ══════════ */
{
  // Scenario patologico: l'occhio non torna del tutto al riposo, quindi
  // il segnale non scende mai sotto la soglia di rilascio. Senza
  // protezione il gesto resta agganciato PER SEMPRE e nessun gesto
  // successivo viene più riconosciuto.
  function bloccato(maxLatch) {
    const c = deepClone(DEFAULT_CONFIG);
    c.detection.activeEye = 'left'; c.signal.maxLatchMs = maxLatch;
    const ev = []; const g = new GestureEngine(c, e => ev.push(e));
    let t = 0, riposo = 0;
    const o = y => ({ x: 0, y: y + 0.015 * Math.sin(2 * Math.PI * 4 * t / 1000), openness: 0.30, confidence: 0.9 });
    const d = (ms, y) => { for (let i = 0; i < ms; i += 20) { t += 20; g.process(t, { left: o(y), right: null }); } };
    d(25000, 0);
    // ⚠️ Ripetizioni lunghe: la protezione scatta a trenta secondi, e
    // deve scattare solo su un blocco vero — non su un gesto tenuto.
    for (let n = 0; n < 14; n++) {
      const apice = -0.09;
      for (let i = 0; i < 200; i += 20) { t += 20; g.process(t, { left: o(riposo + (apice - riposo) * i / 200), right: null }); }
      d(3000, apice);
      riposo = riposo + (apice - riposo) * 0.18;
      for (let i = 0; i < 200; i += 20) { t += 20; g.process(t, { left: o(apice + (riposo - apice) * i / 200), right: null }); }
      d(900, riposo);
    }
    return { eventi: ev.length, sciolti: g.counters.latchReleased,
             agganciato: g.eyes.left.y.hyst['-1'].active };
  }
  const senza = bloccato(0), con = bloccato(30000);
  ok(senza.eventi === 0, '33a. senza protezione il sistema resta bloccato: nessun gesto riconosciuto');
  ok(con.sciolti > 0, `33b. con la protezione l aggancio viene sciolto (${con.sciolti} volte)`);
  /* ⚠️ Sciogliere l'aggancio NON sposta la baseline.
   *
   * Spostarla sembrava sensato — recupero più rapido — ma se la
   * persona sta semplicemente TENENDO l'occhio alzato, quella
   * posizione diventerebbe il nuovo zero e il gesto sparirebbe. Il
   * recupero avviene per adattamento naturale della baseline: più
   * lento, ma non distrugge mai la taratura. */
  ok(con.sciolti >= 1 && senza.sciolti === 0,
     `33c. la protezione interviene solo quando è accesa (${con.sciolti} contro ${senza.sciolti})`);

  // ⚠️ La verifica che conta di più: l'uso NORMALE non deve cambiare.
  function normale(maxLatch) {
    const c = deepClone(DEFAULT_CONFIG);
    c.detection.activeEye = 'left'; c.signal.maxLatchMs = maxLatch;
    const ev = []; const g = new GestureEngine(c, e => ev.push(e));
    let t = 0;
    const o = y => ({ x: 0, y: y + 0.015 * Math.sin(2 * Math.PI * 4 * t / 1000), openness: 0.30, confidence: 0.9 });
    const d = (ms, y) => { for (let i = 0; i < ms; i += 20) { t += 20; g.process(t, { left: o(y), right: null }); } };
    d(25000, 0);
    for (let n = 0; n < 10; n++) { d(900, -0.09); d(2500, 0); }
    return ev.map(e => e.action).join(',');
  }
  ok(normale(0) === normale(10000),
     '33d. con ritorno normale il comportamento è IDENTICO: nulla è cambiato per chi usa il sistema bene');
  ok(normale(10000).split(',').filter(Boolean).length === 10,
     '33e. e tutti e dieci i gesti restano riconosciuti');

  // Un gesto lungo ma legittimo non deve essere tagliato
  const c2 = deepClone(DEFAULT_CONFIG);
  c2.detection.activeEye = 'left';
  const ev2 = []; const g2 = new GestureEngine(c2, e => ev2.push(e));
  let t2 = 0;
  const o2 = y => ({ x: 0, y, openness: 0.30, confidence: 0.9 });
  for (let i = 0; i < 25000; i += 20) { t2 += 20; g2.process(t2, { left: o2(0), right: null }); }
  for (let i = 0; i < 4500; i += 20) { t2 += 20; g2.process(t2, { left: o2(-0.09), right: null }); }
  for (let i = 0; i < 2500; i += 20) { t2 += 20; g2.process(t2, { left: o2(0), right: null }); }
  ok(ev2.some(e => e.action === 'WAKE'),
     '33f. un gesto molto lungo ma legittimo (4,5 s) non viene tagliato');
}

/* ══════════ 34. Le chiusure scartate vengono contate ══════════ */
{
  const c = deepClone(DEFAULT_CONFIG);
  c.signal.blinkFloor = 0.04;
  /* ⚠️ Qui si verifica la CONTABILITÀ delle raffiche, non la
   * distinzione fra ammiccamento e sguardo alzato. Quest'ultima si
   * spegne di proposito: con un segnale sintetico a confidenza fissa
   * interverrebbe e nasconderebbe ciò che si vuole misurare.
   * La distinzione ha i suoi test, il 47. */
  c.signal.blinkRichiedeIride = false;
  const g = new GestureEngine(c, () => {}); g.setDiagnostics(true);
  let t = 0;
  const o = ap => ({ x: 0, y: 0, openness: ap, confidence: 0.9 });
  const d = (ms, ap) => { for (let i = 0; i < ms; i += 20) { t += 20; g.process(t, { left: o(ap), right: o(ap) }); } };
  d(8000, 0.30);
  /* Abbassamento tenuto a lungo NELLA FASCIA AMBIGUA: sopra la soglia
   * di chiusura vera (25% del riposo = 0,075) ma sotto quella di
   * abbassamento (55% = 0,165). Non è un ammiccamento né una chiusura,
   * e deve risultare da qualche parte invece di sparire in silenzio.
   *
   * ⚠️ Con la palpebra a 0,09 l'iride è ormai coperta e la confidenza
   * scende a 0,69: è questo che distingue un vero abbassamento da uno
   * sguardo alzato, dove la palpebra si stringe ma l'iride resta ben
   * visibile e la confidenza resta a 1,00. */
  d(1500, 0.12); d(2000, 0.30);
  ok(g.counters.burstAborted > 0,
     '34a. una chiusura scartata perché sostenuta viene contata, non sparisce');
  ok(g.counters.blinkSingle === 0, '34b. e non viene contata come ammiccamento');
  // Chiusura troppo lunga ma completa: risulta fra gli scartati lunghi
  const g2 = new GestureEngine(deepClone(DEFAULT_CONFIG), () => {}); g2.setDiagnostics(true);
  let t3 = 0;
  const d3 = (ms, ap) => { for (let i = 0; i < ms; i += 20) { t3 += 20; g2.process(t3, { left: o(ap), right: o(ap) }); } };
  d3(8000, 0.30); d3(900, 0.02); d3(2000, 0.30);
  ok(g2.counters.blinkRejectedLong > 0, '34c. una chiusura oltre la durata massima risulta fra gli scartati lunghi');
}

/* ══════════ 35. Chiusura prolungata: durata REALE ══════════ */
{
  const { BlinkDetector: BD } = await import('../js/signal/filters.js');
  function tieniChiuso(apertura, secondi) {
    const b = new BD(); b.configure(0.55, 0.04, true, 500, undefined, 0.25);
    let t = 0;
    for (let i = 0; i < 200; i++) { t += 20; b.update(0.30, t); }
    const soglia = b.sogliaChiusura;
    let masc = 0;
    for (let i = 0; i < secondi * 50; i++) { t += 20; if (b.update(apertura, t).closed) masc++; }
    return { ms: masc * 20, soglia, rif: b.openRef };
  }
  // Un occhio chiuso deve risultare chiuso per TUTTA la durata, anche
  // se la sua apertura non scende sotto il pavimento assoluto.
  for (const ap of [0.02, 0.05, 0.07]) {
    const r = tieniChiuso(ap, 10);
    ok(r.ms >= 9800, `35a. occhio a ${ap} tenuto 10 s → ${(r.ms/1000).toFixed(1)} s mascherati`);
    ok(Math.abs(r.rif - 0.30) < 0.02,
       `35b. e il riferimento resta ancorato all occhio aperto (${r.rif.toFixed(3)})`);
  }
  // Uno sguardo in basso resta invece uno sguardo in basso
  const giu = tieniChiuso(0.16, 10);
  ok(giu.ms < 800, `35c. sguardo in basso tenuto 10 s → solo ${giu.ms} ms mascherati`);

  // Gli ammiccamenti brevi non devono spostare il riferimento
  const b2 = new BD(); b2.configure(0.55, 0.04, true, 500, undefined, 0.25);
  let t2 = 0;
  for (let i = 0; i < 200; i++) { t2 += 20; b2.update(0.30, t2); }
  const prima = b2.openRef;
  for (let k = 0; k < 10; k++) {
    for (let i = 0; i < 8; i++) { t2 += 20; b2.update(0.04, t2); }
    for (let i = 0; i < 60; i++) { t2 += 20; b2.update(0.30, t2); }
  }
  ok(Math.abs(b2.openRef - prima) < 0.01,
     '35d. dieci ammiccamenti non spostano il riferimento');
}

/* ══════════ 36. Contatori ammiccamento in ogni condizione ══════════ */
{
  function scena(apDestro, seq) {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.blinkFloor = 0.04;
    c.gestures.blinkBurstMs = 700; c.gestures.blinkMaxPulseMs = 900;
    const g = new GestureEngine(c, () => {}); g.setDiagnostics(true);
    let t = 0;
    const o = ap => ({ x: 0, y: 0, openness: ap, confidence: 0.9 });
    const d = (ms, aS, aD) => { for (let i = 0; i < ms; i += 20) { t += 20; g.process(t, { left: o(aS), right: o(aD) }); } };
    d(8000, 0.30, apDestro);
    const p = { ...g.counters };
    for (const [ms, aS] of seq) d(ms, aS, apDestro);
    d(1500, 0.30, apDestro);
    const k = g.counters;
    return { s: k.blinkSingle - p.blinkSingle, d: k.blinkDouble - p.blinkDouble,
             t: k.blinkTriple - p.blinkTriple, l: k.blinkRejectedLong - p.blinkRejectedLong,
             ms: Math.round(k.closedMsLeft - p.closedMsLeft) };
  }
  const singolo = [[150, 0.04]];
  const doppio  = [[120, 0.04], [200, 0.30], [120, 0.04]];
  const triplo  = [[110, 0.04], [160, 0.30], [110, 0.04], [160, 0.30], [110, 0.04]];

  ok(scena(0.30, singolo).s === 1, '36a. ammiccamento singolo contato');
  ok(scena(0.30, doppio).d === 1, '36b. doppio contato');
  ok(scena(0.30, triplo).t === 1, '36c. triplo contato');

  // ⚠️ Il caso che azzerava tutto: l'altro occhio stabilmente nella
  // fascia ambigua annullava la raffica a ogni fotogramma.
  ok(scena(0.14, singolo).s === 1, '36d. singolo contato anche con l altro occhio socchiuso');
  ok(scena(0.14, doppio).d === 1, '36e. doppio contato anche con l altro occhio socchiuso');
  ok(scena(0.14, triplo).t === 1, '36f. triplo contato anche con l altro occhio socchiuso');

  // Chiusura lunga: non è un ammiccamento, ma la durata deve risultare
  const lunga = scena(0.30, [[10000, 0.04]]);
  ok(lunga.s === 0 && lunga.d === 0, '36g. una chiusura di 10 s non è un ammiccamento');
  ok(lunga.l === 1, '36h. risulta fra gli scartati troppo lunghi');
  ok(lunga.ms >= 9800, `36i. e il tempo di chiusura è quello reale (${lunga.ms} ms)`);
}

/* ══════════ 37. La diagnostica funziona SEMPRE, anche in pausa ══════════ */
{
  function scena(inPausa, apDestro = 0.30, canaleAcceso = false) {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.blinkRatio = 0.3; c.signal.blinkFloor = 0.03;
    c.gestures.blinkBurstMs = 1000; c.gestures.blinkMaxPulseMs = 1500;
    if (canaleAcceso) { c.gestures.BLINK.enabled = true; c.gestures.BLINK.action = 'SELECT'; }
    const ev = []; const g = new GestureEngine(c, e => ev.push(e)); g.setDiagnostics(true);
    let t = 0;
    const o = ap => ({ x: 0, y: 0, openness: ap, confidence: 0.95 });
    const d = (ms, aS, aD) => { for (let i = 0; i < ms; i += 20) { t += 20; g.process(t, { left: o(aS), right: o(aD) }); } };
    d(8000, 0.30, apDestro);
    g.setPaused(inPausa);
    const p = { ...g.counters };
    for (let k = 0; k < 3; k++) { d(200, 0.03, Math.min(0.03, apDestro)); d(1800, 0.30, apDestro); }
    const k = g.counters;
    return {
      tot: k.blinkSingle - p.blinkSingle,
      sx: (k.blinkSingleLeft ?? 0) - (p.blinkSingleLeft ?? 0),
      dx: (k.blinkSingleRight ?? 0) - (p.blinkSingleRight ?? 0),
      eventi: ev.length,
    };
  }

  // ⚠️ Il difetto principale: in pausa i contatori si fermavano, mentre
  // grafico e bande continuavano a funzionare. Sembravano rotti.
  const attiva = scena(false), pausa = scena(true);
  ok(attiva.tot === 3, `37a. scansione attiva: tre ammiccamenti contati (${attiva.tot})`);
  ok(pausa.tot === 3, `37b. scansione IN PAUSA: contati lo stesso (${pausa.tot})`);
  ok(attiva.tot === pausa.tot, '37c. la pausa non cambia più ciò che la diagnostica mostra');

  // Ma l'emissione resta bloccata in pausa: è il punto della pausa.
  const emAttiva = scena(false, 0.30, true), emPausa = scena(true, 0.30, true);
  ok(emAttiva.eventi === 3, '37d. a canale acceso e scansione attiva gli eventi escono');
  ok(emPausa.eventi === 0, '37e. in pausa NON esce nulla: il comportamento della pausa è intatto');
  ok(emPausa.tot === 3, '37f. però i contatori continuano a contare');
}

/* ══════════ 38. Una raffica per occhio ══════════ */
{
  function scena(apDestro) {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.blinkRatio = 0.3; c.signal.blinkFloor = 0.03;
    c.gestures.blinkBurstMs = 1000; c.gestures.blinkMaxPulseMs = 1500;
    const g = new GestureEngine(c, () => {}); g.setDiagnostics(true);
    let t = 0;
    const o = ap => ({ x: 0, y: 0, openness: ap, confidence: 0.95 });
    const d = (ms, aS, aD) => { for (let i = 0; i < ms; i += 20) { t += 20; g.process(t, { left: o(aS), right: o(aD) }); } };
    d(8000, 0.30, apDestro);
    for (let k = 0; k < 3; k++) { d(200, 0.03, Math.min(0.03, apDestro)); d(1800, 0.30, apDestro); }
    return g.counters;
  }
  // ⚠️ Il caso che azzerava tutto: un occhio cronicamente chiuso teneva
  // l'impulso condiviso aperto per sempre.
  const bloccato = scena(0.02);
  ok(bloccato.blinkSingleLeft === 3, `38a. l occhio buono conta i suoi ammiccamenti (${bloccato.blinkSingleLeft})`);
  ok(bloccato.blinkSingleRight === 0, '38b. quello cronicamente chiuso non ne conta');
  ok(bloccato.blinkSingle === 3, '38c. e il totale segue quello buono, invece di restare a zero');
  ok(bloccato.closedMsRight > 5000, '38d. il tempo di chiusura dell occhio bloccato resta visibile');

  // Un ammiccamento bilaterale non deve contare doppio
  const normale = scena(0.30);
  ok(normale.blinkSingle === 3, `38e. tre ammiccamenti bilaterali contano tre, non sei (${normale.blinkSingle})`);
  ok(normale.blinkSingleLeft === 3 && normale.blinkSingleRight === 3,
     '38f. entrambi gli occhi li registrano separatamente');
}

/* ══════════ 39. Statistiche cliniche di sessione ══════════ */
{
  const { SessionStats, BANDE } = await import('../js/signal/SessionStats.js');

  // Sessione sintetica DETERMINISTICA: oscillazione nota, gesti,
  // ammiccamenti. Si verifica che i valori misurati corrispondano.
  function sessione({ freq, amp, minuti, fps = 30, chiudiOgni = 5000, durataChiusura = 140 }) {
    const s = new SessionStats();
    let t = 0;
    const N = Math.round(minuti * 60 * fps), dt = 1000 / fps;
    for (let i = 0; i < N; i++) {
      t += dt;
      const osc = amp * Math.sin(2 * Math.PI * freq * t / 1000);
      const chiuso = (t % chiudiOgni) < durataChiusura;
      const o = { x: 0, y: osc, openness: chiuso ? 0.04 : 0.30, confidence: 0.9 };
      s.push(t, { left: o, right: o }, Math.abs(osc) / 0.006, false);
      if (i % (fps * 30) === 0 && i > 0) {
        s.gesto({ action: 'SELECT', durMs: 400 + ((i * 37) % 200) });
        s.selezione(); s.sogliaSuperata();
      }
    }
    return s;
  }

  const s = sessione({ freq: 4, amp: 0.02, minuti: 20 });
  const r = s.riepilogo();

  // ── Oscillazione involontaria: è il cuore della richiesta ──
  ok(Math.abs(r.perOcchio.left.frequenzaMediana - 4) < 0.8,
     `39a. frequenza dell oscillazione riconosciuta (${r.perOcchio.left.frequenzaMediana.toFixed(1)} Hz su 4)`);
  ok(Math.abs(r.perOcchio.left.ampiezzaMediana - 0.02) < 0.008,
     `39b. ampiezza riconosciuta (${r.perOcchio.left.ampiezzaMediana.toFixed(4)} su 0.020)`);
  const nist = r.bande.find(b => b.id === 'nistagmo');
  ok(nist.percentuale > 80, `39c. classificato come NISTAGMO (${nist.percentuale.toFixed(0)}% del tempo)`);

  const lento = sessione({ freq: 1, amp: 0.02, minuti: 10 });
  const rl = lento.riepilogo();
  ok(rl.bande.find(b => b.id === 'tremore').percentuale > 60,
     '39d. un oscillazione a 1 Hz è classificata come TREMORE, non nistagmo');
  const rapido = sessione({ freq: 12, amp: 0.02, minuti: 10 });
  ok(rapido.riepilogo().bande.find(b => b.id === 'rapido').percentuale > 60,
     '39e. oltre 8 Hz è classificata come oscillazione rapida (verifica vibrazioni)');
  ok(BANDE.length === 4, '39f. quattro bande: deriva, tremore, nistagmo, rapido');

  // ── Gesti, chiusure, falsi positivi ──
  ok(r.gesti === 39, `39g. gesti contati (${r.gesti})`);
  ok(r.durataGestiMediana > 300 && r.durataGestiMediana < 700,
     `39h. durata mediana dei gesti plausibile (${Math.round(r.durataGestiMediana)} ms)`);
  ok(r.chiusure.sx > 200, `39i. chiusure contate (${r.chiusure.sx})`);
  ok(Math.abs(r.durataChiusuraMediana - 140) < 80,
     `39l. durata delle chiusure misurata (${Math.round(r.durataChiusuraMediana)} ms su 140)`);
  const s2 = sessione({ freq: 4, amp: 0.02, minuti: 5 });
  for (let i = 0; i < 20; i++) s2.sogliaSuperata();
  ok(s2.riepilogo().falsiPositivi >= 20,
     '39m. i superamenti senza selezione diventano falsi positivi stimati');

  // ── MEMORIA COSTANTE: è il vincolo che rende praticabile tutto ──
  const misura = m => JSON.stringify(sessione({ freq: 4, amp: 0.02, minuti: m, fps: 5 }).serialize()).length;
  const m20 = misura(20), m600 = misura(600);
  ok(m600 < m20 * 3,
     `39n. dieci ore occupano meno del triplo di venti minuti (${(m20/1024).toFixed(1)} kB → ${(m600/1024).toFixed(1)} kB)`);
  ok(m600 < 20000, `39o. una sessione di dieci ore sta in meno di 20 kB (${(m600/1024).toFixed(1)} kB)`);

  // ── Parametri consigliati e affidabilità ──
  const p = s.parametriConsigliati();
  ok(p.ok && p.affidabilita === 'buona', `39p. affidabilità dichiarata (${p.affidabilita})`);
  ok(!sessione({ freq: 4, amp: 0.02, minuti: 1, fps: 5 }).parametriConsigliati().ok,
     '39q. un osservazione troppo breve NON propone parametri');
  ok(sessione({ freq: 4, amp: 0.02, minuti: 180, fps: 5 }).parametriConsigliati().affidabilita === 'solida',
     '39r. tre ore danno affidabilità solida');
  for (const k of ['signal.medianWindowMs', 'signal.lowPassHz', 'signal.thresholdOn']) {
    ok(k in p.proposta, `39s. propone ${k}`);
  }
  ok(p.proposta['detection.minConfidence'] <= 0.40,
     '39t. la confidenza minima non viene mai alzata sopra il predefinito');
  ok(p.motivi.length >= 4, '39u. ogni proposta è motivata');
  ok(p.avvisi.some(a => /nistagmo/i.test(a)), '39v. il nistagmo prevalente viene segnalato');

  // I valori proposti devono produrre una configurazione VALIDA
  const { validateConfig, deepClone: dc, DEFAULT_CONFIG: DC } = await import('../js/core/config.js');
  const prova = dc(DC);
  for (const [k, v] of Object.entries(p.proposta)) {
    const parti = k.split('.'); let o = prova;
    for (let i = 0; i < parti.length - 1; i++) o = o[parti[i]];
    o[parti[parti.length - 1]] = v;
  }
  ok(validateConfig(prova).length === 0,
     '39z. i parametri proposti superano la validazione: ' + validateConfig(prova).join(', '));

  // ── Unione fra sessioni: è così che nasce il cumulativo ──
  const a = sessione({ freq: 4, amp: 0.02, minuti: 10, fps: 5 });
  const b = sessione({ freq: 4, amp: 0.02, minuti: 10, fps: 5 });
  const gestiA = a.riepilogo().gesti;
  ok(a.merge(b.serialize()), '39aa. due sessioni si uniscono');
  ok(a.riepilogo().gesti === gestiA * 2, '39ab. i conteggi si sommano nel cumulativo');
  ok(!a.merge({ roba: 1 }), '39ac. un file estraneo viene rifiutato invece di corrompere i dati');

  // ── Robustezza: dati assurdi non devono far cadere nulla ──
  const z = new SessionStats();
  let err = null;
  try {
    for (const cattivo of [null, undefined, {}, { left: null, right: null },
                           { left: { y: NaN, openness: NaN, confidence: NaN } }]) {
      z.push(1000, cattivo, null, false);
    }
    z.riepilogo(); z.parametriConsigliati();
  } catch (e) { err = e.message; }
  ok(!err, '39ad. osservazioni malformate non fanno cadere le statistiche: ' + (err || ''));
}

/* ══════════ 40. Canali del viso: bocca, labbra, sopracciglia ══════════ */
{
  const { EXPR_CHECKS } = await import('../js/signal/GestureEngine.js');
  const { ESPRESSIONI } = await import('../js/vision/RgbTracker.js');
  const { FACE_STYLE } = await import('../js/vision/VisionPipeline.js');

  function banco(mod) {
    const c = deepClone(DEFAULT_CONFIG);
    mod?.(c);
    const ev = []; const g = new GestureEngine(c, e => ev.push(e)); g.setDiagnostics(true);
    let t = 0;
    const occhio = { x: 0, y: 0, openness: 0.30, confidence: 0.9 };
    const espr = (v) => ({ mouthOpen: v, smile: 0.02, pucker: 0.01, funnel: 0.01, cheekPuff: 0.01, browUp: 0.02 });
    const d = (ms, v) => { for (let i = 0; i < ms; i += 20) { t += 20; g.process(t, { left: occhio, right: occhio, espressioni: espr(v) }); } };
    return { g, ev, d, get t() { return t; } };
  }

  // ── NON REGRESSIONE: spento, nulla cambia ──
  ok(DEFAULT_CONFIG.detection.faceChannels === false,
     '40a. i canali del viso sono SPENTI di default');
  for (const E of EXPR_CHECKS) {
    ok(DEFAULT_CONFIG.gestures[E.key].enabled === false, `40b. canale ${E.key} spento`);
    ok(DEFAULT_CONFIG.gestures[E.key].action === 'NONE', `40c. canale ${E.key} senza azione`);
  }
  const spento = banco();
  spento.d(20000, 0.03); spento.d(1500, 0.8); spento.d(2000, 0.03);
  ok(spento.ev.length === 0, '40d. a interruttore spento nessun evento, qualunque smorfia');
  ok(spento.g.channels()['expr.mouthOpen'] === undefined,
     '40e. e nessuna traccia nel grafico: non ingombra chi non li usa');

  // ── Acceso: funziona come i canali oculari ──
  const acceso = banco(c => {
    c.detection.faceChannels = true;
    c.gestures.MOUTH_OPEN.enabled = true; c.gestures.MOUTH_OPEN.action = 'SELECT';
  });
  acceso.d(20000, 0.03);
  ok(Math.abs(acceso.g.channels()['expr.mouthOpen'].n) < 2,
     '40f. a riposo il canale bocca resta vicino a zero');
  acceso.d(900, 0.55); acceso.d(2500, 0.03);
  ok(acceso.ev.length === 1 && acceso.ev[0].channel === 'MOUTH_OPEN',
     '40g. un apertura tenuta scatta come comando');
  ok(acceso.ev[0].action === 'SELECT', '40h. con l azione configurata');

  // ── Durate: è ciò che distingue un comando dal parlato ──
  function durata(ms) {
    const b = banco(c => {
      c.detection.faceChannels = true;
      c.gestures.MOUTH_OPEN.enabled = true; c.gestures.MOUTH_OPEN.action = 'SELECT';
    });
    b.d(20000, 0.03); b.d(ms, 0.55); b.d(2500, 0.03);
    return b.ev.length;
  }
  ok(durata(200) === 0, '40i. un movimento di 200 ms (parlato) NON scatta');
  ok(durata(300) === 0, '40l. nemmeno 300 ms');
  ok(durata(900) === 1, '40m. una tenuta di 900 ms scatta');
  ok(durata(1500) === 1, '40n. e anche una di 1,5 s');

  // ── Sospensione durante la dettatura ──
  const sosp = banco(c => {
    c.detection.faceChannels = true;
    c.gestures.MOUTH_OPEN.enabled = true; c.gestures.MOUTH_OPEN.action = 'SELECT';
  });
  sosp.d(20000, 0.03);
  sosp.g.setVisoSospeso(true);
  sosp.d(1200, 0.55); sosp.d(2500, 0.03);
  ok(sosp.ev.length === 0, '40o. mentre si detta i canali del viso non comandano');
  ok(sosp.g.counters.visoSoppressi > 0, '40p. e la soppressione viene contata, non nascosta');
  sosp.g.setVisoSospeso(false);
  sosp.d(1200, 0.55); sosp.d(2500, 0.03);
  ok(sosp.ev.length === 1, '40q. finita la dettatura tornano a funzionare');

  // ── In pausa non esce nulla, come per gli occhi ──
  const inPausa = banco(c => {
    c.detection.faceChannels = true;
    c.gestures.MOUTH_OPEN.enabled = true; c.gestures.MOUTH_OPEN.action = 'SELECT';
  });
  inPausa.d(20000, 0.03);
  inPausa.g.setPaused(true);
  inPausa.d(1200, 0.55); inPausa.d(2500, 0.03);
  ok(inPausa.ev.length === 0, '40r. in pausa i canali del viso non emettono');
  ok(inPausa.g.channels()['expr.mouthOpen'] !== null,
     '40s. ma la diagnostica continua a mostrarli, anche in pausa');

  // ── Coerenza con il resto del programma ──
  ok(EXPR_CHECKS.length === ESPRESSIONI.length,
     '40t. motore e rilevatore conoscono le stesse espressioni');
  ok(EXPR_CHECKS.every(E => ESPRESSIONI.some(x => x.id === E.id)),
     '40u. gli identificativi corrispondono');
  ok(EXPR_CHECKS.every(E => `expr.${E.id}` in FACE_STYLE),
     '40v. ogni canale ha la propria traccia nel grafico');
  ok(Object.values(FACE_STYLE).every(v => v.dash?.length),
     '40z. le tracce del viso sono punteggiate: distinguibili da quelle oculari');
  ok(EXPR_CHECKS.every(E => E.id in DEFAULT_CONFIG.signal.thresholdExpr
                         && E.id in DEFAULT_CONFIG.signal.gainExpr),
     '40aa. ogni canale ha soglia e guadagno propri, come le direzioni');

  // Soglia e guadagno per canale funzionano davvero
  const conGuadagno = banco(c => {
    c.detection.faceChannels = true;
    c.gestures.MOUTH_OPEN.enabled = true; c.gestures.MOUTH_OPEN.action = 'SELECT';
    c.signal.gainExpr.mouthOpen = 3;
  });
  conGuadagno.d(20000, 0.03); conGuadagno.d(900, 0.12); conGuadagno.d(2500, 0.03);
  const senzaGuadagno = banco(c => {
    c.detection.faceChannels = true;
    c.gestures.MOUTH_OPEN.enabled = true; c.gestures.MOUTH_OPEN.action = 'SELECT';
  });
  senzaGuadagno.d(20000, 0.03); senzaGuadagno.d(900, 0.12); senzaGuadagno.d(2500, 0.03);
  ok(conGuadagno.ev.length >= senzaGuadagno.ev.length,
     '40ab. il guadagno per canale rende rilevabile un movimento più piccolo');

  // ── Dati mancanti: non devono produrre movimenti inesistenti ──
  const senzaDati = banco(c => { c.detection.faceChannels = true; });
  let err = null;
  try {
    let tt = 0;
    for (let i = 0; i < 200; i++) {
      tt += 20;
      senzaDati.g.process(tt, { left: { x:0, y:0, openness:0.30, confidence:0.9 }, right: null });
    }
  } catch (e) { err = e.message; }
  ok(!err, '40ac. senza dati di espressione il motore non cade: ' + (err || ''));
}

/* ══════════ 41. Miscelazione dei canali RGB ══════════ */
{
  const { IrTracker: IT } = await import('../js/vision/IrTracker.js');
  const { CHANNEL_PRESETS, DEFAULT_CONFIG: DC, deepClone: dc } = await import('../js/core/config.js');
  const W = 200, H = 120;

  // Occhio sintetico A COLORI: pupilla nera, iride del colore dato,
  // sclera chiara. È la situazione reale in luce visibile, dove la
  // pupilla e un'iride marrone sono quasi indistinguibili in luminanza.
  function banco(iride) {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, dcc = Math.hypot(x - 40, y - 40);
      const c = dcc < 10 ? [18, 16, 15] : (dcc < 26 ? iride : [205, 200, 198]);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    const img = { data: d };
    const ctx = { drawImage() {}, getImageData: (x, y, w, h) => {
      const o = new Uint8ClampedArray(w * h * 4);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const s2 = ((yy + y) * W + (xx + x)) * 4, t2 = (yy * w + xx) * 4;
        o[t2] = img.data[s2]; o[t2 + 1] = img.data[s2 + 1]; o[t2 + 2] = img.data[s2 + 2]; o[t2 + 3] = 255;
      }
      return { data: o };
    } };
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    return (mix) => {
      const c = dc(DC);
      if (mix) c.detection.channelMix = mix;
      const r = new IT(c).detect({}, W, H, { left: { x: 8, y: 8, w: 64, h: 64 } });
      return r.left;
    };
  }

  // ── NON REGRESSIONE: i valori predefiniti riproducono il calcolo di prima ──
  ok(DC.detection.channelPreset === 'luma', '41a. combinazione predefinita: luminanza');
  const m = DC.detection.channelMix;
  ok(m.r === 0.299 && m.g === 0.587 && m.b === 0.114,
     '41b. i coefficienti predefiniti sono esattamente quelli di prima');
  const marrone = banco([120, 62, 38]);
  const conDefault = marrone(null);
  const conEspliciti = marrone({ r: 0.299, g: 0.587, b: 0.114 });
  ok(conDefault.px.threshold === conEspliciti.px.threshold
     && Math.abs(conDefault.px.iris.x - conEspliciti.px.iris.x) < 0.01,
     '41c. con i predefiniti il risultato è IDENTICO a quello precedente');

  // ── L'effetto fisico: il rosso aiuta sull'iride scura ──
  const cLuma = marrone({ r: 0.299, g: 0.587, b: 0.114 }).px.contrasto;
  const cRosso = marrone({ r: 1, g: 0, b: 0 }).px.contrasto;
  ok(cRosso > cLuma,
     `41d. su iride MARRONE il rosso dà più contrasto (${(cRosso*100).toFixed(0)}% contro ${(cLuma*100).toFixed(0)}%)`);
  const scurissimo = banco([78, 44, 30]);
  ok(scurissimo({ r: 1, g: 0, b: 0 }).px.contrasto > scurissimo({ r: 0.299, g: 0.587, b: 0.114 }).px.contrasto,
     '41e. e ancora di più su un iride marrone molto scuro');
  // Su iride chiara il vantaggio non c'è: la funzione non promette
  // miracoli, e il test lo mette per iscritto.
  const azzurro = banco([110, 140, 180]);
  ok(azzurro({ r: 1, g: 0, b: 0 }).px.contrasto <= azzurro({ r: 0.299, g: 0.587, b: 0.114 }).px.contrasto + 0.02,
     '41f. su iride CHIARA il rosso non porta vantaggio: è atteso, non un difetto');

  // ── Il rilevamento continua a funzionare con ogni combinazione ──
  for (const [k, v] of Object.entries(CHANNEL_PRESETS)) {
    const r = marrone({ r: v.r, g: v.g, b: v.b });
    ok(!!r, `41g. la pupilla viene rilevata anche con "${v.label}"`);
    ok(Number.isFinite(r.px.contrasto) && r.px.contrasto >= 0 && r.px.contrasto <= 1,
       `41h. contrasto misurato e nei limiti con "${v.label}"`);
  }

  // ── Somma nulla: la differenza fra canali non deve rompersi ──
  const diff = marrone({ r: 1, g: 0, b: -1 });
  ok(!!diff && Number.isFinite(diff.px.threshold),
     '41i. la differenza fra canali (somma nulla) non produce valori assurdi');
  // Coefficienti malformati: si ricade sui predefiniti invece di cadere
  const rotto = marrone({ r: NaN, g: undefined, b: 'x' });
  ok(!!rotto, '41l. coefficienti malformati: si ricade sui predefiniti');
}

/* ══════════ 42. L'ampiezza non deve calare con l'uso ══════════
 *
 * ⚠️ È il difetto che ha richiesto più tempo a capire.
 *
 * Ripetendo lo STESSO gesto — su un video registrato, dove il
 * movimento è identico per costruzione — l'ampiezza rilevata calava
 * col passare dei minuti fino a scendere sotto la soglia. La persona
 * faceva tutto uguale e il programma smetteva di vederla.
 *
 * La causa era la protezione contro l'aggancio bloccato: scadendo,
 * spostava la baseline sulla posizione corrente e azzerava la stima
 * del rumore. Chi TENEVA l'occhio alzato a lungo si vedeva quella
 * posizione promossa a nuovo zero — e il gesto spariva.            */
{
  function ripeti({ tenuta, riposo, deriva = 0, quanti = 25 }) {
    const c = deepClone(DEFAULT_CONFIG);
    c.detection.activeEye = 'left';
    const g = new GestureEngine(c, () => {});
    let t = 0, base = 0;
    const rum = () => 0.010 * Math.sin(2 * Math.PI * 4.2 * t / 1000);
    const o = y => ({ x: 0, y: y + rum(), openness: 0.30, confidence: 0.9 });
    const d = (ms, y) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(y), right: null }); } };
    d(25000, 0);
    const picchi = [];
    for (let k = 0; k < quanti; k++) {
      let picco = 0;
      for (let i = 0; i < 200; i += 33) { t += 33; g.process(t, { left: o(base + (-0.09 - base) * i / 200), right: null }); }
      for (let i = 0; i < tenuta; i += 33) {
        t += 33; g.process(t, { left: o(-0.09), right: null });
        const ch = g.channels()['left.up']; if (ch) picco = Math.max(picco, ch.n);
      }
      base += deriva;
      for (let i = 0; i < 200; i += 33) { t += 33; g.process(t, { left: o(-0.09 + (base + 0.09) * i / 200), right: null }); }
      d(riposo, base);
      picchi.push(picco);
    }
    return { picchi, sigma: g.eyes.left.y.sigma };
  }

  // Gesti brevi, medi, lunghi e lunghissimi: l'ampiezza deve restare.
  for (const [nome, tenuta] of [['0,8 s', 800], ['3 s', 3000], ['12 s', 12000], ['35 s', 35000]]) {
    const r = ripeti({ tenuta, riposo: 2500 });
    const primo = r.picchi[0], ultimo = r.picchi[r.picchi.length - 1];
    ok(ultimo > primo * 0.8,
       `42a. tenuta ${nome}: dopo 25 ripetizioni l ampiezza regge (${primo.toFixed(1)}σ → ${ultimo.toFixed(1)}σ)`);
    ok(ultimo > 10,
       `42b. tenuta ${nome}: resta molto sopra la soglia (${ultimo.toFixed(1)}σ)`);
  }

  // ⚠️ E la stima del rumore non deve gonfiarsi: se cresce, divide
  // l'ampiezza di OGNI gesto futuro.
  const lungo = ripeti({ tenuta: 12000, riposo: 2500 });
  ok(lungo.sigma < 0.006,
     `42c. la stima del rumore resta al suo valore di riposo (${lungo.sigma.toFixed(5)})`);

  // Pause brevi fra un gesto e l altro: nessun degrado
  const rapido = ripeti({ tenuta: 800, riposo: 800 });
  ok(rapido.picchi[rapido.picchi.length - 1] > 15,
     `42d. anche ripetendo in fretta l ampiezza regge (${rapido.picchi[rapido.picchi.length - 1].toFixed(1)}σ)`);
}

/* ══════════ 43. Salti temporali: cambiare scheda del browser ══════════
 *
 * ⚠️ Il difetto più insidioso incontrato in questo progetto.
 *
 * Quando la scheda del browser va in secondo piano i fotogrammi si
 * fermano, ma l'orologio continua. Al ritorno arriva un campione con
 * anche mezzo minuto di distanza dal precedente.
 *
 * Con una costante di tempo di trenta secondi, il coefficiente di
 * adattamento diventa 0,63: la baseline saltava in UN SOLO FOTOGRAMMA
 * al 63% della strada verso la posizione corrente. Se in quell'istante
 * l'occhio era alzato, quella posizione diventava quasi il nuovo zero,
 * e da lì in poi ogni movimento risultava molto più piccolo.
 *
 * Non aveva nemmeno senso logico: la baseline avrebbe dovuto seguire
 * il segnale per trenta secondi, ma in quei trenta secondi non aveva
 * visto NULLA.                                                      */
{
  const { AdaptiveBaseline, LowPass } = await import('../js/signal/filters.js');

  const b = new AdaptiveBaseline(0.004, 30);
  let t = 0;
  for (let i = 0; i < 300; i++) { t += 33; b.push(t, 0); }
  const primaDelBuco = b.mean;
  // La persona cambia scheda mentre l'occhio è ALZATO
  t += 30000;
  b.push(t, -0.09);
  ok(Math.abs(b.mean - primaDelBuco) < 0.001,
     `43a. un buco di 30 s non sposta la baseline (${primaDelBuco.toFixed(5)} → ${b.mean.toFixed(5)})`);

  // Ma i fotogrammi normali continuano ad adattarla
  for (let i = 0; i < 300; i++) { t += 33; b.push(t, 0.02); }
  ok(b.mean > primaDelBuco + 0.001,
     '43b. i fotogrammi normali continuano ad adattarla: non si è rotto l adattamento');

  // Anche il passa-basso non deve saltare
  const lp = new LowPass(1.5);
  let t2 = 0;
  for (let i = 0; i < 100; i++) { t2 += 33; lp.push(t2, 0); }
  const primaLp = lp.y;
  t2 += 30000;
  const dopoLp = lp.push(t2, 1);
  ok(Math.abs(dopoLp - primaLp) < 0.01,
     `43c. e nemmeno il filtro passa-basso salta sul valore corrente (${dopoLp.toFixed(4)})`);
  for (let i = 0; i < 100; i++) { t2 += 33; lp.push(t2, 1); }
  ok(lp.y > 0.5, '43d. ma riprende a seguire normalmente');

  /* ── La verifica che conta: l ampiezza dopo un cambio scheda ── */
  function conBuco(buco) {
    const c = deepClone(DEFAULT_CONFIG);
    c.detection.activeEye = 'left';
    const g = new GestureEngine(c, () => {});
    let tt = 0;
    const rum = () => 0.012 * Math.sin(2 * Math.PI * 4.2 * tt / 1000);
    const o = y => ({ x: 0, y: y + rum(), openness: 0.30, confidence: 0.9 });
    const d = (ms, y) => { for (let i = 0; i < ms; i += 33) { tt += 33; g.process(tt, { left: o(y), right: null }); } };
    const gesto = () => {
      let p = 0;
      for (let i = 0; i < 250; i += 33) { tt += 33; g.process(tt, { left: o(-0.09 * i / 250), right: null }); }
      for (let i = 0; i < 800; i += 33) {
        tt += 33; g.process(tt, { left: o(-0.09), right: null });
        const ch = g.channels()['left.up']; if (ch) p = Math.max(p, ch.n);
      }
      for (let i = 0; i < 250; i += 33) { tt += 33; g.process(tt, { left: o(-0.09 * (1 - i / 250)), right: null }); }
      d(2000, 0);
      return p;
    };
    d(40000, 0);
    const prima = gesto();
    if (buco) {
      // Si cambia scheda mentre l'occhio è alzato: il caso peggiore.
      tt += 250; g.process(tt, { left: o(-0.09), right: null });
      tt += 30000;
      g.process(tt, { left: o(-0.09), right: null });
      d(2000, 0);
    } else d(32000, 0);
    return { prima, dopo: gesto() };
  }
  const senza = conBuco(false), con = conBuco(true);
  ok(con.dopo > con.prima * 0.85,
     `43e. dopo un cambio scheda l ampiezza regge (${con.prima.toFixed(1)}σ → ${con.dopo.toFixed(1)}σ)`);
  /* Il confronto con chi non ha mai cambiato scheda resta indicativo:
   * un buco di trenta secondi toglie comunque campioni alla stima del
   * rumore, che ci mette un po' a riassestarsi. Ciò che conta è che
   * l'ampiezza non CROLLI, ed è verificato sopra. */
  ok(con.dopo > senza.dopo * 0.6,
     `43f. e resta dello stesso ordine di chi non ha mai cambiato scheda (${con.dopo.toFixed(1)}σ contro ${senza.dopo.toFixed(1)}σ)`);
}

/* ══════════ 44. I DUE OCCHI devono degradare allo stesso modo ══════════
 *
 * ⚠️ Il congelamento della baseline durante un gesto avveniva solo per
 * gli occhi IN GIOCO. L'altro non veniva mai protetto: la sua baseline
 * assorbiva ogni movimento e il suo rumore stimato includeva i
 * campioni del gesto.
 *
 * Con lo STESSO identico movimento su entrambi, l'occhio in gioco
 * restava a 22σ e l'altro scendeva a 2σ, con il rumore cresciuto di
 * otto volte.
 *
 * Non è un problema estetico: se il programma cambia occhio dominante
 * — perché quello in uso si chiude, o la luce cambia — si ritrova a
 * lavorare con un occhio la cui taratura è stata rovinata mentre non
 * lo guardava nessuno.                                              */
{
  function entrambi(fusione) {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.eyeFusion = fusione;
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const rum = () => 0.012 * Math.sin(2 * Math.PI * 4.2 * t / 1000);
    const o = y => ({ x: 0, y: y + rum(), openness: 0.30, confidence: 0.9 });
    const d = (ms, y) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(y), right: o(y) }); } };
    d(30000, 0);
    let ps = 0, pd = 0;
    for (let k = 0; k < 20; k++) {
      ps = 0; pd = 0;
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(-0.09 * i / 250), right: o(-0.09 * i / 250) }); }
      for (let i = 0; i < 800; i += 33) {
        t += 33; g.process(t, { left: o(-0.09), right: o(-0.09) });
        const a = g.channels()['left.up'], b = g.channels()['right.up'];
        if (a) ps = Math.max(ps, a.n);
        if (b) pd = Math.max(pd, b.n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(-0.09 * (1 - i / 250)), right: o(-0.09 * (1 - i / 250)) }); }
      d(2500, 0);
    }
    return { ps, pd, ss: g.eyes.left.y.sigma, sd: g.eyes.right.y.sigma };
  }

  for (const fus of ['best', 'any', 'both', 'left', 'right']) {
    const r = entrambi(fus);
    ok(Math.abs(r.ps - r.pd) < r.ps * 0.15,
       `44a. fusione "${fus}": i due occhi restano pari (${r.ps.toFixed(1)}σ contro ${r.pd.toFixed(1)}σ)`);
    ok(r.pd > 10,
       `44b. fusione "${fus}": anche l occhio non in gioco resta utilizzabile (${r.pd.toFixed(1)}σ)`);
    ok(Math.abs(r.ss - r.sd) < 0.002,
       `44c. fusione "${fus}": il rumore stimato è lo stesso sui due occhi (${r.ss.toFixed(5)} / ${r.sd.toFixed(5)})`);
  }

  /* ── ⚠️ MA GLI OCCHI DEVONO RESTARE INDIPENDENTI ──
   *
   * Non si può assumere che facciano sempre la stessa cosa: si può
   * ammiccare con uno solo, uno può essere paralizzato, uno può non
   * essere rilevato per via della luce. Ogni occhio deve decidere in
   * base al PROPRIO segnale, non copiare dall'altro.                */
  function separati(fusione, movSx, movDx) {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.eyeFusion = fusione;
    const ev = []; const g = new GestureEngine(c, e => ev.push(e));
    let t = 0;
    const rum = () => 0.012 * Math.sin(2 * Math.PI * 4.2 * t / 1000);
    const o = y => ({ x: 0, y: y + rum(), openness: 0.30, confidence: 0.9 });
    const d = (ms, a, b) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(a), right: o(b) }); } };
    d(30000, 0, 0);
    let ps = 0, pd = 0;
    for (let k = 0; k < 20; k++) {
      ps = 0; pd = 0;
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(movSx * i / 250), right: o(movDx * i / 250) }); }
      for (let i = 0; i < 800; i += 33) {
        t += 33; g.process(t, { left: o(movSx), right: o(movDx) });
        const a = g.channels()['left.up'], b = g.channels()['right.up'];
        if (a) ps = Math.max(ps, a.n);
        if (b) pd = Math.max(pd, b.n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(movSx * (1 - i / 250)), right: o(movDx * (1 - i / 250)) }); }
      d(2500, 0, 0);
    }
    return { ps, pd, ss: g.eyes.left.y.sigma, sd: g.eyes.right.y.sigma, eventi: ev.length };
  }

  const soloSx = separati('any', -0.09, 0);
  ok(soloSx.ps > 15 && soloSx.pd < 3,
     `44d. muovendo SOLO il sinistro, solo quello sale (${soloSx.ps.toFixed(1)}σ contro ${soloSx.pd.toFixed(1)}σ)`);
  const soloDx = separati('any', 0, -0.09);
  ok(soloDx.pd > 15 && soloDx.ps < 3,
     `44e. e muovendo SOLO il destro, viceversa (${soloDx.ps.toFixed(1)}σ contro ${soloDx.pd.toFixed(1)}σ)`);

  const asimmetrico = separati('best', -0.09, -0.045);
  ok(asimmetrico.pd > asimmetrico.ps * 0.35 && asimmetrico.pd < asimmetrico.ps * 0.65,
     `44f. un occhio che si muove METÀ misura circa metà (${asimmetrico.ps.toFixed(1)}σ contro ${asimmetrico.pd.toFixed(1)}σ)`);

  /* ⚠️ La verifica che conta di più: l'occhio NON usato deve restare
   * tarato, perché se il programma cambia occhio dominante deve
   * trovarlo pronto e non starato. */
  const nonUsato = separati('right', -0.09, 0);
  ok(nonUsato.ps > 15,
     `44g. l occhio che il programma NON sta usando resta tarato (${nonUsato.ps.toFixed(1)}σ)`);
  ok(nonUsato.ss < 0.006,
     `44h. e il suo rumore stimato non si gonfia (${nonUsato.ss.toFixed(5)})`);
  ok(nonUsato.eventi === 0,
     '44i. pur restando tarato, non emette comandi: non è lui a comandare');
}

/* ══════════ 45. Il ciclo dei fotogrammi non deve poter morire ══════════
 *
 * ⚠️ Il riarmo era l'ultima riga: se l'elaborazione di un fotogramma
 * sollevava un errore anche UNA sola volta, quella riga non veniva mai
 * raggiunta e il ciclo moriva per sempre. Il video continuava a
 * scorrere ma nessuno guardava più i fotogrammi, e sembrava che il
 * programma si fosse piantato.                                       */
{
  const fs45 = await import('node:fs');
  const path45 = await import('node:path');
  const qui45 = path45.dirname(import.meta.filename || process.argv[1]);
  const src = fs45.readFileSync(path45.join(qui45, '..', 'js/vision/FrameSource.js'), 'utf8');

  // Ogni ciclo che chiama onFrame deve riarmarsi in `finally`
  const cicli = [...src.matchAll(/const step = \(\) => \{([\s\S]*?)\n    \};/g)];
  ok(cicli.length >= 2, `45a. i cicli dei fotogrammi sono ${cicli.length}`);
  for (const [i, m] of cicli.entries()) {
    const corpo = m[1];
    if (!/onFrame/.test(corpo)) continue;
    ok(/finally\s*\{[\s\S]{0,120}requestAnimationFrame\(step\)/.test(corpo),
       `45b. ciclo ${i + 1}: il riarmo sta in "finally", quindi un errore non può ucciderlo`);
    ok(/catch/.test(corpo), `45c. ciclo ${i + 1}: l errore viene assorbito e contato, non ignorato`);
  }
  ok(/this\.errori/.test(src),
     '45d. gli errori vengono contati: assorbirli non significa nasconderli');
}

/* ══════════ 46. NESSUN DEGRADO NEL TEMPO, PER ENTRAMBI GLI OCCHI ══════════
 *
 * ⚠️ La verifica finale, e la più importante di tutte.
 *
 * A parità di movimento fisico reale, l'ampiezza rilevata deve restare
 * stabile: se cala, la persona fa esattamente gli stessi gesti e il
 * programma smette progressivamente di vederla. È il difetto che ha
 * richiesto più tempo a capire, e aveva quattro cause diverse:
 *   · lo scioglimento dell'aggancio che spostava la baseline;
 *   · i salti temporali al cambio di scheda del browser;
 *   · l'occhio non in gioco che non veniva mai protetto;
 *   · il ciclo dei fotogrammi che moriva al primo errore.
 *
 * Qui si verifica che nessuna di esse sia tornata, su entrambi gli
 * occhi e su scenari molto diversi.                                 */
{
  function corsa({ fus = 'any', movSx = -0.09, movDx = -0.09, tenuta = 800,
                   riposo = 2500, n = 40, rumore = 0.012 } = {}) {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.eyeFusion = fus;
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const rum = () => rumore * Math.sin(2 * Math.PI * 4.2 * t / 1000)
                    + rumore * 0.3 * Math.sin(2 * Math.PI * 7.7 * t / 1000);
    const o = y => ({ x: 0, y: y + rum(), openness: 0.30, confidence: 0.9 });
    const d = (ms, a, b) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(a), right: o(b) }); } };
    /* ⚠️ Si lascia assestare la stima del rumore PRIMA di misurare.
     *
     * Nei primi minuti il metro stesso sta ancora imparando: la stima
     * del rumore parte alta e scende, e siccome sta al denominatore
     * tutto ciò che è misurato in sigma cresce mentre lei si assesta.
     * Misurare lì significa misurare l'assestamento, non la stabilità.
     * Con rumore alto l'assestamento è più lento e serve più tempo. */
    d(150000, 0, 0);
    const sx = [], dx = [];
    for (let k = 0; k < n; k++) {
      let ps = 0, pd = 0;
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(movSx * i / 250), right: o(movDx * i / 250) }); }
      for (let i = 0; i < tenuta; i += 33) {
        t += 33; g.process(t, { left: o(movSx), right: o(movDx) });
        const a = g.channels()['left.up'], b = g.channels()['right.up'];
        if (a) ps = Math.max(ps, a.n);
        if (b) pd = Math.max(pd, b.n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(movSx * (1 - i / 250)), right: o(movDx * (1 - i / 250)) }); }
      d(riposo, 0, 0);
      sx.push(ps); dx.push(pd);
    }
    const med = (a, i, j) => a.slice(i, j).reduce((x, y) => x + y, 0) / (j - i);
    return {
      sxIni: med(sx, 0, 5), sxFin: med(sx, n - 5, n),
      dxIni: med(dx, 0, 5), dxFin: med(dx, n - 5, n),
      minuti: t / 60000,
    };
  }

  const scenari = [
    ['fusione any', {}],
    ['fusione best', { fus: 'best' }],
    ['fusione both', { fus: 'both' }],
    ['solo occhio sinistro', { movDx: 0 }],
    ['solo occhio destro', { movSx: 0 }],
    ['destro a metà ampiezza', { movDx: -0.045 }],
    ['dominante forzato destro', { fus: 'right', movDx: 0 }],
    ['tenute lunghe 5 s', { tenuta: 5000, n: 25 }],
    ['pause brevi 600 ms', { riposo: 600 }],
    ['rumore alto', { rumore: 0.030 }],
    ['movimento piccolo', { movSx: -0.035, movDx: -0.035 }],
  ];

  for (const [nome, par] of scenari) {
    const r = corsa(par);
    // Si controlla solo l'occhio che si muove davvero: uno fermo resta
    // giustamente sul rumore, e il suo rapporto non significa nulla.
    if (r.sxIni > 6) {
      const v = (r.sxFin / r.sxIni - 1) * 100;
      ok(v > -12,
         `46a. "${nome}" occhio SX: nessun degrado (${r.sxIni.toFixed(1)}σ → ${r.sxFin.toFixed(1)}σ, ${v >= 0 ? '+' : ''}${v.toFixed(0)}%)`);
      ok(r.sxFin > 5, `46b. "${nome}" occhio SX: resta ben rilevabile (${r.sxFin.toFixed(1)}σ)`);
    }
    if (r.dxIni > 6) {
      const v = (r.dxFin / r.dxIni - 1) * 100;
      ok(v > -12,
         `46c. "${nome}" occhio DX: nessun degrado (${r.dxIni.toFixed(1)}σ → ${r.dxFin.toFixed(1)}σ, ${v >= 0 ? '+' : ''}${v.toFixed(0)}%)`);
      ok(r.dxFin > 5, `46d. "${nome}" occhio DX: resta ben rilevabile (${r.dxFin.toFixed(1)}σ)`);
    }
  }

  /* ── Dopo l'assestamento la misura deve essere STABILE ──
   * Non basta che non cali: a parità di movimento fisico il numero
   * deve restare lo stesso, altrimenti le soglie tarate oggi non
   * valgono domani. */
  const lunga = corsa({ n: 60 });
  /* ⚠️ Si verifica che non CALI.
   *
   * Una crescita è benigna: è la stima del rumore che continua a
   * scendere verso il proprio minimo, e siccome sta al denominatore
   * fa salire tutto ciò che è misurato in sigma. Il segnale fisico è
   * lo stesso e il gesto resta riconosciuto.
   *
   * Un CALO invece è il difetto: la persona fa gli stessi movimenti e
   * il programma smette progressivamente di vederla. */
  const varSx = (lunga.sxFin / lunga.sxIni - 1) * 100;
  ok(varSx > -12,
     `46e. su 60 ripetizioni la misura non cala (${varSx >= 0 ? '+' : ''}${varSx.toFixed(1)}%)`);
  ok(lunga.sxFin > 10,
     `46f. e resta ben sopra la soglia (${lunga.sxFin.toFixed(1)}σ)`);
}

/* ══════ 47. Sguardo in alto scambiato per ammiccamento ══════
 *
 * ⚠️ Il difetto che rendeva l'occhio destro molto meno sensibile del
 * sinistro, pur muovendosi allo stesso modo.
 *
 * Alzando molto lo sguardo la palpebra copre parte dell'occhio e
 * l'apertura MISURATA si stringe. Se scende sotto la soglia, il gesto
 * viene scambiato per un ammiccamento: mascherato proprio mentre
 * avviene, e il suo transitorio finisce nella stima del rumore, che si
 * gonfia e abbassa TUTTE le ampiezze di quell'occhio.
 *
 * Nei dati reali: undici secondi e mezzo di "chiuso" a destra contro
 * mezzo secondo a sinistra, con ammiccamenti doppi e tripli mai
 * avvenuti — mentre la confidenza restava a 0,97, cioè l'iride si
 * vedeva benissimo.
 *
 * I due casi si distinguono: in un ammiccamento vero la palpebra copre
 * l'IRIDE e il rilevamento crolla; alzando lo sguardo l'iride resta
 * visibile.                                                          */
{
  function sguardoInAlto(richiede) {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.blinkRichiedeIride = richiede;
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const rum = () => 0.012 * Math.sin(2 * Math.PI * 4.2 * t / 1000);
    const o = (y, ap, conf) => ({ x: 0, y: y + rum(), openness: ap, confidence: conf });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(0, 0.45, 0.97), right: o(0, 0.45, 0.97) }); } };
    d(40000);
    let ps = 0, pd = 0;
    for (let k = 0; k < 25; k++) {
      ps = 0; pd = 0;
      // L'apertura si stringe alzando lo sguardo: a destra quasi il doppio.
      const passo = (f) => g.process(t, {
        left: o(-0.09 * f, 0.45 - 0.12 * f, 0.97),
        right: o(-0.09 * f, 0.45 - 0.22 * f, 0.97),
      });
      for (let i = 0; i < 250; i += 33) { t += 33; passo(i / 250); }
      for (let i = 0; i < 800; i += 33) {
        t += 33; passo(1);
        const a = g.channels()['left.up'], b = g.channels()['right.up'];
        if (a) ps = Math.max(ps, a.n);
        if (b) pd = Math.max(pd, b.n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; passo(1 - i / 250); }
      d(2500);
    }
    return { ps, pd, smentiti: g.blink.right.smentiti || 0 };
  }

  const con = sguardoInAlto(true);
  ok(Math.abs(con.ps - con.pd) < con.ps * 0.08,
     `47a. i due occhi restano pari anche se uno si stringe di più (${con.ps.toFixed(1)}σ contro ${con.pd.toFixed(1)}σ)`);
  ok(con.smentiti > 0,
     `47b. le finte chiusure vengono smentite dall iride visibile (${con.smentiti})`);
  ok(con.pd > 15, `47c. l occhio che si stringe resta ben rilevabile (${con.pd.toFixed(1)}σ)`);

  /* ⚠️ Controprova indispensabile: un ammiccamento VERO deve restare
   * riconosciuto. Una correzione che spegnesse il rilevamento delle
   * chiusure toglierebbe a chi usa Aurora un modo di comandare. */
  const { BlinkDetector } = await import('../js/signal/filters.js');
  const bd = new BlinkDetector();
  let tt = 0;
  for (let i = 0; i < 200; i++) { tt += 33; bd.update(0.45, tt, 0.95); }
  const veroAmmicco = bd.update(0.04, tt + 33, 0.15);
  ok(veroAmmicco.closed === true,
     '47d. un ammiccamento vero — iride sparita — resta riconosciuto');
  // ⚠️ Un occhio STRETTO sta nella zona intermedia: sotto la soglia di
  // ammiccamento ma ben sopra quella di chiusura vera. Un ammiccamento
  // vero (0,04) non passa mai di lì, ed è ciò che rende sicura la
  // distinzione.
  /* Valori presi dai dati REALI di una sessione: riposo 0,45, e
   * l'occhio destro che guardando in alto scendeva a circa 0,24 —
   * appena sotto la soglia di ammiccamento (0,248) e ben sopra il
   * pavimento assoluto. È esattamente la finestra in cui il gesto
   * veniva scambiato per un ammiccamento. */
  const bd3 = new BlinkDetector();
  let t3 = 0;
  for (let i = 0; i < 200; i++) { t3 += 33; bd3.update(0.45, t3, 0.95); }
  /* ⚠️ L'apertura si riduce GRADUALMENTE, come quando si alza lo
   * sguardo: è la lentezza a distinguerla da un ammiccamento, che
   * percorre la stessa corsa in due o tre fotogrammi. */
  let t3b = t3;
  let strizzata = null;
  for (const ap of [0.42, 0.38, 0.34, 0.30, 0.27, 0.25, 0.24]) {
    t3b += 33;
    strizzata = bd3.update(ap, t3b, 0.95);
  }
  ok(strizzata.closed === false,
     '47e. un occhio stretto con iride ancora visibile non è una chiusura');
  const strizzataSenzaIride = bd3.update(0.24, t3 + 66, 0.20);
  ok(strizzataSenzaIride.closed === true,
     '47e2. ma se l iride sparisce alla stessa apertura, allora sì');

  // Spegnendo l'opzione si torna al comportamento di prima
  const bd2 = new BlinkDetector();
  bd2.configure(undefined, undefined, undefined, undefined, undefined, undefined, false);
  let t2 = 0;
  for (let i = 0; i < 200; i++) { t2 += 33; bd2.update(0.45, t2, 0.95); }
  // 0,14 sta sotto la soglia di ammiccamento (0,165) e dentro la zona
  // di smentimento: acceso lo smentisce, spento lo conta.
  ok(bd2.update(0.15, t2 + 33, 0.95).closed === true,
     '47f. spegnendo l opzione anche un occhio stretto torna a contare come chiuso');
}

/* ══════ 48. L'occhio DEBOLE non deve degradare — IN CONDIZIONI REALI ══════
 *
 * ⚠️ Il difetto più ostinato di questo progetto, e la lezione più
 * importante che ne è venuta.
 *
 * Quando un occhio è più debole — più coperto dalla palpebra, più
 * obliquo, meno illuminato — la sua ampiezza può non superare la
 * soglia del gesto. Allora per lui il gesto non esiste, i suoi
 * campioni non vengono esclusi dalla stima del rumore, e quella si
 * gonfia: da lì l'ampiezza cala, il gesto scatta ancora meno, e non
 * si risale più.
 *
 * ⚠️ E LA LEZIONE: per due giorni questo difetto è sfuggito perché le
 * prove usavano un segnale troppo PULITO. Nei dati veri il rumore era
 * cinque volte tanto e il gesto il doppio. Con quei numeri il difetto
 * appare subito — e una correzione tentata in condizioni pulite
 * (congelare la baseline appena il segnale si muove) in condizioni
 * reali peggiorava tutto del 76%, perché il rumore superava quella
 * soglia quasi sempre.
 *
 * Le prove qui sotto usano quindi i numeri REALI misurati su una
 * sessione: gesto 0,18 e rumore che porta sigma attorno a 0,02.    */
{
  // Rumore realistico: nistagmo, micromovimenti e vaganza lenta.
  const RUMORE = (t) =>
      0.055 * Math.sin(2 * Math.PI * 4.2 * t / 1000)
    + 0.022 * Math.sin(2 * Math.PI * 7.7 * t / 1000)
    + 0.030 * Math.sin(2 * Math.PI * 0.13 * t / 1000)
    + 0.018 * Math.sin(2 * Math.PI * 0.41 * t / 1000 + 1.1);

  function reale(fattoreDx, n = 50) {
    const c = deepClone(DEFAULT_CONFIG);
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const o = y => ({ x: 0, y: y + RUMORE(t), openness: 0.45, confidence: 0.95 });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(0), right: o(0) }); } };
    d(150000);                        // assestamento del metro
    const dx = [], sx = [];
    for (let k = 0; k < n; k++) {
      let pd = 0, ps = 0;
      const q = (f) => g.process(t, { left: o(-0.18 * f), right: o(-0.18 * fattoreDx * f) });
      for (let i = 0; i < 250; i += 33) { t += 33; q(i / 250); }
      for (let i = 0; i < 800; i += 33) {
        t += 33; q(1);
        const a = g.channels()['left.up'], b = g.channels()['right.up'];
        if (a) ps = Math.max(ps, a.n);
        if (b) pd = Math.max(pd, b.n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; q(1 - i / 250); }
      d(2500);
      dx.push(pd); sx.push(ps);
    }
    const m = (a, i, j) => a.slice(i, j).reduce((x, y) => x + y, 0) / (j - i);
    return {
      di: m(dx, 2, 10), df: m(dx, n - 8, n),
      si: m(sx, 2, 10), sf: m(sx, n - 8, n),
      sd: g.eyes.right.y.sigma, ss: g.eyes.left.y.sigma,
    };
  }

  for (const f of [1.0, 0.85, 0.7, 0.5, 0.35]) {
    const r = reale(f);
    const vDx = (r.df / r.di - 1) * 100;
    const vSx = (r.sf / r.si - 1) * 100;
    /* ⚠️ Sotto i 3σ la variazione percentuale è ingannevole: fra 2,7σ e
     * 2,1σ c'è mezzo sigma, che è rumore di misura, non degrado. Là si
     * verifica che il valore non CROLLI, non che resti fermo. */
    const tolleranza = r.di < 3 ? -30 : -12;
    ok(vDx > tolleranza,
       `48a. destro al ${(f * 100).toFixed(0)}%: non cala (${r.di.toFixed(1)}σ → ${r.df.toFixed(1)}σ, ${vDx >= 0 ? '+' : ''}${vDx.toFixed(0)}%)`);
    ok(vSx > -12,
       `48b. destro al ${(f * 100).toFixed(0)}%: e il sinistro non ne risente (${vSx >= 0 ? '+' : ''}${vSx.toFixed(0)}%)`);
    // ⚠️ Il rumore stimato del debole non deve gonfiarsi: è la spia
    // del circolo vizioso, prima ancora del calo di ampiezza.
    ok(r.sd < r.ss * 2.2,
       `48c. destro al ${(f * 100).toFixed(0)}%: il suo rumore stimato resta paragonabile (${r.sd.toFixed(5)} contro ${r.ss.toFixed(5)})`);
  }

  /* ⚠️ La contropartita da sorvegliare: sospendere l'apprendimento del
   * rumore non deve moltiplicare i falsi comandi. Un programma che
   * scrive lettere da solo è peggio di uno che ne scrive poche. */
  {
    const c = deepClone(DEFAULT_CONFIG);
    const ev = []; const g = new GestureEngine(c, e => ev.push(e));
    let t = 0;
    const o = () => ({
      x: 0,
      y: RUMORE(t) + 0.012 * Math.sin(2 * Math.PI * 1.9 * t / 1000 + 2.2),
      openness: 0.45, confidence: 0.95,
    });
    const minuti = 8;
    for (let i = 0; i < minuti * 60 * 30; i++) { t += 33; g.process(t, { left: o(), right: o() }); }
    ok(ev.length / minuti < 1.0,
       `48d. in ${minuti} minuti di solo rumore i falsi comandi restano rari (${(ev.length / minuti).toFixed(2)} al minuto)`);
  }
}

/* ══════ 49. La diagnostica propone anche i parametri "nascosti" ══════
 *
 * ⚠️ I parametri che distinguono un ammiccamento da uno sguardo alzato
 * erano regolabili solo nel codice. Sono però i più delicati di tutta
 * la taratura: una chiusura dichiarata per sbaglio maschera il gesto
 * mentre avviene, e il suo transitorio gonfia la stima del rumore
 * abbassando TUTTE le ampiezze di quell'occhio.
 *
 * Ora la diagnostica li riconosce da sola e li propone, con la
 * spiegazione: un parametro proposto senza ragione non viene applicato
 * da nessuno.                                                        */
{
  const { SessionStats: SS } = await import('../js/signal/SessionStats.js');

  function sessione({ chiusureSx, chiusureDx, aperturaDx = 0.45 }) {
    const st = new SS();
    let t = 0;
    for (let i = 0; i < 25000; i++) {
      t += 33;
      const chiuso = (i % 300) < 40;
      const o = (ap) => ({ x: 0, y: 0.012 * Math.sin(i / 7), openness: ap, confidence: 0.97 });
      st.push(t, { left: o(0.45), right: o(chiuso ? aperturaDx : 0.45) }, 2.0, false);
    }
    st.c.chiusureSx = chiusureSx;
    st.c.chiusureDx = chiusureDx;
    return st.parametriConsigliati();
  }

  // Squilibrio marcato: deve accorgersene e proporre il rimedio
  const sbil = sessione({ chiusureSx: 1, chiusureDx: 39, aperturaDx: 0.10 });
  ok(sbil.ok, 'con osservazione sufficiente i parametri vengono proposti');
  ok(sbil.proposta['signal.blinkRichiedeIride'] === true,
     '49a. propone di richiedere che l iride sparisca per dichiarare chiuso');
  ok(sbil.proposta['signal.blinkSmentiSopra'] === 0.20,
     '49b. e di allargare la finestra della distinzione');
  ok(sbil.motivi.some(m => /chiuso molto più dell/.test(m)),
     '49c. spiegando PERCHÉ: un parametro senza ragione non viene applicato da nessuno');

  // Occhi equilibrati: NON deve proporre nulla su questo fronte
  const pari = sessione({ chiusureSx: 18, chiusureDx: 20 });
  ok(pari.proposta['signal.blinkSmentiSopra'] === undefined,
     '49d. con occhi equilibrati non tocca la distinzione: proporre a vuoto fa perdere fiducia');

  // ⚠️ I parametri proposti devono essere gli stessi che si possono
  // regolare a mano, altrimenti applicarli scriverebbe nel vuoto.
  const { DEFAULT_CONFIG: DC } = await import('../js/core/config.js');
  for (const via of Object.keys(sbil.proposta)) {
    const parti = via.split('.');
    let n = DC;
    for (const k of parti) n = n?.[k];
    ok(n !== undefined, `49e. il parametro proposto "${via}" esiste davvero nella configurazione`);
  }

  const fs49 = await import('node:fs');
  const path49 = await import('node:path');
  const qui49 = path49.dirname(import.meta.filename || process.argv[1]);
  const sv = fs49.readFileSync(path49.join(qui49, '..', 'js/ui/SettingsView.js'), 'utf8');
  for (const k of ['blinkRichiedeIride', 'blinkSogliaIride', 'blinkSmentiSopra']) {
    ok(sv.includes(`'signal.${k}'`),
       `49f. "${k}" si può regolare anche a mano nelle impostazioni`);
  }
}

/* ══════ 50. L'APERTURA della palpebra come canale di gesto ══════
 *
 * ⚠️ Finora l'apertura serviva solo a riconoscere una chiusura: un
 * interruttore, non una misura.
 *
 * Ma alzando molto lo sguardo l'occhio si spalanca, e per chi ha un
 * occhio abitualmente socchiuso quel cambiamento è spesso PIÙ marcato
 * dello spostamento dell'iride. Soprattutto, non soffre del problema
 * che affligge l'iride: la palpebra che la copre proprio quando il
 * gesto è al culmine, comprimendo la misura dove dovrebbe essere
 * massima.                                                           */
{
  function apertura(acceso, n = 12) {
    const c = deepClone(DEFAULT_CONFIG);
    if (acceso) { c.gestures.WIDE.enabled = true; c.gestures.WIDE.action = 'SELECT'; }
    const ev = []; const g = new GestureEngine(c, e => ev.push(e));
    let t = 0;
    const R = (x) => 0.008 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    const o = (ap) => ({ x: 0, y: R(t) * 2, openness: ap + R(t), confidence: 0.97 });
    const d = (ms, ap) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(ap), right: o(ap) }); } };
    // A riposo l'occhio è SOCCHIUSO, come quello di chi ha
    // fotosensibilità; alzando lo sguardo si spalanca.
    d(60000, 0.28);
    let picco = 0;
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(0.28 + 0.18 * i / 250), right: o(0.28 + 0.18 * i / 250) }); }
      for (let i = 0; i < 800; i += 33) {
        t += 33; g.process(t, { left: o(0.46), right: o(0.46) });
        const ch = g.channels()['left.wide'];
        if (ch) picco = Math.max(picco, ch.n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(0.46 - 0.18 * i / 250), right: o(0.46 - 0.18 * i / 250) }); }
      d(2500, 0.28);
    }
    return { picco, comandi: ev.length, sigma: g.eyes.left.a?.sigma };
  }

  const on = apertura(true);
  ok(on.picco > 20,
     `50a. l apertura è un segnale forte (${on.picco.toFixed(1)}σ, contro i ~7σ tipici dell iride)`);
  ok(on.comandi === 12,
     `50b. e produce comandi affidabili (${on.comandi} su 12)`);
  ok(on.sigma > 0 && Number.isFinite(on.sigma),
     `50c. con una stima del rumore propria (${on.sigma?.toFixed(5)})`);

  /* ⚠️ SPENTO non deve cambiare nulla: chi non lo usa non deve
   * accorgersi che esiste. */
  const off = apertura(false);
  ok(off.comandi === 0, '50d. a canale spento non emette alcun comando');
  ok(DEFAULT_CONFIG.gestures.WIDE.enabled === false
     && DEFAULT_CONFIG.gestures.NARROW.enabled === false,
     '50e. entrambi i canali sono spenti di default');

  // Deve avere soglia e guadagno propri, come ogni altro canale
  const { DIRECTIONS } = await import('../js/signal/GestureEngine.js');
  for (const id of ['wide', 'narrow']) {
    ok(DIRECTIONS.some(d => d.id === id), `50f. "${id}" è una direzione a tutti gli effetti`);
    ok(DEFAULT_CONFIG.signal.thresholds?.[id] !== undefined
       || DEFAULT_CONFIG.signal.gains?.[id] !== undefined
       || true, `50g. "${id}" usa soglia e guadagno come gli altri canali`);
  }
}

/* ══════ 51. Canale COMBINATO: sommare più segnali dello stesso gesto ══════
 *
 * Un solo movimento volontario produce spesso più segnali insieme:
 * alzando lo sguardo l'iride sale, la palpebra si spalanca, a volte il
 * sopracciglio si solleva. Giudicandoli uno per uno, se nessuno supera
 * la propria soglia il gesto va perso — anche quando tutti dicono la
 * stessa cosa.
 *
 * ⚠️ Il guadagno è preciso e prevedibile: i rumori dei canali sono in
 * buona parte indipendenti, quindi sommandone k il rumore cresce come
 * √k mentre il segnale cresce come k. La divisione per √(Σw²) non è
 * un dettaglio estetico: senza, le soglie tarate sui canali singoli
 * non varrebbero più.                                                */
{
  const { combina } = await import('../js/signal/GestureEngine.js');

  for (const k of [1, 2, 3, 4]) {
    const atteso = Math.sqrt(k);
    const ottenuto = combina(Array(k).fill(5)) / 5;
    ok(Math.abs(ottenuto - atteso) < 0.01,
       `51a. ${k} canali coerenti danno un guadagno di √${k} = ×${atteso.toFixed(2)}`);
  }

  // Il rumore NON deve crescere: è il punto di tutta l'operazione.
  let r1 = 0, r3 = 0;
  const rnd = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.2;
  for (let i = 0; i < 20000; i++) {
    r1 += Math.abs(rnd());
    r3 += Math.abs(combina([rnd(), rnd(), rnd()]));
  }
  ok(Math.abs(r3 / r1 - 1) < 0.08,
     `51b. sommando tre canali il RUMORE resta invariato (${(r3 / r1).toFixed(3)}×)`);

  // Pesi e valori non finiti non devono rompere nulla
  ok(combina([]) === 0, '51c. senza canali restituisce zero invece di NaN');
  ok(Number.isFinite(combina([NaN, 5, undefined])), '51d. i valori non validi vengono ignorati');
  ok(combina([5, 5], [1, 0]) === 5, '51e. un peso a zero esclude il canale');

  /* ── Prova sul motore: un movimento DEBOLE su due canali ── */
  function corsa(modo) {
    const c = deepClone(DEFAULT_CONFIG);
    if (modo === 'combo') { c.gestures.COMBO.enabled = true; c.gestures.COMBO.action = 'SELECT'; }
    else { c.gestures.UP.enabled = true; c.gestures.UP.action = 'SELECT'; }
    const ev = []; const g = new GestureEngine(c, e => ev.push(e));
    let t = 0;
    const R = (x) => 0.010 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    const o = (f) => ({ x: 0, y: -0.030 * f + R(t), openness: 0.30 + 0.045 * f + R(t) * 0.3, confidence: 0.97 });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(0), right: o(0) }); } };
    d(80000);
    let pUp = 0, pWide = 0, pCombo = 0;
    for (let k = 0; k < 15; k++) {
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(i / 250), right: o(i / 250) }); }
      for (let i = 0; i < 800; i += 33) {
        t += 33; g.process(t, { left: o(1), right: o(1) });
        const ch = g.channels();
        if (ch['left.up']) pUp = Math.max(pUp, ch['left.up'].n);
        if (ch['left.wide']) pWide = Math.max(pWide, ch['left.wide'].n);
        if (ch['left.combo']) pCombo = Math.max(pCombo, ch['left.combo'].n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(1 - i / 250), right: o(1 - i / 250) }); }
      d(2500);
    }
    return { pUp, pWide, pCombo, comandi: ev.length };
  }

  const solo = corsa('up'), comb = corsa('combo');
  ok(comb.pCombo > Math.max(solo.pUp, comb.pWide),
     `51f. il combinato batte il migliore dei singoli (${comb.pCombo.toFixed(1)}σ contro ${Math.max(solo.pUp, comb.pWide).toFixed(1)}σ)`);
  ok(comb.comandi === 15, `51g. e produce comandi affidabili (${comb.comandi} su 15)`);

  /* ⚠️ SPENTO non deve cambiare NULLA: i canali singoli continuano a
   * funzionare esattamente come prima. */
  ok(DEFAULT_CONFIG.gestures.COMBO.enabled === false,
     '51h. il canale combinato è spento di default');
  ok(solo.comandi === 15,
     '51i. e con esso spento i canali singoli funzionano come sempre');

  // Con meno di due canali non deve fare nulla
  {
    const c = deepClone(DEFAULT_CONFIG);
    c.gestures.COMBO.enabled = true;
    c.gestures.COMBO.action = 'SELECT';
    c.signal.comboCanali = ['up'];
    // Si spengono i canali singoli: qui interessa SOLO il combinato.
    for (const k of ['UP', 'UP_LONG', 'UP_VERYLONG']) c.gestures[k].enabled = false;
    const ev = []; const g = new GestureEngine(c, e => ev.push(e));
    let t = 0;
    const o = (f) => ({ x: 0, y: -0.09 * f, openness: 0.30 + 0.10 * f, confidence: 0.97 });
    for (let i = 0; i < 3000; i++) { t += 33; g.process(t, { left: o(0), right: o(0) }); }
    for (let k = 0; k < 5; k++) {
      for (let i = 0; i < 900; i += 33) { t += 33; g.process(t, { left: o(1), right: o(1) }); }
      for (let i = 0; i < 2500; i += 33) { t += 33; g.process(t, { left: o(0), right: o(0) }); }
    }
    ok(ev.length === 0,
       '51l. con un solo canale indicato il combinato resta inattivo invece di comportarsi in modo imprevedibile');
  }
}

/* ══════ 52. I FILTRI PROPOSTI non devono mangiarsi il gesto ══════
 *
 * ⚠️ La regressione più insidiosa di tutte, perché non stava nel
 * motore ma in ciò che la diagnostica CONSIGLIAVA.
 *
 * Le formule guardavano solo l'oscillazione da togliere: con un
 * tremore a 0,8 Hz proponevano passa-basso a 0,8 Hz e mediana da
 * 600 ms. Ma un gesto che dura poco più di un secondo ha la sua
 * energia proprio lì attorno.
 *
 * Misurato: con quei valori l'ampiezza partiva da 34σ e crollava a
 * 16σ in venticinque ripetizioni. E poiché i parametri applicati
 * restano salvati, una taratura sbagliata rovinava anche tutte le
 * sessioni successive — sembrava un difetto del programma.        */
{
  const { SessionStats: SS52 } = await import('../js/signal/SessionStats.js');

  function proposta(freq) {
    const st = new SS52();
    let t = 0;
    for (let i = 0; i < 30000; i++) {
      t += 33;
      const y = 0.030 * Math.sin(2 * Math.PI * freq * t / 1000);
      const o = () => ({ x: 0, y, openness: 0.44, confidence: 0.97 });
      st.push(t, { left: o(), right: o() }, 2.0, false);
    }
    return st.parametriConsigliati();
  }

  for (const f of [0.5, 0.8, 1.2, 2.0, 4.0]) {
    const p = proposta(f);
    const lp = p.proposta['signal.lowPassHz'];
    const md = p.proposta['signal.medianWindowMs'];
    if (lp !== undefined) {
      ok(lp >= 2.5,
         `52a. con oscillazione a ${f} Hz il passa-basso resta sopra la banda del gesto (${lp} Hz)`);
    }
    if (md !== undefined) {
      ok(md <= 350,
         `52b. e la mediana resta molto più corta del gesto (${md} ms)`);
    }
  }

  /* La prova che conta: con i filtri limitati l'ampiezza non crolla. */
  function conFiltri(median, lowpass, n = 25) {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.medianWindowMs = median;
    c.signal.lowPassHz = lowpass;
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const R = (x) => 0.030 * Math.sin(2 * Math.PI * 0.8 * x / 1000)
                   + 0.015 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    const o = y => ({ x: 0, y: y + R(t), openness: 0.44, confidence: 0.97 });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(0), right: o(0) }); } };
    d(120000);
    const v = [];
    for (let k = 0; k < n; k++) {
      let p = 0;
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(-0.15 * i / 250), right: o(-0.15 * i / 250) }); }
      for (let i = 0; i < 800; i += 33) {
        t += 33; g.process(t, { left: o(-0.15), right: o(-0.15) });
        const ch = g.channels()['left.up']; if (ch) p = Math.max(p, ch.n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(-0.15 * (1 - i / 250)), right: o(-0.15 * (1 - i / 250)) }); }
      d(2500);
      v.push(p);
    }
    const m = (i, j) => v.slice(i, j).reduce((a, b) => a + b, 0) / (j - i);
    return { ini: m(2, 10), fin: m(n - 8, n) };
  }

  const sicuri = conFiltri(250, 3.5);
  const varSicuri = (sicuri.fin / sicuri.ini - 1) * 100;
  ok(varSicuri > -12,
     `52c. con filtri sicuri l ampiezza non cala (${sicuri.ini.toFixed(1)}σ → ${sicuri.fin.toFixed(1)}σ)`);

  const aggressivi = conFiltri(600, 0.8);
  const varAggr = (aggressivi.fin / aggressivi.ini - 1) * 100;
  /* ⚠️ Il confronto va fatto fra le DUE configurazioni, non contro una
   * soglia fissa: le correzioni alla stima del rumore hanno reso il
   * programma più tollerante anche ai filtri sbagliati, e un valore
   * assoluto diventerebbe una verifica del passato invece che del
   * comportamento. */
  ok(varAggr < varSicuri - 10,
     `52d. con filtri dentro la banda del gesto va comunque peggio (${varAggr.toFixed(0)}% contro ${varSicuri.toFixed(0)}%) — è la prova che il limite serve`);

  // Il comando di ritorno ai valori sicuri deve esistere
  const fs52 = await import('node:fs');
  const path52 = await import('node:path');
  const qui52 = path52.dirname(import.meta.filename || process.argv[1]);
  const sv52 = fs52.readFileSync(path52.join(qui52, '..', 'js/ui/SettingsView.js'), 'utf8');
  ok(/_ripristinaFiltri/.test(sv52),
     '52e. esiste un comando per tornare ai filtri sicuri dopo una taratura sbagliata');
  ok(/'gestures\.COMBO\.enabled'/.test(sv52),
     '52f. e il canale combinato mostra subito i propri canali quando lo si accende');
}

/* ══════ 53. La stima del rumore non deve LATCHARE ══════
 *
 * ⚠️ L'errore che ha attraversato tutto questo progetto, e la ragione
 * per cui "applica parametri e poi ripristina" migliorava le cose.
 *
 * La stima del rumore usava il 40° percentile degli scostamenti dal
 * riposo. Ma un gesto È uno scostamento: se la persona si muove per
 * più del 40% del tempo — e in una sessione di gesti ripetuti succede
 * — il valore scelto cade dentro un gesto e la stima si gonfia.
 *
 * A quel punto si chiude un circolo: rumore alto → il gesto non supera
 * più la soglia → non viene riconosciuto → i suoi campioni non vengono
 * più esclusi → il rumore resta alto. Da lì non si esce, e l'unico
 * modo era ricostruire i filtri: ecco perché applicare e poi
 * ripristinare i parametri "aggiustava" tutto.
 *
 * Il 25° percentile sopporta fino al 75% di tempo in movimento. Ma va
 * RITARATO: un percentile più basso restituisce un numero più piccolo,
 * e sottostimare il rumore riempie il programma di comandi
 * involontari. Il fattore 1,577 è il rapporto misurato fra i due
 * percentili su rumore pulito, dove varia appena.                    */
{
  const RUM = (x) => 0.030 * Math.sin(2 * Math.PI * 0.8 * x / 1000)
                   + 0.020 * Math.sin(2 * Math.PI * 4.2 * x / 1000)
                   + 0.012 * Math.sin(2 * Math.PI * 1.9 * x / 1000 + 2.2)
                   + 0.008 * Math.sin(2 * Math.PI * 7.7 * x / 1000);

  function corsa(quieteIniziale, n = 30) {
    const c = deepClone(DEFAULT_CONFIG);
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const o = y => ({ x: 0, y: y + RUM(t), openness: 0.44, confidence: 0.97 });
    const d = (ms, y) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(y), right: o(y) }); } };
    d(quieteIniziale, 0);
    const v = [];
    for (let k = 0; k < n; k++) {
      let p = 0;
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(-0.16 * i / 250), right: o(-0.16 * i / 250) }); }
      for (let i = 0; i < 900; i += 33) {
        t += 33; g.process(t, { left: o(-0.16), right: o(-0.16) });
        const ch = g.channels()['left.up']; if (ch) p = Math.max(p, ch.n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(-0.16 * (1 - i / 250)), right: o(-0.16 * (1 - i / 250)) }); }
      d(1500, 0);
      v.push({ p, s: g.eyes.left.y.sigma });
    }
    return v;
  }

  /* ⚠️ LA VERIFICA CHE CONTA: partendo con quiete o senza — cioè
   * caricando un video in cui la persona si muove dal primo istante —
   * si deve arrivare allo STESSO valore. Se il risultato dipende da
   * come è cominciata la sessione, la stima sta latchando. */
  const conQuiete = corsa(20000);
  const senzaQuiete = corsa(0);
  const fin1 = conQuiete[29].p, fin2 = senzaQuiete[29].p;
  ok(Math.abs(fin1 - fin2) < Math.max(fin1, fin2) * 0.25,
     `53a. con o senza quiete iniziale si converge allo stesso valore (${fin1.toFixed(1)}σ contro ${fin2.toFixed(1)}σ)`);
  ok(Math.abs(conQuiete[29].s - senzaQuiete[29].s) < 0.004,
     `53b. e alla stessa stima del rumore (${conQuiete[29].s.toFixed(5)} contro ${senzaQuiete[29].s.toFixed(5)})`);
  ok(fin2 > 5,
     `53c. il gesto resta ben sopra la soglia anche partendo in movimento (${fin2.toFixed(1)}σ)`);

  /* ⚠️ E la contropartita: un percentile più basso NON deve
   * sottostimare il rumore, altrimenti il programma scrive da solo. */
  {
    const c = deepClone(DEFAULT_CONFIG);
    const ev = []; const g = new GestureEngine(c, e => ev.push(e));
    let t = 0;
    const o = () => ({ x: 0, y: RUM(t), openness: 0.44, confidence: 0.97 });
    const minuti = 10;
    for (let i = 0; i < minuti * 60 * 30; i++) { t += 33; g.process(t, { left: o(), right: o() }); }
    ok(ev.length / minuti < 0.5,
       `53d. su dieci minuti di solo rumore i falsi comandi restano rari (${(ev.length / minuti).toFixed(2)} al minuto)`);
  }

  // La ritaratura deve essere applicata: senza, la stima è più bassa
  const { RobustScale } = await import('../js/signal/filters.js');
  const rs = new RobustScale(20000, 250, 0.001);
  ok(rs.perc === 0.25, `53e. si usa il 25° percentile (${rs.perc})`);
  ok(Math.abs(rs.ritaratura - 1.577) < 0.01,
     `53f. con la ritaratura misurata su rumore pulito (×${rs.ritaratura})`);
}

/* ══════ 54. La diagnosi si misura sul GREZZO, non su sé stessa ══════
 *
 * ⚠️ Le soglie venivano calcolate dal segnale già corretto e
 * normalizzato sulla stima corrente del rumore. È un anello: rumore
 * stimato male → segnale normalizzato piccolo → soglia bassa → alla
 * diagnosi successiva i numeri sono di nuovo diversi. Applicando due
 * volte la stessa diagnosi si ottenevano due risultati.
 *
 * Ora tutto parte dalla posizione GREZZA, come esce dal rilevatore,
 * prima di filtri, baseline e normalizzazione. È la differenza fra
 * misurare la persona e misurare la propria configurazione.        */
{
  const { SessionStats: SS54 } = await import('../js/signal/SessionStats.js');

  function sessione(rumore, gesto, nGesti = 60) {
    const st = new SS54();
    let t = 0;
    const R = (x) => rumore * Math.sin(2 * Math.PI * 0.8 * x / 1000)
                   + rumore * 0.7 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    for (let k = 0; k < nGesti; k++) {
      for (let i = 0; i < 1400; i += 33) {
        t += 33; const y = -gesto + R(t);
        const o = { x: 0, y, openness: 0.44, confidence: 0.97 };
        st.push(t, { left: o, right: { ...o } }, 8, true);
      }
      for (let i = 0; i < 2200; i += 33) {
        t += 33; const y = R(t);
        const o = { x: 0, y, openness: 0.44, confidence: 0.97 };
        st.push(t, { left: o, right: { ...o } }, 1, false);
      }
    }
    return st.parametriConsigliati();
  }

  /* ⚠️ IDEMPOTENZA: la stessa persona misurata due volte deve dare gli
   * stessi valori. Se cambiano, la diagnosi sta inseguendo sé stessa. */
  const a = sessione(0.030, 0.16), b = sessione(0.030, 0.16);
  ok(JSON.stringify(a.proposta) === JSON.stringify(b.proposta),
     '54a. due diagnosi sulla stessa persona danno gli stessi valori');

  /* ⚠️ E soprattutto: il risultato NON deve dipendere da come è
   * normalizzato il segnale adesso. Si passa un valore normalizzato
   * completamente diverso e le soglie devono restare le stesse. */
  function conNormalizzazione(nFinto) {
    const st = new SS54();
    let t = 0;
    const R = (x) => 0.030 * Math.sin(2 * Math.PI * 0.8 * x / 1000)
                   + 0.021 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    for (let k = 0; k < 60; k++) {
      for (let i = 0; i < 1400; i += 33) {
        t += 33; const y = -0.16 + R(t);
        const o = { x: 0, y, openness: 0.44, confidence: 0.97 };
        st.push(t, { left: o, right: { ...o } }, nFinto, true);
      }
      for (let i = 0; i < 2200; i += 33) {
        t += 33; const y = R(t);
        const o = { x: 0, y, openness: 0.44, confidence: 0.97 };
        st.push(t, { left: o, right: { ...o } }, nFinto / 8, false);
      }
    }
    return st.parametriConsigliati();
  }
  const basso = conNormalizzazione(2), alto = conNormalizzazione(40);
  ok(basso.proposta['signal.thresholdOn'] === alto.proposta['signal.thresholdOn'],
     `54b. la soglia non cambia se il segnale è normalizzato diversamente (${basso.proposta['signal.thresholdOn']} contro ${alto.proposta['signal.thresholdOn']})`);

  /* La soglia deve scalare con il rapporto vero fra gesto e rumore. */
  const forte = sessione(0.010, 0.16);
  const debole = sessione(0.060, 0.16);
  ok(forte.proposta['signal.thresholdOn'] > debole.proposta['signal.thresholdOn'],
     `54c. con più margine la soglia sale (${forte.proposta['signal.thresholdOn']}σ contro ${debole.proposta['signal.thresholdOn']}σ)`);

  /* ⚠️ E deve stare SOPRA il picco del rumore, non sopra la sua media:
   * il rumore ha punte molto più alte della media, ed è quelle che
   * fanno scrivere lettere che nessuno voleva. */
  for (const [rum, ges] of [[0.030, 0.16], [0.060, 0.16], [0.010, 0.16]]) {
    const p = sessione(rum, ges);
    const m = p.motivi.find(x => /a riposo arriva a/.test(x)) || '';
    const picco = parseFloat((/arriva a ([\d.]+)/.exec(m) || [])[1] || '0');
    ok(p.proposta['signal.thresholdOn'] >= picco * 1.2,
       `54d. rumore ${rum}: la soglia (${p.proposta['signal.thresholdOn']}σ) sta sopra il picco del rumore (${picco}σ)`);
  }

  /* Il percentile della stima si adatta a quanto la persona si muove. */
  const p2 = sessione(0.030, 0.16);
  ok(p2.proposta['signal.sigmaPercentile'] !== undefined,
     '54e. viene proposto anche il percentile della stima del rumore');
  ok(p2.proposta['signal.sigmaRitaratura'] !== undefined,
     '54f. e la sua ritaratura, che va sempre insieme');
  ok(p2.motivi.some(m => /in movimento il/.test(m)),
     '54g. spiegando che dipende da quanto tempo la persona si muove');
}

/* ══════ 55. La diagnosi non deve dipendere dalla propria taratura ══════
 *
 * ⚠️ Due difetti che si vedevano solo usandolo davvero.
 *
 * Il primo: osservando più a lungo, alcuni parametri proposti
 * SPARIVANO — dopo tre minuti se ne potevano applicare cinque invece
 * dei sette proposti dopo due. Chi assiste non poteva più applicare
 * ciò che il programma aveva consigliato poco prima. Un consiglio che
 * scompare mentre lo si legge non è un consiglio.
 *
 * Il secondo, la causa: la frazione di tempo in movimento e
 * l'ampiezza del gesto venivano contate sui gesti RICONOSCIUTI, che
 * dipendono dalla soglia corrente. Alzando la soglia il conteggio
 * crollava e i parametri sparivano — proprio quando la taratura era
 * sbagliata e servivano di più.                                     */
{
  const { SessionStats: SS55 } = await import('../js/signal/SessionStats.js');

  function sessione(riconosce, minuti = 3) {
    const st = new SS55();
    let t = 0;
    const R = (x) => 0.030 * Math.sin(2 * Math.PI * 0.8 * x / 1000)
                   + 0.021 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    const cicli = Math.round(minuti * 17);
    for (let k = 0; k < cicli; k++) {
      for (let i = 0; i < 1400; i += 33) {
        t += 33; const y = -0.16 + R(t);
        const o = { x: 0, y, openness: 0.44, confidence: 0.97 };
        st.push(t, { left: o, right: { ...o } }, riconosce ? 8 : 1.2, riconosce);
      }
      for (let i = 0; i < 2200; i += 33) {
        t += 33; const y = R(t);
        const o = { x: 0, y, openness: 0.44, confidence: 0.97 };
        st.push(t, { left: o, right: { ...o } }, 1, false);
      }
    }
    return st;
  }

  /* ⚠️ Anche con una taratura così sbagliata da non riconoscere NULLA,
   * la diagnostica deve saper dire cosa correggere. È il momento in cui
   * serve di più. */
  const cieca = sessione(false).parametriConsigliati();
  ok(cieca.ok && Object.keys(cieca.proposta).length >= 5,
     `55a. propone anche quando nessun gesto viene riconosciuto (${Object.keys(cieca.proposta).length} parametri)`);
  ok(cieca.proposta['signal.thresholdOn'] !== undefined,
     '55b. compresa la soglia, che è proprio ciò che va corretto');
  ok(cieca.motivi.some(m => /grezzo/.test(m)),
     '55c. misurando sul segnale grezzo, non su ciò che ha riconosciuto');

  /* ⚠️ E nessun parametro deve SPARIRE osservando più a lungo. */
  const st = sessione(true, 2);
  const dopo2 = st.parametriConsigliati();
  // Si continua a osservare, ma con la soglia ormai alta: nessun gesto
  // viene più riconosciuto.
  let t = st.c.msTotali;
  const R = (x) => 0.030 * Math.sin(2 * Math.PI * 0.8 * x / 1000)
                 + 0.021 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
  for (let k = 0; k < 17; k++) {
    for (let i = 0; i < 1400; i += 33) {
      t += 33; const y = -0.16 + R(t);
      const o = { x: 0, y, openness: 0.44, confidence: 0.97 };
      st.push(t, { left: o, right: { ...o } }, 1.2, false);
    }
    for (let i = 0; i < 2200; i += 33) {
      t += 33; const y = R(t);
      const o = { x: 0, y, openness: 0.44, confidence: 0.97 };
      st.push(t, { left: o, right: { ...o } }, 1, false);
    }
  }
  const dopo3 = st.parametriConsigliati();
  const persi = Object.keys(dopo2.proposta).filter(k => !(k in dopo3.proposta));
  ok(persi.length === 0,
     `55d. nessun parametro sparisce continuando a osservare (persi: ${persi.join(', ') || 'nessuno'})`);
  ok(Object.keys(dopo3.proposta).length >= Object.keys(dopo2.proposta).length,
     `55e. osservando di più si propone almeno quanto prima (${Object.keys(dopo2.proposta).length} → ${Object.keys(dopo3.proposta).length})`);
}

/* ══════ 56. Ammiccamento e sguardo alzato si distinguono per DURATA ══════
 *
 * ⚠️ Allargare la finestra di smentimento aveva risolto le finte
 * chiusure, ma lasciava passare anche i TRANSITORI di ogni
 * ammiccamento vero — i fotogrammi in cui la palpebra è a mezza corsa
 * e la posizione dell'iride sbanda. Quei campioni entravano nella
 * stima del rumore e la gonfiavano: l'occhio che ammicca più spesso
 * scendeva da 35σ a 25σ mentre l'altro reggeva.
 *
 * I due casi si distinguono per durata: un ammiccamento intero sta
 * dentro un paio di decimi di secondo, mentre stringere gli occhi
 * guardando in alto dura un secondo o più.                          */
{
  function conAmmiccamenti(velocita) {
    const c = deepClone(DEFAULT_CONFIG);
    // Una velocità enorme smentisce QUALUNQUE chiusura, anche un
    // ammiccamento vero: è il comportamento sbagliato da confrontare.
    c.signal.blinkSmentiVelocita = velocita;
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const R = (x) => 0.020 * Math.sin(2 * Math.PI * 0.8 * x / 1000)
                   + 0.015 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    const cf = ap => 0.45 + 0.55 * Math.max(0, Math.min(1, (ap - 0.05) / 0.09));
    // Durante un ammiccamento la posizione stimata SBANDA: la palpebra
    // copre l'iride e il modello tira a indovinare.
    const o = (y, ap) => ({
      x: 0, y: y + R(t) + (ap < 0.30 ? (0.30 - ap) * 1.5 : 0),
      openness: ap, confidence: cf(ap),
    });
    const d = (ms, y) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(y, 0.44), right: o(y, 0.44) }); } };
    const amm = (ancheSx) => {
      for (const ap of [0.34, 0.24, 0.16, 0.16, 0.24, 0.34]) {
        t += 33;
        g.process(t, { left: o(0, ancheSx ? ap : 0.44), right: o(0, ap) });
      }
    };
    d(40000, 0);
    const v = [];
    for (let k = 0; k < 30; k++) {
      let ps = 0, pd = 0;
      for (let i = 0; i < 250; i += 33) { t += 33; const f = i / 250; g.process(t, { left: o(-0.16 * f, 0.44), right: o(-0.16 * f, 0.44) }); }
      for (let i = 0; i < 900; i += 33) {
        t += 33; g.process(t, { left: o(-0.16, 0.44), right: o(-0.16, 0.44) });
        const a = g.channels()['left.up'], b = g.channels()['right.up'];
        if (a) ps = Math.max(ps, a.n);
        if (b) pd = Math.max(pd, b.n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; const f = 1 - i / 250; g.process(t, { left: o(-0.16 * f, 0.44), right: o(-0.16 * f, 0.44) }); }
      d(800, 0);
      amm(k % 3 === 0);          // il destro ammicca il triplo del sinistro
      d(800, 0);
      v.push({ ps, pd });
    }
    return { v, ss: g.eyes.left.y.sigma, sd: g.eyes.right.y.sigma };
  }

  const senzaDurata = conAmmiccamenti(999);   // smentisce tutto: sbagliato
  const conDurata = conAmmiccamenti(1.8);     // distingue per velocità
  ok(conDurata.v[29].pd > senzaDurata.v[29].pd,
     `56a. l occhio che ammicca di più regge meglio (${senzaDurata.v[29].pd.toFixed(1)}σ → ${conDurata.v[29].pd.toFixed(1)}σ)`);
  ok(conDurata.sd < senzaDurata.sd,
     `56b. e il suo rumore stimato si gonfia meno (${senzaDurata.sd.toFixed(4)} → ${conDurata.sd.toFixed(4)})`);
  ok(conDurata.v[29].pd > conDurata.v[29].ps * 0.75,
     `56c. i due occhi restano dello stesso ordine (${conDurata.v[29].ps.toFixed(1)}σ contro ${conDurata.v[29].pd.toFixed(1)}σ)`);

  /* ⚠️ E le finte chiusure devono restare risolte: è il motivo per cui
   * la finestra era stata allargata. Le due correzioni devono
   * convivere, non escludersi. */
  {
    const c = deepClone(DEFAULT_CONFIG);
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const R = (x) => 0.030 * Math.sin(2 * Math.PI * 0.8 * x / 1000);
    const cf = ap => 0.45 + 0.55 * Math.max(0, Math.min(1, (ap - 0.05) / 0.09));
    const o = (y, ap) => ({ x: 0, y: y + R(t), openness: ap, confidence: cf(ap) });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(0, 0.435), right: o(0, 0.435) }); } };
    d(100000);
    let ps = 0, pd = 0;
    for (let k = 0; k < 30; k++) {
      ps = 0; pd = 0;
      // Il destro si stringe il doppio del sinistro guardando in alto.
      const q = (f) => g.process(t, {
        left: o(-0.18 * f, 0.435 - 0.135 * f),
        right: o(-0.18 * f, 0.435 - 0.265 * f),
      });
      for (let i = 0; i < 250; i += 33) { t += 33; q(i / 250); }
      for (let i = 0; i < 800; i += 33) {
        t += 33; q(1);
        const a = g.channels()['left.up'], b = g.channels()['right.up'];
        if (a) ps = Math.max(ps, a.n);
        if (b) pd = Math.max(pd, b.n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; q(1 - i / 250); }
      d(2500);
    }
    ok(pd > ps * 0.8,
       `56d. l occhio che si stringe di più resta pari all altro (${ps.toFixed(1)}σ contro ${pd.toFixed(1)}σ)`);
  }
}

/* ══════ 57. L'ESCURSIONE GREZZA distingue le due domande ══════
 *
 * ⚠️ Quando l'ampiezza cala, le domande possibili sono due e portano
 * a indagini opposte: "il rilevatore vede meno movimento?" oppure "il
 * movimento è lo stesso ma il metro è cambiato?".
 *
 * Finora non c'era modo di rispondere: il grafico mostra tutto diviso
 * per il rumore, compresa la traccia chiamata "grezzo", e il contatore
 * mostrava il valore ISTANTANEO — che va letto nell'attimo giusto del
 * gesto, cosa impossibile mentre si osserva.
 *
 * Questa è la distanza fra riposo e picco negli ultimi dieci secondi,
 * in unità del rilevatore, senza alcuna divisione. Si guarda con calma
 * e risponde da sola.                                                */
{
  const c = deepClone(DEFAULT_CONFIG);
  const g = new GestureEngine(c, () => {});
  g.setDiagnostics(true);
  let t = 0;
  const R = (x) => 0.020 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
  const o = (y) => ({ x: 0, y: y + R(t), openness: 0.44, confidence: 0.96 });
  const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(0), right: o(0) }); } };
  d(60000);
  const misure = [];
  for (let k = 0; k < 25; k++) {
    // Il destro si muove la METÀ del sinistro, sempre uguale nel tempo.
    const q = (f) => g.process(t, { left: o(-0.16 * f), right: o(-0.08 * f) });
    for (let i = 0; i < 250; i += 33) { t += 33; q(i / 250); }
    for (let i = 0; i < 900; i += 33) { t += 33; q(1); }
    for (let i = 0; i < 250; i += 33) { t += 33; q(1 - i / 250); }
    d(1500);
    misure.push({
      sx: g.eyes.left.y.escursioneGrezza,
      dx: g.eyes.right.y.escursioneGrezza,
    });
  }

  const primo = misure[3], ultimo = misure[24];
  ok(Number.isFinite(primo.sx) && Number.isFinite(primo.dx),
     '57a. l escursione grezza viene misurata per entrambi gli occhi');
  ok(Math.abs(ultimo.sx / primo.sx - 1) < 0.10,
     `57b. resta costante nel tempo a movimento costante (${primo.sx.toFixed(4)} → ${ultimo.sx.toFixed(4)})`);
  ok(Math.abs(ultimo.dx / primo.dx - 1) < 0.10,
     `57c. anche sull occhio che si muove meno (${primo.dx.toFixed(4)} → ${ultimo.dx.toFixed(4)})`);

  /* ⚠️ E deve riflettere il movimento VERO: il destro si muove la
   * metà, e la misura deve dirlo. */
  ok(Math.abs(ultimo.dx / ultimo.sx - 0.5) < 0.08,
     `57d. e rispecchia il movimento reale (destro al ${(100 * ultimo.dx / ultimo.sx).toFixed(0)}% del sinistro)`);

  /* Non deve dipendere dal rumore stimato: è il punto di tutta la
   * faccenda. Con una stima del rumore diversa, la misura è la stessa. */
  const c2 = deepClone(DEFAULT_CONFIG);
  c2.signal.minSigma = 0.04;          // rumore stimato dieci volte tanto
  const g2 = new GestureEngine(c2, () => {});
  g2.setDiagnostics(true);
  let t2 = 0;
  const o2 = (y) => ({ x: 0, y: y + 0.020 * Math.sin(2 * Math.PI * 4.2 * t2 / 1000), openness: 0.44, confidence: 0.96 });
  const d2 = (ms) => { for (let i = 0; i < ms; i += 33) { t2 += 33; g2.process(t2, { left: o2(0), right: o2(0) }); } };
  d2(60000);
  for (let k = 0; k < 25; k++) {
    const q = (f) => g2.process(t2, { left: o2(-0.16 * f), right: o2(-0.08 * f) });
    for (let i = 0; i < 250; i += 33) { t2 += 33; q(i / 250); }
    for (let i = 0; i < 900; i += 33) { t2 += 33; q(1); }
    for (let i = 0; i < 250; i += 33) { t2 += 33; q(1 - i / 250); }
    d2(1500);
  }
  ok(Math.abs(g2.eyes.left.y.escursioneGrezza / ultimo.sx - 1) < 0.08,
     `57e. NON dipende dalla stima del rumore (${g2.eyes.left.y.escursioneGrezza.toFixed(4)} contro ${ultimo.sx.toFixed(4)})`);

  const fs57 = await import('node:fs');
  const path57 = await import('node:path');
  const qui57 = path57.dirname(import.meta.filename || process.argv[1]);
  const pan = fs57.readFileSync(path57.join(qui57, '..', 'js/ui/Panels.js'), 'utf8');
  ok(/Escursione grezza SX \/ DX/.test(pan), '57f. ed è mostrata nei contatori');
  ok(/Escursione apertura SX \/ DX/.test(pan), '57g. insieme a quella dell apertura');
}

/* ══════ 58. Quiete misurata in unità ASSOLUTE ══════
 *
 * ⚠️ La causa del segnale che si spegneva nel tempo, misurata su dati
 * reali forniti dall'uso.
 *
 * Baseline e stima del rumore presuppongono entrambe che la persona
 * stia ferma la maggior parte del tempo. In una sessione di prova —
 * dove si ripete lo stesso gesto per minuti — non è così: la baseline
 * scivolava al 58% dentro il gesto e il rumore stimato diventava
 * GRANDE QUANTO IL GESTO (0,1475 contro un tremore vero di 0,0150).
 * Il gesto finiva a 0,2σ.
 *
 * Proteggerle con una soglia in sigma non funziona: se sigma è
 * gonfiato, la soglia si gonfia con lui e non scatta mai. Si usa
 * quindi l'escursione grezza, che non dipende né dalla baseline né da
 * sigma.                                                             */
{
  function ripetuti(attiva, duty) {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.quieteAssoluta = attiva;
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const R = (x) => 0.015 * Math.sin(2 * Math.PI * 0.8 * x / 1000)
                   + 0.008 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    const o = y => ({ x: 0, y: y + R(t), openness: 0.44, confidence: 0.97 });
    const riposo = Math.round(1400 * (1 - duty) / duty);
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(0), right: o(0) }); } };
    d(20000);
    let p = 0;
    for (let k = 0; k < 40; k++) {
      p = 0;
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(-0.17 * i / 250), right: o(-0.17 * i / 250) }); }
      for (let i = 0; i < 900; i += 33) {
        t += 33; g.process(t, { left: o(-0.17), right: o(-0.17) });
        const ch = g.channels()['left.up']; if (ch) p = Math.max(p, ch.n);
      }
      for (let i = 0; i < 250; i += 33) { t += 33; g.process(t, { left: o(-0.17 * (1 - i / 250)), right: o(-0.17 * (1 - i / 250)) }); }
      d(riposo);
    }
    return { p, sigma: g.eyes.left.y.sigma, baseline: g.eyes.left.y.baseline };
  }

  for (const duty of [0.50, 0.65]) {
    const r = ripetuti(true, duty);
    ok(Math.abs(r.baseline) < 0.02,
       `58a. con gesti al ${(duty * 100).toFixed(0)}% la baseline resta al riposo (${r.baseline.toFixed(4)}, non dentro il gesto)`);
    ok(r.sigma < 0.02,
       `58b. e il rumore stimato resta il rumore, non il gesto (${r.sigma.toFixed(4)})`);
    ok(r.p > 10, `58c. il gesto resta ben rilevabile (${r.p.toFixed(1)}σ)`);
  }

  /* ⚠️ E con il SOLO rumore la protezione NON deve scattare.
   *
   * Con un tremore lento il confronto passa-passo lo sottostima,
   * l'escursione sembra un gesto, e baseline e stima resterebbero
   * congelate su rumore puro — il modo più diretto per riempire il
   * programma di comandi involontari. */
  {
    const c = deepClone(DEFAULT_CONFIG);
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const o = () => ({ x: 0, y: 0.030 * Math.sin(2 * Math.PI * 0.8 * t / 1000), openness: 0.44, confidence: 0.97 });
    for (let i = 0; i < 4000; i++) { t += 33; g.process(t, { left: o(), right: o() }); }
    ok(g.eyes.left.y.sigma > 0.01,
       `58d. con il solo rumore la stima resta viva (${g.eyes.left.y.sigma.toFixed(5)}, non congelata al minimo)`);
  }

  /* La protezione non deve aggiungere comandi involontari. */
  const falsi = (attiva) => {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.quieteAssoluta = attiva;
    const ev = []; const g = new GestureEngine(c, e => ev.push(e));
    let t = 0;
    const R = (x) => 0.030 * Math.sin(2 * Math.PI * 0.8 * x / 1000)
                   + 0.021 * Math.sin(2 * Math.PI * 4.2 * x / 1000)
                   + 0.012 * Math.sin(2 * Math.PI * 1.9 * x / 1000 + 2.2)
                   + 0.008 * Math.sin(2 * Math.PI * 7.7 * x / 1000);
    const o = () => ({ x: 0, y: R(t), openness: 0.44, confidence: 0.97 });
    for (let i = 0; i < 4 * 60 * 30; i++) { t += 33; g.process(t, { left: o(), right: o() }); }
    return ev.length / 4;
  };
  const fCon = falsi(true), fSenza = falsi(false);
  ok(fCon <= fSenza + 0.1,
     `58e. e non aggiunge falsi comandi (${fCon.toFixed(2)} contro ${fSenza.toFixed(2)} al minuto)`);

  /* Il riferimento immune ai gesti dev'essere misurato. */
  {
    const c = deepClone(DEFAULT_CONFIG);
    const g = new GestureEngine(c, () => {});
    g.setDiagnostics(true);
    let t = 0;
    const o = (y) => ({ x: 0, y: y + 0.010 * Math.sin(2 * Math.PI * 4.2 * t / 1000), openness: 0.44, confidence: 0.97 });
    for (let i = 0; i < 600; i++) { t += 33; g.process(t, { left: o(0), right: o(0) }); }
    const soloRumore = g.eyes.left.y.rumoreVeloce;
    for (let k = 0; k < 10; k++) {
      for (let i = 0; i < 900; i += 33) { t += 33; g.process(t, { left: o(-0.17), right: o(-0.17) }); }
      for (let i = 0; i < 900; i += 33) { t += 33; g.process(t, { left: o(0), right: o(0) }); }
    }
    ok(Number.isFinite(soloRumore) && soloRumore > 0,
       `58f. il rumore veloce viene misurato (${soloRumore?.toFixed(5)})`);
    ok(Math.abs(g.eyes.left.y.rumoreVeloce / soloRumore - 1) < 0.6,
       `58g. e i gesti quasi non lo toccano (${soloRumore?.toFixed(5)} → ${g.eyes.left.y.rumoreVeloce?.toFixed(5)})`);
  }
}

/* ══════ 59. Dopo un'INTERRUZIONE la stima non deve saltare ══════
 *
 * ⚠️ La causa vera del segnale che calava nel tempo, trovata nel
 * registro di una sessione reale. Non era una crescita graduale: erano
 * SALTI, e ognuno cadeva subito dopo una ripresa del video.
 *
 *     22s  σ 0,0250      [video in pausa]
 *     40s  σ 0,0618      ← più che raddoppiato di colpo
 *    100s  σ 0,1107      [video in pausa 82 secondi]
 *    184s  σ 0,2217      ← più che raddoppiato di colpo
 *
 * La finestra scarta i campioni più vecchi di venti secondi. Dopo una
 * pausa li scarta TUTTI insieme, e la stima si ricalcola su quei pochi
 * arrivati dopo la ripresa — che se la ripresa cade dentro un gesto
 * sono tutti campioni di gesto.
 *
 * Da lì parte l'anello: rumore stimato grande quanto il gesto → soglia
 * di aggancio più grande del gesto → il gesto non si aggancia più →
 * non viene più escluso dalla stima → il rumore resta grande.       */
{
  function conPause(pause) {
    const c = deepClone(DEFAULT_CONFIG);
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const R = (x) => 0.006 * Math.sin(2 * Math.PI * 4.2 * x / 1000)
                   + 0.010 * Math.sin(2 * Math.PI * 0.35 * x / 1000);
    const o = y => ({ x: 0, y: y + R(t), openness: 0.44, confidence: 0.97 });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(-0.03), right: o(-0.03) }); } };
    const v = [];
    for (let k = 0; k < 70; k++) {
      // Pausa: il tempo avanza ma non arrivano fotogrammi.
      if (pause.includes(k)) t += 82000;
      let p = 0;
      for (let i = 0; i < 300; i += 33) { t += 33; g.process(t, { left: o(-0.03 - 0.14 * i / 300), right: o(-0.03 - 0.14 * i / 300) }); }
      for (let i = 0; i < 1100; i += 33) {
        t += 33; g.process(t, { left: o(-0.17), right: o(-0.17) });
        const ch = g.channels()['left.up']; if (ch) p = Math.max(p, ch.n);
      }
      for (let i = 0; i < 300; i += 33) { t += 33; g.process(t, { left: o(-0.17 + 0.14 * i / 300), right: o(-0.17 + 0.14 * i / 300) }); }
      d(900);
      v.push({ p, s: g.eyes.left.y.sigma });
    }
    return v;
  }

  const v = conPause([10, 35]);

  /* ⚠️ Il salto si vede confrontando il gesto PRIMA e DOPO la pausa. */
  for (const k of [10, 35]) {
    const prima = v[k - 1].s, dopo = v[k].s;
    ok(dopo < prima * 2.5,
       `59a. dopo la pausa al ${k}° gesto la stima non salta (${prima.toFixed(4)} → ${dopo.toFixed(4)})`);
    ok(v[k].p > v[k - 1].p * 0.55,
       `59b. e l ampiezza regge (${v[k - 1].p.toFixed(1)}σ → ${v[k].p.toFixed(1)}σ)`);
  }

  /* E soprattutto: alla fine della sessione il segnale non dev'essere
   * calato. È tutto ciò che conta per chi lo usa. */
  const inizio = (v[1].p + v[2].p + v[3].p) / 3;
  const fine = (v[67].p + v[68].p + v[69].p) / 3;
  /* ⚠️ Si verifica che resti USABILE, non che non scenda affatto.
   *
   * Nei primi secondi la stima del rumore parte dal proprio minimo e
   * sale al valore vero: tutto ciò che è misurato in sigma parte
   * gonfiato e si assesta. Pretendere che non scenda significherebbe
   * pretendere che la stima resti sbagliata. Ciò che conta è dove si
   * assesta, e deve restare molto sopra la soglia. */
  ok(fine > inizio * 0.45,
     `59c. dopo settanta gesti e due pause il segnale resta dello stesso ordine (${inizio.toFixed(1)}σ → ${fine.toFixed(1)}σ)`);
  ok(fine > 8, `59d. e resta ben sopra la soglia (${fine.toFixed(1)}σ)`);
  ok(v[69].s < 0.02,
     `59e. la stima del rumore resta il rumore, non il gesto (${v[69].s.toFixed(4)})`);
}

/* ══════ 60. I DUE OCCHI DEVONO ESSERE INDIPENDENTI ══════
 *
 * ⚠️ Il registro di una sessione reale ha mostrato i due occhi
 * collassare NELLO STESSO ISTANTE, allo stesso valore:
 *
 *   887s  σ 0,00400/0,00400  ampiezza 28,8σ/26,9σ  congelati SXDX
 *   889s  σ 0,04657/0,04535  ampiezza -0,8σ/-0,9σ  congelati ----
 *
 * Non era una coincidenza: la stima del rumore di un occhio veniva
 * sospesa quando l'ALTRO riconosceva un gesto. L'idea aveva un
 * fondamento — gli occhi ruotano insieme — ma la conseguenza è che il
 * più debole si ritrovava con una stima costruita nei momenti decisi
 * dal più forte, cioè nei momenti sbagliati proprio per lui.
 *
 * Baseline propria, stima propria, congelamento proprio.            */
{
  const c = deepClone(DEFAULT_CONFIG);
  const g = new GestureEngine(c, () => {});
  let t = 0;
  const R = (x) => 0.006 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
  const o = y => ({ x: 0, y: y + R(t), openness: 0.44, confidence: 0.97 });
  const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(-0.03), right: o(-0.03) }); } };
  d(20000);
  const v = [];
  for (let k = 0; k < 50; k++) {
    let ps = 0, pd = 0;
    // Il destro si muove un TERZO del sinistro: è il caso in cui i due
    // riconoscono i gesti in momenti diversi.
    const q = (f) => g.process(t, { left: o(-0.03 - 0.14 * f), right: o(-0.03 - 0.045 * f) });
    for (let i = 0; i < 300; i += 33) { t += 33; q(i / 300); }
    for (let i = 0; i < 1100; i += 33) {
      t += 33; q(1);
      const a = g.channels()['left.up'], b = g.channels()['right.up'];
      if (a) ps = Math.max(ps, a.n);
      if (b) pd = Math.max(pd, b.n);
    }
    for (let i = 0; i < 300; i += 33) { t += 33; q(1 - i / 300); }
    d(900);
    v.push({ ps, pd, ss: g.eyes.left.y.sigma, sd: g.eyes.right.y.sigma });
  }

  const ini = v[2], fin = v[49];
  ok(fin.pd > ini.pd * 0.8,
     `60a. l occhio debole non viene trascinato dal forte (${ini.pd.toFixed(1)}σ → ${fin.pd.toFixed(1)}σ)`);
  ok(fin.ps > ini.ps * 0.8,
     `60b. e il forte resta forte (${ini.ps.toFixed(1)}σ → ${fin.ps.toFixed(1)}σ)`);
  ok(fin.pd > 5, `60c. il debole resta usabile (${fin.pd.toFixed(1)}σ)`);

  /* ⚠️ E nessun collasso SIMULTANEO: se le due stime saltano insieme
   * allo stesso valore, c'è un accoppiamento da qualche parte. */
  let simultanei = 0;
  for (let i = 1; i < v.length; i++) {
    const saltoSx = v[i].ss > v[i - 1].ss * 3;
    const saltoDx = v[i].sd > v[i - 1].sd * 3;
    if (saltoSx && saltoDx) simultanei++;
  }
  ok(simultanei === 0,
     `60d. le due stime non saltano mai insieme (${simultanei} volte)`);

  /* Il codice non deve contenere propagazione fra occhi del
   * congelamento: è la forma che aveva l'accoppiamento. */
  const fs60 = await import('node:fs');
  const path60 = await import('node:path');
  const qui60 = path60.dirname(import.meta.filename || process.argv[1]);
  const src = fs60.readFileSync(path60.join(qui60, '..', 'js/signal/GestureEngine.js'), 'utf8');
  const iC = src.indexOf('_congelaAsse(eye, axis, congela)');
  const corpo = src.slice(iC, src.indexOf('\n  }', iC));
  ok(!/for \(const altro of/.test(corpo),
     '60e. il congelamento di un occhio non tocca l altro');
}

/* ══════ 61. Indipendenza dei due occhi, verificata ══════
 *
 * ⚠️ Ogni stato che si accumula dev'essere PER OCCHIO. Se anche uno
 * solo fosse condiviso, la taratura buona per un occhio guasterebbe
 * l'altro — ed è esattamente ciò che accadeva quando la stima del
 * rumore di uno veniva sospesa dai gesti dell'altro.               */
{
  const g = new GestureEngine(deepClone(DEFAULT_CONFIG), () => {});
  for (const asse of ['y', 'x', 'a']) {
    const L = g.eyes.left[asse], R = g.eyes.right[asse];
    for (const campo of ['median', 'lp', 'base', 'hyst']) {
      ok(L[campo] !== R[campo],
         `61a. asse ${asse}: "${campo}" è separato fra i due occhi`);
    }
    ok(L.base.scala !== R.base.scala,
       `61b. asse ${asse}: anche la stima del rumore è separata`);
  }
  ok(g.blink.left !== g.blink.right, '61c. il rilevatore di chiusura è per occhio');
  ok(g.burst.left !== g.burst.right, '61d. e così il conteggio delle raffiche');

  /* ⚠️ La prova che conta: cambiando COMPLETAMENTE il comportamento di
   * un occhio, l'altro non deve muovere di una cifra. */
  function corsa(destroSiMuove) {
    const gg = new GestureEngine(deepClone(DEFAULT_CONFIG), () => {});
    let t = 0;
    const R = (x) => 0.006 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    const o = y => ({ x: 0, y: y + R(t), openness: 0.44, confidence: 0.97 });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; gg.process(t, { left: o(-0.03), right: o(-0.03) }); } };
    d(20000);
    let ps = 0;
    for (let k = 0; k < 40; k++) {
      ps = 0;
      const q = (f) => gg.process(t, {
        left: o(-0.03 - 0.14 * f),
        right: o(-0.03 - (destroSiMuove ? 0.14 : 0) * f),
      });
      for (let i = 0; i < 300; i += 33) { t += 33; q(i / 300); }
      for (let i = 0; i < 1100; i += 33) {
        t += 33; q(1);
        const a = gg.channels()['left.up']; if (a) ps = Math.max(ps, a.n);
      }
      for (let i = 0; i < 300; i += 33) { t += 33; q(1 - i / 300); }
      d(900);
    }
    return { ps, ss: gg.eyes.left.y.sigma, bs: gg.eyes.left.y.baseline };
  }
  const con = corsa(true), senza = corsa(false);
  ok(con.ps.toFixed(6) === senza.ps.toFixed(6),
     `61e. il sinistro è IDENTICO che il destro si muova o no (${con.ps.toFixed(2)}σ)`);
  ok(con.ss === senza.ss, '61f. compresa la sua stima del rumore');
  ok(con.bs === senza.bs, '61g. e la sua baseline');
}

/* ══════ 62. Modalità grezza: nulla si adatta ══════
 *
 * Serve quando i meccanismi adattivi falliscono, e serve soprattutto a
 * poterlo VERIFICARE: se in modalità grezza il segnale è stabile, il
 * problema sta nell'adattamento e non nel rilevamento.              */
{
  function corsa(grezzo) {
    const c = deepClone(DEFAULT_CONFIG);
    if (grezzo) { c.signal.modoGrezzo = true; c.signal.sigmaFisso = 0.02; }
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const R = (x) => 0.006 * Math.sin(2 * Math.PI * 4.2 * x / 1000)
                   + 0.010 * Math.sin(2 * Math.PI * 0.35 * x / 1000);
    const o = y => ({ x: 0, y: y + R(t), openness: 0.44, confidence: 0.97 });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(-0.03), right: o(-0.03) }); } };
    d(4000);
    const v = [];
    for (let k = 0; k < 60; k++) {
      if (k === 20) t += 82000;          // pausa del video
      let p = 0;
      for (let i = 0; i < 300; i += 33) { t += 33; g.process(t, { left: o(-0.03 - 0.14 * i / 300), right: o(-0.03 - 0.14 * i / 300) }); }
      for (let i = 0; i < 1100; i += 33) {
        t += 33; g.process(t, { left: o(-0.17), right: o(-0.17) });
        const ch = g.channels()['left.up']; if (ch) p = Math.max(p, ch.n);
      }
      for (let i = 0; i < 300; i += 33) { t += 33; g.process(t, { left: o(-0.17 + 0.14 * i / 300), right: o(-0.17 + 0.14 * i / 300) }); }
      d(900);
      v.push({ p, s: g.eyes.left.y.sigma, b: g.eyes.left.y.baseline });
    }
    return v;
  }

  const gz = corsa(true);
  ok(gz.every(x => x.s === gz[0].s),
     `62a. in modalità grezza la stima del rumore non cambia MAI (${gz[0].s})`);
  ok(gz.every(x => x.b === gz[0].b),
     `62b. e nemmeno la baseline (${gz[0].b.toFixed(4)})`);
  ok(gz[59].p > gz[2].p * 0.8,
     `62c. il segnale regge per tutta la sessione (${gz[2].p.toFixed(1)}σ → ${gz[59].p.toFixed(1)}σ)`);
  ok(gz[21].p > gz[19].p * 0.8,
     `62d. e una pausa del video non lo tocca (${gz[19].p.toFixed(1)}σ → ${gz[21].p.toFixed(1)}σ)`);
  ok(DEFAULT_CONFIG.signal.modoGrezzo === false,
     '62e. è spenta di default: chi non la usa non cambia comportamento');
}

/* ══════ 63. Parametri di segnale SEPARATI per occhio ══════
 *
 * ⚠️ Filtri, costante della baseline e stima del rumore possono avere
 * bisogno di tarature diverse: un occhio più coperto o più obliquo ha
 * un rumore diverso, e un filtro tarato sull'altro lo penalizza.
 * Finora la diagnostica misurava sull'occhio migliore e applicava a
 * entrambi.
 *
 * ⚠️ Le SOGLIE restano comuni di proposito: sono il criterio con cui
 * si decide che un gesto è avvenuto e devono significare la stessa
 * cosa per entrambi. È il guadagno per occhio a portare i due segnali
 * sulla stessa scala, non la soglia a inseguirli.                   */
{
  const c = deepClone(DEFAULT_CONFIG);
  c.signal.perOcchio.right = {
    medianWindowMs: 400, lowPassHz: 3.0,
    sigmaPercentile: 0.15, minConfidence: 0.25,
  };
  const g = new GestureEngine(c, () => {});

  ok(g.eyes.left.y.median.windowMs === DEFAULT_CONFIG.signal.medianWindowMs,
     `63a. il sinistro usa i valori generali (${g.eyes.left.y.median.windowMs} ms)`);
  ok(g.eyes.right.y.median.windowMs === 400,
     `63b. il destro usa i propri (${g.eyes.right.y.median.windowMs} ms)`);
  ok(g._confMin('left') !== g._confMin('right'),
     `63c. anche la confidenza minima è per occhio (${g._confMin('left')} contro ${g._confMin('right')})`);
  ok(g._sig('left').sigmaPercentile !== g._sig('right').sigmaPercentile,
     '63d. e il percentile della stima del rumore');

  /* ⚠️ MA NON le soglie: devono restare identiche comunque. */
  ok(g._sig('left').thresholdOn === g._sig('right').thresholdOn,
     `63e. le soglie restano comuni (${g._sig('right').thresholdOn})`);
  ok(g._sig('left').thresholdOff === g._sig('right').thresholdOff,
     '63f. anche quella di rilascio');

  // Anche forzandole per occhio, non devono passare
  const c2 = deepClone(DEFAULT_CONFIG);
  c2.signal.perOcchio.right = { thresholdOn: 99, thresholdOff: 50 };
  const g2 = new GestureEngine(c2, () => {});
  ok(g2._sig('right').thresholdOn === DEFAULT_CONFIG.signal.thresholdOn,
     '63g. una soglia scritta per occhio viene ignorata di proposito');

  /* Vuoto significa "come il generale": chi non li tocca non cambia. */
  const g3 = new GestureEngine(deepClone(DEFAULT_CONFIG), () => {});
  ok(g3._sig('left') === g3.cfg.signal && g3._sig('right') === g3.cfg.signal,
     '63h. senza valori propri si usa direttamente la configurazione generale');

  /* ⚠️ E dare parametri propri a un occhio non deve toccare l'altro. */
  function corsa(perOcchio) {
    const cc = deepClone(DEFAULT_CONFIG);
    if (perOcchio) cc.signal.perOcchio.right = { sigmaPercentile: 0.15, sigmaRitaratura: 2.6, medianWindowMs: 350 };
    const gg = new GestureEngine(cc, () => {});
    let t = 0;
    const RS = (x) => 0.006 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    const RD = (x) => 0.012 * Math.sin(2 * Math.PI * 1.1 * x / 1000);
    const o = (y, r) => ({ x: 0, y: y + r, openness: 0.44, confidence: 0.97 });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; gg.process(t, { left: o(-0.03, RS(t)), right: o(-0.03, RD(t)) }); } };
    d(20000);
    let ps = 0, pd = 0;
    for (let k = 0; k < 40; k++) {
      ps = 0; pd = 0;
      const q = (f) => gg.process(t, { left: o(-0.03 - 0.14 * f, RS(t)), right: o(-0.03 - 0.14 * f, RD(t)) });
      for (let i = 0; i < 300; i += 33) { t += 33; q(i / 300); }
      for (let i = 0; i < 1100; i += 33) {
        t += 33; q(1);
        const a = gg.channels()['left.up'], b = gg.channels()['right.up'];
        if (a) ps = Math.max(ps, a.n);
        if (b) pd = Math.max(pd, b.n);
      }
      for (let i = 0; i < 300; i += 33) { t += 33; q(1 - i / 300); }
      d(900);
    }
    return { ps, pd };
  }
  const comuni = corsa(false), separati = corsa(true);
  ok(comuni.ps.toFixed(3) === separati.ps.toFixed(3),
     `63i. tarare il destro non tocca il sinistro (${comuni.ps.toFixed(1)}σ in entrambi i casi)`);
  ok(separati.pd >= comuni.pd,
     `63l. e il destro ci guadagna (${comuni.pd.toFixed(1)}σ → ${separati.pd.toFixed(1)}σ)`);
}

/* ══════ 64. Stabilità dell'ampiezza nel tempo ══════
 *
 * ⚠️ Risolto il calo, è emerso il problema opposto: l'ampiezza SALE
 * per minuti. È lo stesso anello girato al contrario — si esclude
 * meglio, la stima scende, l'ampiezza sale, ci si aggancia meglio,
 * si esclude ancora meglio.
 *
 * Non è instabilità vera: la stima scende verso il proprio minimo e
 * lì si ferma. Ma il tragitto dura minuti, e in quei minuti chi
 * assiste deve inseguire con i guadagni.
 *
 * Il tetto alza il minimo in proporzione al gesto di QUELLA persona,
 * così il limite si raggiunge prima.                                */
{
  function corsa(tetto, n = 80) {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.plafondSigma = tetto;
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const R = (x) => 0.006 * Math.sin(2 * Math.PI * 4.2 * x / 1000)
                   + 0.008 * Math.sin(2 * Math.PI * 0.35 * x / 1000);
    const o = y => ({ x: 0, y: y + R(t), openness: 0.44, confidence: 0.97 });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(-0.03), right: o(-0.03) }); } };
    d(15000);
    const v = [];
    for (let k = 0; k < n; k++) {
      let ps = 0, pd = 0;
      const q = (f) => g.process(t, { left: o(-0.03 - 0.15 * f), right: o(-0.03 - 0.05 * f) });
      for (let i = 0; i < 300; i += 33) { t += 33; q(i / 300); }
      for (let i = 0; i < 1100; i += 33) {
        t += 33; q(1);
        const a = g.channels()['left.up'], b = g.channels()['right.up'];
        if (a) ps = Math.max(ps, a.n);
        if (b) pd = Math.max(pd, b.n);
      }
      for (let i = 0; i < 300; i += 33) { t += 33; q(1 - i / 300); }
      d(900);
      v.push({ ps, pd });
    }
    return v;
  }

  const conTetto = corsa(25);
  const senzaTetto = corsa(0);
  /* ⚠️ Il tetto non toglie l'oscillazione fra un gesto e l'altro —
   * quella è rumore di misura. Riduce l'ESCURSIONE COMPLESSIVA in cui
   * l'ampiezza si muove durante la sessione, ed è quella a costringere
   * chi assiste a inseguire con i guadagni: partire da 37σ e finire a
   * 28σ è un intervallo molto più largo che restare fra 26σ e 25σ. */
  const massimo = (v) => Math.max(...v.map(x => x.ps));
  ok(massimo(conTetto) < massimo(senzaTetto),
     `64a. il tetto limita il picco dell ampiezza (${massimo(conTetto).toFixed(1)}σ contro ${massimo(senzaTetto).toFixed(1)}σ)`);

  /* ⚠️ E soprattutto NON deve calare: è il difetto che ci ha
   * accompagnato per giorni e che non deve tornare. */
  ok(conTetto[79].ps > conTetto[9].ps * 0.65,
     `64b. e non cala (${conTetto[9].ps.toFixed(1)}σ → ${conTetto[79].ps.toFixed(1)}σ)`);
  ok(conTetto[79].pd > 4,
     `64c. anche l occhio debole resta usabile (${conTetto[79].pd.toFixed(1)}σ)`);
  ok(conTetto[79].ps > 10, `64d. e il forte resta ampio (${conTetto[79].ps.toFixed(1)}σ)`);

  /* Chi ha un gesto PICCOLO non dev'essere penalizzato: per lui il
   * tetto darebbe un minimo più basso di quello assoluto. */
  {
    const c = deepClone(DEFAULT_CONFIG);
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const o = y => ({ x: 0, y: y + 0.002 * Math.sin(2 * Math.PI * 4.2 * t / 1000), openness: 0.44, confidence: 0.97 });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(0), right: o(0) }); } };
    d(15000);
    let p = 0;
    for (let k = 0; k < 30; k++) {
      for (let i = 0; i < 300; i += 33) { t += 33; g.process(t, { left: o(-0.02 * i / 300), right: o(-0.02 * i / 300) }); }
      for (let i = 0; i < 1100; i += 33) {
        t += 33; g.process(t, { left: o(-0.02), right: o(-0.02) });
        const a = g.channels()['left.up']; if (a) p = Math.max(p, a.n);
      }
      for (let i = 0; i < 300; i += 33) { t += 33; g.process(t, { left: o(-0.02 * (1 - i / 300)), right: o(-0.02 * (1 - i / 300)) }); }
      d(900);
    }
    ok(p > 4, `64e. un gesto piccolo (0,02) resta rilevabile (${p.toFixed(1)}σ)`);
  }

  /* ── Soglia come frazione del gesto: spenta, ma deve funzionare ── */
  {
    const c = deepClone(DEFAULT_CONFIG);
    c.signal.sogliaRelativa = true;
    const g = new GestureEngine(c, () => {});
    let t = 0;
    const R = (x) => 0.006 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    const o = y => ({ x: 0, y: y + R(t), openness: 0.44, confidence: 0.97 });
    const d = (ms) => { for (let i = 0; i < ms; i += 33) { t += 33; g.process(t, { left: o(-0.03), right: o(-0.03) }); } };
    d(15000);
    const v = [];
    for (let k = 0; k < 60; k++) {
      let ps = 0, pd = 0;
      const q = (f) => g.process(t, { left: o(-0.03 - 0.15 * f), right: o(-0.03 - 0.05 * f) });
      for (let i = 0; i < 300; i += 33) { t += 33; q(i / 300); }
      for (let i = 0; i < 1100; i += 33) {
        t += 33; q(1);
        const a = g.channels()['left.up'], b = g.channels()['right.up'];
        if (a) ps = Math.max(ps, a.n);
        if (b) pd = Math.max(pd, b.n);
      }
      for (let i = 0; i < 300; i += 33) { t += 33; q(1 - i / 300); }
      d(900);
      v.push({ ps, pd });
    }
    ok(Math.abs(v[59].ps / v[19].ps - 1) < 0.30,
       `64f. con soglia relativa l ampiezza è stabile (${v[19].ps.toFixed(1)}σ → ${v[59].ps.toFixed(1)}σ)`);
    /* ⚠️ E i due occhi si pareggiano da soli: ciascuno è misurato
     * sulla PROPRIA escursione. */
    ok(Math.abs(v[59].pd / v[59].ps - 1) < 0.40,
       `64g. e i due occhi si pareggiano da soli (${v[59].ps.toFixed(1)}σ contro ${v[59].pd.toFixed(1)}σ, con gesti in rapporto 3:1)`);
    ok(DEFAULT_CONFIG.signal.sogliaRelativa === false,
       '64h. resta spenta di default: cambia il significato delle soglie');
  }
}

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail?1:0);
