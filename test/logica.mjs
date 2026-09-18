global.localStorage={_d:{},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=v},removeItem(k){delete this._d[k]}};
import { DEFAULT_CONFIG, deepClone, validateConfig, migrateConfig, exportProfile, importProfile, CONFIG_VERSION } from '../js/core/config.js';
import { ScanEngine, buildTree, DEFAULT_PHRASES } from '../js/scan/ScanEngine.js';
import { Predictor } from '../js/lang/Predictor.js';
import { MedianWindow, LowPass, AdaptiveBaseline, Hysteresis, BlinkDetector } from '../js/signal/filters.js';
import { GestureEngine } from '../js/signal/GestureEngine.js';

let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;} else {fail++; console.log('  ✗ '+m);} };

// ---------- 1. Config ----------
const cfg = deepClone(DEFAULT_CONFIG);
ok(validateConfig(cfg).length===0, 'config default valida');
cfg.signal.thresholdOff = 9;
ok(validateConfig(cfg).length>0, 'isteresi invertita rilevata');
cfg.signal.thresholdOff = 1.5;
const round = importProfile(exportProfile(cfg, null));
ok(JSON.stringify(round.config)===JSON.stringify(cfg), 'export→import fedele');
const old = migrateConfig({version:1, scan:{stepMs:900}});
// ⚠️ La versione si legge da CONFIG_VERSION: scritta a mano, questo
// test va corretto a ogni aggiunta e smette di dire qualcosa di utile.
ok(old.version===CONFIG_VERSION && old.scan.groups.length===4 && old.scan.stepMs===900,
   `migrazione v1→v${CONFIG_VERSION} preserva i valori`);

// ---------- 2. Filtri ----------
const med=new MedianWindow(250);
let m=0; for(let i=0;i<40;i++) m=med.push(i*10, i%2?0:1);   // onda quadra
ok(m>=0 && m<=1, 'mediana in range');
const spike=new MedianWindow(200); let sv=0;
for(let i=0;i<20;i++) sv=spike.push(i*10, i===10?100:1);
ok(sv<2, 'mediana rigetta lo spike ('+sv+')');

// baseline: NON deve inseguire quando congelata
const bl=new AdaptiveBaseline(30,0.001);
for(let i=0;i<300;i++) bl.push(i*20, 0);
const before=bl.mean;
bl.freeze();
for(let i=300;i<800;i++) bl.push(i*20, 1.0);
ok(Math.abs(bl.mean-before)<1e-9, 'baseline congelata non insegue il gesto');
bl.release();
for(let i=800;i<3000;i++) bl.push(i*20, 1.0);
ok(bl.mean>0.5, 'baseline rilasciata insegue la deriva ('+bl.mean.toFixed(3)+')');

const hy=new Hysteresis(3,1);
ok(hy.update(4,1)==='rise' && hy.update(2,1)===null && hy.update(0.5,1)==='fall', 'isteresi: rise/hold/fall');

const bd=new BlinkDetector();
let last; for(let i=0;i<200;i++) last=bd.update(0.28+Math.random()*0.06);
ok(!last.closed && bd.update(0.06).closed, 'ammiccamento auto-calibrato');

// ---------- 3. Albero ----------
const tree = buildTree(cfg, {suggestions:[], phrases:DEFAULT_PHRASES});
ok(tree.children.length===3, 'radice: frasi/scrivi/pausa');
const write = tree.children.find(c=>c.id==='write');
ok(write.children[0].action==='BACK' && write.children[1].id==='act', 'scrivi: indietro e azioni in testa');
const g1 = write.children.find(c=>c.id==='g1');
ok(g1.children[0].payload===' ', 'spazio primo nel gruppo vocali');

// ---------- 4. Motore di scansione: comporre "ho sete" ----------
const out=[]; const said=[];
const eng = new ScanEngine(cfg, {
  onOutput:(k,t)=>{ if(k==='speech') said.push(t); out.push(k+':'+t); },
});
let T=0; const tick=(ms)=>{ for(let i=0;i<ms;i+=50){ T+=50; eng.tick(T);} };
eng.start(T);

// seleziona un percorso: naviga fino a trovare l'etichetta cercata
function selectLabel(label, maxSteps=60){
  for(let s=0;s<maxSteps;s++){
    if(eng.currentNode?.label===label){ eng.select(T); return true; }
    tick(cfg.scan.stepMs+cfg.scan.cyclePauseMs+50);
  }
  return false;
}
ok(selectLabel('Scrivi'), 'raggiunge il gruppo Scrivi');
ok(selectLabel('L–B'), 'raggiunge il gruppo L–B');
ok(selectLabel('H'), 'raggiunge la lettera H');
ok(eng.buffer.letters==='H', 'buffer contiene H (got "'+eng.buffer.letters+'")');
// dopo una lettera si torna al livello scrittura, non alla radice
ok(eng.stack[eng.stack.length-1].node.id==='write', 'ritorno al livello scrittura dopo la lettera');

