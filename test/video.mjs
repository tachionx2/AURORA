/**
 * Verifica della catena completa di osservazione, con un DOM minimo.
 * Questo test avrebbe intercettato lo shadowing di t(): l'errore
 * lanciava a ogni fotogramma e nessun test lo copriva.
 */
let pass=0, fail=0;
const ok=(c,m)=>{ if(c) pass++; else {fail++; console.log('  ✗ '+m);} };

// --- DOM finto, sufficiente per il ciclo di osservazione ---
const drawn = { eyeLeft:0, eyeRight:0, plot:0 };
function fakeCanvas(name){
  return { width:380, height:200, style:{}, dataset:{},
    getContext:()=>({ 
      clearRect(){}, fillRect(){}, strokeRect(){}, fillText(){}, measureText:()=>({width:10}),
      beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, arc(){}, ellipse(){},
      setLineDash(){}, drawImage(){ drawn[name]++; }, roundRect(){}, setTransform(){},
      save(){}, restore(){}, createImageData:()=>({data:[]}), putImageData(){},
      set fillStyle(v){}, set strokeStyle(v){}, set lineWidth(v){}, set font(v){}, set textAlign(v){},
    }) };
}
const els = {};
const mk = (id) => els[id] || (els[id] = /eye|plot|Canvas/i.test(id)
  ? fakeCanvas(id === 'eyeLeft' ? 'eyeLeft' : id === 'eyeRight' ? 'eyeRight' : 'plot')
  : { textContent:'', innerHTML:'', style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){}},
      append(){}, querySelectorAll:()=>[], onclick:null, value:'', scrollTop:0, scrollHeight:0,
      offsetHeight:0, clientHeight:100, scrollBy(){}, addEventListener(){}, files:null });

global.window = { innerWidth:1280, innerHeight:800, devicePixelRatio:1,
  addEventListener(){}, speechSynthesis:null, AudioContext:function(){}, matchMedia:()=>({matches:false}) };
global.document = {
  body:{ dataset:{ tab:'diagnostica' }, classList:{ add(){},remove(){},toggle(){} } },
  documentElement:{ style:{ setProperty(){} }, lang:'it' },
  getElementById: mk,
  querySelector: ()=>null, querySelectorAll: ()=>[],
  createElement: (tag)=> tag==='canvas' ? fakeCanvas('plot') : mk('el'+Math.random()),
  head:{ appendChild(){} }, fonts:null, addEventListener(){},
};
global.performance = { now: () => Date.now() };
global.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
Object.defineProperty(global, 'navigator', { value:{ mediaDevices:{ enumerateDevices:async()=>[] } }, configurable:true });
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

const { DEFAULT_CONFIG, deepClone } = await import('../js/core/config.js');
const { GestureEngine } = await import('../js/signal/GestureEngine.js');
const { drawEyeDebug, SignalPlot, BLINK_STYLE } = await import('../js/vision/VisionPipeline.js');
const { setLanguage, t } = await import('../js/core/i18n.js');
setLanguage('it');

// Riproduce esattamente ciò che fa _observe, con gli stessi nomi.
const cfg = deepClone(DEFAULT_CONFIG);
const gestures = new GestureEngine(cfg, ()=>{});
gestures.setDiagnostics(true);
const plot = new SignalPlot(fakeCanvas('plot'));
const COLORS = { bg:'#0A0F14', text:'#EEF4F7', muted:'#7C93A4', accent:'#F5B942',
                 accent2:'#5FD3A0', hot:'#FF6B5B', warn:'#E8A33D', grid:'#24323E' };

function observe(tMs, obs, res) {
  const out = gestures.process(tMs, obs);
  const ch = gestures.channels();
  const blink = {};
  for (const id of Object.keys(BLINK_STYLE)) blink[id] = !!ch[id]?.closed;
  plot.push({ ch, blink, evt:null });
  const domEye = gestures.dominant;
  const chip = document.getElementById('chipSignal');
  if (out.fused) {
    const q = gestures.snr[domEye] ?? 0;
    chip.textContent = q > 4 ? t('status.good') : q > 2 ? t('status.fair') : t('status.weak');
  } else chip.textContent = t('status.noEye');
  const frame = { src:{}, w:640, h:480 };
  drawEyeDebug(document.getElementById('eyeLeft'), frame, res, 'left', cfg, COLORS);
  drawEyeDebug(document.getElementById('eyeRight'), frame, res, 'right', cfg, COLORS);
  return chip.textContent;
}

