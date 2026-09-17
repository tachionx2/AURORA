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

/* ── Il servizio di invio posta è incluso e pronto ──
 *
 * ⚠️ Chi installa non deve creare né copiare file: doveva scriversi a
 * mano la funzione copiandola dalle impostazioni, e un solo carattere
 * sbagliato produceva un errore incomprensibile a chi non programma.
 *
 * Il file è inerte finché non viene configurato: senza le variabili
 * d'ambiente risponde con un errore chiaro e si ferma. Chi non usa la
 * posta può ignorarlo del tutto. */
{
  const fnPath = 'netlify/functions/invia-email.js';
  const fn = read(fnPath);
  ok(!!fn, 'il servizio di invio posta è incluso nel programma');
  /* ⚠️ Le dipendenze vanno dichiarate ALLA RADICE, non dentro
   * netlify/functions/.
   *
   * Netlify non installa quelle dichiarate nella cartella della
   * funzione: il caricamento fallisce con «Cannot find module
   * nodemailer» e si ferma l'INTERO sito, non solo la posta. Chi
   * aggiorna il programma si ritrova Aurora irraggiungibile per un
   * servizio che magari non usa nemmeno. */
  const pkg = fs.existsSync(path.join(root, 'package.json')) ? read('package.json') : '';
  ok(!!pkg && /nodemailer/.test(pkg),
     'le dipendenze del servizio sono dichiarate alla radice del progetto');
  ok(!fs.existsSync(path.join(root, 'netlify/functions/package.json')),
     'e NON dentro netlify/functions/, dove Netlify non le installerebbe');
  const toml = fs.existsSync(path.join(root, 'netlify.toml')) ? read('netlify.toml') : '';
  ok(!!toml && /npm install/.test(toml),
     'la configurazione di Netlify le fa installare');
  ok(/publish = "\."/.test(toml || ''),
     'e pubblica la radice: il sito è statico, non c è nulla da compilare');

  /* ⚠️ Deve funzionare con QUALUNQUE provider, non solo Gmail: con
   * Libero, Aruba, Outlook bastano indirizzo e password normali,
   * mentre Gmail richiede una password per le applicazioni. */
  ok(/MAIL_HOST/.test(fn) && /MAIL_PORT/.test(fn),
     'si configura con server e porta espliciti, per qualunque provider');
  ok(/MAIL_SERVICE/.test(fn),
     'oppure con il nome abbreviato, per chi usa Gmail');
  ok(/porta === 465/.test(fn),
     'e distingue la porta cifrata dall inizio da quella che si cifra dopo');

  /* Aperto nel browser deve dire se è pronto: è il modo più rapido di
   * sapere se è stato caricato e configurato, senza spedire nulla. */
  ok(/httpMethod === 'GET'/.test(fn) && /mancano/.test(fn),
     'aperto nel browser dice se è pronto e quali variabili mancano');

  /* ⚠️ E deve poter limitare i destinatari: senza, chi scopre
   * l indirizzo del servizio può spedire a chiunque a nome della
   * casella configurata. */
  ok(/MAIL_ALLOWED/.test(fn),
     'si possono limitare i destinatari ammessi');

  /* Le credenziali NON devono comparire nelle impostazioni di Aurora:
   * lì sarebbero leggibili da chiunque apra gli strumenti di sviluppo. */
  const cfgSrc = read('js/core/config.js');
  ok(!/mailPass|smtpPass|MAIL_PASS/.test(cfgSrc),
     'nessuna password di posta è salvata nella configurazione del programma');

  ok(/errore: String\(e && e\.message/.test(fn),
     'un guasto riporta il motivo del provider, non un generico "non riuscito"');
}

/* ── Nessuna vista di Punta visibile fuori dalla sua scheda ──
 *
 * ⚠️ Errore già commesso: una regola con `display:flex` scritta senza
 * `.is-active` rendeva la vista Frasi visibile SEMPRE, anche sotto le
 * altre. Rubava spazio in verticale e comprimeva la tastiera a metà
 * pagina, rendendola difficile da colpire con lo sguardo — che è il
 * modo in cui va usata.
 *
 * La regola generale è `display:none` finché non si entra nella
 * scheda: chi aggiunge stili a una vista deve rispettarla. */
{
  const css = read('css/app.css');
  const cattive = [];
  const re = /#ptView-([a-z]+)([^{,]*)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = `#ptView-${m[1]}${m[2]}`;
    if (/display\s*:\s*(flex|block|grid)/.test(m[3]) && !/is-active/.test(sel)) {
      cattive.push(sel.trim());
    }
  }
  ok(cattive.length === 0,
     `nessuna vista di Punta è visibile fuori dalla sua scheda (${cattive.join(', ') || 'confermato'})`);
}

