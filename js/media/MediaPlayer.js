/**
 * MediaPlayer.js — Visione di contenuti: video, PDF, immagini, testo.
 *
 * ══════════════════════════════════════════════════════════════════
 * IL PRINCIPIO DI PROGETTO
 * ══════════════════════════════════════════════════════════════════
 *
 * Ogni sorgente espone lo STESSO piccolo insieme di comandi. Il livello
 * superiore non sa se sta guidando un video o un PDF: sa solo che
 * esistono "avanti", "indietro", "pausa", "più", "meno", "esci".
 *
 * Questo conta perché quei comandi diventano automaticamente un ramo
 * dell'albero di scansione: chi ha un solo gesto guida un video di
 * YouTube esattamente come compone una parola. Senza questa
 * uniformità servirebbe un menu diverso per ogni tipo di contenuto, e
 * ognuno andrebbe imparato a memoria.
 *
 * ══════════════════════════════════════════════════════════════════
 * LIMITE DA CONOSCERE
 * ══════════════════════════════════════════════════════════════════
 *
 * I siti web arbitrari NON sono incorporabili: quasi tutti inviano
 * X-Frame-Options o Content-Security-Policy che vietano l'iframe. È
 * una protezione dei siti stessi, non una limitazione aggirabile.
 *
 * Funzionano invece: YouTube (che espone un player incorporabile e
 * un'API di controllo), i PDF (resi localmente con pdf.js), le
 * immagini e i testi da file. La navigazione web completa richiede la
 * shell nativa con una WebView, oppure un'estensione del browser.
 */

/* Librerie INCLUSE nel programma, non scaricate da una rete esterna:
 * aprire un documento non deve dipendere dalla raggiungibilità di un
 * server altrui. */
const PDFJS_LOCAL = './vendor/pdfjs';
const MAMMOTH_LOCAL = './vendor/mammoth/mammoth.browser.min.js';

/** Comandi uniformi, indipendenti dal tipo di contenuto. */
export const MediaCommand = {
  PLAY_PAUSE: 'playPause',
  FORWARD: 'forward',
  BACK: 'back',
  NEXT: 'next',
  PREV: 'prev',
  VOL_UP: 'volUp',
  VOL_DOWN: 'volDown',
  ZOOM_IN: 'zoomIn',
  ZOOM_OUT: 'zoomOut',
  SCROLL_DOWN: 'scrollDown',
  SCROLL_UP: 'scrollUp',
  READ_ALOUD: 'readAloud',
  EXIT: 'exit',
};

/**
 * Comandi disponibili per tipo, nell'ordine in cui devono comparire
 * nella scansione: i più usati per primi, perché la posizione è il costo.
 */