// Osservazione realistica: due occhi rilevati con pixel per il disegno
const px = (cx,cy)=>({ iris:{x:cx,y:cy}, inner:{x:cx-20,y:cy}, outer:{x:cx+20,y:cy},
  upper:{x:cx,y:cy-8}, lower:{x:cx,y:cy+8}, eyeWidth:40, irisRadius:9,
  roi:{x:cx-32,y:cy-22,w:64,h:44} });
const res = {
  left:  { x:0.01, y:-0.02, openness:0.30, confidence:0.9, px:px(200,240) },
  right: { x:0.00, y:-0.01, openness:0.31, confidence:0.9, px:px(440,240) },
};
const obs = { left:res.left, right:res.right };

let label = null, err = null;
try { for (let i=0;i<60;i++) label = observe(i*33, obs, res); }
catch(e){ err = e.message; }

ok(!err, 'il ciclo di osservazione non lancia eccezioni ('+err+')');
ok(drawn.eyeLeft>0, 'occhio SINISTRO disegnato ('+drawn.eyeLeft+' fotogrammi)');
ok(drawn.eyeRight>0, 'occhio DESTRO disegnato ('+drawn.eyeRight+' fotogrammi)');
ok(/segnale|nessun/.test(label||''), 'stato del segnale tradotto: "'+label+'"');
ok(Object.keys(gestures.channels()).length===10, 'dieci canali diagnostici');
ok(plot.frames.length===60, 'grafico alimentato per ogni fotogramma');

// Nessun occhio rilevato: non deve rompersi
let err2=null;
try { observe(9999, {left:null,right:null}, {left:null,right:null}); } catch(e){ err2=e.message; }
ok(!err2, 'nessun occhio rilevato: nessuna eccezione ('+err2+')');
ok(document.getElementById('chipSignal').textContent===t('status.noEye'), 'mostra "nessun occhio"');

// In inglese
setLanguage('en');
let err3=null, l3=null;
try { l3 = observe(10000, obs, res); } catch(e){ err3=e.message; }
ok(!err3 && /signal|no eye/.test(l3||''), 'funziona anche in inglese: "'+l3+'"');
setLanguage('it');


