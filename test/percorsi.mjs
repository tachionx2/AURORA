/**
 * Percorsi d'uso reali, dall'inizio alla fine, con UN SOLO GESTO.
 *
 * Non verifica funzioni isolate ma le cose che la persona deve
 * effettivamente riuscire a fare. Se una di queste si rompe, il
 * programma è inutile per lei, indipendentemente da quanti test
 * unitari passano.
 */
global.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
import { DEFAULT_CONFIG, deepClone } from '../js/core/config.js';
import { ScanEngine, DEFAULT_PHRASES } from '../js/scan/ScanEngine.js';
import { Predictor } from '../js/lang/Predictor.js';
import { Drafts } from '../js/lang/Drafts.js';
import { GestureEngine } from '../js/signal/GestureEngine.js';

let pass=0, fail=0;
const ok=(c,m)=>{ if(c) pass++; else {fail++; console.log('  ✗ '+m);} };
const cfg = deepClone(DEFAULT_CONFIG);

/** Un banco che simula ESATTAMENTE l'unico gesto disponibile. */
function banco(opts = {}) {
  // Ogni scenario parte da zero: l'archivio è persistente, e senza
  // questo i testi di uno scenario inquinerebbero il successivo.
  localStorage.removeItem('aurora.drafts.v1');
  localStorage.removeItem('aurora.wip.v1');
  const drafts = new Drafts();
  const pred = new Predictor(cfg, null);
  pred.seedPhrases(DEFAULT_PHRASES);
  const detto = [], voce = [];
  let T = 0;
  const eng = new ScanEngine(cfg, {
    onOutput: (k, txt) => { (k === 'speech' ? detto : voce).push(txt); },
    onDraft: (op, a) => {
      if (op === 'save') { drafts.add(a.text); ctx(); }
      if (op === 'speak') { const d = drafts.get(a.id); if (d) detto.push(d.text); }
      if (op === 'load') { const d = drafts.get(a.id); if (d) eng.loadText(d.text, T); }
      if (op === 'delete') { drafts.remove(a.id); ctx(); }
    },
  });
  function ctx() {
    const b = eng.buffer;
    eng.setContext({
      suggestions: pred.completions(b.letters, b.words[b.words.length-1] || null, 4),
      phrases: pred.topPhrases(cfg.scan.phraseCount),
      drafts: drafts.list.map(d => ({ id: d.id, title: d.title })),
      hasText: !!(b.words.length || b.letters.trim()),
    });
  }
  eng.start(T); ctx();
  /** Un gesto = una selezione. Scorre finché non trova la voce voluta. */
  /**
   * @param max iterazioni. Deve bastare per l'USCITA AUTOMATICA da un
   * sottolivello: dopo tre giri a vuoto la scansione risale da sola,
   * ed è così che si torna al menu senza una voce indietro.
   */
  function gesto(etichetta, max = 5000) {
    for (let i = 0; i < max; i++) {
      ctx();
      if (eng.paused) eng.resume(T);
      if (eng.currentNode?.label === etichetta) { eng.select(T); ctx(); return true; }
      T += 25; eng.tick(T);
    }
    return false;
  }
  return { eng, drafts, pred, detto, voce, gesto, get T(){return T} };
}

/* ═══ 1. Dire "Sì" — il percorso più corto e più usato ═══ */
{
  const b = banco();
  ok(b.gesto('Frasi'), '1a. raggiunge le frasi');
  ok(b.gesto('Subito'), '1b. raggiunge il gruppo "Subito"');
  ok(b.gesto('Sì'), '1c. raggiunge "Sì"');
  ok(b.detto.includes('Sì'), '1d. "Sì" viene pronunciato ad alta voce');
}

/* ═══ 2. Scrivere una parola e pronunciarla ═══ */
{
  const b = banco();
  ok(b.gesto('Scrivi'), '2a. entra in Scrivi');
  ok(b.gesto('Vocali'), '2b. entra nelle vocali');
  ok(b.gesto('O'), '2c. compone O');
  ok(b.eng.buffer.letters === 'O', '2d. la lettera è nel buffer');
  ok(b.gesto('AZIONI'), '2e. raggiunge le azioni');
  ok(b.gesto('PARLA'), '2f. seleziona PARLA');
  ok(b.detto.includes('O'), '2g. la parola viene pronunciata');
  ok(b.eng.buffer.words.length === 0, '2h. il buffer si svuota dopo aver parlato');
}

/* ═══ 3. Uscire da una sezione sbagliata senza completarla ═══ */
{
  const b = banco();
  b.gesto('Frasi');
  const dentro = b.eng.level.node.id;
  ok(dentro === 'phrases', '3a. è dentro le frasi');
  ok(b.gesto('← ESCI'), '3b. trova la voce indietro');
  ok(b.eng.level.node.id === 'root', '3c. è tornata al menu senza dire nulla');
  ok(b.detto.length === 0, '3d. non ha pronunciato niente per sbaglio');
}

/* ═══ 4. Scrivere una lettera lunga, salvarla, e pronunciarla dopo ═══ */
{
  const b = banco();
  b.eng.loadText('caro marco ti penso ogni giorno', b.T);
  b.gesto('Scrivi'); b.gesto('AZIONI');
  ok(b.gesto('RILEGGI'), '4a. può rileggere il testo (RILEGGI)');
  ok(b.detto.some(t => t.includes('caro marco')), '4b. il testo viene letto');
  ok(b.eng.buffer.words.length > 0, '4c. rileggere NON cancella il testo');

  // Dopo la lettura la scansione torna ai gruppi di lettere: per
  // salvare si rientra in AZIONI. È corretto, ma va verificato che
  // il percorso sia effettivamente percorribile.
  ok(b.gesto('AZIONI'), '4d. rientra nelle azioni dopo la lettura');
  ok(b.gesto('SALVA'), '4e. può salvare il testo');
  ok(b.drafts.list.length === 1, '4f. il testo è nell archivio');

  // ... più tardi, il testo si ritrova e si pronuncia
  const titolo = b.drafts.list[0].title;
  ok(b.gesto('MIEI TESTI'), '4g. l archivio è raggiungibile dal menu');
  ok(b.gesto(titolo), '4h. trova il testo salvato');
  ok(b.gesto('RILEGGI'), '4i. può farlo pronunciare');
  ok(b.detto.filter(t => t.includes('caro marco')).length >= 2, '4l. il testo salvato viene pronunciato');
}

/* ═══ 5. Riprendere un testo per continuarlo ═══ */
{
  const b = banco();
  b.drafts.add('inizio della lettera');
  const titolo = b.drafts.list[0].title;
  ok(b.gesto('MIEI TESTI'), '5a. archivio raggiungibile');
  ok(b.gesto(titolo), '5b. trova il testo');
  ok(b.gesto('SCRIVI'), '5c. può riprenderlo');
  ok(b.eng.buffer.words.join(' ') === 'inizio della lettera', '5d. il testo è tornato nel buffer');
}

/* ═══ 6. Annullare un errore ═══ */
{
  const b = banco();
  b.gesto('Scrivi'); b.gesto('Vocali'); b.gesto('A');
  ok(b.eng.buffer.letters === 'A', '6a. lettera composta');
  b.eng.undo(b.T);
  ok(b.eng.buffer.letters === '', '6b. il gesto lungo cancella la lettera');
}

/* ═══ 7. Mettere in pausa e risvegliarsi da sola ═══ */
{
  const b = banco();
  ok(b.gesto('PAUSA'), '7a. può mettere in pausa dal menu');
  ok(b.eng.paused, '7b. è in pausa');
  const prima = b.eng.buffer.letters;
  b.eng.tick(b.T + 30000);
  ok(b.eng.paused && b.eng.buffer.letters === prima, '7c. in pausa non succede nulla');
  b.eng.handleAction('WAKE', b.T + 31000);
  ok(!b.eng.paused, '7d. il gesto molto lungo la risveglia');
}

/* ═══ 8. Il gesto reale, dal segnale oculare all'azione ═══ */
{
  const eventi = [];
  const g = new GestureEngine(deepClone(DEFAULT_CONFIG), e => eventi.push(e));
  let t = 0;
  const occhio = (y, ap = 0.30) => ({ x: 0, y, openness: ap, confidence: 0.9 });
  const dai = (ms, L, R) => { for (let i = 0; i < ms; i += 20) { t += 20; g.process(t, { left: L, right: R }); } };
  dai(10000, occhio(0), occhio(0));                       // riposo con nistagmo assente
  ok(eventi.length === 0, '8a. dieci secondi di riposo: nessun falso positivo');
  dai(20000, occhio(0.012 * Math.random()), occhio(0));   // rumore
  ok(eventi.length === 0, '8b. venti secondi di rumore: nessun falso positivo');
  dai(900, occhio(-0.08), occhio(-0.08)); dai(2000, occhio(0), occhio(0));
  ok(eventi.some(e => e.action === 'SELECT'), '8c. gesto breve → SELEZIONA');
  const n = eventi.length;
  dai(2600, occhio(-0.08), occhio(-0.08)); dai(2000, occhio(0), occhio(0));
  ok(eventi.slice(n).some(e => e.action === 'UNDO'), '8d. gesto lungo → ANNULLA');
  const n2 = eventi.length;
  dai(4200, occhio(-0.08), occhio(-0.08)); dai(2000, occhio(0), occhio(0));
  ok(eventi.slice(n2).some(e => e.action === 'WAKE'), '8e. gesto molto lungo → PAUSA/RISVEGLIO');
  // con un occhio chiuso funziona lo stesso
  const n3 = eventi.length;
  dai(3000, occhio(0, 0.04), occhio(0));
  dai(900, occhio(0, 0.04), occhio(-0.08)); dai(2000, occhio(0, 0.04), occhio(0));
  ok(eventi.slice(n3).length === 1, '8f. con un occhio chiuso l altro funziona');
}

/* ═══ 9. Il completamento fa risparmiare davvero ═══ */
{
  const b = banco();
  for (let i = 0; i < 8; i++) b.pred.learnSentence('ho sete');
  b.gesto('Scrivi'); b.gesto('Vocali'); b.gesto('␣');
  b.eng.buffer = { letters: 'se', words: [], sentence: '' };
  b.eng._afterCompose(b.T, false);
  const sugg = b.pred.completions('se', null, 4);
  ok(sugg.includes('sete'), '9a. dopo due lettere suggerisce la parola intera');
}

/* ═══ 10. Guardare un video con un solo gesto ═══ */
{
  const { COMMANDS_BY_KIND } = await import('../js/media/MediaPlayer.js');
  const b = banco();
  b.eng.setContext({ mediaCommands: COMMANDS_BY_KIND.youtube, mediaLabel: 'VIDEO', hasText: false, drafts: [], phrases: DEFAULT_PHRASES, suggestions: [] });
  ok(b.eng.tree.children[0].id === 'media', '10a. i comandi video sono la prima voce del menu');
  const dentro = b.eng.tree.children[0].children.map(c => c.label);
  ok(dentro.includes('PAUSA / RIPRENDI'), '10b. può mettere il video in pausa');
  ok(dentro.includes('← ESCI'), '10c. può uscire dai comandi video');
}

/* ═══ 11. Ritorno mirato: risparmiare un ciclo intero ═══ */
{
  const b = banco();
  b.gesto('Scrivi'); b.gesto('Vocali'); b.gesto('A');
  ok(b.eng.currentNode?.label === 'Vocali', '11a. dopo una LETTERA si riparte dai gruppi');
  b.gesto('Vocali'); b.gesto('␣');
  ok(b.eng.currentNode?.label === 'AZIONI', '11b. dopo uno SPAZIO si riparte dalle AZIONI');
  b.gesto('AZIONI'); b.gesto('RILEGGI');
  ok(b.eng.currentNode?.label === 'AZIONI', '11c. dopo un AZIONE si riparte dalle AZIONI');
  // e da lì una seconda azione è immediata, senza aspettare il giro
  ok(b.gesto('AZIONI'), '11d. si può incatenare subito un altra azione');
}

/* ═══ 12. SALVA svuota la barra di composizione ═══ */
{
  const b = banco();
  b.eng.loadText('caro marco ti scrivo', b.T);
  b.gesto('Scrivi'); b.gesto('AZIONI');
  ok(b.gesto('SALVA'), '12a. salva il testo');
  ok(b.drafts.list.length === 1, '12b. il testo è nell archivio');
  ok(b.eng.buffer.words.length === 0 && b.eng.buffer.letters === '',
     '12c. la barra si svuota: il testo salvato non viene riproposto come nuovo');
  const t2 = buildTreeFor(b);
  ok(!t2.children.some(c => c.id === 'drafts' && c.children.some(x => x.action === 'SAVE_DRAFT' && b.eng.buffer.words.length)),
     '12d. senza testo in composizione non compare SALVA per errore');
}
function buildTreeFor(b){ return b.eng.tree; }

