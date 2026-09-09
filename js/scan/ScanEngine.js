/**
 * ScanEngine.js — Macchina a stati della scansione uditiva.
 *
 * Kotlin-puro nello spirito: nessuna dipendenza dal DOM, da audio o da
 * timer di sistema. Riceve `tick(now)` dall'esterno e comunica solo
 * tramite callback. Questo lo rende testabile in Node senza browser e
 * senza hardware — è ciò che permette di collaudare tutta la logica di
 * interazione prima che esista una riga di visione artificiale.
 *
 * Il tempo entra sempre come parametro, mai letto da dentro.
 */

import { percentile, clamp } from '../signal/filters.js';
import { comandiDi as comandiDispositivo } from '../device/HomeAssistant.js';

export const NodeKind = { MENU: 'menu', GROUP: 'group', ITEM: 'item', ACTION: 'action' };

/* ------------------------------------------------------------------ *
 * Costruzione dell'albero a partire dalla configurazione.
 * I gruppi arrivano da cfg.scan.groups: se una persona usa già una
 * mappa diversa, la mappa segue lei.
 * ------------------------------------------------------------------ */
export function buildTree(cfg, ctx = {}) {
  const g = cfg.scan.groups;
  const showBack = cfg.scan.showBackItem !== false;

  /**
   * Voce di uscita, sempre la PRIMA di ogni sezione: è la convenzione
   * che permette di non restare mai intrappolati.
   *
   * "Esci" invece di "indietro": due sillabe invece di quattro. Su una
   * voce che viene annunciata a ogni giro, in ogni sezione, decine di
   * volte al giorno, la differenza si accumula. Il significato è lo
   * stesso — si lascia la sezione corrente e si torna a quella prima.
   */
  const back = (id) => ({
    kind: NodeKind.ACTION, id: `back:${id}`, label: '← ESCI',
    spoken: 'esci', action: 'BACK',
  });

  const actionsNode = () => ({
    kind: NodeKind.GROUP, id: 'act', label: 'AZIONI', spoken: 'azioni',
    children: [
      ...(showBack ? [back('act')] : []),
      // PARLA e RILEGGI differiscono per UNA cosa sola: PARLA svuota il
      // testo (il messaggio è stato consegnato), RILEGGI lo lascia
      // (serve a riascoltare quello che si sta ancora scrivendo).
      // Prima esisteva anche "LEGGI SENZA CANCELLARE", che faceva la
      // stessa cosa di RILEGGI: era un doppione, ed è stato tolto.
      { kind: NodeKind.ACTION, id: 'a:speak',  label: 'PARLA',    spoken: 'parla',   action: 'SPEAK' },
      { kind: NodeKind.ACTION, id: 'a:repeat', label: 'RILEGGI',  spoken: 'rileggi', action: 'SPEAK_KEEP' },
      { kind: NodeKind.ACTION, id: 'a:save',   label: 'SALVA',    spoken: 'salva',   action: 'SAVE_DRAFT' },
      /* L'assistente compare solo se acceso in impostazioni: chi non
       * lo usa non deve trovarsi una voce in più nella scansione, che
       * costa tempo a ogni giro. Sta qui, dopo RILEGGI, perché è
       * un'altra cosa da fare con il testo appena scritto. */
      ...(cfg?.assistente?.enabled
        ? [{ kind: NodeKind.ACTION, id: 'a:ai', label: 'CHIEDI',
             spoken: 'chiedi', action: 'ASK_AI' }]
        : []),
      // Le pronunce sono volutamente brevi: un annuncio più lungo del
      // passo di scansione viene troncato dall'annuncio successivo.
      { kind: NodeKind.ACTION, id: 'a:delc',   label: '⌫ lettera', spoken: 'lettera', action: 'DEL_CHAR' },
      { kind: NodeKind.ACTION, id: 'a:delw',   label: '⌫ parola',  spoken: 'parola',  action: 'DEL_WORD' },
      { kind: NodeKind.ACTION, id: 'a:clear',  label: 'SVUOTA',    spoken: 'svuota',  action: 'CLEAR' },
      // Compare solo se richiesta esplicitamente: l'obiettivo è che la
      // correzione sia abbastanza affidabile da non doverla annullare.
      ...(cfg.prediction?.autoCorrectUndo
        ? [{ kind: NodeKind.ACTION, id: 'a:uncorr', label: 'ANNULLA CORREZIONE',
             spoken: 'annulla correzione', action: 'UNDO_CORRECT' }]
        : []),
      // Niente PAUSA qui: ci sono già INDIETRO e MENU, e la pausa sta
      // nel menu principale dove si raggiunge in un passo.
      /* La voce MENU compare solo se richiesta.
       * Ogni voce in più costa un giro a ogni scansione, e per tornare
       * indietro basta ESCI. Chi la vuole la accende una volta e la
       * trova in tutti i sottomenu. */
      ...(cfg.scan?.showMenuItem
        ? [{ kind: NodeKind.ACTION, id: 'a:menu', label: 'MENU', spoken: 'menu', action: 'ROOT' }]
        : []),
    ],
  });

  const writeChildren = () => {
    const kids = [];
    // INDIETRO e AZIONI in testa: sono le due vie d'uscita, devono
    // costare poco. Il marcatore `hot` indica invece da dove far
    // ripartire la scansione DOPO aver composto una lettera, così le
    // due voci di servizio non vengono riascoltate a ogni carattere.
    if (showBack) kids.push(back('write'));
    kids.push(actionsNode());
    if (cfg.scan.showSuggestions && ctx.suggestions?.length) {
      kids.push({
        kind: NodeKind.GROUP, id: 'sugg', label: 'Suggerimenti', spoken: 'suggerimenti', hot: true,
        children: [
          ...(showBack ? [back('sugg')] : []),
          ...ctx.suggestions.slice(0, cfg.scan.suggestionCount).map(w => ({
            kind: NodeKind.ACTION, id: `w:${w}`, label: w, spoken: w, action: 'WORD', payload: w,
          })),
        ],
      });
    }
    g.forEach((grp, i) => {
      const letters = grp.items.map(ch => ({
        kind: NodeKind.ITEM, id: `c:${grp.id}:${ch}`,
        label: ch === '␣' ? '␣' : ch,
        spoken: ch === '␣' ? 'spazio' : ch,
        action: 'CHAR', payload: ch === '␣' ? ' ' : ch,
      }));
      // Dentro un gruppo di lettere l'uscita sta in CODA, non in testa:
      // in testa costerebbe un annuncio in più per OGNI lettera, cioè
      // circa il 30% sul percorso più frequente di tutti.
      const kidsG = cfg.scan.backPosition === 'first' && showBack
        ? [back(grp.id), ...letters]
        : showBack ? [...letters, back(grp.id)] : letters;
      kids.push({
        kind: NodeKind.GROUP, id: grp.id, label: grp.label,
        spoken: grp.spoken || grp.label, hot: !ctx.suggestions?.length && i === 0,
        children: kidsG,
      });
    });
    return kids;
  };

  const voceFrase = (p, id) => ({
    kind: NodeKind.ACTION, id, label: p, spoken: p, action: 'PHRASE', payload: p,
  });

  /**
   * Con un solo gruppo (o nessuno) l'elenco è piatto, come sempre.
   * Con più gruppi si sceglie prima il gruppo: serve a raggiungere le
   * frasi di un certo tipo senza dover ascoltare tutte le altre.
   */
  const phraseChildren = () => {
    const gruppi = (cfg.scan.phraseGroups || []).filter(g => g.phrases?.length);
    const max = cfg.scan.phraseCount || 12;

    if (gruppi.length > 1) {
      return [
        ...(showBack ? [back('phrases')] : []),
        ...gruppi.map(gr => ({
          kind: NodeKind.GROUP, id: `pg:${gr.id}`, label: gr.label,
          spoken: gr.spoken || gr.label,
          children: [
            ...(showBack ? [back(`pg:${gr.id}`)] : []),
            ...gr.phrases.slice(0, max).map((p, i) => voceFrase(p, `p:${gr.id}:${i}`)),
          ],
        })),
      ];
    }

    const list = gruppi.length === 1 ? gruppi[0].phrases
      : (ctx.phrases?.length ? ctx.phrases : DEFAULT_PHRASES);
    return [
      ...(showBack ? [back('phrases')] : []),
      ...list.slice(0, max).map((p, i) => voceFrase(p, `p:${i}`)),
    ];
  };

  const children = [];

  // Quando un contenuto è APERTO, i suoi comandi diventano la prima
  // voce del menu: chi sta guardando un video vuole quasi sempre
  // metterlo in pausa, non scrivere.
  if (ctx.mediaCommands?.length) {
    children.push({
      kind: NodeKind.GROUP, id: 'media', label: ctx.mediaLabel || 'COMANDI',
      spoken: ctx.mediaSpoken || 'comandi', children: [
        ...(showBack ? [back('media')] : []),
        ...ctx.mediaCommands.map(c => ({
          kind: NodeKind.ACTION, id: `m:${c.id}`, label: c.label,
          spoken: c.spoken || c.label, action: 'MEDIA', payload: c.id,
        })),
      ],
    });
  }

  // Archivio dei testi. Compare anche quando è VUOTO se c'è qualcosa
  // in composizione: altrimenti la funzione sarebbe invisibile finché
  // non si è già capito come usarla — il classico circolo vizioso di
  // una funzione scopribile solo da chi la conosce già.
  const hasBuffer = !!ctx.hasText;
  const ramoTesti = [];
  if (ctx.drafts?.length || hasBuffer) {
    ramoTesti.push({
      kind: NodeKind.GROUP, id: 'drafts', label: 'MIEI TESTI', spoken: 'miei testi',
      children: [
        ...(showBack ? [back('drafts')] : []),
        // Salvare è raggiungibile anche da qui, non solo dalle azioni:
        // è il gesto che dà senso a tutta la sezione.
        ...(hasBuffer ? [{
          kind: NodeKind.ACTION, id: 'd:save', label: 'SALVA',
          spoken: 'salva', action: 'SAVE_DRAFT',
        }] : []),
        ...(ctx.drafts || []).slice(0, cfg.scan.draftCount || 10).map(d => ({
          kind: NodeKind.GROUP, id: `d:${d.id}`, label: d.title, spoken: d.title,
          children: [
            // Esci per primo, come in ogni altra sezione: la convenzione
            // vale ovunque, così non c'è nulla da ricordare.
            ...(showBack ? [back(`d:${d.id}`)] : []),
            { kind: NodeKind.ACTION, id: `ds:${d.id}`, label: 'RILEGGI', spoken: 'rileggi', action: 'DRAFT_SPEAK', payload: d.id },
            /* ── Conferma DENTRO la scansione ──
             * ⚠️ Un dialogo del browser (`confirm`) sarebbe una
             * trappola: blocca la pagina e si chiude solo con un
             * clic. Chi usa Aurora non può cliccare — resterebbe
             * bloccato davanti a una finestra che non può chiudere,
             * senza voce e senza modo di chiedere aiuto.
             * La conferma deve quindi essere una voce come le altre,
             * raggiungibile e annullabile con lo stesso gesto. */
            {
              kind: NodeKind.GROUP, id: `dx:${d.id}`, label: 'ELIMINA', spoken: 'elimina',
              children: [
                ...(showBack ? [back(`dx:${d.id}`)] : []),
                { kind: NodeKind.ACTION, id: `dxc:${d.id}`, label: 'CONFERMA ELIMINA',
                  spoken: 'conferma elimina', action: 'DRAFT_DELETE', payload: d.id },
              ],
            },
            // "SCRIVI" e non "riprendi a scrivere": stessa parola della
            // voce Scrivi del menu, perché fa la stessa cosa.
            { kind: NodeKind.ACTION, id: `dl:${d.id}`, label: 'SCRIVI', spoken: 'scrivi', action: 'DRAFT_LOAD', payload: d.id },
            /* ── Stampa ──
             * Il browser stampa da solo su qualunque stampante
             * collegata: non serve alcun intermediario. */
            ...(cfg.stampa?.enabled
              ? [{
                  kind: NodeKind.GROUP, id: `dp:${d.id}`, label: 'STAMPA', spoken: 'stampa',
                  children: [
                    ...(showBack ? [back(`dp:${d.id}`)] : []),
                    { kind: NodeKind.ACTION, id: `dpc:${d.id}`, label: 'CONFERMA STAMPA',
                      spoken: 'conferma stampa', action: 'DRAFT_PRINT', payload: d.id },
                  ],
                }]
              : []),
            /* ── Manda per posta ──
             * Compare solo se la funzione è accesa E ci sono
             * destinatari: una voce che non può fare nulla sarebbe
             * solo un giro in più a ogni scansione. */
            ...((cfg.email?.enabled && (cfg.email.contatti || []).some(x => x?.indirizzo))
              ? [{
                  kind: NodeKind.GROUP, id: `dm:${d.id}`, label: 'MANDA', spoken: 'manda',
                  children: [
                    ...(showBack ? [back(`dm:${d.id}`)] : []),
                    ...cfg.email.contatti.filter(x => x?.indirizzo).map((con, ci) => ({
                      kind: NodeKind.GROUP, id: `dmc:${d.id}:${ci}`,
                      label: con.nome || con.indirizzo, spoken: con.nome || 'destinatario',
                      // Conferma nella scansione: un messaggio parte
                      // una volta sola e non torna indietro.
                      children: [
                        ...(showBack ? [back(`dmc:${d.id}:${ci}`)] : []),
                        { kind: NodeKind.ACTION, id: `dme:${d.id}:${ci}`,
                          label: 'CONFERMA INVIO', spoken: 'conferma invio',
                          action: 'DRAFT_EMAIL', payload: { id: d.id, contatto: con } },
                      ],
                    })),
                  ],
                }]
              : []),
            /* ⚠️ Telegram con la STESSA struttura della posta, conferma
             * compresa: un messaggio parte una volta sola e non torna
             * indietro, e chi comanda con un gesto solo non deve poterlo
             * mandare per sbaglio. */
            ...((cfg.telegram?.enabled && (cfg.telegram.contatti || []).some(x => x?.chatId))
              ? [{
                  kind: NodeKind.GROUP, id: `dt:${d.id}`, label: 'TELEGRAM', spoken: 'telegram',
                  children: [
                    ...(showBack ? [back(`dt:${d.id}`)] : []),
                    ...cfg.telegram.contatti.filter(x => x?.chatId).map((con, ci) => ({
                      kind: NodeKind.GROUP, id: `dtc:${d.id}:${ci}`,
                      label: con.nome || String(con.chatId), spoken: con.nome || 'destinatario',
                      children: [
                        ...(showBack ? [back(`dtc:${d.id}:${ci}`)] : []),
                        { kind: NodeKind.ACTION, id: `dtm:${d.id}:${ci}`,
                          label: 'CONFERMA INVIO', spoken: 'conferma invio',
                          action: 'DRAFT_TELEGRAM', payload: { id: d.id, contatto: con } },
                      ],
                    })),
                  ],
                }]
              : []),
          ],
        })),
      ],
    });
  }

  /**
   * Ramo GUARDA: video, documenti e immagini caricati dall'assistente
   * nella scheda Guarda. Compare solo se c'è davvero qualcosa, ed è
   * organizzato per tipo così la persona sceglie prima la categoria e
   * poi il singolo contenuto, senza ascoltare tutto l'elenco.
   */
  const ramoGuarda = [];
  const lib = ctx.library || {};
  const categorie = [
    { id: 'video', label: 'VIDEO',     spoken: 'video',     items: lib.videos || [] },
    { id: 'audio', label: 'AUDIO',     spoken: 'audio',     items: lib.audios || [] },
    { id: 'doc',   label: 'DOCUMENTI', spoken: 'documenti', items: lib.docs || [] },
    { id: 'img',   label: 'IMMAGINI',  spoken: 'immagini',  items: lib.images || [] },
  ].filter(c => c.items.length);

  /* ── Radio online ──
   * Prima delle altre categorie: è la cosa che si sceglie più spesso e
   * più in fretta, e va raggiunta con meno gesti possibile. */
  const stazioni = (cfg.radio?.enabled && Array.isArray(cfg.radio.stazioni))
    ? cfg.radio.stazioni.filter(r => r && r.url && r.nome) : [];
  /* ── Dispositivi di casa ──
   * Stanno nei media perché è lì che si va per "guardare qualcosa": la
   * televisione appartiene a quel gesto mentale, non a un menu a sé. */
  const disp = (cfg.domotica?.enabled && Array.isArray(cfg.domotica.dispositivi))
    ? cfg.domotica.dispositivi.filter(d => d && d.nome && d.entita) : [];
  if (disp.length) {
    categorie.unshift({
      id: 'casa', label: 'CASA', spoken: 'casa',
      items: disp.map(d => ({ title: d.nome, _disp: d })),
    });
  }

  if (stazioni.length) {
    categorie.unshift({
      id: 'radio', label: 'RADIO', spoken: 'radio',
      // Le voci dell'elenco hanno la stessa forma degli altri media:
      // un titolo. La stazione viaggia a fianco per l'apertura.
      items: stazioni.map(r => ({ title: r.nome, _st: r })),
      _radio: stazioni,
    });
  }

  if (categorie.length) {
    const voci = categorie.map(cat => ({
      kind: NodeKind.GROUP, id: `mc:${cat.id}`, label: cat.label, spoken: cat.spoken,
      children: [
        ...(showBack ? [back(`mc:${cat.id}`)] : []),
        ...cat.items.slice(0, cfg.scan.mediaCount || 10).map((it, i) => (
          // Una CARTELLA diventa un sottomenu con i suoi file: serve
          // per gli album fotografici, che altrimenti riempirebbero
          // l'elenco principale con decine di voci.
          it._disp
            ? {
                // Un dispositivo è un sottomenu con i suoi comandi.
                kind: NodeKind.GROUP, id: `dv:${i}`, label: it.title, spoken: it.title,
                children: [
                  ...(showBack ? [back(`dv:${i}`)] : []),
                  ...comandiDispositivo(it._disp).map((cm, k) => ({
                    kind: NodeKind.ACTION, id: `dc:${i}:${k}`,
                    label: cm.nome, spoken: cm.nome,
                    action: 'CASA_COMANDO', payload: { dispositivo: it._disp, comando: cm },
                  })),
                ],
              }
          : it.folder
            ? {
                kind: NodeKind.GROUP, id: `mf:${cat.id}:${i}`, label: it.title, spoken: it.title,
                children: [
                  ...(showBack ? [back(`mf:${cat.id}:${i}`)] : []),
                  ...it.folder.slice(0, cfg.scan.mediaCount || 10).map((f, j) => ({
                    kind: NodeKind.ACTION, id: `mo:${cat.id}:${i}:${j}`,
                    label: f.title, spoken: f.title,
                    action: 'MEDIA_OPEN', payload: { kind: cat.id, index: i, sub: j },
                  })),
                ],
              }
            : {
                kind: NodeKind.ACTION, id: `mo:${cat.id}:${i}`,
                label: it.title, spoken: it.title,
                action: cat.id === 'radio' ? 'RADIO_OPEN' : 'MEDIA_OPEN',
                payload: cat.id === 'radio'
                  ? { stazione: it._st, index: i }
                  : { kind: cat.id, index: i },
              }
        )),
      ],
    }));
    ramoGuarda.push({
      kind: NodeKind.GROUP, id: 'library', label: 'GUARDA', spoken: 'guarda',
      // Con una sola categoria si salta un livello: non ha senso far
      // scegliere fra "video" quando c'è solo quello.
      children: categorie.length === 1
        ? [...(showBack ? [back('library')] : []), ...voci[0].children.filter(c => c.action !== 'BACK')]
        : [...(showBack ? [back('library')] : []), ...voci],
    });
  }

  // Ordine: le due cose che si usano sempre per prime, poi l'archivio
  // dei testi, poi i contenuti, e la pausa per ultima — è l'unica che
  // non si vuole scegliere per sbaglio scorrendo il menu.
  children.push(
    { kind: NodeKind.GROUP, id: 'phrases', label: 'Frasi',  spoken: 'frasi',  children: phraseChildren() },
    { kind: NodeKind.GROUP, id: 'write',   label: 'Scrivi', spoken: 'scrivi', children: writeChildren() },
    ...ramoTesti,
    ...ramoGuarda,
    { kind: NodeKind.ACTION, id: 'pause',  label: 'PAUSA',  spoken: 'pausa',  action: 'PAUSE' },
  );

  return { kind: NodeKind.MENU, id: 'root', label: 'Menu', spoken: 'menu', children };
}

