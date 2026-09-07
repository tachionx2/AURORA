/**
 * AudioDirector.js — Regia audio a due canali.
 *
 *   Canale PRIVATO (auricolare): annunci di scansione. Li sente solo lei.
 *   Canale PUBBLICO (altoparlante): solo la frase finita.
 *
 * Non è una comodità, è dignità: gli astanti non devono sentire ogni
 * singolo tentativo, e lei non deve subire il rumore amplificato nella
 * stanza per ore.
 *
 * setSinkId() consente di scegliere l'uscita. Funziona bene su desktop;
 * su Android il supporto è incerto — se manca, si degrada a canale
 * singolo con volumi distinti, e la shell nativa potrà fare il routing.
 */

export class AudioDirector {
  constructor(cfg) {
    this.cfg = cfg;
    this.ctx = null;
    this.voices = [];
    this.voice = null;
    this.menuEl = null;
    this.speechEl = null;
    this.sinkSupported = false;
    this.queue = [];
    this.speaking = false;
    this.lastLatencyMs = 0;
    // Messaggio "protetto" in corso: gli annunci di scansione non
    // devono poterlo cancellare. Vedi la nota in say().
    this.protecting = false;
    this._initVoices();
  }

  updateConfig(cfg) { this.cfg = cfg; this._pickVoice(); }

