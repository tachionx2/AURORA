/**
 * Gesti aggiunti a novembre 2026, tutti SPENTI di default:
 *   · chiusura degli occhi a tre durate (breve, media, lunga);
 *   · "indietro di una voce" nella sequenza;
 *   · modalità normalizzata (il gesto misurato rispetto a se stesso).
 *
 * Usano il motore vero, con segnali simulati: nessuna telecamera.
 */
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };

import { DEFAULT_CONFIG, deepClone, ACTIONS, GESTURE_CHANNELS } from '../js/core/config.js';
import { GestureEngine, CHIUSURE_A_DURATA } from '../js/signal/GestureEngine.js';
import { ScanEngine } from '../js/scan/ScanEngine.js';

/* ══════════ 1. CHIUSURA DEGLI OCCHI A TRE DURATE ══════════ */
{
  const banco = (mod) => {
    const c = deepClone(DEFAULT_CONFIG);
    c.gestures.CLOSE_SHORT.enabled = true;
    c.gestures.CLOSE_MEDIUM.enabled = true;
    c.gestures.CLOSE_LONG.enabled = true;
    if (mod) mod(c);
    const ev = [];
    const g = new GestureEngine(c, e => ev.push(e));
    let t = 0;
    const o = (ap, cf = 0.95) => ({ x: 0, y: 0, openness: ap, confidence: cf });
    const dai = (ms, ap, cf) => { for (let i = 0; i < Math.round(ms / 33); i++) { t += 33; g.process(t, { left: o(ap, cf), right: o(ap, cf) }); } };
    dai(5000, 0.30);       // occhi aperti: il rilevatore si tara
    return { c, g, ev, dai, get t() { return t; } };
  };
  const chiudi = (ms, mod) => { const b = banco(mod); b.dai(ms, 0.02); const durante = b.ev.length; b.dai(2000, 0.30); return { ev: b.ev, durante }; };
  const canali = (r) => r.ev.map(e => e.channel).join(',');

  ok(CHIUSURE_A_DURATA.every(k => DEFAULT_CONFIG.gestures[k] && DEFAULT_CONFIG.gestures[k].enabled === false),
     '1a. le tre chiusure esistono e sono SPENTE di default');
  ok(CHIUSURE_A_DURATA.every(k => GESTURE_CHANNELS[k]), '1b. e compaiono fra i canali assegnabili');
  { const d = DEFAULT_CONFIG.gestures;
    ok(d.CLOSE_SHORT.maxMs <= d.CLOSE_MEDIUM.dwellMs && d.CLOSE_MEDIUM.maxMs <= d.CLOSE_LONG.dwellMs,
       '1c. i tre intervalli predefiniti non si sovrappongono');
    ok(d.CLOSE_SHORT.dwellMs >= 250, '1d. la breve comincia sopra la durata di un ammiccamento spontaneo'); }

  ok(canali(chiudi(150)) === '', `1e. una chiusura di 150 ms non è un comando (${canali(chiudi(150))})`);
  { const r = chiudi(550);
    ok(canali(r) === 'CLOSE_SHORT' && r.ev[0].action === 'PREV', `1f. 550 ms → chiusura BREVE, azione "indietro di una voce" (${canali(r)})`);
    ok(Math.abs(r.ev[0].durMs - 550) < 120, `1g. la durata misurata è quella vera (${Math.round(r.ev[0].durMs)} ms)`);
    ok(r.ev[0].agoMs >= r.ev[0].durMs, `1h. e dice da quanto il gesto è COMINCIATO (${Math.round(r.ev[0].agoMs)} ms fa)`);
    ok(r.durante === 0, '1i. si decide alla RIAPERTURA: a occhi ancora chiusi non esce nulla'); }
  ok(canali(chiudi(1400)) === 'CLOSE_MEDIUM', `1l. 1400 ms → chiusura MEDIA (${canali(chiudi(1400))})`);
  ok(canali(chiudi(3000)) === 'CLOSE_LONG', `1m. 3000 ms → chiusura LUNGA (${canali(chiudi(3000))})`);
  ok(canali(chiudi(9000)) === '', `1n. oltre l ultima finestra: nessun comando (${canali(chiudi(9000))})`);

  // Una sola durata accesa: le altre non scattano.
  ok(canali(chiudi(1400, c => { c.gestures.CLOSE_MEDIUM.enabled = false; })) === '',
     '1o. una durata spenta non scatta, e le altre non ne prendono il posto');
  // Intervalli scelti da chi assiste.
  ok(canali(chiudi(700, c => { c.gestures.CLOSE_SHORT.maxMs = 600; c.gestures.CLOSE_MEDIUM.dwellMs = 600; })) === 'CLOSE_MEDIUM',
     '1p. cambiando gli intervalli cambia quale durata scatta');

  { // "non so" in mezzo alla chiusura (campioni scartati: capita proprio a occhio chiuso)
    const b = banco(); b.dai(300, 0.02); b.dai(250, 0.02, 0.1); b.dai(300, 0.02); b.dai(2000, 0.30);
    ok(b.ev.length === 1 && b.ev[0].channel === 'CLOSE_SHORT' && b.ev[0].durMs > 700,
       `1q. campioni scartati a metà non spezzano il gesto (${b.ev.map(e => e.channel + ':' + Math.round(e.durMs)).join(',')})`); }
  { // tremolio del rilevatore: riaperto per due fotogrammi
    const b = banco(); b.dai(400, 0.02); b.dai(66, 0.30); b.dai(400, 0.02); b.dai(2000, 0.30);
    ok(b.ev.length === 1 && b.ev[0].durMs > 700,
       `1r. una riapertura di due fotogrammi è un tremolio, non la fine del gesto (${b.ev.map(e => e.channel + ':' + Math.round(e.durMs)).join(',')})`); }
  { // con la chiusura lunga di sempre: un gesto, un comando
    const r = chiudi(3000, c => { c.gestures.LONG_CLOSE = { enabled: true, action: 'TOGGLE_PAUSE', dwellMs: 1500, maxMs: 99000 }; });
    ok(canali(r) === 'LONG_CLOSE', `1s. se è già scattata la "chiusura lunga" di sempre, non esce un secondo comando (${canali(r)})`); }
  { // con l'ammiccamento
    const conBlink = (c) => { c.gestures.BLINK.enabled = true; };
    const a = chiudi(550, conBlink), b = chiudi(130, conBlink);
    ok(canali(a) === 'CLOSE_SHORT', `1t. con l ammiccamento acceso, 550 ms dà solo la chiusura breve (${canali(a)})`);
    ok(canali(b) === 'BLINK', `1u. e un ammiccamento vero resta un ammiccamento (${canali(b)})`); }
  { // in pausa passano solo i comandi che risvegliano
    const b = banco(); b.g.setPaused(true); b.dai(550, 0.02); b.dai(1500, 0.30); b.dai(3000, 0.02); b.dai(1500, 0.30);
    ok(canali(b) === 'CLOSE_LONG', `1v. in pausa: "indietro" non esce, "pausa/risveglia" sì (${canali(b)})`); }
  { // un occhio solo, se è quello in gioco
    const b = banco(c => { c.detection.activeEye = 'left'; });
    const o = (ap) => ({ x: 0, y: 0, openness: ap, confidence: 0.95 });
    let t = b.t;
    for (let i = 0; i < 17; i++) { t += 33; b.g.process(t, { left: o(0.02), right: o(0.30) }); }
    for (let i = 0; i < 40; i++) { t += 33; b.g.process(t, { left: o(0.30), right: o(0.30) }); }
    ok(canali(b) === 'CLOSE_SHORT', `1z. vale anche chiudendo un occhio solo, se è quello che comanda (${canali(b)})`); }
}

