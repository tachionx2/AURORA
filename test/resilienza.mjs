/**
 * Resilienza: telecamera e audio.
 *
 * ⚠️ È la suite più importante del progetto.
 *
 * Chi usa Aurora non ha altro modo di comunicare. Se la telecamera si
 * stacca di notte e il programma non se ne accorge, la persona resta
 * muta per ore senza poterlo dire a nessuno. Ogni verifica qui dentro
 * corrisponde a una situazione che può accadere davvero.
 */
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };

import { Watchdog, SorveglianzaAudio } from '../js/vision/Watchdog.js';

const attesa = (ms) => new Promise(r => setTimeout(r, ms));

/* ══════════ 1. Accorgersi che i fotogrammi si sono fermati ══════════ */
{
  let orologio = 0;
  const eventi = [];
  const w = new Watchdog({
    fermoMs: 1000, intervalloMs: 10000,
    onDiagnosi: d => eventi.push(d),
    onRipristina: async () => {},
  });
  w.avvia(() => orologio);

  orologio = 500;
  ok(w.controlla() === null, '1a. mezzo secondo senza fotogrammi: nessun allarme');
  orologio = 1500;
  const g = w.controlla();
  ok(g !== null, '1b. oltre la soglia: guasto rilevato');
  ok(g.tipo === 'nessun fotogramma', '1c. e il tipo è quello giusto');
  ok(eventi.some(e => e.fase === 'guasto'), '1d. il guasto viene segnalato');
  w.ferma();
}

/* ══════════ 2. Il battito rimanda l'allarme ══════════ */
{
  let orologio = 0;
  const w = new Watchdog({ fermoMs: 1000, intervalloMs: 10000, onRipristina: async () => {} });
  w.avvia(() => orologio);
  for (let i = 0; i < 20; i++) {
    orologio += 800;
    w.battito(orologio);
    if (w.controlla() !== null) { ok(false, '2a. un flusso regolare non deve mai allarmare'); break; }
  }
  ok(true, '2a. con fotogrammi regolari non scatta mai un falso allarme');
  w.ferma();
}

/* ══════════ 3. Ripristino automatico ══════════ */
{
  let orologio = 0, riaperture = 0;
  const fasi = [];
  const w = new Watchdog({
    fermoMs: 500, intervalloMs: 10000,
    onDiagnosi: d => fasi.push(d.fase),
    onRipristina: async () => { riaperture++; },
  });
  w.avvia(() => orologio);
  orologio = 2000;
  w.controlla();
  await attesa(1400);          // prima attesa: 1 secondo
  ok(riaperture === 1, `3a. la telecamera viene riaperta da sola (${riaperture})`);
  ok(fasi.includes('ripristinato'), '3b. il ripristino viene segnalato');
  ok(w.tentativi === 0, '3c. dopo un ripristino riuscito il conteggio si azzera');
  ok(w.contatori.ripristini === 1, '3d. e viene contato');
  w.ferma();
}

/* ══════════ 4. Non ci si arrende mai ══════════ */
{
  let orologio = 0, tentativi = 0;
  const w = new Watchdog({
    fermoMs: 300, intervalloMs: 10000,
    onRipristina: async () => { tentativi++; throw new Error('telecamera assente'); },
  });
  w.avvia(() => orologio);
  orologio = 1000;
  w.controlla();
  await attesa(1300);
  ok(tentativi === 1, '4a. primo tentativo eseguito');
  ok(w.contatori.falliti === 1, '4b. il fallimento viene contato');
  // Dopo un fallimento il prossimo controllo deve riprovare
  orologio += 1000;
  w.controlla();
  await attesa(2400);
  ok(tentativi === 2, `4c. si riprova dopo un fallimento (${tentativi} tentativi)`);
  ok(w.tentativi >= 2, '4d. e il conteggio dei tentativi cresce');
  w.ferma();
}

/* ══════════ 5. L'attesa cresce, ma non all'infinito ══════════ */
{
  const w = new Watchdog({});
  const attese = [];
  for (let i = 0; i < 10; i++) { w.tentativi = i; attese.push(w.attesaProssimoTentativo()); }
  ok(attese[0] === 1000, '5a. primo tentativo dopo un secondo');
  ok(attese[1] > attese[0] && attese[3] > attese[1], '5b. l attesa cresce');
  ok(Math.max(...attese) <= 30000, `5c. ma non supera i trenta secondi (${Math.max(...attese) / 1000}s)`);
  ok(attese[9] === attese[8], '5d. oltre un certo punto resta costante: non si arrende mai');
}

