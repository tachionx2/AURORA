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
 * ⚠️ DOVE STANNO LE CREDENZIALI — due strade, entrambe valide.
 *
 * 1. Nella configurazione locale (email.smtpPass). Viaggiano dentro
 *    la richiesta, sotto HTTPS, e il servizio le usa per quel singolo
 *    invio senza conservarle. Così una sola Aurora pubblica serve
 *    tutti: ogni famiglia ha la propria casella e nessuno deve
 *    toccare le variabili d'ambiente del servizio.
 *
 *    ⚠️ Il prezzo: quella password resta nel browser e finisce nel
 *    file di configurazione esportato. Quel file vale la casella.
 *
 * 2. Sul servizio, fra le sue variabili d'ambiente. Nessun browser la
 *    vede mai, ma va configurata a mano per ogni installazione.
 *
 * Se la password locale è vuota non viene trasmesso nulla e il
 * servizio ricade sulle proprie variabili: chi ha già configurato
 * Netlify continua a spedire esattamente come prima.
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
  /* ⚠️ Credenziali a metà: è lo stato più insidioso. Con la password
   * scritta ma senza server o casella, il servizio riceve dati
   * incompleti e risponde con un errore tecnico che non dice nulla a
   * chi installa. Meglio accorgersene qui.
   *
   * Password vuota NON è un problema: significa che la casella è
   * configurata sul servizio, ed è una scelta legittima. */
  if (e.smtpPass) {
    if (!e.smtpHost) problemi.push('c\'è la password ma manca il server di posta (SMTP)');
    if (!e.smtpUser) problemi.push('c\'è la password ma manca l\'indirizzo della casella in uscita');
  }
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
     * La password si aggiunge SOLO se è stata scritta: vuota, non
     * compare proprio nella richiesta e il servizio ricade sulle
     * proprie variabili d'ambiente, come faceva prima. */
    ...(E.smtpHost ? {
      smtp: {
        host: E.smtpHost,
        port: Number(E.smtpPort) || 587,
        secure: !!E.smtpSicuro,
        user: E.smtpUser || '',
        ...(E.smtpPass ? { pass: E.smtpPass } : {}),
      },
    } : {}),
    /* Lucchetto del servizio, se chi installa ne ha messo uno. */
    ...(E.chiaveServizio ? { chiave: E.chiaveServizio } : {}),
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
      /* ⚠️ Il servizio spiega COSA non va («Invalid login», «password
       * mancante»): riportarlo cambia la vita a chi installa, mentre
       * un numero secco non dice nulla. Se il corpo non si legge si
       * resta al numero: mai un'eccezione qui. */
      let dettaglio = '';
      try {
        const d = await r.json();
        if (d && d.errore) dettaglio = ': ' + String(d.errore).slice(0, 200);
      } catch { /* corpo illeggibile: pazienza, resta il numero */ }
      return { ok: false, messaggio: `il servizio ha risposto ${r.status}${dettaglio}` };
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
// ⚠️ QUESTO È SOLO UN ESEMPIO MINIMO, da leggere per capire come
// funziona. Il servizio VERO è già dentro Aurora, nella cartella
// netlify/functions/, ed è più completo di questo: accetta le
// credenziali scritte nelle impostazioni del programma oppure le
// proprie variabili d'ambiente, e si difende dall'uso da parte di
// estranei. Non c'è niente da copiare.
//
// Un browser non sa parlare SMTP: quel protocollo non esiste nel
// browser e non ci sarà mai. Per questo serve comunque un servizio
// come questo, ovunque stiano le credenziali.
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
// Se Aurora invia anche i parametri della casella (campo smtp,
// password compresa), il servizio può usare quelli — così lo stesso
// servizio serve più installazioni senza riconfigurarlo:
//
//   const s = JSON.parse(event.body).smtp;
//   const transporter = nodemailer.createTransport({
//     host: s?.host || process.env.MAIL_HOST,
//     port: s?.port || Number(process.env.MAIL_PORT || 587),
//     secure: s?.secure ?? false,
//     auth: { user: s?.user || process.env.MAIL_USER,
//             pass: s?.pass || process.env.MAIL_PASS },
//   });
//
// ⚠️ Accettando credenziali dall'esterno, controllare SEMPRE che la
// richiesta arrivi dal proprio sito: altrimenti chiunque ne scopra
// l'indirizzo può usarlo come ponte per spedire. Il servizio incluso
// in Aurora lo fa già.
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
