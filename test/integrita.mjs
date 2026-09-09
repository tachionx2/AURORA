/**
 * Controllo di integrità statico.
 *
 * Verifica meccanicamente i collegamenti fra i file, che è la classe di
 * errore che mi è sfuggita più volte: un id che non esiste, una chiave
 * di traduzione mancante, un percorso di configurazione sbagliato, un
 * metodo cancellato per errore. Nessuno di questi lancia un errore di
 * sintassi, e alcuni non lanciano nulla finché non si tocca proprio
 * quel controllo.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(process.argv[1]), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const jsFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    const p = d ? `${d}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!['test', 'icons', 'node_modules'].includes(e.name)) walk(p); }
    else if (e.name.endsWith('.js')) jsFiles.push(p);
  }
})('js');

const html = read('index.html');
const css = read('css/app.css');
let pass = 0, fail = 0;
const problems = [];
const ok = (c, m) => { if (c) pass++; else { fail++; problems.push(m); console.log('  ✗ ' + m); } };

/* ══════════ A. Ogni getElementById deve avere un id nell'HTML ══════════ */
const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
// id creati dal codice a runtime, legittimi
const dynamicIds = new Set(['ytHost', 'pdfCanvas', 'mediaText', 'mediaImg', 'mediaEl', 'mediaNow',
  // Riquadro nascosto per la stampa: creato al primo uso, non sta
  // nell'HTML perché serve solo a chi stampa.
  'printFrame',
  // Creato dalla scheda impostazioni al momento del disegno.
  'btnOffline', 'btnFloatWindow', 'btnNuovaSessione']);
const missingIds = new Set();
for (const f of jsFiles) {
  const src = read(f);
  for (const m of src.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
    const id = m[1];
    if (!htmlIds.has(id) && !dynamicIds.has(id)) missingIds.add(`${id}  (${f})`);
  }
}
ok(missingIds.size === 0, 'id cercati dal codice ma assenti nell HTML: ' + [...missingIds].join(', '));

/* ══════════ B. Ogni id di pulsante nell'HTML deve essere collegato ══════════ */
const allJs = jsFiles.map(read).join('\n');
const buttonIds = [...html.matchAll(/<(?:button|label|input)[^>]*\sid="([^"]+)"/g)].map(m => m[1]);
// Un id può essere costruito con un letterale di modello, es.
// getElementById(`ptMode-${m}`): si accetta anche il prefisso.
const tplPrefixes = [...allJs.matchAll(/getElementById\(\s*`([^`$]*)\$\{/g)].map(m => m[1]);
// Il collegamento può avvenire anche tramite una funzione ausiliaria,
// quindi si verifica che l'id sia RIFERITO in qualche modo. Che poi
// faccia davvero qualcosa lo verifica la prova a runtime, che preme
// ogni pulsante uno per uno.
const unbound = buttonIds.filter(id =>
  !new RegExp(`'${id}'`).test(allJs) &&
  !new RegExp(`\\bfor="${id}"`).test(html) &&
  !tplPrefixes.some(p => p && id.startsWith(p)));
ok(unbound.length === 0, 'pulsanti nell HTML senza alcun collegamento nel codice: ' + unbound.join(', '));

/* ══════════ C. Chiavi di traduzione ══════════ */
const i18n = read('js/core/i18n.js');
const cut = i18n.indexOf('const EN = {');
// Le chiavi possono stare più d'una per riga: si cercano ovunque.
const itKeys = new Set([...i18n.slice(0, cut).matchAll(/'([\w.]+)':/g)].map(m => m[1]));
const enKeys = new Set([...i18n.slice(cut).matchAll(/'([\w.]+)':/g)].map(m => m[1]));

