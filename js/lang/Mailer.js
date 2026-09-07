/**
 * Mailer.js — Invio di messaggi di posta.
 *
 * ══════════════════════════════════════════════════════════════════
 * PERCHÉ SERVE UN SERVIZIO DI APPOGGIO
 * ══════════════════════════════════════════════════════════════════
 *
 * Un browser non sa parlare SMTP. Non è una mancanza di Aurora né una
 * scorciatoia: è una scelta di sicurezza del web, e non cambierà. Una
 * pagina che potesse spedire posta direttamente sarebbe una pagina che
 * può spedire posta a nome di chi la visita.
 *
 * Serve quindi qualcosa fuori dal browser che riceva il messaggio e lo
 * spedisca: una funzione su Netlify, un servizio come EmailJS, o
 * qualunque indirizzo che accetti una richiesta. L'assistente lo
 * configura una volta e non ci pensa più.
 *
 * ⚠️ LE CREDENZIALI DELLA CASELLA NON STANNO QUI. Restano sul
 * servizio. In un programma che gira nel browser, una password di
 * posta sarebbe leggibile da chiunque apra gli strumenti di sviluppo —
 * e stiamo parlando della casella personale di una persona malata.
 *
 * ══════════════════════════════════════════════════════════════════
 * COSA MANDA
 * ══════════════════════════════════════════════════════════════════
 *
 * Una richiesta con un oggetto semplice, che qualunque servizio può
 * interpretare:
 *
 *   { to, toName, from, subject, text }
 *
 * Sul lato Netlify bastano poche righe per riceverlo e spedirlo.
 */

/** Un indirizzo che sembra un indirizzo. */
export function indirizzoValido(x) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(x || '').trim());
}

/**
 * Controlla la configurazione PRIMA di provare a spedire.
 *
 * Fallire al momento dell'invio, con la persona che ha appena finito
 * di scrivere una lettera, è il momento peggiore per scoprire che
 * l'indirizzo del servizio non è stato compilato.
 */
export function verificaConfigurazione(cfg) {
  const problemi = [];
  const e = cfg?.email || {};
  if (!e.enabled) problemi.push('la funzione posta è spenta nelle impostazioni');
  if (!e.endpoint || !/^https?:\/\//i.test(e.endpoint)) {
    problemi.push('manca l\'indirizzo del servizio di invio');
  }
  const contatti = (e.contatti || []).filter(c => indirizzoValido(c?.indirizzo));
  if (!contatti.length) problemi.push('nessun destinatario valido in elenco');
  return { ok: problemi.length === 0, problemi, contatti };
}

/**
 * Spedisce.
 *
 * @returns {{ok, messaggio}} — mai un'eccezione: chi chiama deve poter
 *          mostrare l'esito senza doversi difendere.
 */
export async function invia(cfg, { destinatario, testo, oggetto }) {
  const v = verificaConfigurazione(cfg);
  if (!v.ok) return { ok: false, messaggio: v.problemi[0] };
  if (!indirizzoValido(destinatario?.indirizzo)) {
    return { ok: false, messaggio: 'indirizzo del destinatario non valido' };
  }
  const corpo = String(testo || '').trim();
  if (!corpo) return { ok: false, messaggio: 'il messaggio è vuoto' };

  const E = cfg.email;
  const dati = {
    to: destinatario.indirizzo,
    toName: destinatario.nome || '',
    from: E.mittente || '',
    subject: oggetto || E.oggetto || 'Messaggio',
    text: corpo,
    /* Parametri della casella in uscita, trasmessi al servizio insieme
     * al messaggio: così lo stesso servizio funziona con qualunque
     * provider senza doverlo riconfigurare.
     *
     * ⚠️ Senza password: quella resta fra le variabili d'ambiente del
     * servizio, dove nessun browser può leggerla. */
    ...(E.smtpHost ? {
      smtp: {
        host: E.smtpHost,
        port: Number(E.smtpPort) || 587,
        secure: !!E.smtpSicuro,
        user: E.smtpUser || '',
      },
    } : {}),
  };

  try {
    // Tetto di tempo: senza, una rete lenta lascerebbe la persona
    // davanti a un "invio in corso" che non finisce mai.
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const scaduto = setTimeout(() => ctrl?.abort(), 20000);
    const r = await fetch(cfg.email.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dati),
      signal: ctrl?.signal,
    });
    clearTimeout(scaduto);
    if (!r.ok) {
      return { ok: false, messaggio: `il servizio ha risposto ${r.status}` };
    }
    return { ok: true, messaggio: `inviato a ${destinatario.nome || destinatario.indirizzo}` };
  } catch (e) {
    const m = e?.name === 'AbortError'
      ? 'il servizio non ha risposto in tempo'
      : 'invio non riuscito: serve una connessione a internet';
    return { ok: false, messaggio: m };
  }
}

/**
 * Esempio di funzione Netlify, mostrato nelle impostazioni.
 *
 * Sta qui e non in un file di documentazione perché è la cosa che
 * l'assistente deve avere sotto gli occhi nel momento in cui compila
 * quel campo — non in una pagina da cercare altrove.
 */
export const ESEMPIO_NETLIFY = `// netlify/functions/invia-email.js
//
// ⚠️ SMTP, PORTE E CREDENZIALI VANNO QUI, NON IN AURORA.
//
// Un browser non sa parlare SMTP: quel protocollo non esiste nel
// browser e non ci sarà mai. Perciò server, porta, utente e password
// stanno in QUESTO file e nelle variabili d'ambiente del servizio —
// non nelle impostazioni di Aurora, dove sarebbero leggibili da
// chiunque apra gli strumenti di sviluppo del browser.
//
// Per un provider diverso da Gmail, sostituire il blocco service
// con host, porta e sicurezza espliciti:
//
//   const transporter = nodemailer.createTransport({
//     host: process.env.MAIL_HOST,      // es. smtp.libero.it
//     port: Number(process.env.MAIL_PORT || 587),
//     secure: Number(process.env.MAIL_PORT) === 465,  // 465 sì, 587 no
//     auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
//   });
//
// Se Aurora invia anche i parametri della casella (campo smtp), il
// servizio può usarli e tenere in ambiente SOLO la password — così lo
// stesso servizio serve più installazioni senza riconfigurarlo:
//
//   const s = JSON.parse(event.body).smtp;
//   const transporter = nodemailer.createTransport({
//     host: s?.host || process.env.MAIL_HOST,
//     port: s?.port || Number(process.env.MAIL_PORT || 587),
//     secure: s?.secure ?? false,
//     auth: { user: s?.user || process.env.MAIL_USER, pass: process.env.MAIL_PASS },
//   });
//
// Richiede: npm install nodemailer
// Variabili d'ambiente da impostare su Netlify (Site settings →
// Environment variables): MAIL_USER, MAIL_PASS
// ⚠️ Con Gmail serve una "password per le app", MAI quella principale.

const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Metodo non consentito' };
  try {
    const { to, toName, from, subject, text } = JSON.parse(event.body);
    if (!to || !text) return { statusCode: 400, body: 'Dati mancanti' };

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });

    await transporter.sendMail({
      from: \`"\${from || 'Aurora'}" <\${process.env.MAIL_USER}>\`,
      to, subject: subject || 'Messaggio', text,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};`;
