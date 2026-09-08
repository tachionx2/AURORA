/**
 * main.js — Orchestratore.
 *
 * Tiene insieme i moduli e non contiene logica di dominio: ogni regola
 * di comportamento vive nel modulo che le compete, così che i pezzi
 * restino testabili singolarmente.
 */

import { DEFAULT_CONFIG, migrateConfig, validateConfig, exportProfile, importProfile, deepClone } from './core/config.js';
import { bus, saveConfig, loadConfig, saveStats, loadStats, appendLog } from './core/store.js';
import { GestureEngine } from './signal/GestureEngine.js';
import { analizza as analizzaSegnale } from './signal/AutoTune.js';
import { SessionStats } from './signal/SessionStats.js';
import { ScanEngine, DEFAULT_PHRASES } from './scan/ScanEngine.js';
import { Predictor } from './lang/Predictor.js';
import { Correttore } from './lang/AutoCorrect.js';
import { invia as inviaEmail, verificaConfigurazione, indirizzoValido, ESEMPIO_NETLIFY } from './lang/Mailer.js';
import { comanda as comandaCasa, verificaDomotica } from './device/HomeAssistant.js';
import { Drafts, splitSentences } from './lang/Drafts.js';
import { Dettatura, traduci, LINGUE, dettaturaDisponibile, conta } from './lang/Dictation.js';
import { AudioDirector } from './audio/AudioDirector.js';
import { VoiceBank, Registratore, vocabolarioGuida } from './audio/VoiceBank.js';
import { VisionPipeline, drawEyeDebug, SignalPlot, TRACE_STYLE, FACE_STYLE, BLINK_STYLE } from './vision/VisionPipeline.js';
import { Watchdog, SorveglianzaAudio } from './vision/Watchdog.js';
import { TERMINI_IT, TERMINI_EN, VERSIONE_TERMINI, testoInHtml } from './core/Legal.js';
import { FinestraFluttuante, finestraSupportata } from './ui/FloatWindow.js';
import { CameraSource } from './vision/FrameSource.js';
import { setLanguage, applyStatic, t } from './core/i18n.js';
import { BUILD } from './core/version.js';
import { SettingsView } from './ui/SettingsView.js';
import { StatsView, DebugView } from './ui/Panels.js';
import { PointerView, MODES as PT_MODES } from './ui/PointerView.js';
import { GazeCalibration, calibrationTargets } from './pointer/calibration.js';
import { GazePointer } from './pointer/GazePointer.js';
import { StripeCursor } from './pointer/StripeCursor.js';
import { PointerOverlay } from './pointer/PointerOverlay.js';
import { DeviceLink } from './device/DeviceLink.js';
import { MediaPlayer, youtubeId } from './media/MediaPlayer.js';

const COLORS = {
  bg: '#0A0F14', text: '#EEF4F7', muted: '#7C93A4',
  accent: '#F5B942', accent2: '#5FD3A0', hot: '#FF6B5B', warn: '#E8A33D', grid: '#24323E',
};

