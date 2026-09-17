/**
 * Assistente conversazionale.
 *
 * Permette di mandare una domanda e ascoltarne la risposta. Per chi
 * comunica con un solo movimento, è la differenza fra poter DIRE e
 * poter anche CHIEDERE.
 *
 * ⚠️ Questo modulo non tocca in alcun modo il percorso del segnale.
 * Riceve un testo, restituisce un testo. Se fallisce, fallisce da solo.
 *
 * ⚠️ La chiave di accesso resta sul computer di chi usa il programma,
 * come tutte le altre impostazioni. Non viene mai inviata altrove che
 * al servizio scelto.
 */

/** Servizi riconosciuti, con i loro indirizzi e formati. */
export const PROVIDER_AI = {
  openrouter: {
    nome: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    formato: 'openai',
    modelli: [
      /* ⚠️ Il primo dell'elenco, ed è quello giusto per Aurora.
       *
       * `openrouter/free` sceglie da solo un modello fra quelli
       * gratuiti disponibili, filtrando per ciò che la richiesta
       * richiede. Non costa nulla — né il router né le richieste che
       * instrada — e non obbliga a inseguire quale sia il modello
       * gratuito del mese, che cambia di continuo.
       *
       * Per un programma che deve restare gratuito per sempre, è
       * l'unica scelta coerente. */
      'openrouter/free',
      /* Scelta automatica fra TUTTI i modelli, anche a pagamento:
       * sceglie il più adatto invece del più economico. Va usato
       * sapendo che può comportare un costo. */
      'openrouter/auto',
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemma-2-9b-it:free',
      'mistralai/mistral-7b-instruct:free',
    ],
    nota: ['Ha modelli gratuiti. La chiave si ottiene registrandosi su openrouter.ai.',
           'Has free models. Get a key at openrouter.ai.'],
  },
  deepseek: {
    nome: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    formato: 'openai',
    /* ⚠️ `deepseek-chat` e `deepseek-reasoner` sono stati RITIRATI il
     * 24 luglio 2026: le chiamate con quei nomi ora falliscono. Erano
     * l'unica voce di questo elenco, quindi il servizio non avrebbe
     * funzionato affatto.
     *
     * `deepseek-v4-flash` è il successore economico — un milione di
     * token di contesto e costi molto bassi — e `deepseek-v4-pro`
     * quello più capace. */
    modelli: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    nota: ['Molto economico. Chiave da platform.deepseek.com.',
           'Very cheap. Key from platform.deepseek.com.'],
  },
  google: {
    nome: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    formato: 'gemini',
    modelli: ['gemini-2.0-flash', 'gemini-1.5-flash'],
    nota: ['Chiave da aistudio.google.com.', 'Key from aistudio.google.com.'],
  },
  openai: {
    nome: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    formato: 'openai',
    modelli: ['gpt-4o-mini', 'gpt-4o'],
    nota: ['Chiave da platform.openai.com.', 'Key from platform.openai.com.'],
  },
  anthropic: {
    nome: 'Anthropic Claude',
    url: 'https://api.anthropic.com/v1/messages',
    formato: 'anthropic',
    modelli: ['claude-3-5-haiku-latest', 'claude-sonnet-4-5'],
    nota: ['Chiave da console.anthropic.com.', 'Key from console.anthropic.com.'],
  },
  personale: {
    nome: 'Altro servizio',
    url: '',
    formato: 'openai',
    modelli: [],
    nota: ['Per un servizio proprio che parli come quelli di OpenAI.',
           'For a custom service speaking the OpenAI dialect.'],
  },
};

/**
 * Istruzione data all'assistente.
 *
 * ⚠️ Chiede risposte BREVI, ed è la cosa più importante di tutto il
 * modulo: la risposta viene ascoltata, non letta. Un paragrafo che a
 * schermo si scorre in un istante, ad alta voce dura un minuto — e chi
 * ascolta non può dire "basta" con la stessa facilità con cui si
 * distoglie lo sguardo.
 */
