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
export function istruzione(maxParole) {
  const n = Math.max(10, Math.round(maxParole || 100));
  return [
    `Rispondi in italiano usando AL MASSIMO ${n} parole.`,
    'La risposta verrà LETTA AD ALTA VOCE a una persona che non può interromperti,',
    'quindi vai al punto senza premesse, elenchi o formattazione.',
    'Se la domanda è ambigua, scegli l\'interpretazione più probabile e rispondi:',
    'chiedere chiarimenti costa a chi ascolta molto più che a te.',
    `Preferisci una risposta completa e più corta di ${n} parole a una risposta`,
    'che si interrompe a metà.',
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
  const testoIstruzione = opzioni.istruzione
    || ((A.istruzione && A.istruzione.trim()) ? A.istruzione : istruzione(nParole));
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
export const ISTRUZIONE_VIDEO = [
  'Cerca su internet e restituisci UN SOLO video di YouTube, il più pertinente',
  'e in lingua italiana se esiste.',
  'Rispondi ESATTAMENTE in questa forma, senza aggiungere altro:',
  'ID|titolo',
  "dove ID è l'identificativo di undici caratteri del video YouTube.",
  'Se non trovi nulla di sicuro, rispondi soltanto: NIENTE',
  'Non inventare mai un identificativo: meglio NIENTE che un video inesistente.',
].join(' ');

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
  if (!A.ricercaWeb) return { ok: false, errore: 'la ricerca sul web non è attiva' };
  const r = await chiedi(cfg, `Trova un video su: ${argomento}`, {
    istruzione: ISTRUZIONE_VIDEO, ricerca: true, maxParole: 40,
  });
  if (!r.ok) return { ok: false, errore: r.errore };
  if (/^\s*NIENTE/i.test(r.testo)) return { ok: false, errore: 'nessun video trovato' };
  const id = idYouTube(r.testo);
  if (!id) return { ok: false, errore: 'risposta non riconosciuta' };
  const titolo = (r.testo.split('|')[1] || '').trim().slice(0, 120);
  return { ok: true, id, titolo: titolo || argomento };
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