/* ═══ 13. Convenzioni delle etichette ═══ */
{
  const b = banco();
  const menu = b.eng.tree.children.map(c => c.label);
  ok(menu.join(' · ') === 'Frasi · Scrivi · PAUSA' || menu.includes('MIEI TESTI'),
     '13a. menu coerente: ' + menu.join(' · '));
  ok(b.eng.tree.children[b.eng.tree.children.length - 1].label === 'PAUSA',
     '13b. PAUSA è sempre l ultima voce');
  // Ogni sezione comincia con l'uscita
  // L'uscita è la prima voce OVUNQUE, con una sola eccezione voluta e
  // configurabile: dentro i gruppi di lettere sta in coda, perché in
  // testa costerebbe un annuncio in più per OGNI lettera, cioè circa il
  // 30% sul percorso più frequente di tutti. Si cambia da Impostazioni
  // → Scansione → "Posizione di indietro nei gruppi di lettere".
  const gruppiLettere = new Set(cfg.scan.groups.map(g => g.id));
  const senzaUscita = [], uscitaInCoda = [];
  (function scendi(n, path) {
    if (!n.children) return;
    if (n.id !== 'root') {
      const haUscita = n.children.some(c => c.action === 'BACK');
      if (!haUscita) senzaUscita.push(path + '/' + n.id);
      else if (n.children[0].action !== 'BACK') {
        (gruppiLettere.has(n.id) ? uscitaInCoda : senzaUscita).push(path + '/' + n.id);
      }
    }
    n.children.forEach(c => scendi(c, path + '/' + n.id));
  })(b.eng.tree, '');
  ok(senzaUscita.length === 0, '13c. l uscita è la prima voce ovunque: ' + senzaUscita.join(', '));
  ok(uscitaInCoda.length === cfg.scan.groups.length,
     '13c2. unica eccezione voluta: i gruppi di lettere hanno l uscita in coda');
  const az = b.eng.tree.children.find(c => c.id === 'write').children.find(c => c.id === 'act');
  ok(az.children[0].spoken === 'esci', '13d. si dice "esci", non "indietro"');
  // La voce MENU è ora opzionale: si verifica l'etichetta accendendola.
  {
    const conMenu13 = deepClone(DEFAULT_CONFIG);
    conMenu13.scan.showMenuItem = true;
    const { buildTree: bt13 } = await import('../js/scan/ScanEngine.js');
    const az13 = bt13(conMenu13, { hasText: true }).children.find(c => c.id === 'write')
      .children.find(c => c.id === 'act');
    ok(az13.children.find(c => c.action === 'ROOT')?.spoken === 'menu',
       '13e. quando c e, si dice "menu", non "menu principale"');
  }
}

/* ═══ 14. Titoli dei testi: corti, devono stare a schermo ═══ */
{
  const lunghi = [
    'Caro Marco, volevo dirti che ti penso ogni giorno e che mi manchi',
    'Dottore ho un dolore fortissimo alla schiena da tre giorni interi',
  ];
  for (const testo of lunghi) {
    const t = Drafts.autoTitle(testo);
    ok(t.length <= 21, `14. titolo corto (${t.length} caratteri): "${t}"`);
  }
}

/* ═══ 15. Un testo riletto non deve restare nella barra ═══ */
{
  const b = banco();
  b.eng.loadText('caro marco ti penso', b.T);
  b.gesto('Scrivi'); b.gesto('AZIONI'); b.gesto('SALVA');
  ok(b.eng.buffer.words.length === 0, '15a. dopo SALVA la barra è vuota');
  ok(b.drafts.list.length === 1, '15b. il testo è nell archivio');

  const tit = b.drafts.list[0].title;
  b.gesto('MIEI TESTI'); b.gesto(tit); b.gesto('RILEGGI');
  ok(b.detto.some(x => x.includes('caro marco')), '15c. il testo viene pronunciato');
  ok(b.eng.buffer.words.length === 0 && b.eng.buffer.letters === '',
     '15d. dopo RILEGGI la barra resta VUOTA: non serve cancellarla');
  ok(b.drafts.list.length === 1, '15e. rileggere non consuma il testo: resta in archivio');

  // Si può rileggere più volte
  b.gesto('MIEI TESTI'); b.gesto(tit); b.gesto('RILEGGI');
  ok(b.detto.filter(x => x.includes('caro marco')).length >= 2, '15f. si può rileggere più volte');
  ok(b.eng.buffer.words.length === 0, '15g. la barra resta vuota anche dopo la seconda rilettura');

  // SCRIVI invece la riempie: è il suo scopo
  b.gesto('MIEI TESTI'); b.gesto(tit); b.gesto('SCRIVI');
  ok(b.eng.buffer.words.join(' ') === 'caro marco ti penso',
     '15h. SCRIVI riempie la barra apposta, per continuare il testo');

  // Eliminare lo toglie dall'archivio — ma solo dopo CONFERMA, che è
  // una voce della scansione e non un dialogo del browser.
  b.eng.buffer = { letters:'', words:[], sentence:'' };
  b.gesto('MIEI TESTI'); b.gesto(tit); b.gesto('ELIMINA');
  ok(b.drafts.list.length === 1, '15i. ELIMINA da solo NON cancella: prima chiede conferma');
  b.gesto('CONFERMA ELIMINA');
  ok(b.drafts.list.length === 0, '15i2. e con la conferma lo toglie dall archivio');
}

/* ═══ 16. Due voci distinte per i due canali ═══ */
{
  const { DEFAULT_CONFIG: DC, migrateConfig, validateConfig } = await import('../js/core/config.js');
  ok('menuVoiceUri' in DC.audio && 'speechVoiceUri' in DC.audio, '16a. due voci configurabili');
  ok(DC.audio.menuRate > DC.audio.speechRate,
     `16b. gli annunci partono più svelti della frase (${DC.audio.menuRate}× contro ${DC.audio.speechRate}×)`);
  // Un profilo vecchio con una voce sola deve continuare a funzionare
  const vecchio = migrateConfig({ version: 11, audio: { ttsVoiceUri: 'Alice', rate: 1.4 } });
  ok(vecchio.audio.menuVoiceUri === 'Alice' && vecchio.audio.speechVoiceUri === 'Alice',
     '16c. i profili precedenti applicano la voce unica a entrambi i canali');
  ok(vecchio.audio.menuRate === 1.4 && vecchio.audio.speechRate === 1.4,
     '16d. anche la velocità viene riportata su entrambi');
  ok(validateConfig(vecchio).length === 0, '16e. il profilo migrato resta valido');
}

/* ═══ 17. Respiro entrando in una sezione ═══ */
{
  const cfgA = deepClone(DEFAULT_CONFIG);
  const ann = [];
  let TT = 0;
  const e = new ScanEngine(cfgA, { onAnnounce: n => ann.push({ t: TT, l: n.label }) });
  e.start(TT);
  const scegli = l => {
    for (let i = 0; i < 4000; i++) {
      if (e.paused) e.resume(TT);
      if (e.currentNode?.label === l) { e.select(TT); return TT; }
      TT += 25; e.tick(TT);
    }
    return -1;
  };
  const tSel = scegli('Scrivi');
  ann.length = 0;
  for (let i = 0; i < 20; i++) { TT += 25; e.tick(TT); }   // 500 ms
  ok(ann.length === 0, '17a. nei primi 500 ms dopo la selezione non si annuncia nulla');
  for (let i = 0; i < 20; i++) { TT += 25; e.tick(TT); }   // fino a 1000 ms
  ok(ann.length === 1, '17b. la prima voce arriva dopo l attesa');
  const ritardo = ann[0].t - tSel;
  ok(ritardo >= cfgA.scan.enterDelayMs && ritardo < cfgA.scan.enterDelayMs + 100,
     `17c. attesa rispettata (${ritardo} ms, configurata ${cfgA.scan.enterDelayMs})`);
  // La prima voce deve poi restare selezionabile per un passo intero
  const prima = e.currentNode?.label;
  for (let i = 0; i < 40; i++) { TT += 25; e.tick(TT); }
  ok(e.currentNode?.label === prima, '17d. la prima voce resta disponibile per un passo intero');

  // Con attesa 0 il comportamento torna quello di prima
  const cfgB = deepClone(DEFAULT_CONFIG); cfgB.scan.enterDelayMs = 0;
  const ann2 = []; let T2 = 0;
  const e2 = new ScanEngine(cfgB, { onAnnounce: n => ann2.push(n.label) });
  e2.start(T2);
  for (let i = 0; i < 4000; i++) {
    if (e2.paused) e2.resume(T2);
    if (e2.currentNode?.label === 'Scrivi') { ann2.length = 0; e2.select(T2); break; }
    T2 += 25; e2.tick(T2);
  }
  ok(ann2.length === 1, '17e. con attesa a zero si annuncia subito, come prima');
}

/* ═══ 18. Calibrazione: soglia configurabile e misure riportate ═══ */
{
  const { GazeCalibration, calibrationTargets } = await import('../js/pointer/calibration.js');
  const { DEFAULT_CONFIG: DC } = await import('../js/core/config.js');
  ok(typeof DC.pointer.minSpan === 'number', '18a. la soglia di escursione è configurabile');

  // Escursione verticale compressa, come capita in luce visibile
  const c = new GazeCalibration(); c.minSpan = DC.pointer.minSpan;
  for (const tg of calibrationTargets(9)) {
    c.add((tg.x - 0.5) * 0.30, (tg.y - 0.5) * 0.05, tg.x * 1920, tg.y * 1080);
  }
  ok(c.fit().ok, '18b. un movimento verticale compresso viene comunque accettato');

  // Davvero immobile: rifiutato, ma con le misure per capire perché
  const c2 = new GazeCalibration(); c2.minSpan = 0.02;
  for (const tg of calibrationTargets(9)) c2.add(0.01, 0.01, tg.x * 1920, tg.y * 1080);
  const r2 = c2.fit();
  ok(!r2.ok, '18c. sguardo immobile: rifiutato');
  ok(Number.isFinite(r2.spanX) && Number.isFinite(r2.spanY),
     '18d. il rifiuto riporta le escursioni misurate, per capire cosa non va');
}

/* ═══ 19. Passo separato per lettere e menu ═══ */
{
  const c = deepClone(DEFAULT_CONFIG);
  c.scan.stepMs = 1500; c.scan.letterStepMs = 900;
  c.scan.enterDelayMs = 700; c.scan.letterEnterDelayMs = 300;
  let TT = 0;
  const e = new ScanEngine(c, {});
  e.start(TT);
  const scegli = l => { for (let i=0;i<6000;i++){ if(e.paused) e.resume(TT);
    if (e.currentNode?.label === l) { e.select(TT); return true; } TT+=25; e.tick(TT); } return false; };

  ok(Math.round(e.stepCorrente) === 1500, `19a. nel menu il passo è quello dei menu (${Math.round(e.stepCorrente)} ms)`);
  ok(e.attesaCorrente === 700, '19b. e l attesa è quella dei menu');
  scegli('Scrivi');
  ok(Math.round(e.stepCorrente) === 1500, '19c. anche dentro Scrivi: è un menu');
  scegli('Vocali');
  ok(Math.round(e.stepCorrente) === 900, `19d. nel gruppo di lettere il passo è più corto (${Math.round(e.stepCorrente)} ms)`);
  ok(e.attesaCorrente === 300, '19e. e anche l attesa è più corta');

  // Tempo effettivo. Attenzione: entrando c'è prima l'attesa
  // d'ingresso (300 ms), POI parte il passo (900 ms). Il primo
  // avanzamento cade quindi a 1200 ms dalla selezione, non a 900.
  const partenza = e.currentNode?.label;
  for (let i=0;i<44;i++){ TT+=25; e.tick(TT); }     // 1100 ms
  ok(e.currentNode?.label === partenza, '19f. prima di attesa+passo non avanza');
  for (let i=0;i<8;i++){ TT+=25; e.tick(TT); }      // fino a 1300 ms
  ok(e.currentNode?.label !== partenza, '19g. superati attesa+passo, avanza');

  // Senza valore specifico si eredita quello dei menu: nulla cambia
  const c2 = deepClone(DEFAULT_CONFIG);
  c2.scan.letterStepMs = 0; c2.scan.stepMs = 1400;
  let T2 = 0; const e2 = new ScanEngine(c2, {}); e2.start(T2);
  const scegli2 = l => { for (let i=0;i<6000;i++){ if(e2.paused) e2.resume(T2);
    if (e2.currentNode?.label === l) { e2.select(T2); return true; } T2+=25; e2.tick(T2); } return false; };
  scegli2('Scrivi'); scegli2('Vocali');
  ok(Math.round(e2.stepCorrente) === 1400, '19h. a 0 si eredita il passo dei menu');
}