/**
 * Frasi di partenza. Vanno sostituite al più presto con quelle che la
 * persona usa DAVVERO, raccolte intervistando la famiglia: un sistema
 * che parte vuoto è frustrante per settimane, uno precaricato è utile
 * dal primo giorno.
 */
export const DEFAULT_PHRASES = [
  // Ordinate per utilità attesa: le più frequenti e le più brevi per
  // prime, perché in scansione la posizione È il costo. "Sì" e "No"
  // da soli coprono una quota enorme della comunicazione quotidiana.
  'Sì', 'No', 'Grazie', 'Aiuto', 'Aspetta', 'Ho dolore',
  'Ho sete', 'Ho fame', 'Cambiami posizione', 'Ho caldo', 'Ho freddo',
  'Chiama qualcuno', 'Ciao', 'Ti voglio bene',
];

/* ------------------------------------------------------------------ *
 * Timing adattivo
 * ------------------------------------------------------------------ */
export class AdaptiveTiming {
  constructor(cfg) { this.cfg = cfg; this.latencies = []; this.stepMs = cfg.scan.stepMs; }
  updateConfig(cfg) { this.cfg = cfg; if (!cfg.scan.adaptive) this.stepMs = cfg.scan.stepMs; }
  /** Registra quanto tempo è passato dall'annuncio alla selezione. */
  record(latencyMs) {
    if (!this.cfg.scan.adaptive) return;
    this.latencies.push(latencyMs);
    if (this.latencies.length > 60) this.latencies.shift();
    if (this.latencies.length < 8) return;
    const p = percentile(this.latencies, this.cfg.scan.adaptivePercentile);
    // Margine del 25%: meglio un passo lento di un gesto perso.
    this.stepMs = clamp(p * 1.25, this.cfg.scan.minStepMs, this.cfg.scan.maxStepMs);
  }
  get current() { return this.cfg.scan.adaptive ? this.stepMs : this.cfg.scan.stepMs; }
  reset() { this.latencies.length = 0; this.stepMs = this.cfg.scan.stepMs; }
}

