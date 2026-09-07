/**
 * DeviceLink.js — Uscita verso dispositivi esterni (braccio robotico,
 * scheda di controllo, attuatori).
 *
 * ══════════════════════════════════════════════════════════════════
 * COME ARRIVA IL SEGNALE AL DISPOSITIVO
 * ══════════════════════════════════════════════════════════════════
 *
 * Due vie, la stessa interfaccia:
 *
 * 1. WEB SERIAL (`navigator.serial`) — USB diretto dal browser.
 *    Funziona su Chrome/Edge DESKTOP (Windows, macOS, Linux, ChromeOS).
 *    Richiede HTTPS e un gesto dell'utente per la scelta della porta.
 *    NON esiste su Android né su iOS: è una limitazione di piattaforma,
 *    come per le webcam USB.
 *
 * 2. BRIDGE (WebSocket su 127.0.0.1) — la stessa shell nativa che
 *    ripubblica la telecamera può possedere la porta USB e inoltrare i
 *    comandi. È la via per Android, e ha il vantaggio di poter
 *    applicare i limiti di sicurezza anche fuori dal browser.
 *
 * ══════════════════════════════════════════════════════════════════
 * PROTOCOLLO — testo, una riga per comando, terminatore \n
 * ══════════════════════════════════════════════════════════════════
 *
 *   P <x> <y> <z>     posizione assoluta, 0.000–1.000 dello spazio utile
 *   D <dx> <dy>       spostamento relativo, -1.000–1.000
 *   G <0-100>         apertura pinza in percentuale
 *   B <n> <0|1>       uscita digitale n
 *   H                 ritorno alla posizione di riposo
 *
 * ── Comandi MOUSE (per chi controlla il cursore con gli occhi) ──
 *   M <dx> <dy>       sposta il cursore, in passi interi
 *   C <n>             clic: 1 sinistro, 2 destro, 3 centrale
 *   K <n>             doppio clic con il pulsante n
 *   T <n> <0|1>       tiene premuto (1) o rilascia (0) il pulsante n
 *   W <n>             rotellina, positivo verso l'alto
 *   S                 ARRESTO IMMEDIATO
 *   ?                 richiesta di stato
 *
 * Risposte attese dal dispositivo:
 *   OK                comando eseguito
 *   ERR <testo>       errore
 *   ST <x> <y> <z> <g>   stato corrente
 *
 * Un firmware Arduino/ESP32 che lo implementa sta in circa trenta
 * righe. Il protocollo è deliberatamente leggibile: si può collaudare
 * il dispositivo da un terminale seriale prima di collegarlo qui.
 *
 * ══════════════════════════════════════════════════════════════════
 * ⚠️ SICUREZZA — leggere prima di collegare un braccio
 * ══════════════════════════════════════════════════════════════════
 *
 * Un braccio robotico vicino a una persona che NON PUÒ SPOSTARSI è un
 * rischio serio. Chi lo comanda non può scansare un movimento
 * sbagliato, e non può nemmeno chiedere aiuto in fretta.
 *
 * Le protezioni implementate qui sono il minimo, non il sufficiente:
 *   · uomo-morto: senza comandi per `deadmanMs` il dispositivo riceve
 *     ARRESTO. Un browser che si blocca deve fermare il braccio.
 *   · limite di velocità: gli spostamenti sono limitati per unità di
 *     tempo, così un salto del puntatore non diventa uno scatto.
 *   · limiti di spazio: le coordinate sono confinate a un riquadro
 *     configurabile.
 *   · arresto immediato sempre disponibile, e inviato anche alla
 *     chiusura della pagina.
 *
 * Restano indispensabili, e NON sono sostituibili dal software:
 *   · un arresto di emergenza FISICO raggiungibile da chi assiste;
 *   · limiti di coppia e di corrente sul dispositivo stesso;
 *   · un assistente presente durante l'uso;
 *   · prove prolungate a vuoto, lontano dalla persona, prima dell'uso.
 */