const htmlKeys = [...html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)].map(m => m[1]);
const jsKeys = [...allJs.matchAll(/\bt\(\s*'([\w.]+)'/g)].map(m => m[1]);
const usedKeys = [...new Set([...htmlKeys, ...jsKeys])];

const noIt = usedKeys.filter(k => !itKeys.has(k));
const noEn = usedKeys.filter(k => !enKeys.has(k));
ok(noIt.length === 0, 'chiavi usate ma assenti dal dizionario italiano: ' + noIt.join(', '));
ok(noEn.length === 0, 'chiavi usate ma assenti dal dizionario inglese: ' + noEn.join(', '));
const onlyIt = [...itKeys].filter(k => !enKeys.has(k));
const onlyEn = [...enKeys].filter(k => !itKeys.has(k));
ok(onlyIt.length === 0, 'chiavi presenti solo in italiano: ' + onlyIt.join(', '));
ok(onlyEn.length === 0, 'chiavi presenti solo in inglese: ' + onlyEn.join(', '));

/* ══════════ D. Percorsi di configurazione ══════════ */
const { DEFAULT_CONFIG, validateConfig, migrateConfig, CONFIG_VERSION } = await import('../js/core/config.js');
const hasPath = (o, p) => p.split('.').every(k => {
  if (o === undefined || o === null) return false;
  if (Array.isArray(o) && /^\d+$/.test(k)) { o = o[+k]; return o !== undefined; }
  if (!(k in o)) return false;
  o = o[k]; return true;
});
const settings = read('js/ui/SettingsView.js');
const cfgPaths = new Set();
for (const m of settings.matchAll(/this\._(?:toggle|range|number|select)\(\s*'([\w.]+)'/g)) cfgPaths.add(m[1]);
for (const m of allJs.matchAll(/this\.(?:set|get)\(\s*'([\w.]+)'/g)) cfgPaths.add(m[1]);
const badPaths = [...cfgPaths].filter(p => !p.includes('${') && !hasPath(DEFAULT_CONFIG, p));
ok(badPaths.length === 0, 'percorsi di configurazione inesistenti: ' + badPaths.join(', '));

/* ══════════ E0. Funzioni ausiliarie usate ma non definite ══════════ */
// Un aiuto locale usato senza essere definito non produce errori di
// sintassi: esplode solo quando quella riga viene eseguita davvero.
for (const f of jsFiles) {
  const src = read(f);
  const mancanti = [];
  for (const nome of ['esc', 'h', 'field', 'clamp', 'percentile', 'P']) {
    // `(?<![\w.])` esclude `oggetto.nome(`, ma non `this.x.nome(` in
    // tutte le forme: si escludono anche le chiamate su un metodo.
    const usato = new RegExp(`(?<![\\w.\\]])${nome}\\(`).test(src);
    if (!usato) continue;
    // Definito come funzione libera, importato, oppure METODO di una
    // classe (`  nome(args) {` a inizio riga): un metodo non è una
    // funzione ausiliaria mancante.
    const definito = new RegExp(`(?:const|let|var|function)\\s+${nome}\\b`).test(src)
      || new RegExp(`import[^;]*\\b${nome}\\b[^;]*from`).test(src)
      || new RegExp(`^\\s{2,4}(?:static\\s+|get\\s+|async\\s+)?${nome}\\s*\\(`, 'm').test(src);
    if (!definito) mancanti.push(nome);
  }
  ok(mancanti.length === 0, `${f}: usa senza definire ${mancanti.join(', ')}`);
}

/* ══════════ E. Metodi invocati ma non definiti (per classe) ══════════ */
for (const f of jsFiles) {
  const src = read(f);
  const defined = new Set([...src.matchAll(/^\s{2}(?:async\s+)?([_a-zA-Z]\w*)\s*\(/gm)].map(m => m[1]));
  const called = new Set([...src.matchAll(/this\.(_\w+)\s*\(/g)].map(m => m[1]));
  const miss = [...called].filter(n => !defined.has(n));
  ok(miss.length === 0, `${f}: metodi privati invocati ma non definiti: ${miss.join(', ')}`);
}

/* ══════════ F. Classi CSS usate dal codice ══════════ */
const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
const usedClasses = new Set();
for (const m of allJs.matchAll(/className\s*=\s*'([^']+)'/g)) m[1].split(/\s+/).forEach(c => c && usedClasses.add(c));
for (const m of allJs.matchAll(/classList\.(?:add|toggle)\(\s*'([\w-]+)'/g)) usedClasses.add(m[1]);
for (const m of allJs.matchAll(/h\('\w+',\s*'([^']+)'/g)) m[1].split(/\s+/).forEach(c => c && usedClasses.add(c));
const noCss = [...usedClasses].filter(c => !cssClasses.has(c) && !c.startsWith('ptr-') && c !== 'is-active');
ok(noCss.length === 0, 'classi usate dal codice ma non definite nel CSS: ' + noCss.join(', '));

/* ══════════ G. Service worker completo ══════════ */
const sw = read('sw.js');
const swListed = new Set([...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]));
const shipped = [...jsFiles, 'css/app.css', 'index.html', 'manifest.json'];
const notCached = shipped.filter(f => !swListed.has(f));
ok(notCached.length === 0, 'file non elencati nel service worker (non funzionerebbero offline): ' + notCached.join(', '));

/* ══════════ H. Migrazione della configurazione ══════════ */
let migOk = true, migErr = '';
for (let v = 1; v <= CONFIG_VERSION; v++) {
  try {
    const c = migrateConfig({ version: v, scan: { stepMs: 1234 } });
    const errs = validateConfig(c);
    if (c.version !== CONFIG_VERSION) { migOk = false; migErr = `da v${v} non arriva a v${CONFIG_VERSION}`; }
    if (c.scan.stepMs !== 1234) { migOk = false; migErr = `da v${v} perde i valori esistenti`; }
    if (errs.length) { migOk = false; migErr = `da v${v}: ${errs[0]}`; }
  } catch (e) { migOk = false; migErr = `da v${v}: ${e.message}`; }
}
ok(migOk, 'migrazione da ogni versione precedente: ' + migErr);
ok(validateConfig(DEFAULT_CONFIG).length === 0, 'configurazione predefinita valida');

/* ══════════ I. Ogni scheda ha il suo pannello ══════════ */
const tabs = [...html.matchAll(/data-goto="(\w+)"/g)].map(m => m[1]);
const panels = [...html.matchAll(/id="panel-(\w+)"/g)].map(m => m[1]);
ok(tabs.every(t => panels.includes(t)), 'ogni scheda ha il suo pannello: ' + tabs.filter(t => !panels.includes(t)).join(', '));
ok(panels.every(p => tabs.includes(p)), 'nessun pannello orfano: ' + panels.filter(p => !tabs.includes(p)).join(', '));

/* ══════════ J. Nessun parametro che oscura la funzione t() ══════════ */
const shadow = [];
for (const f of jsFiles) {
  const src = read(f);
  if (!/\bimport\s*\{[^}]*\bt\b[^}]*\}\s*from\s*'[^']*i18n/.test(src)) continue;
  for (const m of src.matchAll(/^\s*(?:async\s+)?[\w.]+\s*\(([^)]*)\)\s*\{/gm)) {
    const params = m[1].split(',').map(s => s.trim().split(/[=:\s]/)[0]);
    if (params.includes('t')) shadow.push(`${f}: ${m[0].trim().slice(0, 60)}`);
  }
  for (const m of src.matchAll(/\(\s*t\s*(?:,[^)]*)?\)\s*=>/g)) shadow.push(`${f}: arrow (t) =>`);
}
ok(shadow.length === 0, 'parametri chiamati "t" che oscurano la traduzione: ' + shadow.join(' | '));

/* ══════════ K. Versione e cache ══════════ */
const { BUILD } = await import('../js/core/version.js');
ok(/^\d{8}-\d{4}$/.test(BUILD), 'la versione ha un formato riconoscibile: ' + BUILD);
ok(sw.includes(`aurora-${BUILD}`),
   'la cache del service worker segue la versione: un aggiornamento non può restare bloccato');
ok(html.includes('id="chipBuild"'), 'la versione è visibile nella barra in alto');
ok(allJs.includes('mostraVersione'), 'esiste il controllo della versione caricata');

/* ══════════ L. Le otto richieste devono restare implementate ══════════ */
const { buildTree: bt2, DEFAULT_PHRASES: DP } = await import('../js/scan/ScanEngine.js');
const { EYE_LM: LM } = await import('../js/vision/RgbTracker.js');
const albero = bt2(DEFAULT_CONFIG, {});
const frasi = albero.children.find(c => c.id === 'phrases');
ok(frasi.label === 'Frasi' && frasi.spoken === 'frasi', 'L1. il menu si chiama "Frasi", non "Frasi rapide"');
ok(frasi.children[0].action === 'BACK', 'L2. "indietro" è la prima voce delle frasi');
ok(frasi.children.length > 1 && frasi.children[1].children?.some(c => c.action === 'BACK'),
   'L3. anche dentro ogni gruppo di frasi c è "indietro" come prima voce');
const azioni = albero.children.find(c => c.id === 'write').children.find(c => c.id === 'act');
ok(!azioni.children.some(c => c.action === 'PAUSE'), 'L4. PAUSA rimossa dalle azioni');
// La voce MENU è ora opzionale: nelle azioni resta sempre l'uscita,
// e MENU solo se l'assistente lo chiede.
ok(azioni.children.some(c => c.action === 'BACK'),
   'L5. nelle azioni resta sempre l uscita');
ok(Number.isFinite(DEFAULT_CONFIG.scan.maxCycles) && /scan\.maxCycles/.test(settings),
   'L6. i giri a vuoto prima della pausa sono configurabili');
ok(Number.isFinite(DEFAULT_CONFIG.scan.visibleItems) && allJs.includes('sib-more'),
   'L7. la finestra delle voci visibili evita che le ultime spariscano');
ok(LM.left.iris[0] === 473 && LM.right.iris[0] === 468,
   'L8. le etichette degli occhi seguono l anatomia della persona');
ok('swapEyes' in DEFAULT_CONFIG.detection, 'L9. esiste l inversione per telecamere specchiate');
ok(allJs.includes('repeating-linear-gradient'), 'L10. i pulsanti del grafico riproducono il tratto della linea');
ok(css.includes('#panel-guarda.is-active') && css.includes('guarda-corpo'),
   'L11. la scheda Guarda è a schermata fissa');
ok(allJs.includes('_firmaFiltriCorrente') && allJs.includes('RobustScale'),
   'L12. i filtri non si azzerano a ogni impostazione e la stima del rumore è robusta');

/* ══════════ M. Gli interruttori devono essere premibili ══════════ */
// La casella è nascosta (dimensione zero) e sopra c'è uno <span>
// disegnato: solo una <label> propaga il clic. Dentro un <div>
// l'interruttore si vede ma NON si può premere, e nessuna impostazione
// a interruttore funziona. È già successo.
const divSwitch = [...allJs.matchAll(/h\('div',\s*'switch'/g)];
ok(divSwitch.length === 0, `interruttori creati come <div> invece che <label>: ${divSwitch.length}`);
const labelSwitch = [...allJs.matchAll(/h\('label',\s*'switch'/g)];
ok(labelSwitch.length >= 2, `interruttori creati correttamente come <label>: ${labelSwitch.length}`);

/* ══════════ N. Il visualizzatore deve poter scorrere ══════════ */
// Un elemento flex non scende sotto la dimensione del contenuto senza
// min-height:0: senza quello il documento cresce oltre la pagina
// invece di scorrere.
ok(/#panel-guarda .guarda-principale .card\{[^}]*min-height:0/.test(css),
   'la scheda del visualizzatore può restringersi (min-height:0)');
ok(/#panel-guarda .media-stage\{[^}]*overflow-y:auto/.test(css),
   'il riquadro del documento scorre verticalmente');

/* ══════════ O. Righe di impostazione: niente testo schiacciato ══════════ */
// Se l'etichetta prende tutto lo spazio e il controllo non dichiara una
// base, il controllo viene compresso a zero e il testo va a capo
// lettera per lettera. È già successo nella scheda audio.
ok(/\.field\{[^}]*flex-wrap:wrap/.test(css),
   'le righe di impostazione possono andare a capo');
ok(!/\.field label\{flex:1;/.test(css),
   'l etichetta non prende tutto lo spazio (flex:1 secco)');
for (const cls of ['sink-box', 'sink-diag', 'voice-row']) {
  const m = css.match(new RegExp(`\\.${cls}\\{[^}]*\\}`));
  ok(m && /flex:1 1/.test(m[0]) && /min-width:/.test(m[0]),
     `.${cls} dichiara base e larghezza minima: non può essere schiacciato`);
}

/* ══════════ P. Finestrelle dei contatori a dimensione fissa ══════════ */
// Con colonne elastiche la griglia si riordina mentre i numeri
// cambiano, e in diagnostica diventa impossibile seguire un valore.
ok(/\.counters\{[^}]*repeat\(auto-fill,\s*150px\)/.test(css),
   'la griglia dei contatori ha colonne di larghezza fissa');
ok(/\.counter\{[^}]*width:150px/.test(css), 'ogni riquadro ha larghezza fissa');
ok(/\.counter \.cv\{[^}]*tabular-nums/.test(css), 'le cifre hanno passo costante');
ok(/\.counter \.cv\{[^}]*height:/.test(css) && /\.counter \.cl\{[^}]*height:/.test(css),
   'valore ed etichetta hanno altezza fissa: il riquadro non cambia mai dimensione');

/* ══════════ Q. Variabili usate ma non dichiarate ══════════
 *
 * ⚠️ Questo controllo nasce da un difetto vero: dentro un blocco
 * `try` si usava una variabile che in quell'ambito non esisteva. Ogni
 * fotogramma sollevava un errore, il `try` lo inghiottiva in silenzio,
 * e il riepilogo clinico non veniva mai disegnato: i contatori
 * restavano a zero e sembrava che la raccolta non funzionasse, mentre
 * i dati c'erano tutti.
 *
 * Un `try` che nasconde un errore è peggio di un errore visibile.   */
{
  const nomiComuni = ['now', 'tMs', 'obs', 'res', 'ch', 'cfg', 'frame'];
  const problemi = [];
  for (const f of jsFiles) {
    const src = read(f);
    // Blocchi try { ... } che usano un nome comune senza averlo
    // dichiarato al loro interno né riceverlo come parametro vicino.
    for (const m of src.matchAll(/try \{([\s\S]{0,900}?)\n    \}/g)) {
      const blocco = m[1];
      const prima = src.slice(Math.max(0, m.index - 2500), m.index);
      for (const nome of nomiComuni) {
        const usato = new RegExp(`(?<![\\w.])${nome}(?![\\w:])`).test(blocco);
        if (!usato) continue;
        const dichiaratoDentro = new RegExp(`(?:const|let|var)\\s+(?:\\{[^}]*\\b)?${nome}\\b`).test(blocco);
        const dichiaratoPrima = new RegExp(`(?:const|let|var|function|\\()\\s*[^;\\n]*\\b${nome}\\b`).test(prima);
        if (!dichiaratoDentro && !dichiaratoPrima) {
          problemi.push(`${f}: "${nome}" usato in un try senza essere dichiarato`);
        }
      }
    }
  }
  ok(problemi.length === 0,
     'nessuna variabile usata dentro un try senza essere dichiarata: ' + (problemi.slice(0, 3).join(' | ') || 'verificato'));
}

/* ── I metodi chiamati devono ESISTERE ──
 *
 * ⚠️ Avevo scritto `this.audio.speak(...)`, che non esiste: il metodo
 * si chiama `say`. La voce CHIEDI dell'assistente falliva con un
 * errore invece di funzionare.
 *
 * Nessun test se n'era accorto: il modulo dell'assistente è provato da
 * solo, senza il resto del programma attorno, e JavaScript non
 * segnala un metodo inesistente finché non lo si chiama davvero.
 *
 * È la stessa classe di difetto del pulsante mai aggiunto alla pagina
 * e dell'import mancante: codice corretto, che non funziona.
 */
{
  const coppie = [
    ['js/main.js', 'this.audio.', 'js/audio/AudioDirector.js'],
    ['js/main.js', 'this.media.', 'js/media/MediaPlayer.js'],
    ['js/main.js', 'this.gestures.', 'js/signal/GestureEngine.js'],
  ];
  for (const [chiamante, prefisso, definitore] of coppie) {
    const src = read(chiamante);
    const dst = read(definitore);
    if (!src || !dst) continue;
    const re = new RegExp(prefisso.replace(/\./g, '\\.') + '([a-zA-Z_]+)\\s*\\(', 'g');
    const usati = [...new Set([...src.matchAll(re)].map(m => m[1]))];
    const definiti = new Set([
      ...[...dst.matchAll(/^  (?:async |static |get |\* )?([a-zA-Z_]+)\s*\(/gm)].map(m => m[1]),
      ...[...dst.matchAll(/^  ([a-zA-Z_]+)\s*=/gm)].map(m => m[1]),
    ]);
    const mancanti = usati.filter(m => !definiti.has(m));
    ok(mancanti.length === 0,
       `ogni metodo chiamato con "${prefisso}" esiste in ${definitore.split('/').pop()} (${mancanti.join(', ') || 'confermato'})`);
  }
}

console.log(`\n${pass} superati, ${fail} falliti`);
if (problems.length) { console.log('\nDA CORREGGERE:'); problems.forEach(p => console.log('  · ' + p)); }
process.exit(fail ? 1 : 0);