/* ------------------------------------------------------------------ *
 * Motore
 * ------------------------------------------------------------------ */
export class ScanEngine {
  constructor(cfg, handlers = {}) {
    this.cfg = cfg;
    this.h = {
      onAnnounce: () => {},   // (node, {index, total, level}) → audio + UI
      onState: () => {},      // stato cambiato
      onOutput: () => {},     // (type, payload) → altoparlante / log
      onBuffer: () => {},     // buffer di composizione cambiato
      ...handlers,
    };
    this.timing = new AdaptiveTiming(cfg);
    this.ctx = { suggestions: [], phrases: null };
    this.tree = buildTree(cfg, this.ctx);
    this.stack = [];          // percorso: [{node, index}]
    this.paused = true;
    this.emptyCycles = 0;
    this.lastStepAt = 0;
    this.lastAnnounceAt = 0;
    this.inCyclePause = false;
    // Attesa all'ingresso in una sezione: si mostra già il nuovo
    // livello a schermo, ma non si annuncia nulla finché non scade.
    this.attesaFino = 0;
    this.buffer = { letters: '', words: [], sentence: '' };
    // Sospensione: la scansione si ferma mentre il sistema sta
    // pronunciando un messaggio all'utente. Non è solo cortesia — è
    // necessario, perché l'annuncio successivo cancellerebbe il
    // messaggio (speechSynthesis.cancel svuota tutta la coda).
    this.suspended = false;
    this.suspendUntil = 0;
    this.stats = { selections: 0, undos: 0, chars: 0, predictionHits: 0, startedAt: 0 };
  }