export function istruzione(maxParole, lingua = 'it') {
  const n = Math.max(10, Math.round(maxParole || 100));
  /* ⚠️ La lingua va ripetuta, e in modo perentorio.
   *
   * I modelli gratuiti sono piccoli e con un testo di partenza corto e
   * troncato — «DOC AFRICA» — perdono facilmente la lingua: rispondono
   * in un misto di spagnolo, rumeno e inglese. Per chi ascolta e non
   * può rileggere, una risposta in una lingua che non conosce è una
   * risposta persa del tutto.
   *
   * Dirlo una volta sola all'inizio non basta: va detto all'inizio e
   * ribadito alla fine, che è il punto che il modello ha più fresco. */
  const L = lingua === 'en' ? 'ENGLISH' : 'ITALIANO';
  return [
    `Rispondi SEMPRE e SOLTANTO in ${L}, qualunque sia la lingua della domanda.`,
    `Rispondi in ${L} usando AL MASSIMO ${n} parole.`,
    'La risposta verrà LETTA AD ALTA VOCE a una persona che non può interromperti,',
    'quindi vai al punto senza premesse, elenchi o formattazione.',
    'Se la domanda è ambigua, scegli l\'interpretazione più probabile e rispondi:',
    'chiedere chiarimenti costa a chi ascolta molto più che a te.',
    `Preferisci una risposta completa e più corta di ${n} parole a una risposta`,
    'che si interrompe a metà.',
    `Anche se la domanda è breve, incompleta o abbreviata, interpretala e rispondi in ${L}.`,
    `RICORDA: massimo ${n} parole, lingua ${L}.`,
  ].join(' ');
}

/** Istruzione predefinita, con il limite predefinito. */
export const ISTRUZIONE = istruzione(100);

/** Estrae il testo dalla risposta, qualunque sia il formato. */
function estraiTesto(dati, formato) {
  if (formato === 'gemini') {
    const parti = dati?.candidates?.[0]?.content?.parts;
    return Array.isArray(parti) ? parti.map(p => p?.text || '').join('') : '';
  }
  if (formato === 'anthropic') {
    const c = dati?.content;
    return Array.isArray(c) ? c.filter(x => x?.type === 'text').map(x => x.text).join('') : '';
  }
  return dati?.choices?.[0]?.message?.content || '';
}

/**
 * Manda una domanda e restituisce la risposta.
 *
 * @returns {Promise<{ok: boolean, testo?: string, errore?: string}>}
 *
 * ⚠️ Non solleva mai eccezioni: restituisce sempre un esito. Un errore
 * di rete non deve poter fermare la scansione, che è l'unico modo che
 * la persona ha di comunicare.
 */
