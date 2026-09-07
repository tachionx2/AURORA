/**
 * HomeAssistant.js — Controllo di dispositivi di casa.
 *
 * ══════════════════════════════════════════════════════════════════
 * COSA FA, E PERCHÉ CONVIENE PASSARE DA HOME ASSISTANT
 * ══════════════════════════════════════════════════════════════════
 *
 * Televisore, luci, tapparelle, condizionatore: dispositivi diversi,
 * di marche diverse, ognuno con il proprio modo di farsi comandare.
 * Home Assistant li unifica dietro una sola interfaccia, e a quella
 * Aurora può parlare con una richiesta semplice.
 *
 * Il guadagno per chi usa Aurora è concreto: accendere la televisione
 * e cambiare canale senza chiedere a nessuno. Sono cose piccole che
 * per una persona che non può muoversi valgono molto — soprattutto
 * nelle ore in cui non c'è nessuno in casa.
 *
 * ══════════════════════════════════════════════════════════════════
 * SICUREZZA
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ Il gettone di accesso è una chiave di casa: chi lo ha può
 * comandare tutto ciò che Home Assistant comanda. Va creato dedicato
 * ad Aurora, così può essere revocato da solo senza toccare il resto,
 * e ha senso solo sulla rete locale — un Home Assistant esposto su
 * internet con un gettone dentro un browser è una cattiva idea.
 */

/** Domini e servizi tipici, per non doverli cercare a memoria. */
export const MODELLI = {
  tv: {
    nome: 'Televisore',
    dominio: 'media_player',
    comandi: [
      { nome: 'Accendi',      servizio: 'turn_on' },
      { nome: 'Spegni',       servizio: 'turn_off' },
      { nome: 'Volume su',    servizio: 'volume_up' },
      { nome: 'Volume giù',   servizio: 'volume_down' },
      { nome: 'Muto',         servizio: 'volume_mute', dati: { is_volume_muted: true } },
      { nome: 'Canale avanti', servizio: 'media_next_track' },
      { nome: 'Canale indietro', servizio: 'media_previous_track' },
    ],
  },
  luce: {
    nome: 'Luce',
    dominio: 'light',
    comandi: [
      { nome: 'Accendi', servizio: 'turn_on' },
      { nome: 'Spegni',  servizio: 'turn_off' },
    ],
  },
  presa: {
    nome: 'Presa o stampante',
    dominio: 'switch',
    comandi: [
      { nome: 'Accendi', servizio: 'turn_on' },
      { nome: 'Spegni',  servizio: 'turn_off' },
    ],
  },
  tapparella: {
    nome: 'Tapparella',
    dominio: 'cover',
    comandi: [
      { nome: 'Apri',   servizio: 'open_cover' },
      { nome: 'Chiudi', servizio: 'close_cover' },
      { nome: 'Ferma',  servizio: 'stop_cover' },
    ],
  },
  clima: {
    nome: 'Condizionatore',
    dominio: 'climate',
    comandi: [
      { nome: 'Accendi', servizio: 'turn_on' },
      { nome: 'Spegni',  servizio: 'turn_off' },
    ],
  },
};

/** Il dominio si ricava dall'entità: `media_player.tv_salotto` → `media_player`. */
export function dominioDi(entita) {
  const s = String(entita || '');
  const i = s.indexOf('.');
  return i > 0 ? s.slice(0, i) : '';
}

/** Un'entità di Home Assistant ha sempre la forma `dominio.nome`. */
export function entitaValida(x) {
  return /^[a-z_]+\.[a-z0-9_]+$/.test(String(x || '').trim());
}

/**
 * Controlla la configurazione prima di provare a usarla.
 * Scoprire che manca l'indirizzo mentre si sta cercando di accendere
 * la televisione è il momento sbagliato.
 */
