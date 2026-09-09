/**
 * Invio di messaggi su Telegram.
 *
 * ⚠️ Perché Telegram e non WhatsApp: WhatsApp non permette di inviare
 * messaggi da una pagina web. Esiste un'interfaccia ufficiale, ma è
 * pensata per le aziende, richiede verifica commerciale e ha un costo
 * per messaggio. Telegram invece mette a disposizione un'interfaccia
 * gratuita e diretta, pensata anche per usi come questo.
 *
 * ⚠️ Questo modulo non tocca in alcun modo il percorso del segnale.
 * Riceve un testo, lo manda, e restituisce un esito. Se fallisce,
 * fallisce da solo.
 */

const BASE = 'https://api.telegram.org/bot';

/**
 * Manda un messaggio a un destinatario.
 *
 * @returns {Promise<{ok:boolean, errore?:string, dettaglio?:string}>}
 *
 * ⚠️ Non solleva mai eccezioni: restituisce sempre un esito. Un errore
 * di rete non deve poter fermare la scansione, che è l'unico modo che
 * la persona ha di comunicare.
 */
export async function invia(cfg, destinatario, testo) {
  const T = cfg?.telegram;
  if (!T?.enabled) return { ok: false, errore: 'Telegram non è attivo' };
  const token = (T.token || '').trim();
  if (!token) return { ok: false, errore: 'gettone del robot non impostato' };
  const dove = String(destinatario?.chatId ?? destinatario?.id ?? '').trim();
  if (!dove) return { ok: false, errore: 'destinatario senza identificativo' };
  if (!testo || !testo.trim()) return { ok: false, errore: 'nessun testo da mandare' };

  /* Con un tetto di tempo: una richiesta che non torna lascerebbe la
   * persona in attesa senza sapere se il messaggio è partito. */
  const controllo = new AbortController();
  const scadenza = setTimeout(() => controllo.abort(),
                              Math.max(3000, (T.attesaSec || 20) * 1000));
  try {
    const r = await fetch(`${BASE}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: dove,
        text: T.firma ? `${testo}\n\n— ${T.firma}` : testo,
        disable_notification: !!T.silenzioso,
      }),
      signal: controllo.signal,
    });
    clearTimeout(scadenza);
    const dati = await r.json().catch(() => null);
    if (!r.ok || !dati?.ok) {
      /* ⚠️ Si riporta la descrizione di Telegram invece di un generico
       * "errore": "chat not found" dice a chi assiste esattamente cosa
       * correggere, "impossibile inviare" non dice nulla. */
      return { ok: false,
               errore: descriviErrore(dati?.description, r.status),
               dettaglio: dati?.description || '' };
    }
    return { ok: true };
  } catch (e) {
    clearTimeout(scadenza);
    if (e?.name === 'AbortError') return { ok: false, errore: 'Telegram non ha risposto in tempo' };
    return { ok: false, errore: 'Telegram non raggiungibile',
             dettaglio: String(e?.message || e).slice(0, 200) };
  }
}

/**
 * Traduce l'errore di Telegram in qualcosa di utile.
 *
 * ⚠️ Il messaggio viene LETTO AD ALTA VOCE a chi non può leggere lo
 * schermo: deve dire cosa fare, non cosa è andato storto.
 */
export function descriviErrore(descrizione, stato) {
  const d = String(descrizione || '').toLowerCase();
  if (d.includes('chat not found')) {
    return 'destinatario non trovato: deve aver scritto almeno una volta al robot';
  }
  if (d.includes('bot was blocked')) return 'il destinatario ha bloccato il robot';
  if (d.includes('unauthorized') || stato === 401) return 'gettone del robot non valido';
  if (d.includes('too many requests')) return 'troppi messaggi di seguito: riprovare fra poco';
  return descrizione ? `Telegram dice: ${descrizione}` : `Telegram ha risposto ${stato}`;
}

/**
 * Verifica che il gettone funzioni e restituisce il nome del robot.
 *
 * Serve al pulsante "prova": sapere PRIMA che il gettone è giusto
 * evita di scoprirlo quando la persona sta cercando di mandare un
 * messaggio che le importa.
 */
export async function prova(cfg) {
  const token = (cfg?.telegram?.token || '').trim();
  if (!token) return { ok: false, errore: 'gettone non impostato' };
  try {
    const r = await fetch(`${BASE}${token}/getMe`);
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) return { ok: false, errore: descriviErrore(d?.description, r.status) };
    return { ok: true, nome: d.result?.username || d.result?.first_name || 'robot' };
  } catch (e) {
    return { ok: false, errore: 'Telegram non raggiungibile' };
  }
}

/**
 * Istruzioni per chi installa.
 *
 * ⚠️ Il punto meno ovvio, e quello su cui ci si blocca sempre: un
 * robot non può scrivere per primo. Ogni destinatario deve aprire una
 * conversazione con il robot almeno una volta, altrimenti Telegram
 * rifiuta il messaggio con "chat not found".
 */
export const ISTRUZIONI = [
  'COME PREPARARE TELEGRAM',
  '',
  '1. Su Telegram cerca @BotFather e apri una conversazione.',
  '2. Scrivi /newbot e segui le domande: nome del robot e nome utente.',
  '3. BotFather risponde con un gettone lungo. Copialo nel campo qui sotto.',
  '',
  '4. Per ogni persona che deve ricevere i messaggi:',
  '   · deve cercare il robot su Telegram e scrivergli qualcosa, anche solo "ciao".',
  '     ⚠️ Senza questo passaggio Telegram rifiuta il messaggio: un robot non',
  '     può scrivere per primo a nessuno. È la protezione contro lo spam.',
  '   · poi apri https://api.telegram.org/bot<GETTONE>/getUpdates nel browser',
  '     e cerca "chat":{"id":NUMERO — quel numero è il suo identificativo.',
  '',
  '5. Per un CANALE: aggiungi il robot come amministratore del canale, e usa',
  '   come identificativo @nomecanale invece del numero.',
  '',
  'Il gettone resta su questo computer, come tutte le altre impostazioni.',
].join('\n');
