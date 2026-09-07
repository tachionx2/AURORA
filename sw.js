/**
 * sw.js — Service worker.
 *
 * Obiettivo: dopo il primo caricamento l'app deve funzionare SENZA
 * internet. Non è una comodità — se la connessione di casa cade alle
 * tre di notte, il sistema deve continuare a funzionare.
 *
 * Strategia:
 *   - file dell'app  → cache-first, aggiornati in background
 *   - CDN (MediaPipe, font) → stale-while-revalidate, cache separata
 *   - tutto il resto → rete
 *
 * Nessun dato dell'utente passa di qui: configurazione, statistiche e
 * messaggi vivono in localStorage e non vengono mai messi in cache né
 * inviati altrove.
 */

const VERSION = 'aurora-20260907-1251';
const APP_CACHE = `${VERSION}-app`;
const CDN_CACHE = `${VERSION}-cdn`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/main.js',
  './js/core/config.js',
  './js/core/store.js',
  './js/signal/filters.js',
  './js/signal/GestureEngine.js',
  './js/scan/ScanEngine.js',
  './js/lang/Predictor.js',
  './js/lang/seed-it.js',
  './js/audio/AudioDirector.js',
  './js/vision/FrameSource.js',
  './js/vision/RgbTracker.js',
  './js/vision/IrTracker.js',
  './js/vision/VisionPipeline.js',
  './js/ui/SettingsView.js',
  './js/ui/Panels.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/core/i18n.js',
  './js/device/DeviceLink.js',
  './js/pointer/GazePointer.js',
  './js/pointer/PointerOverlay.js',
  './js/pointer/StripeCursor.js',
  './js/pointer/calibration.js',
  './js/ui/PointerView.js',
  './js/media/MediaPlayer.js',
  './js/lang/Drafts.js',
  './js/core/version.js',
  './js/signal/AutoTune.js',
  './js/audio/VoiceBank.js',
  './js/lang/Dictation.js',
  './js/signal/SessionStats.js',
  './js/lang/AutoCorrect.js',
  './js/vision/Watchdog.js',
  './js/lang/Mailer.js',
  './js/device/HomeAssistant.js',
  './js/core/Legal.js',
  './vendor/fonts/atkinson-hyperlegible-latin-400-italic.woff2',
  './vendor/fonts/atkinson-hyperlegible-latin-400-normal.woff2',
  './vendor/fonts/atkinson-hyperlegible-latin-700-italic.woff2',
  './vendor/fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  './vendor/mammoth/mammoth.browser.min.js',
  './vendor/mediapipe/vision_bundle.mjs',
  './vendor/mediapipe/wasm/vision_wasm_internal.js',
  './vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
  './vendor/fonts/atkinson.css',
  './js/ui/FloatWindow.js',
  './strumenti/LEGGIMI.md',
  './strumenti/aurora-esp32.ino',
  './strumenti/aurora-mouse.ps1',
  './strumenti/aurora-mouse.py',
  './strumenti/avvia-mouse.bat',
  './documenti/aurora-termini-licenza-paternita.pdf',
  './documenti/AURORA-LICENSE.txt',
];

/* Risorse esterne che vale la pena conservare.
 *
 * Da questa versione librerie e carattere sono INCLUSI nel programma:
 * qui resta solo il MODELLO di riconoscimento del volto, che pesa
 * alcuni megabyte e non è ridistribuibile insieme al codice.
 *
 * Viene scaricato al primo avvio e conservato: dalla seconda volta il
 * riconoscimento funziona senza rete. È l'unica cosa per cui serve
 * internet la prima volta.
 *
 * Gli host storici restano elencati perché una copia già in cache da
 * una versione precedente continui a essere servita. */
const CDN_HOSTS = [
  'storage.googleapis.com',   // modello di riconoscimento del volto
  'cdn.jsdelivr.net',         // versioni precedenti: copie già in cache
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // addAll fallisce in blocco se un solo file manca: mettiamo in cache
    // uno per uno così un'icona assente non impedisce l'installazione.
    await Promise.all(APP_SHELL.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (err) { console.warn('[sw] non messo in cache:', url, err.message); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k !== APP_CACHE && k !== CDN_CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ── Preparazione all'uso offline, su richiesta ──
 * Scarica e conserva tutto ciò che serve a funzionare senza rete:
 * il modello di riconoscimento e il codice WASM. L'assistente può
 * lanciarla mentre c'è connessione, invece di sperare che la cache si
 * riempia da sola al momento giusto. */
self.addEventListener('message', (e) => {
  if (e.data?.tipo !== 'preparaOffline') return;
  e.waitUntil((async () => {
    const risorse = [
      './vendor/mediapipe/wasm/vision_wasm_internal.wasm',
      './vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
      'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    ];
    let fatti = 0, falliti = 0;
    for (const r of risorse) {
      try {
        const esterna = r.startsWith('http');
        const cache = await caches.open(esterna ? CDN_CACHE : APP_CACHE);
        if (await cache.match(r)) { fatti++; continue; }
        const res = await fetch(r, esterna ? { mode: 'cors' } : undefined);
        if (res && (res.ok || res.type === 'opaque')) { await cache.put(r, res.clone()); fatti++; }
        else falliti++;
      } catch { falliti++; }
    }
    const client = e.source || (await self.clients.matchAll())[0];
    client?.postMessage({ tipo: 'preparaOfflineFatto', fatti, falliti, totale: risorse.length });
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // --- CDN: usa la copia, aggiorna in sottofondo --------------------
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const hit = await cache.match(req);
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return hit || (await net) || new Response('', { status: 504 });
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // --- Navigazione: rete, con fallback alla copia locale ------------
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(APP_CACHE);
        cache.put('./index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('./index.html')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // --- File dell'app: copia locale, aggiornamento in sottofondo -----
  e.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    const hit = await cache.match(req);
    if (hit) {
      fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});

// Permette alla pagina di forzare l'aggiornamento senza riavviare.
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// La versione della cache cambia a ogni build: le vecchie vengono
// eliminate in `activate`, quindi un aggiornamento non può più
// restare bloccato da una copia precedente.