export const COMMANDS_BY_KIND = {
  // File audio e video locali: stessi comandi, stesso elemento HTML.
  audio: [
    { id: MediaCommand.PLAY_PAUSE, label: 'PAUSA / RIPRENDI', spoken: 'pausa o riprendi' },
    { id: MediaCommand.FORWARD,    label: '⏩ avanti 15 s',    spoken: 'avanti' },
    { id: MediaCommand.BACK,       label: '⏪ indietro 15 s',  spoken: 'indietro quindici' },
    { id: MediaCommand.VOL_UP,     label: '🔊 più volume',     spoken: 'più volume' },
    { id: MediaCommand.VOL_DOWN,   label: '🔉 meno volume',    spoken: 'meno volume' },
    { id: MediaCommand.NEXT,       label: 'SUCCESSIVO',        spoken: 'successivo' },
    { id: MediaCommand.PREV,       label: 'PRECEDENTE',        spoken: 'precedente' },
    { id: MediaCommand.EXIT,       label: 'CHIUDI',            spoken: 'chiudi' },
  ],
  youtube: [
    { id: MediaCommand.PLAY_PAUSE, label: 'PAUSA / RIPRENDI', spoken: 'pausa o riprendi' },
    { id: MediaCommand.FORWARD,    label: '⏩ avanti 15 s',    spoken: 'avanti quindici secondi' },
    { id: MediaCommand.BACK,       label: '⏪ indietro 15 s',  spoken: 'indietro quindici secondi' },
    { id: MediaCommand.VOL_UP,     label: '🔊 più volume',     spoken: 'più volume' },
    { id: MediaCommand.VOL_DOWN,   label: '🔉 meno volume',    spoken: 'meno volume' },
    { id: MediaCommand.NEXT,       label: 'VIDEO SUCCESSIVO',  spoken: 'video successivo' },
    { id: MediaCommand.EXIT,       label: 'CHIUDI',            spoken: 'chiudi' },
  ],
  pdf: [
    { id: MediaCommand.NEXT,       label: 'PAGINA AVANTI',  spoken: 'pagina avanti' },
    { id: MediaCommand.PREV,       label: 'PAGINA INDIETRO',spoken: 'pagina indietro' },
    { id: MediaCommand.SCROLL_DOWN,label: '↓ scorri giù',   spoken: 'scorri giù' },
    { id: MediaCommand.SCROLL_UP,  label: '↑ scorri su',    spoken: 'scorri su' },
    { id: MediaCommand.ZOOM_IN,    label: '➕ ingrandisci', spoken: 'ingrandisci' },
    { id: MediaCommand.ZOOM_OUT,   label: '➖ rimpicciolisci', spoken: 'rimpicciolisci' },
    { id: MediaCommand.EXIT,       label: 'CHIUDI',         spoken: 'chiudi' },
  ],
  text: [
    { id: MediaCommand.SCROLL_DOWN,label: '↓ avanti',       spoken: 'avanti' },
    { id: MediaCommand.SCROLL_UP,  label: '↑ indietro',     spoken: 'indietro' },
    { id: MediaCommand.READ_ALOUD, label: '🔊 LEGGI AD ALTA VOCE', spoken: 'leggi ad alta voce' },
    { id: MediaCommand.ZOOM_IN,    label: '➕ ingrandisci', spoken: 'ingrandisci' },
    { id: MediaCommand.ZOOM_OUT,   label: '➖ rimpicciolisci', spoken: 'rimpicciolisci' },
    { id: MediaCommand.EXIT,       label: 'CHIUDI',         spoken: 'chiudi' },
  ],
  image: [
    { id: MediaCommand.NEXT,       label: 'IMMAGINE SUCCESSIVA', spoken: 'immagine successiva' },
    { id: MediaCommand.PREV,       label: 'IMMAGINE PRECEDENTE', spoken: 'immagine precedente' },
    { id: MediaCommand.ZOOM_IN,    label: '➕ ingrandisci', spoken: 'ingrandisci' },
    { id: MediaCommand.ZOOM_OUT,   label: '➖ rimpicciolisci', spoken: 'rimpicciolisci' },
    { id: MediaCommand.EXIT,       label: 'CHIUDI',         spoken: 'chiudi' },
  ],
};