/* ═══ 20. Panning dei toni: solo i toni, non il parlato ═══ */
{
  const { DEFAULT_CONFIG: DC } = await import('../js/core/config.js');
  ok('earconPan' in DC.audio, '20a. il canale stereo dei toni è configurabile');
  ok(DC.audio.earconPan === 0, '20b. centrato per default: nessun cambiamento non richiesto');
  // Nessuna impostazione promette di pannare il PARLATO: sarebbe falsa,
  // perché la sintesi del browser non passa da Web Audio.
  const chiavi = Object.keys(DC.audio);
  ok(!chiavi.some(k => /speechPan|voicePan|ttsPan/i.test(k)),
     '20c. nessuna impostazione promette di pannare il parlato');
}

/* ═══ 21. Cancellare più volte senza uscire dalle azioni ═══ */
{
  const b = banco();
  const testo = () => [...b.eng.buffer.words, b.eng.buffer.letters].join(' ').trim();
  b.eng.loadText('ciao marco', b.T);
  b.gesto('Scrivi'); b.gesto('AZIONI');
  ok(b.gesto('⌫ lettera'), '21a. raggiunge cancella lettera');
  ok(testo() === 'ciao marc', `21b. la PRIMA pressione cancella già una lettera (${testo()})`);
  ok(b.eng.level.node.id === 'act', '21c. resta DENTRO le azioni');
  ok(b.eng.currentNode?.label === '⌫ lettera', '21d. e sulla stessa voce, pronta a ripetersi');

  // Ripetere costa un solo gesto, senza riscorrere il menu
  b.eng.select(b.T);
  ok(testo() === 'ciao mar', `21e. seconda cancellazione immediata (${testo()})`);
  b.eng.select(b.T);
  ok(testo() === 'ciao ma', '21f. terza cancellazione immediata');
  ok(b.eng.currentNode?.label === '⌫ lettera', '21g. sempre lì');

  // Anche cancella parola
  const c2 = banco();
  c2.eng.loadText('uno due tre', c2.T);
  c2.gesto('Scrivi'); c2.gesto('AZIONI'); c2.gesto('⌫ parola');
  ok(c2.eng.currentNode?.label === '⌫ parola', '21h. anche cancella parola resta sulla voce');
  ok(c2.eng.level.node.id === 'act', '21i. dentro le azioni');

  // Le ALTRE azioni conservano il comportamento di prima: tornano al
  // livello di scrittura posizionate su AZIONI.
  const c3 = banco();
  c3.eng.loadText('prova', c3.T);
  c3.gesto('Scrivi'); c3.gesto('AZIONI'); c3.gesto('RILEGGI');
  ok(c3.eng.level.node.id === 'write' && c3.eng.currentNode?.label === 'AZIONI',
     '21l. RILEGGI torna al livello scrittura su AZIONI, come prima');

  // Nessuna cancellazione su testo vuoto deve rompere qualcosa
  const c4 = banco();
  c4.gesto('Scrivi'); c4.gesto('AZIONI'); c4.gesto('⌫ lettera');
  c4.eng.select(c4.T); c4.eng.select(c4.T);
  ok(c4.eng.buffer.words.length === 0 && c4.eng.buffer.letters === '',
     '21m. cancellare a vuoto non produce stati strani');
  ok(c4.eng.currentNode?.label === '⌫ lettera', '21n. e resta comunque sulla voce');
}

/* ═══ 22. Pausa e risveglio: comandi SEPARATI ═══ */
{
  const b = banco();
  const stato = () => b.eng.paused;

  // A programma attivo, un risveglio non deve poter mettere in pausa:
  // era il rischio del comando che alternava — bastava tenere l'occhio
  // su un po' più del previsto.
  ok(!stato(), '22a. si parte attivi');
  b.eng.handleAction('WAKE', b.T);
  ok(!stato(), '22b. RISVEGLIA a programma attivo: nessun effetto');
  b.eng.handleAction('PAUSE', b.T);
  ok(stato(), '22c. PAUSA a programma attivo: mette in pausa');
  b.eng.handleAction('PAUSE', b.T);
  ok(stato(), '22d. PAUSA già in pausa: nessun effetto');
  b.eng.handleAction('WAKE', b.T);
  ok(!stato(), '22e. RISVEGLIA in pausa: riprende');

  // Il comportamento che alterna resta disponibile per chi lo vuole
  b.eng.handleAction('TOGGLE_PAUSE', b.T);
  ok(stato(), '22f. il comando che alterna mette in pausa');
  b.eng.handleAction('TOGGLE_PAUSE', b.T);
  ok(!stato(), '22g. e risveglia');

  // Le azioni devono essere assegnabili a canali diversi
  const { ACTIONS } = await import('../js/core/config.js');
  ok('PAUSE' in ACTIONS && 'WAKE' in ACTIONS && 'TOGGLE_PAUSE' in ACTIONS,
     '22h. tre azioni distinte assegnabili ai canali');
}

/* ═══ 23. In pausa esce solo ciò che risveglia ═══ */
{
  const { GestureEngine: GE } = await import('../js/signal/GestureEngine.js');
  const c = deepClone(DEFAULT_CONFIG);
  c.detection.activeEye = 'left';
  c.gestures.UP.action = 'SELECT';
  c.gestures.UP_LONG.action = 'PAUSE';
  c.gestures.UP_VERYLONG.action = 'WAKE';
  const ev = []; const g = new GE(c, e => ev.push(e));
  let t = 0;
  const o = y => ({ x: 0, y, openness: 0.30, confidence: 0.9 });
  const d = (ms, y) => { for (let i = 0; i < ms; i += 20) { t += 20; g.process(t, { left: o(y), right: null }); } };
  d(10000, 0);
  const gesto = ms => { const n = ev.length; d(ms, -0.09); d(2500, 0); return ev.slice(n).map(x => x.action); };

  ok(gesto(900).includes('SELECT'), '23a. attivo: il gesto breve seleziona');
  ok(gesto(2600).includes('PAUSE'), '23b. attivo: il gesto lungo mette in pausa');

  g.setPaused(true);
  ok(gesto(900).length === 0, '23c. in pausa: il gesto breve non produce nulla');
  ok(gesto(2600).length === 0, '23d. in pausa: nemmeno PAUSA, che sarebbe senza senso');
  ok(gesto(4200).includes('WAKE'), '23e. in pausa: solo il risveglio esce');
}

/* ═══ 24. I profili esistenti continuano a funzionare ═══ */
{
  const { migrateConfig, validateConfig } = await import('../js/core/config.js');
  const vecchio = migrateConfig({ version: 16, gestures: { UP_VERYLONG: { enabled: true, action: 'WAKE', dwellMs: 3400, maxMs: 99000 } } });
  ok(vecchio.gestures.UP_VERYLONG.action === 'WAKE',
     '24a. un profilo con RISVEGLIA resta su RISVEGLIA');
  ok(vecchio.gestures.UP_VERYLONG.enabled === true, '24b. e resta attivo');
  ok(validateConfig(vecchio).length === 0, '24c. il profilo migrato è valido');
  // La pausa resta comunque raggiungibile dal menu
  const { buildTree: bt } = await import('../js/scan/ScanEngine.js');
  const albero = bt(vecchio, {});
  ok(albero.children.some(c => c.action === 'PAUSE'),
     '24d. la pausa resta raggiungibile dal menu, come sempre');
}