  /** Va chiamato da un gesto dell'utente: i browser bloccano l'audio prima. */
  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.menuEl = new Audio();
    this.speechEl = new Audio();
    this.sinkSupported = typeof this.menuEl.setSinkId === 'function';
    await this.applySinks();
    return { audio: true, sinkSupported: this.sinkSupported };
  }

  /**
   * ⚠️ LIMITE DI PIATTAFORMA, da conoscere.
   *
   * La sintesi vocale del browser (`speechSynthesis`) esce SEMPRE dal
   * dispositivo predefinito di sistema. Non esiste alcuna API per
   * instradarla altrove: `setSinkId` funziona sugli elementi <audio> e
   * sull'AudioContext, non sul parlato sintetizzato.
   *
   * Quindi oggi, nel browser:
   *   · i toni brevi (earcon) SI POSSONO instradare — passano da
   *     Web Audio, e qui lo facciamo davvero;
   *   · il parlato NO: annunci e frase escono entrambi dal dispositivo
   *     predefinito di sistema.
   *
   * La separazione reale dei due canali richiede la shell nativa
   * Android, dove AudioTrack.setPreferredDevice instrada per singolo
   * flusso. Nel frattempo restano utili: due voci diverse, due velocità
   * e due volumi, che rendono i canali comunque distinguibili.
   *
   * Questa funzione applica ciò che è applicabile e riporta con
   * onestà che cosa ha funzionato.
   */
  async applySinks() {
    const esito = { earcon: false, parlato: false, motivo: '' };
    const idEarcon = this.cfg.audio.menuSinkId;

    // AudioContext.setSinkId: instrada i toni brevi. Chrome 110+.
    if (this.ctx && typeof this.ctx.setSinkId === 'function') {
      try {
        await this.ctx.setSinkId(idEarcon || '');
        esito.earcon = true;
      } catch (e) { esito.motivo = e.message; }
    } else {
      esito.motivo = 'AudioContext.setSinkId non disponibile in questo browser';
    }

    // Elementi <audio>: predisposti per quando il parlato arriverà da
    // dati audio veri (shell nativa o sintesi locale).
    if (this.sinkSupported) {
      try {
        if (this.cfg.audio.menuSinkId) await this.menuEl.setSinkId(this.cfg.audio.menuSinkId);
        if (this.cfg.audio.speechSinkId) await this.speechEl.setSinkId(this.cfg.audio.speechSinkId);
      } catch (e) { /* non incide sul parlato: vedi nota sopra */ }
    }

    this.instradamento = esito;
    return esito;
  }

  /** Che cosa questo browser sa davvero instradare. */
  get statoInstradamento() {
    return {
      earcon: !!this.instradamento?.earcon,
      // Vero solo se un giorno il parlato passerà da dati audio.
      parlato: false,
      motivo: this.instradamento?.motivo || '',
      sinkSupported: this.sinkSupported,
    };
  }

  static async listOutputs() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter(d => d.kind === 'audiooutput')
                 .map(d => ({ id: d.deviceId, label: d.label || 'Uscita audio' }));
    } catch { return []; }
  }

  _initVoices() {
    const load = () => {
      this.voices = window.speechSynthesis?.getVoices?.() || [];
      this._pickVoice();
    };
    load();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = load;
  }

  _pickVoice() {
    if (!this.voices.length) return;
    this.voice = this._voiceFor('menu');
  }

  /**
   * Voce del canale richiesto.
   * Se non è stata scelta, si usa la prima italiana disponibile; se non
   * ce n'è, la prima in assoluto — meglio una voce sbagliata che nessuna.
   */
  _voiceFor(channel) {
    const a = this.cfg?.audio || {};
    const want = channel === 'speech' ? a.speechVoiceUri : a.menuVoiceUri;
    return (want && this.voices.find(v => v.voiceURI === want))
      || (a.ttsVoiceUri && this.voices.find(v => v.voiceURI === a.ttsVoiceUri))
      || this.voices.find(v => v.lang?.toLowerCase().startsWith('it'))
      || this.voices[0];
  }

  /** Elenco delle voci, con quelle italiane per prime. */
  get availableVoices() {
    return this.voices
      .map(v => ({ uri: v.voiceURI, name: v.name, lang: v.lang,
                   it: !!v.lang?.toLowerCase().startsWith('it') }))
      .sort((a, b) => (b.it - a.it) || a.name.localeCompare(b.name));
  }

  /* ---------------------------- Earcon ---------------------------- */

  /**
   * Toni brevi PRIMA del parlato. Riducono il tempo per passo di
   * 200–300 ms, perché la posizione si riconosce prima che la parola
   * sia finita.
   */
  earcon(kind) {
    if (!this.ctx || !this.cfg.audio.enabled || !this.cfg.audio.earcons) return;
    const map = {
      group:   { f: this.cfg.audio.earconGroupHz, d: 0.06, g: 0.20 },
      item:    { f: this.cfg.audio.earconItemHz,  d: 0.04, g: 0.16 },
      confirm: { f: 1320, d: 0.05, g: 0.22 },
      undo:    { f: 300,  d: 0.09, g: 0.22 },
      pause:   { f: 220,  d: 0.14, g: 0.20 },
      wake:    { f: 660,  d: 0.10, g: 0.22 },
      error:   { f: 180,  d: 0.16, g: 0.20 },
    };
    const p = map[kind] || map.item;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.f, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(p.g * this.cfg.audio.menuVolume, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + p.d);

    // Panning stereo: i toni passano da Web Audio, quindi si possono
    // spostare su un canale. È l'unica parte dell'audio di guida che
    // si può separare fisicamente dal parlato.
    const pan = Math.max(-1, Math.min(1, this.cfg.audio.earconPan || 0));
    if (pan !== 0 && typeof this.ctx.createStereoPanner === 'function') {
      const sp = this.ctx.createStereoPanner();
      sp.pan.setValueAtTime(pan, t0);
      osc.connect(gain).connect(sp).connect(this.ctx.destination);
    } else {
      osc.connect(gain).connect(this.ctx.destination);
    }
    osc.start(t0); osc.stop(t0 + p.d + 0.02);
  }

  /* ------------------------------ TTS ------------------------------ */

  /**
   * @param text testo
   * @param channel 'menu' (privato) | 'speech' (pubblico)
   * @param interrupt true per gli annunci: il passo successivo non deve
   *        aspettare che finisca il precedente
   * @returns {Promise<void>} risolta a fine pronuncia
   *
   * ⚠️ NOTA IMPORTANTE. `speechSynthesis.cancel()` svuota TUTTA la coda,
   * non solo l'elemento in riproduzione. Senza la guardia `protecting`,
   * il primo annuncio di scansione successivo cancellerebbe la frase
   * dell'utente prima ancora che inizi a essere pronunciata — che è
   * esattamente ciò che rendeva muti PARLA, RILEGGI e le frasi rapide.
   */
  /**
   * Collega chi deve abbassare altri suoni mentre si annuncia.
   *
   * È la soluzione dei navigatori sopra la musica: senza, ascoltare la
   * radio significherebbe non sentire più la guida — e quindi non
   * poter più cambiare stazione né uscire.
   */
  setAbbassamento(fn) { this.abbassa = fn; }

  /** Collega la banca delle voci registrate (facoltativa). */
  setVoiceBank(bank) { this.bank = bank; }

  /**
   * Riproduce la registrazione della frase, se esiste.
   *
   * È l'unico percorso su cui `setSinkId` funziona davvero: sono dati
   * audio, non sintesi. Se non c'è registrazione restituisce false e si
   * ricade sulla sintesi, esattamente come prima.
   */
  async _riproduciRegistrata(text, channel) {
    if (!this.cfg.audio.useVoiceBank || !this.bank?.pronta) return false;
    const url = await this.bank.urlDi(text);
    if (!url) return false;
    const el = channel === 'speech' ? this.speechEl : this.menuEl;
    if (!el) return false;
    try {
      el.pause();
      el.src = url;
      el.volume = channel === 'speech' ? this.cfg.audio.speechVolume : this.cfg.audio.menuVolume;
      el.playbackRate = Math.max(0.5, Math.min(4,
        channel === 'speech' ? (this.cfg.audio.speechRate ?? 1) : (this.cfg.audio.menuRate ?? 1)));
      this.speaking = true;
      await new Promise((ris) => {
        const fine = () => { el.onended = null; el.onerror = null; ris(); };
        el.onended = fine;
        el.onerror = fine;
        // Tetto di sicurezza: una registrazione danneggiata non deve
        // bloccare la scansione per sempre.
        setTimeout(fine, 8000);
        el.play().catch(fine);
      });
      this.speaking = false;
      return true;
    } catch { this.speaking = false; return false; }
  }

  /**
   * Pronuncia. Se esiste una registrazione per questo testo la usa,
   * altrimenti passa alla sintesi. La firma resta una Promise, come
   * prima: chi chiama non deve sapere quale delle due strade è stata
   * presa.
   */
  say(text, channel = 'menu', interrupt = true) {
    if (!this.cfg.audio.enabled || !text) return Promise.resolve();
    // Si abbassa ciò che sta suonando, e si rialza a voce finita.
    try { this.abbassa?.(true); } catch {}
    const finito = () => { try { this.abbassa?.(false); } catch {} };
    if (this.cfg.audio.useVoiceBank && this.bank?.ha?.(text)) {
      return this._riproduciRegistrata(text, channel)
        .then(ok => (ok ? undefined : this._sintetizza(text, channel, interrupt)))
        .finally(finito);
    }
    return this._sintetizza(text, channel, interrupt).finally(finito);
  }

  _sintetizza(text, channel, interrupt) {
    const synth = window.speechSynthesis;
    if (!synth) return Promise.resolve();
    if (interrupt && channel === 'menu' && !this.protecting) synth.cancel();

    const a = this.cfg.audio;
    const parlato = channel === 'speech';
    const u = new SpeechSynthesisUtterance(String(text));
    const voce = this._voiceFor(channel);
    if (voce) { u.voice = voce; u.lang = voce.lang; }
    else u.lang = 'it-IT';
    u.rate = parlato ? (a.speechRate ?? a.rate) : (a.menuRate ?? a.rate);
    u.pitch = parlato ? (a.speechPitch ?? a.pitch) : (a.menuPitch ?? a.pitch);
    u.volume = parlato ? a.speechVolume : a.menuVolume;

    const t0 = performance.now();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; this.speaking = false; resolve(); };
      u.onstart = () => { this.lastLatencyMs = performance.now() - t0; this.speaking = true; };
      u.onend = finish;
      u.onerror = finish;
      // Rete di sicurezza: alcune sintesi non emettono mai `onend`
      // (bug noto su alcune voci Android). Senza questo, una promessa
      // mai risolta bloccherebbe la scansione per sempre.
      const guard = 1200 + String(text).length * 90;
      setTimeout(finish, Math.min(20000, guard));
      synth.speak(u);
    });
  }

  /**
   * Messaggio all'utente che NON deve essere troncato dagli annunci:
   * la frase pronunciata, la rilettura, le conferme.
   * Restituisce una promessa che la scansione usa per attendere.
   */
  async speakProtected(text, channel = 'speech', alsoEcho = false) {
    if (!this.cfg.audio.enabled || !text) return;
    window.speechSynthesis?.cancel();     // svuota gli annunci pendenti
    this.protecting = true;
    try {
      await this.say(text, channel, false);
      if (alsoEcho && channel === 'speech' && this.cfg.audio.echoSpeechToMenu) {
        await this.say(text, 'menu', false);
      }
    } finally {
      this.protecting = false;
    }
  }

  /** Annuncia una voce di scansione: earcon + nome. */
  announce(node, meta) {
    if (!this.cfg.audio.enabled) return;
    this.earcon(meta.isGroup ? 'group' : 'item');
    if (!this.cfg.audio.speakLetters && !meta.isGroup && node.action === 'CHAR') return;
    let text = node.spoken || node.label;
    if (!meta.isGroup && node.action === 'CHAR' && this.cfg.audio.letterNames) {
      text = LETTER_NAMES_IT[text.toUpperCase()] || text;
    }
    this.say(text, 'menu', true);
  }

  stop() {
    window.speechSynthesis?.cancel();
    try { this.menuEl?.pause(); this.speechEl?.pause(); } catch {}
  }
}

/**
 * Nomi delle lettere in italiano. "bi" è molto più distinguibile di "b"
 * pronunciata isolata, soprattutto attraverso un auricolare a
 * conduzione ossea e a volume basso.
 */
export const LETTER_NAMES_IT = {
  A: 'a', B: 'bi', C: 'ci', D: 'di', E: 'e', F: 'effe', G: 'gi', H: 'acca',
  I: 'i', J: 'i lunga', K: 'cappa', L: 'elle', M: 'emme', N: 'enne', O: 'o',
  P: 'pi', Q: 'cu', R: 'erre', S: 'esse', T: 'ti', U: 'u', V: 'vu',
  W: 'doppia vu', X: 'ics', Y: 'ipsilon', Z: 'zeta', ' ': 'spazio',
};
