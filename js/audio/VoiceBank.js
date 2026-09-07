/**
 * VoiceBank.js — Voci di guida registrate da chi assiste.
 *
 * ══════════════════════════════════════════════════════════════════
 * PERCHÉ ESISTE
 * ══════════════════════════════════════════════════════════════════
 *
 * La sintesi vocale del browser esce SEMPRE dall'uscita predefinita di
 * sistema: non è instradabile. Questo impedisce il funzionamento che il
 * programma vorrebbe — guida solo nell'auricolare, frase pronunciata
 * per tutti dall'altoparlante.
 *
 * Ma il vocabolario della guida è piccolo e non cambia mai: le lettere,
 * i nomi dei gruppi, una decina di comandi. Registrandole una volta si
 * ottengono DATI AUDIO veri, e su quelli `setSinkId` funziona davvero.
 *
 * Quindi: uscita di sistema sull'altoparlante (la frase la sentono
 * tutti) e guida registrata nell'auricolare.
 *
 * E c'è un vantaggio che non è tecnico: per chi ascolta quelle parole
 * per ore, la voce di una persona cara è tutt'altra cosa rispetto a una
 * sintesi.
 *
 * ══════════════════════════════════════════════════════════════════
 * NON CAMBIA NULLA SE NON SI USA
 * ══════════════════════════════════════════════════════════════════
 *
 * È interamente facoltativa. Senza registrazioni il programma si
 * comporta esattamente come prima. Anche con registrazioni PARZIALI
 * funziona: ciò che non è registrato ricade sulla sintesi.
 */

const DB_NAME = 'aurora-voci';
const DB_VER = 1;
const STORE = 'clip';

/** Normalizza il testo in una chiave stabile. */
export function chiaveDi(testo) {
  return String(testo || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export class VoiceBank {
  constructor() {
    this.db = null;
    this.indice = new Set();     // chiavi disponibili, in memoria
    this.pronta = false;
    this.url = new Map();        // chiave → object URL, creato alla bisogna
  }

  async apri() {
    if (this.pronta) return true;
    if (!('indexedDB' in globalThis)) return false;
    try {
      this.db = await new Promise((ris, rif) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => ris(req.result);
        req.onerror = () => rif(req.error);
      });
      await this._caricaIndice();
      this.pronta = true;
      return true;
    } catch (e) {
      console.warn('[voci] archivio non disponibile:', e?.message);
      return false;
    }
  }

  _tx(modo) { return this.db.transaction(STORE, modo).objectStore(STORE); }

  async _caricaIndice() {
    const chiavi = await new Promise((ris, rif) => {
      const r = this._tx('readonly').getAllKeys();
      r.onsuccess = () => ris(r.result || []);
      r.onerror = () => rif(r.error);
    });
    this.indice = new Set(chiavi);
  }

  /** True se esiste una registrazione per questo testo. */
  ha(testo) { return this.indice.has(chiaveDi(testo)); }

  get quante() { return this.indice.size; }

  async salva(testo, blob) {
    if (!this.pronta) return false;
    const k = chiaveDi(testo);
    await new Promise((ris, rif) => {
      const r = this._tx('readwrite').put(blob, k);
      r.onsuccess = ris; r.onerror = () => rif(r.error);
    });
    this.indice.add(k);
    this._scartaUrl(k);
    return true;
  }

  async elimina(testo) {
    if (!this.pronta) return false;
    const k = chiaveDi(testo);
    await new Promise((ris, rif) => {
      const r = this._tx('readwrite').delete(k);
      r.onsuccess = ris; r.onerror = () => rif(r.error);
    });
    this.indice.delete(k);
    this._scartaUrl(k);
    return true;
  }

  async eliminaTutte() {
    if (!this.pronta) return false;
    await new Promise((ris, rif) => {
      const r = this._tx('readwrite').clear();
      r.onsuccess = ris; r.onerror = () => rif(r.error);
    });
    for (const k of this.indice) this._scartaUrl(k);
    this.indice.clear();
    return true;
  }

  _scartaUrl(k) {
    const u = this.url.get(k);
    if (u) { try { URL.revokeObjectURL(u); } catch {} this.url.delete(k); }
  }

  /**
   * Indirizzo riproducibile della registrazione, o null.
   * Gli indirizzi vengono tenuti in cache: rigenerarli a ogni annuncio
   * costerebbe una lettura dall'archivio nel momento peggiore, cioè
   * mentre la scansione deve annunciare la voce successiva.
   */
  async urlDi(testo) {
    if (!this.pronta) return null;
    const k = chiaveDi(testo);
    if (!this.indice.has(k)) return null;
    if (this.url.has(k)) return this.url.get(k);
    try {
      const blob = await new Promise((ris, rif) => {
        const r = this._tx('readonly').get(k);
        r.onsuccess = () => ris(r.result);
        r.onerror = () => rif(r.error);
      });
      if (!blob) return null;
      const u = URL.createObjectURL(blob);
      this.url.set(k, u);
      return u;
    } catch { return null; }
  }

  /** Pre-carica gli indirizzi delle voci più usate. */
  async precarica(testi) {
    for (const t of testi.slice(0, 80)) await this.urlDi(t);
  }
}

/**
 * Registratore da microfono.
 * Separato dalla banca: registrare e conservare sono due cose diverse,
 * e il registratore serve solo mentre la scheda impostazioni è aperta.
 */
export class Registratore {
  constructor() { this.stream = null; this.rec = null; }

  async avviaSessione() {
    if (this.stream) return true;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    return true;
  }

  chiudiSessione() {
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch {}
    this.stream = null;
  }

  /** @returns {Promise<Blob>} registra per la durata indicata */
  registra(ms = 2000) {
    if (!this.stream) return Promise.reject(new Error('sessione non avviata'));
    return new Promise((ris, rif) => {
      let mime = '';
      for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) { mime = m; break; }
      }
      let rec;
      try { rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined); }
      catch (e) { return rif(e); }
      const pezzi = [];
      rec.ondataavailable = e => { if (e.data?.size) pezzi.push(e.data); };
      rec.onerror = e => rif(e.error || new Error('registrazione fallita'));
      rec.onstop = () => {
        const b = new Blob(pezzi, { type: mime || 'audio/webm' });
        b.size > 0 ? ris(b) : rif(new Error('registrazione vuota: microfono muto?'));
      };
      rec.start();
      this.rec = rec;
      setTimeout(() => { try { rec.state !== 'inactive' && rec.stop(); } catch {} }, ms);
    });
  }

  interrompi() { try { this.rec?.state !== 'inactive' && this.rec.stop(); } catch {} }
}