export const LinkState = {
  DISCONNECTED: 'disconnesso',
  CONNECTING: 'connessione',
  CONNECTED: 'connesso',
  ERROR: 'errore',
};

export class DeviceLink {
  constructor(cfg, onEvent) {
    this.cfg = cfg;
    this.onEvent = onEvent;
    this.state = LinkState.DISCONNECTED;
    this.transport = null;        // 'serial' | 'bridge'
    this.port = null;
    this.ws = null;
    this.writer = null;
    this.reader = null;
    this.lastSendAt = 0;
    this.lastPos = { x: 0.5, y: 0.5, z: 0.5 };
    this.gripper = 0;
    this.deviceStatus = null;
    this.stopped = false;
    this.log = [];
    this.counters = { sent: 0, received: 0, errors: 0, throttled: 0, stops: 0 };
    this._deadman = null;
  }

  updateConfig(cfg) { this.cfg = cfg; }

  static get serialSupported() { return typeof navigator !== 'undefined' && 'serial' in navigator; }

  _emit(type, data) { this.onEvent?.({ type, ...data }); }

  _note(text, kind = 'info') {
    this.log.unshift({ t: Date.now(), text, kind });
    if (this.log.length > 60) this.log.pop();
    this._emit('log', { text, kind });
  }

  /* ------------------------------ Connessione ------------------------------ */

