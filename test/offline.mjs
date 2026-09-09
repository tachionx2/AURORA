/**
 * Funzionamento senza internet.
 *
 * ⚠️ Aurora è l'unico modo di comunicare per chi lo usa. Dipendere da
 * un server altrui significa che il giorno in cui quel server è
 * irraggiungibile — un guasto, un blocco, una connessione caduta — la
 * persona resta muta e non può nemmeno dirlo.
 *
 * Questa suite verifica che tutto ciò che serve a comunicare sia
 * INCLUSO nel programma, e che le poche cose che richiedono la rete
 * siano solo quelle che per loro natura non possono farne a meno.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
const qui = path.dirname(fileURLToPath(import.meta.url));
const R = (f) => fs.readFileSync(path.join(qui, '..', f), 'utf8');
const esiste = (f) => fs.existsSync(path.join(qui, '..', f));

/* ══════════ 1. Le librerie indispensabili sono incluse ══════════ */
const indispensabili = [
  ['vendor/mediapipe/vision_bundle.mjs', 'libreria di riconoscimento del volto'],
  ['vendor/mediapipe/wasm/vision_wasm_internal.js', 'codice di calcolo'],
  ['vendor/mediapipe/wasm/vision_wasm_internal.wasm', 'codice di calcolo compilato'],
  ['vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm', 'variante per dispositivi più vecchi'],
  ['vendor/fonts/atkinson.css', 'carattere ad alta leggibilità'],
  ['vendor/fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'carattere, tondo'],
  ['vendor/fonts/atkinson-hyperlegible-latin-700-normal.woff2', 'carattere, neretto'],
];
for (const [f, cosa] of indispensabili) {
  ok(esiste(f), `1a. incluso nel programma: ${cosa} (${f})`);
}
// Facoltative ma incluse lo stesso: aprire un documento non deve
// dipendere da un server altrui.
for (const [f, cosa] of [
  ['vendor/pdfjs/pdf.min.mjs', 'lettore PDF'],
  ['vendor/pdfjs/pdf.worker.min.mjs', 'lettore PDF, elaborazione'],
  ['vendor/mammoth/mammoth.browser.min.js', 'lettore documenti Word'],
]) ok(esiste(f), `1b. incluso: ${cosa}`);

/* ══════════ 2. Il codice punta ai file locali ══════════ */
const tracker = R('js/vision/RgbTracker.js');
const player = R('js/media/MediaPlayer.js');
const html = R('index.html');

ok(!/cdn\.jsdelivr\.net/.test(tracker),
   '2a. il riconoscimento NON dipende da una rete di distribuzione esterna');
ok(/vendor\/mediapipe/.test(tracker), '2b. usa la libreria inclusa');
ok(!/cdn\.jsdelivr\.net/.test(player),
   '2c. nemmeno i lettori di documenti dipendono da un server esterno');
ok(/vendor\/pdfjs/.test(player) && /vendor\/mammoth/.test(player), '2d. usano le copie incluse');
ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html),
   '2e. il carattere non viene scaricato da un server esterno');
ok(/vendor\/fonts/.test(html), '2f. si usa quello incluso');

/* ══════════ 3. L'unica cosa che serve dalla rete ══════════ */
const modelli = [...tracker.matchAll(/https:\/\/[^'"`\s]+/g)].map(m => m[0]);
ok(modelli.length === 1,
   `3a. il riconoscimento scarica UNA sola cosa dalla rete (${modelli.length})`);
ok(/face_landmarker\.task/.test(modelli[0] || ''),
   '3b. ed è il modello di riconoscimento, che non è ridistribuibile');

/* ══════════ 4. Il service worker conserva tutto ══════════ */
const sw = R('sw.js');
const precaricati = [...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
for (const f of [
  'vendor/mediapipe/vision_bundle.mjs',
  'vendor/fonts/atkinson.css',
  'vendor/pdfjs/pdf.min.mjs',
  'vendor/mammoth/mammoth.browser.min.js',
]) ok(precaricati.includes(f), `4a. conservato dal primo avvio: ${f}`);

// ⚠️ I due file da nove megabyte NON vanno precaricati: se uno solo
// fallisse, l'installazione intera fallirebbe e il programma non
// funzionerebbe più offline per niente.
// Si guarda SOLO l'elenco di precaricamento, non tutto il file: i
// file grandi compaiono anche nel comando di preparazione, ed è giusto.
const iPre = sw.indexOf('CORE');
const elencoPre = sw.slice(iPre, sw.indexOf('];', iPre));
ok(!/vision_wasm_internal\.wasm/.test(elencoPre),
   '4b. i file grandi non sono nel precaricamento: un errore di rete non deve far fallire tutto');
ok(/preparaOffline/.test(sw), '4c. esiste un comando esplicito per prepararsi all uso offline');
ok(/face_landmarker\.task/.test(sw), '4d. che scarica anche il modello');
ok(/storage\.googleapis\.com/.test(sw), '4e. e il service worker sa conservarlo');

/* ══════════ 5. Cosa richiede la rete, e cosa no ══════════ */
const tuttoJs = fs.readdirSync(path.join(qui, '..', 'js'), { recursive: true })
  .filter(f => String(f).endsWith('.js'))
  .map(f => ({ f: `js/${f}`, src: R(`js/${f}`) }));

// Le funzioni ESSENZIALI alla comunicazione non devono contattare nessuno
const essenziali = ['js/scan/ScanEngine.js', 'js/signal/GestureEngine.js',
                    'js/lang/Predictor.js', 'js/lang/AutoCorrect.js',
                    'js/audio/AudioDirector.js', 'js/lang/Drafts.js'];
for (const f of essenziali) {
  const src = R(f);
  ok(!/fetch\(|XMLHttpRequest|https:\/\//.test(src),
     `5a. ${f.split('/').pop()} non contatta alcun server: comunicare non dipende dalla rete`);
}

// Le funzioni che la rete la usano davvero devono essere solo queste
const conRete = tuttoJs.filter(x => /\bfetch\(/.test(x.src)).map(x => x.f);
/* ⚠️ L'elenco dei moduli che possono contattare la rete è chiuso di
 * proposito: Aurora deve funzionare senza internet, e un modulo nuovo
 * che chiama la rete senza dichiararlo qui romperebbe quella garanzia
 * in silenzio. L'assistente conversazionale la contatta per forza —
 * è il suo scopo — ma è spento di default e la sua assenza non
 * impedisce nulla. */
const attese = ['js/lang/Dictation.js', 'js/lang/Mailer.js',
                'js/lang/Assistant.js', 'js/lang/Telegram.js',
                'js/device/HomeAssistant.js', 'js/main.js',
                'js/ui/FloatWindow.js'];
const inattese = conRete.filter(f => !attese.includes(f));
ok(inattese.length === 0,
   `5b. solo traduzione, posta, domotica, assistente e Telegram contattano la rete: ${inattese.join(', ') || 'confermato'}`);

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail ? 1 : 0);