export async function chiedi(cfg, domanda, opzioni = {}) {
  const A = cfg?.assistente;
  if (!A?.enabled) return { ok: false, errore: 'assistente non attivo' };
  if (!domanda || !domanda.trim()) return { ok: false, errore: 'nessuna domanda' };

  const prov = PROVIDER_AI[A.provider] || PROVIDER_AI.openrouter;
  const url = (A.provider === 'personale' ? A.url : prov.url) || prov.url;
  /* Senza indicazione si usa il primo dell'elenco, che per OpenRouter
   * è il router gratuito: chi non sceglie non deve trovarsi un costo. */
  const modello = (A.modello || '').trim() || prov.modelli[0] || '';
  /* ⚠️ Una chiave PER SERVIZIO.
   *
   * Con una chiave sola, cambiare fornitore per provarne un altro
   * significava cancellare la precedente e riscriverla per tornare
   * indietro. Chi installa deve poterne tenere diverse e passare
   * dall'una all'altra scegliendo il fornitore, senza riscrivere
   * nulla. */
  const chiave = ((A.chiavi?.[A.provider] ?? A.chiave) || '').trim();
  if (!url) return { ok: false, errore: 'indirizzo del servizio non impostato' };
  if (!chiave && A.provider !== 'personale') {
    return { ok: false, errore: 'chiave di accesso non impostata' };
  }

  /* ⚠️ Il limite si CHIEDE all'assistente, non si applica tagliando.
   *
   * Prima serviva solo a limitare la risposta dall'esterno: l'assistente
   * non lo sapeva, scriveva quanto voleva, e la risposta veniva
   * troncata a metà frase. Chiedere "al massimo N parole" produce
   * invece una risposta compiuta e della lunghezza voluta.
   *
   * Il tetto tecnico resta, ma largo: serve solo come rete di
   * sicurezza contro una risposta interminabile, non come strumento
   * di misura. */
  const nParole = opzioni.maxParole || A.maxParole || 100;
  const lingua = opzioni.lingua || cfg?.ui?.language || 'it';
  const testoIstruzione = opzioni.istruzione
    || ((A.istruzione && A.istruzione.trim()) ? A.istruzione : istruzione(nParole, lingua));
  /* ⚠️ Il tetto tecnico segue il limite chiesto, invece di essere
   * fisso: con un tetto a quattromila token una richiesta da duemila
   * parole sarebbe stata tagliata a metà — e il taglio è proprio ciò
   * che questo meccanismo esiste per evitare. */
  const maxTok = Math.max(120, Math.min(32000, Math.round(nParole * 4)));

  let indirizzo = url, intestazioni = { 'Content-Type': 'application/json' }, corpo;

  if (prov.formato === 'gemini') {
    indirizzo = `${url}/${modello}:generateContent?key=${encodeURIComponent(chiave)}`;
    corpo = {
      systemInstruction: { parts: [{ text: testoIstruzione }] },
      contents: [{ role: 'user', parts: [{ text: domanda }] }],
      generationConfig: { maxOutputTokens: maxTok },
      // Gemini chiede la ricerca come strumento, non come suffisso.
      ...(opzioni.ricerca ? { tools: [{ google_search: {} }] } : {}),
    };
  } else if (prov.formato === 'anthropic') {
    intestazioni['x-api-key'] = chiave;
    intestazioni['anthropic-version'] = '2023-06-01';
    corpo = { model: modello, max_tokens: maxTok, system: testoIstruzione,
              messages: [{ role: 'user', content: domanda }] };
  } else {
    if (chiave) intestazioni.Authorization = `Bearer ${chiave}`;
    /* ⚠️ Con la ricerca, OpenRouter vuole il suffisso `:online`: è il
     * modo con cui si chiede al modello di guardare davvero sul web
     * invece di rispondere a memoria. */
    const modelloUsato = (opzioni.ricerca && A.provider === 'openrouter'
      && !/:online$/.test(modello)) ? `${modello}:online` : modello;
    corpo = {
      model: modelloUsato, max_tokens: maxTok,
      messages: [{ role: 'system', content: testoIstruzione },
                 { role: 'user', content: domanda }],
    };
    /* ⚠️ Sui modelli V4 di DeepSeek il ragionamento è ATTIVO di
     * default, e per una risposta breve è solo un costo: aggiunge
     * secondi di attesa e token pagati per un ragionamento che nessuno
     * leggerà. Chi aspetta una risposta parlata vuole che arrivi
     * presto. */
    if (/^deepseek-v4/.test(modello)) corpo.thinking = { type: 'disabled' };
  }

  /* ⚠️ Con un tetto di tempo.
   *
   * Senza, una risposta che non arriva lascerebbe la persona in attesa
   * senza sapere se il programma sta ancora lavorando — e senza modo di
   * annullare. Meglio dire "non ha risposto" dopo qualche secondo. */
  const controllo = new AbortController();
  const scadenza = setTimeout(() => controllo.abort(),
                              Math.max(3000, (A.attesaSec || 25) * 1000));
  try {
    const r = await fetch(indirizzo, {
      method: 'POST', headers: intestazioni,
      body: JSON.stringify(corpo), signal: controllo.signal,
      ...(opzioni.fetchExtra || {}),
    });
    clearTimeout(scadenza);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, errore: `il servizio ha risposto ${r.status}`, dettaglio: t.slice(0, 200) };
    }
    const dati = await r.json();
    const testo = (estraiTesto(dati, prov.formato) || '').trim();
    if (!testo) return { ok: false, errore: 'risposta vuota' };
    return { ok: true, testo: ripulisci(testo) };
  } catch (e) {
    clearTimeout(scadenza);
    if (e?.name === 'AbortError') return { ok: false, errore: 'il servizio non ha risposto in tempo' };
    return { ok: false, errore: 'non raggiungibile', dettaglio: String(e?.message || e).slice(0, 200) };
  }
}

