/**
 * FrameSource.js — Astrazione della sorgente video.
 *
 * Tre implementazioni dietro la stessa interfaccia:
 *   - CameraSource : getUserMedia. Funziona su PC con camere interne ed
 *                    esterne USB; su Android solo con le camere interne.
 *   - BridgeSource : WebSocket verso una shell nativa che espone una
 *                    camera UVC/OTG/WiFi su 127.0.0.1. È la via per usare
 *                    camere esterne su Android.
 *   - FileSource   : video registrato. Serve per il replay e la
 *                    regressione: si tara un filtro sulle stesse
 *                    registrazioni, non su ciò che capita davanti.
 *
 * NOTA SUL BRIDGE: frame grezzi Y8, non MJPEG. Il JPEG introduce
 * artefatti di compressione proprio sui bordi — che è esattamente ciò
 * che dobbiamo misurare — e costa CPU per la decodifica. Su loopback la
 * banda è irrilevante: 640×400 grayscale a 60 fps sono ~15 MB/s.
 */


/**
 * Attacca l'elemento video alla pagina, invisibile ma PRESENTE.
 *
 * ⚠️ Un elemento video che non sta nel documento viene decodificato
 * "per cortesia": dopo qualche decina di secondi il browser smette di
 * spenderci lavoro e i fotogrammi finiscono. Nessun errore, nessun
 * avviso — semplicemente non arriva più niente, ed è esattamente il
 * blocco che si vede dopo un minuto e mezzo di riproduzione.
 *
 * ⚠️ E NON si può usare `display:none` né `visibility:hidden`: per il
 * browser significano "non serve disegnarlo", e la decodifica si ferma
 * lo stesso. L'elemento deve risultare visibile pur non vedendosi: un
 * pixel trasparente fuori dallo schermo.
 */
function collegaAllaPagina(video) {
  try {
    video.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.001;'
      + 'pointer-events:none;z-index:-1';
    video.setAttribute('aria-hidden', 'true');
    document.body.appendChild(video);
  } catch { /* senza documento si prosegue: il ciclo funziona comunque */ }
}

/** Toglie l'elemento dalla pagina e libera le risorse. */
function scollegaDallaPagina(video) {
  try {
    video.pause?.();
    if (video.src?.startsWith('blob:')) URL.revokeObjectURL(video.src);
    video.removeAttribute('src');
    video.load?.();
    video.remove?.();
  } catch {}
}

export class FrameSource {
  constructor() { this.onFrame = null; this.running = false; this.info = {}; }
  async open() { throw new Error('non implementato'); }
  async close() {}
  get isOpen() { return this.running; }
}

/* --------------------------- getUserMedia --------------------------- */

/**
 * Pompa dei fotogrammi guidata dalla TELECAMERA, non dallo schermo.
 *
 * ⚠️ Il ciclo normale usa `requestAnimationFrame`, che si ferma del
 * tutto quando la finestra va in secondo piano: il riconoscimento si
 * spegne e chi sta usando il computer perde il controllo.
 *
 * Questa interfaccia consegna i fotogrammi man mano che la telecamera
 * li produce, quindi continua a funzionare anche a finestra nascosta.
 * Non è disponibile ovunque, ed è per questo che resta una scelta: se
 * manca, si torna al ciclo di sempre senza che nulla cambi.
 */
export function pompaFotogrammiSupportata() {
  return typeof globalThis !== 'undefined' && 'MediaStreamTrackProcessor' in globalThis;
}

export class CameraSource extends FrameSource {
  constructor(cfg) { super(); this.cfg = cfg; this.stream = null; this.video = null; this.raf = 0; }