export function verificaDomotica(cfg) {
  const problemi = [];
  const d = cfg?.domotica || {};
  if (!d.enabled) problemi.push('la domotica è spenta nelle impostazioni');
  if (!d.url || !/^https?:\/\//i.test(d.url)) problemi.push('manca l\'indirizzo di Home Assistant');
  if (!d.token || String(d.token).length < 20) problemi.push('manca il gettone di accesso');
  const validi = (d.dispositivi || []).filter(x => x?.nome && entitaValida(x?.entita));
  if (!validi.length) problemi.push('nessun dispositivo valido in elenco');
  return { ok: problemi.length === 0, problemi, dispositivi: validi };
}

/** Comandi di un dispositivo: quelli propri, o quelli tipici del suo genere. */
export function comandiDi(dispositivo) {
  if (Array.isArray(dispositivo?.comandi) && dispositivo.comandi.length) {
    return dispositivo.comandi.filter(c => c?.nome && c?.servizio);
  }
  const dom = dominioDi(dispositivo?.entita);
  const modello = Object.values(MODELLI).find(m => m.dominio === dom);
  return modello ? modello.comandi : [];
}

/**
 * Invia un comando.
 * @returns {{ok, messaggio}} — mai un'eccezione.
 */
export async function comanda(cfg, dispositivo, comando) {
  const v = verificaDomotica(cfg);
  if (!v.ok) return { ok: false, messaggio: v.problemi[0] };
  const dominio = dominioDi(dispositivo?.entita);
  if (!dominio || !comando?.servizio) {
    return { ok: false, messaggio: 'comando non valido' };
  }
  const base = String(cfg.domotica.url).replace(/\/+$/, '');
  const url = `${base}/api/services/${dominio}/${comando.servizio}`;
  const corpo = { entity_id: dispositivo.entita, ...(comando.dati || {}) };

  try {
    // Tetto di tempo: se Home Assistant è spento o irraggiungibile,
    // la persona non deve restare in attesa senza risposta.
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const scaduto = setTimeout(() => ctrl?.abort(), 8000);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.domotica.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
      signal: ctrl?.signal,
    });
    clearTimeout(scaduto);
    if (r.status === 401) return { ok: false, messaggio: 'gettone non valido o scaduto' };
    if (!r.ok) return { ok: false, messaggio: `Home Assistant ha risposto ${r.status}` };
    return { ok: true, messaggio: `${dispositivo.nome}: ${comando.nome}` };
  } catch (e) {
    const m = e?.name === 'AbortError'
      ? 'Home Assistant non risponde'
      : 'Home Assistant non raggiungibile: controlla di essere sulla stessa rete';
    return { ok: false, messaggio: m };
  }
}

/** Prova la connessione, per dare all'assistente una risposta subito. */
export async function provaConnessione(cfg) {
  const d = cfg?.domotica || {};
  if (!d.url || !d.token) return { ok: false, messaggio: 'indirizzo o gettone mancanti' };
  try {
    const base = String(d.url).replace(/\/+$/, '');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const scaduto = setTimeout(() => ctrl?.abort(), 8000);
    const r = await fetch(`${base}/api/`, {
      headers: { 'Authorization': `Bearer ${d.token}` },
      signal: ctrl?.signal,
    });
    clearTimeout(scaduto);
    if (r.status === 401) return { ok: false, messaggio: 'gettone non valido' };
    if (!r.ok) return { ok: false, messaggio: `risposta ${r.status}` };
    return { ok: true, messaggio: 'connessione riuscita' };
  } catch (e) {
    return {
      ok: false,
      messaggio: e?.name === 'AbortError'
        ? 'nessuna risposta entro otto secondi'
        : 'non raggiungibile: stessa rete? indirizzo giusto?',
    };
  }
}

/**
 * Istruzioni per l'assistente, mostrate nelle impostazioni.
 *
 * Stanno qui e non in un manuale a parte perché servono nel momento
 * esatto in cui si compila quel campo.
 */
export const ISTRUZIONI = [
  {
    titolo: 'Creare il gettone di accesso',
    testo: 'In Home Assistant: clicca sul tuo nome in basso a sinistra, scorri fino in fondo a "Token di accesso a lunga durata", crea un gettone chiamandolo "Aurora" e copialo qui. ⚠️ Viene mostrato una volta sola. Un gettone dedicato può essere revocato senza toccare il resto.',
  },
  {
    titolo: 'Indirizzo di Home Assistant',
    testo: 'Di solito http://homeassistant.local:8123 oppure l\'indirizzo IP, come http://192.168.1.50:8123. Deve essere raggiungibile dal dispositivo su cui gira Aurora: la stessa rete wifi.',
  },
  {
    titolo: 'Permettere ad Aurora di collegarsi',
    testo: 'In Home Assistant, nel file configuration.yaml, aggiungi:\n\nhttp:\n  cors_allowed_origins:\n    - https://iltuosito.netlify.app\n\nPoi riavvia Home Assistant. Senza questa riga il browser blocca le richieste per sicurezza, e il collegamento non funziona.',
  },
  {
    titolo: 'Trovare il nome di un dispositivo',
    testo: 'In Home Assistant: Strumenti per sviluppatori → Stati. Cerca il dispositivo e copia il suo identificativo, che ha la forma dominio.nome — per esempio media_player.tv_salotto oppure switch.stampante_studio.',
  },
];
