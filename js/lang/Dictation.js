/**
 * Dictation.js — Dettatura vocale e traduzione.
 *
 * ══════════════════════════════════════════════════════════════════
 * A CHI SERVE
 * ══════════════════════════════════════════════════════════════════
 *
 * A chi ha perso il controllo motorio ma non la voce. Sono situazioni
 * molto diverse da quella per cui Aurora è nato — SLA agli esordi,
 * esiti di ictus, distrofie, tetraparesi — e per queste persone
 * scrivere lettera per lettera con lo sguardo sarebbe assurdo quando
 * possono semplicemente parlare.
 *
 * Il testo dettato finisce nello STESSO buffer di composizione della
 * scansione: si può salvare fra i propri testi, rileggere, far
 * pronunciare. Non è un'isola separata — sarebbe la scelta sbagliata,
 * perché le capacità cambiano nel tempo e chi oggi detta domani
 * potrebbe usare lo sguardo, ritrovando i propri testi dov'erano.
 *
 * ══════════════════════════════════════════════════════════════════
 * DUE COSE DA SAPERE
 * ══════════════════════════════════════════════════════════════════
 *
 * 1. Il riconoscimento vocale del browser NON è locale: Chrome invia
 *    l'audio ai server Google. Serve connessione, e per una persona
 *    malata che detta cose private è un fatto da dichiarare, non da
 *    nascondere.
 * 2. La traduzione usa un servizio gratuito con un limite giornaliero.
 *    È l'unica parte di Aurora che non funziona offline, e quando non
 *    funziona deve dirlo chiaramente invece di fallire in silenzio.
 */

/** Lingue per dettatura e sintesi. */
export const LINGUE = [
  { code: 'it-IT', breve: 'it', nome: 'Italiano', bandiera: '🇮🇹' },
  { code: 'en-US', breve: 'en', nome: 'English', bandiera: '🇺🇸' },
  { code: 'es-ES', breve: 'es', nome: 'Español', bandiera: '🇪🇸' },
  { code: 'fr-FR', breve: 'fr', nome: 'Français', bandiera: '🇫🇷' },
  { code: 'de-DE', breve: 'de', nome: 'Deutsch', bandiera: '🇩🇪' },
  { code: 'pt-PT', breve: 'pt', nome: 'Português', bandiera: '🇵🇹' },
  { code: 'nl-NL', breve: 'nl', nome: 'Nederlands', bandiera: '🇳🇱' },
  { code: 'ru-RU', breve: 'ru', nome: 'Русский', bandiera: '🇷🇺' },
];

/** @returns true se il browser sa riconoscere il parlato */
export function dettaturaDisponibile() {
  return !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
}

/**
 * Dettatura continua.
 *
 * Il riconoscimento del browser si ferma da solo dopo qualche secondo
 * di silenzio, anche in modalità continua: viene quindi riavviato
 * automaticamente finché non lo si ferma. Senza questo, dettare un
 * testo lungo richiederebbe di premere il pulsante ogni mezzo minuto.
 */