/* ═══ 25. I comandi dell'assistente devono alternare ═══ */
{
  // Regressione: separando pausa e risveglio per i GESTI, il pulsante
  // Pausa e il tasto Esc erano rimasti su RISVEGLIA e non mettevano più
  // in pausa. Un pulsante etichettato "Pausa" deve sempre alternare.
  const b = banco();
  ok(!b.eng.paused, '25a. si parte attivi');
  b.eng.handleAction('TOGGLE_PAUSE', b.T);
  ok(b.eng.paused, '25b. il comando dell assistente mette in pausa');
  b.eng.handleAction('TOGGLE_PAUSE', b.T);
  ok(!b.eng.paused, '25c. e riprende');
  b.eng.handleAction('TOGGLE_PAUSE', b.T);
  ok(b.eng.paused, '25d. e alterna di nuovo');

  // Il codice non deve più usare WAKE dove serve alternare
  const fs2 = await import('node:fs');
  const path2 = await import('node:path');
  const qui = path2.dirname(import.meta.filename || process.argv[1]);
  const main = fs2.readFileSync(path2.join(qui, '..', 'js/main.js'), 'utf8');
  ok(!/handleAction\('WAKE'/.test(main) && !/injectKey\('WAKE'\)/.test(main),
     '25e. nessun comando dell assistente usa più RISVEGLIA per alternare');
}

/* ═══ 26. Statistiche: esportare e UNIRE senza perdere nulla ═══ */
{
  const { Predictor: P } = await import('../js/lang/Predictor.js');
  const a = new P(deepClone(DEFAULT_CONFIG), null);
  a.seedPhrases(['Sì', 'No']);
  for (let i = 0; i < 5; i++) a.learnSentence('ho sete');
  a.movePhrase('No', -1);
  const ordineA = a.topPhrases(4).join('|');

  const b = new P(deepClone(DEFAULT_CONFIG), null);
  for (let i = 0; i < 8; i++) b.learnSentence('ho sete');
  for (let i = 0; i < 3; i++) b.learnSentence('chiama la mamma');

  const r = a.merge(b.serialize());
  ok(a.phrases.get('ho sete').n === 13, `26a. i conteggi si SOMMANO (5+8=${a.phrases.get('ho sete').n})`);
  ok(a.phrases.has('chiama la mamma'), '26b. le frasi nuove vengono aggiunte');
  ok(a.phrases.has('Sì') && a.phrases.has('No'), '26c. quelle esistenti non vengono perse');
  // Le frasi NUOVE non hanno ordine e si accodano: cambia la coda, non
  // le prime, che sono quelle disposte a mano su questo dispositivo.
  ok(a.topPhrases(4).join('|').startsWith(ordineA),
     '26d. l ordine deciso su QUESTO dispositivo è conservato in testa');
  ok(r.frasi > 0 && r.parole > 0, '26e. l esito dice quante voci sono state unite');

  // Unire due volte lo stesso file raddoppia i conteggi: è corretto?
  // No — ma è il comportamento atteso di una fusione additiva, e va
  // documentato. Qui si verifica solo che non produca stati illegali.
  a.merge(b.serialize());
  ok(a.phrases.get('ho sete').n === 21, '26f. una seconda unione somma ancora, senza rompere nulla');

  // Sostituire invece azzera: è la scelta esplicita dell utente
  const c = new P(deepClone(DEFAULT_CONFIG), null);
  for (let i = 0; i < 4; i++) c.learnSentence('altro testo');
  c.replaceAll(b.serialize());
  ok(!c.phrases.has('altro testo'), '26g. sostituire cancella davvero il lessico precedente');
  ok(c.phrases.get('ho sete').n === 8, '26h. e installa quello importato');

  // Dati malformati non devono far cadere nulla
  const d = new P(deepClone(DEFAULT_CONFIG), null);
  for (const cattivo of [null, undefined, {}, { phrases: null }, 'testo', 42]) {
    let err = null;
    try { d.merge(cattivo); } catch (e) { err = e.message; }
    ok(!err, `26i. dati malformati (${JSON.stringify(cattivo)}) non fanno cadere l unione`);
  }
}

/* ═══ 27. Dettatura e traduzione ═══ */
{
  const { LINGUE, spezzaPerTraduzione, conta, dettaturaDisponibile } =
    await import('../js/lang/Dictation.js');
  ok(LINGUE.length >= 6, `27a. lingue disponibili: ${LINGUE.length}`);
  ok(LINGUE.every(l => l.code && l.breve && l.nome), '27b. ogni lingua ha codice completo e breve');
  ok(LINGUE[0].code === 'it-IT', '27c. l italiano è la prima');
  ok(dettaturaDisponibile() === false, '27d. senza browser la dettatura si dichiara non disponibile');

  // Il testo lungo va spezzato: il servizio tronca oltre ~500 caratteri
  const lungo = 'Questa è una frase. '.repeat(60);
  const pezzi = spezzaPerTraduzione(lungo, 480);
  ok(pezzi.length > 1, `27e. il testo lungo viene spezzato (${pezzi.length} blocchi)`);
  ok(pezzi.every(p => p.length <= 480), '27f. nessun blocco supera il limite del servizio');
  ok(pezzi.join(' ').replace(/\s+/g, ' ').trim() === lungo.replace(/\s+/g, ' ').trim(),
     '27g. rimettendoli insieme si riottiene il testo: nulla va perso');

  // Una frase enorme senza punteggiatura non deve spezzarsi a metà parola
  const senzaPunti = 'parola '.repeat(200).trim();
  const p2 = spezzaPerTraduzione(senzaPunti, 100);
  ok(p2.every(x => x.length <= 100), '27h. anche senza punteggiatura resta nei limiti');
  ok(p2.every(x => !/^\S*$|parol$/.test(x) || x === 'parola'), '27i. non si spezza a metà parola');

  ok(spezzaPerTraduzione('', 480).length === 0, '27l. testo vuoto: nessun blocco');
  ok(conta('ciao come stai').parole === 3 && conta('').parole === 0, '27m. conteggio parole corretto');
}

/* ═══ 28. NON REGRESSIONE: le aggiunte non toccano ciò che esisteva ═══ */
{
  const { GestureEngine: GE } = await import('../js/signal/GestureEngine.js');
  // Stessa sequenza di gesti oculari, con e senza canali del viso.
  // Il risultato deve essere IDENTICO: gli occhi non devono accorgersi
  // che il viso esiste.
  function occhi(faceOn) {
    const c = deepClone(DEFAULT_CONFIG);
    c.detection.activeEye = 'left'; c.detection.faceChannels = faceOn;
    const ev = []; const g = new GE(c, e => ev.push(e));
    let tt = 0;
    const rum = () => 0.015 * Math.sin(2 * Math.PI * 4 * tt / 1000);
    const o = y => ({ x: 0, y: y + rum(), openness: 0.30, confidence: 0.9 });
    const espr = { mouthOpen: 0.03, smile: 0.02, pucker: 0.01, funnel: 0.01, cheekPuff: 0.01, browUp: 0.02 };
    const d = (ms, y) => { for (let i = 0; i < ms; i += 20) { tt += 20;
      g.process(tt, { left: o(y), right: null, espressioni: faceOn ? espr : null }); } };
    d(25000, 0);
    for (let k = 0; k < 8; k++) { d(900, -0.09); d(2500, 0); }
    d(2600, -0.09); d(2500, 0);
    d(4200, -0.09); d(2500, 0);
    return ev.map(e => `${e.action}:${Math.round(e.durMs / 50) * 50}`).join(',');
  }
  const senza = occhi(false), con = occhi(true);
  ok(senza === con, '28a. il comportamento oculare è IDENTICO con e senza canali del viso');
  ok(senza.split(',').filter(Boolean).length === 10, '28b. e tutti e dieci i gesti restano riconosciuti');
  ok(/UNDO/.test(senza) && /WAKE/.test(senza), '28c. le tre durate funzionano ancora');

  // Migrazione da OGNI versione precedente
  const { migrateConfig, validateConfig, CONFIG_VERSION } = await import('../js/core/config.js');
  let guasti = [];
  for (let v = 1; v <= CONFIG_VERSION; v++) {
    const c = migrateConfig({ version: v, scan: { stepMs: 1234 },
      audio: { ttsVoiceUri: 'X' }, signal: { thresholdOn: 4.2 } });
    if (c.version !== CONFIG_VERSION) guasti.push(`v${v}: versione`);
    if (c.scan.stepMs !== 1234) guasti.push(`v${v}: valore perso`);
    if (c.signal.thresholdOn !== 4.2) guasti.push(`v${v}: soglia persa`);
    const e = validateConfig(c);
    if (e.length) guasti.push(`v${v}: ${e[0]}`);
  }
  ok(guasti.length === 0, `28d. tutte le ${CONFIG_VERSION} versioni migrano conservando i valori: ${guasti.slice(0,3).join(' | ')}`);

  // Esporta e importa profilo: nulla si perde, nemmeno le novità
  const { exportProfile, importProfile, DEFAULT_CONFIG: DC } = await import('../js/core/config.js');
  const cfgX = deepClone(DC);
  cfgX.detection.faceChannels = true;
  cfgX.gestures.SMILE.enabled = true; cfgX.gestures.SMILE.action = 'SELECT';
  cfgX.signal.gainExpr.smile = 2.5;
  cfgX.scan.letterStepMs = 900;
  cfgX.audio.useVoiceBank = true;
  const back = importProfile(exportProfile(cfgX, { phrases: { ciao: { n: 3, last: 1 } } }));
  ok(JSON.stringify(back.config) === JSON.stringify(cfgX),
     '28e. il profilo esportato e reimportato è identico, novità comprese');
  ok(back.stats?.phrases?.ciao, '28f. e le statistiche viaggiano con lui');
}

/* ═══ 29. Autocorrezione ═══ */
{
  const { Correttore, distanza, scambioAdiacente, rispettaMaiuscole } =
    await import('../js/lang/AutoCorrect.js');
  const { Predictor: P } = await import('../js/lang/Predictor.js');

  const pred = new P(deepClone(DEFAULT_CONFIG), null);
  // I nomi propri si imparano scrivendoli: è così che il correttore
  // può recuperare "franderco" → "Francesco".
  for (let i = 0; i < 4; i++) pred.learnSentence('chiama francesco');
  const c = new Correttore(pred.lessicoPerCorrezione());
  const opt = { minLen: 3, maxDist: 2, margine: 0.12 };

  // ── Le parole che ESISTONO non si toccano MAI ──
  for (const w of ['ciao', 'dolore', 'grazie', 'mangiare', 'francesco', 'non', 'per']) {
    ok(c.correggi(w, null, opt) === null, `29a. "${w}" esiste: non viene toccata`);
  }

  // ── Errori veri vengono corretti ──
  const casi = [
    ['cao', 'ciao'], ['dolre', 'dolore'], ['grzie', 'grazie'],
    ['aiutoo', 'aiuto'], ['mangaire', 'mangiare'], ['chimare', 'chiamare'],
  ];
  for (const [sbagliata, giusta] of casi) {
    const r = c.correggi(sbagliata, null, opt);
    ok(r?.parola === giusta, `29b. "${sbagliata}" → "${giusta}" (ottenuto: ${r?.parola ?? 'nessuna correzione'})`);
  }

  // ── Il nome proprio, grazie al lessico personale ──
  const nome = c.correggi('franderco', 'chiama', opt);
  ok(nome?.parola === 'francesco',
     `29c. un nome imparato viene recuperato anche a distanza 2 (${nome?.parola})`);

  // ── ⚠️ NEL DUBBIO NON CORREGGERE: è la regola che conta di più ──
  // "sno" ha quattro vicini a una modifica — sono, suo, sto, uno — e
  // con frequenze piatte il correttore rinunciava. Ora `sono` è
  // nettamente il più comune e viene scelto: è il comportamento giusto.
  const sno = c.correggi('sno', null, opt);
  ok(sno?.parola === 'sono',
     `29d. "sno" → "sono": la frequenza rompe il pareggio (${sno?.parola ?? 'nessuna'})`);
  ok(c.correggi('sino', null, opt)?.parola === 'sono', '29d2. e anche "sino" → "sono"');
  ok(c.correggi('xyzwq', null, opt) === null, '29e. una parola senza vicini resta com è');
  ok(c.correggi('ab', null, opt) === null, '29f. parole troppo corte non si toccano');
  ok(c.correggi('casa123', null, opt) === null, '29g. le parole con numeri non si toccano');
  // Alzando la prudenza si corregge meno, mai di più
  const prudente = c.correggi('sno', null, { ...opt, margine: 0.95 });
  ok(prudente === null, '29h. alzando la prudenza al massimo anche i casi decisi si fermano');

  // ── Accenti: "perche" è "perché", non un errore da stravolgere ──
  const acc = c.correggi('perche', null, opt);
  ok(acc === null || acc.parola === 'perché',
     `29i. "perche" o resta o diventa "perché", mai altro (${acc?.parola ?? 'lasciata'})`);

  // ── Maiuscole conservate ──
  ok(rispettaMaiuscole('Cao', 'ciao') === 'Ciao', '29l. l iniziale maiuscola si conserva');
  ok(rispettaMaiuscole('CAO', 'ciao') === 'CIAO', '29m. il maiuscolo si conserva');
  const magg = c.correggi('Dolre', null, opt);
  ok(magg?.parola === 'Dolore', '29n. la correzione rispetta le maiuscole dell originale');

  // ── Il contesto scioglie le ambiguità ──
  ok(distanza('ciao', 'ciao') === 0 && distanza('cao', 'ciao') === 1, '29o. distanza di modifica corretta');
  // ⚠️ Una parola a UNA modifica batte sempre una a DUE, anche se
  // molto più rara: sbagliare due lettere è molto meno probabile.
  // Senza questa regola "cao" diventava "che", trenta volte più comune.
  ok(c.correggi('cao', null, opt)?.parola === 'ciao',
     '29o2. la distanza ha la precedenza sulla frequenza');
  ok(distanza('abcdefgh', 'zzzzzzzz', 2) > 2, '29p. uscita anticipata su parole molto diverse');
  ok(scambioAdiacente('hci', 'chi'), '29q. lo scambio di due lettere adiacenti è riconosciuto');

  // ── Correzione dell intera frase ──
  const fr = c.correggiFrase('ho dolre alla schina', opt);
  ok(fr.correzioni.length >= 1, `29r. la frase intera viene corretta (${fr.correzioni.length} parole)`);
  ok(fr.testo.includes('dolore'), `29s. risultato: "${fr.testo}"`);
  ok(c.correggiFrase('', opt).testo === '', '29t. una frase vuota non produce nulla');

  // ── Dati assurdi non fanno cadere nulla ──
  let err = null;
  try {
    for (const x of [null, undefined, '', '   ', 123, '!!!', 'a'.repeat(200)]) c.correggi(x, null, opt);
    c.correggiFrase(null, opt);
  } catch (e) { err = e.message; }
  ok(!err, '29u. dati malformati non fanno cadere il correttore: ' + (err || ''));

  // ── Spenta di default: è un aggiunta, non un cambiamento ──
  ok(DEFAULT_CONFIG.prediction.autoCorrect === false,
     '29v. l autocorrezione è SPENTA di default');
  ok(DEFAULT_CONFIG.prediction.autoCorrectMode === 'parola',
     '29z. modalità predefinita: dopo ogni parola');
}

/* ═══ 30. Autocorrezione dentro la scansione ═══ */
{
  const { Correttore } = await import('../js/lang/AutoCorrect.js');
  const { Predictor: P } = await import('../js/lang/Predictor.js');

  function banco(cfgMod) {
    const c = deepClone(DEFAULT_CONFIG);
    cfgMod?.(c);
    const pred = new P(c, null);
    const corr = new Correttore(pred.lessicoPerCorrezione());
    const detto = [];
    const e = new ScanEngine(c, {
      onOutput: (k, t2) => { if (k === 'speech') detto.push(t2); },
      onCorrect: (testo, prec, modo) => {
        if (!c.prediction.autoCorrect) return null;
        if (modo === 'parola' && c.prediction.autoCorrectMode !== 'parola') return null;
        if (modo === 'frase' && c.prediction.autoCorrectMode !== 'frase') return null;
        const opt = { minLen: 3, maxDist: 2, margine: 0.12 };
        return modo === 'frase' ? corr.correggiFrase(testo, opt) : corr.correggi(testo, prec, opt);
      },
    });
    let T = 0;
    e.start(T);
    // Si scrive una parola sbagliata e si preme spazio
    const scrivi = (parola) => {
      e.buffer.letters = parola;
      e._afterCompose(T, true);
    };
    return { e, detto, scrivi, get T() { return T; } };
  }

  // Spenta: nulla cambia
  const spenta = banco();
  spenta.scrivi('dolre');
  ok(spenta.e.buffer.words[0] === 'dolre',
     '30a. a autocorrezione spenta la parola resta esattamente come scritta');

  // Accesa, modalità parola
  const accesa = banco(c => { c.prediction.autoCorrect = true; });
  accesa.scrivi('dolre');
  ok(accesa.e.buffer.words[0] === 'dolore',
     `30b. accesa, la parola viene corretta appena finita (${accesa.e.buffer.words[0]})`);
  ok(accesa.e.ultimaCorrezione?.da === 'dolre',
     '30c. la correzione viene registrata, per poterla annullare');

  // Annullamento
  ok(accesa.e.annullaCorrezione(), '30d. la correzione si può annullare');
  ok(accesa.e.buffer.words[0] === 'dolre', '30e. e la parola torna come era stata scritta');
  ok(!accesa.e.annullaCorrezione(), '30f. annullare due volte non fa nulla');

  // Modalità frase: si corregge solo al momento di parlare
  const frase = banco(c => {
    c.prediction.autoCorrect = true;
    c.prediction.autoCorrectMode = 'frase';
  });
  frase.scrivi('ho'); frase.scrivi('dolre');
  ok(frase.e.buffer.words.join(' ') === 'ho dolre',
     '30g. in modalità frase le parole NON si correggono subito');
  frase.e.handleAction('SPEAK', frase.T);
  ok(frase.detto.some(t2 => t2.includes('dolore')),
     `30h. ma la voce pronuncia la frase corretta (${frase.detto[0]})`);

  // La voce "annulla correzione" compare solo se richiesta
  const { buildTree: bt3 } = await import('../js/scan/ScanEngine.js');
  const senza = bt3(DEFAULT_CONFIG, {});
  const azSenza = senza.children.find(x => x.id === 'write').children.find(x => x.id === 'act');
  ok(!azSenza.children.some(x => x.action === 'UNDO_CORRECT'),
     '30i. la voce "annulla correzione" non compare di default');
  const cfgU = deepClone(DEFAULT_CONFIG); cfgU.prediction.autoCorrectUndo = true;
  const conU = bt3(cfgU, {});
  const azCon = conU.children.find(x => x.id === 'write').children.find(x => x.id === 'act');
  ok(azCon.children.some(x => x.action === 'UNDO_CORRECT'),
     '30l. e compare quando la si chiede');
}

/* ═══ 31. Il modello degli errori DELLA SCANSIONE ═══ */
{
  const { Correttore: C2, mappaLettere, plausibilita } = await import('../js/lang/AutoCorrect.js');
  const { Predictor: P2 } = await import('../js/lang/Predictor.js');
  const cfg2 = deepClone(DEFAULT_CONFIG);
  const mappa = mappaLettere(cfg2.scan.groups);

  // ⚠️ Qui gli errori NON sono quelli di una tastiera. Si sceglie una
  // lettera dentro un gruppo annunciato a voce, quindi:
  //  · gesto un istante fuori tempo → lettera VICINA NELLO STESSO GRUPPO
  //  · gesto non rilevato → lettera MANCANTE
  //  · gesto contato due volte → lettera RADDOPPIATA
  //  · gruppo sbagliato → molto più raro, richiede un gesto in più
  ok(mappa.size > 20, `31a. la mappa delle lettere è costruita dai gruppi (${mappa.size})`);
  ok(plausibilita('rono', 'sono', mappa) > plausibilita('sno', 'sto', mappa),
     '31b. una sostituzione dentro lo stesso gruppo è più plausibile di una fra gruppi');
  ok(plausibilita('sno', 'sono', mappa) > 0.8,
     '31c. una lettera mancante è un errore tipico della scansione');
  ok(plausibilita('soono', 'sono', mappa) > 0.8,
     '31d. una lettera raddoppiata pure');
  ok(plausibilita('sno', 'sto', mappa) < 0.5,
     '31e. saltare in un altro gruppo è raro: richiede un gesto sbagliato in più');
  // Senza struttura non si inventa nulla: giudizio neutro
  ok(plausibilita('sno', 'sono', new Map()) === 0.75,
     '31f. senza la struttura il giudizio è neutro, non arbitrario');

  /* ── La misura che conta: quanti errori REALI vengono recuperati ──
   * Si generano errori come li produce davvero la scansione e si
   * confronta il correttore con e senza il modello.                */
  const pred2 = new P2(cfg2, null);
  const L2 = pred2.lessicoPerCorrezione();
  const gruppi = cfg2.scan.groups.map(g =>
    (g.items || []).map(c => String(c).toLowerCase()).filter(c => c !== ' ' && c !== '␣'));
  let semi = 12345;
  const rnd = () => { semi = (semi * 1103515245 + 12345) % 2147483648; return semi / 2147483648; };
  const sbaglia = (w) => {
    const t = rnd(), i = Math.floor(rnd() * w.length);
    if (t < 0.45) {
      const pos = mappa.get(w[i]); if (!pos) return null;
      const g = gruppi[pos.gruppo];
      const j = pos.indice + (rnd() < 0.5 ? -1 : 1);
      if (j < 0 || j >= g.length) return null;
      return w.slice(0, i) + g[j] + w.slice(i + 1);
    }
    if (t < 0.75) return w.slice(0, i) + w.slice(i + 1);
    if (t < 0.95) return w.slice(0, i) + w[i] + w.slice(i);
    return w.slice(0, i) + 'q' + w.slice(i + 1);
  };

  const parole = [...L2.parole()].filter(w => w.length >= 4 && w.length <= 10);
  const senzaS = new C2(L2), conS = new C2(L2, cfg2.scan.groups);
  const opt2 = { minLen: 3, maxDist: 2, margine: 0.12 };
  let tot = 0, okS = 0, okC = 0, maleS = 0, maleC = 0;
  for (const w of parole) {
    for (let k = 0; k < 3; k++) {
      const e = sbaglia(w);
      if (!e || e === w || L2.esiste(e)) continue;
      tot++;
      const a = senzaS.correggi(e, null, opt2), b = conS.correggi(e, null, opt2);
      if (a?.parola === w) okS++; else if (a) maleS++;
      if (b?.parola === w) okC++; else if (b) maleC++;
    }
  }
  ok(tot > 500, `31g. banco di prova ampio (${tot} errori realistici)`);
  ok(okC / tot > 0.85, `31h. recupera oltre l 85% degli errori reali (${(100 * okC / tot).toFixed(1)}%)`);
  ok(okC > okS, `31i. la struttura MIGLIORA il recupero (${(100 * okC / tot).toFixed(1)}% contro ${(100 * okS / tot).toFixed(1)}%)`);
  ok(maleC < maleS, `31l. e RIDUCE le correzioni sbagliate (${(100 * maleC / tot).toFixed(1)}% contro ${(100 * maleS / tot).toFixed(1)}%)`);
  ok(maleC / tot < 0.08, `31m. le correzioni sbagliate restano sotto l 8% (${(100 * maleC / tot).toFixed(1)}%)`);

  // Cambiando i gruppi cambia il modello: non è una tabella fissa
  const altro = deepClone(DEFAULT_CONFIG);
  altro.scan.groups = [{ id: 'g1', items: ['A', 'B', 'C'] }, { id: 'g2', items: ['X', 'Y', 'Z'] }];
  const c3 = new C2(L2, altro.scan.groups);
  ok(c3.mappa.get('a')?.gruppo === 0 && c3.mappa.get('x')?.gruppo === 1,
     '31n. il modello segue i gruppi scelti dall assistente, quali che siano');

  /* ── 31o. FUNZIONA CON QUALUNQUE DISPOSIZIONE ──
   * I gruppi cambiano da persona a persona: l'assistente li dispone
   * secondo ciò che quella persona riesce a fare. Il correttore deve
   * quindi lavorare bene con OGNI configurazione, non solo con quella
   * predefinita — altrimenti funzionerebbe solo per chi non la tocca. */
  const G = (a) => a.map((items, i) => ({ id: 'g' + i, items: items.split(' ') }));
  const disposizioni = {
    'predefinita': cfg2.scan.groups,
    'due gruppi grandi': G(['␣ E A I O U R S N P M', 'L C D G H F B T V Z J K W X Y Q']),
    'otto gruppi piccoli': G(['␣ E A', 'I O U', 'R S N', 'P M Q', 'L C D', 'G H F', 'B T V', 'Z J K W X Y']),
    'un gruppo unico': G(['␣ E A I O U R S N P M Q L C D G H F B T V Z J K W X Y']),
    'ordine casuale': G(['␣ Q Z W', 'E R T Y', 'U I O P', 'A S D F', 'G H J K', 'L C V B N M']),
  };
  for (const [nome, gr] of Object.entries(disposizioni)) {
    const mp = mappaLettere(gr);
    const liste = gr.map(g => g.items.map(c => String(c).toLowerCase()).filter(c => c !== ' ' && c !== '␣'));
    const alfabeto = new Set([...mp.keys()]);
    const cc = new C2(L2, gr);
    const pp = [...L2.parole()].filter(w => w.length >= 4 && w.length <= 10 && [...w].every(ch => alfabeto.has(ch)));
    let semi3 = 999;
    const r3 = () => { semi3 = (semi3 * 1103515245 + 12345) % 2147483648; return semi3 / 2147483648; };
    let t3 = 0, o3 = 0, m3 = 0;
    for (const w of pp) {
      for (let k = 0; k < 3; k++) {
        const tt = r3(), i = Math.floor(r3() * w.length);
        let e = null;
        if (tt < 0.45) {
          const pos = mp.get(w[i]);
          if (pos) { const g = liste[pos.gruppo]; const j = pos.indice + (r3() < 0.5 ? -1 : 1);
            if (j >= 0 && j < g.length) e = w.slice(0, i) + g[j] + w.slice(i + 1); }
        } else if (tt < 0.75) e = w.slice(0, i) + w.slice(i + 1);
        else e = w.slice(0, i) + w[i] + w.slice(i);
        if (!e || e === w || L2.esiste(e)) continue;
        t3++;
        const rr = cc.correggi(e, null, opt2);
        if (rr?.parola === w) o3++; else if (rr) m3++;
      }
    }
    ok(t3 > 20 && o3 / t3 > 0.80,
       `31o. "${nome}": recupera l ${(100 * o3 / t3).toFixed(1)}% degli errori`);
    ok(m3 / t3 < 0.10,
       `31p. "${nome}": correzioni sbagliate sotto il 10% (${(100 * m3 / t3).toFixed(1)}%)`);
  }

  /* ── 31q. Configurazioni malformate non devono far cadere nulla ──
   * I gruppi arrivano dalla configurazione, che può essere importata da
   * un altro dispositivo, scritta a mano, o venire da una versione
   * diversa del programma. */
  const rotte = [
    ['gruppi assenti', null], ['non un array', 'testo'], ['un numero', 42],
    ['oggetti nulli dentro', [null, undefined, { items: ['A'] }, 'testo']],
    ['items non array', [{ id: 'a', items: 'ABC' }]],
    ['valori nulli negli items', [{ id: 'a', items: ['A', null, undefined, 'B'] }]],
    ['digrammi', [{ id: 'a', items: ['CH', 'A', 'GL', 'B'] }]],
    ['solo spazio', [{ id: 'a', items: ['␣'] }]],
  ];
  for (const [nome, gr] of rotte) {
    let err2 = null, ris = null;
    try {
      const cc = new C2(L2, gr);
      ris = cc.correggi('dolre', null, opt2);
      cc.setGruppi(gr);
      mappaLettere(gr);
    } catch (e) { err2 = e.message; }
    ok(!err2, `31q. "${nome}" non fa cadere il correttore: ${err2 || ''}`);
    ok(ris?.parola === 'dolore', `31r. "${nome}": corregge lo stesso, ignorando la struttura guasta`);
  }

  // Una lettera presente in due gruppi: vince il primo, che è quello
  // raggiungibile con meno gesti.
  const dupl = mappaLettere([{ id: 'a', items: ['A', 'B'] }, { id: 'b', items: ['A', 'C'] }]);
  ok(dupl.get('a')?.gruppo === 0, '31s. una lettera in due gruppi: vale la prima posizione');
}

/* ═══ 32. Radio online ═══ */
{
  const { buildTree: bt4 } = await import('../js/scan/ScanEngine.js');

  // Spenta: non deve comparire da nessuna parte
  const spenta = deepClone(DEFAULT_CONFIG);
  spenta.radio.stazioni = [{ nome: 'Radio Uno', url: 'https://x/1' }];
  const t1 = bt4(spenta, { library: {} });
  ok(!t1.children.some(x => x.id === 'library'),
     '32a. a radio spenta e libreria vuota il ramo media non compare');

  const accesa = deepClone(DEFAULT_CONFIG);
  accesa.radio.enabled = true;
  accesa.radio.stazioni = [
    { nome: 'Radio Uno', url: 'https://x/1' },
    { nome: 'Radio Classica', url: 'https://x/2' },
  ];
  const t2 = bt4(accesa, { library: {} });
  const media = t2.children.find(x => x.id === 'library');
  ok(!!media, '32b. accesa, il ramo media compare');
  const staz = media.children.filter(x => x.action === 'RADIO_OPEN');
  ok(staz.length === 2, `32c. le stazioni sono nell elenco (${staz.length})`);
  ok(staz[0].label === 'Radio Uno', '32d. con il nome dato dall assistente');
  ok(staz[0].payload?.stazione?.url === 'https://x/1', '32e. e il proprio indirizzo');

  // Stazioni incomplete vengono scartate invece di produrre voci rotte
  const parziale = deepClone(DEFAULT_CONFIG);
  parziale.radio.enabled = true;
  parziale.radio.stazioni = [
    { nome: 'Buona', url: 'https://x/1' },
    { nome: 'Senza indirizzo' },
    { url: 'https://x/3' },
    null,
  ];
  const t3 = bt4(parziale, { library: {} });
  const s3 = t3.children.find(x => x.id === 'library')
    ?.children.filter(x => x.action === 'RADIO_OPEN') || [];
  ok(s3.length === 1, `32f. le stazioni incomplete vengono scartate (${s3.length} valida)`);

  // Con anche altri media, la radio resta una categoria a sé
  const misto = deepClone(DEFAULT_CONFIG);
  misto.radio.enabled = true;
  misto.radio.stazioni = [{ nome: 'Radio Uno', url: 'https://x/1' }];
  const t4 = bt4(misto, { library: { audios: [{ title: 'Canzone', file: {} }] } });
  const cat = t4.children.find(x => x.id === 'library').children.map(x => x.label);
  ok(cat.includes('RADIO') && cat.includes('AUDIO'),
     `32g. radio e altri media convivono come categorie distinte (${cat.join(' · ')})`);
  ok(cat.indexOf('RADIO') < cat.indexOf('AUDIO'),
     '32h. la radio viene per prima: è la scelta più frequente, deve costare meno gesti');
}

/* ═══ 33. Invio di posta ═══ */
{
  const { verificaConfigurazione, indirizzoValido, invia } = await import('../js/lang/Mailer.js');

  ok(indirizzoValido('mario@esempio.it'), '33a. un indirizzo valido è riconosciuto');
  for (const cattivo of ['', 'mario', 'mario@', '@esempio.it', 'mario esempio.it', null]) {
    ok(!indirizzoValido(cattivo), `33b. "${cattivo}" è riconosciuto come non valido`);
  }

  // ⚠️ La configurazione va verificata PRIMA di provare a spedire:
  // fallire quando la persona ha appena finito di scrivere una lettera
  // è il momento peggiore per scoprire che manca un campo.
  const vuota = deepClone(DEFAULT_CONFIG);
  ok(!verificaConfigurazione(vuota).ok, '33c. spenta: la configurazione non è pronta');
  vuota.email.enabled = true;
  ok(verificaConfigurazione(vuota).problemi.some(p => /servizio/.test(p)),
     '33d. accesa senza indirizzo: lo dice');
  vuota.email.endpoint = 'https://esempio.it/invia';
  ok(verificaConfigurazione(vuota).problemi.some(p => /destinatario/.test(p)),
     '33e. senza destinatari: lo dice');
  vuota.email.contatti = [{ nome: 'Mario', indirizzo: 'non-valido' }];
  ok(!verificaConfigurazione(vuota).ok, '33f. un destinatario con indirizzo storto non basta');
  vuota.email.contatti = [{ nome: 'Mario', indirizzo: 'mario@esempio.it' }];
  const v = verificaConfigurazione(vuota);
  ok(v.ok && v.contatti.length === 1, '33g. con tutto a posto la configurazione è pronta');

  // L'invio non deve MAI sollevare eccezioni: chi chiama deve poter
  // mostrare l'esito senza doversi difendere.
  const dest = { nome: 'Mario', indirizzo: 'mario@esempio.it' };
  let err = null, esiti = [];
  const fetchVero = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200 });
    esiti.push(await invia(vuota, { destinatario: dest, testo: 'ciao' }));
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    esiti.push(await invia(vuota, { destinatario: dest, testo: 'ciao' }));
    globalThis.fetch = async () => { throw new Error('rete assente'); };
    esiti.push(await invia(vuota, { destinatario: dest, testo: 'ciao' }));
    esiti.push(await invia(vuota, { destinatario: dest, testo: '   ' }));
    esiti.push(await invia(vuota, { destinatario: { indirizzo: 'x' }, testo: 'ciao' }));
    esiti.push(await invia(deepClone(DEFAULT_CONFIG), { destinatario: dest, testo: 'ciao' }));
  } catch (e) { err = e.message; } finally { globalThis.fetch = fetchVero; }
  ok(!err, '33h. l invio non solleva mai eccezioni: ' + (err || ''));
  ok(esiti[0]?.ok === true, '33i. invio riuscito riconosciuto');
  ok(esiti[1]?.ok === false && /500/.test(esiti[1].messaggio), '33l. errore del servizio riportato');
  ok(esiti[2]?.ok === false && /connessione/.test(esiti[2].messaggio), '33m. rete assente spiegata in parole');
  ok(esiti[3]?.ok === false && /vuoto/.test(esiti[3].messaggio), '33n. un messaggio vuoto non parte');
  ok(esiti[4]?.ok === false, '33o. un destinatario storto non parte');
  ok(esiti[5]?.ok === false, '33p. a funzione spenta non parte nulla');

  // ⚠️ Nessuna credenziale deve MAI finire nella configurazione: è
  // leggibile da chiunque apra gli strumenti di sviluppo.
  const chiavi = Object.keys(DEFAULT_CONFIG.email);
  ok(!chiavi.some(k => /pass|pwd|token|secret|key/i.test(k)),
     `33q. la configurazione non prevede alcuna credenziale (${chiavi.join(', ')})`);
  ok(DEFAULT_CONFIG.email.conferma === true,
     '33r. la conferma prima di spedire è attiva di default: un messaggio non torna indietro');
  ok(DEFAULT_CONFIG.email.enabled === false && DEFAULT_CONFIG.radio.enabled === false,
     '33s. entrambe le funzioni sono spente di default');

  /* ── La voce MANDA compare solo quando può funzionare ── */
  const { buildTree: bt5 } = await import('../js/scan/ScanEngine.js');
  const cfgM = deepClone(DEFAULT_CONFIG);
  const bozze = { drafts: [{ id: '1', title: 'Lettera' }] };
  const azioniDi = (c) => bt5(c, bozze).children.find(x => x.id === 'drafts')
    ?.children.find(x => x.label === 'Lettera')?.children.map(x => x.label) || [];

  ok(!azioniDi(cfgM).includes('MANDA'), '33t. a posta spenta la voce MANDA non compare');
  cfgM.email.enabled = true;
  ok(!azioniDi(cfgM).includes('MANDA'),
     '33u. accesa ma senza destinatari nemmeno: una voce che non può fare nulla costa solo tempo');
  cfgM.email.contatti = [{ nome: 'Mario', indirizzo: 'm@e.it' }, { nome: 'Anna', indirizzo: 'a@e.it' }];
  ok(azioniDi(cfgM).includes('MANDA'), '33v. con i destinatari compare');
  const manda = bt5(cfgM, bozze).children.find(x => x.id === 'drafts')
    .children.find(x => x.label === 'Lettera').children.find(x => x.label === 'MANDA');
  // Ogni destinatario porta a una CONFERMA, non spedisce subito.
  const dest2 = manda.children.filter(x => x.kind === 'group');
  ok(dest2.length === 2, `33z. e ogni destinatario è una voce (${dest2.map(x => x.label).join(', ')})`);
  const conferma = dest2[0].children.find(x => x.action === 'DRAFT_EMAIL');
  ok(conferma?.payload?.contatto?.indirizzo === 'm@e.it', '33aa. con il proprio indirizzo');
}