  updateConfig(cfg) {
    this.cfg = cfg;
    this.timing.updateConfig(cfg);
    this.rebuild();
  }

  /**
   * Aggiorna suggerimenti e frasi.
   *
   * ⚠️ Viene chiamato di continuo (a ogni carattere composto). Ricostruire
   * l'albero a ogni chiamata azzererebbe la posizione di scansione e la
   * scansione non avanzerebbe mai. Quindi: si ricostruisce SOLO se il
   * contesto è davvero cambiato, e comunque preservando la posizione.
   */
  setContext(ctx) {
    const next = { ...this.ctx, ...ctx };
    const key = JSON.stringify([next.suggestions, next.phrases, next.mediaCommands, next.mediaLabel,
                                (next.drafts || []).map(d => d.id + d.title), !!next.hasText,
                                this.cfg.scan.phraseGroups,
                                !!this.cfg.prediction?.autoCorrectUndo,
                                JSON.stringify(next.library || {}),
                                JSON.stringify(this.cfg.radio || {}),
                                JSON.stringify((this.cfg.email || {}).contatti || []),
                                !!(this.cfg.email || {}).enabled,
                                !!this.cfg.scan?.showMenuItem]);
    if (key === this._ctxKey) return;
    this._ctxKey = key;
    this.ctx = next;

    // ⚠️ Se la ricostruzione cambia la voce sotto il cursore, va
    // riannunciata. Senza, l'audio resta quello di prima mentre lo
    // schermo mostra un'altra voce, e selezionando si ottiene una cosa
    // diversa da quella sentita. È il caso che si verificava quando
    // compariva o spariva il ramo dei comandi di un file: la voce
    // veniva ripetuta e la selezione finiva altrove.
    const prima = this.currentNode?.id;
    this.rebuild();
    const dopo = this.currentNode?.id;
    if (!this.paused && !this.suspended && prima !== dopo && this._now) {
      this.lastStepAt = this._now;
      this._announce(this._now);
      this._pushState();
    }
  }

  /** Ricostruisce l'albero preservando percorso e posizione correnti. */
  rebuild() {
    const frames = this.stack.map(f => ({ id: f.node.id, index: f.index, label: f.node.label }));
    this.tree = buildTree(this.cfg, this.ctx);
    const newStack = [{ node: this.tree, index: 0 }];
    for (let i = 1; i < frames.length; i++) {
      const parent = newStack[newStack.length - 1].node;
      const found = parent.children?.find(c => c.id === frames[i].id);
      if (!found) break;
      newStack.push({ node: found, index: 0 });
    }
    // Ripristina gli indici, limitandoli alla nuova dimensione del livello:
    // il gruppo suggerimenti può comparire o sparire e cambiare i conteggi.
    for (let i = 0; i < newStack.length; i++) {
      const n = newStack[i].node.children?.length || 0;
      if (n > 0) newStack[i].index = Math.min(frames[i]?.index ?? 0, n - 1);
    }
    this.stack = newStack;
  }

  /* ------------------------------ Stato ------------------------------ */

  get level() { return this.stack[this.stack.length - 1]; }

  /**
   * True se il livello corrente è un gruppo di LETTERE.
   * Le lettere si riconoscono più in fretta di una voce di menu: sono
   * una sillaba, e chi scrive sa già quali aspettarsi. Meritano quindi
   * un passo più corto — ed è il percorso più frequente di tutti.
   */
  get _inLettere() {
    return !!this.level?.node?.children?.some(c => c.action === 'CHAR');
  }

  /** Durata del passo per il livello corrente. */
  get stepCorrente() {
    const base = this.timing.current;
    if (!this._inLettere) return base;
    const l = this.cfg.scan.letterStepMs;
    if (!l || l <= 0) return base;
    // Si applica lo stesso rapporto anche al valore adattivo, così il
    // timing adattivo continua a funzionare su entrambi i livelli.
    return base * (l / Math.max(1, this.cfg.scan.stepMs));
  }

  /** Attesa entrando nel livello corrente. */
  get attesaCorrente() {
    if (this._inLettere) {
      const v = this.cfg.scan.letterEnterDelayMs;
      if (v !== undefined && v !== null) return v;
    }
    return this.cfg.scan.enterDelayMs || 0;
  }
  get currentNode() {
    const l = this.level;
    return l?.node.children?.[l.index] ?? null;
  }
  get depth() { return this.stack.length; }

  snapshot() {
    const l = this.level;
    return {
      paused: this.paused,
      speaking: this.suspended,
      waiting: this.attesaFino > 0,
      path: this.stack.map(f => f.node.label),
      levelLabel: l?.node.label ?? '',
      items: l?.node.children?.map(c => c.label) ?? [],
      index: l?.index ?? 0,
      current: this.currentNode?.label ?? '',
      buffer: { ...this.buffer },
      stepMs: this.stepCorrente,
      progress: this._progress(),
      emptyCycles: this.emptyCycles,
    };
  }

