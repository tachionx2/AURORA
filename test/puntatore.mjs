import { DEFAULT_CONFIG, deepClone, validateConfig } from '../js/core/config.js';
import { GazeCalibration, calibrationTargets } from '../js/pointer/calibration.js';
import { GazePointer } from '../js/pointer/GazePointer.js';
import { StripeCursor } from '../js/pointer/StripeCursor.js';
let pass=0, fail=0;
const ok=(c,m)=>{ if(c) pass++; else {fail++; console.log('  ✗ '+m);} };
const cfg = deepClone(DEFAULT_CONFIG);

// ---------- calibrazione ----------
const truth=(ex,ey)=>({x:960+2400*ex+300*ex*ex+180*ex*ey, y:540+2000*ey+260*ey*ey-120*ex*ey});
for(const n of [5,9,13]){
  const c=new GazeCalibration();
  for(const t of calibrationTargets(n)){
    const ex=(t.x-0.5)*0.34, ey=(t.y-0.5)*0.26, p=truth(ex,ey);
    c.add(ex+(Math.random()-0.5)*0.004, ey+(Math.random()-0.5)*0.004, p.x, p.y);
  }
  const r=c.fit();
  let e=0; for(let i=0;i<300;i++){
    const ex=(Math.random()-0.5)*0.34, ey=(Math.random()-0.5)*0.26;
    const p=truth(ex,ey), m=c.map(ex,ey); e+=Math.hypot(m.x-p.x,m.y-p.y);
  }
  ok(r.ok && e/300 < 20, `calibrazione ${n} punti: errore ${(e/300).toFixed(1)} px su punti nuovi`);
}
const deg=new GazeCalibration();
for(let i=0;i<9;i++) deg.add(0.01,0.01,100*i,50*i);
ok(!deg.fit().ok, 'sguardo immobile rifiutato invece di produrre un puntatore impazzito');
const onlyX=new GazeCalibration();
for(let i=0;i<9;i++) onlyX.add((i%3)*0.1, 0.005, 100*i, 50);
ok(!onlyX.fit().ok, 'solo asse orizzontale rifiutato');
const sv=new GazeCalibration();
for(const t of calibrationTargets(9)) sv.add((t.x-0.5)*0.3,(t.y-0.5)*0.24,t.x*1920,t.y*1080);
sv.fit();
const rl=new GazeCalibration();
ok(rl.load(sv.serialize()) && Math.abs(rl.map(0.1,0.05).x - sv.map(0.1,0.05).x) < 1e-9, 'calibrazione salvata e ricaricata identica');

// ---------- puntatore: permanenza, click, doppio click ----------
function pointerRun(mod, script){
  const c=deepClone(DEFAULT_CONFIG); mod&&mod(c);
  const ev=[]; const p=new GazePointer(c, e=>ev.push(e));
  p.setCalibration(sv); p.setViewport(1920,1080); p.setEnabled(true);
  script(p, (t,ex,ey)=>p.update(t,{x:ex,y:ey}));
  return {ev,p};
}
// fermo su un punto → un click
let r=pointerRun(null,(p,u)=>{ for(let t=0;t<3000;t+=16) u(t,0.05,0.03); });
ok(r.ev.filter(e=>e.type==='click').length>=1, 'permanenza su un punto produce un click');
ok(r.p.counters.clicks>=1, 'contatore click aggiornato');
// sguardo che si muove di continuo → nessun click
r=pointerRun(null,(p,u)=>{ for(let t=0;t<4000;t+=16) u(t, 0.14*Math.sin(t/220), 0.10*Math.cos(t/190)); });
ok(r.ev.filter(e=>e.type==='click').length===0, 'sguardo in movimento continuo NON produce click (click di Mida evitato)');
r=pointerRun(null,(p,u)=>{ for(let t=0;t<700;t+=16) u(t,0.05,0.03); for(let t=700;t<1400;t+=16) u(t,-0.12,-0.10); });
ok(r.p.counters.aborted===1, 'permanenza interrotta contata');
// doppio click
r=pointerRun(c=>{c.pointer.dwellClickMs=400;c.pointer.refractoryMs=150;},(p,u)=>{ for(let t=0;t<2500;t+=16) u(t,0.05,0.03); });
ok(r.ev.some(e=>e.type==='dblclick'), 'seconda permanenza vicina → doppio click');
// smorzamento: il puntatore non salta
r=pointerRun(c=>{c.pointer.smoothing=0.85;},(p,u)=>{
  for(let t=0;t<3000;t+=16) u(t,-0.15,-0.12);
  const b0={...p.pos}; u(3016,0.15,0.12);
  const mv=Math.hypot(p.pos.x-b0.x,p.pos.y-b0.y), gp=Math.hypot(p.raw.x-b0.x,p.raw.y-b0.y);
  ok(mv < 0.2*gp, 'smorzamento alto: nessun salto brusco');
});
// puntatore spento non emette nulla
r=pointerRun(null,(p,u)=>{ p.setEnabled(false); for(let t=0;t<3000;t+=16) u(t,0.05,0.03); });
ok(r.ev.length===0, 'puntatore spento non emette eventi');

