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
/* ⚠️ NON esce da sola dopo le passate a vuoto: RICOMINCIA.
 *
 * Prima si spegneva. Ma chi ha UN SOLO GESTO non può riaccenderla: il
 * pulsante che riavvia le bande può premerlo soltanto chi assiste, e
 * se non c'è nessuno la persona resta senza alcun modo di comandare.
 *
 * Le bande sono il suo cursore, come la voce guida è la sua tastiera —
 * e la voce guida non si spegne da sola dopo qualche giro.
 *
 * Fermarsi resta possibile, ma solo se qualcuno lo CHIEDE. */
const s3=new StripeCursor(cfg,()=>{}); s3.setViewport(1000,800);
let t3=0; s3.start(t3);
for(let i=0;i<2000;i++){ t3+=20; s3.tick(t3); }
ok(s3.active,
   'dopo le passate a vuoto RICOMINCIA invece di spegnersi: chi ha un solo gesto non potrebbe riaccenderla');
ok((s3.counters.ricomincia || 0) > 0,
   `e riparte dall inizio, a schermo intero (${s3.counters.ricomincia || 0} volte)`);

// ⚠️ Ma resta possibile spegnerla, per chi lo preferisce.
{
  const cSpenta = deepClone(DEFAULT_CONFIG);
  cSpenta.pointer.stripeContinua = false;
  const sc = new StripeCursor(cSpenta, () => {});
  let tt = 0; sc.start(tt);
  for (let i = 0; i < 40; i++) { tt += cSpenta.pointer.stripeSpeedMs; sc.tick(tt); }
  ok(!sc.active, 'spegnendo l opzione si torna al comportamento di prima');
}

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
  /* ⚠️ Bersagli FERMI anche lungo il bordo.
   *
   * Il punto che percorreva il perimetro sembrava l'idea giusta per
   * misurare l'escursione massima, ma l'occhio lo insegue con un
   * ritardo che si può solo STIMARE, e sulle curve la stima sbaglia di
   * più. Con i campioni del bordo più numerosi di quelli precisi,
   * quell'errore comandava la calibrazione: il puntatore restava al
   * centro invece di raggiungere i margini.
   *
   * Un bersaglio fermo non ha il problema: l'occhio arriva, si ferma,
   * e la corrispondenza fra dove guarda e dove si trova il punto è
   * esatta. */
  const { bordoTargets: bt, calibrationTargets: ct } = await import('../js/pointer/calibration.js');
  ok(P.calibrationBordoPunti >= 4,
     `3. ci sono bersagli FERMI lungo il bordo (${P.calibrationBordoPunti})`);
  ok(P.calibrationBordoGiri === 0,
     '4. e il punto in movimento è spento: si è dimostrato meno preciso');

  const tutti = [...ct(P.calibrationPoints), ...bt(P.calibrationBordoPunti)];
  const daBersagli = tutti.length * P.calibrationGiri;
  ok(daBersagli >= 15,
     `5. in tutto ci sono ${daBersagli} bersagli, tutti a occhio fermo (erano ${P.calibrationPoints})`);

  /* ⚠️ E devono coprire gli ESTREMI: i bersagli interni campionano
   * solo il centro, ed è la ragione per cui il puntatore non
   * raggiungeva i margini. */
  const xs2 = tutti.map(p => p.x), ys2 = tutti.map(p => p.y);
  ok(Math.min(...xs2) <= 0.06 && Math.max(...xs2) >= 0.94,
     `5b. e coprono lo schermo in orizzontale (${Math.min(...xs2).toFixed(2)} → ${Math.max(...xs2).toFixed(2)})`);
  ok(Math.min(...ys2) <= 0.06 && Math.max(...ys2) >= 0.94,
     `5c. e in verticale (${Math.min(...ys2).toFixed(2)} → ${Math.max(...ys2).toFixed(2)})`);

  /* ⚠️ Ma non deve durare troppo: chi calibra con un solo gesto si
   * stanca, e una calibrazione stancante viene fatta male. */
  const durataSec = daBersagli * (P.calibrationDwellMs + P.calibrationSettleMs) / 1000;
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

