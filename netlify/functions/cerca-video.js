// netlify/functions/cerca-video.js
//
// ══════════════════════════════════════════════════════════════════
// RICERCA DI VIDEO SU YOUTUBE
// ══════════════════════════════════════════════════════════════════
//
// ⚠️ Perché serve un servizio invece di cercare dal browser.
//
// Il browser vieta a una pagina di leggere risposte da altri siti, se
// quel sito non lo consente esplicitamente. È la regola che protegge i
// dati di chi naviga, e YouTube — come i servizi pubblici di Piped —
// non la concede. Dal browser ogni tentativo finisce con «blocked by
// CORS policy», qualunque indirizzo si usi.
//
// Un servizio che gira sul server non ha questo limite: non è una
// pagina, è un programma. Fa la ricerca e restituisce il risultato
// alla pagina, che quella risposta può leggerla perché arriva dal
// proprio stesso sito.
//
// ⚠️ NON richiede alcuna chiave: si legge la pagina pubblica dei
// risultati di YouTube, la stessa che vedrebbe una persona.
//
// Restituisce: { ok, video: [{ id, titolo, durata }], fonte }

/** Risposta con le intestazioni che permettono alla pagina di leggerla. */
function rispondi(statusCode, corpo) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      // I risultati cambiano poco: un minuto di memoria evita di
      // ripetere la stessa ricerca a ogni tentativo.
      'Cache-Control': 'public, max-age=60',
    },
    body: JSON.stringify(corpo),
  };
}

/**
 * Estrae i video dalla pagina dei risultati.
 *
 * ⚠️ YouTube incorpora i dati in un blocco JavaScript dentro la
 * pagina: non è un'interfaccia dichiarata, quindi la forma può
 * cambiare. Si cercano perciò le due forme note, e se nessuna
 * funziona si risponde onestamente invece di restituire spazzatura.
 */
function estraiVideo(html, quanti) {
  const fuori = [];
  const visti = new Set();

  /* Forma 1: i dati strutturati, che contengono anche durata e
   * titolo. È la più ricca e va provata per prima. */
  const re1 = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"([\s\S]{0,1200}?)"lengthText":\{"simpleText":"([0-9:]+)"/g;
  let m;
  while ((m = re1.exec(html)) && fuori.length < quanti) {
    const id = m[1];
    if (visti.has(id)) continue;
    visti.add(id);
    const titolo = (m[2].match(/"text":"([^"]{3,140})"/) || [])[1] || '';
    fuori.push({ id, titolo: ripulisci(titolo), durata: inSecondi(m[3]) });
  }
  if (fuori.length) return fuori;

  /* Forma 2: i soli identificativi. Meno informazioni, ma meglio di
   * niente: senza durata non si possono scartare gli spezzoni, e lo si
   * dichiara mettendo durata a zero. */
  const re2 = /"videoId":"([A-Za-z0-9_-]{11})"/g;
  while ((m = re2.exec(html)) && fuori.length < quanti) {
    const id = m[1];
    if (visti.has(id)) continue;
    visti.add(id);
    fuori.push({ id, titolo: '', durata: 0 });
  }
  return fuori;
}

/** «12:34» diventa 754 secondi. */
function inSecondi(t) {
  const p = String(t).split(':').map(Number);
  if (p.some(Number.isNaN)) return 0;
  return p.reduce((acc, v) => acc * 60 + v, 0);
}

/** Toglie le sequenze di scarto lasciate dalla pagina. */
function ripulisci(s) {
  return String(s)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/\\"/g, '"')
    .trim();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return rispondi(200, { ok: true });

  const q = String(event.queryStringParameters?.q || '').trim();
  const quanti = Math.max(1, Math.min(12, Number(event.queryStringParameters?.n) || 8));
  if (!q) return rispondi(400, { ok: false, errore: 'nessuna ricerca indicata' });

  try {
    /* `sp=EgIQAQ%3D%3D` chiede a YouTube i soli VIDEO, escludendo
     * canali e playlist: una playlist non si può aprire nel riquadro,
     * e restituirla significherebbe proporre qualcosa che non parte. */
    const url = `https://www.youtube.com/results?search_query=${
      encodeURIComponent(q)}&sp=EgIQAQ%3D%3D`;

    const r = await fetch(url, {
      headers: {
        // Senza un'intestazione plausibile YouTube risponde con una
        // pagina ridotta, priva dei risultati.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': String(event.queryStringParameters?.lang || 'it') + ',en;q=0.8',
      },
    });
    if (!r.ok) return rispondi(502, { ok: false, errore: `YouTube ha risposto ${r.status}` });

    const html = await r.text();
    const video = estraiVideo(html, quanti);
    if (!video.length) {
      /* ⚠️ Nessun risultato riconosciuto può voler dire due cose molto
       * diverse: la ricerca non ha trovato nulla, oppure la forma della
       * pagina è cambiata e non la sappiamo più leggere. Distinguerle
       * serve a chi dovrà correggere. */
      return rispondi(200, { ok: false,
        errore: html.includes('did not match any videos')
          ? 'nessun risultato per questa ricerca'
          : 'risultati non riconosciuti: la pagina di YouTube è cambiata' });
    }
    return rispondi(200, { ok: true, video, fonte: 'youtube' });
  } catch (e) {
    return rispondi(502, { ok: false,
      errore: String(e && e.message ? e.message : e).slice(0, 200) });
  }
};