/**
 * ══════════════════════════════════════════════════════════════════
 * CERCARE UN VIDEO
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ Serve la RICERCA SUL WEB, e non è un dettaglio.
 *
 * Un assistente conversazionale non cerca su YouTube: ricorda
 * identificativi visti durante l'addestramento. Molti sono vecchi,
 * alcuni rimossi, e qualcuno inventato di sana pianta — con la stessa
 * sicurezza di uno vero. Chi chiede "documentario africa" si
 * troverebbe una pagina che non esiste, senza capire perché.
 *
 * Con la ricerca attiva l'assistente guarda davvero, e l'indirizzo che
 * restituisce è un indirizzo che ha visto.
 */
export const ISTRUZIONE_VIDEO = (lingua = 'it', ripiego = 0) => {
  const NOMI = { it: 'italiano', en: 'inglese' };
  /* ⚠️ Tre passaggi, in ordine di preferenza.
   *
   * Chi ascolta non può capire un video in una lingua che non conosce:
   * per lui un documentario in rumeno è un documentario che non esiste.
   * Ma un video nella lingua sbagliata resta meglio di nessun video —
   * quindi si insiste sulla lingua, e solo dopo si cede.
   *
   * 0 = la lingua della persona · 1 = inglese · 2 = qualunque. */
  const L = ripiego === 0 ? (NOMI[lingua] || 'italiano')
    : ripiego === 1 ? 'inglese' : null;
  return [
    `Sei un assistente che cerca video su YouTube per una persona che`,
    `può muovere un solo occhio e non può navigare il web da sola.`,
    `Cerca su internet e rispondi con l'INDIRIZZO COMPLETO del video YouTube`,
    (L
      ? `più pertinente e più visto sull'argomento, PARLATO IN ${L.toUpperCase()}.`
      : `più pertinente e più visto sull'argomento, in qualunque lingua.`),
    `Rispondi con il solo indirizzo, per esempio:`,
    `https://www.youtube.com/watch?v=XXXXXXXXXXX`,
    `Puoi aggiungere dopo l'indirizzo un trattino e il titolo.`,
    `⚠️ SCEGLI SEMPRE il migliore fra i risultati che hai trovato:`,
    `chi legge non può cercare da sé, quindi un video imperfetto vale`,
    `infinitamente più di nessun video.`,
    `Rispondi "NIENTE" soltanto se la ricerca non ha restituito alcun risultato.`,
  ].join(' ');
};

/**
 * Espande le abbreviazioni con cui si scrive componendo lettera per
 * lettera.
 *
 * ⚠️ Chi scrive con un gesto solo abbrevia per forza: «doc africa»
 * costa metà del tempo di «documentario sull'Africa». Ma un modello che
 * riceve «doc africa» non sa che «doc» sta per documentario, e cerca
 * male o non cerca affatto.
 *
 * L'espansione si fa QUI, non chiedendola al modello: è un lavoro
 * meccanico e prevedibile, e farlo fare a lui aggiungerebbe un modo in
 * più di sbagliare.
 */
const ABBREVIAZIONI = {
  doc: 'documentario', docum: 'documentario', film: 'film',
  mus: 'musica', can: 'canzone', conc: 'concerto',
  tg: 'telegiornale', doc2: 'documentario',
};