// ---------- 5. Undo ----------
eng.undo(T);
ok(eng.buffer.letters==='', 'undo al livello scrittura cancella la lettera');

// ---------- 6. Pausa impedisce ogni selezione ----------
eng.pause(T);
const before6 = eng.buffer.letters;
eng.select(T);           // in pausa: select deve risvegliare, non selezionare
ok(!eng.paused, 'select in pausa risveglia');
eng.pause(T);
tick(20000);
ok(eng.paused, 'in pausa il tick non fa nulla');

// ---------- 7. Fuzz: nessuna transizione illegale ----------
eng.start(T);
const acts=['SELECT','UNDO','WAKE','SPEAK','BACK','NEXT'];
let crashed=null;
try{
  for(let i=0;i<10000;i++){
    T+=Math.random()*400;
    eng.tick(T);
    if(Math.random()<0.25) eng.handleAction(acts[(Math.random()*acts.length)|0], T);
    if(eng.stack.length===0) throw new Error('stack vuoto');
    if(eng.stack.length>8) throw new Error('stack troppo profondo: '+eng.stack.length);
    if(eng.level.index<0 || eng.level.index>=Math.max(1,eng.level.node.children?.length||1))
      throw new Error('indice fuori range');
  }
}catch(e){ crashed=e.message; }
ok(!crashed, 'fuzz 10.000 eventi senza stati illegali ('+crashed+')');

// ---------- 8. Predittore ----------
const p = new Predictor(cfg, null);
p.seedPhrases(['Ho sete','Ho fame','Ho dolore']);
for(let i=0;i<5;i++) p.learnSentence('ho sete adesso');
const comp = p.completions('se', 'ho', 4);
ok(comp.includes('sete'), 'completa "se"→"sete" (got '+JSON.stringify(comp)+')');
const top = p.topPhrases(5);
ok(top.includes('Ho sete'), 'frase imparata in cima');
const dist = p.nextCharDistribution('ho');
ok(dist.size>0, 'distribuzione caratteri non vuota');
const st = p.stats();
ok(st.words.length>0 && st.letters.length>0, 'statistiche popolate');

// ---------- 9. GestureEngine: gradino su rumore oscillante ----------
const ev=[];
const ge = new GestureEngine(cfg, e=>ev.push(e));
let t2=0;
const feed=(dur, yFn)=>{ for(let i=0;i<dur;i+=20){ t2+=20;
  const y = yFn(t2);
  ge.process(t2, {left:{x:0,y,openness:0.9,confidence:0.9}, right:null});
}};
// nistagmo a 4 Hz, ampiezza 0.01, nessun gesto → nessun evento
cfg.detection.activeEye='left';
ge.updateConfig(cfg);
feed(20000, t=>0.01*Math.sin(2*Math.PI*4*t/1000));
const falsePos = ev.length;
ok(falsePos===0, 'nessun falso positivo su 20 s di nistagmo puro (got '+falsePos+')');
// ora un gradino verso l'alto (y negativo) di 800 ms
feed(1000, t=>0.01*Math.sin(2*Math.PI*4*t/1000) - 0.08);
feed(3000, t=>0.01*Math.sin(2*Math.PI*4*t/1000));
ok(ev.length>=1, 'gradino rilevato come gesto (eventi: '+ev.length+')');
ok(ev.some(e=>e.action==='SELECT'), 'gesto breve mappato su SELECT');

