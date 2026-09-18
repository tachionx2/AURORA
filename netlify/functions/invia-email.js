// netlify/functions/invia-email.js
//
// ══════════════════════════════════════════════════════════════════
// SERVIZIO DI INVIO POSTA
// ══════════════════════════════════════════════════════════════════
//
// Perché serve: un browser non sa parlare SMTP. Quel protocollo non
// esiste nel browser e non ci sarà mai — è una regola di sicurezza del
// web, non un limite di Aurora. Serve qualcosa che stia fuori dal
// browser e spedisca per suo conto.
//
// ══════════════════════════════════════════════════════════════════
// DUE MODI DI CONFIGURARE, E FUNZIONANO ENTRAMBI
// ══════════════════════════════════════════════════════════════════
//
// A) CREDENZIALI DALLE IMPOSTAZIONI DI AURORA — nessuna variabile
//    d'ambiente, nessun redeploy. Chi installa scrive server, porta,
//    casella e password nelle impostazioni del programma: restano nel
//    suo computer e viaggiano cifrate fino a qui, che le usa per quel
//    singolo invio e le dimentica.
//
//    È il modo che permette a UNA SOLA Aurora pubblica di servire
//    tutti: ogni famiglia usa la propria casella.
//
//    ⚠️ Il prezzo: quella password resta nel browser di chi la scrive
//    e finisce nel file di configurazione esportato. Quel file vale
//    la casella di posta — non va mandato in giro.
//
// B) CREDENZIALI QUI, fra le variabili d'ambiente (sotto). Nessun
//    browser le vede mai, ma vanno impostate a mano per ogni
//    installazione.
//
// Se la richiesta porta credenziali complete vince A; altrimenti si
// ricade su B. Chi ha già configurato le variabili d'ambiente non
// deve cambiare nulla: continua a funzionare identico.
//
// ──────────────────────────────────────────────────────────────────
// MODO B — variabili d'ambiente su Netlify
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
// PROTEZIONI (valgono soprattutto per il modo A)
// ──────────────────────────────────────────────────────────────────
//
// ⚠️ Un servizio che accetta credenziali dall'esterno potrebbe essere
// usato da estranei come ponte per spedire. Il rischio è minore di
// quanto sembra — chi lo usasse dovrebbe metterci la PROPRIA casella,
// che verrebbe chiusa subito — ma resta quello di nascondere da dove
// parte la posta. Due difese, nessuna da configurare:
//
//   1. Provenienza. Le credenziali dalla richiesta sono accettate solo
//      se la richiesta arriva dal sito stesso (o da un indirizzo
//      locale, per chi sta provando). Si allarga con:
//
//          MAIL_ORIGINI = https://altro-sito.it,https://ancora-un-altro.it
//
//   2. Lucchetto facoltativo. Impostando
//
//          MAIL_CHIAVE = una-parola-lunga-a-piacere
//
//      il servizio accetta solo richieste che portano la stessa parola
//      (in Aurora: impostazioni → posta → "parola del servizio").
//      Lasciata non impostata, non cambia nulla.
//
// ──────────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');

/**
 * Le provenienze ammesse quando le credenziali arrivano dalla
 * richiesta: il sito stesso, gli indirizzi locali di chi sta provando,
 * più quelli eventualmente elencati in MAIL_ORIGINI.
 *
 * ⚠️ Non è una difesa forte — un programma qualunque può dichiarare
 * ciò che vuole — ma ferma l'uso casuale da parte di chi trovasse
 * l'indirizzo di questo servizio, e non costa niente a chi installa.
 */