/* ── Ciò che copre lo schermo non può stare dentro un pannello ──
 *
 * ⚠️ Errore già commesso: la velatura scura stava dentro il pannello
 * Punta, e i pannelli non attivi sono `display:none`. In Parla era
 * quindi in un contenitore nascosto e non si vedeva MAI, per quanto il
 * programma la rendesse visibile — `position:fixed` non aiuta, un
 * antenato nascosto cancella tutto il sottoalbero.
 *
 * È un errore invisibile finché non lo si prova, e il codice attorno
 * sembra corretto perché lo è. */
{
  const html = read('index.html');
  const iScuro = html.indexOf('id="schermoScuro"');
  ok(iScuro > 0, 'la velatura scura esiste nella pagina');
  if (iScuro > 0) {
    /* Si contano le aperture e chiusure di <main> prima di quel punto:
     * se le aperture superano le chiusure, sta dentro un pannello. */
    const prima = html.slice(0, iScuro);
    const aperti = (prima.match(/<main\b/g) || []).length;
    const chiusi = (prima.match(/<\/main>/g) || []).length;
    ok(aperti === chiusi,
       `la velatura è fuori da ogni pannello (${aperti} aperti, ${chiusi} chiusi)`);
  }
}

/* ── Ogni parametro usato dev'essere anche REGOLABILE ──
 *
 * ⚠️ Sei volte in questo progetto è successo lo stesso: un parametro
 * scritto nella configurazione, usato dal programma, e senza alcun
 * comando per cambiarlo. Chi installa non poteva toccarlo, e spesso
 * non sapeva nemmeno che esistesse.
 *
 * Questa verifica copre l'intera classe di errori invece del singolo
 * caso: ogni parametro di `scan` e `pointer` — i due gruppi che chi
 * assiste tara davvero — dev'essere raggiungibile dalle impostazioni.
 */
{
  const sv = read('js/ui/SettingsView.js');
  const cfgSrc = read('js/core/config.js');

  /* Si prendono i nomi dichiarati nei due gruppi, saltando quelli
   * annidati che hanno comandi propri. */
  const gruppi = ['scan', 'pointer'];
  const mancanti = [];
  for (const g of gruppi) {
    const i = cfgSrc.indexOf(`  ${g}: {`);
    if (i < 0) continue;
    const corpo = cfgSrc.slice(i, cfgSrc.indexOf('\n  },', i));
    for (const m of corpo.matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*)\s*:\s*(?!\{)/gm)) {
      const via = `${g}.${m[1]}`;
      if (!sv.includes(`'${via}'`)) mancanti.push(via);
    }
  }
  /* ⚠️ Alcuni sono volutamente non regolabili: sono dati salvati, non
   * scelte. Si dichiarano qui, così restano una decisione esplicita. */
  const esenti = new Set([
    'pointer.calibrationData',   // la calibrazione, non un'impostazione
    'scan.groups',               // i gruppi hanno un editor dedicato
    'scan.phraseGroups',         // idem
  ]);
  const veri = mancanti.filter(x => !esenti.has(x));
  ok(veri.length === 0,
     `ogni parametro di scansione e puntatore è regolabile (mancano: ${veri.join(', ') || 'nessuno'})`);
}

console.log(`\n${pass} superati, ${fail} falliti`);
if (problems.length) { console.log('\nDA CORREGGERE:'); problems.forEach(p => console.log('  · ' + p)); }
process.exit(fail ? 1 : 0);
