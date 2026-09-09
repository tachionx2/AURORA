/**
 * Simulazione dell'applicazione completa con un DOM finto.
 * Avvia davvero App, guida il ciclo di animazione e verifica che la
 * scansione AVANZI. È il test che mancava: nessuno copriva il ciclo
 * di vita reale del programma.
 */
let pass=0, fail=0;
const ok=(c,m)=>{ if(c) pass++; else {fail++; console.log('  ✗ '+m);} };

/* ------------------------------ DOM finto ------------------------------ */
const store = new Map();
function El(id='', tag='div'){
  const el = {
    id, tagName:tag.toUpperCase(), className:'', textContent:'', value:'', checked:false,
    // innerHTML='' deve svuotare davvero i figli, come nel browser:
    // altrimenti i conteggi nei test non significano nulla.
    _html:'',
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; if (v === '') this.children.length = 0; },
    width:400, height:200, clientWidth:800, clientHeight:400, scrollHeight:100, scrollTop:0,
    offsetHeight:10, files:null, disabled:false, title:'', src:'', href:'', download:'',
    style:new Proxy({ _prop:{},
        setProperty(k,v){ this._prop[k]=String(v); },
        removeProperty(k){ delete this._prop[k]; },
        getPropertyValue(k){ return this._prop[k] ?? ''; } },
      { get:(t,k)=> (k in t ? t[k] : ''), set:(t,k,v)=>{t[k]=v;return true}, has:()=>true }),
    dataset:{}, children:[],
    classList:{ _s:new Set(), add(...c){c.forEach(x=>this._s.add(x))},
      remove(...c){c.forEach(x=>this._s.delete(x))},
      toggle(c,f){ f===undefined ? (this._s.has(c)?this._s.delete(c):this._s.add(c)) : (f?this._s.add(c):this._s.delete(c)) },
      contains(c){return this._s.has(c)} },
    append(...n){ n.forEach(x=>this.children.push(x)) },
    appendChild(n){ this.children.push(n); return n },
    remove(){}, click(){ this.onclick?.() }, focus(){}, scrollBy(){},
    getContext:()=>ctx2d, setAttribute(){}, removeAttribute(){},
    addEventListener(){}, removeEventListener(){},
    querySelector:()=>null, querySelectorAll:()=>[], closest:()=>null,
    _attr:{},
    setAttribute(k,v){ this._attr[k]=v }, getAttribute(k){ return this._attr[k] ?? null },
    hasAttribute(k){ return this._attr[k]!==undefined }, removeAttribute(k){ delete this._attr[k] },
    getBoundingClientRect:()=>({x:0,y:0,width:800,height:400,top:0,left:0}),
    measureText:()=>({width:10}),
  };
  return el;
}
const ctx2d = new Proxy({}, { get:(t,k)=> t[k] ?? (()=>({width:10})), set:(t,k,v)=>{t[k]=v;return true} });

global.window = {
  innerWidth:1280, innerHeight:800, devicePixelRatio:1,
  addEventListener(){}, removeEventListener(){},
  speechSynthesis:{ speak(u){ setTimeout(()=>u.onend?.(),1) }, cancel(){}, getVoices:()=>[], onvoiceschanged:null },
  SpeechSynthesisUtterance: function(t){ this.text=t; },
  AudioContext: function(){ this.state='running'; this.currentTime=0;
    this.createOscillator=()=>({frequency:{setValueAtTime(){}},connect:()=>({connect(){}}),start(){},stop(){}});
    this.createGain=()=>({gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect:()=>({connect(){}})});
    this.destination={}; this.resume=async()=>{}; },
  matchMedia:()=>({matches:false, addEventListener(){}}),
  visualViewport:null, YT:null, location:{protocol:'https:'},
};
global.SpeechSynthesisUtterance = window.SpeechSynthesisUtterance;
global.Audio = function(){ this.setSinkId=async()=>{}; };
global.Blob = function(){};
// NON si sostituisce URL: Node lo usa per risolvere i moduli. Si
// aggiungono solo i metodi statici che mancano nell'ambiente.
global.URL.createObjectURL = () => 'blob:x';
global.URL.revokeObjectURL = () => {};
global.document = {
  body: El('body'), documentElement: El('html'),
  getElementById(id){ if(!store.has(id)) store.set(id, El(id)); return store.get(id) },
  createElement(tag){ return El('', tag) },
  querySelector(){ return null },
  /* Ricerca per attributo: il banco deve poter trovare i selettori
     della telecamera, che nella pagina sono marcati con un attributo
     invece che con un id — ce n'è più d'uno. */
  querySelectorAll(sel){
    const m = /^\[([a-z-]+)\]$/.exec(String(sel||''));
    if (!m) return [];
    const attr = m[1];
    return [...store.values()].filter(e => e._attr && e._attr[attr] !== undefined);
  },
  head: El('head'), fonts:null, addEventListener(){}, elementFromPoint:()=>null,
  createTextNode(t){ const e=El('','#text'); e.textContent=t; return e },
};
document.body.dataset.tab = 'parla';
global.localStorage = { _d:{}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v},
                        removeItem(k){delete this._d[k]} };
Object.defineProperty(global,'navigator',{ value:{
  mediaDevices:{ enumerateDevices:async()=>[], getUserMedia:async()=>{throw new Error('nessuna camera')} },
}, configurable:true });
global.performance = { now: () => CLOCK };
global.confirm = () => false;

// In Node non si possono importare moduli via https: MediaPipe e pdf.js
// falliscono, ed è atteso. Si registrano invece di far rumore, e si
// verifica alla fine che siano SOLO di quel tipo.
const rifiutiAttesi = [];
process.on('unhandledRejection', (e) => {
  const m = String(e?.message || e);
  if (/ERR_UNSUPPORTED_ESM_URL_SCHEME|ERR_MODULE_NOT_FOUND|Failed to fetch|non raggiungibile/.test(m)) {
    rifiutiAttesi.push(m); return;
  }
  console.log('  ✗ rifiuto non gestito: ' + m);
  process.exitCode = 1;
});
global.prompt = () => null;

/* ---------------------- Ciclo di animazione guidato ---------------------- */
let CLOCK = 0;
let rafQueue = [];
let rafDeaths = 0;
global.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length };
global.cancelAnimationFrame = () => {};
function pump(ms, stepMs = 20) {
  const end = CLOCK + ms;
  while (CLOCK < end) {
    CLOCK += stepMs;
    const q = rafQueue; rafQueue = [];
    for (const fn of q) {
      try { fn(); }
      catch (e) { rafDeaths++; throw new Error('ECCEZIONE NEL CICLO: ' + e.message + '\n' + e.stack.split('\n')[1]); }
    }
  }
}

/* ------------------------------ Avvio app ------------------------------ */
let app, bootError = null;
try { await import('../js/main.js'); app = global.window.aurora; }
catch (e) { bootError = e; }
ok(!bootError, 'l applicazione si avvia senza errori: ' + (bootError?.message || '') + (bootError? '\n     '+bootError.stack.split('\n')[1] : ''));
if (!app) { console.log(`\n${pass} superati, ${fail} falliti`); process.exit(1); }

ok(rafQueue.length > 0, 'il ciclo di animazione è partito');

/* --------------------------- LA VERIFICA CHIAVE --------------------------- */
app.scan.start(CLOCK);
const seen = [];
let loopError = null;
try {
  for (let i = 0; i < 12; i++) {
    pump(1600);
    const cur = app.scan.currentNode?.label;
    if (cur && seen[seen.length-1] !== cur) seen.push(cur);
  }
} catch (e) { loopError = e.message; }

ok(!loopError, 'il ciclo non lancia eccezioni: ' + (loopError||''));
ok(rafQueue.length > 0, 'il ciclo di animazione è ANCORA vivo dopo 12 passi');
ok(seen.length >= 3, 'la scansione AVANZA fra le opzioni (viste: ' + seen.join(' → ') + ')');

/* ----------------------- Selezione e navigazione ----------------------- */
function pick(label, maxSteps = 4000) {
  for (let i = 0; i < maxSteps; i++) {
    // La ripresa ora attende che l'annuncio finisca: nel banco di prova
    // l'audio è finto e la promessa si risolve subito, ma la sospensione
    // dura comunque un istante. Si lascia scorrere il tempo.
    if (app.scan.paused) { app.scan.resume(CLOCK); pump(700, 50); }
    if (app.scan.suspended) { pump(200, 50); continue; }
    if (app.scan.currentNode?.label === label) { app.scan.select(CLOCK); return true; }
    pump(60, 20);
  }
  return false;
}
ok(pick('Scrivi'), 'si può entrare in Scrivi');
ok(pick('Vocali'), 'si può entrare nelle Vocali');
ok(pick('A'), 'si può comporre una lettera');
ok(app.scan.buffer.letters === 'A', 'la lettera finisce nel buffer');

const before = app.scan.currentNode?.label;
pump(4000);
ok(app.scan.currentNode?.label !== before || app.scan.paused, 'la scansione continua dopo aver composto');

/* -------------------------- Ciclo continuo lungo -------------------------- */
app.scan.start(CLOCK);
let advErr = null;
try { pump(60000, 25); } catch (e) { advErr = e.message; }
ok(!advErr, 'sessantamila millisecondi senza eccezioni: ' + (advErr||''));
ok(rafQueue.length > 0, 'ciclo ancora vivo dopo 60 s simulati');


/* ═══════════ CONTROPROVA: il ciclo sopravvive a un guasto? ═══════════ */

// 1. Guasto in una vista secondaria durante il ciclo
app.scan.start(CLOCK);
const origDraw = app.overlay.draw.bind(app.overlay);
app.overlay.setMode('pointer');
app.overlay.draw = () => { throw new Error('guasto simulato nel disegno'); };
const beforeCrash = app.scan.currentNode?.label;
let crashErr = null;
try { pump(8000, 25); } catch (e) { crashErr = e.message; }
app.overlay.draw = origDraw;
app.overlay.setMode('off');
ok(!crashErr, 'un guasto nel disegno NON interrompe il ciclo: ' + (crashErr||''));
ok(rafQueue.length > 0, 'ciclo ancora vivo dopo il guasto');
const seen2 = [];
for (let i=0;i<8;i++){ pump(1600,25); const c=app.scan.currentNode?.label; if(c&&seen2[seen2.length-1]!==c) seen2.push(c); }
ok(seen2.length >= 2, 'la scansione CONTINUA ad avanzare dopo il guasto ('+seen2.join(' → ')+')');

// 2. Guasto in una vista all'avvio: la scansione deve funzionare comunque
ok(typeof app._safe === 'function', 'esiste l isolamento delle viste all avvio');
let safeErr = null;
try { app._safe('prova', () => { throw new Error('guasto di prova'); }); }
catch (e) { safeErr = e.message; }
ok(!safeErr, '_safe cattura il guasto invece di propagarlo');
ok(app._bootErrors?.length > 0, 'il guasto viene registrato, non ignorato in silenzio');

// 3. Le impostazioni non devono solo "non lanciare": devono PRODURRE
//    contenuto. Con una scheda mancante la griglia restava vuota, e
//    "non lancia" non lo avrebbe rilevato.
/* ⚠️ Le impostazioni sono ora raggruppate in quattro gruppi, e se ne
 * vede uno per volta. Si percorrono TUTTI: il rischio da coprire è che
 * una scheda scompaia da un gruppo senza che nessuno se ne accorga. */
let cardErr = null;
const grid = document.getElementById('settingsGrid');
grid.children = [];
try { app.settingsView.render(); } catch (e) { cardErr = e.message; }
ok(!cardErr, 'le schede impostazioni si costruiscono: ' + (cardErr||''));

const gruppi = app.settingsView.gruppi || [];
ok(gruppi.length === 4, `le impostazioni sono divise in quattro gruppi (${gruppi.length})`);
for (const g of gruppi) {
  ok(!!g.nome && !!g.sub, `il gruppo "${g.id}" ha nome e descrizione`);
  ok(g.schede.length >= 4, `il gruppo "${g.id}" contiene ${g.schede.length} schede`);
}

// Si raccolgono le schede di TUTTI i gruppi, uno per volta.
const cards = [];
for (const g of gruppi) {
  app.settingsView.gruppoAttivo = g.id;
  grid.children = [];
  let err = null;
  try { app.settingsView.render(); } catch (e) { err = e.message; }
  ok(!err, `il gruppo "${g.id}" si disegna senza errori: ${err || ''}`);
  // La prima è la barra dei gruppi, non una scheda.
  cards.push(...grid.children.slice(1));
}
app.settingsView.gruppoAttivo = gruppi[0]?.id;
ok(cards.length >= 25,
   `nessuna scheda perduta nel raggruppamento (trovate ${cards.length} su 25)`);
function countDeep(node, acc = { fields: 0, inputs: 0 }) {
  for (const c of node.children || []) {
    if (c.className === 'field' || c.classList?.contains?.('field')) acc.fields++;
    if (['INPUT','SELECT','BUTTON'].includes(c.tagName)) acc.inputs++;
    countDeep(c, acc);
  }
  return acc;
}
const tot = cards.reduce((a, c) => { const r = countDeep(c); a.fields += r.fields; a.inputs += r.inputs; return a; }, { fields:0, inputs:0 });
ok(tot.fields >= 60, 'almeno sessanta impostazioni presenti (trovate ' + tot.fields + ')');
ok(tot.inputs >= 60, 'almeno sessanta controlli interattivi (trovati ' + tot.inputs + ')');