/** Estrae l'identificativo di un video da qualunque forma di link YouTube. */
export function youtubeId(url) {
  if (!url) return null;
  const s = String(url).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export class MediaPlayer {
  constructor(cfg, onEvent) {
    this.cfg = cfg;
    this.onEvent = onEvent;
    this.kind = null;           // youtube | pdf | text | image | null
    this.container = null;
    this.yt = null;             // player YouTube
    this.ytReady = false;
    this.pdf = null;
    this.page = 1;
    this.pages = 1;
    this.zoom = 1;
    this.images = [];
    this.imageIndex = 0;
    this.playlist = [];
    this.playlistIndex = 0;
    this.textEl = null;
    this.el = null;
    this.videoMode = false;
    this.reading = false;
  }

  updateConfig(cfg) { this.cfg = cfg; }
  get active() { return this.kind !== null; }

  attach(container) { this.container = container; }

  /** Comandi correnti, che il motore di scansione trasforma in un menu. */
  commands() {
    if (!this.kind) return [];
    return COMMANDS_BY_KIND[this.kind] || [];
  }

  _emit(type, data = {}) { this.onEvent?.({ type, kind: this.kind, ...data }); }

  /* ------------------------------ YouTube ------------------------------ */

  async openYouTube(idOrUrl, playlist = null) {
    const id = youtubeId(idOrUrl);
    if (!id) throw new Error('Link YouTube non riconosciuto');
    this.close(false);
    this.kind = 'youtube';
    this.playlist = playlist || [id];
    this.playlistIndex = Math.max(0, this.playlist.findIndex(v => youtubeId(v) === id));

    await this._loadYouTubeApi();
    this.container.innerHTML = '<div id="ytHost"></div>';
    this.yt = new window.YT.Player('ytHost', {
      videoId: id,
      playerVars: {
        rel: 0, modestbranding: 1, playsinline: 1,
        // I comandi nativi restano disponibili per chi assiste, ma la
        // guida vera passa dai comandi in scansione.
        controls: 1, iv_load_policy: 3,
      },
      events: {
        onReady: () => { this.ytReady = true; this._emit('ready'); },
        onStateChange: (e) => {
          this._emit('state', { playing: e.data === 1 });
          // Fine video: passa al successivo, così una lista si guarda
          // senza dover intervenire a ogni brano.
          if (e.data === 0 && this.playlist.length > 1) this.command(MediaCommand.NEXT);
        },
        onError: () => this._emit('error', { message: 'Video non disponibile o non incorporabile' }),
      },
    });
    this._emit('opened', { title: id });
  }

  _loadYouTubeApi() {
    if (window.YT?.Player) return Promise.resolve();
    if (this._ytPromise) return this._ytPromise;
    this._ytPromise = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => rej(new Error('API YouTube non raggiungibile: serve connessione'));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error('API YouTube non caricata')), 12000);
    });
    return this._ytPromise;
  }

  /* -------------------------------- PDF -------------------------------- */

  async openPdf(file) {
    const lib = await this._loadPdfJs();
    this.close(false);
    this.kind = 'pdf';
    const buf = await file.arrayBuffer();
    this.pdf = await lib.getDocument({ data: buf }).promise;
    this.pages = this.pdf.numPages;
    this.page = 1;
    this.zoom = 1;
    this.container.innerHTML = '<canvas id="pdfCanvas" class="media-canvas"></canvas>';
    await this._renderPdf();
    this._emit('opened', { title: file.name, pages: this.pages });
  }

  async _loadPdfJs() {
    if (this._pdfLib) return this._pdfLib;
    const base = new URL(PDFJS_LOCAL, document.baseURI).href;
    const mod = await import(/* @vite-ignore */ `${base}/pdf.min.mjs`);
    mod.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.min.mjs`;
    this._pdfLib = mod;
    return mod;
  }

  async _renderPdf() {
    if (!this.pdf) return;
    const page = await this.pdf.getPage(this.page);
    const canvas = document.getElementById('pdfCanvas');
    if (!canvas) return;
    const avail = this.container.clientWidth || 900;
    const base = page.getViewport({ scale: 1 });
    // Adatta alla larghezza disponibile, poi applica lo zoom scelto:
    // così "ingrandisci" parte sempre da una pagina già leggibile.
    const scale = (avail / base.width) * this.zoom;
    const vp = page.getViewport({ scale });
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    this._emit('page', { page: this.page, pages: this.pages });
  }

  /* ------------------------------- Testo ------------------------------- */

  async openText(file) {
    this.close(false);
    this.kind = 'text';
    let html = '';
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.docx')) {
      const mammoth = await this._loadMammoth();
      const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      html = r.value;
    } else {
      const txt = await file.text();
      html = txt.split(/\n{2,}/).map(p =>
        `<p>${p.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])).replace(/\n/g, '<br>')}</p>`
      ).join('');
    }
    this.container.innerHTML = `<div class="media-text" id="mediaText">${html}</div>`;
    this.textEl = document.getElementById('mediaText');
    this.zoom = 1;
    this._applyTextZoom();
    this._emit('opened', { title: file.name });
  }

  async _loadMammoth() {
    if (window.mammoth) return window.mammoth;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL(MAMMOTH_LOCAL, document.baseURI).href; s.onload = res;
      s.onerror = () => rej(new Error('Lettore .docx non raggiungibile: serve connessione'));
      document.head.appendChild(s);
    });
    return window.mammoth;
  }

  _applyTextZoom() {
    if (this.textEl) this.textEl.style.fontSize = `${(1.25 * this.zoom).toFixed(2)}rem`;
  }

  /* --------------------- Audio e video locali --------------------- */

  /**
   * File audio o video caricati dall'assistente.
   * Usano lo stesso elemento HTML: cambia solo se ha una parte visiva.
   * @param files array di File
   * @param index quale far partire
   */
  async openMediaFiles(files, index = 0, video = false) {
    this.close(false);
    this.kind = 'audio';
    this.playlist = [...files].map(f => ({ url: URL.createObjectURL(f), name: f.name }));
    this.playlistIndex = Math.max(0, Math.min(index, this.playlist.length - 1));
    const tag = video ? 'video' : 'audio';
    this.container.innerHTML =
      `<${tag} id="mediaEl" class="media-el" controls playsinline></${tag}>`
      + `<div class="media-nowplaying" id="mediaNow"></div>`;
    this.el = document.getElementById('mediaEl');
    this.videoMode = video;
    this.el.addEventListener('ended', () => {
      if (this.playlist.length > 1) this.command(MediaCommand.NEXT);
    });
    this._caricaTraccia();
    this._emit('opened', { title: this.playlist[this.playlistIndex]?.name, pages: this.playlist.length });
  }

  _caricaTraccia() {
    const it = this.playlist[this.playlistIndex];
    if (!it || !this.el) return;
    this.el.src = it.url;
    this.el.play().catch(() => {});
    const now = document.getElementById('mediaNow');
    if (now) now.textContent = it.name;
    this._emit('page', { page: this.playlistIndex + 1, pages: this.playlist.length, title: it.name });
  }

  /* ------------------------------ Immagini ----------------------------- */

  async openImages(files) {
    this.close(false);
    this.kind = 'image';
    this.images = [...files].map(f => ({ url: URL.createObjectURL(f), name: f.name }));
    this.imageIndex = 0;
    this.zoom = 1;
    this.container.innerHTML = '<img class="media-image" id="mediaImg" alt="">';
    this._showImage();
    this._emit('opened', { title: this.images[0]?.name, pages: this.images.length });
  }

  _showImage() {
    const el = document.getElementById('mediaImg');
    if (!el || !this.images.length) return;
    const it = this.images[this.imageIndex];
    el.src = it.url;
    el.style.transform = `scale(${this.zoom})`;
    this._emit('page', { page: this.imageIndex + 1, pages: this.images.length, title: it.name });
  }

  /* ------------------------------ Comandi ------------------------------ */

  /** Punto d'ingresso unico: gesto, click e pulsante passano tutti da qui. */
  async command(id) {
    const step = this.cfg.media.seekSeconds || 15;
    switch (id) {
      case MediaCommand.PLAY_PAUSE:
        if (this.kind === 'youtube' && this.ytReady) {
          const st = this.yt.getPlayerState();
          if (st === 1) this.yt.pauseVideo(); else this.yt.playVideo();
        } else if (this.el) { this.el.paused ? this.el.play().catch(()=>{}) : this.el.pause(); }
        break;
      case MediaCommand.FORWARD:
        if (this.kind === 'youtube' && this.ytReady) this.yt.seekTo(this.yt.getCurrentTime() + step, true);
        else if (this.el) this.el.currentTime = Math.min(this.el.duration || 1e9, this.el.currentTime + step);
        break;
      case MediaCommand.BACK:
        if (this.kind === 'youtube' && this.ytReady) this.yt.seekTo(Math.max(0, this.yt.getCurrentTime() - step), true);
        else if (this.el) this.el.currentTime = Math.max(0, this.el.currentTime - step);
        break;
      case MediaCommand.VOL_UP:
        if (this.kind === 'youtube' && this.ytReady) this.yt.setVolume(Math.min(100, this.yt.getVolume() + 15));
        else if (this.el) this.el.volume = Math.min(1, this.el.volume + 0.15);
        break;
      case MediaCommand.VOL_DOWN:
        if (this.kind === 'youtube' && this.ytReady) this.yt.setVolume(Math.max(0, this.yt.getVolume() - 15));
        else if (this.el) this.el.volume = Math.max(0, this.el.volume - 0.15);
        break;
      case MediaCommand.NEXT:
        if (this.kind === 'youtube') {
          this.playlistIndex = (this.playlistIndex + 1) % this.playlist.length;
          const id2 = youtubeId(this.playlist[this.playlistIndex]);
          if (id2 && this.ytReady) this.yt.loadVideoById(id2);
        } else if (this.kind === 'audio') {
          this.playlistIndex = (this.playlistIndex + 1) % this.playlist.length; this._caricaTraccia();
        } else if (this.kind === 'pdf' && this.page < this.pages) { this.page++; await this._renderPdf(); }
        else if (this.kind === 'image') { this.imageIndex = (this.imageIndex + 1) % this.images.length; this._showImage(); }
        break;
      case MediaCommand.PREV:
        if (this.kind === 'youtube') {
          this.playlistIndex = (this.playlistIndex - 1 + this.playlist.length) % this.playlist.length;
          const id3 = youtubeId(this.playlist[this.playlistIndex]);
          if (id3 && this.ytReady) this.yt.loadVideoById(id3);
        } else if (this.kind === 'audio') {
          this.playlistIndex = (this.playlistIndex - 1 + this.playlist.length) % this.playlist.length; this._caricaTraccia();
        } else if (this.kind === 'pdf' && this.page > 1) { this.page--; await this._renderPdf(); }
        else if (this.kind === 'image') { this.imageIndex = (this.imageIndex - 1 + this.images.length) % this.images.length; this._showImage(); }
        break;
      case MediaCommand.SCROLL_DOWN:
        this.container.scrollBy({ top: this.container.clientHeight * 0.75, behavior: 'smooth' });
        break;
      case MediaCommand.SCROLL_UP:
        this.container.scrollBy({ top: -this.container.clientHeight * 0.75, behavior: 'smooth' });
        break;
      case MediaCommand.ZOOM_IN:
        this.zoom = Math.min(4, this.zoom * 1.25);
        if (this.kind === 'pdf') await this._renderPdf();
        else if (this.kind === 'image') this._showImage();
        else this._applyTextZoom();
        break;
      case MediaCommand.ZOOM_OUT:
        this.zoom = Math.max(0.4, this.zoom / 1.25);
        if (this.kind === 'pdf') await this._renderPdf();
        else if (this.kind === 'image') this._showImage();
        else this._applyTextZoom();
        break;
      case MediaCommand.READ_ALOUD:
        this._emit('readAloud', { text: this.textEl?.innerText || '' });
        break;
      case MediaCommand.EXIT:
        this.close(true);
        break;
    }
    this._emit('command', { command: id });
  }

  close(notify = true) {
    try { this.yt?.destroy?.(); } catch {}
    try { this.el?.pause?.(); } catch {}
    this.images.forEach(i => { try { URL.revokeObjectURL(i.url); } catch {} });
    if (this.kind === 'audio') this.playlist.forEach(p => { try { URL.revokeObjectURL(p.url); } catch {} });
    this.images = []; this.el = null;
    this.yt = null; this.ytReady = false; this.pdf = null; this.textEl = null;
    this.kind = null; this.zoom = 1;
    if (this.container) this.container.innerHTML = '';
    if (notify) this._emit('closed');
  }
}
