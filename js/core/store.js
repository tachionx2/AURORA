/**
 * store.js — Bus eventi + persistenza locale.
 *
 * Tutto è locale. Nessun frame, nessun testo, nessuna statistica lascia
 * mai il dispositivo. Non è una scelta di comodità: sono immagini del
 * viso e parole intime di una persona in condizione di vulnerabilità
 * estrema.
 */

/* ---------------------------- Bus eventi ---------------------------- */

export class Bus {
  constructor() { this.map = new Map(); }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) { this.map.get(evt)?.delete(fn); }
  emit(evt, payload) {
    const s = this.map.get(evt);
    if (!s) return;
    for (const fn of s) {
      try { fn(payload); }
      catch (e) { console.error(`[bus] handler "${evt}" ha lanciato:`, e); }
    }
  }
}

export const bus = new Bus();

/* --------------------------- Persistenza --------------------------- */

const LS_CONFIG = 'aurora.config.v3';
const LS_STATS  = 'aurora.stats.v3';
const LS_LOG    = 'aurora.log.v3';

export function saveConfig(cfg) {
  try { localStorage.setItem(LS_CONFIG, JSON.stringify(cfg)); return true; }
  catch (e) { console.error('[store] salvataggio config fallito:', e); return false; }
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_CONFIG);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { console.error('[store] lettura config fallita:', e); return null; }
}

export function saveStats(s) {
  try { localStorage.setItem(LS_STATS, JSON.stringify(s)); return true; }
  catch (e) { console.error('[store] salvataggio statistiche fallito:', e); return false; }
}

export function loadStats() {
  try {
    const raw = localStorage.getItem(LS_STATS);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function appendLog(entry) {
  try {
    const log = JSON.parse(localStorage.getItem(LS_LOG) || '[]');
    log.push(entry);
    // Tetto: le ultime 500 frasi. Il log è materiale intimo, non un archivio.
    while (log.length > 500) log.shift();
    localStorage.setItem(LS_LOG, JSON.stringify(log));
  } catch (e) { console.error('[store] append log fallito:', e); }
}

export function loadLog() {
  try { return JSON.parse(localStorage.getItem(LS_LOG) || '[]'); }
  catch { return []; }
}

export function clearAll() {
  [LS_CONFIG, LS_STATS, LS_LOG].forEach(k => localStorage.removeItem(k));
}
