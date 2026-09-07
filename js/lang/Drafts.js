/**
 * Drafts.js — Archivio dei testi composti.
 *
 * Serve a comporre un testo lungo in più sedute, conservarlo, e
 * farlo pronunciare quando arriva la persona a cui è rivolto.
 *
 * È una funzione diversa dalla comunicazione immediata, e ha bisogni
 * opposti:
 *   · la frase quotidiana si dice e si dimentica;
 *   · una lettera si scrive in un'ora, si rilegge, si corregge, e deve
 *     ESSERE ANCORA LÌ domani.
 *
 * Da qui due scelte non negoziabili:
 *   1. leggere ad alta voce NON cancella il testo;
 *   2. il lavoro in corso viene salvato da solo di continuo, perché
 *      un'ora di composizione persa per una scheda chiusa è un danno
 *      che non si può chiedere a nessuno di riparare.
 */

const KEY = 'aurora.drafts.v1';
const WIP = 'aurora.wip.v1';

export class Drafts {
  constructor() {
    this.items = [];      // { id, title, text, created, updated, order }
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      this.items = raw ? JSON.parse(raw) : [];
    } catch { this.items = []; }
    this._sort();
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.items)); return true; }
    catch (e) { console.error('[drafts] salvataggio fallito:', e); return false; }
  }

  _sort() {
    this.items.sort((a, b) => {
      const ao = Number.isFinite(a.order) ? a.order : 1e9;
      const bo = Number.isFinite(b.order) ? b.order : 1e9;
      if (ao !== bo) return ao - bo;
      return (b.updated || 0) - (a.updated || 0);
    });
  }

  get list() { return this.items; }
  get(id) { return this.items.find(d => d.id === id) || null; }

  /**
   * Titolo automatico dalle prime parole: chi scrive con un gesto solo
   * non può permettersi di digitare anche un titolo.
   */
  /**
   * Titolo automatico: poche parole, corto.
   *
   * Titoli lunghi non stanno nell'elenco a schermo e allungano
   * l'annuncio vocale a ogni giro di scansione. Due parole bastano a
   * riconoscere un testo, e si possono sempre rinominare a mano.
   */
  static autoTitle(text) {
    const w = (text || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
    if (!w) return 'Senza titolo';
    return w.length > 20 ? w.slice(0, 20) + '…' : w;
  }

  add(text, title = null) {
    const clean = (text || '').trim();
    if (!clean) return null;
    const now = Date.now();
    const d = {
      id: 'd' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      title: (title || Drafts.autoTitle(clean)).trim(),
      text: clean, created: now, updated: now,
      order: this.items.length,
    };
    this.items.push(d);
    this._sort(); this.save();
    return d;
  }

  update(id, text) {
    const d = this.get(id);
    if (!d) return false;
    d.text = (text || '').trim();
    d.updated = Date.now();
    this.save();
    return true;
  }

  rename(id, title) {
    const d = this.get(id);
    if (!d) return false;
    d.title = (title || '').trim() || Drafts.autoTitle(d.text);
    d.updated = Date.now();
    this.save();
    return true;
  }

  remove(id) {
    const i = this.items.findIndex(d => d.id === id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.items.forEach((d, k) => { d.order = k; });
    this.save();
    return true;
  }

  /** Sposta di una posizione: in cima si raggiunge con meno annunci. */
  move(id, delta) {
    const i = this.items.findIndex(d => d.id === id);
    if (i < 0) return false;
    const j = Math.max(0, Math.min(this.items.length - 1, i + delta));
    if (i === j) return false;
    this.items.splice(j, 0, this.items.splice(i, 1)[0]);
    this.items.forEach((d, k) => { d.order = k; });
    this.save();
    return true;
  }

  /* ------------------------- Lavoro in corso ------------------------- */

  /**
   * Salvataggio automatico di ciò che si sta scrivendo.
   * Chiamato a ogni carattere: senza, chiudere la scheda per sbaglio
   * costerebbe un'ora di lavoro fatto con un solo movimento dell'occhio.
   */
  saveWip(text) {
    try { localStorage.setItem(WIP, JSON.stringify({ text: text || '', t: Date.now() })); }
    catch {}
  }

  loadWip() {
    try {
      const raw = localStorage.getItem(WIP);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d?.text ? d : null;
    } catch { return null; }
  }

  clearWip() { try { localStorage.removeItem(WIP); } catch {} }

  /* ------------------------------ Scambio ------------------------------ */

  exportAll() {
    return JSON.stringify({ aurora_drafts: true, exportedAt: new Date().toISOString(), items: this.items }, null, 2);
  }

  importAll(text, replace = false) {
    const data = JSON.parse(text);
    const items = data?.items || (Array.isArray(data) ? data : null);
    if (!items) throw new Error('File non valido: nessun testo trovato.');
    if (replace) this.items = [];
    let added = 0, skipped = 0;
    for (const it of items) {
      if (!it?.text) continue;
      // Reimportare lo stesso backup due volte è uno scenario reale:
      // si riconosce il duplicato dal contenuto, non dall'identificativo,
      // perché gli id cambiano fra dispositivi diversi.
      const dup = this.items.some(d => d.text.trim() === String(it.text).trim());
      if (dup) { skipped++; continue; }
      this.add(it.text, it.title);
      added++;
    }
    this.items.forEach((d, k) => { d.order = k; });
    this.save();
    return { added, skipped };
  }
}

/**
 * Divide un testo lungo in frasi.
 *
 * Serve per la lettura ad alta voce: pronunciare tutto in un blocco
 * unico rende impossibile fermarsi a metà, e alcune sintesi vocali
 * troncano oltre una certa lunghezza. Leggendo frase per frase si può
 * interrompere in qualunque momento con un gesto.
 */
export function splitSentences(text, maxLen = 220) {
  const raw = (text || '').trim();
  if (!raw) return [];
  const parts = raw.split(/(?<=[.!?…])\s+|\n+/).filter(s => s.trim());
  const out = [];
  for (const p of parts) {
    if (p.length <= maxLen) { out.push(p.trim()); continue; }
    // Frase senza punteggiatura più lunga del limite: si spezza sulle
    // virgole, e in ultima istanza sulle parole.
    let buf = '';
    for (const chunk of p.split(/(?<=,)\s+/)) {
      if ((buf + ' ' + chunk).trim().length > maxLen && buf) { out.push(buf.trim()); buf = chunk; }
      else buf = (buf + ' ' + chunk).trim();
    }
    if (buf) out.push(buf.trim());
  }
  return out;
}