/* ═══ 34. Ascoltare media con la voce di guida in pausa ═══ */
{
  function banco(mod) {
    const c = deepClone(DEFAULT_CONFIG);
    mod?.(c);
    const ann = [];
    const e = new ScanEngine(c, {
      onOutput: (k, t2) => { ann.push(`${k}:${t2}`); return null; },
      onBuffer: () => {}, onDraft: () => {}, onRadio: () => {},
    });
    let T = 1000; e.start(T);
    return { e, ann, fai: (a) => { T += 2000; e.handleAction(a, T); }, tick: () => { T += 2000; e.tick(T); } };
  }

  // ── Mettere in pausa la voce e riprenderla: deve funzionare ──
  const b = banco();
  b.fai('PAUSE');
  ok(b.e.paused, '34a. la voce di guida si può mettere in pausa con un gesto');
  const n1 = b.ann.length;
  b.tick(); b.tick(); b.tick();
  ok(b.ann.length === n1, '34b. in pausa la scansione NON annuncia: si ascolta in pace');
  b.fai('WAKE');
  ok(!b.e.paused, '34c. e si riprende con il gesto dedicato');

  // ── Il problema dell ascolto: una selezione involontaria ──
  const acceso = banco();
  acceso.fai('PAUSE');
  acceso.fai('SELECT');
  ok(!acceso.e.paused,
     '34d. di default una selezione risveglia: comodo, ma sopra la musica è un guaio');

  const spento = banco(c => { c.scan.selectWakes = false; });
  spento.fai('PAUSE');
  spento.fai('SELECT');
  ok(spento.e.paused,
     '34e. con "selezione risveglia" spento, un gesto involontario NON interrompe l ascolto');
  spento.fai('NEXT');
  ok(spento.e.paused, '34f. e nemmeno gli altri gesti ordinari');
  spento.fai('WAKE');
  ok(!spento.e.paused, '34g. mentre il gesto dedicato riprende sempre');

  // ── ⚠️ LA RETE DI SICUREZZA ──
  // Senza nessun gesto di risveglio acceso, la persona resterebbe
  // chiusa fuori dal proprio programma: muta, e senza modo di dirlo.
  const senzaUscita = banco(c => {
    c.scan.selectWakes = false;
    for (const k of Object.keys(c.gestures)) {
      const g = c.gestures[k];
      if (g && typeof g === 'object' && (g.action === 'WAKE' || g.action === 'TOGGLE_PAUSE')) g.enabled = false;
    }
  });
  senzaUscita.fai('PAUSE');
  senzaUscita.fai('SELECT');
  ok(!senzaUscita.e.paused,
     '34h. senza gesti di risveglio la selezione risveglia COMUNQUE: nessuno resta chiuso fuori');

  ok(DEFAULT_CONFIG.scan.selectWakes === true,
     '34i. il comportamento predefinito è quello di sempre: l opzione è additiva');

  // ── Cambiare stazione durante l ascolto costa un gesto ──
  const conRadio = deepClone(DEFAULT_CONFIG);
  conRadio.radio.enabled = true;
  conRadio.radio.stazioni = [
    { nome: 'Radio Uno', url: 'https://x/1' },
    { nome: 'Radio Due', url: 'https://x/2' },
  ];
  const { buildTree: bt6 } = await import('../js/scan/ScanEngine.js');
  const media = bt6(conRadio, { library: {} }).children.find(x => x.id === 'library');
  const staz = media.children.filter(x => x.action === 'RADIO_OPEN');
  ok(staz.length === 2,
     '34l. le stazioni stanno tutte allo stesso livello: cambiarne una costa un gesto');
}