/* ── Il tracker in luce visibile: la catena completa con i tre termini ── */
{
  const { RgbTracker, EYE_LM } = await import('../js/vision/RgbTracker.js');
  const { DEFAULT_CONFIG, deepClone } = await import('../js/core/config.js');

  // Volto sintetico. ⚠️ MediaPipe fornisce coordinate NORMALIZZATE fra
  // 0 e 1, che il tracker riporta in pixel moltiplicando per larghezza
  // e altezza. Il banco deve fare lo stesso, altrimenti un'iride
  // circolare risulterebbe ellittica solo per via delle proporzioni del
  // fotogramma — e si accuserebbe il codice di un errore del test.
  const W = 640, H = 480;
  function volto({ dxIride = 0, dyIride = 0, raggio = 6, schiacciato = 1, apertura = 8 }) {
    const p = new Array(478).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
    const n = (x, y) => ({ x: x / W, y: y / H, z: 0 });
    const occhio = (M, cx) => {
      p[M.inner] = n(cx - 15, 240); p[M.outer] = n(cx + 15, 240);
      p[M.upper] = n(cx, 240 - apertura); p[M.lower] = n(cx, 240 + apertura);
      const ix = cx + dxIride, iy = 240 + dyIride;
      p[M.iris[0]] = n(ix, iy);                                  // centro
      p[M.iris[1]] = n(ix - raggio, iy);
      p[M.iris[2]] = n(ix + raggio, iy);
      p[M.iris[3]] = n(ix, iy - raggio * schiacciato);
      p[M.iris[4]] = n(ix, iy + raggio * schiacciato);
    };
    occhio(EYE_LM.right, 200);
    occhio(EYE_LM.left, 440);
    return [p];
  }

  const cfg = deepClone(DEFAULT_CONFIG);
  const tr = new RgbTracker(cfg);
  tr.ready = true;
  tr.landmarker = { detectForVideo: (src, t) => ({ faceLandmarks: tr._prossimo }) };
  const leggi = (par, t) => {
    tr._prossimo = volto(par);
    return tr.detect({}, t, W, H);
  };

  // Si lascia imparare il raggio tipico
  let t = 0, r = null;
  for (let i = 0; i < 120; i++) { t += 33; r = leggi({ raggio: 6 }, t); }
  ok(r.left && r.right, 'tracker: entrambi gli occhi rilevati');
  ok(r.left.confidence > 0.9, `tracker: fotogramma normale ad alta fiducia (${r.left.confidence.toFixed(2)})`);
  ok(r.left.px.rifRaggio > 0, 'tracker: il raggio tipico della persona viene appreso');
  ok(Math.abs(r.left.px.circolarita - 1) < 0.05, 'tracker: iride circolare riconosciuta come tale');

  // Iride schiacciata: la fiducia deve scendere
  t += 33; const sch = leggi({ raggio: 6, schiacciato: 0.45 }, t);
  ok(sch.left.confidence < r.left.confidence - 0.2,
     `tracker: iride schiacciata → fiducia in calo (${sch.left.confidence.toFixed(2)})`);

  // Raggio molto diverso dal proprio normale
  t += 33; const grande = leggi({ raggio: 10 }, t);
  ok(grande.left.confidence < r.left.confidence - 0.15,
     `tracker: raggio fuori dal proprio normale → fiducia in calo (${grande.left.confidence.toFixed(2)})`);

  // Salto impossibile fra due fotogrammi consecutivi
  for (let i = 0; i < 60; i++) { t += 33; leggi({ raggio: 6 }, t); }
  t += 33; const salto = leggi({ raggio: 6, dxIride: 25 }, t);
  ok(salto.left.confidence < 0.5,
     `tracker: scatto impossibile → campione scartabile (${salto.left.confidence.toFixed(2)})`);

  // ⚠️ Verifica di NON regressione: un movimento oculare NORMALE non
  // deve mai essere penalizzato dai tre termini nuovi.
  // Prima si lascia assestare: il RITORNO dallo scatto simulato qui
  // sopra è a sua volta uno scatto impossibile, e falserebbe la misura.
  for (let i = 0; i < 20; i++) { t += 33; leggi({ raggio: 6 }, t); }
  let minimo = 1;
  for (let i = 0; i < 60; i++) {
    t += 33;
    const dx = 4 * Math.sin(i / 6), dy = 3 * Math.cos(i / 5);
    const q = leggi({ raggio: 6, dxIride: dx, dyIride: dy }, t);
    minimo = Math.min(minimo, q.left.confidence);
  }
  ok(minimo > 0.85, `tracker: movimento oculare normale mai penalizzato (minimo ${minimo.toFixed(2)})`);
}

