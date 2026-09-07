/**
 * Verifica delle larghezze nelle righe di impostazione.
 * Riproduce la ripartizione flex per le colonne più strette possibili
 * e controlla che nessun controllo scenda sotto una larghezza in cui
 * il testo andrebbe a capo lettera per lettera.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
const qui = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(qui, '..', f), 'utf8');

// Colonna della griglia impostazioni: repeat(auto-fill, minmax(min(340px,100%),1fr))
// Larghezza minima reale della scheda meno il padding interno.
const colonne = [
  ['colonna minima 340px', 340],
  ['telefono stretto 360px', 360],
  ['tablet 420px', 420],
  ['desktop largo 520px', 520],
];
const PAD = 2 * 17;          // padding .card ~1.1rem
const GAP = 11;              // gap .7rem della riga

// base dichiarate nel CSS
const controlli = [
  ['sink-box (selettore uscita)', 260, 200],
  ['sink-diag (capacità browser)', 280, 200],
  ['voice-row (voce + prova)', 240, 180],
];

console.log('scheda            controllo                        larghezza  esito');
console.log('──────────────────────────────────────────────────────────────────');
for (const [nomeCol, w] of colonne) {
  const disp = w - PAD;
  for (const [nome, base, minimo] of controlli) {
    // L'etichetta ha base 45% e min 150px; se insieme non ci stanno,
    // flex-wrap manda il controllo a capo e prende tutta la riga.
    const etichetta = Math.max(150, disp * 0.45);
    const insieme = etichetta + GAP + Math.min(base, disp);
    const larghezza = insieme <= disp ? Math.min(base, disp - etichetta - GAP) : disp;
    const buona = larghezza >= minimo * 0.9;
    ok(buona, `${nomeCol} — ${nome}: solo ${Math.round(larghezza)}px (minimo ${minimo})`);
    console.log(`${nomeCol.padEnd(24)} ${nome.padEnd(32)} ${String(Math.round(larghezza)).padStart(5)}px  ${buona ? 'ok' : '⚠'}`);
  }
}
/* ── La riga della taratura non deve traboccare ──
 *
 * ⚠️ Il testo dell'interruttore andava a capo e finiva SOPRA le schede
 * sottostanti, coprendole. Un controllo che invade ciò che sta sotto è
 * peggio di un controllo assente: nasconde comandi che servono.      */
{
  const css = read('css/app.css');
  const bloccoSw = /\.switch-inline\{([^}]*)\}/.exec(css)?.[1] || '';
  ok(/overflow:hidden/.test(bloccoSw),
     'l interruttore non trabocca dal proprio spazio');
  const bloccoEm = /\.switch-inline em\{([^}]*)\}/.exec(css)?.[1] || '';
  ok(/white-space:nowrap/.test(bloccoEm),
     'il suo testo non va a capo: andando a capo copriva le schede sotto');
  ok(/text-overflow:ellipsis/.test(bloccoEm),
     'e se lo spazio manca viene troncato, non allargato');

  const bloccoRiga = /\.diag-taratura\{([^}]*)\}/.exec(css)?.[1] || '';
  ok(/overflow:hidden/.test(bloccoRiga), 'e la riga che li contiene nemmeno');
  ok(/border-top/.test(bloccoRiga),
     'la taratura è separata dai comandi: qui si cambiano i parametri del programma');

  const html = read('index.html');
  const riga = /<div class="profile-actions diag-taratura">([\s\S]*?)<\/div>/.exec(html)?.[1] || '';
  for (const id of ['btnDiagApply', 'btnDiagUndo', 'chkDiagAlways']) {
    ok(riga.includes(id), `"${id}" sta nella riga della taratura, non fra i comandi della telecamera`);
  }
  // Il testo deve essere corto: era lui a far traboccare la riga
  const testo = /<em data-i18n="diag.always">([^<]*)</.exec(html)?.[1] || '';
  ok(testo.length <= 16, `il testo dell interruttore è corto (${testo.length} caratteri: "${testo}")`);
}

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail ? 1 : 0);
