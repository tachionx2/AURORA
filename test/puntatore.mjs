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

/* ══════ Calibrazione più robusta ══════
 *
 * ⚠️ Sul campo la calibrazione veniva RIFIUTATA alla fine — "movimento
 * verticale troppo piccolo" — dopo tutta la fatica di guardare nove
 * punti. Il motivo: tempi troppo brevi, lo sguardo non faceva in tempo
 * ad assestarsi, e i campioni contenevano ancora il tragitto verso il
 * bersaglio invece della posizione raggiunta.
 *
 * Tre rimedi, che si sommano.                                       */
{
  const { DEFAULT_CONFIG: DP } = await import('../js/core/config.js');
  const P = DP.pointer;

  ok(P.calibrationDwellMs >= 2000,
     `1. la permanenza su ogni bersaglio è generosa (${P.calibrationDwellMs} ms)`);
  ok(P.calibrationSettleMs >= 600,
     `2. e si attende che lo sguardo ARRIVI prima di raccogliere (${P.calibrationSettleMs} ms)`);
  ok(P.calibrationGiri >= 2,
     `3. si ripassa più volte su ogni bersaglio (${P.calibrationGiri} giri)`);
  ok(P.calibrationBordoGiri >= 1,
     `4. e si percorre il perimetro per misurare l escursione massima (${P.calibrationBordoGiri} giri)`);

  /* Quanti campioni si raccolgono in tutto: era nove, uno per punto. */
  const daBordo = Math.round(P.calibrationBordoGiri * P.calibrationBordoMs / P.calibrationBordoOgniMs);
  const daBersagli = P.calibrationPoints * P.calibrationGiri;
  ok(daBordo + daBersagli >= 60,
     `5. in tutto si raccolgono ~${daBordo + daBersagli} campioni (erano ${P.calibrationPoints})`);

  /* ⚠️ Ma non deve durare troppo: chi calibra con un solo gesto si
   * stanca, e una calibrazione stancante viene fatta male. */
  const durataSec = (P.calibrationBordoGiri * P.calibrationBordoMs
    + daBersagli * (P.calibrationDwellMs + P.calibrationSettleMs)) / 1000;
  ok(durataSec < 150,
     `6. e dura ${Math.round(durataSec)} secondi: abbastanza da riuscire, non da stancare`);

  /* Il punto del bordo deve percorrere davvero il perimetro. */
  const fsP = await import('node:fs');
  const pathP = await import('node:path');
  const quiP = pathP.dirname(import.meta.filename || process.argv[1]);
  const mainP = fsP.readFileSync(pathP.join(quiP, '..', 'js/main.js'), 'utf8');
  ok(/_puntoBordo\(frazione\)/.test(mainP), '7. esiste il percorso lungo il perimetro');

  // Si ricostruisce la funzione per verificarne la geometria.
  const puntoBordo = (frazione) => {
    const f = ((frazione % 1) + 1) % 1;
    const m = 0.06, a = m, b = 1 - m;
    if (f < 0.25) return { x: a + (b - a) * (f / 0.25), y: a };
    if (f < 0.50) return { x: b, y: a + (b - a) * ((f - 0.25) / 0.25) };
    if (f < 0.75) return { x: b - (b - a) * ((f - 0.50) / 0.25), y: b };
    return { x: a, y: b - (b - a) * ((f - 0.75) / 0.25) };
  };
  const xs = [], ys = [];
  for (let i = 0; i <= 100; i++) { const p = puntoBordo(i / 100); xs.push(p.x); ys.push(p.y); }
  ok(Math.min(...xs) < 0.1 && Math.max(...xs) > 0.9,
     '8. il punto raggiunge entrambi i lati dello schermo');
  ok(Math.min(...ys) < 0.1 && Math.max(...ys) > 0.9,
     '9. e sia il bordo superiore sia quello inferiore');
  ok(xs.every(v => v >= 0 && v <= 1) && ys.every(v => v >= 0 && v <= 1),
     '10. senza mai uscire dallo schermo');
  const chiuso = puntoBordo(0), fine = puntoBordo(0.999);
  ok(Math.hypot(chiuso.x - fine.x, chiuso.y - fine.y) < 0.1,
     '11. e il giro si chiude, così i giri successivi continuano senza salti');
}