/* ── Catena COMPLETA: dal volto al comando, passando dalla pipeline ──
 * ⚠️ Questo test esiste perché mancava: la pipeline costruiva
 * l'osservazione con i soli due occhi e buttava via le espressioni.
 * Erano lette dal rilevatore e perse un passaggio dopo, senza alcun
 * errore visibile — la funzione semplicemente non funzionava.        */
{
  const { RgbTracker: RT, EYE_LM: LM } = await import('../js/vision/RgbTracker.js');
  const { GestureEngine: GE } = await import('../js/signal/GestureEngine.js');
  const { DEFAULT_CONFIG: DC, deepClone: dc } = await import('../js/core/config.js');
  const Wf = 640, Hf = 480;

  function volto(bocca, conEspressioni = true) {
    const p = new Array(478).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
    const n = (x, y) => ({ x: x / Wf, y: y / Hf, z: 0 });
    const occhio = (M, cx) => {
      p[M.inner] = n(cx - 15, 240); p[M.outer] = n(cx + 15, 240);
      p[M.upper] = n(cx, 232); p[M.lower] = n(cx, 248);
      p[M.iris[0]] = n(cx, 240); p[M.iris[1]] = n(cx - 6, 240); p[M.iris[2]] = n(cx + 6, 240);
      p[M.iris[3]] = n(cx, 234); p[M.iris[4]] = n(cx, 246);
    };
    occhio(LM.right, 200); occhio(LM.left, 440);
    const r = { faceLandmarks: [p] };
    if (conEspressioni) r.faceBlendshapes = [{ categories: [
      { categoryName: 'jawOpen', score: bocca },
      { categoryName: 'mouthSmileLeft', score: 0.02 },
      { categoryName: 'mouthSmileRight', score: 0.04 },
      { categoryName: 'mouthPucker', score: 0.01 },
      { categoryName: 'mouthFunnel', score: 0.01 },
      { categoryName: 'cheekPuff', score: 0.01 },
      { categoryName: 'browInnerUp', score: 0.02 },
    ] }];
    return r;
  }

  function banco(faceOn) {
    const c = dc(DC);
    c.detection.faceChannels = faceOn;
    if (faceOn) { c.gestures.MOUTH_OPEN.enabled = true; c.gestures.MOUTH_OPEN.action = 'SELECT'; }
    const tr = new RT(c); tr.ready = true;
    tr.landmarker = { detectForVideo: () => tr._r };
    const ev = []; const g = new GE(c, e => ev.push(e));
    let tt = 0;
    // Esattamente ciò che fa VisionPipeline: se qui si perdessero le
    // espressioni, il test lo vedrebbe.
    const passo = (b, conE = true) => {
      tr._r = volto(b, conE);
      const res = tr.detect({}, tt, Wf, Hf);
      const obs = { left: res.left, right: res.right, espressioni: res.espressioni || null };
      return { res, out: g.process(tt, obs) };
    };
    return { tr, g, ev, passo, avanza: (ms) => { tt += ms; }, get t() { return tt; } };
  }

  const b = banco(true);
  let ultimo;
  for (let i = 0; i < 600; i++) { b.avanza(33); ultimo = b.passo(0.03); }
  ok(!!ultimo.res.espressioni, 'catena: il rilevatore restituisce le espressioni');
  ok(Math.abs(ultimo.res.espressioni.smile - 0.03) < 0.005,
     'catena: il sorriso è la MEDIA di destra e sinistra (asimmetrie incluse)');
  for (let i = 0; i < 32; i++) { b.avanza(33); b.passo(0.6); }
  for (let i = 0; i < 80; i++) { b.avanza(33); b.passo(0.03); }
  ok(b.ev.length === 1 && b.ev[0].channel === 'MOUTH_OPEN',
     `catena COMPLETA volto→comando funzionante (${b.ev.length} eventi)`);

  // ⚠️ NON REGRESSIONE: a canali spenti gli occhi devono comportarsi
  // esattamente come prima che le espressioni esistessero.
  const s = banco(false);
  let r2;
  for (let i = 0; i < 100; i++) { s.avanza(33); r2 = s.passo(0.03, false); }
  ok(!!(r2.res.left && r2.res.right), 'senza espressioni gli occhi sono rilevati normalmente');
  ok(r2.res.espressioni === null, 'e il campo espressioni resta vuoto');
  ok(r2.res.left.confidence > 0.9, 'la confidenza oculare non è toccata');
  ok(s.ev.length === 0, 'nessun evento spurio a canali del viso spenti');
}