/**
 * Elenco delle parole da registrare, ricavato dalla configurazione.
 *
 * Si registra ciò che viene ANNUNCIATO, non ciò che è scritto sui
 * pulsanti: sono gli annunci a essere ascoltati centinaia di volte al
 * giorno, e sono quelli che devono uscire dall'auricolare.
 */
export function vocabolarioGuida(cfg) {
  const voci = [];
  const agg = (testo, gruppo) => {
    const t = String(testo || '').trim();
    if (t && !voci.some(v => chiaveDi(v.testo) === chiaveDi(t))) voci.push({ testo: t, gruppo });
  };

  // Menu principale e comandi: sono i più frequenti in assoluto.
  for (const t of ['frasi', 'scrivi', 'miei testi', 'guarda', 'pausa', 'esci', 'menu',
                   'azioni', 'parla', 'rileggi', 'salva', 'lettera', 'parola', 'svuota',
                   'riprendo', 'annullato', 'niente da dire']) agg(t, 'comandi');

  // Nomi dei gruppi di lettere.
  for (const g of cfg.scan.groups || []) agg(g.spoken || g.label, 'gruppi');

  // Lettere, nella forma in cui vengono pronunciate.
  const nomi = cfg.audio.letterNames;
  for (const g of cfg.scan.groups || []) {
    for (const ch of g.items || []) {
      if (ch === ' ' || ch === '␣') { agg('spazio', 'lettere'); continue; }
      agg(nomi ? nomeLettera(ch) : ch.toLowerCase(), 'lettere');
    }
  }

  // Gruppi di frasi e frasi stesse.
  for (const gr of cfg.scan.phraseGroups || []) {
    agg(gr.spoken || gr.label, 'gruppi');
    for (const f of gr.phrases || []) agg(f, 'frasi');
  }
  return voci;
}

/** Nome italiano della lettera, come viene pronunciato. */
export function nomeLettera(ch) {
  const m = {
    A: 'a', B: 'bi', C: 'ci', D: 'di', E: 'e', F: 'effe', G: 'gi', H: 'acca',
    I: 'i', J: 'i lunga', K: 'cappa', L: 'elle', M: 'emme', N: 'enne', O: 'o',
    P: 'pi', Q: 'cu', R: 'erre', S: 'esse', T: 'ti', U: 'u', V: 'vu',
    W: 'doppia vu', X: 'ics', Y: 'ipsilon', Z: 'zeta',
  };
  return m[String(ch).toUpperCase()] || String(ch).toLowerCase();
}
