/**
 * Watchdog.js — Sorveglianza e ripristino di telecamera e audio.
 *
 * ══════════════════════════════════════════════════════════════════
 * PERCHÉ È LA COSA PIÙ IMPORTANTE DEL PROGRAMMA
 * ══════════════════════════════════════════════════════════════════
 *
 * Chi usa Aurora non ha altro modo di comunicare. Se la telecamera si
 * stacca, si blocca, o il sistema la sospende per risparmiare energia,
 * la persona resta muta — e non può dirlo a nessuno. Può succedere di
 * notte, quando non c'è nessuno in stanza, e restare così per ore.
 *
 * Un cavo USB che perde contatto, un browser che sospende una scheda
 * in secondo piano, un driver che si riavvia, un auricolare Bluetooth
 * che si disconnette: tutte cose ordinarie, che qui hanno conseguenze
 * che ordinarie non sono.
 *
 * Il programma deve quindi accorgersene DA SOLO e rimettersi in piedi
 * DA SOLO, senza che nessuno debba essere presente.
 *
 * ══════════════════════════════════════════════════════════════════
 * TRE MODI DI ACCORGERSENE
 * ══════════════════════════════════════════════════════════════════
 *
 * 1. La traccia video finisce — evento `ended` sul MediaStreamTrack:
 *    è il segnale esplicito, arriva quando il dispositivo sparisce.
 * 2. I fotogrammi smettono di arrivare: la traccia risulta viva ma
 *    non produce nulla. È il caso peggiore, perché nessun evento
 *    avvisa, ed è quello che succede quando un driver si impianta.
 * 3. L'elenco dei dispositivi cambia — evento `devicechange`: la
 *    telecamera è stata staccata o riattaccata.
 *
 * ══════════════════════════════════════════════════════════════════
 * COME SI RIMETTE IN PIEDI
 * ══════════════════════════════════════════════════════════════════
 *
 * Con attesa crescente fra un tentativo e il successivo. Riprovare
 * ogni secondo per ore consumerebbe batteria e riempirebbe il registro
 * senza risolvere nulla; aspettare troppo lascerebbe la persona muta
 * più del necessario. Si parte da un secondo e si sale fino a mezzo
 * minuto, e non si smette MAI di provare: una telecamera riattaccata
 * dopo tre ore deve tornare a funzionare da sola.
 */

export class Watchdog {
  /**
   * @param opzioni {{
   *   onDiagnosi(stato): void,      // per il registro e l'interfaccia
   *   onRipristina(): Promise,      // riapre la sorgente
   *   fermoMs: number,              // fotogrammi assenti = guasto
   *   intervalloMs: number,         // ogni quanto controllare
   * }}
   */
  constructor(opzioni = {}) {
    this.onDiagnosi = opzioni.onDiagnosi || (() => {});
    this.onRipristina = opzioni.onRipristina || (async () => {});
    this.fermoMs = opzioni.fermoMs ?? 4000;
    this.intervalloMs = opzioni.intervalloMs ?? 1000;

    this.attivo = false;
    this.ultimoFotogramma = 0;
    this.tentativi = 0;
    this.inRipristino = false;
    this.ultimoEsito = null;
    this.contatori = { guasti: 0, ripristini: 0, falliti: 0 };
    this._timer = null;
    this._tracce = [];
  }

  /** Un fotogramma è arrivato: il cuore batte. */
  battito(t) { this.ultimoFotogramma = t; }

  /**
   * Attesa prima del prossimo tentativo, crescente.
   * 1s, 2s, 4s, 8s, 16s, poi fissa a 30s — e non si arrende mai.
   */
  attesaProssimoTentativo() {
    return Math.min(30000, 1000 * Math.pow(2, Math.min(5, this.tentativi)));
  }

  /**
   * Sorveglia le tracce di un flusso: se una finisce, si sa subito
   * invece di aspettare che scadano i fotogrammi.
   */
  sorveglia(stream) {
    this._staccaTracce();
    if (!stream?.getTracks) return;
    for (const t of stream.getTracks()) {
      const suEnded = () => this._segnala('traccia terminata', `la traccia ${t.kind} è finita`);
      const suMute = () => this._segnala('traccia muta', `la traccia ${t.kind} non produce più dati`);
      t.addEventListener?.('ended', suEnded);
      t.addEventListener?.('mute', suMute);
      this._tracce.push({ t, suEnded, suMute });
    }
  }

  _staccaTracce() {
    for (const { t, suEnded, suMute } of this._tracce) {
      t.removeEventListener?.('ended', suEnded);
      t.removeEventListener?.('mute', suMute);
    }
    this._tracce = [];
  }

  avvia(orologio = () => Date.now()) {
    if (this.attivo) return;
    this.attivo = true;
    this.orologio = orologio;
    this.ultimoFotogramma = orologio();
    this.tentativi = 0;
    this._timer = setInterval(() => this.controlla(), this.intervalloMs);
  }