/* ── Iride coperta dalla palpebra: chi alza molto lo sguardo ──
 *
 * ⚠️ Chi ha muscoli oculari forti alza lo sguardo fino a portare la
 * pupilla quasi sotto la palpebra superiore. Proprio in fondo alla
 * corsa — dove il movimento è più ampio e più utile — l'iride viene
 * coperta, il centro stimato scivola verso il basso, e il movimento
 * risulta più piccolo di quanto sia davvero.
 *
 * La palpebra taglia in orizzontale: i punti laterali dell'iride non
 * vengono mai coperti, quindi il raggio da lato a lato resta
 * attendibile e permette di ricostruire dove sta il centro vero.     */
{
  const { RgbTracker: RT2, EYE_LM: LM2 } = await import('../js/vision/RgbTracker.js');
  const { DEFAULT_CONFIG: DC2, deepClone: dc2 } = await import('../js/core/config.js');
  const Wq = 640, Hq = 480;

  // Volto sintetico con iride TAGLIATA: il modello restituisce un
  // cerchio più piccolo e spostato in basso, come fa in realtà.
  function voltoTagliato(alzata, taglio) {
    const p = new Array(478).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
    const n = (x, y) => ({ x: x / Wq, y: y / Hq, z: 0 });
    const occhio = (M, cx) => {
      p[M.inner] = n(cx - 15, 240); p[M.outer] = n(cx + 15, 240);
      p[M.upper] = n(cx, 232); p[M.lower] = n(cx, 248);
      const r = 6, iy = 240 - alzata;
      const rSopra = r * (1 - taglio);
      const cv = iy + (r - rSopra) / 2;
      p[M.iris[0]] = n(cx, cv);
      p[M.iris[1]] = n(cx - r, cv);
      p[M.iris[2]] = n(cx, iy - rSopra);
      p[M.iris[3]] = n(cx + r, cv);
      p[M.iris[4]] = n(cx, iy + r);
    };
    occhio(LM2.right, 200); occhio(LM2.left, 440);
    return { faceLandmarks: [p] };
  }

  const misura = (corr) => {
    const c = dc2(DC2);
    c.detection.irisOcclusionFix = corr;
    const tr = new RT2(c); tr.ready = true;
    tr.landmarker = { detectForVideo: () => tr._r };
    return [[0, 0], [3, 0], [6, 0.2], [9, 0.45], [11, 0.65], [12, 0.8]].map(([a, t]) => {
      tr._r = voltoTagliato(a, t);
      return { a, t, y: tr.detect({}, 1000, Wq, Hq).left.y, vero: -a / 3 * 0.1 };
    });
  };

  const senza = misura(false), con = misura(true);

  // Senza taglio la correzione NON deve toccare nulla: correggere
  // quando non serve sposterebbe il segno di continuo.
  for (let i = 0; i < 2; i++) {
    ok(Math.abs(con[i].y - senza[i].y) < 1e-9,
       `iride intera (${con[i].a}px): la correzione non interviene`);
  }

  // Con taglio forte deve recuperare il movimento perduto
  for (const i of [3, 4, 5]) {
    const eS = Math.abs(senza[i].y - senza[i].vero);
    const eC = Math.abs(con[i].y - con[i].vero);
    ok(eC < eS * 0.4,
       `taglio ${(con[i].t * 100).toFixed(0)}%: errore da ${eS.toFixed(4)} a ${eC.toFixed(4)}`);
    ok(Math.abs(con[i].y) > Math.abs(senza[i].y),
       `taglio ${(con[i].t * 100).toFixed(0)}%: il movimento recuperato è più ampio, non più piccolo`);
  }

  const totS = senza.reduce((a, x) => a + Math.abs(x.y - x.vero), 0);
  const totC = con.reduce((a, x) => a + Math.abs(x.y - x.vero), 0);
  ok(totC < totS * 0.3,
     `errore complessivo ridotto del ${((1 - totC / totS) * 100).toFixed(0)}%`);

  // ⚠️ Il calcolo della posizione deve avvenire DOPO la correzione:
  // prima veniva prodotto il numero e poi si correggeva il centro, e
  // la correzione non cambiava nulla. Un errore silenzioso.
  const fsQ = await import('node:fs');
  const pathQ = await import('node:path');
  const quiQ = pathQ.dirname(import.meta.filename || process.argv[1]);
  const srcQ = fsQ.readFileSync(pathQ.join(quiQ, '..', 'js/vision/RgbTracker.js'), 'utf8');
  ok(srcQ.indexOf('correzione !== 0') < srcQ.indexOf('const nx = -specchio'),
     'la posizione si calcola DOPO la correzione del centro, altrimenti non servirebbe a nulla');
}

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail?1:0);