  static async listDevices() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter(d => d.kind === 'videoinput')
                 .map(d => ({ id: d.deviceId, label: d.label || 'Camera' }));
    } catch { return []; }
  }

  async open() {
    const s = this.cfg.source;
    const constraints = {
      audio: false,
      video: {
        width: { ideal: s.width }, height: { ideal: s.height },
        frameRate: { ideal: s.fps },
        ...(s.deviceId ? { deviceId: { exact: s.deviceId } } : { facingMode: 'user' }),
      },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    collegaAllaPagina(this.video);
    this.video.srcObject = this.stream;
    await this.video.play();

    const track = this.stream.getVideoTracks()[0];
    this.track = track;
    const st = track.getSettings();
    this.info = {
      kind: 'camera', label: track.label,
      width: st.width || s.width, height: st.height || s.height, fps: st.frameRate || s.fps,
    };
    this.running = true;
    this._loop();
    return this.info;
  }

  _loop() {
    /* ── Due modi di scandire i fotogrammi ──
     *
     * Quello di sempre segue il disegno dello schermo: semplice,
     * collaudato, e si ferma quando la finestra va in secondo piano.
     * Per chi sta davanti allo schermo — come chi usa la scansione — è
     * esattamente ciò che serve, e resta il predefinito.
     *
     * L'altro segue la TELECAMERA: continua anche a finestra nascosta,
     * e serve a chi comanda il cursore con gli occhi e vuole usare
     * altre applicazioni. Si accende solo se richiesto, e se il
     * browser non lo sostiene si ricade sul primo senza dire nulla.
     */
    const vuoleSfondo = !!this.cfg?.source?.backgroundMode;
    if (vuoleSfondo && pompaFotogrammiSupportata() && this.track) {
      if (this._loopTelecamera()) return;
    }
    this._loopSchermo();
  }

  _loopSchermo() {
    const step = () => {
      if (!this.running) return;
      // ⚠️ Riarmo in `finally`: un errore su un fotogramma non deve
      // poter spegnere la telecamera per sempre. Per chi usa Aurora
      // questo significherebbe restare senza voce senza sapere perché.
      try {
        // Il timestamp è quello di CATTURA, non di elaborazione: se il
        // telefono scalda e il worker rallenta, il timing dei gesti non
        // deve slittare.
        if (this.video.readyState >= 2) this.onFrame?.(this.video, performance.now(), this.info);
      } catch (e) {
        this.errori = (this.errori || 0) + 1;
        this.ultimoErrore = e?.message || String(e);
        if (this.errori === 1 || this.errori % 100 === 0) {
          console.error(`[camera] errore nel fotogramma (${this.errori}):`, e);
        }
      } finally {
        this.raf = requestAnimationFrame(step);
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  /**
   * @returns true se è riuscito ad avviarsi. In caso contrario il
   *          chiamante ricade sul ciclo di sempre: meglio funzionare
   *          come prima che non funzionare affatto.
   */
  _loopTelecamera() {
    try {
      const proc = new globalThis.MediaStreamTrackProcessor({ track: this.track });
      const reader = proc.readable.getReader();
      this._reader = reader;
      this.modoSfondo = true;
      (async () => {
        while (this.running) {
          let frame;
          try { const r = await reader.read(); if (r.done) break; frame = r.value; }
          catch { break; }
          try {
            /* ⚠️ NON si passa l'elemento video.
             *
             * A finestra nascosta il browser smette di aggiornare la
             * superficie di disegno di un <video>: il rilevatore
             * leggerebbe sempre lo STESSO fotogramma, e il segnale
             * risulterebbe piatto — un guasto silenzioso, peggiore di
             * un blocco, perché sembrerebbe che la persona non si
             * muova mai.
             *
             * Il fotogramma va quindi disegnato a mano su una tela, che
             * è aggiornata davvero e che il rilevatore sa leggere. */
            if (!this._tela) {
              this._tela = document.createElement('canvas');
              this._ctx = this._tela.getContext('2d', { willReadFrequently: false });
            }
            const w = frame.displayWidth || frame.codedWidth;
            const h = frame.displayHeight || frame.codedHeight;
            if (w && h) {
              if (this._tela.width !== w) this._tela.width = w;
              if (this._tela.height !== h) this._tela.height = h;
              this._ctx.drawImage(frame, 0, 0, w, h);
              this.onFrame?.(this._tela, performance.now(), this.info);
            }
          } finally {
            // ⚠️ Un fotogramma non chiuso blocca la telecamera dopo
            // pochi secondi: va rilasciato SEMPRE.
            try { frame?.close(); } catch {}
          }
        }
        try { reader.releaseLock(); } catch {}
      })();
      return true;
    } catch {
      this.modoSfondo = false;
      return false;
    }
  }

  async close() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach(t => t.stop());
    // L'elemento va tolto dalla pagina: lasciarlo lì significherebbe
    // accumularne uno a ogni riavvio della telecamera.
    if (this.video) scollegaDallaPagina(this.video);
    this.stream = null; this.video = null;
  }
}

/* ------------------------- Bridge nativo (WS) ------------------------ */

/**
 * Protocollo minimo, deliberatamente semplice:
 *   testo  → JSON di controllo/handshake { type:'info', width, height, fps }
 *   binario→ header 16 byte + payload
 *            u32 magic 0x41555230 ('AUR0') | u16 w | u16 h | u8 fmt | u8 res
 *            f64 timestamp (ms, orologio del dispositivo)
 *            fmt: 0 = GRAY8, 1 = RGBA8
 */
export class BridgeSource extends FrameSource {
  constructor(cfg) { super(); this.cfg = cfg; this.ws = null; this.canvas = null; this.ctx2d = null; }

  async open() {
    return new Promise((resolve, reject) => {
      const url = this.cfg.source.bridgeUrl;
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';
      const to = setTimeout(() => reject(new Error(`Bridge non raggiungibile: ${url}`)), 4000);

      this.ws.onopen = () => {
        clearTimeout(to);
        this.running = true;
        this.info = { kind: 'bridge', label: url, width: this.cfg.source.width, height: this.cfg.source.height };
        this.ws.send(JSON.stringify({
          type: 'start',
          width: this.cfg.source.width, height: this.cfg.source.height, fps: this.cfg.source.fps,
          format: 'gray8',
        }));
        resolve(this.info);
      };
      this.ws.onerror = () => { clearTimeout(to); reject(new Error(`Errore WebSocket: ${url}`)); };
      this.ws.onclose = () => { this.running = false; };
      this.ws.onmessage = (ev) => this._onMessage(ev);
    });
  }

  _onMessage(ev) {
    if (typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'info') this.info = { ...this.info, ...msg };
      } catch {}
      return;
    }
    const buf = ev.data;
    if (buf.byteLength < 16) return;
    const dv = new DataView(buf);
    if (dv.getUint32(0, false) !== 0x41555230) return;
    const w = dv.getUint16(4, true), h = dv.getUint16(6, true);
    const fmt = dv.getUint8(8);
    const ts = dv.getFloat64(16 - 8, true);
    const payload = new Uint8Array(buf, 16);

    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = w; this.canvas.height = h;
      this.ctx2d = this.canvas.getContext('2d', { willReadFrequently: true });
      this.info = { ...this.info, width: w, height: h };
    }
    const img = this.ctx2d.createImageData(w, h);
    if (fmt === 0) {
      for (let i = 0, j = 0; i < payload.length; i++, j += 4) {
        img.data[j] = img.data[j + 1] = img.data[j + 2] = payload[i];
        img.data[j + 3] = 255;
      }
    } else {
      img.data.set(payload.subarray(0, img.data.length));
    }
    this.ctx2d.putImageData(img, 0, 0);
    this.onFrame?.(this.canvas, ts || performance.now(), this.info);
  }

  async close() { this.running = false; try { this.ws?.close(); } catch {} this.ws = null; }
}