export function espandiArgomento(testo) {
  return String(testo || '')
    .split(/\s+/)
    .map(p => ABBREVIAZIONI[p.toLowerCase()] || p)
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * ══════════════════════════════════════════════════════════════════
 * CERCARE DAVVERO SU YOUTUBE
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ Il modello NON deve fornire l'indirizzo. Mai.
 *
 * I registri di una prova reale lo mostrano senza appello: tre
 * richieste, tre identificativi inventati, tutti inesistenti. I titoli
 * erano plausibili — "AFRICA SELVAGGIA, documentario completo" — e la
 * forma dell'indirizzo corretta, ma nessuno dei tre video esisteva.
 *
 * Un modello che cerca davvero non sbaglia tre volte su tre: copia
 * l'indirizzo dalla pagina che ha letto. Questi li COMPONEVA, undici
 * caratteri alla volta. E lo stesso difetto spiega "film giallo" che
 * diventa un trailer di Avengers: senza cercare, associa a memoria.
 *
 * La causa: i modelli gratuiti non sanno navigare, e il suffisso che
 * chiede la ricerca viene accettato senza che la ricerca avvenga.
 *
 * Il rimedio è cambiare chi fa cosa. Al modello si chiede solo ciò che
 * sa fare bene — trasformare "doc africa" in una buona frase di
 * ricerca — e l'indirizzo lo si prende da un motore di ricerca VERO,
 * che restituisce solo video esistenti perché li ha appena trovati.
 *
 * Si usano i servizi pubblici di Piped, che non richiedono alcuna
 * chiave. Se uno non risponde si passa al successivo: sono gestiti da
 * volontari e capita che vadano giù.
 */
const CERCATORI = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.yt',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.reallyaweso.me',
];

export async function cercaSuYouTube(query, quanti = 6) {
  for (const base of CERCATORI) {
    try {
      const u = `${base}/search?q=${encodeURIComponent(query)}&filter=videos`;
      const r = await fetch(u, { signal: AbortSignal.timeout?.(8000) });
      if (!r.ok) continue;
      const d = await r.json();
      const items = Array.isArray(d?.items) ? d.items : [];
      const fuori = [];
      for (const it of items) {
        /* L'identificativo sta in fondo all'indirizzo relativo:
         * "/watch?v=XXXXXXXXXXX". */
        const id = String(it?.url || '').match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1];
        if (!id || fuori.some(x => x.id === id)) continue;
        fuori.push({
          id,
          titolo: String(it?.title || '').slice(0, 140),
          durata: Number(it?.duration) || 0,
          viste: Number(it?.views) || 0,
        });
        if (fuori.length >= quanti) break;
      }
      if (fuori.length) return { ok: true, video: fuori, fonte: base };
    } catch { /* servizio giù: si prova il successivo */ }
  }
  return { ok: false, errore: 'nessun motore di ricerca raggiungibile' };
}

/**
 * Verifica che un video ESISTA e si lasci incorporare.
 *
 * ⚠️ È la differenza fra proporre e garantire.
 *
 * Anche cercando sul web, un modello può restituire un indirizzo
 * plausibile ma inesistente: undici caratteri qualunque sembrano un
 * identificativo valido, e nulla nella risposta dice che non lo è. Chi
 * guarda si trova un riquadro nero e non capisce perché.
 *
 * YouTube offre un controllo pubblico che non richiede alcuna chiave:
 * se il video non esiste, o vieta l'incorporamento, risponde con un
 * errore. Chiederglielo prima costa un istante e trasforma un
 * "consigliato" in un "funziona".
 */