/* ══════ La barra della tastiera a puntamento ══════
 *
 * ⚠️ Mancava RILEGGI, e la differenza non è di comodo: rileggere NON
 * cancella, pronunciare sì. Chi voleva risentire il proprio testo
 * doveva pronunciarlo — perdendolo. Per chi impiega minuti a comporre
 * una frase con lo sguardo non è un dettaglio.
 *
 * La scheda Parla distingueva già le due cose; qui no.              */
{
  const fsB = await import('node:fs');
  const pathB = await import('node:path');
  const quiB = pathB.dirname(import.meta.filename || process.argv[1]);
  const html = fsB.readFileSync(pathB.join(quiB, '..', 'index.html'), 'utf8');
  const main = fsB.readFileSync(pathB.join(quiB, '..', 'js/main.js'), 'utf8');
  const pv = fsB.readFileSync(pathB.join(quiB, '..', 'js/ui/PointerView.js'), 'utf8');

  for (const [id, nome] of [['ptSpeak', 'pronuncia'], ['ptReread', 'rileggi'],
                            ['ptAsk', 'chiedi'], ['ptUndo', 'annulla'],
                            ['ptSaveDraft', 'salva'], ['ptClear', 'svuota']]) {
    ok(html.includes(`id="${id}"`), `12. la barra ha il pulsante "${nome}"`);
    ok(new RegExp(`ptBtn\\('${id}'`).test(main), `13. e "${nome}" è collegato`);
  }

  /* ⚠️ Rileggere deve CONSERVARE il testo. È l'unica ragione per cui
   * esiste come pulsante separato. */
  const iR = main.indexOf("ptBtn('ptReread'");
  const corpoR = main.slice(iR, iR + 500);
  ok(/keep: true/.test(corpoR),
     '14. rileggere conserva il testo invece di cancellarlo');

  /* ⚠️ CHIEDI compare solo se l'assistente è acceso: su una barra
   * puntata con lo sguardo, ogni bersaglio inutile è un bersaglio che
   * si può colpire per sbaglio. */
  ok(/id="ptAsk"[^>]*hidden/.test(html),
     '15. il pulsante chiedi parte nascosto');
  ok(/hidden = !this\.app\.cfg\.assistente/.test(pv),
     '16. e compare solo se l assistente è acceso in impostazioni');

  /* ⚠️ E non deve essere una COPIA della logica della scansione: due
   * strade che fanno la stessa cosa col tempo divergono. */
  ok(/this\.chiediAssistente\(testo\)/.test(main),
     '17. chiedi usa la stessa funzione della scansione, non una copia');
  ok(/this\.onOutput\('speech', testo, \{ keep: true \}\)/.test(main),
     '18. e rileggi usa la stessa uscita audio');
}

/* ══════ Frasi pronte nella scheda Punta ══════
 *
 * ⚠️ Sono le voci più usate da chi comunica: evitano di comporre
 * lettera per lettera proprio quando serve fare in fretta — «ho sete»,
 * «mi fa male», «chiama qualcuno». In Parla c'erano, in Punta no.
 *
 * ⚠️ E devono essere LE STESSE: due elenchi separati col tempo
 * divergono, e chi assiste si troverebbe a doverli aggiornare due
 * volte senza sapere perché.                                        */
{
  const fsF = await import('node:fs');
  const pathF = await import('node:path');
  const quiF = pathF.dirname(import.meta.filename || process.argv[1]);
  const html = fsF.readFileSync(pathF.join(quiF, '..', 'index.html'), 'utf8');
  const pv = fsF.readFileSync(pathF.join(quiF, '..', 'js/ui/PointerView.js'), 'utf8');
  const { MODES } = await import('../js/ui/PointerView.js');
  const { DEFAULT_CONFIG: DF } = await import('../js/core/config.js');

  ok(MODES.includes('frasi'), '19. "frasi" è fra le modalità della scheda Punta');
  ok(/id="ptMode-frasi"/.test(html), '20. la scheda compare nella barra in alto');
  ok(/id="ptView-frasi"/.test(html) && /id="ptFrasi"/.test(html),
     '21. e ha la propria vista nella pagina');
  ok(/mode === 'frasi'\) this\.renderFrasi\(\)/.test(pv),
     '22. che viene costruita entrando nella scheda');

  /* ⚠️ Le frasi vengono dalla STESSA configurazione della scansione. */
  ok(/this\.app\.cfg\.scan\.phraseGroups/.test(pv),
     '23. le frasi sono le stesse della scansione, non un elenco a parte');
  const gruppi = DF.scan.phraseGroups || [];
  ok(gruppi.length >= 3, `24. ci sono ${gruppi.length} gruppi di frasi`);
  const totale = gruppi.reduce((n, g) => n + (g.phrases?.length || 0), 0);
  ok(totale >= 10, `25. per un totale di ${totale} frasi pronte`);

  /* ⚠️ Tutte VISIBILI insieme, non nascoste dentro gruppi da aprire.
   *
   * Con il puntatore a bande raggiungere un riquadro costa due gesti
   * qualunque sia la sua posizione: nascondere le frasi dietro un
   * gruppo aggiungerebbe due gesti per ognuna senza far guadagnare
   * nulla. Le intestazioni servono a trovarle con l'occhio. */
  const iF = pv.indexOf('renderFrasi()');
  const corpo = pv.slice(iF, iF + 1800);
  ok(/pt-tilehead/.test(corpo), '26. i gruppi sono intestazioni, non contenitori da aprire');
  ok(!/onclick[^\n]*setGruppo|apriGruppo/.test(corpo),
     '27. nessun gruppo da aprire: le frasi sono tutte raggiungibili subito');

  /* ⚠️ Pronunciare una frase pronta NON deve cancellare ciò che la
   * persona stava scrivendo: perdere minuti di composizione per aver
   * detto "ho sete" sarebbe inaccettabile. */
  ok(/keep: true/.test(corpo),
     '28. pronunciare una frase pronta non tocca il testo in composizione');
}

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail?1:0);
