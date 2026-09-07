/**
 * PointerView.js — Scheda "Punta".
 *
 * Contiene tre cose che condividono lo stesso puntatore:
 *   · tastiera virtuale a tasti grandi
 *   · flusso di calibrazione
 *   · pannello del braccio robotico
 *
 * I bersagli cliccabili sono marcati con .ptr-target: il puntatore
 * cerca l'elemento sotto le proprie coordinate e ne simula il click.
 * Così tastiera, pulsanti e comandi del braccio funzionano tutti con
 * lo stesso meccanismo, e anche con mouse e dito senza codice in più.
 */

import { REFERENCE_FIRMWARE } from '../device/DeviceLink.js';

const h = (t, c, html) => { const e = document.createElement(t); if (c) e.className = c; if (html !== undefined) e.innerHTML = html; return e; };
/** I titoli dei file arrivano dal disco: vanno neutralizzati. */
const esc = (s) => String(s).replace(/[&<>"]/g,
  m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const LAYOUTS = {
  abc: [
    'A B C D E F G',
    'H I J K L M N',
    'O P Q R S T U',
    'V W X Y Z ␣ ⌫',
  ],
  qwerty: [
    'Q W E R T Y U I O P',
    'A S D F G H J K L',
    'Z X C V B N M ␣ ⌫',
  ],
  frequenza: [
    'E A I O N L R',
    'T S C D P U M',
    'V G H F B Q Z',
    'J K W X Y ␣ ⌫',
  ],
};

const NUMBERS = '1 2 3 4 5 6 7 8 9 0';

/** Modalità della scheda: elenco chiuso, una sola visibile alla volta. */
export const MODES = ['tastiera', 'testi', 'media', 'braccio'];

export class PointerView {
  constructor(app) { this.app = app; }

  render() {
    this.renderKeyboard();
    this.renderCompose();
    this.renderStatus();
    this.setMode(this.mode || 'tastiera');
  }

  /* ----------------------------- Tastiera ----------------------------- */

  renderKeyboard() {
    const wrap = document.getElementById('kbGrid');
    if (!wrap) return;
    const K = this.app.cfg.keyboard;
    const rows = [...(LAYOUTS[K.layout] || LAYOUTS.abc)];
    if (K.showNumbers) rows.unshift(NUMBERS);
    wrap.innerHTML = '';
    wrap.style.gap = `${K.keyGap}px`;

    for (const row of rows) {
      const r = h('div', 'kb-row');
      r.style.gap = `${K.keyGap}px`;
      for (const key of row.split(' ')) {
        const b = h('button', 'kb-key ptr-target', key === '␣' ? '␣' : key);
        b.dataset.key = key;
        if (key === '␣') b.classList.add('kb-wide');
        b.onclick = () => this.press(key);
        r.append(b);
      }
      wrap.append(r);
    }

    // Le azioni NON stanno più fra i tasti: sono nella barra in basso,
    // sempre nella stessa posizione. Mescolarle alle lettere le rendeva
    // facili da premere per sbaglio.
  }

  press(key) {
    const eng = this.app.scan;
    if (key === '⌫') { eng.undo(performance.now()); return; }
    const ch = key === '␣' ? ' ' : key;
    eng.buffer.letters += ch;
    eng.stats.chars++;
    eng._afterCompose(performance.now(), ch === ' ');
    if (this.app.cfg.keyboard.speakOnPress) {
      this.app.audio.earcon('item');
      this.app.audio.say(ch === ' ' ? 'spazio' : ch, 'menu', true);
    }
  }

  clearBuffer() {
    const eng = this.app.scan;
    eng.buffer = { letters: '', words: [], sentence: '' };
    eng._afterCompose(performance.now(), false);
  }

  /* ------------------------------- Media ------------------------------- */

  /**
   * Contenuti come riquadri grandi, comandabili con il puntatore.
   *
   * Gli stessi file della scheda Media, ma qui si scelgono puntando
   * invece che ascoltando la scansione: chi controlla lo sguardo su due
   * assi non deve passare dal menu uditivo per guardarsi un album.
   * I riquadri sono volutamente grandi e distanziati — con lo sguardo
   * l'errore è di posizione, e bersagli vicini si sbagliano.
   */
  renderMedia() {
    const wrap = document.getElementById('ptTiles');
    if (!wrap) return;
    const lib = this.app.libreriaPerScansione();
    const gruppi = [
      { id: 'video', nome: 'VIDEO', ic: '🎬', items: lib.videos },
      { id: 'audio', nome: 'AUDIO', ic: '🎵', items: lib.audios },
      { id: 'doc',   nome: 'DOCUMENTI', ic: '📄', items: lib.docs },
      { id: 'img',   nome: 'IMMAGINI', ic: '🖼', items: lib.images },
    ].filter(g => g.items.length);

    wrap.innerHTML = '';
    if (!gruppi.length) {
      wrap.append(h('p', 'sub',
        'Nessun contenuto. Caricali dalla scheda Media, oppure aggiungi un link video.'));
      return;
    }

    for (const g of gruppi) {
      const sez = h('div', 'pt-tilegroup');
      sez.append(h('div', 'pt-tilehead', `${g.ic} ${g.nome}`));
      const riga = h('div', 'pt-tilerow');
      g.items.forEach((it, i) => {
        // Una cartella si apre sul primo file: da lì avanti e indietro
        // restano dentro l'album.
        const b = h('button', 'pt-tile ptr-target');
        b.innerHTML = `<span class="tt">${esc(it.title)}</span>` +
          (it.folder ? `<small>${it.folder.length} file</small>` : '');
        b.onclick = () => this.app.apriDallaLibreria(
          it.folder ? { kind: g.id, index: i, sub: 0 } : { kind: g.id, index: i });
        riga.append(b);
      });
      sez.append(riga);
      wrap.append(sez);
    }
  }

  /* ------------------------------ Braccio ------------------------------ */

  renderArm() {
    const wrap = document.getElementById('armPanel');
    if (!wrap) return;
    const D = this.app.cfg.device;
    wrap.innerHTML = '';

    const bar = h('div', 'arm-bar');
    const mk = (label, cls, fn) => { const b = h('button', `btn btn-sm ptr-target ${cls || ''}`, label); b.onclick = fn; return b; };

    bar.append(
      mk(this.app.device.connected ? 'Disconnetti' : 'Collega dispositivo', 'btn-primary', async () => {
        try {
          if (this.app.device.connected) await this.app.device.disconnect();
          else if (D.transport === 'serial') await this.app.device.connectSerial();
          else await this.app.device.connectBridge();
        } catch (e) { this.app.toast(e.message, true); }
        this.renderArm();
      }),
      mk('ARRESTO', 'btn-danger arm-stop', () => { this.app.device.emergencyStop(); this.renderArm(); }),
      mk('Sblocca', '', () => { this.app.device.clearStop(); this.renderArm(); }),
      mk('Riposo', '', () => this.app.device.home()),
      mk('Pinza', '', () => this.app.device.toggleGripper()),
    );
    wrap.append(bar);

    const st = h('div', 'arm-state');
    const s = this.app.device;
    st.innerHTML = `
      <span>stato: <b>${s.state}</b></span>
      <span>via: <b>${s.transport || '—'}</b></span>
      <span>inviati: <b>${s.counters.sent}</b></span>
      <span>limitati: <b>${s.counters.throttled}</b></span>
      <span>errori: <b>${s.counters.errors}</b></span>
      <span>arresti: <b>${s.counters.stops}</b></span>`;
    wrap.append(st);

    if (!('serial' in navigator) && D.transport === 'serial') {
      wrap.append(h('p', 'warn-note',
        'Web Serial non è disponibile in questo browser. Funziona su Chrome ed Edge da computer; su Android serve il bridge con la shell nativa.'));
    }

    const log = h('div', 'eventlog');
    log.innerHTML = s.log.slice(0, 20).map(l =>
      `<div class="${l.kind === 'error' || l.kind === 'stop' ? 'warn' : ''}"><b>${l.text}</b></div>`).join('')
      || '<div>nessun evento</div>';
    wrap.append(log);

    const det = h('details', 'fw-details');
    det.append(h('summary', null, 'Firmware minimo di riferimento (Arduino / ESP32)'));
    const pre = h('pre', 'fw-code');
    pre.textContent = REFERENCE_FIRMWARE;
    det.append(pre);
    wrap.append(det);
  }

  /* ------------------------------- Stato ------------------------------- */

  /**
   * Stato in una riga sola di piccoli indicatori.
   * Prima erano cinque riquadri grandi che occupavano un terzo della
   * schermata: informazione utile all'assistente, ingombro inutile per
   * chi deve scrivere.
   */
  renderStatus() {
    const el = document.getElementById('ptrStatus');
    if (!el) return;
    const P = this.app.cfg.pointer;
    const cal = this.app.calibration;
    const c = this.app.pointer.counters;
    const en = this.app.cfg.ui.language === 'en';
    const chips = [
      { on: P.enabled, k: en ? 'pointer' : 'puntatore', v: P.enabled ? (en ? 'on' : 'attivo') : (en ? 'off' : 'spento') },
      { on: false, k: en ? 'mode' : 'modo', v: P.mode === 'gaze' ? (en ? 'gaze' : 'sguardo') : (en ? 'stripes' : 'bande') },
      { on: !!cal?.ready, k: en ? 'calibration' : 'calibrazione',
        v: cal?.ready ? `${Math.round(cal.error)} px` : (en ? 'none' : 'assente') },
      { on: false, k: 'click', v: `${c.clicks}${c.dblclicks ? ' · ' + c.dblclicks + '×2' : ''}` },
    ];
    el.innerHTML = chips.map(x =>
      `<span class="st${x.on ? ' on' : ''}">${x.k} <b>${x.v}</b></span>`).join('');
  }

  /** Testo in composizione, mostrato SOPRA la tastiera. */
  renderCompose(buffer) {
    const b = buffer || this.app.scan.buffer;
    const sent = document.getElementById('ptSentence');
    const let_ = document.getElementById('ptLetters');
    if (!sent || !let_) return;
    const text = [...b.words].join(' ');
    sent.innerHTML = text
      ? String(text).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]))
      : '<span class="placeholder">…</span>';
    let_.textContent = b.letters;
    sent.scrollTop = sent.scrollHeight;
  }

  /** Alterna tastiera e braccio: una cosa sola alla volta sullo schermo. */
  setMode(mode) {
    this.mode = MODES.includes(mode) ? mode : 'tastiera';
    // Riferimenti espliciti per id invece di querySelectorAll: le
    // modalità sono un elenco chiuso e noto, e così la funzione resta
    // verificabile e non dipende da come il documento è interrogabile.
    for (const m of MODES) {
      const view = document.getElementById(`ptView-${m}`);
      const btn = document.getElementById(`ptMode-${m}`);
      view?.classList.toggle('is-active', m === this.mode);
      btn?.classList.toggle('is-active', m === this.mode);
    }
    if (this.mode === 'braccio') this.renderArm();
    if (this.mode === 'testi') this.app.renderDrafts?.();
    if (this.mode === 'media') this.renderMedia();
    this.app.agganciaMedia?.();
  }
}