export async function videoUtilizzabile(id) {
  try {
    const u = `https://www.youtube.com/oembed?url=${
      encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
    const r = await fetch(u);
    /* ⚠️ Solo 401, 403 e 404 sono un NO definitivo.
     *
     * Sono le risposte con cui YouTube dice "questo video non esiste"
     * o "non si lascia incorporare". Qualunque altro esito — una rete
     * che filtra, un intermediario, un guasto momentaneo — non dice
     * nulla sul video, e trattarlo come un rifiuto significherebbe
     * scartare video perfettamente buoni ogni volta che la connessione
     * è sorvegliata. Nel dubbio si prova ad aprirlo. */
    /* 404 = il video non esiste. 401 = esiste ma vieta
     * l'incorporamento. Entrambi sono un NO che viene da YouTube.
     *
     * ⚠️ Il 403 NO: è la risposta tipica di una rete che filtra o di un
     * intermediario aziendale, e scartarci sopra significherebbe
     * rifiutare video buoni ogni volta che la connessione è
     * sorvegliata. */
    if (r.status === 404 || r.status === 401) return { ok: false };
    if (!r.ok) return { ok: true, titolo: '', incerto: true };
    const d = await r.json().catch(() => null);
    return { ok: true, titolo: d?.title || '' };
  } catch {
    /* ⚠️ Rete assente o controllo non raggiungibile: si prova comunque
     * ad aprirlo. Meglio un tentativo che potrebbe riuscire di un
     * rifiuto certo. */
    return { ok: true, titolo: '', incerto: true };
  }
}

/**
 * Estrae TUTTI gli identificativi YouTube presenti in una risposta.
 *
 * ⚠️ Serve perché molti video non si lasciano incorporare: chi li
 * pubblica può vietarlo, e allora il riquadro mostra "video non
 * disponibile" anche se il video esiste ed è quello giusto.
 *
 * Non c'è modo di saperlo prima: lo si scopre solo provando. Avendone
 * più d'uno si passa al successivo invece di arrendersi — e chi non
 * può cercare da sé la differenza la sente tutta.
 */
export function idsYouTube(testo) {
  const t = String(testo || '');
  const fuori = [];
  const re = /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/g;
  let m;
  while ((m = re.exec(t))) if (!fuori.includes(m[1])) fuori.push(m[1]);
  if (!fuori.length) {
    const nudo = t.match(/(?:^|[\s|>])([A-Za-z0-9_-]{11})(?:[\s|<]|$)/);
    if (nudo) fuori.push(nudo[1]);
  }
  return fuori;
}

/** Estrae un identificativo YouTube da una risposta, comunque scritta. */
export function idYouTube(testo) {
  const t = String(testo || '');
  // Prima le forme complete, poi l'identificativo nudo.
  const m = t.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/)
    || t.match(/(?:^|[\s|>])([A-Za-z0-9_-]{11})(?:[\s|<]|$)/);
  return m ? m[1] : null;
}

/**
 * Chiede un video sull'argomento e restituisce identificativo e titolo.
 */
export async function cercaVideo(cfg, argomento) {
  const A = cfg?.assistente;
  if (!A?.enabled) return { ok: false, errore: 'assistente non attivo' };

  const lingua = cfg?.ui?.language || 'it';
  const tema = espandiArgomento(argomento);

  /* ══════════════════════════════════════════════════════════════════
   * PRIMO: una ricerca VERA
   * ══════════════════════════════════════════════════════════════════
   *
   * ⚠️ L'indirizzo viene da chi ha davvero cercato, non da chi se lo
   * ricorda. I video restituiti esistono per costruzione: sono stati
   * appena trovati.
   *
   * Si cerca con il testo della persona più la lingua: chi scrive
   * "documentario africa" in italiano vuole quasi sempre un video in
   * italiano, e metterlo nella ricerca è il modo più efficace di
   * ottenerlo.
   */
  const nome = lingua === 'en' ? 'english' : 'italiano';
  const query = [`${tema} ${nome}`, tema];

  for (const q of query) {
    const ric = await cercaSuYouTube(q, 8);
    try {
      console.warn(`[aurora/video] ricerca "${q}" →`,
        ric.ok ? `${ric.video.length} risultati da ${ric.fonte}` : ric.errore);
    } catch {}
    if (!ric.ok || !ric.video.length) continue;

    /* ⚠️ Si scartano i video troppo corti: i primi risultati sono
     * spesso spezzoni, e chi chiede un documentario vuole guardarlo,
     * non vederne dieci secondi. */
    const buoni = ric.video.filter(v => !v.durata || v.durata >= 180);
    const ordinati = buoni.length ? buoni : ric.video;

    for (const v of ordinati) {
      const ok = await videoUtilizzabile(v.id);
      try {
        console.warn(`[aurora/video] https://www.youtube.com/watch?v=${v.id} → `
          + (ok.ok ? `ok — ${v.titolo}` : 'non incorporabile'));
      } catch {}
      if (!ok.ok) continue;
      return {
        ok: true, id: v.id,
        alternativi: ordinati.filter(x => x.id !== v.id).slice(0, 3).map(x => x.id),
        titolo: v.titolo || tema, verificato: true, viaRicerca: true,
      };
    }
  }

  /* ⚠️ Solo se la ricerca non è raggiungibile si chiede al modello.
   *
   * È un ripiego, non la strada principale: vale quando i servizi di
   * ricerca sono giù. Ogni candidato resta comunque verificato prima
   * di essere aperto. */
  if (!A.ricercaWeb) return { ok: false, errore: 'ricerca non raggiungibile' };

  const tentativi = [
    { ripiego: 0, domanda: `Cerca su YouTube e dammi il link del video in ${nome} più visto e pertinente su: ${tema}` },
    { ripiego: 2, domanda: `Cerca su YouTube e dammi il link del miglior video su: ${tema}, in qualunque lingua` },
  ];

  let ultimo = 'nessun video trovato';
  for (const { ripiego, domanda } of tentativi) {
    const r = await chiedi(cfg, domanda, {
      istruzione: ISTRUZIONE_VIDEO(lingua, ripiego), ricerca: true, maxParole: 60,
    });
    if (!r.ok) { ultimo = r.errore; continue; }
    if (/^\s*NIENTE\s*$/i.test(r.testo)) continue;
    try { console.warn('[aurora/video] ripiego, risposta del modello:', r.testo); } catch {}

    const candidati = idsYouTube(r.testo).slice(0, 4);
    for (const c of candidati) {
      const v = await videoUtilizzabile(c);
      if (!v.ok) continue;
      return { ok: true, id: c, alternativi: candidati.filter(x => x !== c),
               titolo: v.titolo || tema, ripiego, verificato: !v.incerto };
    }
    ultimo = 'i video proposti non esistono';
  }
  return { ok: false, errore: ultimo };
}