/* ══════════ 2. INDIETRO DI UNA VOCE ══════════ */
{
  ok(ACTIONS.PREV && ACTIONS.BACK && ACTIONS.PREV !== ACTIONS.BACK, '2a. "indietro di una voce" è un azione a sé, diversa da "esci dal sottomenu"');
  const banco = () => {
    const c = deepClone(DEFAULT_CONFIG);
    c.scan.adaptive = false; c.scan.stepMs = 1000; c.scan.enterDelayMs = 0; c.scan.letterEnterDelayMs = 0;
    const detti = [];
    const e = new ScanEngine(c, { onAnnounce: (n) => detti.push(n.label), onOutput: () => {} });
    let T = 0;
    e.start(T);
    const fino = (lab) => { for (let i = 0; i < 4000 && e.currentNode?.label !== lab; i++) { T += 20; e.tick(T); } return e.currentNode?.label === lab; };
    const avanti = (ms) => { const f = T + ms; while (T < f) { T += 20; e.tick(T); } };
    return { e, c, detti, fino, avanti, get T() { return T; }, qui: () => e.currentNode?.label };
  };
  const radice = () => banco().e.level.node.children.map(x => x.label);
  const R = radice();
  ok(R.length >= 3, `2b. (menu principale: ${R.join(' · ')})`);

  { const b = banco(); b.fino(R[2]);
    b.e.handleAction('PREV', b.T);
    ok(b.qui() === R[1], `2c. comando istantaneo: dalla terza voce alla seconda (${b.qui()})`);
    ok(b.detti[b.detti.length - 1] === R[1], '2d. e la voce viene riannunciata');
    b.avanti(900);
    ok(b.qui() === R[1], '2e. con un passo INTERO per sceglierla: dopo 0,9 s è ancora lì');
    b.avanti(200);
    ok(b.qui() === R[2], '2f. poi la sequenza riprende in avanti come sempre'); }
  { const b = banco();
    b.e.handleAction('PREV', b.T);
    ok(b.qui() === R[R.length - 1], `2g. indietro dalla prima voce: si va all ultima (${b.qui()})`); }
  { const b = banco(); b.fino(R[2]);
    b.e.handleAction('PREV', b.T); b.e.handleAction('PREV', b.T + 10);
    ok(b.qui() === R[0], `2h. ripetuto, torna indietro ancora (${b.qui()})`); }

  /* ⚠️ Il caso che conta: il gesto COMINCIA sulla voce 2 (la persona
   * voleva la 1) e FINISCE quando la sequenza è già sulla 4. */
  { const b = banco(); b.fino(R[1]);
    const inizio = b.T + 400;               // a metà della voce 2
    b.fino(R[3]);                           // intanto la sequenza va avanti
    b.e.handleAction('PREV', b.T, { inizio });
    ok(b.qui() === R[0], `2i. gesto cominciato sulla 2ª voce e finito sulla 4ª: torna alla 1ª, non alla 3ª (${b.qui()})`); }
  { // l'anticipo: un gesto "visto" appena dopo il cambio di voce è cominciato sulla voce prima
    const b = banco(); b.fino(R[2]);
    b.e.handleAction('PREV', b.T + 100, { inizio: b.T + 100 });   // visto 100 ms dopo l'annuncio della 3ª
    ok(b.qui() === R[0], `2l. visto 100 ms dopo l annuncio della 3ª: la persona reagiva alla 2ª, si torna alla 1ª (${b.qui()})`);
    const b2 = banco(); b2.c.scan.indietroAnticipoMs = 0; b2.fino(R[2]);
    b2.e.handleAction('PREV', b2.T + 100, { inizio: b2.T + 100 });
    ok(b2.qui() === R[1], `2m. con l anticipo a zero vale l istante misurato (${b2.qui()})`); }
  { // gesto cominciato in un altro menu: vale la voce corrente
    const b = banco(); b.fino('Scrivi'); const inizio = b.T; b.e.select(b.T); b.avanti(50);
    const figli = b.e.level.node.children.map(x => x.label);
    b.fino(figli[2]);
    b.e.handleAction('PREV', b.T, { inizio });
    ok(b.qui() === figli[1], `2n. gesto cominciato in un altro menu: si torna di una dalla voce corrente (${b.qui()})`); }
  { const b = banco(); b.fino(R[2]); b.e.pause(b.T);
    b.e.handleAction('PREV', b.T + 10);
    ok(b.e.paused, '2o. in pausa non fa nulla (e non risveglia)'); }
  { // la finestra di grazia non riporta avanti
    const b = banco(); b.c.scan.graceMs = 400; b.fino(R[2]);
    b.e.handleAction('PREV', b.T);
    const prima = b.qui(); b.e.select(b.T + 50);
    ok(b.e.stack.length === 2 && b.e.level.node.label === prima,
       `2p. dopo "indietro", un gesto di selezione prende la voce riannunciata (${b.e.level.node.label})`); }
  { // dentro un gruppo di lettere
    const b = banco(); b.fino('Scrivi'); b.e.select(b.T); b.fino('Vocali'); b.e.select(b.T); b.avanti(50);
    b.fino('I'); b.e.handleAction('PREV', b.T);
    ok(b.qui() === 'A', `2q. vale in ogni menu e sottomenu: fra le lettere, da I ad A (${b.qui()})`); }

  /* Dalla palpebra alla sequenza: chiusura breve → PREV con l'inizio giusto. */
  { const c = deepClone(DEFAULT_CONFIG);
    c.gestures.CLOSE_SHORT.enabled = true;
    c.scan.adaptive = false; c.scan.stepMs = 1000; c.scan.enterDelayMs = 0;
    const scan = new ScanEngine(c, { onOutput: () => {} });
    const eventi = [];
    let t = 0;
    const g = new GestureEngine(c, (e) => {
      eventi.push(e);
      // come fa l'applicazione: l'inizio del gesto, sullo stesso orologio
      const daQuanto = Number.isFinite(e.agoMs) ? e.agoMs : e.durMs;
      scan.handleAction(e.action, t, { inizio: t - daQuanto });
    });
    const o = (ap) => ({ x: 0, y: 0, openness: ap, confidence: 0.95 });
    const dai = (ms, ap) => { for (let i = 0; i < Math.round(ms / 33); i++) { t += 33; g.process(t, { left: o(ap), right: o(ap) }); scan.tick(t); } };
    dai(5000, 0.30);
    scan.start(t);
    const R2 = scan.level.node.children.map(x => x.label);
    while (scan.currentNode.label !== R2[1]) dai(33, 0.30);      // la sequenza arriva alla 2ª voce
    dai(500, 0.30);                                              // a metà della 2ª: "volevo la prima!"
    dai(700, 0.02);                                              // chiude gli occhi 0,7 s: intanto si passa alla 3ª
    const durante = scan.currentNode.label;
    dai(400, 0.30);                                              // riapre: il gesto viene riconosciuto
    ok(eventi.length === 1 && eventi[0].action === 'PREV', `2r. la chiusura breve dà "indietro di una voce" (${eventi.map(e => e.channel).join(',')})`);
    ok(durante === R2[2] && scan.currentNode.label === R2[0],
       `2s. cominciata sulla 2ª voce, riconosciuta sulla ${durante === R2[2] ? '3ª' : '?'}: la sequenza torna alla 1ª (${scan.currentNode.label})`); }
}