/* ═══ 35. Domotica e stampa ═══ */
{
  const { MODELLI, entitaValida, dominioDi, comandiDi, verificaDomotica, comanda, provaConnessione } =
    await import('../js/device/HomeAssistant.js');
  const { buildTree: bt7 } = await import('../js/scan/ScanEngine.js');

  ok(entitaValida('media_player.tv_salotto'), '35a. un identificativo valido è riconosciuto');
  for (const x of ['tv', 'TV.salotto', 'media_player', '', null, 'media player.tv']) {
    ok(!entitaValida(x), `35b. "${x}" è riconosciuto come non valido`);
  }
  ok(dominioDi('light.camera') === 'light', '35c. il dominio si ricava dall identificativo');

  // I comandi si deducono dal TIPO: chi configura non deve saperli
  ok(comandiDi({ entita: 'media_player.tv' }).some(c => c.servizio === 'volume_up'),
     '35d. un televisore ha i comandi del volume senza doverli scrivere');
  ok(comandiDi({ entita: 'light.camera' }).length === 2,
     '35e. una luce ha solo accendi e spegni');
  ok(comandiDi({ entita: 'cover.tapparella' }).some(c => c.servizio === 'open_cover'),
     '35f. una tapparella ha apri, chiudi e ferma');
  ok(comandiDi({ entita: 'sconosciuto.cosa' }).length === 0,
     '35g. un tipo non riconosciuto non inventa comandi');
  const propri = comandiDi({ entita: 'light.x', comandi: [{ nome: 'Mio', servizio: 'turn_on' }] });
  ok(propri.length === 1 && propri[0].nome === 'Mio',
     '35h. i comandi scritti a mano hanno la precedenza');

  // Verifica della configurazione PRIMA dell uso
  const c = deepClone(DEFAULT_CONFIG);
  ok(!verificaDomotica(c).ok, '35i. spenta: non è pronta');
  c.domotica.enabled = true;
  ok(verificaDomotica(c).problemi.some(p => /indirizzo/.test(p)), '35l. senza indirizzo lo dice');
  c.domotica.url = 'http://ha.local:8123';
  ok(verificaDomotica(c).problemi.some(p => /gettone/.test(p)), '35m. senza gettone lo dice');
  c.domotica.token = 'x'.repeat(40);
  ok(verificaDomotica(c).problemi.some(p => /dispositiv/.test(p)), '35n. senza dispositivi lo dice');
  c.domotica.dispositivi = [{ nome: 'Televisore', entita: 'media_player.tv_salotto' }];
  ok(verificaDomotica(c).ok, '35o. con tutto a posto è pronta');

  // I comandi non devono MAI sollevare eccezioni
  const fetchVero = globalThis.fetch;
  let err = null; const esiti = [];
  const tv = c.domotica.dispositivi[0];
  const cmd = { nome: 'Accendi', servizio: 'turn_on' };
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200 });
    esiti.push(await comanda(c, tv, cmd));
    globalThis.fetch = async () => ({ ok: false, status: 401 });
    esiti.push(await comanda(c, tv, cmd));
    globalThis.fetch = async () => { throw new Error('rete'); };
    esiti.push(await comanda(c, tv, cmd));
    esiti.push(await comanda(deepClone(DEFAULT_CONFIG), tv, cmd));
    esiti.push(await comanda(c, { nome: 'x', entita: 'rotto' }, cmd));
    await provaConnessione(c);
  } catch (e) { err = e.message; } finally { globalThis.fetch = fetchVero; }
  ok(!err, '35p. i comandi non sollevano mai eccezioni: ' + (err || ''));
  ok(esiti[0]?.ok === true, '35q. comando riuscito');
  ok(esiti[1]?.ok === false && /gettone/.test(esiti[1].messaggio),
     '35r. un gettone scaduto viene spiegato in parole');
  ok(esiti[2]?.ok === false && /rete/.test(esiti[2].messaggio),
     '35s. Home Assistant irraggiungibile: si suggerisce la causa');
  ok(esiti[3]?.ok === false, '35t. a domotica spenta non parte nulla');
  ok(esiti[4]?.ok === false, '35u. un identificativo storto non parte');

  /* ── Dove compaiono le voci ── */
  const cfgD = deepClone(DEFAULT_CONFIG);
  const ctx = { library: {}, drafts: [{ id: '1', title: 'Lettera' }] };
  const mediaDi = (x) => bt7(x, ctx).children.find(y => y.id === 'library');
  const azioniDi = (x) => bt7(x, ctx).children.find(y => y.id === 'drafts')
    ?.children.find(y => y.label === 'Lettera')?.children.map(y => y.label) || [];

  ok(!mediaDi(cfgD), '35v. a domotica spenta la voce CASA non compare');
  ok(!azioniDi(cfgD).includes('STAMPA'), '35z. a stampa spenta la voce STAMPA non compare');

  cfgD.domotica = { enabled: true, url: 'http://ha:8123', token: 'x'.repeat(40),
    dispositivi: [{ nome: 'Televisore', entita: 'media_player.tv' }, { nome: 'Luce', entita: 'light.c' }] };
  const media2 = mediaDi(cfgD);
  ok(!!media2, '35aa. accesa, la voce compare nei MEDIA — è lì che si va per "guardare qualcosa"');
  const televisore = media2.children.find(x => x.label === 'Televisore');
  ok(!!televisore, '35ab. ogni dispositivo è una voce');
  const suoi = televisore.children.filter(x => x.action === 'CASA_COMANDO');
  ok(suoi.length >= 5, `35ac. con i suoi comandi (${suoi.map(x => x.label).join(', ')})`);
  ok(suoi[0].payload?.dispositivo?.entita === 'media_player.tv', '35ad. e il proprio identificativo');

  cfgD.stampa.enabled = true;
  const az = azioniDi(cfgD);
  ok(az.includes('STAMPA'), '35ae. accesa, STAMPA compare nell archivio dei testi');
  cfgD.email.enabled = true;
  cfgD.email.endpoint = 'https://x';
  cfgD.email.contatti = [{ nome: 'Mario', indirizzo: 'm@e.it' }];
  const az2 = azioniDi(cfgD);
  ok(az2.includes('STAMPA') && az2.includes('MANDA'),
     `35af. stampa e posta convivono nello stesso menu (${az2.join(' · ')})`);

  // Dispositivi incompleti scartati invece di produrre voci rotte
  cfgD.domotica.dispositivi = [
    { nome: 'Buono', entita: 'light.a' }, { nome: 'Senza entità' }, { entita: 'light.b' }, null,
  ];
  const validi = mediaDi(cfgD).children.filter(x => x.kind === 'group' && x.label === 'Buono');
  ok(validi.length === 1, '35ag. i dispositivi incompleti vengono scartati');

  ok(DEFAULT_CONFIG.domotica.enabled === false && DEFAULT_CONFIG.stampa.enabled === false,
     '35ah. entrambe spente di default');
  ok(DEFAULT_CONFIG.stampa.conferma === true,
     '35ai. la conferma prima di stampare è attiva: un gesto involontario non deve far partire una stampa');
  // ⚠️ Il gettone è una chiave di casa: deve stare solo dove serve
  ok(Object.keys(MODELLI).length >= 4, `35al. tipi di dispositivo riconosciuti: ${Object.keys(MODELLI).join(', ')}`);
}