  async connectSerial() {
    if (!DeviceLink.serialSupported) {
      throw new Error('Web Serial non disponibile: serve Chrome o Edge su computer. Su Android usa il bridge.');
    }
    this.state = LinkState.CONNECTING; this._emit('state', { state: this.state });
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: this.cfg.device.baudRate || 115200 });
      this.port = port;
      this.transport = 'serial';
      const enc = new TextEncoderStream();
      enc.readable.pipeTo(port.writable);
      this.writer = enc.writable.getWriter();
      this._readLoopSerial(port);
      this._afterConnect();
      return true;
    } catch (e) {
      this.state = LinkState.ERROR;
      this._note(`connessione fallita: ${e.message}`, 'error');
      this._emit('state', { state: this.state, error: e.message });
      throw e;
    }
  }

  async connectBridge(url) {
    this.state = LinkState.CONNECTING; this._emit('state', { state: this.state });
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url || this.cfg.device.bridgeUrl);
      const to = setTimeout(() => reject(new Error('bridge non raggiungibile')), 4000);
      ws.onopen = () => {
        clearTimeout(to);
        this.ws = ws; this.transport = 'bridge';
        this._afterConnect(); resolve(true);
      };
      ws.onerror = () => { clearTimeout(to); this.state = LinkState.ERROR; reject(new Error('errore WebSocket')); };
      ws.onclose = () => { this.state = LinkState.DISCONNECTED; this._emit('state', { state: this.state }); };
      ws.onmessage = (ev) => this._onLine(String(ev.data).trim());
    });
  }

  _afterConnect() {
    this.state = LinkState.CONNECTED;
    this.stopped = false;
    this._note(`connesso via ${this.transport}`);
    this._emit('state', { state: this.state, transport: this.transport });
    this.send('?');
    this._startDeadman();
    // Se la pagina si chiude, il braccio deve fermarsi.
    this._unload = () => { try { this.sendRaw('S'); } catch {} };
    window.addEventListener('pagehide', this._unload);
    window.addEventListener('beforeunload', this._unload);
  }

  async _readLoopSerial(port) {
    try {
      const dec = new TextDecoderStream();
      port.readable.pipeTo(dec.writable);
      const reader = dec.readable.getReader();
      this.reader = reader;
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          this._onLine(buf.slice(0, i).trim());
          buf = buf.slice(i + 1);
        }
      }
    } catch (e) {
      this._note(`lettura interrotta: ${e.message}`, 'error');
    }
  }

  _onLine(line) {
    if (!line) return;
    this.counters.received++;
    if (line.startsWith('ST ')) {
      const [, x, y, z, g] = line.split(/\s+/);
      this.deviceStatus = { x: +x, y: +y, z: +z, g: +g };
      this._emit('status', { status: this.deviceStatus });
    } else if (line.startsWith('ERR')) {
      this.counters.errors++;
      this._note(line, 'error');
    }
    this._emit('line', { line });
  }

  async disconnect() {
    this._stopDeadman();
    try { await this.sendRaw('S'); } catch {}
    if (this._unload) {
      window.removeEventListener('pagehide', this._unload);
      window.removeEventListener('beforeunload', this._unload);
    }
    try { this.writer?.releaseLock?.(); } catch {}
    try { await this.reader?.cancel?.(); } catch {}
    try { await this.port?.close?.(); } catch {}
    try { this.ws?.close?.(); } catch {}
    this.port = this.ws = this.writer = this.reader = null;
    this.state = LinkState.DISCONNECTED;
    this._emit('state', { state: this.state });
    this._note('disconnesso');
  }

  /* -------------------------------- Invio -------------------------------- */

  get connected() { return this.state === LinkState.CONNECTED; }

  async sendRaw(line) {
    if (!this.connected) return false;
    const data = line.endsWith('\n') ? line : line + '\n';
    if (this.transport === 'serial') await this.writer?.write(data);
    else this.ws?.send(data);
    this.counters.sent++;
    this.lastSendAt = performance.now();
    return true;
  }

  async send(line) {
    if (this.stopped && line !== 'S' && line !== '?') return false;
    return this.sendRaw(line);
  }

  /** Arresto immediato. Resta bloccato finché non viene sbloccato. */
  async emergencyStop() {
    this.stopped = true;
    this.counters.stops++;
    this._note('ARRESTO', 'stop');
    this._emit('stopped', { stopped: true });
    return this.sendRaw('S');
  }

  /* ══════════════════════════════════════════════════════════════════
   * MOUSE
   * ══════════════════════════════════════════════════════════════════
   *
   * Una pagina web NON può muovere il cursore del sistema: non esiste
   * alcuna interfaccia per farlo, e non esisterà, perché sarebbe la
   * fine della sicurezza del web.
   *
   * La via è un dispositivo che al computer si presenta come un mouse
   * vero. Aurora gli manda gli spostamenti, lui li esegue: il sistema
   * operativo vede un mouse e non sa che c'è di mezzo un programma.
   *
   * Funziona con qualunque cosa parli questo protocollo: un ESP32
   * configurato come mouse USB, una scheda più semplice, o un
   * programmino sul computer che riceve i comandi ed emula il mouse.
   * Non serve un dispositivo complesso — servono cinque comandi.
   *
   * ⚠️ Spostamenti RELATIVI, non assoluti: un mouse dice "di quanto mi
   * sono mosso", non "dove sono". È così che funziona un mouse vero, ed
   * è ciò che rende il dispositivo indipendente dalla risoluzione dello
   * schermo e dal numero di monitor.
   */

  /** Sposta il cursore. @param dx,dy in passi del mouse (interi) */
  async mouseMove(dx, dy) {
    if (!this.connected || this.stopped) return false;
    const M = this.cfg.device?.mouse || {};
    if (!M.enabled) return false;
    let x = Math.round(dx), y = Math.round(dy);
    if (M.invertX) x = -x;
    if (M.invertY) y = -y;
    if (x === 0 && y === 0) return false;
    // Tetto per passo: un salto del puntatore non deve diventare un
    // volo del cursore dall'altra parte dello schermo.
    const max = M.maxStep || 60;
    x = Math.max(-max, Math.min(max, x));
    y = Math.max(-max, Math.min(max, y));
    this.counters.mouseMoves = (this.counters.mouseMoves || 0) + 1;
    return this.send(`M ${x} ${y}`);
  }

  /** Clic. @param n 1 sinistro, 2 destro, 3 centrale */
  async mouseClick(n = 1) {
    if (!this.connected || this.stopped) return false;
    if (!this.cfg.device?.mouse?.enabled) return false;
    this.counters.mouseClicks = (this.counters.mouseClicks || 0) + 1;
    return this.send(`C ${Math.max(1, Math.min(3, n | 0))}`);
  }

  async mouseDoubleClick(n = 1) {
    if (!this.connected || this.stopped) return false;
    if (!this.cfg.device?.mouse?.enabled) return false;
    return this.send(`K ${Math.max(1, Math.min(3, n | 0))}`);
  }

  /** Tiene premuto o rilascia: serve al trascinamento. */
  async mouseHold(n = 1, giu = true) {
    if (!this.connected || this.stopped) return false;
    if (!this.cfg.device?.mouse?.enabled) return false;
    return this.send(`T ${Math.max(1, Math.min(3, n | 0))} ${giu ? 1 : 0}`);
  }

  /** Rotellina. @param n positivo verso l'alto */
  async mouseScroll(n = 1) {
    if (!this.connected || this.stopped) return false;
    if (!this.cfg.device?.mouse?.enabled) return false;
    const M = this.cfg.device.mouse;
    const v = Math.round(n * (M.scrollStep || 1));
    if (!v) return false;
    return this.send(`W ${M.invertScroll ? -v : v}`);
  }

  /**
   * Traduce una posizione del puntatore (0..1) in uno spostamento.
   *
   * Il puntatore dice DOVE guardare sullo schermo di Aurora; il mouse
   * vuole sapere DI QUANTO muoversi. Si tiene quindi l'ultima posizione
   * e si manda la differenza, moltiplicata per la sensibilità.
   */
  async mouseFromPointer(nx, ny) {
    const M = this.cfg.device?.mouse;
    if (!M?.enabled || !this.connected) return false;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
    if (!this._lastPtr) { this._lastPtr = { x: nx, y: ny }; return false; }
    const k = M.sensitivity || 900;
    const dx = (nx - this._lastPtr.x) * k;
    const dy = (ny - this._lastPtr.y) * k;
    // Zona morta: sotto un passo intero non si manda nulla, altrimenti
    // il tremore oculare diventerebbe un fruscio continuo del cursore.
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return false;
    this._lastPtr = { x: nx, y: ny };
    return this.mouseMove(dx, dy);
  }

  /** Riparte dalla posizione corrente: da chiamare quando si riattiva. */
  resetMouseOrigin() { this._lastPtr = null; }

  clearStop() {
    this.stopped = false;
    this._note('arresto rilasciato');
    this._emit('stopped', { stopped: false });
  }

  /**
   * Posizione assoluta con limiti di spazio e di velocità.
   * @param nx,ny frazioni 0..1 (tipicamente dal puntatore)
   */
  async moveTo(nx, ny, nz = null) {
    if (!this.connected || this.stopped) return false;
    const D = this.cfg.device;

    // Limiti di spazio: il braccio non deve poter uscire dal riquadro
    // considerato sicuro attorno alla persona.
    const cx = Math.min(D.limitXMax, Math.max(D.limitXMin, nx));
    const cy = Math.min(D.limitYMax, Math.max(D.limitYMin, ny));
    const cz = nz === null ? this.lastPos.z : Math.min(1, Math.max(0, nz));

    // Limite di velocità: un salto del puntatore non deve diventare uno
    // scatto del braccio. Si accorcia il passo, non si scarta il comando.
    const now = performance.now();
    const dt = Math.max(1, now - (this._lastMoveAt || now - 16)) / 1000;
    const maxStep = (D.maxSpeedPerSec || 0.35) * dt;
    const dx = cx - this.lastPos.x, dy = cy - this.lastPos.y;
    const dist = Math.hypot(dx, dy);
    let tx = cx, ty = cy;
    if (dist > maxStep) {
      const k = maxStep / dist;
      tx = this.lastPos.x + dx * k;
      ty = this.lastPos.y + dy * k;
      this.counters.throttled++;
    }
    this._lastMoveAt = now;

    // Frequenza di invio limitata: inondare la seriale a 60 Hz riempie
    // il buffer del dispositivo e introduce ritardo crescente.
    const minGap = 1000 / (D.updateHz || 20);
    if (now - (this._lastTxAt || 0) < minGap && dist < 0.25) return false;
    this._lastTxAt = now;

    this.lastPos = { x: tx, y: ty, z: cz };
    return this.send(`P ${tx.toFixed(3)} ${ty.toFixed(3)} ${cz.toFixed(3)}`);
  }

  async setGripper(pct) {
    if (!this.connected || this.stopped) return false;
    this.gripper = Math.max(0, Math.min(100, Math.round(pct)));
    return this.send(`G ${this.gripper}`);
  }

  async toggleGripper() {
    return this.setGripper(this.gripper > 50 ? 0 : 100);
  }

  async home() {
    if (!this.connected) return false;
    this.lastPos = { x: 0.5, y: 0.5, z: 0.5 };
    return this.send('H');
  }

  async digital(n, on) { return this.send(`B ${n} ${on ? 1 : 0}`); }

  /* ------------------------------ Uomo-morto ------------------------------ */

  /**
   * Se il browser smette di inviare comandi (scheda in background,
   * blocco, crash della pipeline video) il dispositivo deve fermarsi
   * da solo. Qui si invia un ARRESTO; il firmware dovrebbe anche
   * implementare un proprio timeout, perché se cade il collegamento
   * questo messaggio non arriverebbe affatto.
   */
  _startDeadman() {
    this._stopDeadman();
    const ms = this.cfg.device.deadmanMs || 0;
    if (!ms) return;
    this._deadman = setInterval(() => {
      if (!this.connected || this.stopped) return;
      if (performance.now() - this.lastSendAt > ms) {
        this._note('uomo-morto: nessun comando, invio arresto', 'stop');
        this.sendRaw('S').catch(() => {});
      }
    }, Math.max(200, ms / 2));
  }

  _stopDeadman() { if (this._deadman) { clearInterval(this._deadman); this._deadman = null; } }
}