/* ------------------------------- File ------------------------------- */

/**
 * Sorgente da file video registrato.
 *
 * Serve a tarare il programma su una ripresa fatta altrove — la
 * persona è a chilometri di distanza, e due minuti di video sono tutto
 * ciò su cui si può lavorare. Per questo servono i comandi: lo stesso
 * istante va rivisto molte volte, cambiando un parametro alla volta e
 * guardando cosa succede.
 */
export class FileSource extends FrameSource {
  constructor(file) { super(); this.file = file; this.video = null; this.raf = 0; }

  /* ── Comandi di riproduzione ──
   * Tutti tolleranti a un video non ancora pronto: chi preme un
   * pulsante mentre il file sta caricando non deve vedere un errore. */
  play() { this.video?.play?.().catch(() => {}); }
  pause() { try { this.video?.pause(); } catch {} }
  togglePlay() { if (!this.video) return; this.video.paused ? this.play() : this.pause(); }
  get inPausa() { return !this.video || this.video.paused; }

  /** Salta avanti o indietro di N secondi, restando dentro il video. */
  salta(sec) {
    const v = this.video;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 0.05, v.currentTime + sec));
  }

  /** Torna all'inizio. Non ferma la riproduzione: si rivede subito. */
  riavvolgi() { if (this.video) this.video.currentTime = 0; }

  /** Posiziona a una frazione della durata (0..1), per la barra. */
  vaiA(frazione) {
    const v = this.video;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(1, frazione)) * v.duration;
  }

  setVelocita(x) { if (this.video) this.video.playbackRate = Math.max(0.1, Math.min(4, x)); }
  get velocita() { return this.video?.playbackRate ?? 1; }

  setLoop(on) { if (this.video) this.video.loop = !!on; }
  get loop() { return !!this.video?.loop; }

  /** Stato per l'interfaccia: posizione, durata, avanzamento. */
  get stato() {
    const v = this.video;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) {
      return { pronta: false, t: 0, durata: 0, frazione: 0, inPausa: true, loop: true, velocita: 1 };
    }
    return {
      pronta: true, t: v.currentTime, durata: v.duration,
      frazione: v.currentTime / v.duration,
      inPausa: v.paused, loop: !!v.loop, velocita: v.playbackRate,
    };
  }
  async open() {
    this.video = document.createElement('video');
    this.video.src = URL.createObjectURL(this.file);
    this.video.loop = true; this.video.muted = true; this.video.playsInline = true;
    this.video.preload = 'auto';
    collegaAllaPagina(this.video);

    /* ══════════════════════════════════════════════════════════════════
     * SORVEGLIANZA DEL VIDEO
     * ══════════════════════════════════════════════════════════════════
     *
     * ⚠️ Un video da file può fermarsi per ragioni che non si possono
     * prevedere: la fine del filmato con il ciclo continuo che non
     * riparte, un blocco nella decodifica, il browser che sospende
     * l'elemento. Il sintomo è sempre lo stesso — i fotogrammi si
     * fermano mentre il resto del programma continua, e il grafico
     * mostra all'infinito lo stesso istante.
     *
     * Invece di indovinare la causa, si sorveglia l'effetto: se il
     * tempo del video non avanza mentre dovrebbe, si rimette in moto.
     * È lo stesso principio adottato per la telecamera.
     */
    this.bloccati = 0;
    this.riprese = 0;
    this._tContenuto = -1;
    this._fermoDa = 0;

    /* ⚠️ Registro degli eventi del video.
     *
     * Il blocco a un minuto e un quarto non si spiega con nulla di ciò
     * che abbiamo esaminato finora. Questi eventi dicono ESATTAMENTE
     * cosa fa l'elemento video nell'istante in cui si ferma: se
     * esaurisce i dati, se va in pausa, se il browser lo sospende, se
     * la decodifica fallisce. Uno di questi scatterà, e allora
     * sapremo. */
    for (const ev of ['stalled', 'waiting', 'suspend', 'abort', 'emptied',
                      'pause', 'ended', 'error', 'ratechange', 'seeking']) {
      this.video.addEventListener(ev, () => {
        const v = this.video;
        this.eventi = (this.eventi || []);
        const riga = `${ev} @ t=${v?.currentTime?.toFixed(2)}s rs=${v?.readyState} net=${v?.networkState}`;
        this.eventi.push(riga);
        if (this.eventi.length > 40) this.eventi.shift();
        this.ultimoEvento = riga;
        /* ⚠️ Gli eventi che possono FERMARE la riproduzione si scrivono
         * sempre, anche a registro spento: sono rari e sono l'unica
         * traccia di un blocco. Gli altri solo su richiesta. */
        const critico = ['suspend', 'stalled', 'error', 'abort', 'emptied', 'pause', 'ended'].includes(ev);
        if (critico) console.warn('[aurora/video]', riga);
        else if (this.registra) console.log('[aurora/video]', riga);
      });
    }

    this.video.addEventListener('ended', () => {
      // Con il ciclo continuo non dovrebbe mai accadere: se accade, si
      // riparte a mano invece di restare fermi per sempre.
      if (this.video && this.loop) {
        try { this.video.currentTime = 0; this.video.play().catch(() => {}); this.riprese++; } catch {}
      }
    });
    this.video.addEventListener('error', () => {
      this.ultimoErrore = 'errore di decodifica del video';
    });

    await this.video.play();
    this.info = { kind: 'file', label: this.file.name, width: this.video.videoWidth, height: this.video.videoHeight };
    this.running = true;
    const step = () => {
      if (!this.running) return;
      /* ⚠️ Il riarmo del ciclo sta in `finally`, e non è un dettaglio.
       *
       * Prima era l'ultima riga: se l'elaborazione di un fotogramma
       * sollevava un errore anche UNA sola volta, quella riga non
       * veniva mai raggiunta e il ciclo moriva per sempre. Il video
       * continuava a scorrere, ma nessuno guardava più i fotogrammi —
       * e sembrava che il programma si fosse piantato.
       *
       * Lo stesso principio era già applicato nel ciclo principale.
       * Qui era rimasto indietro. */
      try {
        const v = this.video;
        const ora = performance.now();

        /* ── Rilevamento del blocco ──
         * Se il video risulta in riproduzione ma il suo tempo non
         * avanza, è fermo davvero. Si dà un colpetto: prima si prova a
         * riprendere, poi si sposta di un istante, che sblocca una
         * decodifica impantanata. */
        if (!v.paused && !v.ended) {
          // Anche readyState basso è un blocco: il video "va" ma non ha
          // fotogrammi da mostrare.
          if (v.currentTime === this._tContenuto || v.readyState < 2) {
            if (!this._fermoDa) this._fermoDa = ora;
            else {
              const fermoDa = ora - this._fermoDa;
              /* ⚠️ Due tentativi, in ordine crescente di invadenza, e
               * con una pausa fra l'uno e l'altro.
               *
               * Spostare il tempo del video provoca un riposizionamento,
               * durante il quale il video risulta di nuovo fermo. Senza
               * pausa fra un tentativo e il successivo si innescherebbe
               * una catena di riposizionamenti che bloccherebbe il video
               * DAVVERO — la cura peggiore del male.
               */
              if (fermoDa > 1500 && ora - (this._ultimoTentativo || 0) > 3000) {
                this._ultimoTentativo = ora;
                this.bloccati++;
                {
                  console.warn(`[aurora/video] FERMO da ${(fermoDa / 1000).toFixed(1)}s`
                    + ` — t=${v.currentTime.toFixed(2)}s rs=${v.readyState}`
                    + ` net=${v.networkState} paused=${v.paused} ended=${v.ended}`
                    + ` buffered=${v.buffered?.length ? v.buffered.end(v.buffered.length - 1).toFixed(1) + 's' : 'nulla'}`
                    + ` — tentativo: ${this._giaProvato ? 'salto' : 'riprendi'}`);
                }
                try {
                  if (!this._giaProvato) {
                    // Primo tentativo: solo riprendere. Non invasivo.
                    this._giaProvato = true;
                    v.play().catch(() => {});
                  } else if (Number.isFinite(v.duration) && v.duration > 0) {
                    // Secondo: un salto minimo, impercettibile, che
                    // sblocca una decodifica impantanata.
                    this._giaProvato = false;
                    v.currentTime = (v.currentTime + 0.05) % v.duration;
                    this.riprese++;
                  }
                } catch {}
              }
            }
          } else {
            this._tContenuto = v.currentTime;
            this._fermoDa = 0;
            this._giaProvato = false;
          }
        }

        // In pausa non si emettono fotogrammi: analizzare cento volte
        // lo stesso fermo immagine sporcherebbe le statistiche con
        // dati che non descrivono nulla di nuovo.
        if (!v.paused && v.readyState >= 2) this.onFrame?.(v, ora, this.info);
      } catch (e) {
        this.errori = (this.errori || 0) + 1;
        this.ultimoErrore = e?.message || String(e);
        // Si segnala una volta ogni cento, per non riempire il registro
        // ma senza nascondere che qualcosa non va.
        if (this.errori === 1 || this.errori % 100 === 0) {
          console.error(`[video] errore nel fotogramma (${this.errori}):`, e);
        }
      } finally {
        this.raf = requestAnimationFrame(step);
      }
    };
    this.raf = requestAnimationFrame(step);
    return this.info;
  }
  async close() {
    this.running = false;
    try { this._reader?.cancel(); } catch {}
    this._reader = null;
    cancelAnimationFrame(this.raf);
    // Si toglie dalla pagina e si libera l'indirizzo del file: senza,
    // caricando più video di seguito la memoria cresce a ogni volta.
    if (this.video) scollegaDallaPagina(this.video);
    this.video = null;
  }
}

export function createSource(cfg, file = null) {
  if (file) return new FileSource(file);
  switch (cfg.source.mode) {
    case 'bridge': return new BridgeSource(cfg);
    default: return new CameraSource(cfg);
  }
}