  _progress() {
    if (this.paused || this.inCyclePause) return 0;
    const el = this._now - this.lastStepAt;
    return clamp(el / this.stepCorrente, 0, 1);
  }

  /* ----------------------------- Controllo ---------------------------- */

  start(now) {
    this.paused = false;
    this.stack = [{ node: this.tree, index: 0 }];
    this.emptyCycles = 0;
    this.inCyclePause = false;
    this.attesaFino = 0;
    this.lastStepAt = now;
    this.stats.startedAt = now;
    this._announce(now);
    this._pushState();
  }

  pause(now) {
    this.paused = true;
    this.attesaFino = 0;
    this.pausedAt = now;
    this.lastReminderAt = now;
    // Dire COME si riprende, non solo che si è in pausa: chi ha un
    // solo gesto non ha altro modo di scoprirlo.
    this.h.onOutput('menu', this.h.wakeHint ? this.h.wakeHint() : 'in pausa');
    this._pushState();
  }

  /**
   * Ripresa dalla pausa.
   *
   * L'annuncio "riprendo" e la prima voce del menu venivano pronunciati
   * insieme: la voce si accavallava e la prima voce del ciclo risultava
   * sfasata rispetto a quella evidenziata a schermo. Ora si aspetta che
   * il messaggio finisca, poi si annuncia la prima voce.
   */
  resume(now) {
    if (!this.paused) return;
    this.paused = false;
    this.stack = [{ node: this.tree, index: 0 }];
    this.emptyCycles = 0;
    this.lastStepAt = now;
    this._pushState();
    const p = this.h.onOutput('menu', 'riprendo');
    if (!this._hold(p, now, this.cfg.scan.resumeDelayMs || 600)) {
      this._announce(now);
      this._pushState();
    }
  }

  /** Chiamato dal loop dell'app. Unico ingresso del tempo. */
  tick(now) {
    this._now = now;
    // Attesa all'ingresso: scaduta, si annuncia la prima voce e parte
    // il conteggio del passo. Prima di allora non succede nulla.
    if (this.attesaFino) {
      if (now < this.attesaFino) return;
      this.attesaFino = 0;
      this.lastStepAt = now;
      if (!this.paused) { this._announce(now); this._pushState(); }
      return;
    }
    if (this.paused) {
      const every = (this.cfg.audio?.wakeReminderSec || 0) * 1000;
      if (every > 0 && now - (this.lastReminderAt || 0) >= every) {
        this.lastReminderAt = now;
        this.h.onOutput('menu', this.h.wakeHint ? this.h.wakeHint() : 'in pausa');
      }
      return;
    }

    if (this.suspended) {
      // Scadenza di sicurezza, nel caso la promessa non arrivi mai.
      if (this.suspendUntil && now > this.suspendUntil) {
        this.suspended = false; this.suspendUntil = 0; this.lastStepAt = now;
        this._announce(now); this._pushState();
      }
      return;
    }

    if (this.inCyclePause) {
      if (now - this.lastStepAt >= this.cfg.scan.cyclePauseMs) {
        this.inCyclePause = false;
        this.lastStepAt = now;
        this._announce(now);
        this._pushState();
      }
      return;
    }

    if (now - this.lastStepAt >= this.stepCorrente) {
      this._advance(now);
    }
  }

  _advance(now) {
    const l = this.level;
    const n = l.node.children?.length ?? 0;
    if (n === 0) { this._up(now); return; }

    // Si ricorda su cosa si era, e da quando: serve alla finestra di
    // grazia in `select`.
    this._vocePrecedente = l.index;
    this._tAvanzamento = now;
    l.index++;
    if (l.index >= n) {
      l.index = 0;
      this.emptyCycles++;
      // Dopo N giri a vuoto: se siamo in un sottolivello si risale,
      // se siamo alla radice si va in pausa. Non lasciare mai il
      // sistema a girare all'infinito nelle orecchie di qualcuno.
      // Con un contenuto aperto si è molto più pazienti: guardare foto
      // o ascoltare musica non è "non scegliere nulla".
      const limite = this.ctx.mediaCommands?.length
        ? (this.cfg.scan.maxCyclesMedia || this.cfg.scan.maxCycles)
        : this.cfg.scan.maxCycles;
      if (this.emptyCycles >= limite) {
        this.emptyCycles = 0;
        if (this.stack.length > 1) { this._up(now); return; }
        this.pause(now);
        return;
      }
      this.inCyclePause = true;
      this.lastStepAt = now;
      this._pushState();
      return;
    }
    this.lastStepAt = now;
    this._announce(now);
    this._pushState();
  }

  _up(now) {
    if (this.stack.length > 1) this.stack.pop();
    this.level.index = 0;
    this.emptyCycles = 0;
    this._entraConAttesa(now);
  }

  /**
   * Entra in un livello lasciando un respiro prima di annunciare.
   *
   * Chi ha appena fatto un gesto non è pronto a farne subito un altro:
   * senza questa pausa la prima voce della sezione scorre via mentre la
   * persona si sta ancora riprendendo, ed è spesso proprio quella che
   * serviva. Lo schermo mostra subito il nuovo livello, così il
   * riscontro visivo resta immediato.
   */
  _entraConAttesa(now) {
    const ms = this.attesaCorrente;
    this.lastStepAt = now;
    if (ms > 0) {
      this.attesaFino = now + ms;
      this._pushState();
      return;
    }
    this._announce(now);
    this._pushState();
  }

  _announce(now) {
    const node = this.currentNode;
    if (!node) return;
    this.lastAnnounceAt = now;
    const l = this.level;
    this.h.onAnnounce(node, {
      index: l.index,
      total: l.node.children.length,
      isGroup: node.kind === NodeKind.GROUP || node.kind === NodeKind.MENU,
      depth: this.stack.length,
    });
  }

  _pushState() { this.h.onState(this.snapshot()); }

  /* ------------------------------ Azioni ----------------------------- */

  /** Ingresso unico per ogni intenzione, da gesto o da tastiera. */
  handleAction(action, now) {
    this._now = now;
    switch (action) {
      case 'SELECT': return this.select(now);
      case 'UNDO':   return this.undo(now);
      // Ogni comando fa UNA cosa sola, e se non c'è nulla da fare non
      // fa nulla: un risveglio a programma già attivo non deve poterlo
      // mettere in pausa, e viceversa.
      case 'WAKE':         return this.paused ? this.resume(now) : undefined;
      case 'PAUSE':        return this.paused ? undefined : this.pause(now);
      case 'TOGGLE_PAUSE': return this.paused ? this.resume(now) : this.pause(now);
      case 'SPEAK':  return this._speakSentence();
      case 'BACK':   return this._up(now);
      case 'NEXT':   return this._advance(now);
      default: return;
    }
  }

