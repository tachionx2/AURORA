/**
 * version.js — Identificativo della versione caricata.
 *
 * Esiste per una ragione pratica: il service worker tiene una cache
 * aggressiva, e senza un modo per VEDERE quale versione è in esecuzione
 * si finisce per provare la build vecchia credendo di provare la nuova.
 * Il numero è mostrato nella barra in alto e nelle impostazioni.
 */
export const BUILD = '20260908-1217';