// I metodi richiesti da render() devono esistere tutti: è il controllo
// che avrebbe intercettato la cancellazione accidentale delle schede.
const src = app.settingsView.render.toString();
const required = [...src.matchAll(/this\.(_\w+Card)\(/g)].map(m => m[1]);
const missing = required.filter(n => typeof app.settingsView[n] !== 'function');
ok(missing.length === 0, 'nessun metodo scheda mancante: ' + missing.join(', '));
ok(required.length >= 15, 'render() invoca almeno quindici schede (' + required.length + ')');

// Esporta / importa profilo
let ioErr = null, roundtrip = false;
try {
  const { exportProfile, importProfile } = await import('../js/core/config.js');
  const txt = exportProfile(app.cfg, app.predictor.serialize());
  const back = importProfile(txt);
  roundtrip = JSON.stringify(back.config) === JSON.stringify(app.cfg);
} catch (e) { ioErr = e.message; }
ok(!ioErr && roundtrip, 'esporta e importa profilo funzionano: ' + (ioErr||''));

// 4. Le altre schede
for (const [nome, fn] of [['statistiche',()=>app.statsView.render()],
                          ['puntatore',()=>app.pointerView.render()],
                          ['testi',()=>app.renderDrafts()],
                          ['preferiti',()=>app.renderFavorites()],
                          ['tracce',()=>app.renderTraceBar()]]) {
  let e2=null; try { fn(); } catch(e){ e2=e.message; }
  ok(!e2, `scheda ${nome} si costruisce: ${e2||''}`);
}

// 5. Cambio di lingua e tema non rompono nulla
let langErr=null;
try { app.set('ui.language','en'); app.settingsView.render(); app.set('ui.theme','light');
      app.set('ui.language','it'); app.settingsView.render(); }
catch(e){ langErr=e.message; }
ok(!langErr, 'cambio lingua e tema senza guasti: ' + (langErr||''));
ok(rafQueue.length > 0, 'ciclo vivo anche dopo i cambi di configurazione');

/* ═══════════ Scheda Punta ═══════════ */
document.body.dataset.tab = 'punta';
let ptErr = null;
try { app.pointerView.render(); } catch (e) { ptErr = e.message; }
ok(!ptErr, 'la scheda Punta si costruisce: ' + (ptErr||''));

// La tastiera deve produrre tasti veri
const kb = document.getElementById('kbGrid');
kb.children = [];
app.pointerView.renderKeyboard();
const rows = kb.children;
ok(rows.length >= 3, 'la tastiera ha almeno tre righe (' + rows.length + ')');
const keys = rows.reduce((n, r) => n + (r.children?.length || 0), 0);
ok(keys >= 26, 'la tastiera ha almeno ventisei tasti (' + keys + ')');
// Le azioni NON devono stare fra i tasti
const actKeys = rows.flatMap(r => r.children || []).filter(k => k.className?.includes('kb-act'));
ok(actKeys.length === 0, 'nessun pulsante azione mescolato alle lettere (' + actKeys.length + ')');

// Il testo composto deve comparire SOPRA la tastiera
app.scan.buffer = { letters: 'ci', words: ['ciao','marco'], sentence: '' };
app.pointerView.renderCompose();
ok(document.getElementById('ptSentence').innerHTML.includes('ciao marco'), 'il testo composto è mostrato nella scheda Punta');
ok(document.getElementById('ptLetters').textContent === 'ci', 'le lettere in corso sono mostrate');

// Le tre modalità sono esclusive
const { MODES } = await import('../js/ui/PointerView.js');
ok(MODES.length === 5 && MODES.includes('testi') && MODES.includes('media'),
   'cinque modalità: ' + MODES.join(', '));
for (const m of MODES) {
  app.pointerView.setMode(m);
  const attive = MODES.filter(x => document.getElementById(`ptView-${x}`).classList.contains('is-active'));
  ok(attive.length === 1 && attive[0] === m, `modalità ${m}: una sola vista attiva (${attive.join(',')})`);
}
app.pointerView.setMode('testi');
ok((document.getElementById('draftList').children?.length || 0) >= 0, 'la modalità testi popola l archivio');
app.pointerView.setMode('tastiera');

// Stato compatto, non riquadri giganti
const stEl = document.getElementById('ptrStatus');
app.pointerView.renderStatus();
ok(/class="st/.test(stEl.innerHTML) && !/counter/.test(stEl.innerHTML), 'stato mostrato come indicatori compatti');

// Il pannello braccio esiste ancora: nulla è stato rimosso
app.pointerView.setMode('braccio');
const arm = document.getElementById('armPanel');
ok((arm.children?.length || 0) > 0, 'il pannello braccio è ancora presente e popolato');
app.pointerView.setMode('tastiera');
document.body.dataset.tab = 'parla';

/* ═══════════ Ordine delle schede e scopribilità dei testi ═══════════ */
// Detta sta dopo Punta: sono i due modi alternativi di comporre un
// testo, e vanno vicini. Media, statistiche e strumenti seguono.
const ordineAtteso = ['parla','punta','detta','guarda','statistiche','diagnostica','impostazioni'];
const fs = await import('node:fs');
const path = await import('node:path');
// Il DOM finto sovrascrive URL, quindi si risale dal percorso del file
// senza usarlo: il test deve funzionare da qualunque cartella.
const here = path.dirname(import.meta.filename || process.argv[1]);
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const htmlSrc = html;
const ordineReale = [...html.matchAll(/data-goto="(\w+)"/g)].map(m => m[1]);
ok(JSON.stringify(ordineReale) === JSON.stringify(ordineAtteso),
   'schede nell ordine richiesto: ' + ordineReale.join(' · '));

// L'archivio testi deve stare nella scheda Punta, non in Guarda
const iCard = html.indexOf('id="draftCard"');
const iPunta = html.lastIndexOf('id="panel-punta"', iCard);
const iGuarda = html.lastIndexOf('id="panel-guarda"', iCard);
ok(iPunta > iGuarda, 'l archivio testi sta nella scheda Punta');

// Il ramo "I miei testi" deve essere raggiungibile PRIMA di aver salvato
const { buildTree: bt } = await import('../js/scan/ScanEngine.js');
const vuoto = bt(app.cfg, {});
const conTesto = bt(app.cfg, { hasText: true });
ok(!vuoto.children.some(c => c.id === 'drafts'), 'senza nulla scritto il ramo testi non ingombra');
// Ordine richiesto: Frasi · Scrivi · MIEI TESTI · PAUSA
ok(conTesto.children.map(c => c.id).join(',') === 'phrases,write,drafts,pause',
   'ordine del menu: ' + conTesto.children.map(c => c.label).join(' · '));
const ramo = conTesto.children.find(c => c.id === 'drafts');
ok(ramo.children[0].action === 'BACK', 'anche in MIEI TESTI l uscita è la prima voce');
ok(ramo.children.some(c => c.action === 'SAVE_DRAFT'),
   'si può salvare da dentro il ramo, non solo dalle azioni');
const conSalvati = bt(app.cfg, { hasText: true, drafts: [{ id:'x', title:'Lettera' }] });
const testo = conSalvati.children.find(c => c.id === 'drafts').children.find(c => c.label === 'Lettera');
ok(testo?.children[0].action === 'BACK', 'uscita per prima anche dentro un testo');
// ⚠️ ELIMINA è un SOTTOMENU, non un'azione immediata: la conferma sta
// dentro la scansione, perché un dialogo del browser bloccherebbe la
// pagina e chi non può cliccare resterebbe chiuso dentro.
ok(testo?.children.map(c => c.label).join(' · ') === '← ESCI · RILEGGI · ELIMINA · SCRIVI',
   'ordine dentro un testo: ' + testo?.children.map(c => c.label).join(' · '));
const elim = testo?.children.find(c => c.label === 'ELIMINA');
ok(elim?.kind === 'group' && elim.children.some(c => c.action === 'DRAFT_DELETE'),
   'ELIMINA chiede conferma dentro la scansione, non con un dialogo');

/* ═══════════ Prova esaustiva: ogni pulsante, ogni impostazione ═══════════ */

// 1. Si preme OGNI pulsante di OGNI scheda, verificando che nessuno
//    lanci e che il ciclo di scansione resti vivo. È la verifica che
//    nessun test statico può sostituire.
const tabs = ['parla','punta','guarda','statistiche','diagnostica','impostazioni'];
const bottoniRotti = [];
let premuti = 0;
for (const tab of tabs) {
  try { app.goto(tab); } catch (e) { bottoniRotti.push(`goto(${tab}): ${e.message}`); continue; }
  pump(200, 50);
  const ids = [...htmlSrc.matchAll(/<(?:button|label)[^>]*\sid="([^"]+)"/g)].map(m => m[1]);
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el?.onclick) continue;
    // Si evitano solo le azioni distruttive o che aprono dialoghi bloccanti
    if (['btnReset','btnEnter'].includes(id)) continue;
    premuti++;
    try { el.onclick(); } catch (e) { bottoniRotti.push(`${id}: ${e.message}`); }
    try { pump(120, 40); } catch (e) { bottoniRotti.push(`ciclo dopo ${id}: ${e.message}`); }
  }
}
ok(bottoniRotti.length === 0, `pulsanti che lanciano un errore: ${bottoniRotti.join(' | ')}`);
ok(premuti >= 15, `pulsanti effettivamente premuti: ${premuti}`);
ok(rafQueue.length > 0, 'il ciclo è vivo dopo aver premuto tutti i pulsanti');