  /**
   * Esiste un gesto ACCESO capace di risvegliare?
   *
   * ⚠️ È una rete di sicurezza, non un dettaglio. Se la selezione non
   * risvegliasse e non ci fosse nessun altro gesto di risveglio, la
   * persona resterebbe chiusa fuori dal proprio programma — muta, e
   * senza modo di dirlo. In quel caso la selezione risveglia comunque,
   * qualunque cosa dica la configurazione.
   */
  _haRisveglio() {
    const g = this.cfg.gestures || {};
    return Object.values(g).some(c =>
      c && typeof c === 'object' && c.enabled
      && (c.action === 'WAKE' || c.action === 'TOGGLE_PAUSE'));
  }

  select(now) {
    if (this.paused) {
      /* Ascoltando la radio o guardando un video si mette in pausa la
       * voce di guida per sentire in santa pace. Ma se ogni selezione
       * risvegliasse, un gesto involontario rimetterebbe la voce a
       * parlare sopra la musica — e la pausa non servirebbe a niente.
       *
       * Con `selectWakes` spento risveglia solo il gesto dedicato.
       * Acceso (predefinito) il comportamento è quello di sempre. */
      if (this.cfg.scan?.selectWakes === false && this._haRisveglio()) return;
      this.resume(now);
      return;
    }
    /* ══════════════════════════════════════════════════════════════
     * FINESTRA DI GRAZIA
     * ══════════════════════════════════════════════════════════════
     *
     * ⚠️ Chi seleziona con un gesto oculare reagisce a ciò che ha
     * SENTITO. Fra la fine dell'annuncio e il gesto passano qualche
     * centinaio di millisecondi — il tempo di decidere e di compiere
     * il movimento. Se nel frattempo la scansione è già passata alla
     * voce successiva, viene scelta quella sbagliata.
     *
     * È l'errore più frustrante di tutti, perché la persona ha fatto
     * tutto giusto: ha sentito "vocali", ha deciso, ha guardato in
     * alto — e si è ritrovata nel gruppo dopo.
     *
     * Entro la finestra di grazia dall'ultimo avanzamento, quindi, la
     * selezione vale per la voce PRECEDENTE: quella che la persona
     * stava ancora ascoltando quando ha deciso.
     *
     * A 0 (predefinito) il comportamento è quello di sempre.
     */
    const grazia = this.cfg.scan?.graceMs || 0;
    if (grazia > 0 && this._tAvanzamento != null
        && (now - this._tAvanzamento) < grazia
        && this._vocePrecedente != null
        && this._vocePrecedente !== this.level.index) {
      this.level.index = this._vocePrecedente;
      this.stats.graziaUsata = (this.stats.graziaUsata || 0) + 1;
    }
    this._tAvanzamento = null;

    const node = this.currentNode;
    if (!node) return;

    this.stats.selections++;
    // Non imparare da un intervallo falsato: dopo una sospensione il
    // tempo trascorso include la pronuncia del messaggio.
    if (!this._afterHold) this.timing.record(now - this.lastAnnounceAt);
    this._afterHold = false;
    this.emptyCycles = 0;

    if (node.children?.length) {
      this.stack.push({ node, index: 0 });
      this._entraConAttesa(now);
      return;
    }
    this._execute(node, now);
  }