/* ═══ 36. Nessuna azione può bloccare chi non può cliccare ═══ */
{
  const { buildTree: bt8 } = await import('../js/scan/ScanEngine.js');
  const c = deepClone(DEFAULT_CONFIG);
  c.stampa.enabled = true;
  c.email.enabled = true; c.email.endpoint = 'https://x';
  c.email.contatti = [{ nome: 'Mario', indirizzo: 'm@e.it' }];
  const testo = bt8(c, { drafts: [{ id: '1', title: 'Lettera' }] })
    .children.find(x => x.id === 'drafts').children.find(x => x.label === 'Lettera');

  /* ⚠️ IL PUNTO PIÙ IMPORTANTE DI QUESTA SUITE.
   *
   * Un dialogo del browser (`confirm`) blocca la pagina e si chiude
   * solo con un clic. Chi usa Aurora non può cliccare: resterebbe
   * bloccato davanti a una finestra che non sa chiudere, senza voce e
   * senza modo di chiedere aiuto.
   *
   * Ogni azione irreversibile raggiungibile con un gesto deve quindi
   * avere la sua conferma DENTRO la scansione, come voce del menu. */
  const irreversibili = [
    ['ELIMINA', 'CONFERMA ELIMINA'],
    ['STAMPA', 'CONFERMA STAMPA'],
  ];
  for (const [voce, conferma] of irreversibili) {
    const n = testo.children.find(x => x.label === voce);
    ok(n && n.kind === 'group', `36a. "${voce}" è un sottomenu, non un'azione immediata`);
    ok(n.children.some(x => x.label === conferma),
       `36b. "${voce}" chiede conferma dentro la scansione`);
    ok(n.children.some(x => x.action === 'BACK'),
       `36c. "${voce}" si può annullare con lo stesso gesto`);
  }
  const manda = testo.children.find(x => x.label === 'MANDA');
  const mario = manda.children.find(x => x.label === 'Mario');
  ok(mario?.kind === 'group', '36d. anche il destinatario porta a una conferma');
  ok(mario.children.some(x => x.label === 'CONFERMA INVIO'), '36e. "CONFERMA INVIO" è nella scansione');
  ok(mario.children.some(x => x.action === 'BACK'), '36f. e si può tornare indietro');

  /* Le azioni devono arrivare all'applicazione GIÀ confermate: dopo
   * che la scansione ha chiesto, non deve aprirsi nessun dialogo. Si
   * verifica sul codice, perché è lì che la promessa va mantenuta. */
  const fs4 = await import('node:fs');
  const path4 = await import('node:path');
  const qui4 = path4.dirname(import.meta.filename || process.argv[1]);
  const motore = fs4.readFileSync(path4.join(qui4, '..', 'js/scan/ScanEngine.js'), 'utf8');
  const app4 = fs4.readFileSync(path4.join(qui4, '..', 'js/main.js'), 'utf8');

  ok(/onDraft\??\.?\('delete',\s*\{[^}]*confermato:\s*true/.test(motore),
     '36g. l eliminazione parte dalla scansione già confermata');
  ok(/onPrint\?\.\([^)]*,\s*true\)/.test(motore), '36h. e così la stampa');
  ok(/onEmail\?\.\([^)]*,\s*true\)/.test(motore), '36i. e l invio');

  // E l'applicazione deve rispettare quel flag, saltando il dialogo.
  ok(/!arg\.confermato\s*&&\s*!confirm/.test(app4),
     '36l. l eliminazione salta il dialogo quando arriva già confermata');
  ok(/&&\s*!giaConfermato/.test(app4),
     '36m. e così invio e stampa');

  /* ⚠️ La stampa non deve MAI aprire una finestra nuova: il fuoco
   * andrebbe altrove e chi non può muoversi non potrebbe più tornare
   * ad Aurora — resterebbe senza voce davanti a una pagina che non sa
   * chiudere. Si stampa da un riquadro nascosto nella stessa pagina. */
  const iStampa = app4.indexOf('stampa(testo, id');
  const bloccoStampa = app4.slice(iStampa, app4.indexOf('/* ------------------------- Autocorrezione', iStampa));
  ok(!/window\.open/.test(bloccoStampa),
     '36n. la stampa NON apre finestre nuove: si resta dentro Aurora');
  ok(/printFrame/.test(bloccoStampa) && /iframe/.test(bloccoStampa),
     '36o. stampa da un riquadro nascosto nella stessa pagina');
  ok(/watchdog\?\.ferma\(\)/.test(bloccoStampa),
     '36p. la sorveglianza viene sospesa: la finestra di stampa ferma i tempi del browser');
  ok(/watchdog\?\.avvia/.test(bloccoStampa),
     '36q. e riprende appena finito');
}