/* ══════ Nessuna configurazione salvata deve poter bloccare l'avvio ══════
 *
 * ⚠️ È successo davvero, ed è il difetto peggiore che questo programma
 * abbia avuto: una configurazione salvata illeggibile fermava il
 * caricamento prima della fine, il pulsante per iniziare restava
 * spento, e per chi comunica solo con Aurora significava restare
 * senza voce — senza nemmeno un messaggio che spiegasse perché.
 *
 * La causa: `typeof null` vale 'object' in JavaScript. Un valore
 * predefinito nullo superava il controllo come se fosse un oggetto, e
 * `'samples' in null` sollevava un'eccezione.
 *
 * Il difetto era latente da sempre: serviva una calibrazione salvata
 * per raggiungerlo, quindi si presentava solo a chi aveva davvero
 * usato il programma a lungo. */
{
  /* Tutti i campi che nascono nulli: ognuno è una trappola potenziale,
   * perché prima o poi qualcosa ci verrà salvato dentro. */
  const nulli = [];
  (function vai(o, via) {
    for (const [k, v] of Object.entries(o || {})) {
      if (v === null) nulli.push(via + k);
      else if (typeof v === 'object' && !Array.isArray(v)) vai(v, `${via}${k}.`);
    }
  })(DEFAULT_CONFIG, '');
  ok(nulli.length > 0, `ci sono ${nulli.length} campi con valore predefinito nullo`);

  /* Per ciascuno: salvarci dentro un oggetto e ricaricare. */
  for (const via of nulli) {
    const salvata = { version: CONFIG_VERSION };
    let n = salvata;
    const parti = via.split('.');
    for (let i = 0; i < parti.length - 1; i++) { n[parti[i]] = n[parti[i]] || {}; n = n[parti[i]]; }
    n[parti[parti.length - 1]] = { qualcosa: [1, 2], altro: 'x' };
    let esito = 'ok';
    try { migrateConfig(salvata); } catch (e) { esito = e.message; }
    ok(esito === 'ok', `un oggetto salvato in "${via}" non blocca l avvio (${esito})`);
  }

  /* Il caso reale che ha bloccato il programma. */
  const reale = { version: CONFIG_VERSION, pointer: { calibrationData: {
    samples: [{ ex: 0.1, ey: 0.2, sx: 100, sy: 200 }],
    coefX: [1, 0, 0], coefY: [0, 1, 0], full: true, error: 12.3,
    offset: { x: 0, y: 0 }, perPoint: [],
  } } };
  let c = null, errore = null;
  try { c = migrateConfig(reale); } catch (e) { errore = e.message; }
  ok(!errore, `una calibrazione salvata si ricarica (${errore || 'confermato'})`);
  ok(c?.pointer?.calibrationData?.samples?.length === 1,
     'e i campioni restano intatti: non si perde la taratura');
  ok(Array.isArray(c?.pointer?.calibrationData?.coefX),
     'compresi i coefficienti');

  /* ⚠️ Una calibrazione può andare male in molti modi: interrotta a
   * metà, senza campioni, con campi mancanti. Ognuno lascia nei dati
   * salvati una forma diversa, e NESSUNA deve poter bloccare l'avvio —
   * perché è proprio dopo una calibrazione andata male che si riapre
   * il programma per riprovare. */
  const modiDiRompersi = {
    'interrotta a metà': { samples: [{ ex: 0.1, ey: 0.2, sx: 100, sy: 200 }],
                           coefX: null, coefY: null, full: false, error: null,
                           offset: null, perPoint: null },
    'senza campioni': { samples: [], coefX: null, coefY: null },
    'campi mancanti': { samples: [1, 2, 3] },
    'oggetto vuoto': {},
    'valori anomali': { samples: 'rotto', coefX: 42, offset: 'x' },
    'annidata strana': { samples: [{ a: { b: { c: null } } }], offset: { x: null, y: null } },
  };
  for (const [nome, dati] of Object.entries(modiDiRompersi)) {
    let err = null;
    try { migrateConfig({ version: CONFIG_VERSION, pointer: { calibrationData: dati } }); }
    catch (e) { err = e.message; }
    ok(!err, `una calibrazione "${nome}" non blocca l avvio (${err || 'confermato'})`);
  }

  /* ⚠️ E la rete: se nonostante tutto la lettura fallisce, il
   * programma parte dai predefiniti invece di non partire. Si perde
   * una taratura, non la possibilità di parlare. */
  const fsN = await import('node:fs');
  const pathN = await import('node:path');
  const quiN = pathN.dirname(import.meta.filename || process.argv[1]);
  const main = fsN.readFileSync(pathN.join(quiN, '..', 'js/main.js'), 'utf8');
  const iC = main.indexOf('this.cfg = migrateConfig');
  const corpo = main.slice(iC - 200, iC + 900);
  ok(/try \{[\s\S]*migrateConfig[\s\S]*\} catch/.test(corpo),
     'la lettura delle impostazioni è protetta: un guasto non ferma l avvio');
  ok(/deepClone\(DEFAULT_CONFIG\)/.test(corpo),
     'e in quel caso si riparte dai valori predefiniti');
  ok(/guasta/.test(corpo),
     'conservando da parte la copia illeggibile, invece di cancellarla');
  ok(/LS_CONFIG/.test(corpo),
     'con la chiave vera, non una scritta a mano che un domani non corrisponderebbe');
}

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail?1:0);