  _execute(node, now) {
    switch (node.action) {
      case 'CHAR':
        this.buffer.letters += node.payload;
        this.stats.chars++;
        this._afterCompose(now, node.payload === ' ');
        break;
      case 'WORD': {
        // Il completamento sostituisce il prefisso già digitato.
        this.buffer.letters = '';
        this.buffer.words.push(node.payload);
        this.stats.predictionHits++;
        this._afterCompose(now, true);
        break;
      }
      case 'PHRASE': {
        // Pronuncia diretta: non passa dal buffer di composizione.
        const p = this.h.onOutput('speech', node.payload);
        this.buffer = { letters: '', words: [], sentence: '' };
        this.h.onBuffer({ ...this.buffer });
        this._resetToRoot(now, true);
        this._hold(p, now) || this._announceNow(now);
        return;
      }
      case 'SPEAK': {
        const said = this._speakSentence(now);
        // Si resta al livello di scrittura, posizionati sulle AZIONI:
        // dopo aver parlato spesso si vuole salvare o svuotare.
        this._backToWrite(now, said, 'azioni');
        return;
      }
      // Le cancellazioni RESTANO sulla propria voce.
      //
      // Cancellare quasi mai serve una volta sola: si sbaglia una
      // lettera e spesso se ne devono togliere due o tre. Tornando al
      // livello superiore bisognerebbe rientrare in AZIONI e riscorrere
      // fino alla stessa voce a ogni carattere. Restando qui, il gesto
      // successivo cancella subito ancora.
      case 'DEL_CHAR':
        if (this.buffer.letters) {
          this.buffer.letters = this.buffer.letters.slice(0, -1);
        } else if (this.buffer.words.length) {
          // Si riapre l'ultima parola E se ne toglie una lettera, in un
          // colpo solo. Limitandosi a riaprirla, la prima pressione non
          // cancellava nulla di visibile: si vedeva lo stesso testo e
          // sembrava che il comando non funzionasse.
          this.buffer.letters = this.buffer.words.pop().slice(0, -1);
        }
        this._afterCompose(now, false);
        this._restaQui(now);
        return;
      case 'DEL_WORD':
        if (this.buffer.letters) this.buffer.letters = '';
        else this.buffer.words.pop();
        this._afterCompose(now, false);
        this._restaQui(now);
        return;
      case 'CLEAR':
        this.buffer = { letters: '', words: [], sentence: '' };
        this._afterCompose(now, false);
        break;
      case 'REPEAT': {
        const txt = this._composedText();
        const p = this.h.onOutput('menu', txt || 'niente da rileggere');
        this._backToWrite(now, true, 'azioni');
        this._hold(p, now);
        return;
      }
      case 'UNDO_CORRECT': {
        const ok = this.annullaCorrezione();
        const p = this.h.onOutput('menu', ok ? 'correzione annullata' : 'niente da annullare');
        this._backToWrite(now, true, 'azioni');
        if (!this._hold(p, now)) this._announceNow(now);
        return;
      }
      case 'SPEAK_KEEP': {
        if (this.cfg.prediction?.autoCorrectMode === 'frase') this._correggiFrase();
        const text = this._composedText();
        if (!text) { this._hold(this.h.onOutput('menu', 'niente da leggere'), now); return; }
        const p = this.h.onOutput('speech', text, { keep: true });
        this._backToWrite(now, true, 'azioni');
        if (!this._hold(p, now)) this._announceNow(now);
        return;
      }
      case 'ASK_AI': {
        /* ══════════════════════════════════════════════════════════
         * CHIEDI ALL'ASSISTENTE
         * ══════════════════════════════════════════════════════════
         *
         * Il testo composto diventa una domanda, e la risposta viene
         * letta ad alta voce.
         *
         * ⚠️ Il testo NON viene svuotato: se la risposta non arriva o
         * non è quella sperata, chi ha impiegato minuti a scriverla non
         * deve riscriverla da capo. A svuotare ci pensa PARLA, che è
         * l'azione che dichiara il messaggio consegnato.
         *
         * ⚠️ E la scansione si ferma durante l'attesa e la lettura: la
         * voce guida che continua ad annunciare mentre l'assistente
         * parla renderebbe incomprensibili entrambe. Riprende da sola
         * quando la risposta è finita, come per PARLA. */
        const text = this._composedText();
        if (!text) { this._hold(this.h.onOutput('menu', 'niente da chiedere'), now); return; }
        const p = this.h.onAsk?.(text);
        this._backToWrite(now, true, 'azioni');
        if (!this._hold(p, now)) this._announceNow(now);
        return;
      }
      case 'SAVE_DRAFT': {
        const text = this._composedText();
        if (!text) { this._hold(this.h.onOutput('menu', 'niente da salvare'), now); return; }
        const r = this.h.onDraft?.('save', { text });
        // Il testo è al sicuro nell'archivio: si svuota la barra di
        // composizione. Lasciandolo lì il programma continuerebbe a
        // proporre SALVA per un testo già salvato, e bisognerebbe
        // cancellarlo a mano.
        this.buffer = { letters: '', words: [], sentence: '' };
        this.h.onBuffer({ ...this.buffer });
        this._backToWrite(now, true, 'azioni');
        if (!this._hold(r, now)) this._announceNow(now);
        return;
      }
      case 'DRAFT_SPEAK': {
        const r = this.h.onDraft?.('speak', { id: node.payload });
        this._resetToRoot(now, true);
        if (!this._hold(r, now)) this._announceNow(now);
        return;
      }
      case 'DRAFT_LOAD': {
        const r = this.h.onDraft?.('load', { id: node.payload });
        // Si torna alla scrittura: chi riprende un testo vuole continuarlo.
        this._resetToRoot(now, true);
        this.rebuild();
        const wi = this.level.node.children.findIndex(c => c.id === 'write');
        if (wi >= 0) { this.stack.push({ node: this.level.node.children[wi], index: 0 }); this.level.index = this._hotIndex(this.level.node); }
        this.lastStepAt = now;
        if (!this._hold(r, now)) this._announceNow(now);
        return;
      }
      case 'DRAFT_PRINT': {
        const testo = this.h.onDraft('text', { id: node.payload });
        this.h.onPrint?.(testo || '', node.payload, true);
        const p = this.h.onOutput('menu', 'stampa');
        this._hold(p, now) || this._announceNow(now);
        return;
      }
      case 'DRAFT_TELEGRAM': {
        const { id: idT, contatto: conT } = node.payload || {};
        const testoT = this.h.onDraft('text', { id: idT });
        this.h.onTelegram?.(conT, testoT || '', true);
        const pT = this.h.onOutput('menu', `messaggio a ${conT?.nome || 'destinatario'}`);
        this._hold(pT, now) || this._announceNow(now);
        return;
      }
      case 'DRAFT_EMAIL': {
        const { id, contatto } = node.payload || {};
        const testo = this.h.onDraft('text', { id });
        // L'invio è asincrono e la conferma la chiede l'applicazione:
        // qui si annuncia soltanto che il comando è partito.
        this.h.onEmail?.(contatto, testo || '', true);
        const p = this.h.onOutput('menu', `invio a ${contatto?.nome || 'destinatario'}`);
        this._hold(p, now) || this._announceNow(now);
        return;
      }
      case 'DRAFT_DELETE': {
        // Già confermato: la voce "CONFERMA ELIMINA" è nella scansione.
        const r = this.h.onDraft?.('delete', { id: node.payload, confermato: true });
        this._resetToRoot(now, true);
        if (!this._hold(r, now)) this._announceNow(now);
        return;
      }
      case 'CASA_COMANDO': {
        const { dispositivo, comando } = node.payload || {};
        this.h.onCasa?.(dispositivo, comando);
        const p = this.h.onOutput('menu', comando?.nome || 'comando');
        // Si resta fra i comandi: alzare il volume due volte deve
        // costare due gesti, non due giri dell'albero.
        this._hold(p, now) || this._announceNow(now);
        return;
      }
      case 'RADIO_OPEN': {
        const st = node.payload?.stazione;
        const p = this.h.onOutput('menu', st?.nome || 'radio');
        this.h.onRadio?.(st);
        // Si resta nell'elenco: cambiare stazione deve costare un gesto,
        // non un giro completo dell'albero.
        this._hold(p, now) || this._announceNow(now);
        return;
      }
      case 'MEDIA_OPEN': {
        const r = this.h.onMediaOpen?.(node.payload);
        this._resetToRoot(now, true);
        if (!this._hold(r, now)) this._announceNow(now);
        return;
      }
      case 'MEDIA': {
        // Il comando va al riproduttore; la scansione resta dov'è, così
        // si possono dare più comandi di seguito (avanti, avanti, pausa)
        // senza rientrare nel menu ogni volta.
        const p = this.h.onMedia?.(node.payload);
        this.lastStepAt = now;
        if (!this._hold(p, now)) this._announceNow(now);
        return;
      }
      case 'BACK':
        this._up(now);
        return;
      case 'PAUSE':
        this.pause(now);
        return;
      case 'ROOT':
        this._resetToRoot(now);
        return;
      default:
        console.warn('[scan] azione sconosciuta:', node.action);
    }

    // Dopo una lettera si torna al livello di scrittura, non alla radice,
    // e si riparte dal primo gruppo utile saltando ESCI e AZIONI.
    // Dopo uno SPAZIO o una cancellazione si riparte invece dalle
    // AZIONI: la parola è finita, o si sta correggendo, e in entrambi
    // i casi il passo successivo probabile è un'azione.
    const daAzioni = node.action !== 'CHAR' || node.payload === ' ';
    if (this.stack.some(f => f.node.id === 'write')) {
      this._backToWrite(now, true, daAzioni ? 'azioni' : 'gruppi');
      this._announce(now);
      this._pushState();
    } else {
      this._resetToRoot(now, true);
    }
    return;
  }

  _afterCompose(now, wordEnded) {
    if (wordEnded) {
      const w = this.buffer.letters.trim();
      if (w) {
        this.buffer.words.push(w);
        this.buffer.letters = '';
        /* ── Autocorrezione, parola per parola ──
         * La parola è appena finita: è il momento in cui correggerla
         * costa meno, perché la persona non ha ancora ricominciato a
         * scrivere. Il correttore restituisce null ogni volta che c'è
         * il minimo dubbio, quindi qui non serve alcuna cautela in
         * più: se torna qualcosa, è perché è sicuro. */
        const prec = this.buffer.words.length > 1
          ? this.buffer.words[this.buffer.words.length - 2] : null;
        const corr = this.h.onCorrect?.(w, prec, 'parola');
        if (corr && corr.parola && corr.parola !== w) {
          this.buffer.words[this.buffer.words.length - 1] = corr.parola;
          this.ultimaCorrezione = { da: w, a: corr.parola, indice: this.buffer.words.length - 1 };
        }
      }
    }
    this.buffer.sentence = this._composedText();
    this.h.onBuffer({ ...this.buffer });
  }

  /**
   * Annulla l'ultima correzione automatica, riportando la parola come
   * era stata scritta. Disponibile solo se richiesto: l'obiettivo è che
   * non serva mai.
   */
  annullaCorrezione() {
    const c = this.ultimaCorrezione;
    if (!c) return false;
    if (this.buffer.words[c.indice] !== c.a) { this.ultimaCorrezione = null; return false; }
    this.buffer.words[c.indice] = c.da;
    this.ultimaCorrezione = null;
    this.buffer.sentence = this._composedText();
    this.h.onBuffer({ ...this.buffer });
    return true;
  }

