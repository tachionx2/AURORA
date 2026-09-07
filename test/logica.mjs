global.localStorage={_d:{},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=v},removeItem(k){delete this._d[k]}};
import { DEFAULT_CONFIG, deepClone, validateConfig, migrateConfig, exportProfile, importProfile } from '../js/core/config.js';
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
ok(old.version===34 && old.scan.groups.length===4 && old.scan.stepMs===900, 'migrazione v1→v34 preserva i valori');

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

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail?1:0);