function origineAmmessa(origine, hostRichiesta) {
  const dominio = (x) => String(x || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

  const o = dominio(origine);
  if (!o) return false;

  // Chi sta provando in locale, prima di caricare il sito.
  if (o === 'localhost' || o === '127.0.0.1' || o === '[::1]') return true;

  /* ⚠️ Il confronto che conta: la pagina che chiede viene dallo stesso
   * indirizzo a cui è arrivata la richiesta. Non dipende da alcuna
   * variabile d'ambiente — e quindi non può smettere di funzionare
   * perché qualcosa non è stato configurato. */
  if (hostRichiesta && o === dominio(hostRichiesta)) return true;

  const proprie = [process.env.URL, process.env.DEPLOY_URL, process.env.DEPLOY_PRIME_URL];
  const extra = (process.env.MAIL_ORIGINI || '').split(',');
  return [...proprie, ...extra].map(dominio).filter(Boolean).includes(o);
}

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
    /* ⚠️ Con le credenziali nelle impostazioni di Aurora il servizio è
     * pronto ANCHE senza variabili d'ambiente: dirgli "non
     * configurato" manderebbe chi installa a cercare un problema che
     * non c'è. */
    return rispondi(200, {
      servizio: 'invia-email',
      pronto: true,
      ambienteConfigurato: manca.length === 0,
      mancano: manca,
      lucchetto: !!process.env.MAIL_CHIAVE,
      nota: manca.length
        ? 'Pronto. Nessuna casella nelle variabili d\'ambiente: userà server, '
          + 'casella e password scritti nelle impostazioni di Aurora. In '
          + 'alternativa aggiungi ' + manca.join(', ') + ' su Netlify, poi '
          + 'Deploys → Trigger deploy.'
        : 'Pronto, con la casella configurata nelle variabili d\'ambiente. '
          + 'Le credenziali scritte in Aurora, se presenti, hanno la precedenza.',
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
  /* ── Versione con formattazione, facoltativa ──
   *
   * Aurora la manda quando compone la lettera; se manca, si spedisce
   * il solo testo come si è sempre fatto.
   *
   * ⚠️ Il testo semplice viene messo SEMPRE, anche quando c'è l'HTML:
   * è la versione che leggono i programmi di posta più vecchi e le
   * sintesi vocali, ed è anche ciò che distingue un messaggio normale
   * da uno che i filtri antispam guardano con sospetto.
   *
   * Tetto di lunghezza: un corpo enorme farebbe scadere il tempo della
   * funzione, e il messaggio non partirebbe affatto. */
  const html = String(dati.html || '').slice(0, 200000);

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

  /* ⚠️ Lucchetto facoltativo: attivo solo se qualcuno ha impostato
   * MAIL_CHIAVE. Non impostata, questo blocco non fa nulla — chi ha
   * già il servizio in funzione non se ne accorge. */
  if (process.env.MAIL_CHIAVE) {
    if (String(dati.chiave || '') !== String(process.env.MAIL_CHIAVE)) {
      return rispondi(403, { ok: false,
        errore: 'parola del servizio mancante o sbagliata' });
    }
  }

  /* ══ Da dove vengono le credenziali ══
   *
   * Se la richiesta ne porta di complete (server + casella +
   * password) si usano quelle: è il modo che permette a una sola
   * Aurora pubblica di servire più famiglie, ognuna con la propria
   * casella, senza toccare le variabili d'ambiente.
   *
   * Altrimenti si ricade sulle variabili d'ambiente, esattamente come
   * prima: un'installazione già configurata non cambia comportamento. */
  const s = (dati.smtp && typeof dati.smtp === 'object') ? dati.smtp : null;
  const daRichiesta = !!(s && s.host && s.user && s.pass);

  let user, pass, trasporto, mittenteDefault;

  if (daRichiesta) {
    /* ⚠️ Credenziali dall'esterno: si accettano solo da chi arriva dal
     * sito. Senza questo controllo il servizio sarebbe un ponte
     * anonimo utilizzabile da chiunque ne scoprisse l'indirizzo. */
    const h = event.headers || {};
    const origine = h.origin || h.Origin || h.referer || h.Referer || '';
    const host = h['x-forwarded-host'] || h['X-Forwarded-Host'] || h.host || h.Host || '';
    if (!origineAmmessa(origine, host)) {
      return rispondi(403, { ok: false,
        errore: 'provenienza non ammessa per credenziali inviate dal programma. '
              + 'Chi installa può autorizzarla con la variabile MAIL_ORIGINI.' });
    }

    user = String(s.user);
    pass = String(s.pass);
    const porta = Number(s.port) || 587;
    trasporto = {
      host: String(s.host),
      port: porta,
      // La 465 è cifrata dall'inizio, la 587 si cifra dopo il saluto.
      secure: s.secure === undefined ? porta === 465 : !!s.secure,
      auth: { user, pass },
    };
    // Con credenziali proprie il mittente è la casella di chi spedisce:
    // MAIL_FROM appartiene all'altra configurazione e non va imposto.
    mittenteDefault = user;
  } else {
    user = process.env.MAIL_USER;
    pass = process.env.MAIL_PASS;
    if (!user || !pass) {
      /* ⚠️ Messaggio esplicito sulle DUE strade: chi legge questo
       * errore sta cercando di capire cosa gli manca, e la risposta
       * può essere «niente su Netlify, ti manca la password nelle
       * impostazioni di Aurora». */
      const manca = s && s.host && s.user && !s.pass
        ? 'manca la password della casella nelle impostazioni di Aurora'
        : 'nessuna casella configurata: scrivi server, casella e password '
          + 'nelle impostazioni di Aurora, oppure imposta MAIL_USER e '
          + 'MAIL_PASS fra le variabili d\'ambiente del servizio';
      return rispondi(500, { ok: false, errore: manca });
    }
    /* Due modi di configurare, secondo ciò che si è impostato:
     * il nome abbreviato del provider, oppure server e porta espliciti. */
    if (process.env.MAIL_SERVICE) {
      trasporto = { service: process.env.MAIL_SERVICE, auth: { user, pass } };
    } else {
      const porta = Number(process.env.MAIL_PORT || 587);
      trasporto = {
        host: process.env.MAIL_HOST,
        port: porta,
        secure: porta === 465,
        auth: { user, pass },
      };
    }
    mittenteDefault = process.env.MAIL_FROM || user;
  }

  /* Il nome che comparirà come mittente, se è stato scelto. Senza,
   * resta il solo indirizzo, come prima. */
  const nome = String(dati.from || dati.mittente || '').trim().replace(/["<>\r\n]/g, '');
  const from = nome ? `"${nome}" <${mittenteDefault}>` : mittenteDefault;

  try {
    const transporter = nodemailer.createTransport(trasporto);
    await transporter.sendMail({
      from,
      to: a,
      subject: oggetto,
      text: testo,
      ...(html ? { html } : {}),
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