  ferma() {
    this.attivo = false;
    this._staccaTracce();
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  /** Un controllo. Chiamato periodicamente, ma anche provabile a mano. */
  controlla() {
    if (!this.attivo || this.inRipristino) return null;
    const ora = this.orologio ? this.orologio() : Date.now();
    const fermo = ora - this.ultimoFotogramma;
    if (fermo < this.fermoMs) return null;
    return this._segnala('nessun fotogramma',
      `nessun fotogramma da ${(fermo / 1000).toFixed(1)} secondi`);
  }

  _segnala(tipo, dettaglio) {
    if (this.inRipristino) return null;
    this.contatori.guasti++;
    const stato = { tipo, dettaglio, tentativo: this.tentativi + 1 };
    this.onDiagnosi({ ...stato, fase: 'guasto' });
    this._tentaRipristino(stato);
    return stato;
  }

  async _tentaRipristino(stato) {
    if (this.inRipristino) return;
    this.inRipristino = true;
    const attesa = this.attesaProssimoTentativo();
    this.tentativi++;
    this.onDiagnosi({ ...stato, fase: 'attesa', attesaMs: attesa });

    await new Promise(r => setTimeout(r, attesa));
    if (!this.attivo) { this.inRipristino = false; return; }

    try {
      await this.onRipristina();
      // Riuscito: si azzera il conteggio, così un guasto isolato non
      // lascia il sistema in stato "diffidente" per sempre.
      this.tentativi = 0;
      this.contatori.ripristini++;
      this.ultimoFotogramma = this.orologio ? this.orologio() : Date.now();
      this.ultimoEsito = 'riuscito';
      this.onDiagnosi({ ...stato, fase: 'ripristinato' });
    } catch (e) {
      this.contatori.falliti++;
      this.ultimoEsito = 'fallito';
      this.onDiagnosi({ ...stato, fase: 'fallito', errore: e?.message || String(e) });
      // Non ci si arrende: il prossimo controllo riproverà, con
      // un'attesa più lunga. Una telecamera riattaccata dopo ore deve
      // tornare a funzionare da sola.
      this.ultimoFotogramma = (this.orologio ? this.orologio() : Date.now())
        - this.fermoMs + 500;
    } finally {
      this.inRipristino = false;
    }
  }

  get stato() {
    const ora = this.orologio ? this.orologio() : Date.now();
    return {
      attivo: this.attivo,
      fermoMs: this.attivo ? ora - this.ultimoFotogramma : 0,
      tentativi: this.tentativi,
      inRipristino: this.inRipristino,
      ultimoEsito: this.ultimoEsito,
      ...this.contatori,
    };
  }
}

/**
 * Sorveglianza dei dispositivi audio.
 *
 * Un auricolare Bluetooth che si disconnette non fa smettere il
 * programma di funzionare — la voce esce comunque, dall'altoparlante —
 * ma cambia CHI la sente. Gli annunci di scansione, che dovrebbero
 * essere privati, finirebbero in stanza; e la persona potrebbe non
 * sentire più nulla se l'auricolare era la sua unica via.
 *
 * Non si può rimediare da soli — il sistema decide quale dispositivo
 * usare — ma si può accorgersene e dirlo, che è già molto meglio che
 * lasciarlo scoprire per caso.
 */
export class SorveglianzaAudio {
  constructor(onCambio) {
    this.onCambio = onCambio || (() => {});
    this.precedenti = null;
    this.attivo = false;
    this._suCambio = () => this.verifica();
  }

  async avvia() {
    if (this.attivo) return false;
    if (!globalThis.navigator?.mediaDevices?.addEventListener) return false;
    this.attivo = true;
    this.precedenti = await this._elenco();
    navigator.mediaDevices.addEventListener('devicechange', this._suCambio);
    return true;
  }

  ferma() {
    if (!this.attivo) return;
    this.attivo = false;
    navigator.mediaDevices.removeEventListener?.('devicechange', this._suCambio);
  }

  async _elenco() {
    try {
      const d = await navigator.mediaDevices.enumerateDevices();
      return d.filter(x => x.kind === 'audiooutput' || x.kind === 'videoinput')
              .map(x => `${x.kind}:${x.deviceId}`);
    } catch { return []; }
  }

  /** Confronta l'elenco attuale con il precedente. */
  async verifica() {
    const ora = await this._elenco();
    const prima = this.precedenti || [];
    const spariti = prima.filter(x => !ora.includes(x));
    const comparsi = ora.filter(x => !prima.includes(x));
    this.precedenti = ora;
    if (!spariti.length && !comparsi.length) return null;
    const esito = {
      spariti, comparsi,
      videoSparito: spariti.some(x => x.startsWith('videoinput')),
      audioSparito: spariti.some(x => x.startsWith('audiooutput')),
    };
    this.onCambio(esito);
    return esito;
  }
}
