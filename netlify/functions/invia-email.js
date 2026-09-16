// netlify/functions/invia-email.js
//
// ══════════════════════════════════════════════════════════════════
// SERVIZIO DI INVIO POSTA
// ══════════════════════════════════════════════════════════════════
//
// ⚠️ Questo file NON fa nulla finché non viene configurato. Senza le
// variabili d'ambiente risponde con un errore chiaro e si ferma. Chi
// non usa la posta può ignorarlo del tutto: sta qui pronto, non
// attivo.
//
// Perché serve: un browser non sa parlare SMTP. Quel protocollo non
// esiste nel browser e non ci sarà mai — è una regola di sicurezza del
// web, non un limite di Aurora. Serve qualcosa che stia fuori dal
// browser e spedisca per suo conto.
//
// ⚠️ E soprattutto: SERVER, PORTA, UTENTE E PASSWORD STANNO QUI, NON
// IN AURORA. Nelle impostazioni del programma sarebbero leggibili da
// chiunque apra gli strumenti di sviluppo del browser.
//
// ──────────────────────────────────────────────────────────────────
// COME CONFIGURARLO — variabili d'ambiente su Netlify
// (Site configuration → Environment variables)
// ──────────────────────────────────────────────────────────────────
//
// Con Gmail — due variabili:
//
//     MAIL_SERVICE = gmail
//     MAIL_USER    = tuonome@gmail.com
//     MAIL_PASS    = la password per le APPLICAZIONI (16 caratteri)
//
//   ⚠️ Mai la password principale. Su myaccount.google.com →
//   Sicurezza → "Password per le app".
//
// Con QUALUNQUE altro provider — quattro variabili, e nessuna
// password speciale da generare:
//
//     MAIL_HOST = smtp.libero.it        (o quello del tuo provider)
//     MAIL_PORT = 587                   (oppure 465)
//     MAIL_USER = tuonome@libero.it
//     MAIL_PASS = la password normale della casella
//
//   Indirizzi dei provider più comuni:
//     Libero   smtp.libero.it       porta 465
//     Aruba    smtps.aruba.it       porta 465
//     Outlook  smtp-mail.outlook.com porta 587
//     Yahoo    smtp.mail.yahoo.com  porta 465
//     Zoho     smtp.zoho.eu         porta 465
//
//   ⚠️ Con molti provider italiani è più semplice che con Gmail:
//   bastano indirizzo e password normali, senza generare nulla.
//
// Facoltative:
//     MAIL_FROM     mittente mostrato, se diverso da MAIL_USER
//     MAIL_ALLOWED  destinatari ammessi, separati da virgola.
//                   ⚠️ Consigliata: senza, chiunque conosca
//                   l'indirizzo di questo servizio può usarlo per
//                   spedire a chiunque.
//
// Dopo aver aggiunto le variabili serve un nuovo caricamento del
// sito: Deploys → Trigger deploy. Valgono dal caricamento successivo.
//
// ──────────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');

/** Risposta con intestazioni per il browser. */
function rispondi(statusCode, corpo) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(corpo),
  };
}

exports.handler = async (event) => {
  // Il browser chiede il permesso prima di inviare: va concesso.
  if (event.httpMethod === 'OPTIONS') return rispondi(200, { ok: true });

  /* ⚠️ Aperto nel browser risponde in modo UTILE invece che con un
   * errore secco: è il modo più rapido per sapere se il servizio è
   * stato caricato e configurato, senza dover spedire nulla. */
  if (event.httpMethod === 'GET') {
    const manca = [];
    if (!process.env.MAIL_USER) manca.push('MAIL_USER');
    if (!process.env.MAIL_PASS) manca.push('MAIL_PASS');
    if (!process.env.MAIL_SERVICE && !process.env.MAIL_HOST) {
      manca.push('MAIL_SERVICE oppure MAIL_HOST');
    }
    return rispondi(200, {
      servizio: 'invia-email',
      pronto: manca.length === 0,
      mancano: manca,
      nota: manca.length
        ? 'Aggiungi queste variabili su Netlify, poi Deploys → Trigger deploy.'
        : 'Configurato. Aurora può spedire a questo indirizzo.',
    });
  }

  if (event.httpMethod !== 'POST') {
    return rispondi(405, { ok: false, errore: 'metodo non consentito' });
  }

  let dati;
  try { dati = JSON.parse(event.body || '{}'); }
  catch { return rispondi(400, { ok: false, errore: 'richiesta illeggibile' }); }

  const a = String(dati.to || dati.destinatario || '').trim();
  const testo = String(dati.text || dati.testo || '').trim();
  const oggetto = String(dati.subject || dati.oggetto || 'Messaggio da Aurora').trim();

  if (!a || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) {
    return rispondi(400, { ok: false, errore: 'destinatario non valido' });
  }
  if (!testo) return rispondi(400, { ok: false, errore: 'messaggio vuoto' });

  /* ⚠️ Elenco dei destinatari ammessi, se impostato.
   *
   * Senza, chiunque scopra l'indirizzo di questo servizio può usarlo
   * per spedire posta a chiunque, a nome della casella configurata. */
  const ammessi = (process.env.MAIL_ALLOWED || '')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (ammessi.length && !ammessi.includes(a.toLowerCase())) {
    return rispondi(403, { ok: false, errore: 'destinatario non ammesso' });
  }

  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;
  if (!user || !pass) {
    return rispondi(500, { ok: false,
      errore: 'servizio non configurato: mancano MAIL_USER o MAIL_PASS' });
  }

  /* Due modi di configurare, secondo ciò che si è impostato:
   * il nome abbreviato del provider, oppure server e porta espliciti. */
  let trasporto;
  if (process.env.MAIL_SERVICE) {
    trasporto = { service: process.env.MAIL_SERVICE, auth: { user, pass } };
  } else {
    const porta = Number(process.env.MAIL_PORT || 587);
    trasporto = {
      host: process.env.MAIL_HOST,
      port: porta,
      // La 465 è cifrata dall'inizio, la 587 si cifra dopo il saluto.
      secure: porta === 465,
      auth: { user, pass },
    };
  }

  try {
    const transporter = nodemailer.createTransport(trasporto);
    await transporter.sendMail({
      from: process.env.MAIL_FROM || user,
      to: a,
      subject: oggetto,
      text: testo,
    });
    return rispondi(200, { ok: true });
  } catch (e) {
    /* ⚠️ Si riporta il motivo del provider invece di un generico
     * "non riuscito": «Invalid login» dice a chi installa esattamente
     * cosa correggere, «errore» non dice nulla — e chi riceve questo
     * messaggio lo sente letto ad alta voce. */
    return rispondi(502, { ok: false,
      errore: String(e && e.message ? e.message : e).slice(0, 300) });
  }
};