/**
 * Firmware minimo di riferimento (Arduino / ESP32).
 * Mostrato nell'interfaccia perché chi costruisce il dispositivo abbia
 * un punto di partenza verificabile senza indovinare il protocollo.
 */
export const REFERENCE_FIRMWARE = `// Aurora — firmware minimo di riferimento
// Protocollo testuale, una riga per comando.
#include <Servo.h>
Servo sx, sy, sg;
unsigned long lastCmd = 0;
const unsigned long TIMEOUT = 1500;   // uomo-morto lato dispositivo
bool stopped = false;

void setup() {
  Serial.begin(115200);
  sx.attach(9); sy.attach(10); sg.attach(11);
  home();
}

void home() { sx.write(90); sy.write(90); sg.write(0); }

void loop() {
  // Sicurezza indipendente dal browser: se il collegamento cade,
  // questo timeout ferma comunque il braccio.
  if (millis() - lastCmd > TIMEOUT && !stopped) { stopped = true; home(); }

  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\\n');
  line.trim();
  if (!line.length()) return;
  lastCmd = millis();
  char c = line.charAt(0);

  if (c == 'S') { stopped = true; home(); Serial.println("OK"); }
  else if (c == 'H') { stopped = false; home(); Serial.println("OK"); }
  else if (c == '?') {
    Serial.print("ST "); Serial.print(sx.read()/180.0, 3); Serial.print(' ');
    Serial.print(sy.read()/180.0, 3); Serial.print(" 0.500 ");
    Serial.println(sg.read()*100/180);
  }
  else if (stopped) { Serial.println("ERR arresto attivo"); }
  else if (c == 'P') {
    float x, y, z;
    if (sscanf(line.c_str(), "P %f %f %f", &x, &y, &z) == 3) {
      sx.write(constrain(x, 0, 1) * 180);
      sy.write(constrain(y, 0, 1) * 180);
      Serial.println("OK");
    } else Serial.println("ERR sintassi");
  }
  else if (c == 'G') {
    int g; if (sscanf(line.c_str(), "G %d", &g) == 1) {
      sg.write(constrain(g, 0, 100) * 180 / 100); Serial.println("OK");
    } else Serial.println("ERR sintassi");
  }
  else Serial.println("ERR comando sconosciuto");
}`;