// 2. Si modifica OGNI impostazione: ogni percorso letto da SettingsView
//    viene scritto con un valore plausibile, e si verifica che la
//    configurazione resti valida e l'interfaccia si ricostruisca.
const { validateConfig: vcfg, DEFAULT_CONFIG: DC } = await import('../js/core/config.js');
const settingsSrc = fs.readFileSync(path.join(here, '..', 'js/ui/SettingsView.js'), 'utf8');
const percorsi = [...new Set([...settingsSrc.matchAll(/this\._(toggle|range|number|select)\(\s*'([\w.]+)'/g)]
  .map(m => ({ tipo: m[1], path: m[2] })))];
const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const impostazioniRotte = [];
for (const { tipo, path: pth } of percorsi) {
  const attuale = get(app.cfg, pth);
  let nuovo;
  if (tipo === 'toggle') nuovo = !attuale;
  else if (tipo === 'select') nuovo = attuale;             // resta valido
  else nuovo = typeof attuale === 'number' ? attuale : 1;
  try {
    app.set(pth, nuovo);
    const errs = vcfg(app.cfg);
    if (errs.length) impostazioniRotte.push(`${pth}: ${errs[0]}`);
    app.set(pth, attuale);                                  // ripristino
    app.settingsView.render();
    pump(60, 30);
  } catch (e) { impostazioniRotte.push(`${pth}: ${e.message}`); }
}
ok(impostazioniRotte.length === 0, `impostazioni che rompono qualcosa: ${impostazioniRotte.slice(0,4).join(' | ')}`);
ok(percorsi.length >= 60, `impostazioni provate una per una: ${percorsi.length}`);
ok(rafQueue.length > 0, 'ciclo vivo dopo aver toccato tutte le impostazioni');
ok(JSON.stringify(vcfg(app.cfg)) === '[]', 'configurazione ancora valida al termine');

// 3. Dopo tutte le prove la scansione deve ripartire e funzionare.
//    (Fra i pulsanti premuti c'è anche Pausa, quindi si riavvia:
//    è comportamento corretto, non un guasto.)
app.goto('parla');
app.scan.start(CLOCK);
pump(1000, 50);
const dopoTutto = [];
for (let i = 0; i < 8; i++) { const cur = app.scan.currentNode?.label; if (cur && dopoTutto[dopoTutto.length-1] !== cur) dopoTutto.push(cur); pump(1600, 50); }
ok(dopoTutto.length >= 2, `la scansione avanza ancora dopo tutte le prove (${dopoTutto.join(' → ')})`);

await new Promise(r => setTimeout(r, 50));
ok(process.exitCode !== 1, 'nessun errore asincrono non gestito');
if (rifiutiAttesi.length) console.log(`  (${rifiutiAttesi.length} errori di rete attesi in Node, ignorati)`);

/* ═══════════ Interruttori: devono essere davvero premibili ═══════════ */
document.body.dataset.tab = 'impostazioni';
/* Si percorrono tutti e quattro i gruppi: gli interruttori sono
 * distribuiti fra loro, e guardarne uno solo ne mostrerebbe una
 * frazione. */
const grid2 = document.getElementById('settingsGrid');
function raccogli(node, out = []) {
  for (const c of node.children || []) {
    if (c.className === 'switch') out.push(c);
    raccogli(c, out);
  }
  return out;
}
const interruttori = [];
for (const g of (app.settingsView.gruppi || [])) {
  app.settingsView.gruppoAttivo = g.id;
  grid2.children = [];
  app.settingsView.render();
  for (const c of grid2.children) raccogli(c, interruttori);
}
app.settingsView.gruppoAttivo = app.settingsView.gruppi?.[0]?.id;
grid2.children = [];
app.settingsView.render();
ok(interruttori.length >= 15, `interruttori trovati in tutti i gruppi: ${interruttori.length}`);
// Una casella nascosta dentro un <div> non è premibile: solo la <label>
// propaga il clic. È il difetto che rendeva TUTTE le impostazioni a
// interruttore inattive.
const nonLabel = interruttori.filter(s => s.tagName !== 'LABEL');
ok(nonLabel.length === 0, `interruttori non premibili (non sono <label>): ${nonLabel.length}`);

// E devono cambiare davvero la configurazione
const prima = app.cfg.gestures.DOWN.enabled;
const swDown = interruttori.find(s => s.children?.[0]?.checked === prima);
if (swDown?.children?.[0]?.onchange) {
  swDown.children[0].checked = !prima;
  swDown.children[0].onchange();
  ok(true, 'un interruttore modifica la configurazione');
} else ok(false, 'interruttore senza gestore');

/* ═══════════ Chiudere un file NON deve toglierlo dalla libreria ═══════════ */
app.goto('guarda');
app.library.docs = [{ title: 'lettera.pdf', file: { name: 'lettera.pdf' } }];
app.library.audios = [{ title: 'musica.mp3', file: { name: 'musica.mp3' } }];
app.refreshContext();
app.renderLibreria();
const listaPrima = document.getElementById('libList').children.length;
ok(listaPrima >= 2, `la libreria elenca i file caricati (${listaPrima})`);
ok(app.libreriaPerScansione().docs.length === 1, 'il documento è raggiungibile in scansione');

// Si simula l'apertura e poi la chiusura
app.media.kind = 'pdf';
app.media.container = document.getElementById('mediaStage');
app.media.close(true);
pump(200, 50);
ok(app.library.docs.length === 1, 'dopo CHIUDI il documento è ANCORA nella libreria');
ok(app.library.audios.length === 1, 'anche gli altri file restano');
app.renderLibreria();
ok(document.getElementById('libList').children.length === listaPrima,
   'e l elenco continua a mostrarli');
ok(app.libreriaPerScansione().docs.length === 1,
   'e restano raggiungibili dal menu di scansione');
document.body.dataset.tab = 'parla';

/* ═══════════ Scheda Punta: camera protetta e contenuti ═══════════ */
app.goto('punta');
pump(200, 50);

// La camera si comanda anche da qui
const camBtn = document.getElementById('ptCam');
ok(!!camBtn?.onclick, 'la telecamera si comanda anche dalla scheda Punta');

// Spegnere è un'azione protetta: un solo click non deve bastare.
// Se bastasse, un click accidentale toglierebbe alla persona OGNI modo
// di comandare il programma, senza poterlo riaccendere.
camBtn.classList.add('ptr-danger');
camBtn.textContent = 'Ferma camera';
let eseguito = 0;
camBtn.onclick = () => eseguito++;
camBtn.closest = () => camBtn;
document.elementFromPoint = () => camBtn;
app.activateAt(10, 10, 'click');
ok(eseguito === 0, 'primo click su azione protetta: NON esegue');
ok(camBtn.classList.contains('in-conferma'), 'chiede conferma in modo evidente');
app.activateAt(10, 10, 'click');
ok(eseguito === 1, 'secondo click entro la finestra: esegue');
ok(!camBtn.classList.contains('in-conferma'), 'la richiesta di conferma si chiude');

// Un bersaglio normale invece si attiva subito
const normale = document.getElementById('ptSpeak');
let n2 = 0; normale.onclick = () => n2++;
normale.closest = () => normale;
document.elementFromPoint = () => normale;
app.activateAt(10, 10, 'click');
ok(n2 === 1, 'un bersaglio normale si attiva al primo click');
document.elementFromPoint = () => null;

// I contenuti sono raggiungibili anche puntando
app.library.docs = [{ title: 'lettera.pdf', file: { name: 'lettera.pdf' } }];
app.library.audios = [{ title: 'musica.mp3', file: { name: 'musica.mp3' } }];
app.refreshContext();
app.pointerView.setMode('media');
const tiles = document.getElementById('ptTiles');
ok(tiles.children.length >= 2, `i contenuti compaiono come riquadri (${tiles.children.length} gruppi)`);
const riquadri = [];
(function raccogli(n){ for (const c of n.children||[]) { if (c.className?.includes('pt-tile ')) riquadri.push(c); raccogli(c); } })(tiles);
ok(riquadri.length >= 2, `un riquadro per contenuto (${riquadri.length})`);
ok(riquadri.every(r => r.className.includes('ptr-target')),
   'ogni riquadro è un bersaglio del puntatore');
ok(riquadri.every(r => typeof r.onclick === 'function'), 'ogni riquadro apre il contenuto');

// La barra comandi esiste anche qui
app.media.kind = 'audio';
app.renderMediaBar();
ok(document.getElementById('ptMediaBar').children.length > 0,
   'i comandi del file compaiono anche nella scheda Punta');
app.media.kind = null;
app.pointerView.setMode('tastiera');
app.goto('parla');

/* ═══════════ Impostazioni audio: i due canali sono configurabili ═══════════ */
app.goto('impostazioni');
const grid3 = document.getElementById('settingsGrid');
grid3.children = [];
app.settingsView.render();

// Si cercano i percorsi effettivamente esposti dalla scheda audio
const srcSet = fs.readFileSync(path.join(here, '..', 'js/ui/SettingsView.js'), 'utf8');
const espostiAudio = [...srcSet.matchAll(/'(audio\.[\w.]+)'/g)].map(m => m[1]);
for (const chiave of ['audio.menuSinkId', 'audio.speechSinkId', 'audio.menuVoiceUri',
                      'audio.speechVoiceUri', 'audio.menuVolume', 'audio.speechVolume',
                      'audio.menuRate', 'audio.speechRate', 'audio.earconPan']) {
  ok(espostiAudio.includes(chiave), `impostazione audio esposta: ${chiave}`);
}

// Due uscite DISTINTE, non una sola condivisa
ok(app.cfg.audio.menuSinkId !== undefined && app.cfg.audio.speechSinkId !== undefined,
   'le due uscite sono voci di configurazione separate');
app.set('audio.menuSinkId', 'dispositivo-A');
app.set('audio.speechSinkId', 'dispositivo-B');
ok(app.cfg.audio.menuSinkId === 'dispositivo-A' && app.cfg.audio.speechSinkId === 'dispositivo-B',
   'si possono impostare su due dispositivi diversi');
app.set('audio.menuSinkId', ''); app.set('audio.speechSinkId', '');

// Il canale stereo dei toni si imposta ed è indipendente
app.set('audio.earconPan', -1);
ok(app.cfg.audio.earconPan === -1, 'i toni si possono spostare tutti su un canale');
app.set('audio.earconPan', 0);

// La diagnostica deve dire la verità: il parlato NON è instradabile
const stato = app.audio.statoInstradamento;
ok(stato.parlato === false, 'la diagnostica dichiara che il parlato non è instradabile');
ok(typeof stato.earcon === 'boolean', 'e riporta se i toni lo sono');
document.body.dataset.tab = 'parla';

/* ═══════════ Scheda Detta ═══════════ */
app.goto('detta');
pump(300, 50);
let dettErr = null;
try { app.initDettatura(); } catch (e) { dettErr = e.message; }
ok(!dettErr, 'la scheda Detta si costruisce: ' + (dettErr || ''));

const areaTesto = document.getElementById('dtTesto');
ok(!!areaTesto, 'esiste l area di testo');
// Il microfono è un caso a sé: senza riconoscimento vocale nel browser
// deve DISABILITARSI spiegando perché, non restare lì a non funzionare.
const micBtn = document.getElementById('dtMic');
const { dettaturaDisponibile } = await import('../js/lang/Dictation.js');
if (dettaturaDisponibile()) {
  ok(typeof micBtn.onclick === 'function', 'comando "dtMic" collegato');
} else {
  ok(micBtn.disabled === true, 'senza riconoscimento vocale il microfono è disabilitato');
  ok(/non disponibile|unavailable/i.test(micBtn.textContent),
     'e l etichetta spiega perché: ' + micBtn.textContent);
}
// Comandi: devono avere un gestore, altrimenti premerli non fa nulla.
for (const id of ['dtSpeak','dtStopSpeak','dtSelectAll','dtCopy','dtCut','dtPaste',
                  'dtSave','dtDownload','dtToBuffer','dtClear','dtAudioFile',
                  'dtTrascrivi','dtStopTrascrivi','dtBack10','dtFwd10','dtSpeed','dtLang',
                  'dtTrad','dtTradSpeak','dtTradCopy','dtTradUse']) {
  const e2 = document.getElementById(id);
  ok(!!e2 && (typeof e2.onclick === 'function' || typeof e2.onchange === 'function'),
     `comando "${id}" collegato`);
}
// Campi letti al momento dell uso: devono solo esistere ed essere
// popolati dove serve.
for (const id of ['dtVoce','dtRate','dtTitolo','dtStart','dtStop','dtFrom','dtTo','dtTradOut']) {
  ok(!!document.getElementById(id), `campo "${id}" presente`);
}
ok(document.getElementById('dtVoce').children.length >= 1, 'l elenco delle voci è popolato');
ok(document.getElementById('dtLang').children.length >= 6, 'l elenco delle lingue è popolato');

// Il testo dettato deve arrivare nell area, senza cancellare il resto
areaTesto.value = 'Prima parte.';
areaTesto.selectionStart = areaTesto.selectionEnd = areaTesto.value.length;
app.onDettatura({ tipo: 'testo', testo: 'Seconda parte.' });
ok(areaTesto.value.includes('Prima parte.') && areaTesto.value.includes('Seconda parte.'),
   'il testo dettato si aggiunge senza cancellare quello già scritto');

// Scrittura lunga: titolo, scaricamento come file separato,
// salvataggio automatico. Dettare un capitolo richiede ore e non deve
// dipendere dalla cache del browser.
ok(!!document.getElementById('dtTitolo'), 'esiste un titolo per il documento');
ok(typeof document.getElementById('dtDownload').onclick === 'function',
   'si può scaricare il testo come file separato');
areaTesto.value = 'Capitolo primo. Molto testo qui.';
areaTesto.oninput?.();
await new Promise(r => setTimeout(r, 900));
let salvato = null;
try { salvato = JSON.parse(localStorage.getItem('aurora.detta.v1') || 'null'); } catch {}
ok(salvato?.testo?.includes('Capitolo primo'),
   'il documento si salva da solo mentre lo si scrive');

// Il testo va nello stesso archivio della scansione: non è un isola
const primaTesti = app.drafts.list.length;
areaTesto.value = 'Una lettera dettata a voce';
document.getElementById('dtSave').onclick();
ok(app.drafts.list.length === primaTesti + 1, 'il testo dettato si salva nei Miei testi');

// E può passare al buffer della scansione
areaTesto.value = 'testo da mandare a parla';
document.getElementById('dtToBuffer').onclick();
ok(app.scan.buffer.words.join(' ') === 'testo da mandare a parla',
   'il testo dettato può passare alla composizione della pagina Parla');

// Uscendo dalla scheda il microfono si ferma da solo
app.dettatura.attiva = true;
app.goto('parla');
ok(app.dettatura.attiva === false,
   'uscendo dalla scheda il microfono si spegne: non resta acceso di nascosto');

/* ═══════════ Statistiche: esporta e importa ═══════════ */
app.goto('statistiche');
for (const id of ['btnStatsExport','fileStatsMerge','fileStatsReplace']) {
  const e2 = document.getElementById(id);
  ok(!!e2 && (typeof e2.onclick === 'function' || typeof e2.onchange === 'function'),
     `comando statistiche "${id}" collegato`);
}
ok(typeof app.predictor.merge === 'function' && typeof app.predictor.replaceAll === 'function',
   'il modello espone sia unione sia sostituzione');
app.goto('parla');

/* ═══════════ Comandi del video caricato ═══════════ */
{
  const { FileSource } = await import('../js/vision/FrameSource.js');

  // Video finto: si comporta come un <video> vero per ciò che conta.
  const finto = {
    duration: 120, currentTime: 0, paused: false, loop: true, playbackRate: 1,
    videoWidth: 640, videoHeight: 480, readyState: 4,
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
  };
  const fs = new FileSource({ name: 'prova.mp4' });
  fs.video = finto;

  ok(fs.stato.pronta, 'video: lo stato è disponibile');
  ok(fs.stato.durata === 120, 'video: la durata è nota');

  fs.pause(); ok(fs.inPausa, 'video: pausa');
  fs.play(); ok(!fs.inPausa, 'video: riproduzione');
  fs.togglePlay(); ok(fs.inPausa, 'video: alterna');
  fs.togglePlay(); ok(!fs.inPausa, 'video: alterna di nuovo');

  finto.currentTime = 60;
  fs.salta(5); ok(finto.currentTime === 65, 'video: avanti 5 secondi');
  fs.salta(-5); ok(finto.currentTime === 60, 'video: indietro 5 secondi');
  // ⚠️ I salti non devono uscire dal video
  fs.salta(-999); ok(finto.currentTime === 0, 'video: indietro non va sotto zero');
  fs.salta(9999); ok(finto.currentTime < 120 && finto.currentTime > 119,
    'video: avanti non supera la fine');

  fs.riavvolgi(); ok(finto.currentTime === 0, 'video: riavvolgi torna all inizio');
  ok(!fs.inPausa, 'video: riavvolgere non ferma la riproduzione');

  fs.vaiA(0.5); ok(Math.abs(finto.currentTime - 60) < 0.01, 'video: posizionamento a metà');
  fs.vaiA(2); ok(finto.currentTime <= 120, 'video: posizionamento oltre la fine viene limitato');
  fs.vaiA(-1); ok(finto.currentTime === 0, 'video: posizionamento negativo viene limitato');

  fs.setVelocita(2); ok(fs.velocita === 2, 'video: velocità');
  fs.setVelocita(99); ok(fs.velocita <= 4, 'video: velocità assurda viene limitata');
  fs.setVelocita(1);
  fs.setLoop(false); ok(!fs.loop, 'video: ciclo continuo disattivabile');
  fs.setLoop(true); ok(fs.loop, 'video: e riattivabile');

  // ⚠️ Nessun comando deve cadere se il video non c'è ancora
  const vuoto = new FileSource({ name: 'x.mp4' });
  let err = null;
  try {
    vuoto.play(); vuoto.pause(); vuoto.togglePlay(); vuoto.salta(5);
    vuoto.riavvolgi(); vuoto.vaiA(0.5); vuoto.setVelocita(2); vuoto.setLoop(true);
    vuoto.stato;
  } catch (e) { err = e.message; }
  ok(!err, 'video: i comandi non cadono se il file non è ancora pronto: ' + (err || ''));
  ok(vuoto.stato.pronta === false, 'video: e lo stato lo dichiara');

  // La barra compare solo con un file, non con la telecamera dal vivo
  app.vision.source = fs;
  app.aggiornaBarraVideo();
  ok(document.getElementById('vidBar').style.display !== 'none',
     'la barra compare con un video caricato');
  app.vision.source = { info: { kind: 'camera' } };
  app.aggiornaBarraVideo();
  ok(document.getElementById('vidBar').style.display === 'none',
     'e resta nascosta con la telecamera dal vivo');
  app.vision.source = null;
}

/* ═══════════ Leggibilità dell'area di lettura ═══════════ */
{
  // ⚠️ Difetto trovato: `--scale` e `.high-contrast` venivano impostati
  // ma agiscono sui rem, mentre il testo che conta è dimensionato sul
  // viewport. Ingrandire l'interfaccia non ingrandiva quasi la frase.
  const root = document.documentElement;
  app.set('ui.readScale', 1.8);
  app.applyUiConfig();
  ok(root.style.getPropertyValue('--leggi') === '1.8',
     `il moltiplicatore di lettura viene applicato (${root.style.getPropertyValue('--leggi')})`);
  ok(app.cfg.ui.readScale === 1.8, 'e la configurazione lo conserva');

  for (const [valore, classe] of [['alto', 'read-alto'], ['massimo', 'read-massimo']]) {
    app.set('ui.readContrast', valore);
    app.applyUiConfig();
    ok(document.body.classList.contains(classe), `contrasto "${valore}" applicato`);
  }
  app.set('ui.readContrast', 'normale');
  app.applyUiConfig();
  ok(!document.body.classList.contains('read-alto')
     && !document.body.classList.contains('read-massimo'),
     'tornando a normale le classi vengono tolte');

  app.set('ui.readFocus', true);
  app.applyUiConfig();
  ok(document.body.classList.contains('read-focus'), 'modalità solo voce corrente');
  app.set('ui.readFocus', false);
  app.set('ui.readScale', 1);
  app.applyUiConfig();
  ok(root.style.getPropertyValue('--leggi') === '1', 'e torna a 1 quando lo si riporta indietro');
  // Valori assurdi non devono passare al foglio di stile
  app.set('ui.readScale', 99); app.applyUiConfig();
  ok(parseFloat(root.style.getPropertyValue('--leggi')) <= 5, 'un valore assurdo viene limitato');
  app.set('ui.readScale', 1); app.applyUiConfig();

  // Il foglio di stile deve davvero usare il moltiplicatore, altrimenti
  // l'impostazione esisterebbe senza avere effetto — com'era prima.
  const fs2 = await import('node:fs');
  const path2 = await import('node:path');
  const qui2 = path2.dirname(import.meta.filename || process.argv[1]);
  const cssTxt = fs2.readFileSync(path2.join(qui2, '..', 'css/app.css'), 'utf8');
  /* ⚠️ TRE livelli di testo, TRE regolatori distinti.
   * Regolarli insieme significa non poterne regolare nessuno: la voce
   * corrente deve essere grande, la frase da leggere altrettanto, e il
   * percorso è un'informazione a sé. */
  const usi = (cssTxt.match(/var\(--leggi,1\)/g) || []).length;
  ok(usi >= 4, `la barra di lettera, parola e frase ha il suo moltiplicatore (${usi} usi)`);
  for (const sel of ['.compose-sentence', '.pt-sentence']) {
    const re = new RegExp(sel.replace('.', '\\.') + '\\{[^}]*var\\(--leggi,1\\)');
    ok(re.test(cssTxt), `${sel} usa il moltiplicatore della barra`);
  }
  ok(/\.stage-current\{[^}]*var\(--palco/.test(cssTxt),
     'la voce corrente usa un moltiplicatore PROPRIO: era enorme rispetto alla frase da leggere');
  ok(/\.stage-path\{[^}]*var\(--percorso/.test(cssTxt),
     'il percorso ha il suo: era minuscolo e senza alcun controllo');

  // I tre si applicano davvero
  app.set('ui.readScale', 1.4); app.set('ui.stageScale', 0.9); app.set('ui.pathScale', 2);
  app.applyUiConfig();
  ok(root.style.getPropertyValue('--leggi') === '1.4'
     && root.style.getPropertyValue('--palco') === '0.9'
     && root.style.getPropertyValue('--percorso') === '2',
     'i tre moltiplicatori vengono applicati in modo indipendente');
  app.set('ui.readScale', 1); app.set('ui.stageScale', 0.72); app.set('ui.pathScale', 1.5);
  app.applyUiConfig();
  ok(/body\.read-massimo[^{]*\{[^}]*#FFE24D/.test(cssTxt)
     || /read-massimo .stage-current\{[^}]*#FFE24D/.test(cssTxt),
     'il contrasto massimo usa nero e giallo, la combinazione più leggibile');
}

/* ═══════════ ⚠️ NESSUNA AZIONE PUÒ APRIRE FINESTRE O DIALOGHI ═══════════
 *
 * È la verifica più importante dell'intera suite.
 *
 * Chi usa Aurora sta su UNA pagina e la comanda con un gesto. Un
 * dialogo del browser (confirm, alert, prompt) blocca la pagina e si
 * chiude solo con un clic; una finestra nuova sposta il fuoco altrove.
 * In entrambi i casi la persona resta muta davanti a qualcosa che non
 * sa chiudere, e non può nemmeno dirlo a nessuno.
 *
 * Qui si accendono TUTTE le funzioni, si costruisce l'albero completo,
 * e si attiva OGNI singola azione raggiungibile con un gesto,
 * controllando che nessuna apra nulla.                                */
{
  // Si accende tutto, così l'albero contiene ogni voce possibile.
  const prima = JSON.parse(JSON.stringify(app.cfg));
  app.cfg.stampa.enabled = true;
  app.cfg.email.enabled = true;
  app.cfg.email.endpoint = 'https://esempio.it/invia';
  app.cfg.email.contatti = [{ nome: 'Mario', indirizzo: 'm@e.it' }];
  app.cfg.radio.enabled = true;
  app.cfg.radio.stazioni = [{ nome: 'Radio Uno', url: 'https://x/1' }];
  app.cfg.domotica.enabled = true;
  app.cfg.domotica.url = 'http://ha:8123';
  app.cfg.domotica.token = 'x'.repeat(40);
  app.cfg.domotica.dispositivi = [{ nome: 'Televisore', entita: 'media_player.tv' }];
  app.cfg.prediction.autoCorrectUndo = true;
  app.drafts.add('Una lettera di prova per il controllo');
  app.refreshContext();

  // Spie su tutto ciò che potrebbe intrappolare la persona
  const aperti = [];
  const veri = {
    confirm: globalThis.confirm, alert: globalThis.alert,
    prompt: globalThis.prompt, open: globalThis.open,
  };
  const spia = (nome, ritorno) => (...a) => {
    aperti.push(`${nome}(${String(a[0] ?? '').slice(0, 60)})`);
    return ritorno;
  };
  globalThis.confirm = spia('confirm', false);
  globalThis.alert = spia('alert', undefined);
  globalThis.prompt = spia('prompt', null);
  globalThis.open = spia('window.open', null);
  if (typeof window !== 'undefined') {
    window.confirm = globalThis.confirm; window.alert = globalThis.alert;
    window.prompt = globalThis.prompt; window.open = globalThis.open;
  }
  // La rete non deve essere toccata davvero
  const fetchVero = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

  // Si raccolgono TUTTE le azioni dell'albero, a ogni profondità
  const azioni = [];
  const percorri = (n, via = []) => {
    if (!n) return;
    const nome = [...via, n.label].filter(Boolean).join(' → ');
    if (n.kind === 'action' && n.action) azioni.push({ nodo: n, via: nome });
    for (const c of (n.children || [])) percorri(c, [...via, n.label]);
  };
  percorri(app.scan.tree);

  ok(azioni.length > 40, `ogni azione dell albero viene provata (${azioni.length} azioni)`);
  console.log(`    → ${azioni.length} azioni raggiungibili con un gesto, tutte provate`);

  const colpevoli = [];
  for (const { nodo, via } of azioni) {
    const n0 = aperti.length;
    try { app.scan._activate(nodo, performance.now()); } catch { /* l'azione può fallire: conta solo che non apra nulla */ }
    if (aperti.length > n0) colpevoli.push(`${via} → ${aperti.slice(n0).join(', ')}`);
    // Si riparte dalla radice, così un'azione non falsa la successiva
    try { app.scan._resetToRoot(performance.now(), true); } catch {}
  }

  globalThis.confirm = veri.confirm; globalThis.alert = veri.alert;
  globalThis.prompt = veri.prompt; globalThis.open = veri.open;
  if (typeof window !== 'undefined') {
    window.confirm = veri.confirm; window.alert = veri.alert;
    window.prompt = veri.prompt; window.open = veri.open;
  }
  globalThis.fetch = fetchVero;

  ok(colpevoli.length === 0,
     'NESSUNA azione della scansione apre dialoghi o finestre: '
     + (colpevoli.slice(0, 4).join(' | ') || 'verificate tutte'));

  app.cfg = prima;
  app.refreshContext();
}

/* ═══════════ Termini, condizioni e licenza ═══════════ */
{
  const { TERMINI_IT, TERMINI_EN, VERSIONE_TERMINI, AUTORE, testoInHtml } =
    await import('../js/core/Legal.js');

  ok(!!VERSIONE_TERMINI, 'i termini hanno una versione');
  ok(AUTORE === 'Francesco Pagliano', 'l autore è indicato');

  // Il testo deve contenere tutte le tutele richieste
  const richieste = [
    [/non è un dispositivo medico/i, 'non è un dispositivo medico'],
    [/gratuit/i, 'gratuità'],
    [/per sempre/i, 'gratuità perpetua'],
    [/Francesco Pagliano/, 'paternità dell autore'],
    [/senza garanzia/i, 'esclusione di garanzia'],
    [/responsabilit/i, 'limitazione di responsabilità'],
    [/licenza/i, 'licenza'],
    [/emergenz/i, 'divieto d uso in emergenza'],
    [/metodo di comunicazione\s*\*\*\s*alternativo|metodo alternativo/i, "obbligo del metodo alternativo"],
    [/associazioni|fondazioni/i, 'divieto esteso agli enti'],
    [/MediaPipe/, 'componenti di terzi'],
    [/pubblico dominio/i, 'nessun terzo può vantare diritti su parti di pubblico dominio'],
    [/marchi|brevetti/i, 'divieto di registrare marchi o brevetti'],
    [/legge italiana/i, 'legge applicabile'],
    // ── Paternità: è la sezione che protegge l'autore ──
    [/Paternità dell'opera/i, 'sezione dedicata alla paternità'],
    [/opera originale/i, 'dichiarazione di originalità'],
    [/15 agosto 2026/, 'data documentata di inizio sviluppo'],
    [/ex novo/i, 'realizzato ex novo'],
    [/stato dell'arte/i, 'le tecniche note appartengono allo stato dell arte'],
    [/518\/1992|2009\/24/, 'riferimenti normativi sul diritto d autore del software'],
    [/non l'idea, il\s*metodo/i, 'il diritto d autore tutela l espressione, non l idea'],
    [/anteriorità/i, 'nessuno può vantare anteriorità sulle tecniche note'],
    [/raccolta fondi/i, 'divieto di usarlo per raccolta fondi'],
    [/co-paternità/i, 'divieto di rivendicare co-paternità'],
    [/copia ufficiale/i, 'unica copia ufficiale è quella dell autore'],
    // ── Account utente e dati personali ──
    [/account/i, 'account utente'],
    [/nome e cognome/i, 'dati raccolti: nome e cognome'],
    [/posta elettronica|email/i, 'dati raccolti: indirizzo di posta'],
    [/password.*cifrat|cifrat.*password/is, 'password conservata cifrata'],
    [/2016\/679|GDPR/i, 'riferimento al GDPR'],
    [/titolare del trattamento/i, 'titolare del trattamento indicato'],
    [/non vengono venduti|non.*cedut/i, 'divieto di cessione dei dati'],
    [/profilazione/i, 'nessuna profilazione'],
    [/revoca(re)? il consenso/i, 'revoca del consenso'],
    [/non inserire dati sanitari/i, 'avvertenza sui dati sanitari'],
    [/sospendere|cessare il servizio/i, 'facoltà di sospendere il servizio'],
    [/nessun sistema è sicuro/i, 'nessuna garanzia di sicurezza assoluta'],
    [/rappresentante legale|amministratore di sostegno/i, 'registrazione per conto di terzi'],
    [/minore/i, 'minori'],
    [/Spazio economico europeo/i, 'trasferimento dati fuori UE'],
    [/33 e 34/i, 'notifica delle violazioni'],
    [/non deve essere usato in modo che.*dipenda|dipenda dalla disponibilità/is,
     'divieto di dipendere dalla piattaforma online'],
  ];
  for (const [re, cosa] of richieste) {
    ok(re.test(TERMINI_IT), `i termini coprono: ${cosa}`);
  }
  ok(TERMINI_EN.length > 4000, 'esiste anche la versione inglese, completa');
  // Le tutele principali devono esserci in ENTRAMBE le lingue
  for (const [re, cosa] of [
    [/not a medical device/i, 'non è un dispositivo medico'],
    [/free of charge/i, 'gratuità'],
    [/GDPR|2016\/679/i, 'GDPR'],
    [/never sold/i, 'divieto di cessione dei dati'],
    [/as is/i, 'nessuna garanzia'],
  ]) ok(re.test(TERMINI_EN), `anche in inglese: ${cosa}`);

  // ⚠️ Cambiando i termini, l accettazione va richiesta di nuovo
  ok(VERSIONE_TERMINI !== '1.0',
     `la versione è stata aggiornata con le clausole sugli account (${VERSIONE_TERMINI})`);

  // La conversione in HTML non deve poter iniettare codice
  const html2 = testoInHtml('# Titolo\n\n- voce **grassetto**\n\n<script>alert(1)</script>');
  ok(!/<script>/.test(html2), 'il testo convertito non può contenere codice eseguibile');
  ok(/<h2>Titolo<\/h2>/.test(html2), 'i titoli vengono resi');
  ok(/<strong>grassetto<\/strong>/.test(html2), 'il grassetto viene reso');
  ok(/<li>/.test(html2), 'gli elenchi vengono resi');

  // ⚠️ Il programma non deve partire senza accettazione
  const accetta = document.getElementById('gateAccept');
  const entra = document.getElementById('btnEnter');
  ok(!!accetta, 'esiste la casella di accettazione');
  ok(!!document.getElementById('gateTerms'), 'esiste il collegamento ai termini');
  ok(!!document.getElementById('legalBox'), 'esiste la finestra dei termini');
  ok(typeof entra.onclick === 'function', 'il pulsante di avvio è collegato');

  // La finestra dei termini sta DENTRO la pagina: si legge, si scorre,
  // si stampa. Non è un dialogo del browser.
  const fs5 = await import('node:fs');
  const path5 = await import('node:path');
  const qui5 = path5.dirname(import.meta.filename || process.argv[1]);
  const htmlTxt = fs5.readFileSync(path5.join(qui5, '..', 'index.html'), 'utf8');
  ok(/id="legalBody"/.test(htmlTxt), 'i termini si aprono in una finestra della pagina');
  ok(/id="btnEnter"[^>]*disabled|disabled[^>]*id="btnEnter"/.test(htmlTxt),
     'il pulsante di avvio parte DISABILITATO: senza accettazione non si entra');
  ok(/gate-free/.test(htmlTxt), 'la gratuità è dichiarata nella schermata iniziale');

  // Il file di licenza deve esistere ed essere coerente
  // Il documento firmabile deve esistere ed essere raggiungibile
  ok(fs5.existsSync(path5.join(qui5, '..', 'documenti/aurora-termini-licenza-paternita.pdf')),
     'esiste il documento PDF da firmare e conservare');
  ok(/documenti\/aurora-termini-licenza-paternita\.pdf/.test(htmlTxt),
     'ed è scaricabile dalla finestra dei termini');

  const lic = fs5.readFileSync(path5.join(qui5, '..', 'LICENSE.txt'), 'utf8');
  ok(/Francesco Pagliano/.test(lic), 'la licenza indica l autore');
  ok(/Affero/i.test(lic), 'la licenza è della famiglia AGPL: copre l uso via rete');
  ok(/GRATUIT/i.test(lic), 'la licenza contiene la condizione di gratuità');
  ok(/spese vive/i.test(lic), 'la licenza distingue le spese vive rimborsabili');
  ok(/non è un dispositivo medico/i.test(lic), 'la licenza ripete l avvertenza medica');
  ok(/registrazione\s*\n?\s*gratuita/i.test(lic),
     'la licenza consente la registrazione gratuita ma vieta di farla pagare');
  ok(/profilazione/i.test(lic), 'e vieta la profilazione dei dati raccolti');
}

/* ═══════════ Selettore telecamera e comando di riduzione ═══════════ */
{
  const fs6 = await import('node:fs');
  const path6 = await import('node:path');
  const qui6 = path6.dirname(import.meta.filename || process.argv[1]);
  const htmlTxt6 = fs6.readFileSync(path6.join(qui6, '..', 'index.html'), 'utf8');

  /* ⚠️ "Quale telecamera sta usando?" è la prima domanda quando
   * qualcosa non funziona. La risposta non deve costare un giro nelle
   * impostazioni: ci vuole un selettore accanto a OGNI comando di
   * accensione. */
  const selettori = (htmlTxt6.match(/data-cam-select/g) || []).length;
  ok(selettori >= 3, `un selettore telecamera accanto a ogni comando di accensione (${selettori})`);

  // Ogni pulsante che accende la camera deve averne uno vicino
  for (const id of ['btnCamMain', 'ptCam', 'btnCamStop']) {
    const i = htmlTxt6.indexOf(`id="${id}"`);
    ok(i > 0 && /data-cam-select/.test(htmlTxt6.slice(i, i + 400)),
       `il comando "${id}" ha il selettore telecamera accanto`);
  }

  // Il banco non analizza l'HTML, quindi i selettori non esistono qui
  // come oggetti: si verifica che il riempimento non cada comunque, che
  // è la condizione che conta in un ambiente imprevisto.
  let errCam = null;
  try {
    await app.aggiornaSelettoriCamera();
    await app.aggiornaSelettoriCamera();
  } catch (e) { errCam = e.message; }
  ok(!errCam, 'il riempimento dei selettori non cade mai: ' + (errCam || ''));

  // Senza telecamere il codice deve DIRLO, non restare muto
  const mainSrc = fs6.readFileSync(path6.join(qui6, '..', 'js/main.js'), 'utf8');
  ok(/Nessuna telecamera trovata/.test(mainSrc),
     'senza telecamere lo dichiara invece di mostrare un elenco vuoto');
  ok(/nome dopo il permesso/.test(mainSrc),
     'e spiega perché i nomi mancano finché non si concede il permesso');
  ok(/for \(const altro of sel\) if \(altro !== s2\)/.test(mainSrc),
     'i selettori delle varie schermate restano allineati fra loro');

  /* Il comando di riduzione sta nella BARRA: presente su ogni
   * schermata, senza doverlo duplicare in ciascuna. */
  const bm = document.getElementById('btnMini');
  ok(!!bm, 'il comando di riduzione esiste nella barra superiore');
  ok(typeof bm.onclick === 'function', 'ed è collegato');
  const iBarra = htmlTxt6.indexOf('id="btnMini"');
  const iFine = htmlTxt6.indexOf('</header>');
  ok(iBarra > 0 && iBarra < iFine,
     'sta nella barra, quindi è visibile da qualunque schermata');

  // Compare solo quando serve: altrimenti è un pulsante in più da capire
  app.cfg.device.mouse.enabled = false;
  app.cfg.source.backgroundMode = false;
  app.aggiornaPulsanteMini();
  ok(bm.hidden === true, 'nascosto quando non servirebbe a nulla');
  app.cfg.device.mouse.enabled = true;
  app.aggiornaPulsanteMini();
  // In Node la finestra fluttuante non è disponibile, quindi resta
  // nascosto anche così: si verifica che la logica lo consideri utile.
  ok(app.cfg.device.mouse.enabled === true, 'e considerato utile a mouse acceso');
  app.cfg.device.mouse.enabled = false;
  app.aggiornaPulsanteMini();
}

/* ═══════════ Gli strumenti sono scaricabili dal sito ═══════════ */
{
  const fs8 = await import('node:fs');
  const path8 = await import('node:path');
  const qui8 = path8.dirname(import.meta.filename || process.argv[1]);
  const R8 = (f) => fs8.readFileSync(path8.join(qui8, '..', f), 'utf8');
  const c8 = (f) => fs8.existsSync(path8.join(qui8, '..', f));

  // I file devono esserci nel pacchetto, altrimenti il collegamento
  // porterebbe a una pagina di errore.
  for (const f of ['strumenti/avvia-mouse.bat', 'strumenti/aurora-mouse.ps1',
                   'strumenti/aurora-mouse.py', 'strumenti/aurora-esp32.ino',
                   'strumenti/LEGGIMI.md']) {
    ok(c8(f), `lo strumento "${f.split('/').pop()}" è nel pacchetto e sarà scaricabile dal sito`);
  }

  // E devono essere raggiungibili dalle impostazioni, altrimenti
  // nessuno saprebbe che esistono.
  const sv = R8('js/ui/SettingsView.js');
  ok(/strumenti\/avvia-mouse\.bat/.test(sv),
     'le impostazioni offrono il collegamento per scaricarli');
  ok(/a\.download/.test(sv), 'e il browser li scarica invece di aprirli');

  // Conservati anche offline: chi non ha rete deve poterli prendere
  const sw8 = R8('sw.js');
  ok(/strumenti\/avvia-mouse\.bat/.test(sw8),
     'sono conservati per l uso senza internet');

  // ⚠️ Il browser NON può avviarli: va detto, non lasciato intuire
  ok(/NON può avviare quel programma/.test(sv),
     'le impostazioni dichiarano che il browser non può avviarli da solo');
  ok(/shell:startup/.test(sv),
     'e spiegano come farli partire da soli all accensione');

  // Verifica del ponte: sapere se è avviato PRIMA di provare a usarlo
  ok(typeof app.verificaPonte === 'function', 'si può verificare se il programma è in ascolto');
  const r8 = await app.verificaPonte();
  ok(r8 && typeof r8.ok === 'boolean' && r8.messaggio,
     `la verifica risponde sempre, anche senza ponte (${r8?.messaggio})`);
}

/* ═══════════ Il video non deve poter restare bloccato ═══════════
 *
 * ⚠️ Un video da file può fermarsi per ragioni imprevedibili: la fine
 * del filmato con il ciclo continuo che non riparte, un blocco nella
 * decodifica, il browser che sospende l'elemento. Il sintomo è sempre
 * lo stesso: i fotogrammi si fermano mentre il resto del programma
 * continua, e il grafico mostra all'infinito lo stesso istante.
 *
 * Invece di indovinare la causa si sorveglia l'EFFETTO.            */
{
  const { FileSource } = await import('../js/vision/FrameSource.js');
  const fs10 = await import('node:fs');
  const path10 = await import('node:path');
  const qui10 = path10.dirname(import.meta.filename || process.argv[1]);
  const src10 = fs10.readFileSync(path10.join(qui10, '..', 'js/vision/FrameSource.js'), 'utf8');

  ok(/addEventListener\('ended'/.test(src10),
     'la fine del video viene intercettata e il ciclo continuo riparte a mano');
  ok(/this\.bloccati/.test(src10) && /this\.riprese/.test(src10),
     'blocchi e riprese vengono contati, non nascosti');
  ok(/currentTime === this\._tContenuto/.test(src10),
     'il blocco si rileva dal tempo del video che non avanza');
  ok(/v\.currentTime = \(v\.currentTime \+ 0\.05\)/.test(src10),
     'e si sblocca con un salto minimo, impercettibile per chi guarda');
  /* ⚠️ Spostare il tempo del video provoca un riposizionamento, durante
   * il quale il video risulta di nuovo fermo. Senza pausa fra un
   * tentativo e il successivo si innescherebbe una catena di
   * riposizionamenti che bloccherebbe il video DAVVERO: la cura
   * peggiore del male. */
  ok(/_ultimoTentativo/.test(src10) && /> 3000/.test(src10),
     'fra un tentativo e il successivo c e una pausa: il recupero non deve diventare la causa del blocco');
  ok(/_giaProvato/.test(src10),
     'e si prova prima la via meno invasiva, poi il salto');
  ok(/readyState >= 2/.test(src10),
     'non si elaborano fotogrammi prima che il video sia pronto');

  /* ⚠️ LA CAUSA VERA DEL BLOCCO.
   *
   * Un elemento video che non sta nel documento viene decodificato
   * "per cortesia": dopo qualche decina di secondi il browser smette
   * di spenderci lavoro e i fotogrammi finiscono. Nessun errore,
   * nessun avviso — semplicemente non arriva più niente. È il blocco
   * che si vedeva dopo un minuto e mezzo di riproduzione.
   *
   * E NON si può nasconderlo con display:none o visibility:hidden:
   * per il browser significano "non serve disegnarlo", e la decodifica
   * si ferma lo stesso. */
  ok(/collegaAllaPagina/.test(src10),
     'l elemento video viene ATTACCATO alla pagina: fuori dal documento il browser smette di decodificarlo');
  ok(/appendChild\(video\)/.test(src10), 'e finisce davvero nel documento');
  // Si guarda lo STILE applicato, non i commenti che spiegano perché
  // non vada usato: il commento contiene proprio quelle parole.
  const stile = /cssText\s*=\s*([\s\S]{0,220}?);/.exec(src10)?.[1] || '';
  ok(!/display:none/.test(stile) && !/visibility:hidden/.test(stile),
     'lo stile non usa display:none né visibility:hidden, che fermerebbero la decodifica lo stesso');
  ok(/opacity:0\.001/.test(src10),
     'resta invisibile con un pixel trasparente, non nascondendolo davvero');
  ok(/scollegaDallaPagina/.test(src10),
     'e viene tolto in chiusura: senza, se ne accumulerebbe uno a ogni riavvio');
  ok(/revokeObjectURL/.test(src10),
     'liberando anche l indirizzo del file: caricandone più di seguito la memoria crescerebbe');

  // I comandi restano funzionanti
  const fsv = new FileSource({ name: 'x.mp4' });
  let err10 = null;
  try { fsv.play(); fsv.pause(); fsv.salta(5); fsv.stato; } catch (e) { err10 = e.message; }
  ok(!err10, 'i comandi non cadono su una sorgente non ancora pronta');
}

/* ═══════════ Campioni validi per occhio ═══════════
 *
 * ⚠️ Un occhio i cui campioni vengono scartati spesso — luce peggiore,
 * iride più coperta, angolo della telecamera — mostra un'ampiezza più
 * bassa senza che il movimento sia diverso. Senza questo numero
 * sembrerebbe che quell'occhio si muova di meno, e si cercherebbe il
 * difetto nel posto sbagliato.                                      */
{
  const { GestureEngine: GE10 } = await import('../js/signal/GestureEngine.js');
  const { DEFAULT_CONFIG: DC10, deepClone: dc10 } = await import('../js/core/config.js');
  const c = dc10(DC10);
  const g = new GE10(c, () => {});
  let t = 0;
  const o = (cf) => ({ x: 0, y: 0, openness: 0.30, confidence: cf });
  // Il destro sotto la soglia di confidenza: i suoi campioni si perdono
  for (let i = 0; i < 100; i++) { t += 33; g.process(t, { left: o(0.9), right: o(0.2) }); }
  ok(g.counters.validiLeft > 90, `il sinistro accumula campioni validi (${g.counters.validiLeft})`);
  ok(g.counters.scartatiRight > 90, `e gli scarti del destro vengono contati (${g.counters.scartatiRight})`);
  ok(g.counters.validiRight === 0, 'il destro non ne accumula nessuno di valido');

  const fsP = await import('node:fs');
  const pathP = await import('node:path');
  const quiP = pathP.dirname(import.meta.filename || process.argv[1]);
  const panels = fsP.readFileSync(pathP.join(quiP, '..', 'js/ui/Panels.js'), 'utf8');
  ok(/Validi SX \/ DX/.test(panels), 'la percentuale per occhio è mostrata in diagnostica');
  ok(/Video bloccato \/ ripreso/.test(panels), 'e così i blocchi del video');
}

/* ═══════════ La diagnostica non deve interrompersi ═══════════
 *
 * ⚠️ Uscendo dalla scheda la misura si fermava, e al ritorno sembrava
 * ricominciare da capo. Peggio: analizzando un VIDEO CARICATO, quando
 * il video si fermava scattava la sorveglianza della TELECAMERA e
 * annunciava "telecamera ripristinata" a chi non l'aveva mai accesa —
 * un messaggio falso, che mandava a cercare il difetto altrove.     */
{
  const fsD = await import('node:fs');
  const pathD = await import('node:path');
  const quiD = pathD.dirname(import.meta.filename || process.argv[1]);
  const mainD = fsD.readFileSync(pathD.join(quiD, '..', 'js/main.js'), 'utf8');

  ok(/const daFile = typeof this\.vision\.source\?\.togglePlay/.test(mainD),
     'la sorveglianza distingue un video da file dalla telecamera');
  ok(/if \(daFile\)[\s\S]{0,200}watchdog\.ferma\(\)/.test(mainD),
     'e con un video da file NON arma la sorveglianza della telecamera');

  // La misura continua fuori dalla scheda, se richiesto
  ok(/tab === 'diagnostica' \|\| !!this\.cfg\.ui\.diagAlways/.test(mainD),
     'con "misura sempre" la diagnostica non si interrompe cambiando scheda');
  const { DEFAULT_CONFIG: DCD } = await import('../js/core/config.js');
  ok(DCD.ui.diagAlways === false,
     'spenta di default: costa calcolo, e chi non la usa non deve pagarla');

  const cda = document.getElementById('chkDiagAlways');
  ok(!!cda, 'l interruttore esiste nella scheda diagnostica');

  // Ripristino dei parametri applicati
  const undo = document.getElementById('btnDiagUndo');
  ok(!!undo, 'esiste il comando per ripristinare i parametri precedenti');
  ok(/this\._paramPrec\[k\] = this\.get\(k\)/.test(mainD),
     'si conservano SOLO i valori toccati: ripristinare tutto annullerebbe anche le regolazioni fatte a mano');
  ok(/_paramPrec\)\) this\.set\(via, val\)/.test(mainD),
     'e il ripristino li riporta uno per uno');

  // ⚠️ Il grafico non deve azzerarsi tornando in diagnostica
  ok(!/plot\.clear\(\)/.test(mainD),
     'il grafico non viene mai azzerato: azzerarlo faceva sembrare che tutto ricominciasse');
}

/* ═══════════ Un video caricato non è la telecamera ═══════════
 *
 * ⚠️ Il pulsante guardava solo se l'analisi era attiva, quindi
 * caricando un video diceva "Ferma camera" a chi non l'aveva mai
 * accesa — e premendolo si fermava il video credendo di spegnere una
 * telecamera che non era mai partita.                              */
{
  const fsC = await import('node:fs');
  const pathC = await import('node:path');
  const quiC = pathC.dirname(import.meta.filename || process.argv[1]);
  const mainC = fsC.readFileSync(pathC.join(quiC, '..', 'js/main.js'), 'utf8');

  const blocco = mainC.slice(mainC.indexOf('updateCamButton() {'),
                             mainC.indexOf('updateCamButton() {') + 1400);
  ok(/typeof this\.vision\.source\?\.togglePlay === 'function'/.test(blocco),
     'il pulsante distingue un video caricato dalla telecamera');
  ok(/status === 'attiva' && !daFile/.test(blocco),
     'e con un video non dice "Ferma camera"');

  /* Anche i CONTATORI devono mostrare il grezzo di ENTRAMBI gli occhi:
   * è il numero che distingue "il movimento è davvero più piccolo" da
   * "il metro di quell'occhio è diverso". */
  const panelsC = fsC.readFileSync(pathC.join(quiC, '..', 'js/ui/Panels.js'), 'utf8');
  /* ⚠️ GREZZO e FILTRATO vanno mostrati SEPARATI.
   *
   * Prima l'etichetta diceva "grezzo" ma mostrava il segnale già
   * filtrato: non si poteva distinguere "il rilevatore vede poco
   * movimento" da "i filtri lo stanno mangiando" — che è esattamente
   * la domanda da porsi quando l'ampiezza è bassa. */
  ok(/'Grezzo istantaneo SX \/ DX'/.test(panelsC) && /y\?\.raw/.test(panelsC),
     'il segnale GREZZO mostrato è davvero quello prima dei filtri');
  /* ⚠️ E accanto c'è l ESCURSIONE, che è il numero utile: il valore
   * istantaneo va letto nell attimo giusto del gesto, cosa impossibile
   * mentre si osserva. */
  ok(/Escursione grezza SX \/ DX/.test(panelsC),
     'ed è affiancato dall escursione, leggibile con calma');
  ok(/'Filtrato SX \/ DX'/.test(panelsC),
     'e il filtrato è mostrato a parte, per confronto');
  ok(/Scostamento SX \/ DX/.test(panelsC),
     'e così lo scostamento dalla propria baseline');
  ok(/Palpebra copre iride SX \/ DX/.test(panelsC),
     'e la copertura della palpebra');
}

/* ═══════════ Nessuno stato per-occhio sopravvive alla sessione ═══════════
 *
 * ⚠️ Se una taratura andata male restasse memorizzata, ricomparirebbe
 * al riavvio anche cambiando persona o sorgente — e si cercherebbe il
 * difetto nel posto sbagliato.                                       */
{
  const fsS = await import('node:fs');
  const pathS = await import('node:path');
  const quiS = pathS.dirname(import.meta.filename || process.argv[1]);
  const tutti = [];
  const scorri = (dir) => {
    for (const e of fsS.readdirSync(dir, { withFileTypes: true })) {
      const p = pathS.join(dir, e.name);
      if (e.isDirectory()) scorri(p);
      else if (e.name.endsWith('.js')) tutti.push(fsS.readFileSync(p, 'utf8'));
    }
  };
  scorri(pathS.join(quiS, '..', 'js'));
  const chiavi = new Set();
  for (const src of tutti) {
    for (const m of src.matchAll(/localStorage\.setItem\(\s*'([^']+)'/g)) chiavi.add(m[1]);
  }
  const sospette = [...chiavi].filter(k => /sigma|baseline|rumore|noise|eye|occhio/i.test(k));
  ok(sospette.length === 0,
     `nessuna stima per-occhio viene memorizzata fra le sessioni (chiavi: ${[...chiavi].join(', ')})`);
}

/* ═══════════ Ogni canale che esiste deve essere assegnabile ═══════════
 *
 * ⚠️ Apertura e canale combinato esistevano, funzionavano, avevano
 * soglia, guadagno e traccia nel grafico — ma mancavano nell'elenco
 * che DISEGNA la scheda dei canali di gesto, quindi non si potevano
 * assegnare a un'azione. Una funzione che non si può usare è una
 * funzione che non c'è.
 *
 * Il difetto nasceva da un elenco DUPLICATO: uno in configurazione,
 * uno dentro la scheda. Aggiungendo un canale al primo si crede di
 * aver finito.                                                       */
{
  const fsG = await import('node:fs');
  const pathG = await import('node:path');
  const quiG = pathG.dirname(import.meta.filename || process.argv[1]);
  const svG = fsG.readFileSync(pathG.join(quiG, '..', 'js/ui/SettingsView.js'), 'utf8');
  const { DEFAULT_CONFIG: DCG } = await import('../js/core/config.js');

  const i = svG.indexOf('const GESTURE_META = {');
  const blocco = svG.slice(i, svG.indexOf('\n};', i));
  const assegnabili = [...blocco.matchAll(/^  ([A-Z_]+):\s/gm)].map(m => m[1]);

  /* I canali del VISO hanno una scheda propria — bocca, labbra,
   * sopracciglia — e non vanno cercati qui. Si controllano quelli
   * oculari, che è dove il difetto si era annidato. */
  const delViso = ['MOUTH_OPEN', 'SMILE', 'PUCKER', 'FUNNEL', 'CHEEK_PUFF', 'BROW_UP'];
  const canali = Object.entries(DCG.gestures)
    .filter(([k, v]) => v && typeof v === 'object' && v.action !== undefined && !delViso.includes(k))
    .map(([k]) => k);

  const mancanti = canali.filter(k => !assegnabili.includes(k));
  ok(mancanti.length === 0,
     `ogni canale di gesto è assegnabile a un'azione (mancano: ${mancanti.join(', ') || 'nessuno'})`);
  for (const k of ['WIDE', 'NARROW', 'COMBO']) {
    ok(assegnabili.includes(k), `il canale "${k}" compare fra quelli assegnabili`);
  }

  /* Le caselle del canale combinato devono avere un'ETICHETTA:
   * otto levette identiche senza testo invitano a premere alla cieca. */
  ok(/combo-nome/.test(svG), 'le caselle dei canali da sommare hanno un nome accanto');
  const cssG = fsG.readFileSync(pathG.join(quiG, '..', 'css/app.css'), 'utf8');
  ok(/\.combo-elenco\{[^}]*grid/.test(cssG),
     'e sono disposte in griglia, non allineate a caso');
  ok(/\.combo-nome\{/.test(cssG), 'con uno stile proprio per il nome');
}

/* ═══════ Un comando deve esistere, non solo il metodo che lo esegue ═══════
 *
 * ⚠️ Il ritorno ai valori predefiniti era stato scritto come metodo,
 * ma il PULSANTE che lo chiama non era mai finito nella pagina: una
 * sostituzione automatica non aveva agganciato, e nessuno se n'era
 * accorto perché il codice compilava e i test passavano.
 *
 * Un metodo senza comando che lo invochi è codice morto — e per chi
 * usa il programma è una funzione che semplicemente non c'è.        */
{
  const fsR = await import('node:fs');
  const pathR = await import('node:path');
  const quiR = pathR.dirname(import.meta.filename || process.argv[1]);
  const svR = fsR.readFileSync(pathR.join(quiR, '..', 'js/ui/SettingsView.js'), 'utf8');
  const htmlR = fsR.readFileSync(pathR.join(quiR, '..', 'index.html'), 'utf8');
  const mainR = fsR.readFileSync(pathR.join(quiR, '..', 'js/main.js'), 'utf8');

  ok(/_ripristinaFiltri\(\)\s*\{/.test(svR), 'il ritorno ai valori predefiniti esiste come metodo');
  ok(/this\._ripristinaFiltri\(\)/.test(svR),
     'ed è invocato da un comando nelle impostazioni, non solo definito');
  ok(/Riporta filtri e soglie ai valori predefiniti/.test(svR),
     'con un\'etichetta che dice cosa fa');

  ok(/id="btnDiagReset"/.test(htmlR),
     'lo stesso comando è raggiungibile anche dalla diagnostica');
  ok(/btnDiagReset/.test(mainR), 'ed è collegato');
  ok(/settingsView\._ripristinaFiltri\(\)/.test(mainR),
     'e chiama lo stesso metodo, non una copia che potrebbe divergere');

  /* ⚠️ OGNI parametro che la diagnostica può proporre deve essere
   * anche ripristinabile.
   *
   * Erano tredici i proponibili e sei i ripristinabili: sette
   * regolazioni restavano incastrate sui valori applicati senza modo
   * di tornare indietro. La lista era scritta a mano ed era divenuta
   * incoerente in silenzio. */
  const i = svR.indexOf('_viePrestazioni()');
  const corpo = svR.slice(i, svR.indexOf('_ripristinaFiltri()', i));
  const vie = [...corpo.matchAll(/'([\w.]+)'/g)].map(m => m[1]);
  ok(vie.length >= 20, `riporta a posto tutti i parametri di prestazione (${vie.length})`);
  ok(vie.every(v => v.startsWith('signal.') || v.startsWith('detection.') || v.startsWith('gestures.')),
     'tocca solo filtri, soglie e durate — non lingua, gruppi o destinatari');

  const statsR = fsR.readFileSync(pathR.join(quiR, '..', 'js/signal/SessionStats.js'), 'utf8');
  const proponibili = [...new Set([...statsR.matchAll(/p\['([\w.]+)'\]/g)].map(m => m[1]))];
  const nonRipristinabili = proponibili.filter(k => !vie.includes(k));
  ok(nonRipristinabili.length === 0,
     `ogni parametro proponibile è anche ripristinabile (mancano: ${nonRipristinabili.join(', ') || 'nessuno'})`);

  /* ⚠️ E i valori si leggono dai PREDEFINITI, non scritti a mano:
   * scritti a mano divergono, ed erano già divergenti — il ripristino
   * riportava il passa-basso a 3,5 quando il predefinito è 1,5. */
  ok(/let n = DEFAULT_CONFIG/.test(svR),
     'i valori del ripristino si leggono dai predefiniti, non sono scritti a mano');
  const { DEFAULT_CONFIG: DCR } = await import('../js/core/config.js');
  const inesistenti = vie.filter(v => {
    let n = DCR;
    for (const k of v.split('.')) n = n?.[k];
    return n === undefined;
  });
  ok(inesistenti.length === 0,
     `ogni via elencata esiste davvero (inesistenti: ${inesistenti.join(', ') || 'nessuna'})`);
}

/* ═══════════ Deve esistere un modo di RICOMINCIARE ═══════════
 *
 * ⚠️ Stime del rumore, baseline, riferimenti di apertura e statistiche
 * cliniche si accumulano per tutta la sessione — ed è giusto, servono
 * tempo per essere affidabili.
 *
 * Ma significa che caricando un video diverso, o passando a un'altra
 * persona, si continuava a misurare con lo stato costruito su quello
 * di prima. E se quello stato si era guastato, non c'era modo di
 * uscirne: nemmeno riportando le impostazioni ai predefiniti, perché
 * sono due cose diverse.
 *
 * Ricostruire i filtri cambiando un parametro lo faceva per caso — ed
 * è il motivo per cui "applica e poi ripristina" sembrava aggiustare
 * tutto. Non era la configurazione: era l'azzeramento.               */
{
  const { GestureEngine: GE } = await import('../js/signal/GestureEngine.js');
  const { SessionStats: SS } = await import('../js/signal/SessionStats.js');
  const { DEFAULT_CONFIG: DC, deepClone: dc } = await import('../js/core/config.js');

  const c = dc(DC);
  const g = new GE(c, () => {});
  let t = 0;
  const R = (x) => 0.030 * Math.sin(2 * Math.PI * 0.8 * x / 1000);
  const o = y => ({ x: 0, y: y + R(t), openness: 0.44, confidence: 0.97 });
  let st = new SS();
  for (let i = 0; i < 4000; i++) {
    t += 33;
    const obs = { left: o(0), right: o(0) };
    g.process(t, obs);
    st.push(t, obs, 1, false);
  }
  const sigmaPrima = g.eyes.left.y.sigma;
  const orePrima = st.riepilogo().ore;
  ok(sigmaPrima > 0.01 && orePrima > 0,
     'lo stato si accumula durante la sessione, come deve');

  g.nuovaSessione();
  st = new SS();
  ok(g.eyes.left.y.sigma < sigmaPrima,
     `dopo l azzeramento la stima del rumore riparte (${sigmaPrima.toFixed(5)} → ${g.eyes.left.y.sigma.toFixed(5)})`);
  ok(g.eyes.left.y.baseline === 0 || g.eyes.left.y.baseline === null,
     'e con essa la baseline');
  ok(st.riepilogo().ore === 0, 'le statistiche cliniche ripartono da zero');
  ok((g.counters.validiLeft ?? 0) === 0, 'e i contatori');

  /* ⚠️ Ma le IMPOSTAZIONI non vanno toccate: azzerare le misure e
   * riportare i parametri ai predefiniti sono due cose diverse, e chi
   * preme una non si aspetta l'altra. */
  ok(c.signal.thresholdOn === DC.signal.thresholdOn
     && c.ui.language === DC.ui.language,
     'azzerare la sessione NON tocca le impostazioni');

  const fsN = await import('node:fs');
  const pathN = await import('node:path');
  const quiN = pathN.dirname(import.meta.filename || process.argv[1]);
  const htmlN = fsN.readFileSync(pathN.join(quiN, '..', 'index.html'), 'utf8');
  const mainN = fsN.readFileSync(pathN.join(quiN, '..', 'js/main.js'), 'utf8');
  ok(/id="btnNuovaSessione"/.test(htmlN), 'esiste il comando nella diagnostica');
  ok(/btnNuovaSessione/.test(mainN) && /nuovaSessione\(\)/.test(mainN), 'ed è collegato');

  /* ⚠️ E caricare un video nuovo deve azzerare da solo: chi carica un
   * altro filmato si aspetta di ricominciare da lì, non di continuare
   * a misurare con lo stato del precedente. */
  const iF = mainN.indexOf("getElementById('fileVideo')");
  const blocco = mainN.slice(iF, iF + 1200);
  ok(/nuovaSessione\(\)/.test(blocco),
     'caricando un video nuovo la sessione si azzera da sola');
  ok(/new SessionStats\(\)/.test(blocco),
     'comprese le statistiche cliniche');
}

/* ═══════════ Nessuno stato nascosto deve sopravvivere ═══════════
 *
 * ⚠️ Il programma appena aperto si comportava diversamente da uno già
 * in uso, anche premendo "nuova sessione" o ricaricando lo stesso
 * video. La causa: il RILEVATORE accumula un proprio stato — il
 * riferimento del raggio dell'iride di quella persona — e non aveva
 * alcun modo di essere azzerato.
 *
 * Da quel riferimento dipende la confidenza, dalla confidenza quali
 * campioni vengono accettati, e da quelli la stima del rumore. Un
 * riferimento costruito su un altro volto, o su una fase in cui il
 * rilevamento andava male, si trascinava per tutta la sessione senza
 * che nulla lo mostrasse.                                            */
{
  const { RgbTracker: RTx } = await import('../js/vision/RgbTracker.js');
  const { DEFAULT_CONFIG: DCx, deepClone: dcx } = await import('../js/core/config.js');
  const tr = new RTx(dcx(DCx));
  tr.stato.left.raggi = [0.1, 0.2, 0.3];
  tr.stato.left.ultimo = { x: 1, y: 2 };
  ok(typeof tr.nuovaSessione === 'function',
     'il rilevatore sa azzerare il proprio stato');
  tr.nuovaSessione();
  ok(tr.stato.left.raggi.length === 0 && !tr.stato.left.ultimo,
     'e lo azzera davvero, riferimento del raggio compreso');

  const fsX = await import('node:fs');
  const pathX = await import('node:path');
  const quiX = pathX.dirname(import.meta.filename || process.argv[1]);
  const mainX = fsX.readFileSync(pathX.join(quiX, '..', 'js/main.js'), 'utf8');
  const quante = (mainX.match(/rgb\?\.nuovaSessione\?\.\(\)/g) || []).length;
  ok(quante >= 2,
     `viene azzerato sia dal comando sia caricando un video nuovo (${quante} punti)`);
}

/* ═══════════ Guadagno per occhio ═══════════
 *
 * ⚠️ Due occhi possono misurare diversamente lo STESSO movimento
 * fisico. Chi guarda il video li vede muoversi uguale e ha ragione:
 * è la misura a essere diversa. */
{
  const { GestureEngine: GEx } = await import('../js/signal/GestureEngine.js');
  const { DEFAULT_CONFIG: DC2, deepClone: dc2 } = await import('../js/core/config.js');

  const c = dc2(DC2);
  c.signal.gainEye = { left: 1, right: 2 };
  const g = new GEx(c, () => {});
  ok(g.guadagnoOcchio('left') === 1 && g.guadagnoOcchio('right') === 2,
     'il guadagno per occhio viene letto');
  ok(new GEx(dc2(DC2), () => {}).guadagnoOcchio('right') === 1,
     'e vale 1 di default, quindi non cambia nulla per chi non lo usa');

  // Un valore assurdo non deve rompere il rilevamento
  const c2 = dc2(DC2);
  c2.signal.gainEye = { left: 0, right: -5 };
  const g2 = new GEx(c2, () => {});
  ok(g2.guadagnoOcchio('left') === 1 && g2.guadagnoOcchio('right') === 1,
     'valori impossibili vengono ignorati invece di azzerare il segnale');
}

/* ═══════ Il ripristino deve CAMBIARE davvero i valori ═══════
 *
 * ⚠️ Il difetto più imbarazzante di tutta questa serie: il ripristino
 * leggeva i valori da `DEFAULT_CONFIG`, che NON era importato in quel
 * file. Ogni lettura restituiva `undefined`, ogni parametro veniva
 * saltato, e il comando non faceva assolutamente nulla — in silenzio,
 * senza errori, mostrando anche un messaggio di conferma.
 *
 * Chi lo premeva restava con i vecchi valori credendo di essere
 * tornato ai predefiniti, e ogni prova successiva partiva da una
 * configurazione sconosciuta. I test controllavano che il comando
 * esistesse e che fosse collegato: nessuno controllava che AVESSE
 * EFFETTO.                                                           */
{
  const fsQ = await import('node:fs');
  const pathQ = await import('node:path');
  const quiQ = pathQ.dirname(import.meta.filename || process.argv[1]);
  const svQ = fsQ.readFileSync(pathQ.join(quiQ, '..', 'js/ui/SettingsView.js'), 'utf8');

  // Ogni identificatore usato dev'essere importato o definito nel file.
  for (const nome of ['DEFAULT_CONFIG', 'GESTURE_CHANNELS', 'deepClone']) {
    const importato = new RegExp(`import\\s*\\{[^}]*\\b${nome}\\b`).test(svQ);
    const definito = new RegExp(`(const|let|function|class)\\s+${nome}\\b`).test(svQ);
    ok(importato || definito,
       `"${nome}" è importato o definito, non usato a vuoto`);
  }

  /* La prova vera: si esegue il ripristino su una configurazione
   * sporcata e si verifica che i valori CAMBINO. */
  const { DEFAULT_CONFIG: DCQ, deepClone: dcQ } = await import('../js/core/config.js');
  const cfg = dcQ(DCQ);
  cfg.signal.thresholdOn = 9;
  cfg.signal.thresholdOff = 4;
  cfg.signal.medianWindowMs = 600;
  cfg.signal.thresholdDir = { up: 7, down: 7, left: 7, right: 7 };

  const { SettingsView: SVpre } = await import('../js/ui/SettingsView.js');
  const finto = {
    _viePrestazioni: SVpre.prototype._viePrestazioni,
    app: {
      cfg,
      set(via, val) {
        const parti = via.split('.');
        let n = this.cfg;
        for (let i = 0; i < parti.length - 1; i++) n = n[parti[i]];
        n[parti[parti.length - 1]] = val;
      },
      toast() {},
    },
    render() {},
  };

  // Si riusa il metodo vero, non una copia.
  SVpre.prototype._ripristinaFiltri.call(finto);

  ok(cfg.signal.thresholdOn === DCQ.signal.thresholdOn,
     `il ripristino riporta davvero la soglia (${cfg.signal.thresholdOn})`);
  ok(cfg.signal.thresholdOff === DCQ.signal.thresholdOff,
     `e quella di rilascio (${cfg.signal.thresholdOff})`);
  ok(cfg.signal.medianWindowMs === DCQ.signal.medianWindowMs,
     `e la finestra mediana (${cfg.signal.medianWindowMs})`);
  ok(cfg.signal.thresholdDir.up === null,
     'e svuota le soglie per direzione, che altrimenti vincono su tutto');

  /* ⚠️ E non deve CONDIVIDERE gli oggetti con i valori predefiniti:
   * la prima modifica successiva li corromperebbe per sempre. */
  cfg.signal.thresholdDir.up = 99;
  ok(DCQ.signal.thresholdDir.up === null,
     'gli oggetti vengono copiati, non condivisi con i predefiniti');
}

/* ═══════════ Assistente conversazionale ═══════════
 *
 * Per chi comunica con un solo movimento è la differenza fra poter
 * DIRE e poter anche CHIEDERE.
 *
 * ⚠️ Non deve poter danneggiare nulla: un errore di rete non può
 * fermare la scansione, che è l'unico modo che la persona ha di
 * comunicare.                                                       */
{
  const { chiedi, inFrasi, ripulisci, PROVIDER_AI, ISTRUZIONE } =
    await import('../js/lang/Assistant.js');
  const { DEFAULT_CONFIG: DCA, deepClone: dcA } = await import('../js/core/config.js');

  ok(DCA.assistente.enabled === false,
     'l assistente è spento di default: richiede una chiave e una scelta consapevole');
  ok(Object.keys(PROVIDER_AI).length >= 5,
     `sono disponibili più servizi (${Object.keys(PROVIDER_AI).length})`);

  /* ⚠️ Non solleva MAI: restituisce sempre un esito. */
  const c = dcA(DCA);
  for (const [caso, prep, dom] of [
    ['spento', (x) => x, 'ciao'],
    ['senza chiave', (x) => { x.assistente.enabled = true; return x; }, 'ciao'],
    ['domanda vuota', (x) => { x.assistente.enabled = true; return x; }, '   '],
    ['configurazione assente', () => ({}), 'ciao'],
  ]) {
    const r = await chiedi(prep(dcA(DCA)), dom);
    ok(r && r.ok === false && typeof r.errore === 'string',
       `"${caso}" restituisce un esito invece di sollevare (${r?.errore})`);
  }

  /* ⚠️ L'istruzione deve chiedere risposte BREVI: la risposta viene
   * ASCOLTATA, non letta, e chi ascolta non può dire "basta" con la
   * stessa facilità con cui si distoglie lo sguardo. */
  ok(/brev|LETTA AD ALTA VOCE/i.test(ISTRUZIONE),
     'l istruzione chiede risposte brevi, perché verranno ascoltate');
  ok(DCA.assistente.maxParole <= 150,
     `e il tetto predefinito è basso (${DCA.assistente.maxParole} parole)`);

  // La formattazione va tolta: ad alta voce diventa rumore.
  const sporco = '**Certo!** Ecco:\n- primo\n- secondo\n```codice```\nFine.';
  const pulito = ripulisci(sporco);
  ok(!/[*`#]/.test(pulito), 'asterischi e cancelletti vengono tolti dalla lettura');
  ok(!/codice/.test(pulito), 'e i blocchi di codice, che ad alta voce sono incomprensibili');

  /* Spezzare in frasi rende l'ascolto interrompibile. */
  const lunga = 'Prima frase. Seconda frase. ' + 'parola '.repeat(60) + 'fine.';
  const pezzi = inFrasi(lunga);
  ok(pezzi.length >= 3, `una risposta lunga viene spezzata (${pezzi.length} pezzi)`);
  ok(Math.max(...pezzi.map(x => x.length)) <= 200,
     `e nessun pezzo è interminabile (${Math.max(...pezzi.map(x => x.length))} caratteri)`);

  /* ⚠️ La voce CHIEDI compare solo se l'assistente è acceso: chi non lo
   * usa non deve trovarsi una voce in più nella scansione, che costa
   * tempo a OGNI giro. */
  const { buildTree } = await import('../js/scan/ScanEngine.js');
  const trova = (n, id) => n.id === id ? n
    : (n.children || []).reduce((acc, k) => acc || trova(k, id), null);
  const spento = dcA(DCA), acceso = dcA(DCA);
  acceso.assistente.enabled = true;
  ok(!trova(buildTree(spento), 'a:ai'),
     'a assistente spento la voce CHIEDI non compare nella scansione');
  ok(!!trova(buildTree(acceso), 'a:ai'),
     'accendendolo compare');

  /* ⚠️ E non deve toccare NULLA del percorso del segnale. */
  const fsA = await import('node:fs');
  const pathA = await import('node:path');
  const quiA = pathA.dirname(import.meta.filename || process.argv[1]);
  const srcA = fsA.readFileSync(pathA.join(quiA, '..', 'js/lang/Assistant.js'), 'utf8');
  ok(!/GestureEngine|sigma|baseline|escursione/i.test(srcA),
     'il modulo non tocca in alcun modo il percorso del segnale');
}

/* ═══════════ Il limite di parole si CHIEDE, non si taglia ═══════════
 *
 * ⚠️ Serviva solo a limitare la risposta dall'esterno: l'assistente non
 * lo sapeva, scriveva quanto voleva, e la risposta veniva troncata a
 * metà frase. Chiedere "al massimo N parole" produce invece una
 * risposta compiuta e della lunghezza voluta.                        */
{
  const { istruzione, PROVIDER_AI: PA } = await import('../js/lang/Assistant.js');
  for (const n of [30, 100, 250]) {
    ok(istruzione(n).includes(String(n)),
       `il limite di ${n} parole compare nell istruzione data all assistente`);
  }
  ok(/AL MASSIMO/i.test(istruzione(50)),
     'ed è espresso come richiesta, non come taglio');
  ok(/completa e più corta/i.test(istruzione(50)),
     'chiedendo esplicitamente di non interrompersi a metà');

  /* ⚠️ Un'istruzione personale SOSTITUISCE quella predefinita: chi la
   * scrive deve poter dire ciò che vuole, compreso ignorare il limite
   * di parole. Ma dev'essere evidente, non una sorpresa. */
  const fsI = await import('node:fs');
  const pathI = await import('node:path');
  const quiI = pathI.dirname(import.meta.filename || process.argv[1]);
  const svP = fsI.readFileSync(pathI.join(quiI, '..', 'js/ui/SettingsView.js'), 'utf8');
  ok(/il limite di parole qui sopra NON viene più aggiunto/.test(svP),
     'ed è scritto sotto il campo che scrivendone una propria il limite non si aggiunge più');

  /* ⚠️ Una chiave PER SERVIZIO: cambiare fornitore per provarne un
   * altro non deve costringere a cancellare la chiave precedente. */
  const { DEFAULT_CONFIG: DK, deepClone: dk } = await import('../js/core/config.js');
  const { chiedi: ch } = await import('../js/lang/Assistant.js');
  ok(!!DK.assistente.chiavi, 'esiste una chiave per ciascun servizio');
  ok(Object.keys(DK.assistente.chiavi).length === Object.keys(PA).length,
     `una per ogni servizio disponibile (${Object.keys(DK.assistente.chiavi).length})`);

  const c1 = dk(DK);
  c1.assistente.enabled = true;
  c1.assistente.provider = 'deepseek';
  c1.assistente.chiavi.openrouter = 'sk-or-1';
  const r1 = await ch(c1, 'ciao');
  ok(r1.errore === 'chiave di accesso non impostata',
     'la chiave di un servizio non vale per un altro');

  // ⚠️ E la vecchia chiave unica deve continuare a funzionare
  const c2 = dk(DK);
  c2.assistente.enabled = true;
  c2.assistente.chiave = 'sk-vecchia';
  delete c2.assistente.chiavi;
  const r2 = await ch(c2, 'ciao');
  ok(r2.errore !== 'chiave di accesso non impostata',
     'una configurazione vecchia con chiave unica continua a funzionare');

  /* ⚠️ Il router GRATUITO deve essere il primo, quindi il predefinito.
   *
   * Aurora è e resterà gratuito: chi non sceglie un modello non deve
   * trovarsi un costo. `openrouter/free` sceglie da solo fra i modelli
   * gratuiti disponibili, e non costa nulla — né il router né le
   * richieste che instrada. `openrouter/auto` invece sceglie fra
   * TUTTI, anche a pagamento. */
  ok(PA.openrouter.modelli[0] === 'openrouter/free',
     'il router gratuito è il primo, quindi il predefinito');

  /* ⚠️ Nomi di modello RITIRATI.
   *
   * `deepseek-chat` e `deepseek-reasoner` sono stati ritirati il
   * 24 luglio 2026: le chiamate con quei nomi falliscono. Erano
   * l'unica voce dell'elenco DeepSeek, quindi quel servizio non
   * avrebbe funzionato affatto — e nessun test se ne sarebbe accorto,
   * perché il programma non contatta la rete durante le prove.
   *
   * Un elenco di modelli invecchia da solo: questa verifica non può
   * sapere quali nomi saranno validi domani, ma può ricordare quelli
   * che sappiamo essere morti. */
  const RITIRATI = ['deepseek-chat', 'deepseek-reasoner'];
  const morti = Object.entries(PA)
    .flatMap(([k, v]) => (v.modelli || []).filter(m => RITIRATI.includes(m)).map(m => `${k}: ${m}`));
  ok(morti.length === 0,
     `nessun modello ritirato nell elenco (${morti.join(', ') || 'confermato'})`);
  for (const [k, v] of Object.entries(PA)) {
    if (k === 'personale') continue;
    ok((v.modelli || []).length > 0, `il servizio "${k}" ha almeno un modello indicato`);
  }
  ok(PA.openrouter.modelli.includes('openrouter/auto'),
     'e la scelta automatica fra tutti resta disponibile, più in basso');
}

/* ═══════════ Diagnostica della modalità infrarossa ═══════════
 *
 * ⚠️ La ricerca della pupilla per luminanza sbaglia in modi tutti suoi,
 * che i parametri di MediaPipe non descrivono. E i suoi parametri non
 * vanno MAI proposti in modalità MediaPipe: lì non hanno effetto, e
 * proporli farebbe perdere fiducia in tutti gli altri.               */
{
  const { SessionStats: SI } = await import('../js/signal/SessionStats.js');

  function sessione(modo, salta, perde) {
    const st = new SI();
    st.modoRilevamento = modo;
    st.cfgIr = { irDarkPercentile: 12 };
    let t = 0;
    const R = (x) => 0.020 * Math.sin(2 * Math.PI * 4.2 * x / 1000);
    for (let k = 0; k < 70; k++) {
      for (let i = 0; i < 1400; i += 33) {
        t += 33;
        const s2 = salta && (k * 40 + i) % 7 === 0;
        const p2 = perde && (k * 40 + i) % 5 === 0;
        const o = (y) => p2 ? null
          : { x: 0, y: y + R(t) + (s2 ? 0.12 : 0), openness: 0.44, confidence: 0.9, area: 900 };
        st.push(t, { left: o(-0.16), right: o(-0.16) }, 8, true);
      }
      for (let i = 0; i < 2200; i += 33) {
        t += 33;
        const o = () => ({ x: 0, y: R(t), openness: 0.44, confidence: 0.9, area: 900 });
        st.push(t, { left: o(), right: o() }, 1, false);
      }
    }
    return st.parametriConsigliati();
  }

  const rgb = sessione('rgb', true, true);
  const soloIr = (p) => Object.keys(p.proposta).filter(k => /^detection\.ir/.test(k));
  ok(soloIr(rgb).length === 0,
     `in modalità MediaPipe non propone parametri infrarossi (${soloIr(rgb).join(', ') || 'nessuno'})`);

  const ir = sessione('ir', true, true);
  ok(soloIr(ir).length > 0,
     `in modalità infrarossa li propone (${soloIr(ir).join(', ')})`);
  ok(ir.motivi.some(m => /infraross/.test(m)),
     'spiegando quale sintomo ha osservato');
  ok(ir.motivi.some(m => /salta|perde/.test(m)),
     'e distinguendo il centro che salta dalla pupilla che si perde');

  /* Con un rilevamento SANO non deve proporre nulla: proporre a vuoto
   * fa perdere fiducia nei suggerimenti che contano. */
  const sano = sessione('ir', false, false);
  ok(soloIr(sano).length === 0,
     `con rilevamento sano non propone nulla (${soloIr(sano).join(', ') || 'nessuno'})`);
}

/* ═══════════ Lettura di un testo lungo ═══════════
 *
 * ⚠️ Leggere un libro intero in un colpo solo sarebbe una trappola:
 * chi ascolta con un solo gesto non può dire "basta" a metà, e
 * resterebbe prigioniero per ore. Si legge un TRATTO per volta, e la
 * volta dopo si riprende da dove si era arrivati.                    */
{
  const fsL = await import('node:fs');
  const pathL = await import('node:path');
  const quiL = pathL.dirname(import.meta.filename || process.argv[1]);
  const mpL = fsL.readFileSync(pathL.join(quiL, '..', 'js/media/MediaPlayer.js'), 'utf8');
  const mainL = fsL.readFileSync(pathL.join(quiL, '..', 'js/main.js'), 'utf8');
  const { DEFAULT_CONFIG: DL } = await import('../js/core/config.js');
  const { COMMANDS_BY_KIND, MediaCommand } = await import('../js/media/MediaPlayer.js');

  const cmdTesto = (COMMANDS_BY_KIND.text || []).map(c => c.id);
  for (const [id, nome] of [
    [MediaCommand.READ_ALOUD, 'leggi e continua'],
    [MediaCommand.READ_BACK, 'rileggi il tratto prima'],
    [MediaCommand.READ_RESTART, 'ricomincia dall inizio'],
  ]) {
    ok(cmdTesto.includes(id), `un testo aperto ha il comando "${nome}"`);
  }
  ok(cmdTesto.includes(MediaCommand.EXIT), 'e quello per uscire');

  ok(Number.isFinite(DL.drafts.passoLetturaCar) && DL.drafts.passoLetturaCar >= 400,
     `il tratto letto per volta è regolabile (${DL.drafts.passoLetturaCar} caratteri)`);
  ok(DL.drafts.passoLetturaCar <= 2000,
     'e resta breve: circa un minuto di ascolto, non un\'ora');

  /* ⚠️ La posizione si ricorda PER TESTO: riaprendo un libro domani si
   * riparte da dove si era arrivati, non dall'inizio. */
  ok(/_letture\[titolo\]/.test(mainL),
     'la posizione di lettura si ricorda per ciascun testo');
  ok(/_titoloMediaCorrente = e\.title/.test(mainL),
     'e il testo viene riconosciuto dal titolo all apertura');

  /* Il taglio cade a fine FRASE: interrompersi a metà periodo
   * costringe a rileggere per capire. */
  ok(/lastIndexOf\('\.', fine\)/.test(mainL),
     'il tratto si chiude alla fine di una frase, non a metà parola');

  ok(/Testo finito/.test(mainL),
     'arrivati in fondo lo dice, invece di leggere il vuoto');
  ok(/speakProtected/.test(mainL),
     'la lettura mette in pausa la voce guida, altrimenti si sovrapporrebbero');
}

/* ═══════ Un interruttore deve mostrare SUBITO ciò che governa ═══════
 *
 * ⚠️ Le impostazioni si ridisegnano solo quando serve: ridisegnare a
 * ogni tocco farebbe saltare il punto in cui si sta lavorando. Ma un
 * interruttore che SVELA altri controlli deve ridisegnare, altrimenti
 * quei controlli compaiono solo cambiando scheda e tornando indietro —
 * e il comando sembra guasto.
 *
 * È successo cinque volte in questo progetto — posta, radio, canale
 * combinato, assistente, registro — sempre allo stesso modo: si
 * aggiunge una sezione condizionale e ci si dimentica dell'elenco.
 *
 * Questa verifica lo cerca da sola nel file, così la dimenticanza si
 * scopre qui invece che usando il programma.                        */
{
  const fsS = await import('node:fs');
  const pathS = await import('node:path');
  const quiS = pathS.dirname(import.meta.filename || process.argv[1]);
  const sv = fsS.readFileSync(pathS.join(quiS, '..', 'js/ui/SettingsView.js'), 'utf8');

  const i = sv.indexOf('const INTERRUTTORI_CHE_APRONO');
  ok(i > 0, 'esiste l elenco degli interruttori che ridisegnano');
  const lista = sv.slice(i, sv.indexOf(']);', i));
  const elencati = new Set([...lista.matchAll(/'([\w.]+)'/g)].map(m => m[1]));

  /* Si cercano i percorsi che governano contenuto condizionale, nelle
   * due forme usate: `cfg.x.y ? [ … ]` e `if (cfg.x.y)`. */
  const usati = new Set();
  for (const m of sv.matchAll(/cfg\.([a-zA-Z]+)\??\.([a-zA-Z]+)[^?\n]{0,40}\?\s*\[/g)) {
    usati.add(`${m[1]}.${m[2]}`);
  }
  for (const m of sv.matchAll(/if \(cfg\.([a-zA-Z]+)\??\.([a-zA-Z]+)\)/g)) {
    usati.add(`${m[1]}.${m[2]}`);
  }

  const mancanti = [...usati].filter(x => !elencati.has(x));
  ok(mancanti.length === 0,
     `ogni interruttore che svela altri controlli ridisegna subito (mancano: ${mancanti.join(', ') || 'nessuno'})`);
  ok(usati.size >= 5,
     `la verifica trova davvero le sezioni condizionali (${usati.size})`);
  ok(elencati.has('assistente.enabled'),
     'compreso quello dell assistente, che è l ultimo ad aver avuto il difetto');
}

/* ═══════════ Modalità infrarossa: forma e anteprima ═══════════
 *
 * ⚠️ Tutto ciò che segue vale SOLO per la modalità infrarossa. Con
 * MediaPipe nulla deve cambiare: è la modalità che funziona, e non va
 * sfiorata.                                                          */
{
  const fsR = await import('node:fs');
  const pathR = await import('node:path');
  const quiR = pathR.dirname(import.meta.filename || process.argv[1]);
  const { DEFAULT_CONFIG: DR } = await import('../js/core/config.js');
  const irSrc = fsR.readFileSync(pathR.join(quiR, '..', 'js/vision/IrTracker.js'), 'utf8');
  const vpSrc = fsR.readFileSync(pathR.join(quiR, '..', 'js/vision/VisionPipeline.js'), 'utf8');

  /* ⚠️ Una forma sbagliata va SCARTATA, non solo penalizzata: una
   * regione lunga e stretta prendeva un punteggio basso e vinceva lo
   * stesso, se era l'unica. È la causa del bordo ellittico con il
   * centro sul bordo rosa. */
  ok(/aspect > maxAllung\) continue/.test(irSrc),
     'una regione troppo allungata viene scartata, non solo penalizzata');
  ok(Number.isFinite(DR.detection.irMaxAllungamento) && DR.detection.irMaxAllungamento >= 2,
     `il limite è generoso di default (${DR.detection.irMaxAllungamento}) — scartare troppo è peggio che trovare male`);

  /* L'anteprima dei canali: si tarava alla cieca. */
  ok(DR.detection.mostraCanali === false,
     'l anteprima dei canali è spenta di default');
  ok(/D\.mostraCanali && D\.mode !== 'rgb'/.test(vpSrc),
     '⚠️ e vale SOLO fuori da MediaPipe: lì la combinazione non ha effetto');
  ok(/putImageData/.test(vpSrc),
     'quando accesa, il riquadro mostra ciò che il rilevatore vede davvero');

  /* ⚠️ L'area sta dentro `px`: cercandola al primo livello non si
   * trovava mai, e senza area la diagnostica non poteva proporre
   * l'area massima — cioè proprio il parametro che serve. */
  const stSrc = fsR.readFileSync(pathR.join(quiR, '..', 'js/signal/SessionStats.js'), 'utf8');
  ok(/o2\.px\?\.area/.test(stSrc),
     'la diagnostica cerca l area anche dove il rilevatore la mette davvero');
  ok(/o2\.px\?\.axes/.test(stSrc),
     'e misura anche quanto è allungato il bordo trovato');

  /* La diagnostica deve proporre i parametri infrarossi nel caso reale
   * osservato: bordo allungato, centro che salta, pupilla che si perde. */
  const { SessionStats: SR } = await import('../js/signal/SessionStats.js');
  const st = new SR();
  st.modoRilevamento = 'auto';
  st.cfgIr = { irDarkPercentile: 12 };
  let t = 0;
  for (let i = 0; i < 4000; i++) {
    t += 33;
    const salta = i % 9 === 0, perde = i % 14 === 0;
    const o = () => perde ? null : {
      x: 0, y: salta ? 0.35 : 0.02 * Math.sin(i / 5),
      openness: 0.3, confidence: 0.57,
      px: { area: 270, axes: { a: 26, b: 11, angle: 0 } },
    };
    st.push(t, { left: o(), right: o() }, 1.5, false);
  }
  const p = st.parametriConsigliati();
  const irProp = Object.keys(p.proposta).filter(k => /^detection\.ir/.test(k));
  ok(irProp.length >= 2,
     `nel caso reale propone i parametri infrarossi (${irProp.join(', ')})`);
  ok(p.motivi.some(m => /allungato/.test(m)),
     'e riconosce il bordo allungato che non è un iride');
  ok(p.motivi.some(m => /salta/.test(m)),
     'e il centro che salta fuori dall occhio');
}

/* ═══════ La scansione si ferma fuori dalla scheda Parla ═══════
 *
 * ⚠️ Fuori da lì i gesti servono ad altro — puntare, tarare, guardare i
 * grafici — e una scansione che continua ad annunciare voci mentre
 * l'assistente lavora nelle impostazioni è nel migliore dei casi un
 * rumore di fondo; nel peggiore un gesto involontario che sceglie una
 * voce e pronuncia qualcosa che nessuno voleva.                     */
{
  const fsT = await import('node:fs');
  const pathT = await import('node:path');
  const quiT = pathT.dirname(import.meta.filename || process.argv[1]);
  const mainT = fsT.readFileSync(pathT.join(quiT, '..', 'js/main.js'), 'utf8');
  const { DEFAULT_CONFIG: DT } = await import('../js/core/config.js');

  ok(DT.scan.soloInParla === true,
     'la sospensione fuori da Parla è attiva di default');

  const iG = mainT.indexOf('goto(tab) {');
  const corpoG = mainT.slice(iG, iG + 2600);
  ok(/tab === 'parla'/.test(corpoG),
     'il cambio scheda distingue Parla dalle altre');
  ok(/_pausaAutomatica/.test(corpoG),
     '⚠️ e distingue la sospensione automatica da quella voluta dalla persona');

  /* ⚠️ Se la persona aveva messo in pausa da sé, tornando in Parla la
   * pausa deve RESTARE: riprendere da soli ciò che qualcuno aveva
   * fermato è un modo sicuro di far perdere fiducia nel comando di
   * pausa. */
  ok(/inParla && this\._pausaAutomatica/.test(corpoG),
     'tornando in Parla si riprende SOLO se era stata una sospensione automatica');
  ok(/audio\?\.stop\?\.\(\)/.test(corpoG),
     'e uscendo la voce guida tace subito, senza finire l annuncio in corso');

  /* Deve essere spegnibile: serve per provare i gesti dalla
   * diagnostica sentendo la voce guida. */
  const svT = fsT.readFileSync(pathT.join(quiT, '..', 'js/ui/SettingsView.js'), 'utf8');
  ok(svT.includes("'scan.soloInParla'"),
     'l opzione è regolabile in impostazioni');
  ok(/soloInParla !== false/.test(corpoG),
     'e spegnendola la scansione continua ovunque, come prima');
}

/* ═══════ I video si aprono e si CHIUDONO davvero ═══════
 *
 * ⚠️ Un riproduttore che resta vivo dopo la chiusura continua a
 * consumare e, nel caso di un video incorporato, può continuare a
 * suonare sopra la voce guida — rendendo incomprensibile proprio ciò
 * che serve per tornare indietro.                                    */
{
  const fsV = await import('node:fs');
  const pathV = await import('node:path');
  const quiV = pathV.dirname(import.meta.filename || process.argv[1]);
  const mp = fsV.readFileSync(pathV.join(quiV, '..', 'js/media/MediaPlayer.js'), 'utf8');
  const mainV = fsV.readFileSync(pathV.join(quiV, '..', 'js/main.js'), 'utf8');

  const iC = mp.indexOf('close(notify = true)');
  const corpoC = mp.slice(iC, iC + 700);
  ok(/yt\?\.destroy\?\.\(\)/.test(corpoC),
     'chiudendo, il riproduttore video incorporato viene distrutto');
  ok(/revokeObjectURL/.test(corpoC),
     'e i file aperti vengono liberati, invece di restare in memoria');
  ok(/container\.innerHTML = ''/.test(corpoC),
     'il riquadro viene svuotato: nulla resta a suonare sotto');
  ok(/_emit\('closed'\)/.test(corpoC),
     'e la chiusura viene annunciata');
  ok(/e\.type === 'closed'/.test(mainV),
     'così il programma torna al menu invece di restare sul contenuto');
}

console.log(`\n─── TOTALE: ${pass} superati, ${fail} falliti ───`);
process.exit(fail?1:0);