export class Dettatura {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.rec = null;
    this.attiva = false;
    this.lingua = 'it-IT';
    this.parziale = '';
  }

  avvia(lingua) {
    if (this.attiva) return true;
    const R = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!R) { this._emit('errore', { messaggio: 'Questo browser non sa riconoscere il parlato. Usa Chrome o Edge.' }); return false; }

    this.lingua = lingua || this.lingua;
    const rec = new R();
    rec.lang = this.lingua;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let definitivo = '', provvisorio = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) definitivo += t;
        else provvisorio += t;
      }
      this.parziale = provvisorio;
      if (definitivo.trim()) this._emit('testo', { testo: definitivo.trim() });
      this._emit('parziale', { testo: provvisorio });
    };

    rec.onerror = (e) => {
      // "no-speech" e "aborted" sono normali: non vanno segnalati come
      // guasti, altrimenti si riempie lo schermo di avvisi inutili.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      const spiega = {
        'not-allowed': 'Permesso microfono negato. Concedilo nelle impostazioni del sito.',
        'audio-capture': 'Nessun microfono disponibile.',
        'network': 'Il riconoscimento vocale richiede connessione: non è disponibile offline.',
        'service-not-allowed': 'Servizio di riconoscimento non disponibile.',
      };
      this._emit('errore', { messaggio: spiega[e.error] || `Riconoscimento non riuscito: ${e.error}` });
    };

    rec.onend = () => {
      // Riavvio automatico: il riconoscimento si ferma da solo dopo
      // qualche secondo di silenzio anche in modalità continua.
      if (!this.attiva) return;
      try { rec.start(); }
      catch { this.attiva = false; this._emit('fine', {}); }
    };

    try { rec.start(); }
    catch (e) { this._emit('errore', { messaggio: e.message }); return false; }

    this.rec = rec;
    this.attiva = true;
    this._emit('avviata', { lingua: this.lingua });
    return true;
  }

  ferma() {
    if (!this.attiva) return;
    this.attiva = false;
    this.parziale = '';
    try { this.rec?.stop(); } catch {}
    this.rec = null;
    this._emit('fine', {});
  }

  _emit(tipo, dati) { this.onEvent?.({ tipo, ...dati }); }
}

/**
 * Traduzione tramite MyMemory.
 *
 * ⚠️ Richiede connessione e ha un limite giornaliero: è l'unica
 * funzione di Aurora che non lavora offline. Gli errori vengono
 * restituiti come testo leggibile, mai come eccezione silenziosa.
 *
 * Il testo lungo viene spezzato in blocchi: il servizio tronca oltre
 * circa 500 caratteri, e una lettera intera arriverebbe monca.
 */
export async function traduci(testo, da, a) {
  const pulito = String(testo || '').trim();
  if (!pulito) return { ok: false, motivo: 'Non c\'è niente da tradurre.' };
  if (da === a) return { ok: true, testo: pulito };

  const blocchi = spezzaPerTraduzione(pulito, 480);
  const fuori = [];
  for (const b of blocchi) {
    try {
      const url = 'https://api.mymemory.translated.net/get?q='
        + encodeURIComponent(b) + '&langpair=' + da + '|' + a;
      const r = await fetch(url);
      if (!r.ok) return { ok: false, motivo: `Servizio non raggiungibile (${r.status}).` };
      const d = await r.json();
      const t = d?.responseData?.translatedText;
      if (!t) return { ok: false, motivo: 'Nessuna traduzione ricevuta: probabile limite giornaliero raggiunto.' };
      fuori.push(t);
    } catch {
      return { ok: false, motivo: 'Traduzione non riuscita: serve una connessione a internet.' };
    }
  }
  return { ok: true, testo: fuori.join(' ') };
}

/** Spezza sulle frasi, mai a metà parola. */
export function spezzaPerTraduzione(testo, max = 480) {
  const t = String(testo || '').trim();
  if (t.length <= max) return t ? [t] : [];
  const frasi = t.split(/(?<=[.!?…])\s+/);
  const out = [];
  let buf = '';
  for (const f of frasi) {
    if (f.length > max) {
      if (buf) { out.push(buf.trim()); buf = ''; }
      // Frase enorme senza punteggiatura: si spezza sulle parole.
      let p = '';
      for (const w of f.split(/\s+/)) {
        if ((p + ' ' + w).trim().length > max) { out.push(p.trim()); p = w; }
        else p = (p + ' ' + w).trim();
      }
      if (p) buf = p;
      continue;
    }
    if ((buf + ' ' + f).trim().length > max) { out.push(buf.trim()); buf = f; }
    else buf = (buf + ' ' + f).trim();
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Conteggio parole e caratteri, per l'indicatore in basso. */
export function conta(testo) {
  const t = String(testo || '');
  const parole = t.trim() ? t.trim().split(/\s+/).length : 0;
  return { parole, caratteri: t.length };
}