// ---------- cursore a bande ----------
function stripeRun(mod, gestures){
  const c=deepClone(DEFAULT_CONFIG); mod&&mod(c);
  const ev=[]; const s=new StripeCursor(c, e=>ev.push(e));
  s.setViewport(1000,800);
  let t=0; s.start(t);
  for(const wait of gestures){ for(let i=0;i<wait;i+=20){ t+=20; s.tick(t); } s.select(t); }
  return {ev,s,t};
}
// due passate per asse = 4 gesti per un click
let sr=stripeRun(null,[300,300,300,300]);
ok(sr.ev.some(e=>e.type==='click'), 'quattro gesti (2 passate x 2 assi) producono un click');
// una passata per asse = 2 gesti
sr=stripeRun(c=>{c.pointer.stripePasses=1;},[300,300]);
ok(sr.ev.some(e=>e.type==='click'), 'con una passata bastano due gesti');
const click=sr.ev.find(e=>e.type==='click');
ok(click.x>=0 && click.x<=1000 && click.y>=0 && click.y<=800, 'click dentro il viewport');
// la seconda passata restringe davvero l'intervallo
sr=stripeRun(null,[300]);
const snap=sr.s.snapshot();
ok((snap.range.x1-snap.range.x0) < 0.5, 'seconda passata restringe l intervallo X (ampiezza '+(snap.range.x1-snap.range.x0).toFixed(2)+')');
// annullamento
const s2=new StripeCursor(cfg,()=>{}); s2.setViewport(1000,800); s2.start(0);
ok(s2.active, 'bande attive dopo start');
s2.cancel();
ok(!s2.active, 'annullamento ferma le bande');
// riparte da sola dopo il click
sr=stripeRun(c=>{c.pointer.stripePasses=1;},[300,300]);
ok(sr.s.active, 'dopo il click riparte da sola: chi ha un solo gesto non deve riattivarla');
// esce da sola dopo troppe passate a vuoto
const s3=new StripeCursor(cfg,()=>{}); s3.setViewport(1000,800);
let t3=0; s3.start(t3);
for(let i=0;i<2000;i++){ t3+=20; s3.tick(t3); }
ok(!s3.active, 'esce da sola dopo le passate a vuoto invece di scorrere all infinito');

// ---------- configurazione ----------
ok(validateConfig(cfg).length===0, 'config con puntatore e dispositivo valida');
const bad=deepClone(DEFAULT_CONFIG); bad.device.limitXMin=0.9; bad.device.limitXMax=0.1;
ok(validateConfig(bad).some(e=>/limiti X/.test(e)), 'limiti di spazio invertiti rilevati');
const bad2=deepClone(DEFAULT_CONFIG); bad2.pointer.dwellClickMs=10;
ok(validateConfig(bad2).length>0, 'permanenza assurda rifiutata');

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail?1:0);