/* ══════ Mandare una mail dalla tastiera a puntamento ══════
 *
 * In Parla si poteva mandare un testo salvato per posta; in Punta no.
 * Ma chi usa il puntatore compone più in fretta, ed è proprio chi
 * scriverebbe volentieri a qualcuno.                                 */
{
  const fsM = await import('node:fs');
  const pathM = await import('node:path');
  const quiM = pathM.dirname(import.meta.filename || process.argv[1]);
  const html = fsM.readFileSync(pathM.join(quiM, '..', 'index.html'), 'utf8');
  const main = fsM.readFileSync(pathM.join(quiM, '..', 'js/main.js'), 'utf8');
  const pv = fsM.readFileSync(pathM.join(quiM, '..', 'js/ui/PointerView.js'), 'utf8');

  ok(/id="ptMail"/.test(html), '29. la barra ha il pulsante per mandare');
  ok(/ptBtn\('ptMail'/.test(main), '30. ed è collegato');
  ok(/id="ptDest"/.test(html), '31. c è il riquadro per scegliere il destinatario');

  /* ⚠️ Il pulsante compare solo se la posta è attiva E c'è almeno un
   * destinatario: un pulsante che apre una lista vuota delude. */
  ok(/id="ptMail"[^>]*hidden/.test(html), '32. parte nascosto');
  ok(/E\?\.enabled && \(E\.contatti \|\| \[\]\)\.some/.test(pv),
     '33. e compare solo con posta attiva E almeno un destinatario');

  const iM = main.indexOf("scegliDestinatarioPuntatore(via = 'email')");
  const corpo = main.slice(iM, iM + 3200);

  /* ⚠️ La lista compare SOLO al momento: una lista di indirizzi sempre
   * a schermo è una lista di bersagli che si possono colpire per
   * sbaglio, e una mail parte e non torna indietro. */
  ok(/box\.hidden = false/.test(corpo), '34. la lista si apre solo premendo Manda');
  ok(/box\.hidden = true/.test(corpo), '35. e si chiude subito dopo la scelta');
  ok(/Annulla/.test(corpo),
     '36. con un modo per tirarsi indietro senza mandare nulla');

  /* ⚠️ Il testo NON va svuotato: se l'invio fallisce, chi ha impiegato
   * minuti a scriverlo non deve ricominciare. */
  ok(!/clearBuffer|svuota/i.test(corpo),
     '37. mandare non svuota il testo: se l invio fallisce non si ricomincia');
  ok(/this\.mandaEmail\(c, testo/.test(corpo),
     '38. e si usa la stessa funzione di invio della scansione, non una copia');

  /* ══════ Telegram, con la stessa forma della posta ══════
   *
   * ⚠️ WhatsApp non permette di inviare da una pagina web se non
   * attraverso un'interfaccia commerciale a pagamento. Telegram sì,
   * gratuitamente. */
  ok(/id="ptTg"/.test(html), '39. la barra ha anche il pulsante Telegram');
  ok(/ptBtn\('ptTg'/.test(main), '40. ed è collegato');
  ok(/id="ptTg"[^>]*hidden/.test(html), '41. parte nascosto');
  ok(/T\?\.enabled && \(T\.contatti \|\| \[\]\)\.some/.test(pv),
     '42. e compare solo con Telegram attivo E almeno un destinatario');

  /* ⚠️ Una funzione SOLA per entrambi: posta e Telegram condividono
   * tutto tranne il campo del destinatario, e due strade separate col
   * tempo divergono. */
  ok(/const perPosta = via === 'email'/.test(corpo),
     '43. posta e Telegram usano la stessa funzione, non due copie');
  ok(/this\.mandaTelegram\(c, testo/.test(corpo),
     '44. e Telegram usa la stessa funzione di invio della scansione');
}

/* ══════ Le bande sono il cursore di chi ha un solo gesto ══════
 *
 * ⚠️ Devono comportarsi come la voce guida della scansione: continuano
 * finché qualcuno non le ferma, e si riprendono con un gesto. Mai
 * spegnersi da sole, perché nessuno potrebbe riaccenderle.           */
{
  const fsS = await import('node:fs');
  const pathS = await import('node:path');
  const quiS = pathS.dirname(import.meta.filename || process.argv[1]);
  const main = fsS.readFileSync(pathS.join(quiS, '..', 'js/main.js'), 'utf8');
  const { DEFAULT_CONFIG: DS } = await import('../js/core/config.js');

  ok(DS.pointer.stripeContinua === true,
     '45. di default le bande continuano invece di spegnersi');
  ok(/e\.action === 'PAUSE' \|\| e\.action === 'WAKE'/.test(main),
     '46. il gesto di pausa le ferma e quello di ripresa le riaccende');

  /* ⚠️ Si fermano solo per ciò che si GUARDA. Musica e audiolibri no:
   * lì lo schermo non serve, e togliere il cursore vorrebbe dire
   * togliere il comando senza alcun guadagno. */
  ok(/'youtube', 'video', 'image', 'text', 'pdf'/.test(main),
     '47. si fermano per video, immagini e testi');
  ok(!/'audio'/.test(main.slice(main.indexOf('const daGuardare'), main.indexOf('const daGuardare') + 200)),
     '48. ma NON per musica e audiolibri, dove lo schermo non serve');
  ok(/_bandeSospeseDaMedia = false/.test(main),
     '49. e riprendono da sole a contenuto chiuso');

  /* ⚠️ Distinguere la sospensione VOLUTA da quella per i media: se la
   * persona le aveva fermate da sé, chiudendo un video non devono
   * ripartire contro la sua volontà. */
  ok(/!this\._bandeSospese/.test(main),
     '50. una pausa voluta resta tale anche dopo un video');
}

/* ══════ Due difetti della calibrazione, misurati ══════
 *
 * Sul campo il puntatore non arrivava ai lati e vibrava. Due cause
 * distinte, entrambe nella fase del bordo.                          */
{
  const { DEFAULT_CONFIG: DC2 } = await import('../js/core/config.js');
  const P2 = DC2.pointer;

  /* ⚠️ 1. VELOCITÀ NON COSTANTE.
   *
   * Ogni lato riceveva un quarto del tempo, ma su uno schermo
   * panoramico gli orizzontali misurano quasi il doppio: il punto li
   * percorreva al doppio della velocità. I campioni si addensavano sui
   * lati corti, sbilanciando la stima verso il verticale. */
  const punto = (f, W, H) => {
    f = ((f % 1) + 1) % 1;
    const m = 0.06, a = m, b = 1 - m;
    const lo = (b - a) * W, lv = (b - a) * H, per = 2 * (lo + lv);
    let d = f * per;
    if (d < lo) return { x: a + (b - a) * (d / lo), y: a };
    d -= lo;
    if (d < lv) return { x: b, y: a + (b - a) * (d / lv) };
    d -= lv;
    if (d < lo) return { x: b - (b - a) * (d / lo), y: b };
    d -= lo;
    return { x: a, y: b - (b - a) * (d / lv) };
  };
  for (const [W, H] of [[1920, 1080], [1280, 800], [1024, 768]]) {
    let prec = punto(0, W, H); const passi = [];
    for (let i = 1; i <= 800; i++) {
      const p = punto(i / 800, W, H);
      passi.push(Math.hypot((p.x - prec.x) * W, (p.y - prec.y) * H));
      prec = p;
    }
    /* ⚠️ Si scartano i passi agli ANGOLI: lì il punto cambia
     * direzione fra un campione e il successivo, e la distanza in
     * linea retta è più corta del tragitto percorso. È un artefatto
     * della misura, non una variazione di velocità. */
    passi.sort((a, b) => a - b);
    const senzaAngoli = passi.slice(2, -2);
    const r = Math.max(...senzaAngoli) / Math.max(1e-9, Math.min(...senzaAngoli));
    ok(r < 1.3,
       `51. su ${W}x${H} il punto mantiene velocità costante (${r.toFixed(2)}× fra il passo minimo e il massimo)`);
  }

  /* ⚠️ 2. IL RITARDO DELLO SGUARDO. */
  ok(P2.calibrationRitardoMs >= 100,
     `52. si tiene conto del ritardo con cui l occhio insegue (${P2.calibrationRitardoMs} ms)`);

  const fsC = await import('node:fs');
  const pathC = await import('node:path');
  const quiC = pathC.dirname(import.meta.filename || process.argv[1]);
  const main = fsC.readFileSync(pathC.join(quiC, '..', 'js/main.js'), 'utf8');
  ok(/_puntoBordo\(\(trascorso - ritardo\) \/ durata\)/.test(main),
     '53. accoppiando lo sguardo con dov ERA il punto, non con dov è adesso');
  ok(/const avviato = trascorso >/.test(main),
     '54. e scartando i primi istanti, quando l occhio sta ancora cercando il punto');

  /* ⚠️ 3. LO SBILANCIAMENTO.
   *
   * Sui bersagli l'occhio è fermo: corrispondenza esatta. Sul bordo
   * insegue: approssimata. Ma i campioni del bordo erano quattro volte
   * tanti e pesavano l'ottanta per cento della stima. */
  const daBordo = Math.round(P2.calibrationBordoGiri * P2.calibrationBordoMs / P2.calibrationBordoOgniMs);
  const daBersagli = P2.calibrationPoints * P2.calibrationGiri * P2.calibrationPesoBersagli;
  const quotaBersagli = daBersagli / (daBordo + daBersagli);
  ok(quotaBersagli >= 0.4,
     `55. i bersagli fissi pesano il ${(quotaBersagli * 100).toFixed(0)}% della calibrazione (erano il 20%)`);
  ok(/for \(let k = 0; k < pesoB; k\+\+\)/.test(main),
     '56. il peso si ottiene ripetendo il campione: i minimi quadrati non sanno da soli quali valgono di più');
}

/* ══════ Velocità separata per la passata fine ══════
 *
 * ⚠️ Chi seleziona ALZANDO L'OCCHIO ha bisogno di tempo per reagire
 * dopo aver visto dove la banda sta arrivando. Sulla passata fine —
 * dove si decide il punto esatto — quel tempo conta di più. Poterla
 * rallentare separatamente evita di pagare la precisione con la
 * lentezza dappertutto.                                             */
{
  const { StripeCursor: SC } = await import('../js/pointer/StripeCursor.js');
  const { DEFAULT_CONFIG: DV, deepClone: dv } = await import('../js/core/config.js');

  ok(DV.pointer.stripeSpeedFineMs === 0,
     '57. di default la passata fine usa la stessa velocità della prima');

  const c = dv(DV);
  c.pointer.stripeSpeedMs = 2000;
  c.pointer.stripeSpeedFineMs = 5000;
  const sc = new SC(c, () => {});
  sc.start(0);
  ok(sc.pass === 0, '58. si parte dalla prima passata');
  sc.select(500);
  ok(sc.pass === 1, '59. e un gesto porta alla seconda');

  const fsV = await import('node:fs');
  const pathV = await import('node:path');
  const quiV = pathV.dirname(import.meta.filename || process.argv[1]);
  const src = fsV.readFileSync(pathV.join(quiV, '..', 'js/pointer/StripeCursor.js'), 'utf8');
  ok(/this\.pass > 0 && \(this\.cfg\.pointer\.stripeSpeedFineMs \|\| 0\) > 0/.test(src),
     '60. la seconda passata usa la propria velocità solo se impostata');

  const sv = fsV.readFileSync(pathV.join(quiV, '..', 'js/ui/SettingsView.js'), 'utf8');
  ok(sv.includes("'pointer.stripeSpeedFineMs'"),
     '61. ed è regolabile in impostazioni, accanto a quella della prima');
}

/* ══════ Tre correzioni chieste dopo le prove sul campo ══════ */
{
  const fsX = await import('node:fs');
  const pathX = await import('node:path');
  const quiX = pathX.dirname(import.meta.filename || process.argv[1]);
  const main = fsX.readFileSync(pathX.join(quiX, '..', 'js/main.js'), 'utf8');
  const html = fsX.readFileSync(pathX.join(quiX, '..', 'index.html'), 'utf8');
  const ov = fsX.readFileSync(pathX.join(quiX, '..', 'js/pointer/PointerOverlay.js'), 'utf8');

  /* ⚠️ 1. La sospensione fuori da Parla deve RESISTERE ai gesti.
   *
   * Metterla in pausa non bastava: qualunque gesto la risveglia — è il
   * comportamento giusto quando la pausa l'ha chiesta la persona, ed è
   * quello sbagliato quando è il programma ad aver sospeso. Bastava un
   * gesto in diagnostica e la voce guida ripartiva. */
  ok(/this\._pausaAutomatica && document\.body\.dataset\.tab !== 'parla'\) return;/.test(main),
     '62. fuori da Parla i gesti non risvegliano la scansione sospesa');

  /* ⚠️ 2. Si deve poter USCIRE dalla calibrazione.
   *
   * Mancava del tutto: chi la avviava per sbaglio doveva arrivare in
   * fondo a tutti i bersagli prima di poter fare altro. */
  ok(/annullaCalibrazione\(motivo = ''\)/.test(main),
     '63. esiste un modo di annullare la calibrazione');
  ok(/if \(this\.calibSession\) this\.annullaCalibrazione\(\)/.test(main),
     '64. il tasto Esc la annulla invece di mettere in pausa');
  ok(/id="btnCalibStop"/.test(html),
     '65. e c è un pulsante, per chi assiste senza tastiera');
  ok(/id="btnCalibStop"[^>]*hidden/.test(html),
     '66. che compare solo durante la calibrazione');
  ok(/Esc per annullare/.test(ov),
     '67. e la schermata dice come uscire');
  ok(/globalAlpha = 0\.45/.test(ov),
     '68. scritto in modo discreto: un testo troppo visibile sarebbe esso stesso un bersaglio');
  ok(/this\.calibration\.reset\(\)/.test(main.slice(main.indexOf('annullaCalibrazione(motivo'), main.indexOf('annullaCalibrazione(motivo') + 700)),
     '69. annullando, i campioni parziali vengono buttati');
  /* ⚠️ E il pulsante deve sparire in ENTRAMBI i modi di finire:
   * annullando e arrivando in fondo. Un pulsante di annullamento che
   * resta a schermo dopo la fine è un bersaglio che non fa nulla. */
  ok((main.match(/_mostraAnnullaCalib\(false\)/g) || []).length >= 2,
     '69b. il pulsante sparisce sia annullando sia finendo');

  /* ⚠️ 3. Finita la calibrazione si torna al MIRINO, non alle bande.
   *
   * Le bande erano rimaste la modalità di una sessione precedente e
   * ripartivano da sole. Ma una calibrazione appena fatta serve
   * proprio al puntatore continuo: è quello il suo risultato. */
  const iF = main.indexOf('this.audio.speakProtected(t(\'cal.done\')');
  const corpoF = main.slice(iF, iF + 900);
  ok(/this\.set\('pointer\.mode', 'gaze'\)/.test(corpoF),
     '70. finita la calibrazione si torna al puntatore a mirino');
  ok(/this\.stripe\.cancel\(\)/.test(corpoF),
     '71. e le bande non ripartono da sole: restano al loro pulsante');
}

/* ══════ I gesti devono arrivare alle bande ══════
 *
 * ⚠️ Nella scheda Punta nessun gesto funzionava: né selezionare per
 * fermare la banda, né mettere in pausa, né riprendere.
 *
 * Due cause diverse con lo stesso sintomo — ed è il motivo per cui
 * correggerne una sola avrebbe risolto metà problema.               */
{
  const fsG = await import('node:fs');
  const pathG = await import('node:path');
  const quiG = pathG.dirname(import.meta.filename || process.argv[1]);
  const main = fsG.readFileSync(pathG.join(quiG, '..', 'js/main.js'), 'utf8');

  /* ⚠️ CAUSA 1: due pause diverse che usavano la stessa variabile.
   *
   * «La persona vuole riposare» e «la voce guida qui non serve»
   * condividevano `scan.paused`. Entrando in Punta la scansione veniva
   * sospesa — giusto — e con essa il MOTORE DEI GESTI, che smette di
   * emettere tutto tranne i comandi di risveglio. La selezione moriva
   * alla sorgente, molto prima di arrivare alle bande.
   *
   * I gesti sono l'unico canale d'ingresso della persona, in OGNI
   * scheda: solo una pausa CHIESTA da lei deve fermarli. */
  ok(/_pausaVoluta\(\) \{[\s\S]{0,2600}!this\._pausaAutomatica/.test(main),
     '72. la pausa voluta è distinta dalla sospensione automatica');

  /* ⚠️ E una pausa vale per la SCHEDA in cui è stata chiesta.
   *
   * Mettendo in pausa la scansione e passando poi a Punta, quella
   * pausa continuava a fermare il motore dei gesti — dove però non
   * significa più nulla: lì non c'è voce guida da zittire, e a
   * comandare sono le bande. L'assistente accendeva le bande e la
   * persona non poteva farci niente, per una decisione presa in
   * un'altra scheda e per un'altra cosa. */
  ok(/if \(this\._bandeInComando\(\)\) return false;/.test(main),
     '72b. dove comandano le bande, la pausa della scansione non le spegne');

  /* ⚠️ E soprattutto: nella scheda Punta la pausa non vale MAI.
   *
   * Guardare se le bande fossero in comando non bastava, perché quello
   * stato vive nella configurazione — e caricando un profilo salvato
   * la configurazione viene sostituita per intero: il puntatore
   * risultava spento, la pausa tornava a valere, e i gesti si
   * spegnevano di nuovo. Bastava passare dalle impostazioni e tornare
   * indietro perché la persona perdesse il controllo.
   *
   * La scheda in cui ci si trova non dipende da nessun profilo. */
  ok(/dataset\.tab === 'punta'\) return false;/.test(main),
     '72b2. in Punta la pausa della scansione non ferma i gesti, qualunque profilo sia caricato');
  const volutaT = (paused, auto, tab) => (tab === 'punta' ? false : (!!paused && !auto));
  ok(volutaT(true, false, 'punta') === false,
     '72b3. una pausa chiesta prima non sopravvive al cambio di scheda');
  ok(volutaT(true, false, 'parla') === true,
     '72b4. ma in Parla continua a valere, come deve');
  ok(/const bandeInUso = this\._bandeInComando\(\);/.test(main),
     '72c. e lo smistamento usa lo STESSO criterio: due condizioni separate col tempo divergono');

  // La logica completa, sui casi che contano davvero.
  const bandeCmd = (en, mode, tab, act) => !!(en && mode === 'scanStripe' && (tab === 'punta' || act));
  const voluta = (paused, auto, b) => (b ? false : (!!paused && !auto));
  ok(voluta(true, false, bandeCmd(true, 'scanStripe', 'punta', true)) === false,
     '72d. una pausa chiesta in Parla non blocca i gesti in Punta');
  ok(voluta(true, false, bandeCmd(true, 'gaze', 'parla', false)) === true,
     '72e. ma in Parla continua a fermarli, come deve');
  ok(!/setPaused\(this\.scan\.paused\)/.test(main),
     '73. il motore dei gesti non segue più la sospensione automatica');
  ok((main.match(/setPaused\(this\._pausaVoluta\(\)\)/g) || []).length >= 2,
     '74. e la distinzione è applicata in tutti i punti che lo mettono in pausa');

  // La logica, verificata sui quattro stati possibili.
  const pausaVoluta = (paused, auto) => !!paused && !auto;
  ok(pausaVoluta(true, false) === true,
     '75. una pausa chiesta dalla persona ferma i gesti, come prima');
  ok(pausaVoluta(true, true) === false,
     '76. una sospensione automatica NON li ferma: servono nelle altre schede');
  ok(pausaVoluta(false, false) === false, '77. a scansione attiva i gesti passano');

  /* ⚠️ CAUSA 2: il blocco delle bande riconosceva due nomi su tre.
   *
   * Mancava `TOGGLE_PAUSE`, che è proprio quello impostato dalle
   * impostazioni: il gesto cadeva fuori, finiva alla scansione e
   * metteva in pausa quella — che in questa scheda non sta girando. */
  const iB = main.indexOf('if (bandeInUso) {');
  const blocco = main.slice(iB, iB + 1600);
  for (const nome of ['TOGGLE_PAUSE', 'PAUSE', 'WAKE']) {
    ok(blocco.includes(`'${nome}'`),
       `78. le bande riconoscono l azione "${nome}"`);
  }
  ok(/e\.action === 'SELECT'/.test(blocco), '79. e la selezione');
  ok(/e\.action === 'UNDO'/.test(blocco), '80. e l annullamento');

  /* ⚠️ E lo smistamento alle bande deve restare PRIMA della guardia
   * sulla sospensione: altrimenti quella le intercetterebbe tutte. */
  const iGuardia = main.indexOf("this._pausaAutomatica && document.body.dataset.tab !== 'parla'");
  ok(iB > 0 && iGuardia > iB,
     '81. le bande ricevono il gesto prima che la guardia sulla scansione intervenga');
}

/* ══════ Le bande si fermano a OGNI avvio, non solo al primo ══════
 *
 * ⚠️ Stesso difetto già corretto per la voce guida: fermando e
 * riprendendo un video, le bande tornavano a scorrergli sopra. La
 * stessa situazione deve dare lo stesso comportamento.
 *
 * ⚠️ Ma SOLO per ciò che si guarda. Musica e radio no: lì lo schermo
 * non serve, e togliere il cursore vorrebbe dire togliere il comando
 * senza alcun guadagno. E le bande non fanno rumore, quindi non c è
 * nulla da abbassare come invece serve per la voce guida.           */
{
  const fsB2 = await import('node:fs');
  const pathB2 = await import('node:path');
  const quiB2 = pathB2.dirname(import.meta.filename || process.argv[1]);
  const main = fsB2.readFileSync(pathB2.join(quiB2, '..', 'js/main.js'), 'utf8');

  ok(/_sospendiBandePer\(kind\) \{/.test(main),
     '82. c è un unico punto che decide se fermare le bande');
  ok((main.match(/_sospendiBandePer\(/g) || []).length >= 3,
     '83. usato sia all apertura sia alla ripresa del contenuto');

  const iS3 = main.indexOf('_sospendiBandePer(kind) {');
  const corpo = main.slice(iS3, iS3 + 700);
  ok(/'youtube', 'video', 'image', 'text', 'pdf'/.test(corpo),
     '84. si fermano per video, immagini, testi e PDF');
  ok(!/'audio'/.test(corpo) && !/'radio'/.test(corpo),
     '85. ma NON per musica e radio: lì lo schermo non serve');

  /* ⚠️ E le bande non vanno abbassate di volume: non fanno rumore.
   * Portare a Punta la riduzione pensata per la voce guida sarebbe
   * stato aggiungere un comportamento inutile. */
  ok(!/riduciVolume/.test(corpo),
     '86. e non si tocca alcun volume: le bande sono silenziose');
}

/* ══════ La scheda Media si mostra quando il contenuto c'è ══════
 *
 * ⚠️ Il passaggio avveniva all aggancio del riquadro, cioè un istante
 * PRIMA che il riproduttore esistesse: la scheda cambiava ma restava
 * vuota, e per vedere il video bisognava uscire dalla sezione e
 * rientrare.
 *
 * Ripetendolo ad apertura avvenuta, il contenuto è già lì. */
{
  const fsM2 = await import('node:fs');
  const pathM2 = await import('node:path');
  const quiM2 = pathM2.dirname(import.meta.filename || process.argv[1]);
  const main = fsM2.readFileSync(pathM2.join(quiM2, '..', 'js/main.js'), 'utf8');

  const iOp = main.indexOf("La scheda si mostra QUANDO il contenuto c'è");
  const corpo = main.slice(iOp, iOp + 900);
  ok(/pointerView\.setMode\('media'\)/.test(corpo),
     '87. a contenuto aperto si passa alla scheda che lo mostra');
  ok(/dataset\.tab === 'punta'/.test(corpo),
     '88. solo in Punta: in Parla il riquadro è già nella pagina');
  ok(/mode !== 'media'/.test(corpo),
     '89. e solo se non ci si è già: cambiare scheda a vuoto sposterebbe chi sta scrivendo');
}

/* ══════ Punta deve poter fare le stesse cose di Parla ══════ */
{
  const fsP3 = await import('node:fs');
  const pathP3 = await import('node:path');
  const quiP3 = pathP3.dirname(import.meta.filename || process.argv[1]);
  const pv = fsP3.readFileSync(pathP3.join(quiP3, '..', 'js/ui/PointerView.js'), 'utf8');
  const main = fsP3.readFileSync(pathP3.join(quiP3, '..', 'js/main.js'), 'utf8');

  /* ⚠️ La radio mancava del tutto: era raggiungibile solo dalla
   * scansione, e chi usa il puntatore vedeva le stazioni configurate
   * senza poterle ascoltare. */
  for (const g of ['video', 'audio', 'doc', 'img', 'radio']) {
    ok(new RegExp(`id: '${g}'`).test(pv), `90. la scheda Media di Punta ha il gruppo "${g}"`);
  }
  ok(/g\.id === 'radio'/.test(pv),
     '91. e la radio si apre dal suo percorso, non da quello della libreria');

  /* ⚠️ La barra dei comandi deve usare gli STESSI comandi della
   * scansione.
   *
   * Usava quelli grezzi del riproduttore, che non conoscono i
   * risultati di una ricerca: in Punta mancava "altro video" e chi
   * cercava ne vedeva uno solo, mentre in Parla funzionava. Due strade
   * per la stessa cosa divergono sempre. */
  ok(/for \(const c of \(this\._comandiCorrenti\(\) \|\| \[\]\)\)/.test(main),
     '92. la barra usa gli stessi comandi della scansione, non due liste diverse');

  /* ⚠️ E i risultati di una ricerca non sopravvivono a un contenuto
   * scelto a mano: "altro video" non deve portare ai risultati di una
   * ricerca fatta mezz ora prima. */
  ok(/_scordaRicercaVideo\(\) \{/.test(main),
     '93. i risultati di una ricerca si dimenticano');
  ok((main.match(/_scordaRicercaVideo\(\)/g) || []).length >= 3,
     '94. aprendo qualunque contenuto scelto a mano');
  ok(!/localStorage[^\n]*candidatiVideo/.test(main),
     '95. e vivono solo nella sessione: nulla viene salvato su disco');
}

/* ══════ Ogni riquadro deve avere un nome leggibile ══════
 *
 * ⚠️ I pulsanti della radio mostravano tutti "undefined": le stazioni
 * hanno `nome`, i file hanno `title`, e si cercava solo il secondo.
 * Un elenco di bersagli indistinguibili è un elenco in cui scegliere
 * è impossibile — e per chi punta con lo sguardo, impossibile davvero.
 */
{
  const fsN = await import('node:fs');
  const pathN = await import('node:path');
  const quiN = pathN.dirname(import.meta.filename || process.argv[1]);
  const pv = fsN.readFileSync(pathN.join(quiN, '..', 'js/ui/PointerView.js'), 'utf8');
  const sv = fsN.readFileSync(pathN.join(quiN, '..', 'js/ui/SettingsView.js'), 'utf8');
  const css = fsN.readFileSync(pathN.join(quiN, '..', 'css/app.css'), 'utf8');

  ok(/it\.title \|\| it\.nome/.test(pv),
     '96. i riquadri leggono sia "title" sia "nome": le stazioni non hanno il primo');

  /* ⚠️ E anche i CURSORI devono ridisegnare quando svelano altro.
   *
   * L elenco copriva caselle e menu a tendina ma non i cursori:
   * portando i minuti dello schermo scuro sopra zero, il cursore
   * dell opacità compariva solo uscendo dalle impostazioni e
   * rientrando. È la stessa classe di difetto già incontrata tre
   * volte, in una forma nuova. */
  ok(/INTERRUTTORI_CHE_APRONO\.has\(path\)[\s\S]{0,200}setTimeout/.test(sv),
     '97. anche i cursori ridisegnano quando svelano altri controlli');
  ok(/clearTimeout\(this\._ridisegnaFra\)/.test(sv),
     '98. ma non mentre si trascina: si perderebbe il cursore sotto le dita');

  /* Un riquadro spaiato non deve allargarsi a dismisura: sembrerebbe
   * un elemento diverso, o un errore. */
  ok(/max-width:clamp\(240px,36vw,440px\)/.test(css),
     '99. l ultimo riquadro di una riga spaiata resta della misura degli altri');
  ok(/#ptTiles \.pt-tile\{flex:0 1/.test(css),
     '99b. e non cresce oltre la propria misura: un tetto da solo non bastava');

  /* ⚠️ I comandi dei contenuti passano dallo STESSO smistamento della
   * scansione.
   *
   * I pulsanti chiamavano direttamente il riproduttore dei file: per
   * la radio — che è un flusso gestito a parte — non facevano nulla, e
   * nemmeno per "altro video". In Parla funzionavano perché lì passano
   * dalla scansione, che smista al destinatario giusto. */
  const main2 = fsN.readFileSync(pathN.join(quiN, '..', 'js/main.js'), 'utf8');
  ok(/b\.onclick = \(\) => this\.scan\.h\?\.onMedia\?\.\(c\.id\)|b\.onclick = \(\) => this\.scan\.h\.onMedia\?\.\(c\.id\)/.test(main2),
     '99c. i pulsanti dei comandi usano lo stesso smistamento della scansione');
  ok(!/b\.onclick = \(\) => this\.media\.command\(c\.id\)/.test(main2),
     '99d. e non chiamano più direttamente il riproduttore, che per la radio non fa nulla');

  /* ⚠️ E occupano tutta la larghezza: qui si colpiscono con lo sguardo
   * o con le bande, non con un dito preciso. Un comando mancato su
   * "chiudi" costa un giro intero. */
  ok(/#ptMediaBar \.btn\{[\s\S]{0,120}flex:1 1 0/.test(css),
     '99e. i comandi occupano tutta la larghezza, divisi in parti uguali');

  /* ══════ Le cinque schede: i bersagli più usati della pagina ══════
   *
   * ⚠️ Stavano sulla riga dei comandi dell assistente, ristrette al
   * minimo per starci tutte. Ma sono ciò che la PERSONA usa di
   * continuo — tastiera, frasi, media — mentre quelli li preme chi
   * assiste una volta a sessione: bersagli grandi per chi ha il mouse
   * e piccoli per chi ha lo sguardo, il contrario di come dovrebbe
   * essere. */
  const html2 = fsN.readFileSync(pathN.join(quiN, '..', 'index.html'), 'utf8');
  const iTop = html2.indexOf('class="pt-top"');
  const iModi = html2.indexOf('class="pt-modes"');
  ok(iModi > iTop && iModi > html2.indexOf('id="ptrStatus"'),
     '99f. le schede stanno su una riga PROPRIA, fuori da quella dei comandi');
  ok(/\.pt-mode\{[\s\S]{0,200}flex:1 1 0/.test(css),
     '99g. occupano tutta la larghezza, divise in parti uguali');
  ok(/\.pt-mode\{[\s\S]{0,200}border:1px solid/.test(css),
     '99h. e hanno l aspetto di tasti: un bersaglio che sembra premibile viene mirato meglio');

  /* I tasti in fondo alla tastiera hanno la stessa misura: sono gli
   * stessi bersagli, colpiti nello stesso modo. */
  const m1 = css.match(/\.pt-mode\{[\s\S]{0,300}?padding:(clamp\([^)]+\))/);
  const m2 = css.match(/\.pt-bottom \.btn\{[\s\S]{0,300}?padding:(clamp\([^)]+\))/);
  ok(m1 && m2 && m1[1] === m2[1],
     '99i. e i tasti in fondo alla tastiera hanno la stessa altezza delle schede');
}

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail?1:0);