/* ══════════ 6. Una traccia che finisce viene notata subito ══════════ */
{
  const eventi = [];
  const w = new Watchdog({
    fermoMs: 99999, intervalloMs: 99999,
    onDiagnosi: d => eventi.push(d),
    onRipristina: async () => {},
  });
  w.avvia(() => 0);
  // MediaStreamTrack finto
  const ascoltatori = {};
  const traccia = {
    kind: 'video',
    addEventListener: (e, f) => { ascoltatori[e] = f; },
    removeEventListener: () => {},
  };
  w.sorveglia({ getTracks: () => [traccia] });
  ok(typeof ascoltatori.ended === 'function', '6a. la fine della traccia viene sorvegliata');
  ok(typeof ascoltatori.mute === 'function', '6b. e anche il silenziamento');
  ascoltatori.ended();
  ok(eventi.some(e => e.tipo === 'traccia terminata'),
     '6c. il cavo staccato viene notato SUBITO, senza aspettare i fotogrammi');
  w.ferma();
}

/* ══════════ 7. Fermare di proposito non è un guasto ══════════ */
{
  let riaperture = 0;
  const w = new Watchdog({ fermoMs: 300, intervalloMs: 10, onRipristina: async () => { riaperture++; } });
  let orologio = 0;
  w.avvia(() => orologio);
  w.ferma();
  orologio = 5000;
  ok(w.controlla() === null, '7a. a sorveglianza spenta non scatta nulla');
  await attesa(200);
  ok(riaperture === 0, '7b. e la telecamera non viene riaperta contro la volontà di chi l ha spenta');
}

/* ══════════ 8. Dispositivi audio scollegati ══════════ */
{
  let elenco = [
    { kind: 'audiooutput', deviceId: 'casse' },
    { kind: 'audiooutput', deviceId: 'auricolare' },
    { kind: 'videoinput', deviceId: 'webcam' },
  ];
  const ascoltatori = {};
  // In Node `navigator` è di sola lettura: si ridefinisce la proprietà.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, writable: true,
    value: {
      mediaDevices: {
        enumerateDevices: async () => elenco,
        addEventListener: (e, f) => { ascoltatori[e] = f; },
        removeEventListener: () => {},
      },
    },
  });
  const cambi = [];
  const sa = new SorveglianzaAudio(c => cambi.push(c));
  ok(await sa.avvia(), '8a. la sorveglianza dei dispositivi parte');

  // L'auricolare Bluetooth si disconnette
  elenco = elenco.filter(d => d.deviceId !== 'auricolare');
  const c1 = await sa.verifica();
  ok(c1?.audioSparito === true, '8b. un auricolare scollegato viene rilevato');
  ok(cambi.length === 1, '8c. e viene segnalato una volta sola');

  // Nessun cambiamento: non deve segnalare nulla
  ok(await sa.verifica() === null, '8d. senza cambiamenti non si segnala niente');

  // La telecamera viene staccata
  elenco = elenco.filter(d => d.deviceId !== 'webcam');
  const c2 = await sa.verifica();
  ok(c2?.videoSparito === true, '8e. una telecamera scollegata viene rilevata');

  // Riattaccata
  elenco.push({ kind: 'videoinput', deviceId: 'webcam' });
  const c3 = await sa.verifica();
  ok(c3?.comparsi.length === 1, '8f. e la riconnessione pure');
  sa.ferma();
}

/* ══════════ 9. Robustezza ══════════ */
{
  let err = null;
  try {
    const w = new Watchdog({});
    w.sorveglia(null);
    w.sorveglia({});
    w.sorveglia({ getTracks: () => [] });
    w.controlla();
    w.stato;
    w.ferma(); w.ferma();
    const sa = new SorveglianzaAudio();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, writable: true,
      value: { mediaDevices: { enumerateDevices: async () => { throw new Error('x'); } } },
    });
    await sa.verifica();
  } catch (e) { err = e.message; }
  ok(!err, '9a. dati assenti o errori di sistema non fanno cadere la sorveglianza: ' + (err || ''));
}

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail ? 1 : 0);