/* ══════════ 3. MODALITÀ NORMALIZZATA ══════════ */
{
  function sessione(mod, scena, seme = 7) {
    const c = deepClone(DEFAULT_CONFIG); mod && mod(c);
    const ev = []; const g = new GestureEngine(c, e => ev.push(e));
    let s = seme; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / 0.7071; };
    let t = 0; const st = { posa: 0, rum: 0.003, trem: 0.002 };
    const passo = () => { t += 33;
      const y = st.posa + st.rum * gauss() + st.trem * Math.sin(2 * Math.PI * t / 2300);
      const o = { x: 0, y, openness: 0.30, confidence: 0.9 };
      g.process(t, { left: o, right: { ...o, y: y + st.rum * gauss() * 0.3 } }); };
    const corri = (ms) => { const f = t + ms; while (t < f) passo(); };
    const gesti = [];
    const gesto = (amp, tenuta = 700, residuo = 0, residuoMs = 0) => { const t0 = t;
      for (let k = 1; k <= 4; k++) { st.posa = -amp * k / 4; passo(); }
      corri(tenuta);
      for (let k = 3; k >= 0; k--) { st.posa = -(residuo + (amp - residuo) * k / 4); passo(); }
      if (residuoMs) { corri(residuoMs); st.posa = 0; }
      gesti.push({ t0, t1: t }); };
    const finto = (amp, ms) => { for (let k = 1; k <= 3; k++) { st.posa = -amp * k / 3; passo(); } corri(ms); for (let k = 2; k >= 0; k--) { st.posa = -amp * k / 3; passo(); } };
    scena({ corri, gesto, finto, st, g });
    let presi = 0;
    for (const G of gesti) { const e = ev.find(x => x.t >= G.t0 && x.t <= G.t1 + 2600 && !x._u); if (e) { e._u = true; presi++; } }
    const conta = (k) => ev.filter(e => e.channel === k).length;
    return { g, ev, gesti: gesti.length, presi, falsi: ev.filter(e => !e._u).length, UP: conta('UP'), UP_LONG: conta('UP_LONG'), UP_VERYLONG: conta('UP_VERYLONG') };
  }
  const NORM = (c) => { c.signal.modoNormalizzato = true; };

  ok(DEFAULT_CONFIG.signal.modoNormalizzato === false, '3a. la modalità normalizzata è SPENTA di default');
  ok(DEFAULT_CONFIG.signal.normOff < DEFAULT_CONFIG.signal.normOn, '3b. il rilascio è più basso dell attivazione');

  const normale = ({ corri, gesto }) => { corri(8000); for (let i = 0; i < 20; i++) { gesto(0.05); corri(3500); } };
  { const a = sessione(null, normale), b = sessione(NORM, normale);
    ok(a.presi === 20 && b.presi === 20 && b.falsi === 0, `3c. gesto normale: tutti presi, nessun comando in più (${b.presi}/20, falsi ${b.falsi})`);
    const N = b.g.eyes.left.y.norm;
    ok(N?.attiva && Math.abs(N.rif['-1'] - 0.05) < 0.012, `3d. il riferimento imparato è l ampiezza vera del gesto (${N?.rif['-1']?.toFixed(3)} per un gesto di 0,050)`);
    const ay = b.g.eyes.left.y;
    ok(Math.abs(ay.sigma * b.g.cfg.signal.thresholdOn - 0.5 * N.rif['-1']) < 0.004,
       `3e. la soglia cade a metà del gesto tipico (${(ay.sigma * b.g.cfg.signal.thresholdOn).toFixed(4)})`); }

  /* Il caso per cui serve: gesto ampio, l'occhio non torna del tutto.
   * Con le soglie di sempre il rilascio arriva tardi, la durata misurata
   * si allunga e un gesto BREVE (seleziona) diventa LUNGO (annulla). */
  const ampio = ({ corri, gesto }) => { corri(8000); for (let i = 0; i < 20; i++) { gesto(0.15, 700, 0.03, 1500); corri(3500); } };
  { const a = sessione(null, ampio), b = sessione(NORM, ampio);
    ok(a.UP_LONG >= 15, `3f. (soglie di sempre: ${a.UP_LONG} gesti brevi su 20 presi per LUNGHI — è il difetto)`);
    ok(b.UP >= 16 && b.presi === 20, `3g. normalizzata: la durata torna giusta, ${b.UP} su 20 riconosciuti come BREVI (i primi tre servono a imparare)`); }

  // Sicurezza: riposo, tremore, riferimento che resta.
  { const b = sessione(NORM, ({ corri, st }) => { st.trem = 0.006; st.rum = 0.005; corri(300000); });
    ok(b.ev.length === 0, `3h. cinque minuti di solo tremore forte: nessun comando (${b.ev.length})`);
    ok(!b.g.eyes.left.y.norm?.attiva, '3i. e il tremore NON viene imparato come se fosse il gesto'); }
  { const b = sessione(NORM, ({ corri, gesto }) => { corri(8000); for (let i = 0; i < 5; i++) { gesto(0.05); corri(3500); } corri(360000); for (let i = 0; i < 10; i++) { gesto(0.05); corri(3500); } });
    ok(b.presi === 15 && b.falsi === 0, `3l. dopo sei minuti di riposo il riferimento è ancora lì: ${b.presi}/15, falsi ${b.falsi}`); }
  { const b = sessione(NORM, ({ corri, gesto, st }) => { corri(8000); for (let i = 0; i < 5; i++) { gesto(0.05); corri(3500); } st.trem = 0.006; st.rum = 0.005; corri(300000); });
    ok(b.falsi === 0, `3m. gesto imparato, poi cinque minuti di tremore forte: nessun comando involontario (${b.falsi})`);
    const ay = b.g.eyes.left.y;
    ok(ay.sigma * b.g.cfg.signal.thresholdOn >= 0.02, '3n. la soglia resta alta, a metà del gesto, non scende sul rumore'); }
  // Il gesto cambia: si riallinea.
  { const b = sessione(NORM, ({ corri, gesto }) => { corri(8000); for (let i = 0; i < 10; i++) { gesto(0.06); corri(3500); } for (let i = 0; i < 20; i++) { gesto(0.02); corri(3500); } });
    ok(b.presi >= 26, `3o. il gesto si riduce a un terzo a metà sessione: si riallinea dopo tre gesti (${b.presi}/30)`); }
  { const b = sessione(NORM, ({ corri, gesto }) => { corri(8000); for (let i = 0; i < 8; i++) { gesto(0.05); corri(3500); } gesto(0.30, 400); corri(3500); for (let i = 0; i < 10; i++) { gesto(0.05); corri(3500); } });
    ok(b.presi >= 18, `3p. un colpo di testa in mezzo non sposta il riferimento (${b.presi}/19)`); }
  // Movimenti piccoli fra un gesto e l'altro: meno comandi involontari.
  { const sc = ({ corri, gesto, finto }) => { corri(8000); for (let i = 0; i < 15; i++) { gesto(0.06); corri(1500); finto(0.017, 350); corri(2000); } };
    const a = sessione(null, sc), b = sessione(NORM, sc);
    ok(b.presi === 15 && b.falsi < a.falsi, `3q. piccoli movimenti involontari fra i gesti: comandi in più ${a.falsi} → ${b.falsi}, gesti veri ${b.presi}/15`); }
  // La sicurezza non si può togliere.
  { const b = sessione((c) => { NORM(c); c.signal.normOn = 0.2; }, ({ corri, gesto }) => { corri(8000); for (let i = 0; i < 6; i++) { gesto(0.016); corri(3500); } corri(2000); });
    const ay = b.g.eyes.left.y, base = ay.base?.sigma;
    ok(!ay.norm?.attiva || ay.sigma * b.g.cfg.signal.thresholdOn >= 2.4 * (base || 0),
       '3r. la soglia non scende mai sotto il minimo di sicurezza sul rumore, qualunque frazione si scelga'); }
  // Spenta = come prima; riaccesa e rispenta, le soglie tornano quelle di sempre.
  { const c = deepClone(DEFAULT_CONFIG); c.signal.thresholdDir = { up: 5 };
    const g = new GestureEngine(c, () => {});
    let t = 0; const o = { x: 0, y: 0, openness: 0.3, confidence: 0.9 };
    for (let i = 0; i < 100; i++) { t += 33; g.process(t, { left: o, right: o }); }
    const prima = [g.eyes.left.y.hyst['-1'].onK, g.eyes.left.y.hyst['-1'].offK];
    c.signal.modoNormalizzato = true; g.updateConfig(c);
    for (let i = 0; i < 100; i++) { t += 33; g.process(t, { left: o, right: o }); }
    c.signal.modoNormalizzato = false; g.updateConfig(c);
    for (let i = 0; i < 10; i++) { t += 33; g.process(t, { left: o, right: o }); }
    const dopo = [g.eyes.left.y.hyst['-1'].onK, g.eyes.left.y.hyst['-1'].offK];
    ok(prima[0] === 5 && JSON.stringify(prima) === JSON.stringify(dopo) && !g.eyes.left.y.norm,
       `3s. accesa e rispenta: soglie e guadagni tornano esattamente quelli di prima (${prima} → ${dopo})`); }
}

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail ? 1 : 0);