/**
 * Toglie ciò che ad alta voce diventa rumore.
 *
 * ⚠️ Asterischi, cancelletti e trattini di elenco vengono letti dalla
 * voce sintetica come suoni o pause senza senso. A schermo aiutano; in
 * cuffia disturbano soltanto.
 */
export function ripulisci(t) {
  return String(t)
    .replace(/```[\s\S]*?```/g, ' ')      // blocchi di codice
    .replace(/[*_#`>]+/g, ' ')            // segni di formattazione
    .replace(/^\s*[-•]\s*/gm, '')         // trattini di elenco
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Spezza la risposta in frasi.
 *
 * ⚠️ Serve a poterla ascoltare un pezzo per volta, e a poterla
 * interrompere. Una risposta lunga letta tutta d'un fiato, senza poter
 * dire "basta", è una trappola per chi non può parlare.
 */
export function inFrasi(t, maxCar = 160) {
  const grezze = ripulisci(t).split(/(?<=[.!?…])\s+/);
  const out = [];
  for (const f of grezze) {
    if (f.length <= maxCar) { if (f.trim()) out.push(f.trim()); continue; }
    // Frase lunghissima: si spezza sulle virgole, poi a forza.
    let resto = f;
    while (resto.length > maxCar) {
      let taglio = resto.lastIndexOf(',', maxCar);
      if (taglio < maxCar * 0.4) taglio = resto.lastIndexOf(' ', maxCar);
      if (taglio <= 0) taglio = maxCar;
      out.push(resto.slice(0, taglio + 1).trim());
      resto = resto.slice(taglio + 1);
    }
    if (resto.trim()) out.push(resto.trim());
  }
  return out.filter(Boolean);
}