  /**
   * Correzione dell'intera frase, prima di pronunciarla.
   *
   * Vale più della somma delle correzioni singole: avendo tutta la
   * frase, ogni parola ha un contesto già corretto alla sua sinistra, e
   * ambiguità che parola per parola resterebbero irrisolte qui si
   * sciolgono.
   */
  _correggiFrase() {
    const testo = this._composedText();
    if (!testo) return { testo, correzioni: [] };
    const r = this.h.onCorrect?.(testo, null, 'frase');
    if (!r || !r.testo || r.testo === testo) return { testo, correzioni: [] };
    this.buffer.words = r.testo.trim().split(/\s+/).filter(Boolean);
    this.buffer.letters = '';
    this.buffer.sentence = this._composedText();
    this.h.onBuffer({ ...this.buffer });
    return { testo: r.testo, correzioni: r.correzioni || [] };
  }

  /** Carica un testo nel buffer di composizione, per continuarlo. */
  loadText(text, now) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean);
    this.buffer = { letters: '', words, sentence: (text || '').trim() };
    this.h.onBuffer({ ...this.buffer });
    this._pushState();
  }

  _composedText() {
    const parts = [...this.buffer.words];
    if (this.buffer.letters.trim()) parts.push(this.buffer.letters.trim());
    return parts.join(' ');
  }

  /**
   * Ferma la scansione finché il messaggio non è stato pronunciato.
   * `onOutput` può restituire una promessa (nel browser) oppure nulla
   * (nei test), quindi la logica resta verificabile senza audio.
   */
  _hold(result, now, fallbackMs = 0) {
    const resume = () => {
      this.suspended = false;
      this.suspendUntil = 0;
      this.lastStepAt = this._now || now;
      this._afterHold = true;
      // Riannuncia la voce corrente: chi ascoltava ha perso il filo
      // durante il messaggio e deve sapere dov'è.
      if (!this.paused) { this._announce(this.lastStepAt); this._pushState(); }
    };
    if (result && typeof result.then === 'function') {
      this.suspended = true;
      // Tetto di sicurezza: se la promessa non arrivasse mai, la
      // scansione riprende comunque.
      this.suspendUntil = now + 25000;
      this._pushState();
      result.then(resume, resume);
      return true;
    }
    if (fallbackMs > 0) {
      this.suspended = true;
      this.suspendUntil = now + fallbackMs;
      this._pushState();
      return true;
    }
    return false;
  }

  _speakSentence(now) {
    // In modalità frase si corregge PRIMA di pronunciare: la voce deve
    // dire ciò che la persona voleva dire, non ciò che è riuscita a
    // digitare.
    if (this.cfg.prediction?.autoCorrectMode === 'frase') this._correggiFrase();
    const text = this._composedText();
    if (!text) {
      this._hold(this.h.onOutput('menu', 'niente da dire'), now || this._now || 0);
      return false;
    }
    const p = this.h.onOutput('speech', text);
    this.buffer = { letters: '', words: [], sentence: '' };
    this.h.onBuffer({ ...this.buffer });
    this._hold(p, now || this._now || 0);
    return true;
  }

  /**
   * Torna al livello di scrittura posizionandosi dove conviene.
   *
   * @param dove 'azioni' → riparte da AZIONI, 'gruppi' → dal primo
   *        gruppo di lettere.
   *
   * La distinzione fa risparmiare un ciclo intero. Dopo un'AZIONE
   * (rileggi, salva, cancella) è molto probabile che ne serva un'altra:
   * rileggere, poi rileggere ancora, poi salvare o parlare. Ripartendo
   * dalle vocali bisognerebbe aspettare tutto il giro. Dopo una LETTERA
   * invece si sta scrivendo, e conviene ripartire dai gruppi.
   *
   * Anche dopo uno SPAZIO si riparte dalle azioni: una parola è finita,
   * e spesso è il momento di far parlare o rileggere.
   */
  _backToWrite(now, silent, dove = 'gruppi') {
    const wl = this.stack.findIndex(f => f.node.id === 'write');
    if (wl < 0) { this._resetToRoot(now, silent); return; }
    this.stack = this.stack.slice(0, wl + 1);
    this.rebuild();
    const figli = this.level.node.children || [];
    const i = dove === 'azioni' ? figli.findIndex(c => c.id === 'act') : -1;
    this.level.index = i >= 0 ? i : this._hotIndex(this.level.node);
    this.lastStepAt = now;
    if (!silent) { this._announce(now); }
    this._pushState();
  }

  _announceNow(now) { this._announce(now); this._pushState(); }

  _resetToRoot(now, silent = false) {
    this.stack = [{ node: this.tree, index: 0 }];
    this.emptyCycles = 0;
    this.lastStepAt = now;
    if (!silent) this._announce(now);
    this._pushState();
  }

  /**
   * ANNULLA — la semantica va scelta con cura, perché è l'azione più
   * frequente dopo la selezione e un comportamento sorprendente qui
   * costa moltissimo a chi deve ripararlo con un solo gesto.
   *
   * Regola: se siamo scesi dentro un gruppo, si risale di un livello
   * (l'utente ha sbagliato gruppo e vuole tornare indietro). Se siamo
   * al livello di partenza, si cancella l'ultimo carattere o parola.
   *
   * "Livello di partenza" NON è la radice: dopo ogni lettera si resta
   * nel livello di scrittura, quindi lì l'annullamento deve cancellare,
   * non navigare.
   */
  undo(now) {
    this.stats.undos++;
    const homeDepth = this._homeDepth();
    if (this.stack.length > homeDepth) { this._up(now); return; }

    if (this.buffer.letters) this.buffer.letters = this.buffer.letters.slice(0, -1);
    else if (this.buffer.words.length) {
      // Riapre l'ultima parola come lettere modificabili, invece di
      // buttarla: cancellare per errore una parola intera costerebbe
      // decine di selezioni per riscriverla.
      const w = this.buffer.words.pop();
      this.buffer.letters = w.slice(0, -1);
    } else {
      this.h.onOutput('menu', 'niente da annullare');
      this._pushState();
      return;
    }
    this._afterCompose(now, false);
    this.h.onOutput('menu', 'annullato');
    this._pushState();
  }

  /**
   * Resta sulla voce appena usata, pronta a essere ripetuta.
   *
   * Si concede lo stesso respiro dell'ingresso in una sezione: chi ha
   * appena fatto un gesto non è pronto a farne subito un altro, e senza
   * pausa la voce scorrerebbe via prima che possa ripeterla. Alla
   * scadenza viene riannunciata, così si sa di essere ancora lì.
   */
  _restaQui(now) {
    const ms = this.attesaCorrente;
    this.emptyCycles = 0;
    this.lastStepAt = now;
    if (ms > 0) {
      this.attesaFino = now + ms;
      this._pushState();
      return;
    }
    this._announce(now);
    this._pushState();
  }

  /** Indice da cui far ripartire la scansione dopo una composizione. */
  _hotIndex(node) {
    const i = (node.children || []).findIndex(c => c.hot);
    return i >= 0 ? i : 0;
  }

  /** Profondità del livello a cui si torna dopo aver composto un carattere. */
  _homeDepth() {
    const wl = this.stack.findIndex(f => f.node.id === 'write');
    return wl >= 0 ? wl + 1 : 1;
  }
}