class App {
  constructor() {
    this.cfg = migrateConfig(loadConfig() || deepClone(DEFAULT_CONFIG));

    this.predictor = new Predictor(this.cfg, loadStats());
    if (this.predictor.phrases.size === 0) this.predictor.seedPhrases(DEFAULT_PHRASES);

    this.drafts = new Drafts();
    // Correttore automatico. Costruito sempre, usato solo se acceso:
    // costa nulla finché nessuno lo chiama.
    // I gruppi di lettere fanno parte del modello: dicono quali errori
    // sono probabili con la struttura scelta per QUESTA persona.
    this.correttore = new Correttore(
      this.predictor.lessicoPerCorrezione(), this.cfg.scan.groups);
    this.dettatura = new Dettatura(e => this.onDettatura(e));
    this.audio = new AudioDirector(this.cfg);
    // Banca delle voci registrate: facoltativa. Se l'archivio non è
    // disponibile o è vuoto, tutto continua a funzionare con la sintesi.
    // Radio e media si abbassano mentre il programma parla.
    this.audio.setAbbassamento((on) => this.abbassaPerAnnuncio(on));
    this.voci = new VoiceBank();
    this.registratore = new Registratore();
    this.voci.apri().then(ok => {
      if (!ok) return;
      this.audio.setVoiceBank(this.voci);
      if (this.voci.quante) this.debugView.logEvent(`voci registrate disponibili: ${this.voci.quante}`);
    });

    this.scan = new ScanEngine(this.cfg, {
      onAnnounce: (n, m) => this.onAnnounce(n, m),
      onState: (s) => this.onScanState(s),
      onOutput: (kind, text) => this.onOutput(kind, text),
      onBuffer: (b) => this.onBuffer(b),
      wakeHint: () => this.wakeHint(),
      onMedia: (cmd) => this.media.command(cmd),
      onMediaOpen: (sel) => this.apriDallaLibreria(sel),
      onDraft: (op, arg) => this.onDraft(op, arg),
      onCorrect: (testo, prec, modo) => this.correggi(testo, prec, modo),
      onRadio: (st) => this.apriRadio(st),
      onCasa: (d, c) => this.comandaCasa(d, c),
      onPrint: (testo, id, ok) => this.stampa(testo, id, ok),
      onEmail: (dest, testo, ok) => this.mandaEmail(dest, testo, ok),
    });

    this.gestures = new GestureEngine(this.cfg, (e) => this.onGesture(e));
    // Statistiche cliniche della sessione. Accumulano in memoria
    // costante e si aggiornano su OGNI scheda: la persona va osservata
    // mentre usa il programma, non solo mentre guarda la diagnostica.
    this.sessione = new SessionStats();

    /* ── Sorveglianza della telecamera ──
     * È la protezione più importante del programma: chi lo usa non ha
     * altro modo di comunicare, e una telecamera che si stacca di
     * notte lo lascerebbe muto per ore senza che nessuno se ne accorga.
     */
    this.watchdog = new Watchdog({
      fermoMs: 4000,
      onDiagnosi: (d) => this.onGuastoTelecamera(d),
      onRipristina: () => this.ripristinaTelecamera(),
    });
    this.sorvAudio = new SorveglianzaAudio((c) => this.onCambioDispositivi(c));
    // Finestra compatta sempre in primo piano: serve a chi comanda il
    // cursore con gli occhi e vuole usare altre applicazioni.
    this.finestra = new FinestraFluttuante({
      onChiudi: () => { this.aggiornaMini(); this.toast('Pannello richiuso in Aurora'); },
    });

    this.vision = new VisionPipeline(this.cfg, (tMs, obs, res) => this.onObservation(tMs, obs, res));

    this.settingsView = new SettingsView(document.getElementById('settingsGrid'), this);
    this.statsView = new StatsView(this);
    this.debugView = new DebugView(this);

    this.plot = new SignalPlot(document.getElementById('plotY'));

    // --- Puntamento -------------------------------------------------
    this.calibration = new GazeCalibration();
    this.calibration.load(this.cfg.pointer.calibrationData);
    this.pointer = new GazePointer(this.cfg, e => this.onPointer(e));
    this.pointer.setCalibration(this.calibration);
    this.stripe = new StripeCursor(this.cfg, e => this.onStripe(e));
    this.overlay = new PointerOverlay(document.getElementById('ptrOverlay'));
    this.calibSession = null;

    // --- Dispositivo esterno ---------------------------------------
    this.device = new DeviceLink(this.cfg, e => this.onDevice(e));
    this.media = new MediaPlayer(this.cfg, e => this.onMediaEvent(e));
    // Libreria della sessione: i documenti e le immagini sono oggetti
    // File, non persistibili, quindi vivono finché la pagina è aperta.
    // I video sono link e stanno nella configurazione, quindi restano.
    this.library = { docs: [], images: [], audios: [] };
    this.pointerView = new PointerView(this);
    this.lastSignal = {};
    this.running = false;

    // Il ciclo parte PRIMA di qualunque disegno: se una vista dovesse
    // fallire, la scansione funziona comunque. È l'inversione di
    // priorità che mancava — un errore in un pannello secondario aveva
    // impedito del tutto la comunicazione.
    this.loop();

    this.bindUI();
    setLanguage(this.cfg.ui.language);
    setLangCache(this.cfg.ui.language);
    applyStatic();
    this.applyUiConfig();
    this.updateCamButton();
    // Ogni vista è isolata: il guasto di una non deve impedire le altre,
    // e soprattutto non deve toccare la scansione.
    this._safe('impostazioni', () => this.settingsView.render());
    this._safe('statistiche', () => this.statsView.render());
    this._safe('puntatore', () => this.pointerView.render());
    this._safe('contenuti', () => {
      this.media.attach(document.getElementById('mediaStage'));
      this.renderFavorites();
      this.renderMediaBar();
    });
    this._safe('testi', () => { this.renderDrafts(); this.restoreWip(); });
    this._safe('tracce', () => this.renderTraceBar());
    this._safe('versione', () => this.mostraVersione());
    window.addEventListener('resize', () => this.overlay.resize());
    // Il layout va rimisurato quando cambia la finestra, quando cambia
    // lo zoom (che su desktop arriva come resize) e quando l'orientamento
    // del telefono cambia.
    window.addEventListener('resize', () => this.scheduleFit());
    window.addEventListener('orientationchange', () => setTimeout(() => this.fitSpeakPanel(), 220));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.scheduleFit());
    // I caratteri web arrivano dopo il primo disegno e cambiano le
    // dimensioni: si rimisura appena sono pronti.
    if (document.fonts?.ready) document.fonts.ready.then(() => this.scheduleFit());
    setTimeout(() => this.fitSpeakPanel(), 120);
  }

  /**
   * Mostra la versione caricata e, se ne è arrivata una nuova, la
   * propone. Senza questo si può provare per ore la build vecchia
   * credendo di provare la nuova: la cache del service worker è
   * volutamente aggressiva perché l'applicazione deve funzionare
   * offline.
   */
  mostraVersione() {
    const el = document.getElementById('chipBuild');
    if (el) { el.textContent = `v ${BUILD}`; el.title = `Versione caricata: ${BUILD}`; }
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration?.().then(reg => {
      if (!reg) return;
      const proponi = (sw) => {
        if (!sw) return;
        this.toast(this.cfg.ui.language === 'en'
          ? 'A new version is ready — reloading'
          : 'È pronta una versione nuova — ricarico');
        sw.postMessage('skipWaiting');
        setTimeout(() => location.reload(), 1200);
      };
      if (reg.waiting) proponi(reg.waiting);
      reg.addEventListener?.('updatefound', () => {
        const nuovo = reg.installing;
        nuovo?.addEventListener('statechange', () => {
          if (nuovo.state === 'installed' && navigator.serviceWorker.controller) proponi(nuovo);
        });
      });
      reg.update?.();
    }).catch(() => {});
  }

  /** Esegue una parte non essenziale isolandone i guasti. */
  _safe(name, fn) {
    try { fn(); }
    catch (e) {
      console.error(`[avvio: ${name}]`, e);
      this._bootErrors = this._bootErrors || [];
      this._bootErrors.push(`${name}: ${e.message}`);
      setTimeout(() => this.toast(`Problema in "${name}": ${e.message}`, true), 800);
    }
  }

  /* --------------------------- Config helpers --------------------------- */

  get(path) {
    return path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), this.cfg);
  }

  set(path, value) {
    const keys = path.split('.');
    let o = this.cfg;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
    this.onConfigChanged();
  }

  onConfigChanged() {
    const errs = validateConfig(this.cfg);
    if (errs.length) { this.toast(errs[0], true); return; }
    saveConfig(this.cfg);
    this.audio.updateConfig(this.cfg);
    this.gestures.updateConfig(this.cfg);
    this.scan.updateConfig(this.cfg);
    this.vision.updateConfig(this.cfg);
    this.predictor.updateConfig(this.cfg);
    this.pointer.updateConfig(this.cfg);
    this.stripe.updateConfig(this.cfg);
    this.device.updateConfig(this.cfg);
    this.media.updateConfig(this.cfg);
    this.applyUiConfig();
    this.refreshContext();
    this.scheduleFit();
    if (document.body.dataset.tab === 'diagnostica') this.renderTraceBar();
  }

  applyUiConfig() {
    document.documentElement.style.setProperty('--scale', this.cfg.ui.fontScale);
    document.body.classList.toggle('high-contrast', this.cfg.ui.highContrast);
    // Leggibilità dell'area di lettura, indipendente dal resto: il
    // testo che si legge mentre si scrive ha bisogni diversi dai
    // pulsanti e dalle etichette.
    const lim = (v, d) => Math.max(0.3, Math.min(5, Number.isFinite(v) ? v : d));
    document.documentElement.style.setProperty('--leggi', lim(this.cfg.ui.readScale, 1));
    // Palco e percorso hanno moltiplicatori propri: sono tre livelli di
    // testo con bisogni diversi, e regolarli insieme significa non
    // poterne regolare nessuno.
    document.documentElement.style.setProperty('--palco', lim(this.cfg.ui.stageScale, 0.72));
    document.documentElement.style.setProperty('--percorso', lim(this.cfg.ui.pathScale, 1.5));
    const contrasto = this.cfg.ui.readContrast || 'normale';
    document.body.classList.toggle('read-alto', contrasto === 'alto');
    document.body.classList.toggle('read-massimo', contrasto === 'massimo');
    document.body.classList.toggle('read-focus', !!this.cfg.ui.readFocus);
    // Ingrandire può far traboccare: si rimisura subito.
    this.scheduleFit?.();
    document.body.classList.toggle('theme-light', this.cfg.ui.theme === 'light');
    // La barra del sistema operativo deve seguire il tema, altrimenti
    // in modalità installata resta una striscia scura sul panna.
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = this.cfg.ui.theme === 'light' ? '#FBF5F0' : '#0A0F14';

    if (getLangCache() !== this.cfg.ui.language) {
      setLanguage(this.cfg.ui.language);
      setLangCache(this.cfg.ui.language);
      this.settingsView.render();
      this.statsView.render();
      this.onScanState(this.scan.snapshot());
      this.updateCamButton();
      this.renderTraceBar();
      const ph = document.getElementById('plotHint');
      if (ph) ph.textContent = t('plot.hint');
    }
    document.getElementById('mainHint').style.display = this.cfg.ui.keyboardInput ? '' : 'none';
  }

  persist() {
    // Il lessico è cambiato: l'indice del correttore non è più valido.
    // E se l'assistente ha ritoccato i gruppi, cambia anche il modello
    // degli errori — che dipende da come le lettere sono disposte.
    try {
      this.correttore?.invalidaIndice();
      this.correttore?.setGruppi(this.cfg.scan.groups);
    } catch {} saveStats(this.predictor.serialize()); }

  /* ------------------------------ Contesto ------------------------------ */

  /** Aggiorna suggerimenti e frasi che alimentano l'albero di scansione. */
  refreshContext() {
    const b = this.scan.buffer;
    const prev = b.words[b.words.length - 1] || null;
    const sugg = this.cfg.prediction.enabled
      ? this.predictor.completions(b.letters, prev, this.cfg.scan.suggestionCount)
      : [];
    this.scan.setContext({
      suggestions: sugg,
      phrases: this.predictor.topPhrases(this.cfg.scan.phraseCount || 12),
      mediaCommands: this.media.active ? this.media.commands() : null,
      mediaLabel: this.media.active ? this.mediaLabel() : null,
      mediaSpoken: this.media.active ? 'comandi' : null,
      drafts: this.drafts.list.map(d => ({ id: d.id, title: d.title })),
      hasText: !!(b.words.length || b.letters.trim()),
      library: this.libreriaPerScansione(),
    });
  }

  /* ------------------------------ Callback ------------------------------ */

  onAnnounce(node, meta) { this.audio.announce(node, meta); }

  onScanState(s) {
    document.getElementById('stagePath').textContent = s.path.join(' › ') || 'menu';
    const cur = document.getElementById('stageCurrent');
    cur.textContent = s.paused ? '⏸' : (s.speaking ? '🔊' : (s.current || '—'));
    document.body.classList.toggle('is-speaking', !!s.speaking);
    // In pausa, l'istruzione per riprendere resta scritta a schermo:
    // è l'unica informazione che serve in quel momento.
    const hintEl = document.getElementById('pauseHint');
    if (hintEl) {
      hintEl.textContent = s.paused ? this.wakeHintFull() : '';
      hintEl.style.display = s.paused ? '' : 'none';
    }

    this.scheduleFit();
    // Finestra scorrevole. Con menu lunghi (le AZIONI hanno nove voci)
    // mostrarle tutte le faceva traboccare dal riquadro, e le ultime
    // — RILEGGI, MENU — non si vedevano mai a schermo. Ora si mostra
    // una finestra che tiene sempre visibile la voce corrente e quelle
    // che stanno per arrivare.
    const sib = document.getElementById('stageSiblings');
    const n = s.items.length;
    const max = Math.max(3, this.cfg.scan.visibleItems || 9);
    let da = 0, a = n;
    if (n > max) {
      da = Math.max(0, Math.min(s.index - 2, n - max));
      a = da + max;
    }
    const pezzi = [];
    if (da > 0) pezzi.push(`<span class="sib sib-more">…</span>`);
    for (let i = da; i < a; i++) {
      const cls = i === s.index ? 'is-current' : (i === (s.index + 1) % n ? 'is-next' : '');
      pezzi.push(`<span class="sib ${cls}">${this._esc(s.items[i])}</span>`);
    }
    if (a < n) pezzi.push(`<span class="sib sib-more">…</span>`);
    sib.innerHTML = pezzi.join('');

    const chip = document.getElementById('chipEngine');
    chip.textContent = s.paused ? t('status.paused') : t('status.running');
    chip.dataset.state = s.paused ? 'paused' : 'running';
  }

  onBuffer(b) {
    const sentence = document.getElementById('composeSentence');
    const text = [...b.words].join(' ');
    sentence.innerHTML = text ? this._esc(text) : '<span class="placeholder">…</span>';
    document.getElementById('composeLetters').textContent = b.letters;
    // La scheda Punta mostra lo stesso testo: è lo stesso buffer.
    this.pointerView?.renderCompose(b);
    // Salvataggio automatico: un'ora di composizione persa per una
    // scheda chiusa è un danno che non si può chiedere di riparare.
    if (this.cfg.drafts.autosave) {
      const txt = [...b.words, b.letters].join(' ').trim();
      if (txt) this.drafts.saveWip(txt);
    }
    this.scheduleFit();
    this.refreshContext();
  }

  /**
   * Come riprendere dalla pausa, detto con le durate REALI configurate.
   * Se nessun gesto è assegnato al risveglio lo dice esplicitamente,
   * invece di lasciare la persona in un vicolo cieco.
   */
  /**
   * Annuncio della pausa: una sola parola.
   *
   * L'istruzione completa ("tieni il gesto 3,4 secondi") era giusta la
   * prima volta e diventava insopportabile alla decima. A voce si dice
   * solo "pausa"; l'istruzione resta scritta a schermo, dove non costa
   * tempo a nessuno e resta disponibile per chi assiste.
   */
  wakeHint() { return this.cfg.ui.language === 'en' ? 'Paused' : 'Pausa'; }

  /** Istruzione completa, solo per lo schermo. */
  wakeHintFull() {
    const g = this.cfg.gestures;
    const en = this.cfg.ui.language === 'en';
    const wake = Object.entries(g).find(([, v]) => v && v.enabled
      && (v.action === 'WAKE' || v.action === 'TOGGLE_PAUSE'));
    if (!wake) return en
      ? 'Paused. No wake gesture is assigned — an assistant must restart it.'
      : 'In pausa. Nessun gesto di risveglio assegnato: deve riavviare un assistente.';
    const secs = (wake[1].dwellMs / 1000).toFixed(1).replace('.', en ? '.' : ',');
    return en
      ? `Paused. Hold the gesture ${secs} seconds to resume.`
      : `In pausa. Tieni il gesto ${secs} secondi per riprendere.`;
  }

  /**
   * Restituisce SEMPRE una promessa: la scansione la usa per fermarsi
   * finché il messaggio non è stato pronunciato per intero.
   */
  onOutput(kind, text, opt = {}) {
    if (kind === 'speech') {
      this.predictor.learnSentence(text);
      appendLog({ t: Date.now(), text });
      this.persist();
      this.statsView.render();
      this.debugView.logEvent(`pronunciata: "${text}"`);
      this.showSpoken(text);
      return this.speakLong(text);
    }
    // Anche i messaggi di servizio ("annullato", la rilettura) vanno
    // protetti: altrimenti il passo successivo li cancella a metà.
    return this.audio.speakProtected(text, 'menu', false);
  }

  /**
   * Legge un testo lungo frase per frase.
   *
   * Un blocco unico non si può fermare a metà, e alcune sintesi vocali
   * troncano oltre una certa lunghezza. Frase per frase, invece, un
   * gesto qualsiasi interrompe: indispensabile per una lettera di
   * cinque minuti.
   */
  async speakLong(text) {
    const parts = this.cfg.drafts.speakBySentence ? splitSentences(text) : [text];
    this._speaking = { stop: false, total: parts.length, index: 0 };
    for (let i = 0; i < parts.length; i++) {
      if (this._speaking.stop) break;
      this._speaking.index = i;
      await this.audio.speakProtected(parts[i], 'speech', i === parts.length - 1);
    }
    const stopped = this._speaking.stop;
    this._speaking = null;
    if (stopped) this.debugView.logEvent('lettura interrotta');
  }

  /** Un gesto durante la lettura la interrompe. */
  stopSpeaking() {
    if (!this._speaking) return false;
    this._speaking.stop = true;
    this.audio.stop();
    return true;
  }

  /* -------------------------------- Testi -------------------------------- */

  /**
   * @returns {Promise|undefined} la scansione attende la voce, se c'è
   */
  onDraft(op, arg = {}) {
    const en = this.cfg.ui.language === 'en';
    // Recupero del testo: serve all'invio per posta, che deve poterlo
    // leggere senza passare dalla pronuncia.
    if (op === 'text') return this.drafts.get(arg.id)?.text || '';
    if (op === 'save') {
      const d = this.drafts.add(arg.text);
      this.drafts.clearWip();
      this.refreshContext();
      this.renderDrafts();
      this.toast(`${en ? 'Saved' : 'Salvato'}: ${d.title}`);
      return this.audio.speakProtected(en ? 'Saved' : 'Testo salvato', 'menu');
    }
    if (op === 'speak') {
      const d = this.drafts.get(arg.id);
      if (!d) return;
      this.showSpoken(d.text);
      appendLog({ t: Date.now(), text: d.text });
      return this.speakLong(d.text);
    }
    if (op === 'load') {
      const d = this.drafts.get(arg.id);
      if (!d) return;
      this.scan.loadText(d.text, performance.now());
      this.currentDraftId = d.id;
      this.toast(`${en ? 'Resumed' : 'Ripreso'}: ${d.title}`);
      return this.audio.speakProtected(en ? 'You can continue writing' : 'Puoi continuare a scrivere', 'menu');
    }
    if (op === 'delete') {
      const d = this.drafts.get(arg.id);
      this.drafts.remove(arg.id);
      this.refreshContext();
      this.renderDrafts();
      return this.audio.speakProtected(en ? 'Deleted' : 'Eliminato', 'menu');
    }
  }

  /** Elenco dei testi salvati, con riordino e rinomina. */
  renderDrafts() {
    const list = document.getElementById('draftList');
    if (!list) return;
    const items = this.drafts.list;
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<p class="sub">Nessun testo salvato. Componi qualcosa nella pagina Parla e scegli SALVA QUESTO TESTO.</p>';
      return;
    }
    const shown = this.cfg.scan.draftCount || 10;
    items.forEach((d, i) => {
      if (i === shown) {
        const sep = document.createElement('p');
        sep.className = 'sub'; sep.style.margin = '.5rem 0 .2rem';
        sep.textContent = `↓ oltre i primi ${shown}: non compaiono nel menu di scansione`;
        list.append(sep);
      }
      const row = document.createElement('div');
      row.className = 'row';
      const k = document.createElement('span');
      k.className = 'k';
      k.innerHTML = `<b>${this._esc(d.title)}</b><br><span class="sub">${this._esc(d.text.slice(0, 90))}${d.text.length > 90 ? '…' : ''}</span>`;
      k.style.cursor = 'text';
      k.title = 'Tocca per rinominare';
      k.onclick = () => {
        const nuovo = prompt('Titolo del testo:', d.title);
        if (nuovo === null) return;
        this.drafts.rename(d.id, nuovo);
        this.refreshContext(); this.renderDrafts();
      };
      const play = document.createElement('button');
      play.textContent = '▶'; play.title = 'Pronuncia';
      play.onclick = () => this.onDraft('speak', { id: d.id });
      const edit = document.createElement('button');
      edit.textContent = '✎'; edit.title = 'Riprendi a scrivere';
      edit.onclick = () => { this.onDraft('load', { id: d.id }); this.goto('parla'); };
      const dl = document.createElement('button');
      dl.textContent = '↓'; dl.title = 'Scarica come file';
      dl.onclick = () => this.downloadText(d.text, d.title);
      const ord = document.createElement('div');
      ord.className = 'ord';
      const up = document.createElement('button'); up.textContent = '▲';
      up.onclick = () => { this.drafts.move(d.id, -1); this.refreshContext(); this.renderDrafts(); };
      const dn = document.createElement('button'); dn.textContent = '▼';
      dn.onclick = () => { this.drafts.move(d.id, 1); this.refreshContext(); this.renderDrafts(); };
      ord.append(up, dn);
      const del = document.createElement('button');
      del.textContent = '×';
      del.onclick = () => {
      // ⚠️ La conferma con dialogo vale solo per l'ASSISTENTE, che ha
      // un mouse. Dalla scansione arriva già confermato, perché lì la
      // conferma è una voce del menu: un dialogo del browser bloccherebbe
      // la pagina e chi non può cliccare resterebbe chiuso dentro.
      if (!arg.confermato && !confirm(`Eliminare "${d.title}"?`)) return;
        this.drafts.remove(d.id); this.refreshContext(); this.renderDrafts();
      };
      row.append(k, play, edit, dl, ord, del);
      list.append(row);
    });
  }

  downloadText(text, title) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(title || 'testo').replace(/[^\w\s-]/g, '').trim().slice(0, 50) || 'testo'}.txt`;
    a.click();
    this.toast('Scaricato');
  }

  /** Ultima frase pronunciata, visibile a schermo per gli astanti. */
  showSpoken(text) {
    const el = document.getElementById('spokenBanner');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    this.scheduleFit();
    clearTimeout(this._spokenT);
    this._spokenT = setTimeout(() => el.classList.remove('show'), 6000);
    this.toast(`"${text}"`);
  }

  onGesture(e) {
    try {
      this.sessione?.gesto(e);
      // Una selezione VERA: serve a stimare i falsi positivi come
      // differenza fra soglie superate e selezioni compiute.
      if (e.action === 'SELECT') this.sessione?.selezione();
    } catch {}
    // Durante una lettura lunga, il primo gesto la ferma e basta.
    if (this.cfg.drafts.stopSpeechOnGesture && this.stopSpeaking()) {
      this.audio.earcon('undo');
      this.debugView.logEvent(`${e.channel} → lettura interrotta`);
      return;
    }
    this.debugView.logEvent(`${e.channel} → ${e.action}${e.durMs ? ` (${Math.round(e.durMs)} ms)` : ''}`);
    if (e.action === 'UNDO') this.audio.earcon('undo');
    else if (e.action === 'WAKE' || e.action === 'TOGGLE_PAUSE' || e.action === 'PAUSE') {
      // Il tono racconta cosa è SUCCESSO, non cosa è stato chiesto: un
      // comando senza effetto (risveglia a programma già attivo) non
      // deve suonare come se avesse fatto qualcosa.
      const prima = this.scan.paused;
      setTimeout(() => {
        if (this.scan.paused === prima) return;          // nessun cambiamento
        this.audio.earcon(this.scan.paused ? 'pause' : 'wake');
      }, 0);
    }
    else this.audio.earcon('confirm');
    // In modalità bande il gesto pilota il cursore, non la scansione:
    // sono due usi alternativi dello stesso, unico gesto disponibile.
    //
    // Ma SOLO nella scheda Punta, o mentre una scansione a bande è già
    // in corso. Altrimenti attivare le bande spegnerebbe di fatto la
    // pagina Parla, e il gesto non farebbe più comunicare.
    const bandeInUso = this.cfg.pointer.enabled
      && this.cfg.pointer.mode === 'scanStripe'
      && (document.body.dataset.tab === 'punta' || this.stripe.active);
    if (bandeInUso) {
      if (e.action === 'SELECT') { this.stripe.select(performance.now()); return; }
      if (e.action === 'UNDO') { this.stripe.cancel(); return; }
    }
    this.scan.handleAction(e.action, performance.now());
    this.gestures.setPaused(this.scan.paused);
  }

  /**
   * @param tMs timestamp di CATTURA del fotogramma.
   *
   * ⚠️ Il parametro NON si chiama `t`: in questo file `t` è la funzione
   * di traduzione importata da i18n, e un parametro con lo stesso nome
   * la oscura. È già successo, e l'effetto era subdolo — un'eccezione a
   * ogni fotogramma che spegneva silenziosamente tutta la diagnostica.
   */
  onObservation(tMs, obs, res) {
    try {
      this._observe(tMs, obs, res);
    } catch (e) {
      // Un errore qui gira 30 volte al secondo: va segnalato UNA volta
      // e in modo visibile, non lasciato morire nella console.
      if (!this._obsError || this._obsError !== e.message) {
        this._obsError = e.message;
        console.error('[osservazione]', e);
        this.debugView.logEvent(`errore nel ciclo video: ${e.message}`, true);
        this.toast(`Errore nell'analisi video: ${e.message}`, true);
      }
    }
  }

  _observe(tMs, obs, res) {
    // Il cuore batte: la telecamera sta producendo fotogrammi.
    this.watchdog?.battito(performance.now());
    const out = this.gestures.process(tMs, obs);

    // Il grafico riceve TUTTI i canali, non un segnale già fuso: ogni
    // occhio e ogni direzione hanno la propria soglia, quindi devono
    // poter essere osservati separatamente.
    const ch = this.gestures.channels();
    const blink = {};
    for (const id of Object.keys(BLINK_STYLE)) blink[id] = !!ch[id]?.closed;
    this.plot.push({
      ch, blink,
      evt: out.candidates?.length ? out.candidates.map(c => ({ phase: c.phase, eye: c.eye })) : null,
    });

    // Il puntatore usa il segnale GREZZO normalizzato dell'occhio
    // dominante, non quello filtrato per i gesti: i filtri anti-nistagmo
    // sono tarati per rilevare un gradino, e introdurrebbero un ritardo
    // inaccettabile su un cursore che deve inseguire lo sguardo.
    const domEye = this.gestures.dominant;
    // Occhio da usare per il puntatore. Se il dominante è
    // momentaneamente non valido (palpebra, perdita di tracciamento) si
    // ripiega sull'altro: durante la calibrazione perdere i campioni di
    // un bersaglio falsa l'intera misura.
    const eyeRaw = (domEye && obs[domEye]) || obs.left || obs.right || null;

    // Durante la taratura automatica si registra e basta.
    this._raccogliTaratura(tMs, obs);

    if (this.calibSession) {
      // ⚠️ La calibrazione deve funzionare ANCHE a puntatore spento.
      // Prima era subordinata a pointer.enabled, ma il puntatore si
      // accende DOPO aver calibrato: la raccolta non partiva mai, e la
      // calibrazione finiva con campioni tutti uguali — da cui il
      // messaggio "nessun movimento verticale rilevabile".
      if (eyeRaw) this.onCalibrationSample(tMs, eyeRaw);
    } else if (this.cfg.pointer.enabled && this.cfg.pointer.mode === 'gaze' && eyeRaw) {
      this.pointer.update(tMs, eyeRaw);
    }

    const domUp = domEye ? ch[`${domEye}.up`] : null;
    this.lastSignal = domUp ? { n: domUp.n, sigma: domUp.sigma, baseline: domUp.baseline } : {};

    // Statistiche cliniche: un accumulo per fotogramma, costo
    // trascurabile. Isolate perché un guasto qui non deve mai fermare
    // la scansione, che è l'unico modo che la persona ha di parlare.
    if (this.cfg.ui.sessionStats !== false) {
      try {
        this.sessione.push(tMs, obs, domUp ? Math.abs(domUp.n) : null, !!domUp?.active);
        if (domUp && domUp.active && !this._sopraSoglia) this.sessione.sogliaSuperata();
        this._sopraSoglia = !!domUp?.active;
      } catch (e) { this._frameError(e); }
    }

    const chip = document.getElementById('chipSignal');
    if (chip) {
      if (out.fused) {
        const q = this.gestures.snr[domEye] ?? 0;
        chip.textContent = q > 4 ? t('status.good') : q > 2 ? t('status.fair') : t('status.weak');
      } else {
        chip.textContent = t('status.noEye');
      }
    }

    // Il disegno della diagnostica è isolato: un problema nel grafico
    // non deve poter impedire di vedere gli occhi, che è l'informazione
    // più importante di questa schermata.
    if (document.body.dataset.tab !== 'diagnostica') return;
    const frame = this.vision.lastFrame;
    drawEyeDebug(document.getElementById('eyeLeft'), frame, res, 'left', this.cfg, COLORS);
    drawEyeDebug(document.getElementById('eyeRight'), frame, res, 'right', this.cfg, COLORS);
    this.debugView.updateTags(res);
    // Registro in console: gira sempre, anche fuori da diagnostica,
    // perché i problemi capitano proprio quando si è altrove.
    try { this.registroConsole(tMs); } catch {}
    try {
      /* ⚠️ `tMs` è il tempo del fotogramma corrente.
       *
       * Qui prima si usava una variabile `now` che in questo blocco NON
       * ESISTE: ogni fotogramma sollevava un errore, il `try` lo
       * inghiottiva in silenzio, e il riepilogo clinico non veniva mai
       * disegnato. I contatori restavano a zero per sempre e sembrava
       * che la raccolta non funzionasse — mentre i dati c'erano tutti,
       * solo nessuno li mostrava. */
      const now = tMs;
      const { traces, blinks } = this.activeTraces();
      this.plot.draw(COLORS, this.cfg.signal.thresholdOn, this.cfg.signal.thresholdOff,
                     traces, blinks, this.cfg.ui.plotShowRaw);
      this.debugView.renderCounters();
      // Il riepilogo clinico si ridisegna una volta ogni due secondi:
      // sono decine di percentili, non vanno ricalcolati a ogni fotogramma.
      if (!this._tDiagStats || now - this._tDiagStats > 2000) {
        this._tDiagStats = now;
        this.renderDiagStats();
      }
      // La barra video si aggiorna più spesso: la posizione deve
      // seguire la riproduzione in modo fluido.
      if (!this._tBarraVideo || now - this._tBarraVideo > 250) {
        this._tBarraVideo = now;
        this.aggiornaBarraVideo();
        this.aggiornaStatoTelecamera();
        this.aggiornaMini();
        this.aggiornaPulsanteMini();
      }
    } catch (e) {
      console.error('[grafico]', e);
    }
  }

  /* ------------------------------ Radio ------------------------------ */

  /**
   * Apre una radio online.
   *
   * Un flusso radio è audio come un altro: l'elemento che il programma
   * già usa per i file lo riproduce senza aggiungere nulla. L'unica
   * differenza è che non finisce mai, quindi non ha senso mostrare una
   * durata o una barra di avanzamento.
   */
  apriRadio(stazione) {
    if (!stazione?.url) return;
    try {
      if (!this.radioEl) {
        this.radioEl = document.createElement('audio');
        this.radioEl.preload = 'none';
        // Un flusso può cadere: la rete di casa non è un cavo.
        this.radioEl.onerror = () => {
          this.toast(`Radio non raggiungibile: ${this.radioNome || ''}`, true);
          this.debugView?.logEvent('radio: flusso non raggiungibile', true);
        };
        document.body.append(this.radioEl);
      }
      this.radioEl.src = stazione.url;
      this.radioEl.volume = this.cfg.audio.speechVolume ?? 1;
      this.radioNome = stazione.nome;
      this.radioEl.play().catch(() => {
        this.toast('Riproduzione non avviata: tocca lo schermo una volta', true);
      });
      this.toast(`Radio: ${stazione.nome}`);
      this.debugView?.logEvent('radio: ' + stazione.nome);
      document.body.classList.add('has-radio');
    } catch (e) {
      this.toast('Radio non avviata: ' + e.message, true);
    }
  }

  fermaRadio() {
    try { this.radioEl?.pause(); } catch {}
    this.radioNome = null;
    document.body.classList.remove('has-radio');
  }

  /**
   * Abbassa la radio mentre il programma annuncia, e la rialza dopo.
   *
   * È la soluzione dei navigatori satellitari sopra la musica, e
   * funziona perché l'orecchio segue la voce anche su un fondo. Senza,
   * ascoltare la radio significherebbe non sentire più la guida — e
   * quindi non poter più cambiare stazione.
   */
  abbassaPerAnnuncio(attivo) {
    if (!this.radioEl || this.radioEl.paused) return;
    const pieno = this.cfg.audio.speechVolume ?? 1;
    this.radioEl.volume = attivo ? pieno * 0.15 : pieno;
  }

  /* ------------------------------ Posta ------------------------------ */

  /**
   * Spedisce un testo per posta.
   *
   * ⚠️ Conferma obbligatoria di default: un messaggio parte una volta
   * sola e non torna indietro. Per chi seleziona con lo sguardo, un
   * gesto involontario non deve poter spedire una lettera.
   */
  async mandaEmail(destinatario, testo, giaConfermato = false) {
    const v = verificaConfigurazione(this.cfg);
    if (!v.ok) {
      this.toast('Posta non configurata: ' + v.problemi[0], true);
      return { ok: false };
    }
    // Dalla scansione la conferma è già avvenuta come voce del menu.
    if (this.cfg.email.conferma && !giaConfermato) {
      const anteprima = String(testo).slice(0, 140);
      if (!confirm(`Inviare a ${destinatario.nome} <${destinatario.indirizzo}>?\n\n"${anteprima}"`)) {
        this.toast('Invio annullato');
        return { ok: false };
      }
    }
    this.toast('Invio in corso…');
    const r = await inviaEmail(this.cfg, { destinatario, testo });
    this.toast(r.ok ? `✓ ${r.messaggio}` : `Invio non riuscito: ${r.messaggio}`, !r.ok);
    this.debugView?.logEvent('posta: ' + r.messaggio, !r.ok);
    this.audio.earcon(r.ok ? 'confirm' : 'error');
    return r;
  }

  /* ══════════════════════════════════════════════════════════════════
   * REGISTRO DETTAGLIATO IN CONSOLE
   * ══════════════════════════════════════════════════════════════════
   *
   * Si accende in Impostazioni e scrive nella console del browser (F12)
   * una riga ogni due secondi con i numeri che contano davvero.
   *
   * Serve perché descrivere a parole "l'ampiezza cala" o "il video si
   * blocca" non basta a capire dove intervenire: servono i numeri, nel
   * momento in cui il problema accade. Con questi si converge in un
   * giro invece che in dieci.
   */
  registroConsole(now) {
    const d = this.cfg.debug;
    if (!d?.console) return;
    if (now - (this._ultimoRegistro || 0) < (d.ogniMs || 2000)) return;
    this._ultimoRegistro = now;

    const src = this.vision?.source;
    // La sorgente scrive anche i propri eventi, se il registro è acceso.
    if (src && src.registra !== d.console) src.registra = d.console;
    const v = src?.video;
    const G = this.gestures;
    const L = G?.eyes?.left?.y, R = G?.eyes?.right?.y;
    const C = G?.counters || {};
    const ch = G?.channels?.() || {};

    const f = (x, n = 4) => (Number.isFinite(x) ? x.toFixed(n) : '—');
    const pct = (a, b) => (a + b) ? Math.round(100 * a / (a + b)) + '%' : '—';

    // Ampiezza: quanto vale ORA il canale dello sguardo in alto.
    const nSx = ch['left.up']?.n, nDx = ch['right.up']?.n;

    // Quanto l'iride risulta schiacciata: se è sempre sotto la soglia,
    // la correzione interverrebbe di continuo e sarebbe da rivedere.
    const sch = (lato) => {
      const a = this.vision?.rgb?.stato?.[lato]?.schiacc;
      if (!a?.length) return '—';
      return (a.reduce((x, y) => x + y, 0) / a.length).toFixed(3);
    };
    const quanteVolte = (lato) => {
      const st = this.vision?.rgb?.stato?.[lato];
      if (!st?.totali) return '—';
      return Math.round(100 * (st.corretti || 0) / st.totali) + '%';
    };

    console.log(
      `[aurora ${((now - (this._t0Registro ||= now)) / 1000).toFixed(0)}s]`
      + ` σ ${f(L?.sigma, 5)}/${f(R?.sigma, 5)}`
      + ` | base ${f(L?.baseline)}/${f(R?.baseline)}`
      + ` | ampiezza ${f(nSx, 1)}σ/${f(nDx, 1)}σ`
      + ` | grezzo ${f(L?.smooth)}/${f(R?.smooth)}`
      + ` | validi ${pct(C.validiLeft, C.scartatiLeft)}/${pct(C.validiRight, C.scartatiRight)}`
      + ` | schiacc ${sch('left')}/${sch('right')} (corretti ${quanteVolte('left')}/${quanteVolte('right')})`
      + ` | video ${v ? `t=${f(v.currentTime, 2)}s rs=${v.readyState} ${v.paused ? 'FERMO' : 'va'}` : 'assente'}`
      + ` | bloccati ${src?.bloccati ?? 0} riprese ${src?.riprese ?? 0} errori ${src?.errori ?? 0}`
      + ` | fps ${f(this.vision?.fps, 1)}`
      + ` | scheda ${document.body.dataset.tab}`
    );
  }

  /* ------------------- Selettore della telecamera ------------------- */

  /**
   * Riempie tutti i selettori di telecamera presenti nella pagina.
   *
   * ⚠️ Ce n'è uno accanto a OGNI comando di accensione — Parla, Punta,
   * Diagnostica — perché "quale telecamera sta usando?" è la prima
   * domanda quando qualcosa non funziona, e la risposta non deve
   * costare un giro nelle impostazioni.
   *
   * Sono tenuti allineati fra loro: cambiando da una schermata, tutte
   * mostrano la stessa scelta.
   */
  async aggiornaSelettoriCamera() {
    const sel = document.querySelectorAll('[data-cam-select]');
    if (!sel.length) return;
    let dispositivi = [];
    try { dispositivi = await CameraSource.listDevices(); } catch {}

    // Finché non è stato concesso il permesso le etichette sono vuote:
    // si dice perché, invece di mostrare un elenco muto.
    const senzaNomi = dispositivi.length && dispositivi.every(d => !d.label);
    const scelto = this.cfg.source.deviceId || '';

    for (const s2 of sel) {
      s2.innerHTML = '';
      if (!dispositivi.length) {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = this.cfg.ui.language === 'en'
          ? 'No camera found' : 'Nessuna telecamera trovata';
        s2.append(o);
        s2.disabled = true;
        continue;
      }
      s2.disabled = false;
      const auto = document.createElement('option');
      auto.value = '';
      auto.textContent = this.cfg.ui.language === 'en' ? 'Automatic' : 'Automatica';
      s2.append(auto);
      dispositivi.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = d.label || (this.cfg.ui.language === 'en'
          ? `Camera ${i + 1} (name after permission)` : `Telecamera ${i + 1} (nome dopo il permesso)`);
        if (d.id === scelto) o.selected = true;
        s2.append(o);
      });
      s2.onchange = () => {
        this.set('source.deviceId', s2.value);
        // Le altre restano allineate: mostrano tutte la stessa scelta.
        for (const altro of sel) if (altro !== s2) altro.value = s2.value;
        // Cambiare telecamera a camera accesa richiede di riaprirla.
        if (this.vision?.status === 'attiva') {
          this.toast('Riavvio la telecamera con quella scelta…');
          this.ripristinaTelecamera().catch(() => {});
        }
        this.settingsView?.render();
      };
    }
    if (senzaNomi) this._camNomiMancanti = true;
  }

  /* -------------------- Mouse del sistema operativo -------------------- */

  /**
   * Invia al dispositivo lo spostamento corrispondente al puntatore.
   *
   * ⚠️ Chiamato dal ciclo del puntatore, quindi deve costare pochissimo
   * e non deve mai sollevare eccezioni: un errore qui fermerebbe il
   * puntatore, che per chi lo usa è l'unico modo di comandare.
   */
  mouseDaPuntatore(nx, ny) {
    if (!this.cfg.device?.mouse?.enabled) return;
    try { this.device?.mouseFromPointer(nx, ny); } catch {}
  }

  /**
   * Verifica se il programma ponte è in ascolto sul computer.
   *
   * Sapere se è avviato, e saperlo PRIMA di provare a usarlo, evita di
   * cercare il difetto nel posto sbagliato: quasi sempre il motivo per
   * cui il cursore non si muove è che il programma non è partito.
   */
  async verificaPonte() {
    const url = this.cfg.device?.bridgeUrl || 'ws://127.0.0.1:8089/device';
    return new Promise((ris) => {
      let ws = null;
      const chiudi = (r) => { try { ws?.close(); } catch {} ris(r); };
      const scaduto = setTimeout(() => chiudi({
        ok: false,
        messaggio: this.cfg.ui.language === 'en'
          ? 'not running: start the downloaded program'
          : 'non avviato: fai partire il programma scaricato',
      }), 3000);
      try {
        ws = new WebSocket(url);
        ws.onopen = () => { clearTimeout(scaduto); chiudi({
          ok: true,
          messaggio: this.cfg.ui.language === 'en' ? 'running and reachable' : 'avviato e raggiungibile',
        }); };
        ws.onerror = () => { clearTimeout(scaduto); chiudi({
          ok: false,
          messaggio: this.cfg.ui.language === 'en'
            ? 'not running: start the downloaded program'
            : 'non avviato: fai partire il programma scaricato',
        }); };
      } catch (e) {
        clearTimeout(scaduto);
        chiudi({ ok: false, messaggio: e?.message || 'non raggiungibile' });
      }
    });
  }

  /* --------------- Finestra compatta sempre in primo piano --------------- */

  /**
   * Apre il pannello minimo in una finestra che sta sopra le altre
   * applicazioni.
   *
   * È l'unico modo, dentro un browser, di continuare a elaborare
   * mentre la persona usa il computer: una scheda in secondo piano
   * viene fermata, una finestra visibile no.
   */
  async apriFinestraCompatta() {
    if (!finestraSupportata()) {
      /* Messaggio esplicito e duraturo: un avviso che scompare in tre
       * secondi fa credere che il pulsante sia guasto. */
      this.toast('Il tuo browser non offre le finestre sempre in primo piano. Servono Chrome o Edge da computer, versione recente. Su Firefox e Safari la funzione non esiste.', true);
      this.debugView?.logEvent('finestra in primo piano: non disponibile in questo browser', true);
      return false;
    }
    const pannello = document.getElementById('miniPanel');
    if (!pannello) return false;
    pannello.hidden = false;
    /* ⚠️ Piccola davvero: 250×130 invece di 400×250.
     *
     * Deve restare visibile mentre la persona usa il computer, quindi
     * deve occupare pochissimo. Un riquadro che copre un angolo di
     * schermo è un riquadro che dà fastidio, e che si finisce per
     * chiudere — perdendo proprio la funzione per cui esiste. */
    const r = await this.finestra.apri(pannello, {
      larghezza: this.cfg.ui.miniLarghezza || 250,
      altezza: this.cfg.ui.miniAltezza || 130,
    });
    if (!r.ok) {
      pannello.hidden = true;
      this.toast('Finestra non aperta: ' + r.motivo, true);
      return false;
    }
    this.aggiornaMini();
    this.toast('Pannello in primo piano: ora puoi usare il computer');
    this.debugView?.logEvent('finestra compatta aperta');
    return true;
  }

  /**
   * Il comando di riduzione compare solo quando serve davvero: a mouse
   * di sistema spento e senza funzionamento in secondo piano non
   * servirebbe a nulla, e sarebbe solo un pulsante in più da capire.
   */
  aggiornaPulsanteMini() {
    const b = document.getElementById('btnMini');
    if (!b) return;
    // Disponibile ovunque il browser lo sostenga: serve anche solo per
    // tenere Aurora attivo mentre si guarda un'altra scheda, non solo
    // a chi comanda il mouse con gli occhi.
    b.hidden = !finestraSupportata();
    b.textContent = this.finestra?.aperta ? '▣ Torna' : '▣ Riduci';
    b.title = this.finestra?.aperta
      ? 'Riporta il pannello dentro Aurora'
      : 'Riduci restando attivo sopra le altre finestre';
  }

  chiudiFinestraCompatta() {
    this.finestra?.chiudi();
    const pannello = document.getElementById('miniPanel');
    if (pannello) pannello.hidden = true;
  }

  /** Tiene aggiornato il pannello compatto, se è in uso. */
  aggiornaMini() {
    if (!this.finestra?.aperta) return;
    const doc = this.finestra.win?.document;
    if (!doc) return;
    const stato = doc.getElementById('miniStato');
    const voce = doc.getElementById('miniVoce');
    const cur = doc.getElementById('miniCur');
    if (stato) {
      const viva = this.vision?.status === 'attiva';
      stato.textContent = viva ? '● attivo' : '○ fermo';
      stato.classList.toggle('on', viva);
    }
    if (voce) voce.textContent = this.scan?.currentNode?.label || 'Aurora';
    if (cur && this.cfg.device?.mouse?.enabled) {
      cur.textContent = this.device?.connected ? 'mouse collegato' : 'mouse non collegato';
    }
  }

  /* ----------------------------- Domotica ----------------------------- */

  /** Invia un comando a un dispositivo di casa. */
  async comandaCasa(dispositivo, comando) {
    const v = verificaDomotica(this.cfg);
    if (!v.ok) {
      this.toast('Domotica non configurata: ' + v.problemi[0], true);
      return;
    }
    const r = await comandaCasa(this.cfg, dispositivo, comando);
    // In caso di successo si annuncia poco: chi accende la luce lo
    // vede da sé, e un annuncio in più costa tempo a ogni comando.
    if (r.ok) this.toast(r.messaggio);
    else {
      this.toast('Comando non riuscito: ' + r.messaggio, true);
      this.audio.earcon('error');
    }
    this.debugView?.logEvent('casa: ' + r.messaggio, !r.ok);
  }

  /* ------------------------------ Stampa ------------------------------ */

  /**
   * Stampa un testo.
   *
   * ⚠️ NON passa da Home Assistant: il browser sa già stampare su
   * qualunque stampante collegata al computer, senza intermediari e
   * senza configurazione. Home Assistant serve semmai ad accenderla,
   * ed è un dispositivo come gli altri.
   *
   * Si stampa in una finestra separata: stampare la pagina di Aurora
   * produrrebbe fogli pieni di pulsanti invece della lettera.
   */
  stampa(testo, id, giaConfermato = false) {
    const t2 = String(testo || '').trim();
    if (!t2) { this.toast('Non c\'è niente da stampare', true); return; }
    if (this.cfg.stampa?.conferma && !giaConfermato) {
      if (!confirm(`Stampare questo testo?\n\n"${t2.slice(0, 160)}"`)) {
        this.toast('Stampa annullata');
        return;
      }
    }
    try {
      const titolo = this.drafts.get(id)?.title || 'Testo';
      const esc = (x) => String(x).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

      /* ⚠️ RIQUADRO NASCOSTO NELLA STESSA PAGINA, mai una finestra nuova.
       *
       * Aprendo un'altra finestra il fuoco andrebbe altrove e chi non
       * può muoversi non potrebbe più tornare ad Aurora: resterebbe
       * senza voce davanti a una pagina che non sa chiudere.
       *
       * Il riquadro nascosto contiene solo la lettera, quindi si stampa
       * la lettera e non la schermata del programma — e Aurora resta
       * dov'è, con la sua scansione. */
      let f = document.getElementById('printFrame');
      if (!f) {
        f = document.createElement('iframe');
        f.id = 'printFrame';
        f.setAttribute('aria-hidden', 'true');
        f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px';
        document.body.append(f);
      }
      const d = f.contentDocument;
      d.open();
      d.write(
        `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(titolo)}</title>`
        + '<style>body{font:16pt/1.6 Georgia,serif;margin:2.5cm;white-space:pre-wrap}'
        + 'h1{font-size:14pt;color:#555;border-bottom:1px solid #ccc;padding-bottom:.4em}</style>'
        + `</head><body><h1>${esc(titolo)} — ${new Date().toLocaleDateString('it-IT')}</h1>`
        + `${esc(t2)}</body></html>`);
      d.close();

      /* La finestra di stampa del sistema blocca i tempi del browser
       * finché non viene chiusa. Senza avvisare la sorveglianza, al
       * ritorno vedrebbe minuti senza fotogrammi e riavvierebbe la
       * telecamera per un guasto che non c'è mai stato. */
      this.watchdog?.ferma();
      setTimeout(() => {
        try { f.contentWindow.focus(); f.contentWindow.print(); }
        catch (e2) { this.toast('Stampa non riuscita: ' + e2.message, true); }
        finally {
          // Il fuoco torna ad Aurora, e la sorveglianza riprende.
          try { window.focus(); } catch {}
          if (this.vision?.status === 'attiva') {
            this.watchdog?.avvia(() => performance.now());
            const st = this.vision.source?.stream;
            if (st) this.watchdog.sorveglia(st);
          }
        }
      }, 250);

      this.toast('Stampa avviata — un assistente deve confermare sulla finestra di stampa');
      this.debugView?.logEvent('stampa: ' + titolo);
    } catch (e) {
      this.toast('Stampa non riuscita: ' + e.message, true);
    }
  }

  /* ------------------------- Autocorrezione ------------------------- */

  /**
   * Punto unico di correzione, chiamato dal motore di scansione.
   *
   * ⚠️ Isolato: un errore qui non deve mai fermare la scrittura. Se il
   * correttore fallisce, la parola resta com'era — che è esattamente
   * ciò che deve succedere anche quando funziona ma non è sicuro.
   */
  correggi(testo, precedente, modo) {
    const P = this.cfg.prediction;
    if (!P?.autoCorrect) return null;
    // In modalità "frase" non si corregge parola per parola, e
    // viceversa: sono due momenti diversi, non due livelli.
    if (modo === 'parola' && P.autoCorrectMode !== 'parola') return null;
    if (modo === 'frase' && P.autoCorrectMode !== 'frase') return null;

    const opt = {
      minLen: P.autoCorrectMinLen ?? 3,
      maxDist: P.autoCorrectMaxDist ?? 2,
      margine: P.autoCorrectMargin ?? 0.12,
    };
    try {
      if (modo === 'frase') {
        const r = this.correttore.correggiFrase(testo, opt);
        if (r.correzioni.length) this._annunciaCorrezioni(r.correzioni);
        return r;
      }
      const r = this.correttore.correggi(testo, precedente, opt);
      if (r) this._annunciaCorrezioni([{ da: r.originale, a: r.parola }]);
      return r;
    } catch (e) {
      console.error('[correzione]', e);
      return null;
    }
  }

  /**
   * Fa sapere cosa è stato corretto.
   *
   * Non è un vezzo: una correzione silenziosa su un testo costato
   * minuti è indistinguibile da un errore del programma. Chi ascolta
   * deve poter capire cosa è successo — e in una lingua parlata, non
   * con un simbolo.
   */
  _annunciaCorrezioni(correzioni) {
    if (!correzioni?.length) return;
    this.correzioniSessione = (this.correzioniSessione || 0) + correzioni.length;
    const testo = correzioni.map(c => `${c.da} corretto in ${c.a}`).join(', ');
    this.debugView.logEvent('correzione: ' + testo);
    // A schermo si vede sempre; a voce solo se richiesto, perché in
    // scansione ogni annuncio in più costa tempo.
    this.toast(correzioni.length === 1
      ? `${correzioni[0].da} → ${correzioni[0].a}`
      : `${correzioni.length} parole corrette`);
    if (this.cfg.prediction.autoCorrectAnnounce) {
      this.audio.speakProtected(testo, 'menu');
    }
  }

  /* --------------------------- Dettatura --------------------------- */

  /**
   * Scheda Detta: per chi ha perso il controllo motorio ma non la voce.
   *
   * Il testo dettato usa lo STESSO archivio e lo STESSO buffer della
   * scansione: chi oggi detta e domani userà lo sguardo ritrova i
   * propri testi dov'erano.
   */
  initDettatura() {
    const el = (id) => document.getElementById(id);
    const testo = el('dtTesto');
    if (!testo || this._dettaturaPronta) return;
    this._dettaturaPronta = true;

    // Lingue, nei tre selettori
    const riempi = (sel, valore, breve) => {
      if (!sel) return;
      sel.innerHTML = '';
      for (const L of LINGUE) {
        const o = document.createElement('option');
        o.value = breve ? L.breve : L.code;
        o.textContent = `${L.bandiera} ${L.nome}`;
        if (o.value === valore) o.selected = true;
        sel.append(o);
      }
    };
    const itIT = this.cfg.ui.language === 'en' ? 'en-US' : 'it-IT';
    riempi(el('dtLang'), itIT, false);
    riempi(el('dtFrom'), itIT.slice(0, 2), true);
    riempi(el('dtTo'), itIT.startsWith('it') ? 'en' : 'it', true);

    const aggiornaConta = () => {
      const c = conta(testo.value);
      const cc = el('dtConta');
      if (cc) cc.textContent = `${c.parole} parole · ${c.caratteri} caratteri`;
    };
    /**
     * Salvataggio automatico del documento.
     *
     * Dettare un capitolo richiede ore. Perderlo perché la scheda si
     * chiude, il browser si aggiorna o il telefono riavvia sarebbe un
     * danno che non si può chiedere a nessuno di riparare. Si salva a
     * ogni modifica, con un ritardo per non scrivere a ogni carattere.
     */
    const salvaAuto = () => {
      clearTimeout(this._dtAuto);
      this._dtAuto = setTimeout(() => {
        try {
          localStorage.setItem('aurora.detta.v1', JSON.stringify({
            testo: testo.value,
            titolo: document.getElementById('dtTitolo')?.value || '',
            t: Date.now(),
          }));
        } catch {}
      }, 800);
    };
    testo.oninput = () => { aggiornaConta(); salvaAuto(); };
    const inpTitolo = el('dtTitolo');
    if (inpTitolo) inpTitolo.oninput = salvaAuto;
    aggiornaConta();

    // Recupero di un documento interrotto
    try {
      const w = JSON.parse(localStorage.getItem('aurora.detta.v1') || 'null');
      if (w?.testo?.trim() && !testo.value.trim()) {
        const min = Math.round((Date.now() - w.t) / 60000);
        setTimeout(() => {
          if (confirm(`Recuperare il documento che stavi dettando ${min} minuti fa?\n\n"${w.testo.slice(0, 160)}"`)) {
            testo.value = w.testo;
            if (inpTitolo) inpTitolo.value = w.titolo || '';
            aggiornaConta();
          } else localStorage.removeItem('aurora.detta.v1');
        }, 500);
      }
    } catch {}

    // Microfono
    const mic = el('dtMic');
    if (!dettaturaDisponibile()) {
      mic.disabled = true;
      mic.textContent = this.cfg.ui.language === 'en'
        ? 'Dictation unavailable in this browser'
        : 'Dettatura non disponibile qui';
      mic.title = 'Serve Chrome o Edge.';
    } else {
      mic.onclick = () => {
        if (this.dettatura.attiva) this.dettatura.ferma();
        else this.dettatura.avvia(el('dtLang').value);
      };
    }
    const selL = el('dtLang');
    if (selL) selL.onchange = () => {
      if (!this.dettatura.attiva) return;
      this.dettatura.ferma();
      setTimeout(() => this.dettatura.avvia(selL.value), 250);
    };

    // Voce dedicata alla lettura in questa scheda: chi scrive un
    // capitolo vuole risentirlo con una voce piacevole, non con quella
    // veloce degli annunci di scansione.
    const selVoce = el('dtVoce');
    const riempiVoci = () => {
      if (!selVoce) return;
      const scelta = selVoce.value;
      selVoce.innerHTML = '';
      const auto = document.createElement('option');
      auto.value = ''; auto.textContent = 'Voce automatica';
      selVoce.append(auto);
      for (const v of this.audio.availableVoices) {
        const o = document.createElement('option');
        o.value = v.uri; o.textContent = `${v.it ? '🇮🇹 ' : ''}${v.name} — ${v.lang}`;
        if (o.value === scelta) o.selected = true;
        selVoce.append(o);
      }
    };
    riempiVoci();
    setTimeout(riempiVoci, 800);

    /**
     * Legge il testo con la voce e la velocità scelte QUI.
     * Non passa da speakLong: quello usa la voce del canale pubblico,
     * che è tarata per le frasi brevi dette agli astanti.
     */
    const leggi = (t2) => {
      if (!t2) { this.toast('Non c\'è niente da pronunciare', true); return; }
      const sy = window.speechSynthesis;
      if (!sy) { this.toast('Sintesi vocale non disponibile', true); return; }
      sy.cancel();
      const pezzi = splitSentences(t2);
      const voce = this.audio.availableVoices.find(v => v.uri === selVoce?.value);
      const vera = voce ? (this.audio.voices || []).find(v => v.voiceURI === voce.uri) : null;
      const rate = parseFloat(el('dtRate')?.value || '1') || 1;
      for (const p2 of pezzi) {
        const u = new SpeechSynthesisUtterance(p2);
        if (vera) { u.voice = vera; u.lang = vera.lang; }
        else u.lang = el('dtLang')?.value || 'it-IT';
        u.rate = rate;
        u.volume = this.cfg.audio.speechVolume;
        sy.speak(u);
      }
    };

    // Comandi sul testo
    el('dtSpeak').onclick = () => leggi(testo.value.trim());
    el('dtStopSpeak').onclick = () => { try { window.speechSynthesis?.cancel(); } catch {} };
    el('dtSelectAll').onclick = () => { testo.focus(); testo.select?.(); };
    el('dtCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(testo.value); this.toast('Copiato'); }
      catch { testo.select(); document.execCommand?.('copy'); this.toast('Copiato'); }
    };
    el('dtCut').onclick = async () => {
      try { await navigator.clipboard.writeText(testo.value); } catch {}
      testo.value = ''; aggiornaConta(); this.toast('Tagliato');
    };
    el('dtPaste').onclick = async () => {
      try {
        const t2 = await navigator.clipboard.readText();
        this._inserisci(testo, t2); aggiornaConta();
      } catch { this.toast('Incolla non permesso dal browser: usa Ctrl+V', true); }
    };
    el('dtClear').onclick = () => {
      if (testo.value.trim() && !confirm('Svuotare il testo?\n\nSe non l\'hai salvato o scaricato, andrà perso.')) return;
      testo.value = ''; aggiornaConta();
      try { localStorage.removeItem('aurora.detta.v1'); } catch {}
    };
    el('dtFile').onchange = async (e) => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      try {
        let t2;
        if (/\.docx$/i.test(f.name)) {
          const mammoth = await this.media._loadMammoth();
          const r = await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() });
          t2 = r.value;
        } else t2 = await f.text();
        this._inserisci(testo, t2); aggiornaConta();
      } catch (err) { this.toast(err.message, true); }
    };
    const titolo = el('dtTitolo');

    el('dtSave').onclick = () => {
      const t2 = testo.value.trim();
      if (!t2) { this.toast('Non c\'è niente da salvare', true); return; }
      const d = this.drafts.add(t2, titolo?.value?.trim() || null);
      this.drafts.clearWip();
      this.refreshContext(); this.renderDrafts();
      this.toast(`Salvato: ${d.title}`);
    };

    /**
     * Scarica come file separato.
     *
     * Un capitolo o una lettera lunga non appartengono all'archivio
     * delle frasi da pronunciare: sono documenti, e vanno conservati
     * come tali — fuori dal browser, dove nessuna pulizia della cache
     * può cancellarli.
     */
    el('dtDownload').onclick = () => {
      const t2 = testo.value;
      if (!t2.trim()) { this.toast('Non c\'è niente da scaricare', true); return; }
      const nome = (titolo?.value?.trim() || 'documento')
        .replace(/[^\w\s.-]/g, '').trim().slice(0, 60) || 'documento';
      const blob = new Blob([t2], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${nome}-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      this.toast('Scaricato');
    };
    el('dtToBuffer').onclick = () => {
      const t2 = testo.value.trim();
      if (!t2) { this.toast('Non c\'è niente da mandare', true); return; }
      this.scan.loadText(t2, performance.now());
      this.goto('parla');
      this.toast('Testo pronto nella pagina Parla');
    };

    /* ---------------- Trascrizione da file audio o video ----------------
     * ⚠️ Il browser NON sa leggere l'audio di un file e passarlo al
     * riconoscimento: `SpeechRecognition` ascolta sempre e solo il
     * microfono, e non accetta un flusso audio. L'unica via è quella
     * acustica — il file suona, il microfono lo sente.
     *
     * È un limite della piattaforma, non una scorciatoia: va detto,
     * perché il risultato dipende dal volume e dal rumore nella stanza.
     */
    const audio = el('dtAudio');
    el('dtAudioFile').onchange = (e) => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      audio.src = URL.createObjectURL(f);
      audio.style.display = '';
      audio.onloadedmetadata = () => {
        const dur = Math.floor(audio.duration || 0);
        el('dtStop').value = dur;
        el('dtStart').value = 0;
        el('dtProgresso').textContent = `${f.name} · ${dur} s`;
      };
    };
    el('dtSpeed').onchange = () => { audio.playbackRate = parseFloat(el('dtSpeed').value) || 1; };
    el('dtBack10').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 10); };
    el('dtFwd10').onclick = () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); };

    el('dtTrascrivi').onclick = () => {
      if (!audio.src) { this.toast('Carica prima un file audio o video', true); return; }
      if (!dettaturaDisponibile()) { this.toast('Riconoscimento vocale non disponibile in questo browser', true); return; }
      const da = parseFloat(el('dtStart').value) || 0;
      const a2 = parseFloat(el('dtStop').value) || audio.duration || 0;
      if (da >= a2) { this.toast('L\'istante iniziale deve precedere quello finale', true); return; }
      if (!confirm('Il file verrà riprodotto AD ALTA VOCE e il microfono lo ascolterà.\n\nTieni il volume alto e riduci i rumori intorno. Procedo?')) return;

      audio.currentTime = da;
      audio.playbackRate = parseFloat(el('dtSpeed').value) || 1;
      audio.play().catch(() => this.toast('Riproduzione non avviata', true));
      this.dettatura.avvia(el('dtLang').value);
      this._trascrizione = setInterval(() => {
        const p2 = Math.min(100, Math.round(100 * (audio.currentTime - da) / Math.max(0.1, a2 - da)));
        el('dtProgresso').textContent = `trascrizione ${p2}% · ${Math.floor(audio.currentTime)} s`;
        if (audio.currentTime >= a2 || audio.ended) fermaTrascrizione();
      }, 400);
    };
    const fermaTrascrizione = () => {
      clearInterval(this._trascrizione);
      this._trascrizione = null;
      try { audio.pause(); } catch {}
      this.dettatura.ferma();
      el('dtProgresso').textContent = 'trascrizione terminata';
    };
    el('dtStopTrascrivi').onclick = fermaTrascrizione;

    // Traduzione
    const out = el('dtTradOut');
    el('dtTrad').onclick = async () => {
      const t2 = testo.value.trim();
      if (!t2) { this.toast('Non c\'è niente da tradurre', true); return; }
      out.value = this.cfg.ui.language === 'en' ? 'Translating…' : 'Traduzione in corso…';
      const r = await traduci(t2, el('dtFrom').value, el('dtTo').value);
      out.value = r.ok ? r.testo : r.motivo;
      if (!r.ok) this.toast(r.motivo, true);
    };
    el('dtTradCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(out.value); this.toast('Copiato'); } catch {}
    };
    el('dtTradSpeak').onclick = () => {
      if (!out.value.trim()) return;
      this.showSpoken(out.value.trim());
      this.speakLong(out.value.trim());
    };
    el('dtTradUse').onclick = () => {
      if (!out.value.trim()) return;
      testo.value = out.value.trim(); aggiornaConta();
    };
  }

  /** Inserisce testo al cursore, senza cancellare il resto. */
  _inserisci(area, testo) {
    if (!testo) return;
    const i = area.selectionStart ?? area.value.length;
    const j = area.selectionEnd ?? i;
    const prima = area.value.slice(0, i);
    const dopo = area.value.slice(j);
    const sep = prima && !/\s$/.test(prima) ? ' ' : '';
    area.value = prima + sep + testo + dopo;
    const pos = (prima + sep + testo).length;
    area.setSelectionRange?.(pos, pos);
    area.focus?.();
  }

  onDettatura(e) {
    const stato = document.getElementById('dtStato');
    const parz = document.getElementById('dtParziale');
    const mic = document.getElementById('dtMic');
    const testo = document.getElementById('dtTesto');
    if (e.tipo === 'avviata') {
      // ⚠️ Dettare e comandare con la bocca insieme non ha senso: la
      // bocca si muove di continuo e ogni parola diventerebbe un
      // comando. Si sospendono i canali del viso finché si detta.
      this.gestures.setVisoSospeso(true);
      if (mic) mic.textContent = t('btn.dictStop');
      if (stato) { stato.textContent = '● ' + t('dict.listening'); stato.classList.add('on'); }
      this.audio.earcon('confirm');
    }
    if (e.tipo === 'fine') {
      this.gestures.setVisoSospeso(false);
      if (mic) mic.textContent = t('btn.dictStart');
      if (stato) { stato.textContent = t('dict.idle'); stato.classList.remove('on'); }
      if (parz) parz.textContent = '';
    }
    if (e.tipo === 'parziale' && parz) parz.textContent = e.testo || '';
    if (e.tipo === 'testo' && testo) {
      this._inserisci(testo, e.testo);
      testo.dispatchEvent?.(new Event('input'));
      testo.scrollTop = testo.scrollHeight;
    }
    if (e.tipo === 'errore') {
      this.toast(e.messaggio, true);
      this.debugView.logEvent('dettatura: ' + e.messaggio, true);
    }
  }

  /* -------------------- Voci di guida registrate -------------------- */

  /** Elenco delle parole da registrare, con lo stato di ciascuna. */
  vocabolarioVoci() {
    return vocabolarioGuida(this.cfg).map(v => ({ ...v, registrata: this.voci.ha(v.testo) }));
  }

  /**
   * Registra una singola parola.
   * Prima la si annuncia con la sintesi, così chi registra sa cosa dire
   * e con quale intonazione, poi si registra.
   */
  async registraVoce(testo, ms = null) {
    const durata = ms || this.cfg.audio.recordMs || 2000;
    try {
      await this.registratore.avviaSessione();
      this.audio.earcon('group');
      await new Promise(r => setTimeout(r, 260));
      const blob = await this.registratore.registra(durata);
      await this.voci.salva(testo, blob);
      this.audio.earcon('confirm');
      return true;
    } catch (e) {
      this.toast(`Registrazione non riuscita: ${e.message}`, true);
      return false;
    }
  }

  /** Sessione guidata: registra in sequenza tutte le voci mancanti. */
  async registraTutte(soloMancanti = true) {
    const elenco = this.vocabolarioVoci().filter(v => !soloMancanti || !v.registrata);
    if (!elenco.length) { this.toast('Non manca nulla da registrare'); return; }
    if (!confirm(`Registrare ${elenco.length} voci?\n\nPer ciascuna sentirai la parola, poi un tono: pronunciala subito dopo. Puoi fermarti quando vuoi ricaricando la pagina.`)) return;

    try { await this.registratore.avviaSessione(); }
    catch (e) { this.toast(`Microfono non disponibile: ${e.message}`, true); return; }

    this._registrazioneInCorso = true;
    for (let i = 0; i < elenco.length; i++) {
      if (!this._registrazioneInCorso) break;
      const v = elenco[i];
      this.toast(`${i + 1}/${elenco.length} — di': "${v.testo}"`);
      // Si fa sentire la parola: chi registra sa cosa dire senza leggere.
      await this.audio.speakProtected(v.testo, 'menu');
      await new Promise(r => setTimeout(r, 200));
      await this.registraVoce(v.testo);
      this.settingsView.render();
      await new Promise(r => setTimeout(r, 300));
    }
    this._registrazioneInCorso = false;
    this.registratore.chiudiSessione();
    this.toast(`Registrazione completata: ${this.voci.quante} voci`);
    this.settingsView.render();
  }

  fermaRegistrazione() {
    this._registrazioneInCorso = false;
    this.registratore.interrompi();
    this.registratore.chiudiSessione();
  }

  /* ------------------- Sorveglianza dei dispositivi ------------------- */

  /**
   * La telecamera non risponde più: si segnala e si tenta il ripristino.
   *
   * Il messaggio a schermo conta: se qualcuno passa in stanza deve
   * capire in un istante che c'è un problema e di che tipo.
   */
  onGuastoTelecamera(d) {
    const fasi = {
      guasto: `⚠️ Telecamera: ${d.dettaglio}`,
      attesa: `Riprovo fra ${(d.attesaMs / 1000).toFixed(0)} s (tentativo ${d.tentativo})`,
      ripristinato: '✓ Telecamera ripristinata',
      fallito: `Ripristino non riuscito: ${d.errore}`,
    };
    const testo = fasi[d.fase] || d.fase;
    this.debugView?.logEvent('telecamera: ' + testo, d.fase !== 'ripristinato');
    // Solo l'inizio del guasto e il ripristino meritano un avviso a
    // schermo: i tentativi intermedi sarebbero solo rumore.
    if (d.fase === 'guasto' || d.fase === 'ripristinato') {
      this.toast(testo, d.fase === 'guasto');
    }
    this.aggiornaStatoTelecamera();
  }

  /** Riapre la sorgente video. Rilancia se fallisce: decide il watchdog. */
  async ripristinaTelecamera() {
    const eraFile = this.vision?.source && typeof this.vision.source.togglePlay === 'function';
    // Un video da file non si "ripristina": se è finito, è finito.
    if (eraFile) return;
    await this.vision.stop().catch(() => {});
    await this.vision.start();
    const st = this.vision.source?.stream;
    if (st) this.watchdog.sorveglia(st);
    this.updateCamButton();
  }

  /** Un dispositivo è comparso o sparito. */
  onCambioDispositivi(c) {
    if (c.videoSparito) {
      this.debugView?.logEvent('dispositivi: la telecamera è stata scollegata', true);
      this.toast('⚠️ Telecamera scollegata — provo a riconnettermi', true);
    }
    if (c.audioSparito) {
      // Non si può rimediare da soli, ma dirlo è già molto: gli
      // annunci privati potrebbero essere finiti in altoparlante.
      this.debugView?.logEvent('dispositivi: un\'uscita audio è sparita', true);
      this.toast('⚠️ Un dispositivo audio è stato scollegato: controlla dove esce la voce', true);
    }
    if (c.comparsi.length) {
      this.debugView?.logEvent(`dispositivi: ${c.comparsi.length} nuovi disponibili`);
      // Un dispositivo ricomparso può essere quello giusto: si
      // ricaricano gli elenchi nelle impostazioni.
      if (document.body.dataset.tab === 'impostazioni') this._safe('audio', () => this.settingsView.render());
    }
  }

  /** Indicatore di stato, per sapere a colpo d'occhio se sta lavorando. */
  aggiornaStatoTelecamera() {
    const el = document.getElementById('chipCam');
    if (!el) return;
    const st = this.watchdog.stato;
    if (!st.attivo) { el.textContent = 'camera —'; el.classList.remove('warn'); return; }
    if (st.inRipristino) { el.textContent = 'camera: ripristino…'; el.classList.add('warn'); return; }
    if (st.fermoMs > 2000) { el.textContent = `camera ferma ${(st.fermoMs / 1000).toFixed(0)}s`; el.classList.add('warn'); return; }
    el.textContent = st.ripristini ? `camera ok (${st.ripristini} ripristini)` : 'camera ok';
    el.classList.remove('warn');
  }

  /* ------------------ Statistiche cliniche di sessione ------------------ */

  /**
   * Barra dei comandi video: compare solo con un file caricato.
   * Con la telecamera dal vivo non avrebbe senso, e mostrarla
   * disattivata sarebbe solo rumore.
   */
  aggiornaBarraVideo() {
    const bar = document.getElementById('vidBar');
    if (!bar) return;
    const src = this.vision?.source;
    const isFile = src && typeof src.togglePlay === 'function';
    bar.style.display = isFile ? '' : 'none';
    if (!isFile) return;

    const st = src.stato;
    const play = document.getElementById('vidPlay');
    if (play) { play.textContent = st.inPausa ? '▶' : '⏸'; }
    const mmss = (sec) => {
      const s2 = Math.max(0, Math.floor(sec));
      return `${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, '0')}`;
    };
    const tempo = document.getElementById('vidTime');
    if (tempo) tempo.textContent = `${mmss(st.t)} / ${mmss(st.durata)}`;
    const seek = document.getElementById('vidSeek');
    if (seek && !this._seekInCorso) seek.value = Math.round(st.frazione * 1000);
    const lp = document.getElementById('vidLoop');
    if (lp) lp.checked = st.loop;
  }

  /** Riepilogo leggibile, aggiornato mentre si guarda la diagnostica. */
  renderDiagStats() {
    const box = document.getElementById('diagStats');
    if (!box) return;
    const r = this.sessione.riepilogo();
    const p = this.sessione.parametriConsigliati();
    const tag = document.getElementById('diagAffid');
    if (tag) tag.textContent = p.ok ? `${p.affidabilita} · ${p.minuti} min` : 'in raccolta…';

    const ms = (v) => `${(v / 60000).toFixed(1)} min`;
    const E = r.perOcchio;
    const banda = (id) => r.bande.find(b => b.id === id)?.percentuale ?? 0;
    const voci = [
      ['Osservazione', `${r.ore.toFixed(2)} h`],
      ['Fotogrammi validi', `${r.validiPercento.toFixed(0)} %`],
      ['Fotogrammi al secondo', r.fps.toFixed(0)],
      // ── Oscillazione involontaria ──
      ['Ampiezza SX / DX', `${E.left.ampiezzaMediana.toFixed(4)} / ${E.right.ampiezzaMediana.toFixed(4)}`],
      ['Frequenza SX / DX', `${E.left.frequenzaMediana.toFixed(1)} / ${E.right.frequenzaMediana.toFixed(1)} Hz`],
      ['Nistagmo 2-8 Hz', `${banda('nistagmo').toFixed(0)} %`],
      ['Tremore 0,5-2 Hz', `${banda('tremore').toFixed(0)} %`],
      ['Deriva lenta', `${banda('deriva').toFixed(0)} %`],
      ['Oltre 8 Hz', `${banda('rapido').toFixed(0)} %`],
      // ── Gesti ──
      ['Gesti riconosciuti', r.gesti],
      ['Gesti al minuto', r.gestiAlMinuto.toFixed(1)],
      ['Durata gesto mediana', `${Math.round(r.durataGestiMediana)} ms`],
      ['Durata gesto 10-90%', `${Math.round(r.durataGesti10)}-${Math.round(r.durataGesti90)} ms`],
      ['Falsi positivi stimati', r.falsiPositivi],
      ['Falsi al minuto', r.tassoFalsiAlMinuto.toFixed(2)],
      // ── Palpebre ──
      ['Chiusure SX / DX', `${r.chiusure.sx} / ${r.chiusure.dx}`],
      ['Chiusure al minuto', r.chiusureAlMinuto.toFixed(1)],
      ['Durata chiusura mediana', `${Math.round(r.durataChiusuraMediana)} ms`],
      ['Tempo chiuso SX / DX', `${ms(r.msChiuso.sx)} / ${ms(r.msChiuso.dx)}`],
      ['Apertura riposo SX / DX', `${E.left.aperturaRiposo.toFixed(3)} / ${E.right.aperturaRiposo.toFixed(3)}`],
      // ── Qualità ──
      ['Confidenza SX / DX', `${E.left.confidenzaMediana.toFixed(2)} / ${E.right.confidenzaMediana.toFixed(2)}`],
      ['Segnale a riposo', `${r.riposoMediana.toFixed(1)}σ · 99° ${r.riposo99.toFixed(1)}σ`],
    ];
    box.innerHTML = voci.map(([k, v]) =>
      // Stessa regola dei contatori: i valori doppi devono entrare
      // interi, perché il confronto fra i due occhi è la cosa più
      // utile da guardare in questa scheda.
      `<div class="counter"><div class="cv ${
        String(v).includes(' / ') ? 'cv-due'
        : String(v).length <= 12 ? ''
        : String(v).length <= 17 ? 'cv-m' : 'cv-s'
      }">${v}</div><div class="cl">${k}</div></div>`).join('');

    // Rapporto con parametri proposti e avvisi
    const rep = document.getElementById('diagReport');
    if (!rep) return;
    if (!p.ok) { rep.style.display = 'none'; return; }
    const esc = x => String(x).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    rep.style.display = '';
    rep.innerHTML =
      `<div class="tune-head">Parametri proposti · affidabilità <b>${p.affidabilita}</b> su ${p.minuti} minuti</div>` +
      '<ul class="tune-list">' + p.motivi.map(m => `<li>${esc(m)}</li>`).join('') + '</ul>' +
      (p.avvisi.length ? '<ul class="tune-warn">' + p.avvisi.map(a => `<li>${esc(a)}</li>`).join('') + '</ul>' : '') +
      '<div class="tune-changed">' + Object.entries(p.proposta)
        .map(([k, v]) => `<span><code>${k.split('.').pop()}</code> ${v}</span>`).join('') + '</div>';
  }

  /** Scarica un riepilogo come file. */
  _scaricaDiag(dati, nome) {
    const blob = new Blob([JSON.stringify(dati, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
  }

  /* ---------------------- Taratura automatica ---------------------- */

  /**
   * Osserva la persona a riposo e propone i parametri di rilevamento.
   *
   * Serve a dare un PUNTO DI PARTENZA sensato: trovare a mano finestra
   * mediana, taglio, soglie e pavimento del rumore richiede molte prove,
   * e chi assiste non ha strumenti per capire se una modifica ha
   * migliorato o peggiorato. Qui i valori si ricavano dai dati.
   *
   * La configurazione precedente viene conservata: se il risultato non
   * convince si torna indietro con un pulsante.
   */
  async avviaTaraturaAutomatica(secondi = null) {
    if (!this.vision.source) { this.toast('Accendi prima la telecamera', true); return; }
    if (this._taratura) return;

    const sec = secondi || this.cfg.signal.autoTuneSec || 25;
    const en = this.cfg.ui.language === 'en';

    // Istantanea per poter annullare: nulla di ciò che funziona va
    // perso perché una taratura automatica non è piaciuta.
    this._configPrimaTaratura = deepClone(this.cfg);

    this._taratura = { campioni: [], fino: performance.now() + sec * 1000 };
    this.gestures.setDiagnostics(true);
    this.overlay.setMode('calibrate');
    this.overlay.calib = {
      target: { x: 0.5, y: 0.5 }, index: 0, total: 1, progress: 0,
      message: en ? 'Relax and look straight ahead' : 'Rilassati e guarda davanti a te',
    };
    await this.audio.speakProtected(
      en ? 'Relax and look straight ahead, without moving' : 'Rilassati e guarda davanti a te, senza muoverti', 'menu');

    await new Promise(risolvi => {
      const controlla = () => {
        const ora = performance.now();
        if (!this._taratura) return risolvi();
        this.overlay.calib.progress = 1 - Math.max(0, (this._taratura.fino - ora)) / (sec * 1000);
        if (ora >= this._taratura.fino) return risolvi();
        setTimeout(controlla, 120);
      };
      controlla();
    });

    const reg = this._taratura?.campioni || [];
    this._taratura = null;
    this.overlay.setMode('off');

    const r = analizzaSegnale(reg, { correnti: this.cfg });
    if (!r.ok) {
      this.toast(r.motivo, true);
      this.debugView.logEvent('taratura automatica: ' + r.motivo, true);
      await this.audio.speakProtected(en ? 'Could not measure' : 'Non è stato possibile misurare', 'menu');
      return;
    }

    for (const [percorso, valore] of Object.entries(r.proposta)) this.set(percorso, valore);
    this.settingsView.render();
    this.mostraEsitoTaratura(r);
    r.rapporto.forEach(x => this.debugView.logEvent('taratura: ' + x));
    await this.audio.speakProtected(en ? 'Settings applied' : 'Impostazioni applicate', 'menu');
  }

  /** Raccoglie i campioni durante la finestra di osservazione. */
  _raccogliTaratura(tMs, obs) {
    if (!this._taratura) return;
    const conv = e => e ? { x: e.x, y: e.y, openness: e.openness, confidence: e.confidence } : null;
    this._taratura.campioni.push({ t: tMs, left: conv(obs.left), right: conv(obs.right) });
  }

  /** Riepilogo leggibile, con la possibilità di tornare indietro. */
  mostraEsitoTaratura(r) {
    const box = document.getElementById('tuneReport');
    if (!box) { this.toast('Taratura applicata'); return; }
    const esc = x => String(x).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const voti = { buona: 'var(--accent2)', discreta: 'var(--warn)', scarsa: 'var(--hot)' };
    box.style.display = '';
    box.innerHTML =
      `<div class="tune-head">Qualità del segnale: <b style="color:${voti[r.qualita.voto]}">${r.qualita.voto}</b>` +
      ` · ${r.campioni} campioni in ${Math.round(r.durataMs / 1000)} s</div>` +
      '<ul class="tune-list">' + r.rapporto.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' +
      (r.qualita.avvisi.length
        ? '<ul class="tune-warn">' + r.qualita.avvisi.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>'
        : '') +
      '<div class="tune-changed">' + Object.entries(r.proposta)
        .map(([k, v]) => `<span><code>${k.split('.').pop()}</code> ${v}</span>`).join('') + '</div>';

    const annulla = document.createElement('button');
    annulla.className = 'btn btn-sm btn-danger';
    annulla.textContent = this.cfg.ui.language === 'en' ? 'Undo: restore previous settings' : 'Annulla: ripristina i valori di prima';
    annulla.onclick = () => {
      if (!this._configPrimaTaratura) return;
      this.cfg = this._configPrimaTaratura;
      this._configPrimaTaratura = null;
      this.onConfigChanged();
      this.settingsView.render();
      box.style.display = 'none';
      this.toast('Valori precedenti ripristinati');
    };
    box.append(annulla);
  }

  /* ------------------- Calibrazione dei movimenti ------------------- */

  /**
   * Misura l'escursione reale di ogni direzione e imposta i guadagni.
   *
   * Procedura guidata a voce: si chiede una direzione alla volta, si
   * misura il picco raggiunto, e alla fine si calcolano i guadagni che
   * portano tutte le direzioni allo stesso livello. Le direzioni con
   * un canale spento vengono saltate: non ha senso far faticare
   * qualcuno per misurare un movimento che non userà.
   */
  async avviaCalibrazioneMovimenti() {
    if (!this.vision.source) { this.toast('Accendi prima la telecamera', true); return; }
    const g = this.cfg.gestures;
    const attive = [
      { id: 'up',    on: g.UP?.enabled || g.UP_LONG?.enabled || g.UP_VERYLONG?.enabled, msg: 'cal.mUp' },
      { id: 'down',  on: g.DOWN?.enabled,  msg: 'cal.mDown' },
      { id: 'left',  on: g.LEFT?.enabled,  msg: 'cal.mLeft' },
      { id: 'right', on: g.RIGHT?.enabled, msg: 'cal.mRight' },
    ].filter(d => d.on);

    if (attive.length < 2) {
      this.toast(this.cfg.ui.language === 'en'
        ? 'At least two directions must be enabled to balance them'
        : 'Servono almeno due direzioni attive per riequilibrarle', true);
      return;
    }

    const durataMs = 2500, riposoMs = 1800;
    const picchi = {};
    this.gestures.setDiagnostics(true);

    for (const d of attive) {
      await this.audio.speakProtected(t(d.msg), 'menu');
      this.audio.earcon('group');
      this.gestures.iniziaMisura(d.id);
      await new Promise(r => setTimeout(r, durataMs));
      const m = this.gestures.fermaMisura();
      picchi[d.id] = m?.picco || 0;
      this.audio.earcon('confirm');
      await this.audio.speakProtected(t('cal.rest'), 'menu');
      await new Promise(r => setTimeout(r, riposoMs));
    }

    // Riferimento: la direzione con l'escursione MAGGIORE resta a
    // guadagno 1, le altre vengono portate al suo livello. Così non si
    // amplifica mai il rumore più del necessario.
    const max = Math.max(...Object.values(picchi));
    if (!isFinite(max) || max <= 0) {
      this.toast('Nessun movimento misurato: riprova', true);
      return;
    }
    const esito = [];
    for (const d of attive) {
      const p = picchi[d.id];
      // Tetto a 6×: oltre, il movimento è troppo piccolo per essere
      // usato in modo affidabile e amplificarlo porterebbe solo rumore.
      const gain = p > 0 ? Math.min(6, Math.max(0.2, max / p)) : 1;
      this.set(`signal.gainDir.${d.id}`, Math.round(gain * 100) / 100);
      esito.push(`${d.id} ${p.toFixed(1)}σ → ×${gain.toFixed(2)}`);
    }
    this.settingsView.render();
    this.debugView.logEvent('calibrazione movimenti: ' + esito.join(' · '));
    await this.audio.speakProtected(t('cal.mDone'), 'menu');
    this.toast(t('cal.mDone') + ' · ' + esito.join(' · '));
  }

  /* ------------------------------ Contenuti ------------------------------ */

  /** Elenco compatto per l'albero di scansione: solo titoli. */
  libreriaPerScansione() {
    const vids = [
      ...(this.cfg.media.favorites || []).map(f => ({ title: f.title || f.url })),
      ...this.library.videoFiles || [],
    ];
    // Le immagini si raggruppano per cartella di provenienza: un album
    // diventa un sottomenu invece di decine di voci sull'elenco.
    const cartelle = new Map();
    const sciolte = [];
    this.library.images.forEach((im, i) => {
      if (im.folder) {
        if (!cartelle.has(im.folder)) cartelle.set(im.folder, []);
        cartelle.get(im.folder).push({ title: im.title, idx: i });
      } else sciolte.push({ title: im.title, idx: i });
    });
    const imgs = [
      ...[...cartelle.entries()].map(([nome, files]) => ({ title: nome, folder: files })),
      ...sciolte,
    ];
    return {
      videos: vids.map(v => ({ title: v.title })),
      audios: this.library.audios.map(a => ({ title: a.title })),
      docs: this.library.docs.map(d => ({ title: d.title })),
      images: imgs,
    };
  }

  /** Apre un contenuto scelto dalla scansione. */
  async apriDallaLibreria(sel) {
    try {
      // Il visualizzatore va agganciato al riquadro della scheda in cui
      // ci si trova: chi comunica dalla pagina Parla deve vedere lì.
      this.agganciaMedia();

      if (sel.kind === 'video') {
        const fav = this.cfg.media.favorites || [];
        if (sel.index < fav.length) return this.playFavorite(sel.index);
        const vf = (this.library.videoFiles || [])[sel.index - fav.length];
        if (vf) return this.media.openMediaFiles([vf.file], 0, true);
        return;
      }
      if (sel.kind === 'audio') {
        const files = this.library.audios.map(a => a.file);
        if (!files.length) return;
        return this.media.openMediaFiles(files, sel.index, false);
      }
      if (sel.kind === 'doc') {
        const d = this.library.docs[sel.index]; if (!d) return;
        return /\.pdf$/i.test(d.file.name) ? this.media.openPdf(d.file) : this.media.openText(d.file);
      }
      if (sel.kind === 'img') {
        // Dentro una cartella si mostra SOLO quella cartella, così
        // avanti e indietro restano dentro l'album.
        const lib = this.libreriaPerScansione().images;
        const voce = lib[sel.index];
        const insieme = voce?.folder
          ? voce.folder.map(f => this.library.images[f.idx])
          : this.library.images.filter(im => !im.folder);
        const files = insieme.map(i => i.file);
        if (!files.length) return;
        await this.media.openImages(files);
        const dentro = voce?.folder ? (sel.sub ?? 0)
          : insieme.findIndex(i => i.title === this.library.images[sel.index]?.title);
        this.media.imageIndex = Math.max(0, dentro);
        this.media._showImage();
      }
    } catch (e) { this.toast(e.message, true); }
  }

  /** Sposta il visualizzatore nel riquadro della scheda corrente. */
  agganciaMedia() {
    const tab = document.body.dataset.tab;
    const id = tab === 'parla' ? 'parlaMediaStage'
      : (tab === 'punta' && this.pointerView?.mode === 'media') ? 'ptMediaStage'
      : 'mediaStage';
    const el = document.getElementById(id);
    if (el && this.media.container !== el) {
      // Se un contenuto era già aperto altrove, si sposta il nodo
      // invece di ricrearlo: un video non deve ripartire da capo.
      if (this.media.container?.firstChild) {
        while (this.media.container.firstChild) el.appendChild(this.media.container.firstChild);
      }
      this.media.attach(el);
    }
    document.body.classList.toggle('has-media', this.media.active);
  }

  /**
   * Etichetta dei comandi del contenuto aperto.
   * Un nome unico e neutro: cambia il tipo di file ma non il posto nel
   * menu, e chi lo usa non deve reimparare nulla ogni volta.
   */
  mediaLabel() { return 'COMANDI FILE'; }

  onMediaEvent(e) {
    if (e.type === 'opened') {
      document.body.classList.add('has-media');
      this.scheduleFit();
      this.refreshContext();
      this.renderMediaBar();
      // I comandi del contenuto diventano la prima voce del menu:
      // portare subito lì la scansione evita di doverci arrivare a mano.
      if (this.cfg.media.autoScanOnOpen && !this.scan.paused) {
        this.scan._resetToRoot(performance.now(), true);
        this.scan.select(performance.now());
      }
      this.toast(e.title ? `Aperto: ${e.title}` : 'Contenuto aperto');
    }
    if (e.type === 'closed') {
      document.body.classList.remove('has-media');
      this.scheduleFit();
      this.refreshContext();
      this.renderMediaBar();
      // Chiudere il visualizzatore NON scarica il file: l'elenco va
      // ridisegnato perché resti evidente che è ancora disponibile.
      this.renderLibreria();
    }
    if (e.type === 'page') this.setMediaInfo(`${e.title || ''} ${e.page}/${e.pages}`.trim());
    if (e.type === 'error') this.toast(e.message, true);
    if (e.type === 'readAloud') {
      // Legge il testo visibile, non l'intero documento: ore di lettura
      // in un colpo solo non si possono fermare con un gesto solo.
      const txt = (e.text || '').slice(0, 1200);
      if (txt) this.audio.speakProtected(txt, 'speech');
    }
  }

  setMediaInfo(text) {
    const el = document.getElementById('mediaInfo');
    if (el) el.textContent = text || (this.media.active ? this.mediaLabel().toLowerCase() : 'nessun contenuto');
  }

  /** Comandi del contenuto anche come pulsanti, per chi assiste. */
  renderMediaBar() {
    for (const idS of ['mediaStage', 'ptMediaStage', 'parlaMediaStage']) {
      const st = document.getElementById(idS);
      if (st) st.dataset.empty = t('media.empty');
    }
    // La stessa barra comandi compare nella scheda Media e nella
    // modalità Media della scheda Punta: si popolano entrambe, così
    // chi punta ha gli stessi comandi di chi scandisce.
    for (const idB of ['mediaBar', 'ptMediaBar']) {
      const bar = document.getElementById(idB);
      if (!bar) continue;
      bar.innerHTML = '';
      for (const c of this.media.commands()) {
        const b = document.createElement('button');
        b.className = 'btn btn-sm ptr-target';
        b.textContent = c.label;
        b.onclick = () => this.media.command(c.id);
        bar.append(b);
      }
    }
    this.setMediaInfo();
  }

  renderFavorites() {
    const list = document.getElementById('favList');
    if (!list) return;
    const favs = this.cfg.media.favorites || [];
    list.innerHTML = '';
    if (!favs.length) {
      list.innerHTML = '<p class="sub">Nessun preferito. Incolla un link qui sopra.</p>';
      return;
    }
    favs.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      const k = document.createElement('span');
      k.className = 'k'; k.textContent = f.title || f.url;
      const play = document.createElement('button');
      play.textContent = '▶'; play.title = 'Riproduci';
      play.onclick = () => this.playFavorite(i);
      const up = document.createElement('button');
      up.textContent = '▲';
      up.onclick = () => this.moveFavorite(i, -1);
      const down = document.createElement('button');
      down.textContent = '▼';
      down.onclick = () => this.moveFavorite(i, 1);
      const del = document.createElement('button');
      del.textContent = '×';
      del.onclick = () => {
        const arr = [...favs]; arr.splice(i, 1);
        this.set('media.favorites', arr); this.renderFavorites();
      };
      row.append(k, play, up, down, del);
      list.append(row);
    });
  }

  moveFavorite(i, d) {
    const arr = [...(this.cfg.media.favorites || [])];
    const j = Math.max(0, Math.min(arr.length - 1, i + d));
    if (i === j) return;
    arr.splice(j, 0, arr.splice(i, 1)[0]);
    this.set('media.favorites', arr);
    this.renderFavorites();
  }

  async playFavorite(i) {
    const f = (this.cfg.media.favorites || [])[i];
    if (!f) return;
    try {
      this.agganciaMedia();
      const urls = (this.cfg.media.favorites || []).map(x => x.url);
      await this.media.openYouTube(f.url, urls);
    } catch (e) { this.toast(e.message, true); }
  }

  /** Elenco dei documenti e delle immagini caricati, nella scheda Guarda. */
  renderLibreria() {
    const el = document.getElementById('libList');
    if (!el) return;
    const voci = [
      ...this.library.docs.map((d, i) => ({ ...d, tipo: 'doc', i, ic: '📄' })),
      ...this.library.audios.map((d, i) => ({ ...d, tipo: 'audio', i, ic: '🎵' })),
      ...(this.library.videoFiles || []).map((d, i) => ({ ...d, tipo: 'videofile', i, ic: '🎬' })),
      ...this.library.images.map((d, i) => ({ ...d, tipo: 'img', i, ic: '🖼' })),
    ];
    el.innerHTML = '';
    if (!voci.length) {
      el.innerHTML = '<p class="sub">Nessun documento o immagine caricato in questa sessione.</p>';
      return;
    }
    for (const v of voci) {
      const row = document.createElement('div');
      row.className = 'row';
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = `${v.ic} ${v.title}${v.folder ? '  · ' + v.folder : ''}`;
      const play = document.createElement('button');
      play.textContent = '▶'; play.title = 'Apri';
      play.onclick = () => {
        if (v.tipo === 'videofile') { this.agganciaMedia(); this.media.openMediaFiles([v.file], 0, true); }
        else this.apriDallaLibreria({ kind: v.tipo, index: v.i });
      };
      const del = document.createElement('button');
      del.textContent = '×';
      del.onclick = () => {
        const dove = { doc: 'docs', audio: 'audios', videofile: 'videoFiles', img: 'images' }[v.tipo];
        this.library[dove]?.splice(v.i, 1);
        this.refreshContext(); this.renderLibreria();
      };
      row.append(k, play, del);
      el.append(row);
    }
  }

  /** Salva il testo composto come file: scrivere una lettera e conservarla. */
  /** Recupera il lavoro in corso dopo una chiusura accidentale. */
  restoreWip() {
    const w = this.drafts.loadWip();
    if (!w?.text) return;
    const age = Math.round((Date.now() - w.t) / 60000);
    const en = this.cfg.ui.language === 'en';
    setTimeout(() => {
      const q = en
        ? `Recover the text you were writing ${age} minutes ago?\n\n"${w.text.slice(0, 160)}"`
        : `Recuperare il testo che stavi scrivendo ${age} minuti fa?\n\n"${w.text.slice(0, 160)}"`;
      if (confirm(q)) { this.scan.loadText(w.text, performance.now()); this.goto('parla'); }
      else this.drafts.clearWip();
    }, 600);
  }

  saveComposedText() {
    const b = this.scan.buffer;
    const text = [...b.words, b.letters].join(' ').trim();
    if (!text) { this.toast('Non c\'è ancora niente da salvare', true); return; }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `testo-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    this.toast('Salvato');
  }

  /* ------------------------------ Puntatore ------------------------------ */

  onPointer(e) {
    this.overlay.pointer = { x: e.x, y: e.y, dwell: e.dwell };
    if (e.type === 'click' || e.type === 'dblclick' || e.type === 'hold') {
      this.audio.earcon(e.type === 'dblclick' ? 'confirm' : 'item');
      this.activateAt(e.x, e.y, e.type);
    }
    if (this.cfg.device.enabled && this.device.connected) {
      this.device.moveTo(e.x / window.innerWidth, e.y / window.innerHeight);
    }
    /* ── Mouse del sistema ──
     * Additivo: a mouse spento non cambia nulla. Il clic del puntatore
     * diventa un clic vero soltanto quando il pannello compatto è in
     * primo piano, cioè quando la persona sta usando il computer e non
     * Aurora — altrimenti ogni selezione dentro Aurora produrrebbe
     * anche un clic sul sistema.
     */
    if (this.cfg.device?.mouse?.enabled && this.device?.connected) {
      this.mouseDaPuntatore(e.x / window.innerWidth, e.y / window.innerHeight);
      if (this.finestra?.aperta) {
        if (e.type === 'click') this.device.mouseClick(1);
        else if (e.type === 'dblclick') this.device.mouseDoubleClick(1);
      }
    }
  }

  onStripe(e) {
    if (e.type === 'stripe') { this.overlay.stripe = e.snapshot; return; }
    if (e.type === 'click') {
      this.overlay.pointer = { x: e.x, y: e.y, dwell: 1 };
      this.audio.earcon('confirm');
      this.activateAt(e.x, e.y, 'click');
      if (this.cfg.device.enabled && this.device.connected) {
        this.device.moveTo(e.x / window.innerWidth, e.y / window.innerHeight);
      }
    }
  }

  /**
   * Attiva ciò che si trova sotto le coordinate.
   *
   * Si usa elementFromPoint invece di una mappa di bersagli mantenuta a
   * mano: così qualunque elemento marcato .ptr-target funziona subito,
   * comprese le schede aggiunte in futuro, e il comportamento coincide
   * esattamente con quello del dito e del mouse.
   */
  activateAt(x, y, type) {
    // Sul braccio il click comanda la pinza, non l'interfaccia.
    if (this.cfg.device.enabled && this.device.connected && document.body.dataset.tab === 'punta') {
      if (type === 'click' && this.cfg.device.clickAction === 'gripper') { this.device.toggleGripper(); return; }
      if (type === 'dblclick' && this.cfg.device.dblclickAction === 'home') { this.device.home(); return; }
    }
    const el = document.elementFromPoint(x, y);
    const target = el?.closest?.('.ptr-target, button, .tab, .sib');
    if (!target) return;

    /**
     * Azioni protette.
     *
     * Spegnere la telecamera con un click accidentale toglierebbe alla
     * persona OGNI modo di comandare il programma: non potrebbe nemmeno
     * riaccenderla. Un comando così non può dipendere da un singolo
     * click involontario, quindi ne servono due entro pochi secondi.
     * Vale solo per i comandi del puntatore: chi assiste con il mouse
     * non ha bisogno della protezione, ma averla non gli costa nulla.
     */
    if (target.classList?.contains?.('ptr-danger') && type !== 'dblclick') {
      const ora = performance.now();
      if (this._confermaEl !== target || ora - (this._confermaAt || 0) > 4000) {
        this._confermaEl = target;
        this._confermaAt = ora;
        this._testoOriginale = target.textContent;
        target.textContent = this.cfg.ui.language === 'en' ? 'Confirm?' : 'Confermi?';
        target.classList.add('in-conferma');
        this.audio.earcon('error');
        clearTimeout(this._confermaT);
        this._confermaT = setTimeout(() => {
          if (this._confermaEl !== target) return;
          target.textContent = this._testoOriginale;
          target.classList.remove('in-conferma');
          this._confermaEl = null;
        }, 4000);
        return;
      }
      // Seconda conferma entro la finestra: si procede.
      clearTimeout(this._confermaT);
      target.classList.remove('in-conferma');
      this._confermaEl = null;
    }
    document.querySelectorAll('.ptr-hover').forEach(n => n.classList.remove('ptr-hover'));
    target.classList.add('ptr-hover');
    setTimeout(() => target.classList.remove('ptr-hover'), 250);
    target.click();
    if (type === 'dblclick') target.click();
  }

  /* ---------------------------- Calibrazione ---------------------------- */

  startCalibration() {
    if (!this.vision.source) { this.toast('Accendi prima la telecamera', true); return; }
    const targets = calibrationTargets(this.cfg.pointer.calibrationPoints);
    this.calibration.reset();
    this.calibration.minSpan = this.cfg.pointer.minSpan;
    this.calibSession = { targets, index: 0, enteredAt: performance.now(), samples: [] };
    this.overlay.setMode('calibrate');
    this.overlay.calib = { target: targets[0], index: 0, total: targets.length, progress: 0, message: t('cal.look') };
    this.audio.say(t('cal.look'), 'menu', true);
  }

  onCalibrationSample(now, eye) {
    const S = this.calibSession, P = this.cfg.pointer;
    const elapsed = now - S.enteredAt;
    // Prima si attende che lo sguardo ARRIVI sul bersaglio, poi si
    // raccoglie: campionare subito registrerebbe il tragitto.
    if (elapsed < P.calibrationSettleMs) {
      this.overlay.calib.progress = 0;
      return;
    }
    S.samples.push({ x: eye.x, y: eye.y });
    const dwell = P.calibrationDwellMs;
    this.overlay.calib.progress = Math.min(1, (elapsed - P.calibrationSettleMs) / dwell);
    if (elapsed - P.calibrationSettleMs < dwell) return;

    // Mediana dei campioni: robusta rispetto a un ammiccamento o a una
    // distrazione a metà raccolta.
    const med = arr => { const a = [...arr].sort((p, q) => p - q); return a[a.length >> 1]; };
    const ex = med(S.samples.map(s => s.x)), ey = med(S.samples.map(s => s.y));
    const tgt = S.targets[S.index];

    // Ricentratura: non si aggiunge un campione, si sposta la mappa.
    if (S.recenter) {
      const r = this.calibration.recenter(ex, ey, tgt.x * window.innerWidth, tgt.y * window.innerHeight);
      this.calibSession = null;
      this.overlay.setMode(this.cfg.pointer.enabled ? 'pointer' : 'off');
      if (r.ok) {
        this.set('pointer.calibrationData', this.calibration.serialize());
        this.toast(`Ricentrato · scostamento ${Math.round(r.shift)} px`);
        this.audio.earcon('confirm');
      } else {
        this.toast(r.reason, true);
      }
      this.pointerView.renderStatus();
      return;
    }

    this.calibration.add(ex, ey, tgt.x * window.innerWidth, tgt.y * window.innerHeight);
    this.audio.earcon('confirm');

    S.index++; S.samples = []; S.enteredAt = now;
    if (S.index >= S.targets.length) { this.finishCalibration(); return; }
    this.overlay.calib = {
      target: S.targets[S.index], index: S.index, total: S.targets.length,
      progress: 0, message: t('cal.look'),
    };
  }

  finishCalibration() {
    this.calibSession = null;
    const r = this.calibration.fit();
    this.overlay.setMode('off');
    if (!r.ok) {
      // Si riportano le escursioni MISURATE: senza, non c'è modo di
      // capire se il problema è la persona, la telecamera o la soglia.
      const det = r.spanX !== undefined
        ? ` (orizzontale ${r.spanX.toFixed(3)} · verticale ${r.spanY.toFixed(3)} · minimo richiesto ${this.cfg.pointer.minSpan})`
        : '';
      this.toast(r.reason + det, true);
      this.debugView.logEvent('calibrazione fallita: ' + r.reason + det, true);
      this.audio.speakProtected(r.reason, 'menu');
      this.pointerView.renderStatus();
      return;
    }
    this.set('pointer.calibrationData', this.calibration.serialize());
    // Il punto peggiore va detto: se un solo angolo è sbagliato si
    // ripete la calibrazione mirando lì, invece di rassegnarsi.
    const worst = r.worst ? ` · punto peggiore ${Math.round(r.worst.error)} px` : '';
    const msg = `${t('cal.done')} · errore medio ${Math.round(r.error)} px${worst}`;
    this.toast(msg);
    this.audio.speakProtected(t('cal.done'), 'menu');
    this.enablePointer(true);
    this.pointerView.renderStatus();
  }

  /**
   * Ricentratura a un punto. La deriva — testa che si sposta, montatura
   * che scivola, braccio urtato — è di gran lunga la causa più
   * frequente di peggioramento nel corso della giornata, e non richiede
   * di rifare tutta la calibrazione.
   */
  startRecenter() {
    if (!this.calibration.ready) { this.toast('Serve prima una calibrazione completa', true); return; }
    if (!this.vision.source) { this.toast('Accendi prima la telecamera', true); return; }
    this.calibSession = {
      targets: [{ x: 0.5, y: 0.5 }], index: 0, enteredAt: performance.now(),
      samples: [], recenter: true,
    };
    this.overlay.setMode('calibrate');
    this.overlay.calib = {
      target: { x: 0.5, y: 0.5 }, index: 0, total: 1, progress: 0,
      message: this.cfg.ui.language === 'en' ? 'Look at the centre dot' : 'Guarda il punto al centro',
    };
    this.audio.say(this.overlay.calib.message, 'menu', true);
  }

  enablePointer(on) {
    this.set('pointer.enabled', on);
    this.pointer.setViewport(window.innerWidth, window.innerHeight);
    this.stripe.setViewport(window.innerWidth, window.innerHeight);
    this.pointer.setEnabled(on && this.cfg.pointer.mode === 'gaze');
    if (!on) { this.stripe.cancel(); this.overlay.setMode('off'); }
    else this.overlay.setMode(this.cfg.device.enabled && this.cfg.device.showFeedback ? 'arm'
      : (this.cfg.pointer.mode === 'gaze' ? 'pointer' : 'stripe'));
    const b = document.getElementById('btnPtrToggle');
    if (b) b.textContent = on ? t('btn.ptrStop') : t('btn.ptrStart');
    this.pointerView.renderStatus();
  }

  onDevice(e) {
    if (e.type === 'state' || e.type === 'stopped') this.pointerView.renderArm();
    if (e.type === 'log') this.debugView.logEvent(`dispositivo: ${e.text}`, e.kind === 'error' || e.kind === 'stop');
    if (e.type === 'status') this.overlay.arm = { ...(this.overlay.arm || {}), status: e.status };
  }

  /* -------------------------------- Loop -------------------------------- */

  loop() {
    // ⚠️ REGOLA STRUTTURALE.
    // Il ciclo di scansione è l'UNICA cosa che permette a chi ha un solo
    // gesto di comunicare. Non deve poter morire per nessun motivo.
    // Prima `requestAnimationFrame` era l'ultima riga: una qualsiasi
    // eccezione lo interrompeva per sempre, e la persona restava senza
    // alcun modo di parlare. Ora il riarmo avviene in `finally`, e
    // l'avanzamento della scansione è isolato dal disegno.
    const step = () => {
      try { this._frame(); }
      catch (e) { this._frameError(e); }
      finally { requestAnimationFrame(step); }
    };
    requestAnimationFrame(step);
  }

  _frameError(e) {
    this._frameErrors = (this._frameErrors || 0) + 1;
    if (this._lastFrameError === e.message) return;
    this._lastFrameError = e.message;
    console.error('[ciclo]', e);
    try {
      this.debugView.logEvent(`errore nel ciclo: ${e.message}`, true);
      this.toast(`Errore interno: ${e.message}`, true);
    } catch {}
  }

  _frame() {
    const now = performance.now();

    // Priorità assoluta: far avanzare la scansione. Se il disegno
    // fallisce, la persona deve comunque poter comunicare.
    this.scan.tick(now);

    try { this._frameUi(now); }
    catch (e) { this._frameError(e); }
  }

  _frameUi(now) {
    {
      const fill = document.getElementById('scanbarFill');
      if (fill) fill.style.width = `${(this.scan.snapshot().progress * 100).toFixed(1)}%`;
      if (now - (this._lastCamUi || 0) > 1000) { this._lastCamUi = now; this.updateCamButton(); }

      if (this.stripe.active) this.stripe.tick(now);
      if (this.overlay.mode !== 'off') {
        if (this.overlay.mode === 'arm') {
          const D = this.cfg.device;
          this.overlay.arm = {
            ...(this.overlay.arm || {}),
            x: this.device.lastPos.x, y: this.device.lastPos.y,
            gripper: this.device.gripper,
            connected: this.device.connected, stopped: this.device.stopped,
            limits: { x0: D.limitXMin, x1: D.limitXMax, y0: D.limitYMin, y1: D.limitYMax },
          };
        }
        this.overlay.draw(COLORS);
      }
    }
  }

  /* ------------------------------- Camera ------------------------------- */

  async startVision(file = null) {
    try {
      document.getElementById('chipSource').textContent = 'apertura…';
      const info = await this.vision.start(file);
      document.getElementById('chipSource').textContent =
        `${info.kind} ${info.width}×${info.height}`;
      this.debugView.logEvent(`sorgente attiva: ${info.label || info.kind}`);
      this.updateCamButton();
      // Con il permesso ora attivo il browser rivela i dispositivi
      // audio: si ridisegnano le impostazioni perché gli elenchi si
      // popolino, invece di restare vuoti come prima del permesso.
      this._safe('barra video', () => this.aggiornaBarraVideo());
      // I nomi delle telecamere compaiono solo dopo il permesso: si
      // riempiono di nuovo appena la camera è partita.
      this._safe('telecamere', () => this.aggiornaSelettoriCamera());
      // Sorveglianza: da qui in poi un'interruzione viene notata e
      // riparata da sola, anche se non c'è nessuno in stanza.
      this._safe('sorveglianza', () => {
        /* ⚠️ La sorveglianza è della TELECAMERA, e va armata solo per
         * la telecamera.
         *
         * Analizzando un video caricato non c'è nessuna telecamera da
         * sorvegliare: quando il video si fermava, la sorveglianza
         * scattava lo stesso e annunciava "telecamera ripristinata" a
         * chi non l'aveva mai accesa. Un messaggio falso, che mandava
         * a cercare il difetto nel posto sbagliato.
         *
         * Il video da file ha una sorveglianza propria, dentro la
         * sorgente stessa, che rimette in moto la riproduzione senza
         * toccare nulla di ciò che riguarda la telecamera. */
        const daFile = typeof this.vision.source?.togglePlay === 'function';
        if (daFile) {
          this.watchdog.ferma();
          this.debugView?.logEvent('sorgente da file: sorveglianza telecamera non necessaria');
        } else {
          this.watchdog.avvia(() => performance.now());
          const st = this.vision.source?.stream;
          if (st) this.watchdog.sorveglia(st);
        }
        this.sorvAudio.avvia();
      });
      this._safe('audio: elenco dispositivi', () => {
        this.audio.applySinks();
        if (document.body.dataset.tab === 'impostazioni') this.settingsView.render();
      });
      this.toast(this.cfg.ui.language === 'en' ? 'Camera on' : 'Camera attiva');
    } catch (e) {
      document.getElementById('chipSource').textContent = 'errore';
      this.updateCamButton();
      this.debugView.logEvent(`errore sorgente: ${e.message}`, true);
      this.toast(e.message, true);
    }
  }

  async stopVision() {
    // Fermando di proposito la telecamera, la sorveglianza va spenta:
    // altrimenti la riaccenderebbe subito, scambiando una scelta per
    // un guasto.
    this.watchdog?.ferma();
    this.aggiornaStatoTelecamera();
    await this.vision.stop();
    document.getElementById('chipSource').textContent = 'camera —';
    this.debugView.logEvent('sorgente fermata');
    this.updateCamButton();
  }

  /** Riflette lo stato reale della sorgente nei due punti dell'interfaccia. */
  updateCamButton() {
    /* ⚠️ Un video caricato NON è la telecamera.
     *
     * Il pulsante guardava solo se l'analisi era attiva, quindi
     * caricando un video diceva "Ferma camera" a chi non l'aveva mai
     * accesa — e premendolo si fermava il video credendo di spegnere
     * una telecamera che non era mai partita. */
    const daFile = typeof this.vision.source?.togglePlay === 'function';
    const on = this.vision.status === 'attiva' && !daFile;
    // Il pulsante della scheda Punta è protetto SOLO quando spegne:
    // accendere non fa danni, spegnere toglie ogni comando alla persona.
    const ptc = document.getElementById('ptCam');
    if (ptc && !ptc.classList.contains('in-conferma')) {
      ptc.textContent = on ? t('btn.camStop') : t('btn.camStart');
      ptc.classList.toggle('ptr-danger', on);
      ptc.classList.toggle('btn-primary', !on);
    }
    const btn = document.getElementById('btnCamMain');
    const state = document.getElementById('camState');
    if (btn) btn.textContent = on ? t('btn.camStop') : t('btn.camStart');
    if (btn) btn.classList.toggle('btn-primary', !on);
    // Analizzando un video, accendere la telecamera la sostituirebbe:
    // si dice, invece di lasciarlo scoprire premendo.
    if (btn) {
      btn.title = daFile
        ? 'Stai analizzando un video: avviare la telecamera lo sostituirà'
        : '';
    }
    if (state) {
      const L = this.cfg.ui.language === 'en';
      state.textContent = on
        ? (L ? `camera on · ${this.vision.fps.toFixed(0)} fps` : `camera accesa · ${this.vision.fps.toFixed(0)} fps`)
        : (L ? 'camera off — keyboard only' : 'camera spenta — solo tastiera');
    }
  }

  /**
   * Canali che il grafico deve disegnare.
   * Se l'utente non ha scelto nulla, si mostrano automaticamente solo
   * i canali attivi: l'interfaccia resta leggibile senza configurazione,
   * ma chi vuole può accendere qualsiasi traccia per la diagnosi.
   */
  activeTraces() {
    const chosen = this.cfg.ui.plotTraces;
    if (chosen && chosen.length) {
      return {
        traces: chosen.filter(id => id in TRACE_STYLE || id in FACE_STYLE),
        blinks: chosen.filter(id => id in BLINK_STYLE),
      };
    }
    const g = this.cfg.gestures;
    const on = {
      up: g.UP?.enabled || g.UP_LONG?.enabled || g.UP_VERYLONG?.enabled,
      down: g.DOWN?.enabled, left: g.LEFT?.enabled, right: g.RIGHT?.enabled,
    };
    const act = this.cfg.detection.activeEye;
    const eyes = act === 'both' ? ['left', 'right'] : [act];
    const traces = [];
    for (const e of eyes) for (const d of ['up','down','left','right']) if (on[d]) traces.push(`${e}.${d}`);
    const blinkOn = g.BLINK?.enabled || g.DOUBLE_BLINK?.enabled || g.TRIPLE_BLINK?.enabled || g.LONG_CLOSE?.enabled;
    const blinks = blinkOn ? eyes.map(e => `${e}.blink`) : [];
    return { traces: traces.length ? traces : eyes.map(e => `${e}.up`), blinks };
  }

  /** Barra dei chip per accendere e spegnere le tracce. */
  renderTraceBar() {
    const bar = document.getElementById('traceBar');
    if (!bar) return;
    const chosen = this.cfg.ui.plotTraces || [];
    const auto = chosen.length === 0;
    const { traces, blinks } = this.activeTraces();
    const shown = new Set([...traces, ...blinks]);
    const g = this.cfg.gestures;
    const channelOn = {
      up: g.UP?.enabled || g.UP_LONG?.enabled || g.UP_VERYLONG?.enabled,
      down: g.DOWN?.enabled, left: g.LEFT?.enabled, right: g.RIGHT?.enabled,
    };
    bar.innerHTML = '';

    const chip = (id, label, color, isBlink, disabled, dash) => {
      const el = document.createElement('span');
      el.className = 'tchip' + (shown.has(id) ? ' on' : '') + (disabled ? ' off-channel' : '');
      el.style.color = shown.has(id) ? color : '';
      el.title = disabled ? t('plot.off') : label;
      // Il campione riproduce il TRATTO della linea, non solo il colore:
      // altrimenti tutti i pulsanti sembrano linee continue e non si
      // capisce quale traccia corrisponde a quale occhio.
      const tratteggio = dash && dash.length
        ? `background:repeating-linear-gradient(90deg,${color} 0 6px,transparent 6px 10px)`
        : `background:${color}`;
      el.innerHTML = `<i class="${isBlink ? 'dot' : 'swatch'}" style="${tratteggio}"></i>${label}`;
      el.onclick = () => {
        const cur = new Set(auto ? shown : chosen);
        if (cur.has(id)) cur.delete(id); else cur.add(id);
        this.set('ui.plotTraces', [...cur]);
        this.renderTraceBar();
      };
      return el;
    };

    for (const [id, st] of Object.entries(TRACE_STYLE)) {
      const dir = id.split('.')[1];
      bar.append(chip(id, st.label, st.color, false, !channelOn[dir], st.dash));
    }
    // Canali del viso: mostrati SOLO se attivi, come voluto — chi non
    // li usa non deve trovarsi la barra piena di tracce inutili.
    if (this.cfg.detection?.faceChannels) {
      const sep0 = document.createElement('span'); sep0.className = 'tsep'; bar.append(sep0);
      for (const [id, st] of Object.entries(FACE_STYLE)) {
        bar.append(chip(id, st.label, st.color, false, false, st.dash));
      }
    }
    const sep = document.createElement('span'); sep.className = 'tsep'; bar.append(sep);
    for (const [id, st] of Object.entries(BLINK_STYLE)) bar.append(chip(id, st.label, st.color, true, false, st.dash));

    const sep2 = document.createElement('span'); sep2.className = 'tsep'; bar.append(sep2);
    const rawChip = document.createElement('span');
    rawChip.className = 'tchip' + (this.cfg.ui.plotShowRaw ? ' on' : '');
    rawChip.innerHTML = `<i class="swatch" style="background:#7C93A4"></i>${t('plot.showRaw')}`;
    rawChip.onclick = () => { this.set('ui.plotShowRaw', !this.cfg.ui.plotShowRaw); this.renderTraceBar(); };
    bar.append(rawChip);

    if (!auto) {
      const reset = document.createElement('span');
      reset.className = 'tchip';
      reset.textContent = 'auto';
      reset.onclick = () => { this.set('ui.plotTraces', []); this.renderTraceBar(); };
      bar.append(reset);
    }
  }

  listCameras() { return CameraSource.listDevices(); }
  listAudioOutputs() { return AudioDirector.listOutputs(); }

  /* --------------------------------- UI --------------------------------- */

  bindUI() {
    document.querySelectorAll('[data-goto]').forEach(b => {
      b.onclick = () => this.goto(b.dataset.goto);
    });

    /* ── Termini e condizioni ──
     * Il programma non parte finché non sono accettati. Chi accetta è
     * l'ASSISTENTE, con un mouse, prima che Aurora cominci: qui una
     * finestra è appropriata, e per questo è una finestra dentro la
     * pagina e non un dialogo del browser — così si può leggere con
     * calma, scorrere e stampare.
     */
    const accetta = document.getElementById('gateAccept');
    const entra = document.getElementById('btnEnter');
    const chiave = 'aurora.termini.accettati';

    const segnaAccettato = () => {
      try { localStorage.setItem(chiave, VERSIONE_TERMINI); } catch {}
      if (accetta) accetta.checked = true;
      if (entra) entra.disabled = false;
    };

    // Chi li ha già accettati non se li rivede — ma cambiando i
    // termini la versione cambia, e vengono richiesti di nuovo.
    try {
      if (localStorage.getItem(chiave) === VERSIONE_TERMINI) segnaAccettato();
    } catch {}

    if (accetta && entra) {
      accetta.onchange = () => {
        entra.disabled = !accetta.checked;
        if (accetta.checked) { try { localStorage.setItem(chiave, VERSIONE_TERMINI); } catch {} }
        else { try { localStorage.removeItem(chiave); } catch {} }
      };
    }

    const box = document.getElementById('legalBox');
    const corpo = document.getElementById('legalBody');
    const apriTermini = () => {
      if (!box || !corpo) return;
      if (!corpo.dataset.pronto) {
        corpo.innerHTML = testoInHtml(this.cfg.ui.language === 'en' ? TERMINI_EN : TERMINI_IT);
        corpo.dataset.pronto = '1';
      }
      box.hidden = false;
      corpo.scrollTop = 0;
    };
    const chiudiTermini = () => { if (box) box.hidden = true; };

    document.getElementById('gateTerms')?.addEventListener('click', (ev) => {
      ev.preventDefault(); apriTermini();
    });
    document.getElementById('legalClose')?.addEventListener('click', chiudiTermini);
    document.getElementById('legalAccept')?.addEventListener('click', () => {
      segnaAccettato(); chiudiTermini();
    });
    document.getElementById('legalPrint')?.addEventListener('click', () => {
      try { window.print(); } catch {}
    });
    // Toccare fuori dal riquadro chiude, come ci si aspetta.
    box?.addEventListener('click', (ev) => { if (ev.target === box) chiudiTermini(); });

    this.aggiornaSelettoriCamera();

    /* ── Comando di riduzione, presente in barra su OGNI schermata ──
     * Chi comanda il cursore con gli occhi deve poterlo fare da dove si
     * trova, senza dover prima tornare in una scheda apposita. */
    const bm = document.getElementById('btnMini');
    if (bm) {
      bm.onclick = () => {
        if (this.finestra?.aperta) this.chiudiFinestraCompatta();
        else this.apriFinestraCompatta();
      };
    }
    this.aggiornaPulsanteMini();

    document.getElementById('btnEnter').onclick = async () => {
      // Difesa a valle: anche se il pulsante fosse abilitato per
      // errore, senza accettazione non si parte.
      if (accetta && !accetta.checked) { apriTermini(); return; }
      const r = await this.audio.unlock();
      document.getElementById('gate').classList.add('is-hidden');
      if (this.cfg.source.autoStart) this.startVision();
      if (!r.sinkSupported) {
        this.toast('Questo browser non consente di scegliere l\'uscita audio: canale singolo.', true);
      }
      // enumerateDevices restituisce etichette vuote finché non c'è un
      // permesso concesso: si popolano dopo l'avvio della camera.
      this.settingsView.render();
    };

    document.getElementById('btnStart').onclick = () => {
      this.scan.start(performance.now());
      this.gestures.setPaused(false);
    };
    document.getElementById('btnPause').onclick = () => {
      // I comandi dell'ASSISTENTE alternano: un pulsante etichettato
      // "Pausa" deve mettere in pausa e riprendere, sempre. La
      // separazione fra pausa e risveglio serve ai GESTI, dove una
      // tenuta un po' lunga non deve poter mettere in pausa.
      this.scan.handleAction('TOGGLE_PAUSE', performance.now());
      this.gestures.setPaused(this.scan.paused);
    };
    document.getElementById('btnSelect').onclick = () => this.gestures.injectKey('SELECT');
    document.getElementById('btnUndo').onclick = () => this.gestures.injectKey('UNDO');
    document.getElementById('btnSpeak').onclick = () => this.gestures.injectKey('SPEAK');
    // Anche i pulsanti dell'assistente passano dalla stessa porta dei
    // gesti: un solo percorso da collaudare, nessuna via parallela che
    // possa comportarsi diversamente.
    const bb = document.getElementById('btnBack');
    if (bb) bb.onclick = () => this.gestures.injectKey('BACK');

    for (const m of PT_MODES) {
      const b = document.getElementById(`ptMode-${m}`);
      if (b) b.onclick = () => this.pointerView.setMode(m);
    }
    const ptBtn = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
    ptBtn('ptSpeak', () => this.gestures.injectKey('SPEAK'));
    ptBtn('ptUndo', () => this.gestures.injectKey('UNDO'));
    ptBtn('ptClear', () => this.pointerView.clearBuffer());
    ptBtn('ptSaveDraft', () => {
      const b = this.scan.buffer;
      const txt = [...b.words, b.letters].join(' ').trim();
      if (!txt) { this.toast('Non c\'è ancora niente da salvare', true); return; }
      this.onDraft('save', { text: txt });
    });

    const ptc = document.getElementById('ptCam');
    if (ptc) ptc.onclick = () => {
      if (this.vision.status === 'attiva') this.stopVision();
      else this.startVision();
    };

    document.getElementById('btnCalibrate').onclick = () => this.startCalibration();
    const br = document.getElementById('btnRecenter');
    if (br) br.onclick = () => this.startRecenter();

    const caricaFile = async (files, apri = true) => {
      if (!files?.length) return;
      let ultimo = null;
      for (const f of files) {
        const n = f.name.toLowerCase();
        // La cartella di provenienza si ricava dal percorso relativo,
        // che il browser fornisce quando si seleziona una cartella.
        const rel = f.webkitRelativePath || '';
        const cartella = rel.includes('/') ? rel.split('/')[0] : null;
        if (/\.(png|jpe?g|gif|webp|bmp|avif)$/.test(n)) {
          this.library.images = this.library.images.filter(i => i.title !== f.name);
          this.library.images.push({ title: f.name, file: f, folder: cartella });
          ultimo = { kind: 'img' };
        } else if (/\.(mp3|m4a|aac|ogg|wav|flac|opus)$/.test(n)) {
          this.library.audios = this.library.audios.filter(a => a.title !== f.name);
          this.library.audios.push({ title: f.name, file: f });
          ultimo = { kind: 'audio', index: this.library.audios.length - 1 };
        } else if (/\.(mp4|webm|mov|m4v|ogv)$/.test(n)) {
          this.library.videoFiles = this.library.videoFiles || [];
          this.library.videoFiles = this.library.videoFiles.filter(v => v.title !== f.name);
          this.library.videoFiles.push({ title: f.name, file: f });
          ultimo = { kind: 'videofile', file: f };
        } else {
          this.library.docs = this.library.docs.filter(d => d.title !== f.name);
          this.library.docs.push({ title: f.name, file: f });
          ultimo = { kind: 'doc', index: this.library.docs.length - 1 };
        }
      }
      this.refreshContext();
      this.renderLibreria();
      if (!apri || !ultimo) return;
      try {
        this.agganciaMedia();
        if (ultimo.kind === 'doc') {
          const d = this.library.docs[ultimo.index];
          await (/\.pdf$/i.test(d.file.name) ? this.media.openPdf(d.file) : this.media.openText(d.file));
        } else if (ultimo.kind === 'audio') {
          await this.media.openMediaFiles(this.library.audios.map(a => a.file), ultimo.index, false);
        } else if (ultimo.kind === 'videofile') {
          await this.media.openMediaFiles([ultimo.file], 0, true);
        } else {
          await this.media.openImages(this.library.images.map(i => i.file));
        }
      } catch (err) { this.toast(err.message, true); }
    };

    const fd = document.getElementById('fileDoc');
    if (fd) fd.onchange = async (e) => { await caricaFile(e.target.files); e.target.value = ''; };
    const fi = document.getElementById('fileImg');
    if (fi) fi.onchange = async (e) => { await caricaFile(e.target.files); e.target.value = ''; };
    const fc = document.getElementById('fileFolder');
    if (fc) fc.onchange = async (e) => { await caricaFile(e.target.files, false); e.target.value = ''; };
    document.getElementById('btnSaveText').onclick = () => this.saveComposedText();
    const bs = document.getElementById('btnSaveDraft');
    if (bs) bs.onclick = () => {
      const b = this.scan.buffer;
      const txt = [...b.words, b.letters].join(' ').trim();
      if (!txt) { this.toast('Non c\'è ancora niente da salvare', true); return; }
      this.onDraft('save', { text: txt });
    };
    const bx = document.getElementById('btnExportDrafts');
    if (bx) bx.onclick = () => {
      const blob = new Blob([this.drafts.exportAll()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'aurora-testi.json'; a.click();
      this.toast('Testi esportati');
    };
    const bi = document.getElementById('fileImportDrafts');
    if (bi) bi.onchange = async (ev) => {
      const f = ev.target.files?.[0]; if (!f) return;
      try {
        const r = this.drafts.importAll(await f.text());
        this.refreshContext(); this.renderDrafts();
        this.toast(r.skipped
          ? `${r.added} testi importati · ${r.skipped} già presenti`
          : `${r.added} testi importati`);
      } catch (err) { this.toast(err.message, true); }
      ev.target.value = '';
    };
    document.getElementById('btnFavAdd').onclick = () => {
      const url = document.getElementById('favUrl').value.trim();
      const title = document.getElementById('favTitle').value.trim();
      if (!youtubeId(url)) { this.toast('Link YouTube non riconosciuto', true); return; }
      this.set('media.favorites', [...(this.cfg.media.favorites || []), { title: title || url, url }]);
      document.getElementById('favUrl').value = '';
      document.getElementById('favTitle').value = '';
      this.renderFavorites();
      this.toast('Preferito aggiunto');
    };
    document.getElementById('btnPtrToggle').onclick = () => this.enablePointer(!this.cfg.pointer.enabled);
    document.getElementById('btnStripe').onclick = () => {
      this.set('pointer.mode', 'scanStripe');
      this.enablePointer(true);
      this.stripe.start(performance.now());
    };

    document.getElementById('btnCamStart').onclick = () => this.startVision();
    document.getElementById('btnCamStop').onclick = () => this.stopVision();

    // Stesso comando anche nella pagina d'uso: chi assiste non deve
    // ricordarsi di passare dalla diagnostica per accendere la camera,
    // e deve vedere a colpo d'occhio se è accesa.
    document.getElementById('btnCamMain').onclick = () => {
      if (this.vision.status === 'attiva') this.stopVision();
      else this.startVision();
    };
    document.getElementById('fileVideo').onchange = (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      /* ⚠️ Un video nuovo è una sessione nuova.
       *
       * Stime del rumore, baseline, riferimenti di apertura e
       * statistiche cliniche si accumulano per tutta la sessione — ed
       * è giusto, servono tempo per essere affidabili. Ma caricando
       * un altro video, o passando a un'altra persona, si continuava
       * a misurare con lo stato costruito sul filmato precedente,
       * senza alcun modo di accorgersene.
       *
       * Chi carica un video si aspetta di ricominciare da lì. */
      this.gestures.nuovaSessione();
      this.vision?.rgb?.nuovaSessione?.();
      this.sessione = new SessionStats();
      this.plot?.clear();
      this.debugView?.logEvent('nuovo video: sessione azzerata');
      this.startVision(f);
    };

    /* ── Comandi del video caricato ──
     * Servono per tarare su una ripresa fatta altrove: lo stesso
     * istante va rivisto molte volte cambiando un parametro alla
     * volta. Tutti tolleranti a una sorgente assente o non pronta.
     */
    const vid = () => {
      const src = this.vision?.source;
      return (src && typeof src.togglePlay === 'function') ? src : null;
    };
    const vb = (id, fn) => { const e2 = document.getElementById(id); if (e2) e2.onclick = () => { const v = vid(); if (v) { fn(v); this.aggiornaBarraVideo(); } }; };
    vb('vidPlay', v => v.togglePlay());
    vb('vidRew', v => v.riavvolgi());
    vb('vidBack', v => v.salta(-5));
    vb('vidFwd', v => v.salta(5));

    const seek = document.getElementById('vidSeek');
    if (seek) {
      // Mentre si trascina non si aggiorna la barra da sola, altrimenti
      // il cursore scapperebbe di mano.
      seek.oninput = () => { this._seekInCorso = true; const v = vid(); if (v) v.vaiA(seek.value / 1000); };
      seek.onchange = () => { this._seekInCorso = false; };
    }
    const sp = document.getElementById('vidSpeed');
    if (sp) sp.onchange = () => { const v = vid(); if (v) v.setVelocita(parseFloat(sp.value) || 1); };
    const lp = document.getElementById('vidLoop');
    if (lp) lp.onchange = () => { const v = vid(); if (v) v.setLoop(lp.checked); };

    document.getElementById('profileName').onchange = (e) => this.set('profileName', e.target.value);

    document.getElementById('btnExport').onclick = () => {
      const blob = new Blob([exportProfile(this.cfg, this.predictor.serialize())], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `aurora-${(this.cfg.profileName || 'profilo').replace(/\W+/g, '-')}.json`;
      a.click();
      this.toast('Profilo esportato');
    };

    document.getElementById('fileImport').onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const { config, stats } = importProfile(await f.text());
        this.cfg = config;
        if (stats) this.predictor = new Predictor(this.cfg, stats);
        this.onConfigChanged();
        this.settingsView.render();
        this.statsView.render();
        this.toast('Profilo importato');
      } catch (err) { this.toast(err.message, true); }
      e.target.value = '';
    };

    const bds = document.getElementById('btnDiagSession');
    if (bds) bds.onclick = () => {
      const d = this.sessione.serialize();
      d.riepilogo = this.sessione.riepilogo();
      d.parametri = this.sessione.parametriConsigliati();
      d.profilo = this.cfg.profileName || '';
      this._scaricaDiag(d, `aurora-diagnostica-sessione-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`);
      this.toast('Statistica di sessione salvata');
    };

    const bdt = document.getElementById('btnDiagTotal');
    if (bdt) bdt.onclick = () => {
      // Il cumulativo vive in memoria locale e cresce a ogni sessione.
      let cum = null;
      try { cum = JSON.parse(localStorage.getItem('aurora.diag.cum') || 'null'); } catch {}
      const tot = new SessionStats();
      if (cum) tot.merge(cum);
      tot.merge(this.sessione.serialize());
      const d = tot.serialize();
      try { localStorage.setItem('aurora.diag.cum', JSON.stringify(d)); } catch {}
      d.riepilogo = tot.riepilogo();
      d.parametri = tot.parametriConsigliati();
      d.profilo = this.cfg.profileName || '';
      this._scaricaDiag(d, `aurora-diagnostica-cumulata-${new Date().toISOString().slice(0, 10)}.json`);
      this.toast('Statistica cumulata salvata e aggiornata');
    };

    const bdi = document.getElementById('fileDiag');
    if (bdi) bdi.onchange = async (e) => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        if (!this.sessione.merge(d)) { this.toast('Questo file non contiene una diagnostica', true); return; }
        this.renderDiagStats();
        this.toast('Diagnostica unita a quella corrente');
      } catch (err) { this.toast(`File non valido: ${err.message}`, true); }
    };

    const bda = document.getElementById('btnDiagApply');
    if (bda) bda.onclick = () => {
      const p = this.sessione.parametriConsigliati();
      if (!p.ok) { this.toast(p.motivo, true); return; }
      const voci = Object.entries(p.proposta);
      if (!voci.length) { this.toast('Nessun parametro da applicare', true); return; }
      const elenco = voci.map(([k, v]) => `  ${k.split('.').pop()} → ${v}`).join('\n');
      if (!confirm(`Applicare ${voci.length} parametri misurati su ${p.minuti} minuti?\n\n${elenco}\n\nAffidabilità: ${p.affidabilita}.`)) return;
      this._configPrimaTaratura = deepClone(this.cfg);
      // Si conservano SOLO i valori toccati: ripristinare tutto
      // annullerebbe anche le regolazioni fatte a mano nel frattempo.
      this._paramPrec = {};
      for (const [k] of voci) this._paramPrec[k] = this.get(k);
      for (const [k, v] of voci) this.set(k, v);
      const undo = document.getElementById('btnDiagUndo');
      if (undo) undo.disabled = false;
      this.settingsView.render();
      this.toast(`Applicati ${voci.length} parametri — puoi ripristinarli per confrontare`);
      p.motivi.forEach(m => this.debugView.logEvent('diagnostica: ' + m));
    };

    /* ── Preparazione all'uso offline ──
     * Aurora è l'unico modo di comunicare per chi lo usa: non deve
     * dipendere dalla rete. Librerie e carattere sono già inclusi nel
     * programma; restano il modello di riconoscimento e il codice
     * WASM, che si scaricano al primo uso. Questo comando li scarica
     * SUBITO, mentre c'è connessione e c'è un assistente presente,
     * invece di sperare che la cache si riempia al momento giusto.
     */
    /* Comandi del pannello compatto. Restano collegati anche quando il
     * pannello viene spostato nella finestra fluttuante: si sposta
     * l'elemento, non se ne crea una copia, quindi i gestori seguono. */
    const mini = (id, fn) => {
      const e2 = document.getElementById(id);
      if (e2) e2.onclick = () => { try { fn(); } catch {} };
    };
    mini('miniClick', () => this.device?.mouseClick(1));
    mini('miniDouble', () => this.device?.mouseDoubleClick(1));
    mini('miniRight', () => this.device?.mouseClick(2));
    mini('miniUp', () => this.device?.mouseScroll(3));
    mini('miniDown', () => this.device?.mouseScroll(-3));
    mini('miniClose', () => this.chiudiFinestraCompatta());

    const bff = document.getElementById('btnFloatWindow');
    if (bff) bff.onclick = () => {
      if (this.finestra?.aperta) this.chiudiFinestraCompatta();
      else this.apriFinestraCompatta();
    };

    const bpo = document.getElementById('btnOffline');
    if (bpo) bpo.onclick = async () => {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      const sw = reg?.active;
      if (!sw) { this.toast('Ricarica la pagina una volta e riprova', true); return; }
      bpo.disabled = true;
      const prima = bpo.textContent;
      bpo.textContent = 'Scaricamento in corso…';
      const esito = await new Promise((ris) => {
        const suMessaggio = (ev) => {
          if (ev.data?.tipo !== 'preparaOfflineFatto') return;
          navigator.serviceWorker.removeEventListener('message', suMessaggio);
          ris(ev.data);
        };
        navigator.serviceWorker.addEventListener('message', suMessaggio);
        sw.postMessage({ tipo: 'preparaOffline' });
        // Tetto: una rete lentissima non deve lasciare il pulsante bloccato.
        setTimeout(() => {
          navigator.serviceWorker.removeEventListener('message', suMessaggio);
          ris(null);
        }, 180000);
      });
      bpo.disabled = false;
      bpo.textContent = prima;
      if (!esito) { this.toast('Scaricamento non completato: riprova con una connessione migliore', true); return; }
      if (esito.falliti) {
        this.toast(`Scaricati ${esito.fatti} di ${esito.totale} — riprova quando la rete è stabile`, true);
      } else {
        this.toast('✓ Pronto per funzionare senza internet');
        this.debugView?.logEvent('preparazione offline completata');
      }
    };

    const cda = document.getElementById('chkDiagAlways');
    if (cda) {
      cda.checked = !!this.cfg.ui.diagAlways;
      cda.onchange = () => {
        this.set('ui.diagAlways', cda.checked);
        this.gestures.setDiagnostics(document.body.dataset.tab === 'diagnostica' || cda.checked);
        this.toast(cda.checked
          ? 'La misura continua anche fuori da questa scheda'
          : 'La misura si ferma uscendo da questa scheda');
      };
    }

    /* ── Ripristino dei parametri ──
     * Applicare i parametri consigliati e poi poterli togliere permette
     * di vedere la differenza in tempo reale, invece di doverla
     * immaginare. Senza, applicare è una scelta irreversibile che si
     * esita a fare. */
    const bri = document.getElementById('btnDiagUndo');
    if (bri) {
      bri.disabled = true;
      bri.onclick = () => {
        if (!this._paramPrec) { this.toast('Non c\'è nulla da ripristinare', true); return; }
        for (const [via, val] of Object.entries(this._paramPrec)) this.set(via, val);
        this._paramPrec = null;
        bri.disabled = true;
        this.settingsView?.render();
        this.toast('Parametri riportati a come erano');
        this.debugView?.logEvent('parametri ripristinati');
      };
    }

    /* Ritorno ai valori predefiniti, raggiungibile dalla diagnostica:
     * si riparte da una situazione pulita e si vede subito come cambia
     * il rilevamento, senza uscire dalla scheda. */
    const brs = document.getElementById('btnDiagReset');
    if (brs) brs.onclick = () => {
      if (!confirm('Riportare filtri e soglie ai valori predefiniti?\n\nLe altre impostazioni non vengono toccate.')) return;
      this.settingsView._ripristinaFiltri();
      this.toast('Filtri e soglie riportati ai valori predefiniti');
      this.debugView?.logEvent('filtri riportati ai predefiniti');
    };

    /* ── Nuova sessione ──
     * Azzera tutto ciò che si accumula: stime del rumore, baseline,
     * riferimenti, contatori, statistiche cliniche e grafico. Serve
     * passando a un'altra persona, a un altro video, o semplicemente
     * per rifare una prova da capo con la certezza di ripartire pulito. */
    const bns = document.getElementById('btnNuovaSessione');
    if (bns) bns.onclick = () => {
      if (!confirm('Azzerare la sessione?\n\nSi perdono le misure raccolte finora — rumore, baseline, statistiche cliniche e grafico — e si riparte da zero.\n\nLe impostazioni NON vengono toccate.')) return;
      this.gestures.nuovaSessione();
      // ⚠️ Anche il RILEVATORE accumula stato: il riferimento del
      // raggio dell'iride di quella persona. Senza azzerarlo, "nuova
      // sessione" lasciava dietro proprio ciò che rende diverso un
      // programma appena aperto da uno già in uso.
      this.vision?.rgb?.nuovaSessione?.();
      this.sessione = new SessionStats();
      this.plot?.clear();
      this.renderDiagStats?.();
      this.debugView?.renderCounters?.();
      this.toast('Sessione azzerata: si riparte da zero');
      this.debugView?.logEvent('sessione azzerata');
    };

    const bat = document.getElementById('btnAutoTune');
    if (bat) bat.onclick = () => this.avviaTaraturaAutomatica();

    document.getElementById('btnReset').onclick = () => {
      if (!confirm('Ripristinare tutte le impostazioni? Le statistiche restano.')) return;
      this.cfg = deepClone(DEFAULT_CONFIG);
      this.onConfigChanged();
      this.settingsView.render();
      this.toast('Impostazioni ripristinate');
    };

    /**
     * Statistiche: esportazione e importazione INDIPENDENTI dal profilo.
     *
     * Prima esistevano solo dentro l'esportazione del profilo, e
     * importare un profilo per copiare una configurazione cancellava il
     * lessico appreso — settimane di apprendimento perse senza avviso.
     * Ora sono un file a sé, e si può scegliere se unire o sostituire.
     */
    const bse = document.getElementById('btnStatsExport');
    if (bse) bse.onclick = () => {
      const dati = {
        aurora_stats: true,
        version: 1,
        exportedAt: new Date().toISOString(),
        profileName: this.cfg.profileName || '',
        stats: this.predictor.serialize(),
      };
      const blob = new Blob([JSON.stringify(dati, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `aurora-statistiche-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      this.toast('Statistiche esportate');
    };

    const leggiStat = async (file) => {
      const testo = await file.text();
      const d = JSON.parse(testo);
      // Si accetta sia il file di sole statistiche sia un profilo
      // completo: chi ha un vecchio backup non deve restare a piedi.
      return d.stats || d.statistics || (d.phrases ? d : null);
    };

    const bsm = document.getElementById('fileStatsMerge');
    if (bsm) bsm.onchange = async (e) => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      try {
        const st = await leggiStat(f);
        if (!st) { this.toast('Nessuna statistica in questo file', true); return; }
        const r = this.predictor.merge(st);
        this.persist(); this.refreshContext(); this.statsView.render();
        this.toast(`Unite: ${r.frasi} frasi · ${r.parole} parole · ${r.coppie} coppie`);
      } catch (err) { this.toast(`File non valido: ${err.message}`, true); }
    };

    const bsr = document.getElementById('fileStatsReplace');
    if (bsr) bsr.onchange = async (e) => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      if (!confirm('Sostituire TUTTE le statistiche attuali?\n\nIl lessico appreso finora andrà perso. Se vuoi solo aggiungere, usa "Importa e unisci".')) return;
      try {
        const st = await leggiStat(f);
        if (!st) { this.toast('Nessuna statistica in questo file', true); return; }
        this.predictor.replaceAll(st);
        this.persist(); this.refreshContext(); this.statsView.render();
        this.toast('Statistiche sostituite');
      } catch (err) { this.toast(`File non valido: ${err.message}`, true); }
    };

    document.getElementById('btnAddPhrase').onclick = () => {
      const el = document.getElementById('newPhrase');
      if (!el.value.trim()) return;
      this.predictor.addPhrase(el.value.trim(), true);   // in cima: costa meno raggiungerla
      this.persist(); this.refreshContext(); this.statsView.render();
      el.value = '';
      this.toast('Frase aggiunta');
    };

    // Barra spaziatrice: entra dalla stessa porta dei gesti, così la
    // logica collaudata a tastiera è esattamente quella che girerà
    // con la telecamera.
    window.addEventListener('keydown', (ev) => {
      if (!this.cfg.ui.keyboardInput) return;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(ev.target.tagName)) return;
      if (ev.code === 'Space') { ev.preventDefault(); this.gestures.injectKey('SELECT'); }
      else if (ev.code === 'Backspace') { ev.preventDefault(); this.gestures.injectKey('UNDO'); }
      else if (ev.code === 'Enter') { ev.preventDefault(); this.gestures.injectKey('SPEAK'); }
      else if (ev.code === 'Escape') { ev.preventDefault(); this.gestures.injectKey('TOGGLE_PAUSE'); }
      else if (ev.code === 'ArrowLeft') { ev.preventDefault(); this.gestures.injectKey('BACK'); }
    });
  }

  goto(tab) {
    document.body.dataset.tab = tab;
    // In diagnostica si calcolano TUTTI gli assi, anche quelli dei
    // canali spenti: serve proprio a decidere quali accendere.
    /* ⚠️ Con "diagnostica sempre attiva" la misura NON si interrompe
     * uscendo dalla scheda: chi vuole osservare la persona mentre usa
     * davvero il programma deve poterlo fare, e al ritorno trovare
     * tutto come l'aveva lasciato. */
    this.gestures.setDiagnostics(tab === 'diagnostica' || !!this.cfg.ui.diagAlways);
    if (tab === 'diagnostica') {
      /* ⚠️ Il grafico NON si azzera più tornando in diagnostica.
       * Azzerarlo faceva sembrare che tutto ricominciasse da capo, e
       * impediva di confrontare come stava andando prima di uscire. */
      this.renderTraceBar(); this.renderDiagStats();
      this.aggiornaBarraVideo();
    }
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('is-active', p.id === `panel-${tab}`));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.goto === tab));
    if (tab === 'statistiche') this.statsView.render();
    if (tab === 'impostazioni') this.settingsView.render();
    if (tab === 'parla') this.scheduleFit();
    if (tab === 'punta') { this.pointerView.render(); this.renderMediaBar(); this.scheduleFit(); }
    if (tab === 'detta') { this.initDettatura(); this.scheduleFit(); }
    // Uscendo dalla scheda si ferma il microfono: non deve restare
    // acceso a insaputa di chi lo sta usando.
    if (tab !== 'detta' && this.dettatura?.attiva) this.dettatura.ferma();
    if (tab === 'guarda') { this.renderFavorites(); this.renderLibreria(); this.renderMediaBar(); }
    if (tab === 'punta') this.renderDrafts();
    this.agganciaMedia();
  }

  /**
   * Rete di sicurezza sul layout della pagina Parla.
   *
   * Il CSS dimensiona tutto in unità di altezza, quindi nella maggior
   * parte dei casi basta. Ma la larghezza del testo composto, la lunghezza
   * delle etichette dei gruppi e le voci tradotte possono variare: se
   * qualcosa eccede comunque, si riduce progressivamente --fit finché
   * rientra. Nessuna barra di scorrimento deve mai comparire qui: chi
   * non può usare il mouse non può scorrere.
   */
  fitSpeakPanel() {
    const tab = document.body.dataset.tab;
    if (tab !== 'parla' && tab !== 'punta') return;
    const p = document.getElementById(tab === 'parla' ? 'panel-parla' : 'panel-punta');
    if (!p) return;
    const root = document.documentElement;
    let fit = 1;
    root.style.setProperty('--fit', '1');
    // Il palco è elastico: si misura l'eccedenza degli elementi rigidi.
    for (let i = 0; i < 14; i++) {
      const over = p.scrollHeight - p.clientHeight;
      if (over <= 1) break;
      fit = Math.max(0.55, fit - 0.05);
      root.style.setProperty('--fit', String(fit));
      // Forza il ricalcolo prima della misura successiva.
      void p.offsetHeight;
    }
    // Il testo composto resta ancorato in fondo: si deve vedere ciò che
    // si è appena scritto, non l'inizio della frase.
    const sent = document.getElementById('composeSentence');
    if (sent) sent.scrollTop = sent.scrollHeight;
  }

  scheduleFit() {
    if (this._fitPending) return;
    this._fitPending = true;
    requestAnimationFrame(() => { this._fitPending = false; this.fitSpeakPanel(); });
  }

  toast(msg, err = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast show${err ? ' err' : ''}`;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.className = 'toast'; }, err ? 5000 : 2600);
  }

  _esc(s) { return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
}

/* Cache della lingua applicata: evita di ricostruire l'interfaccia a
   ogni salvataggio di configurazione, che avviene a ogni cursore mosso. */
let _langCache = null;
function getLangCache() { return _langCache; }
function setLangCache(v) { _langCache = v; }

window.aurora = new App();