/* ═══ 37. Mouse del sistema, finestra in primo piano, secondo piano ═══ */
{
  const { DeviceLink } = await import('../js/device/DeviceLink.js');
  const { finestraSupportata, FinestraFluttuante } = await import('../js/ui/FloatWindow.js');
  const { pompaFotogrammiSupportata } = await import('../js/vision/FrameSource.js');

  const banco = (mod) => {
    const c = deepClone(DEFAULT_CONFIG);
    mod?.(c);
    const inviati = [];
    const d = new DeviceLink(c, () => {});
    Object.defineProperty(d, 'connected', { value: true, configurable: true });
    d.send = async (l) => { inviati.push(l); return true; };
    return { d, inviati, c };
  };

  /* ── ⚠️ SPENTO: nulla cambia ── */
  ok(DEFAULT_CONFIG.device.mouse.enabled === false, '37a. il mouse di sistema è SPENTO di default');
  ok(DEFAULT_CONFIG.source.backgroundMode === false, '37b. il funzionamento a finestra nascosta è SPENTO');
  {
    const b = banco();
    await b.d.mouseMove(10, 10); await b.d.mouseClick(1);
    await b.d.mouseScroll(3); await b.d.mouseFromPointer(0.2, 0.8);
    ok(b.inviati.length === 0, '37c. a mouse spento NESSUN comando viene inviato');
  }

  /* ── Il protocollo ── */
  {
    const b = banco(c => { c.device.mouse.enabled = true; });
    await b.d.mouseMove(12, -7);
    await b.d.mouseClick(1); await b.d.mouseClick(2); await b.d.mouseClick(3);
    await b.d.mouseDoubleClick(1);
    await b.d.mouseHold(1, true); await b.d.mouseHold(1, false);
    await b.d.mouseScroll(3); await b.d.mouseScroll(-3);
    const atteso = ['M 12 -7', 'C 1', 'C 2', 'C 3', 'K 1', 'T 1 1', 'T 1 0', 'W 3', 'W -3'];
    ok(b.inviati.join('|') === atteso.join('|'),
       `37d. il protocollo genera i comandi attesi (${b.inviati.join(' ')})`);
  }

  /* ── Sicurezza: nessun comando assurdo può uscire ── */
  {
    const b = banco(c => { c.device.mouse.enabled = true; c.device.mouse.maxStep = 40; });
    await b.d.mouseMove(9999, -9999);
    ok(b.inviati[0] === 'M 40 -40',
       `37e. uno scatto del puntatore viene limitato al passo massimo (${b.inviati[0]})`);
    await b.d.mouseClick(99);
    ok(b.inviati[1] === 'C 3', '37f. un pulsante inesistente viene ricondotto nei limiti');
    const n = b.inviati.length;
    await b.d.mouseMove(0, 0);
    ok(b.inviati.length === n, '37g. uno spostamento nullo non genera traffico inutile');
  }

  /* ── Dal puntatore al mouse: relativo, non assoluto ── */
  {
    const b = banco(c => { c.device.mouse.enabled = true; c.device.mouse.sensitivity = 1000; });
    b.d.resetMouseOrigin();
    await b.d.mouseFromPointer(0.5, 0.5);
    ok(b.inviati.length === 0, '37h. il primo campione fissa l origine e non muove nulla');
    await b.d.mouseFromPointer(0.55, 0.52);
    ok(b.inviati[0] === 'M 50 20', `37i. poi manda la DIFFERENZA, non la posizione (${b.inviati[0]})`);
    const n = b.inviati.length;
    await b.d.mouseFromPointer(0.5501, 0.5201);
    ok(b.inviati.length === n,
       '37l. il tremore oculare sotto un passo intero non muove il cursore');
  }

  /* ── Inversioni ── */
  {
    const b = banco(c => {
      c.device.mouse.enabled = true;
      c.device.mouse.invertX = true; c.device.mouse.invertY = true; c.device.mouse.invertScroll = true;
    });
    await b.d.mouseMove(10, 10); await b.d.mouseScroll(2);
    ok(b.inviati[0] === 'M -10 -10' && b.inviati[1] === 'W -2',
       `37m. le inversioni funzionano (${b.inviati.join(' ')})`);
  }

  /* ── Robustezza ── */
  {
    const b = banco(c => { c.device.mouse.enabled = true; });
    let err = null;
    try {
      await b.d.mouseMove(NaN, NaN);
      await b.d.mouseFromPointer(NaN, 0.5);
      await b.d.mouseFromPointer(undefined, undefined);
      await b.d.mouseScroll(0);
    } catch (e) { err = e.message; }
    ok(!err, '37n. valori assurdi non fanno cadere il collegamento: ' + (err || ''));
  }

  /* ── Finestra in primo piano e funzionamento nascosto ── */
  ok(typeof finestraSupportata === 'function' && finestraSupportata() === false,
     '37o. senza browser la finestra si dichiara non disponibile invece di rompersi');
  ok(typeof pompaFotogrammiSupportata === 'function' && pompaFotogrammiSupportata() === false,
     '37p. e così il funzionamento a finestra nascosta');
  {
    const f = new FinestraFluttuante({});
    ok(f.aperta === false, '37q. la finestra parte chiusa');
    const r = await f.apri(null);
    ok(r.ok === false && /Chrome|pannello/.test(r.motivo),
       '37r. l apertura fallita spiega il motivo invece di sollevare un errore');
    let err2 = null;
    try { f.chiudi(); f.chiudi(); f._riporta(); } catch (e) { err2 = e.message; }
    ok(!err2, '37s. chiudere più volte non fa danni: ' + (err2 || ''));
  }

  // Migrazione: chi aggiorna non deve trovarsi funzioni accese a sua insaputa
  const { migrateConfig: mc2 } = await import('../js/core/config.js');
  const vecchia = mc2({ version: 28, device: {}, source: {} });
  ok(vecchia.device.mouse.enabled === false && vecchia.source.backgroundMode === false,
     '37t. aggiornando da una versione precedente le nuove funzioni restano spente');
}

/* ═══ 38. I programmi per il mouse parlano lo stesso protocollo ═══ */
{
  const fs7 = await import('node:fs');
  const path7 = await import('node:path');
  const qui7 = path7.dirname(import.meta.filename || process.argv[1]);
  const leggi = (f) => fs7.readFileSync(path7.join(qui7, '..', f), 'utf8');

  const py = leggi('strumenti/aurora-mouse.py');
  const ino = leggi('strumenti/aurora-esp32.ino');
  const ps1 = leggi('strumenti/aurora-mouse.ps1');

  // ⚠️ Se Aurora e il programma non parlassero la stessa lingua, il
  // difetto si scoprirebbe solo con la persona davanti al computer.
  for (const c of ['M', 'C', 'K', 'T', 'W']) {
    ok(new RegExp(`cmd == '${c}'`).test(py), `38a. il programma Python riconosce "${c}"`);
    ok(new RegExp(`cmd == '${c}'`).test(ino), `38b. e così la scheda ESP32`);
    ok(new RegExp(`'${c}' \\{`).test(ps1), `38b2. e il ponte Windows, che non richiede installazioni`);
  }

  /* ── La scheda deve fare ANCHE il braccio robotico ──
   * È il motivo per cui quella strada esiste: il computer non ha
   * uscite per servomotori, la scheda sì. */
  for (const c of ['P', 'D', 'G', 'B', 'H']) {
    ok(new RegExp(`cmd == '${c}'`).test(ino), `38b3. la scheda esegue il comando "${c}" del braccio`);
  }
  ok(/BRACCIO_COLLEGATO/.test(ino),
     '38b4. e funziona come solo mouse se il braccio non c è');
  ok(/MIN_BASE|MAX_SPAL/.test(ino),
     '38b5. con limiti di corsa: un servomotore spinto oltre si rovina, e il braccio può ferire');
  ok(/muoviPiano|GRADI_PER_PASSO/.test(ino),
     '38b6. e movimento graduale: uno scatto sarebbe pericoloso');

  /* ── Protezioni: chi usa questo ponte non può prendere il mouse e
   * rimetterlo a posto se qualcosa va storto. ── */
  ok(/127\.0\.0\.1/.test(py), '38c. il ponte ascolta SOLO dal computer locale');
  ok(/MAX_PIXEL_AL_SECONDO/.test(py) && /MAX_PIXEL_AL_SECONDO/.test(ino),
     '38d. entrambi limitano quanto il cursore può muoversi in un secondo');
  ok(/MAX_PASSO/.test(py) && /MAX_PASSO/.test(ino),
     '38e. e limitano il singolo comando: due difese indipendenti');
  ok(/finally[\s\S]{0,400}mouseUp/.test(py),
     '38f. cadendo il collegamento i pulsanti vengono rilasciati: un pulsante premuto renderebbe il computer inutilizzabile');
  ok(/release\(MOUSE_MIDDLE\)/.test(ino), '38g. e lo stesso fa l arresto sulla scheda');
  ok(/FAILSAFE = True/.test(py), '38h. il mouse in un angolo ferma tutto');
  ok(/127\.0\.0\.1/.test(ps1), '38h2. anche il ponte Windows ascolta solo dal computer locale');
  ok(/Rilascia-Tutto/.test(ps1) && /finally/.test(ps1),
     '38h3. e rilascia i pulsanti quando il collegamento cade');
  ok(/MaxPixelAlSecondo/.test(ps1), '38h4. con lo stesso limite di velocità');

  // Il ponte usa l'indirizzo che Aurora si aspetta
  ok(py.includes('8089') && ps1.includes('8089')
     && DEFAULT_CONFIG.device.bridgeUrl.includes('8089'),
     '38i. tutti i ponti e Aurora usano la stessa porta');
  ok(py.includes('/device') && DEFAULT_CONFIG.device.bridgeUrl.includes('/device'),
     '38l. e lo stesso percorso');

  // I comandi del braccio non devono dare errore sullo stesso ponte
  ok(/'P', 'D', 'G', 'B', 'H', 'S'/.test(py), '38m. i comandi del braccio vengono ignorati senza errori');
}

/* ═══ 39. Reattività, dimensioni, voce MENU, tolleranza ═══ */
{
  const { buildTree: bt9 } = await import('../js/scan/ScanEngine.js');

  /* ── La voce MENU compare solo se richiesta ── */
  const az = (cfg) => bt9(cfg, { hasText: true }).children.find(x => x.id === 'write')
    .children.find(x => x.id === 'act').children.map(x => x.label);
  ok(!az(DEFAULT_CONFIG).includes('MENU'),
     '39a. la voce MENU non compare di default: ogni voce costa un giro a ogni scansione');
  const conMenu = deepClone(DEFAULT_CONFIG); conMenu.scan.showMenuItem = true;
  ok(az(conMenu).includes('MENU'), '39b. e compare quando la si chiede');
  ok(az(conMenu).indexOf('MENU') === az(conMenu).length - 1, '39c. in fondo, dove ci si aspetta');

  /* ── ⚠️ Finestra di grazia: l'errore più frustrante di tutti ──
   * La persona sente "vocali", decide, guarda in alto — e nel
   * frattempo la scansione è passata al gruppo dopo. Ha fatto tutto
   * giusto e ha sbagliato lo stesso. */
  function selezioneTardiva(grazia, ritardo) {
    const c = deepClone(DEFAULT_CONFIG);
    c.scan.graceMs = grazia;
    const e = new ScanEngine(c, { onOutput: () => null, onBuffer: () => {}, onDraft: () => {} });
    let T = 1000; e.start(T);
    const sentita = e.currentNode?.label;
    T += 600; e.handleAction('NEXT', T);
    const mostrata = e.currentNode?.label;
    T += ritardo; e.select(T);
    return { sentita, mostrata, grazieUsate: e.stats.graziaUsata || 0 };
  }
  const senza = selezioneTardiva(0, 200);
  ok(senza.grazieUsate === 0, '39d. a tolleranza 0 il comportamento è quello di sempre');
  const con = selezioneTardiva(400, 200);
  ok(con.grazieUsate === 1,
     '39e. con la tolleranza, una selezione tardiva sceglie la voce che si stava ASCOLTANDO');
  const tardi = selezioneTardiva(400, 700);
  ok(tardi.grazieUsate === 0,
     '39f. ma oltre la finestra vale la voce corrente: la tolleranza non deve diventare confusione');
  ok(DEFAULT_CONFIG.scan.graceMs === 0, '39g. spenta di default: nessuna regressione');

  /* ── I tre livelli di testo hanno regolatori distinti ── */
  const u = DEFAULT_CONFIG.ui;
  ok(u.readScale !== undefined && u.stageScale !== undefined && u.pathScale !== undefined,
     '39h. barra, voce corrente e percorso hanno ciascuno il proprio regolatore');
  ok(u.stageScale < 1,
     `39i. la voce corrente parte ridotta (${u.stageScale}): era enorme rispetto alla frase da leggere`);
  ok(u.pathScale > 1,
     `39l. il percorso parte ingrandito (${u.pathScale}): era minuscolo e senza controllo`);

  const fs9 = await import('node:fs');
  const path9 = await import('node:path');
  const qui9 = path9.dirname(import.meta.filename || process.argv[1]);
  const css9 = fs9.readFileSync(path9.join(qui9, '..', 'css/app.css'), 'utf8');
  ok(/\.stage-current\{[^}]*var\(--palco/.test(css9), '39m. la voce corrente usa il proprio moltiplicatore');
  ok(/\.stage-path\{[^}]*var\(--percorso/.test(css9), '39n. e così il percorso');
  ok(/\.sib\{[^}]*var\(--percorso/.test(css9), '39o. le voci vicine seguono il percorso');

  /* ── La finestra dei termini deve stare SOPRA la schermata iniziale ── */
  const zGate = /#gate\{[^}]*z-index:(\d+)/.exec(css9) || /\.gate[^{]*\{[^}]*z-index:(\d+)/.exec(css9);
  const zLegal = /\.legal\{[^}]*z-index:(\d+)/.exec(css9);
  ok(zLegal && parseInt(zLegal[1]) >= 100,
     `39p. i termini si aprono sopra la schermata iniziale (z-index ${zLegal?.[1]})`);

  const html9 = fs9.readFileSync(path9.join(qui9, '..', 'index.html'), 'utf8');
  const iLabel = html9.indexOf('class="gate-accept"');
  const iBtn = html9.indexOf('id="gateTerms"');
  ok(iBtn < iLabel,
     '39q. il collegamento ai termini sta FUORI dall etichetta: aprirlo non deve spuntare la casella');

  /* ── Le impostazioni che aprono sezioni si ridisegnano subito ── */
  const sv9 = fs9.readFileSync(path9.join(qui9, '..', 'js/ui/SettingsView.js'), 'utf8');
  ok(/INTERRUTTORI_CHE_APRONO/.test(sv9),
     '39r. gli interruttori che aprono una sezione ridisegnano subito');
  for (const chiave of ['email.enabled', 'radio.enabled', 'domotica.enabled', 'detection.faceChannels']) {
    ok(new RegExp(`'${chiave.replace('.', '\\.')}'`).test(sv9),
       `39s. "${chiave}" è fra quelli che ridisegnano: prima l elenco compariva solo cambiando scheda`);
  }
}

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail?1:0);
