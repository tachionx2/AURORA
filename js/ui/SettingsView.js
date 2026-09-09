/**
 * SettingsView.js — Pannello impostazioni.
 *
 * Generato dalla configurazione, non scritto a mano: aggiungere un
 * parametro in config.js lo fa comparire qui da solo.
 *
 * Regola di progetto: la pagina "Parla" non ha nessun controllo di
 * taratura. Chi la usa deve vedere una cosa sola alla volta. Tutta la
 * complessità vive qui, dove la manovra un assistente.
 */

import { DEFAULT_CONFIG, GESTURE_CHANNELS, ACTIONS, DEFAULT_GROUPS, ALPHABETICAL_GROUPS, DEFAULT_PHRASE_GROUPS, deepClone } from '../core/config.js';
import { EXPR_CHECKS } from '../signal/GestureEngine.js';
import { ISTRUZIONI as ISTRUZIONI_TG } from '../lang/Telegram.js';
import { CHANNEL_PRESETS } from '../core/config.js';
import { ESEMPIO_NETLIFY, indirizzoValido, verificaConfigurazione } from '../lang/Mailer.js';
import { MODELLI, ISTRUZIONI, entitaValida, verificaDomotica, comandiDi, provaConnessione } from '../device/HomeAssistant.js';
import { t, L } from '../core/i18n.js';
import { BUILD } from '../core/version.js';

/** Etichette bilingui: [italiano, inglese]. */
const P = L.pick;

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};

function field(label, desc, control, valueEl) {
  const f = h('div', 'field');
  const l = h('label', null, `${label}${desc ? `<span class="desc">${desc}</span>` : ''}`);
  f.append(l, control);
  if (valueEl) f.append(valueEl);
  return f;
}

/**
 * Interruttori che aprono o chiudono una parte della scheda.
 *
 * Solo questi provocano il ridisegno immediato: gli altri no, perché
 * ridisegnare a ogni tocco farebbe perdere il punto in cui si stava
 * scorrendo — fastidioso in una scheda lunga come questa.
 */
/* ══════════════════════════════════════════════════════════════════
 * INTERRUTTORI CHE RIVELANO ALTRI CONTROLLI
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ Un comando che non mostra subito ciò che governa sembra guasto.
 *
 * Le impostazioni si ridisegnano solo quando serve: ridisegnare a ogni
 * tocco farebbe saltare il punto in cui si sta lavorando. Ma un
 * interruttore che SVELA altri controlli deve ridisegnare, altrimenti
 * quei controlli compaiono solo cambiando scheda e tornando indietro.
 *
 * È successo cinque volte in questo progetto — posta, radio, canale
 * combinato, assistente — sempre allo stesso modo: si aggiunge una
 * sezione condizionale e ci si dimentica di questa lista.
 *
 * ⚠️ Perciò la lista NON basta più da sola: c'è una verifica
 * automatica che cerca nel file ogni `cfg.qualcosa.enabled ?` e
 * controlla che sia elencato qui. Aggiungendo una sezione nuova senza
 * dichiararla, il test lo dice subito invece di lasciarlo scoprire a
 * chi la usa.
 */
const INTERRUTTORI_CHE_APRONO = new Set([
  'assistente.enabled',
  'telegram.enabled',
  // Cambiando fornitore cambiano modello predefinito e note.
  'assistente.provider',
  'debug.console',
  'detection.irisOcclusionFix',
  'signal.sogliaRelativa',
  'signal.modoGrezzo',
  'signal.normalizzaSuRumore',
  'email.enabled',
  'radio.enabled',
  'domotica.enabled',
  'stampa.enabled',
  'detection.faceChannels',
  'device.mouse.enabled',
  'device.enabled',
  'prediction.autoCorrect',
  'audio.useVoiceBank',
  'pointer.enabled',
  'signal.blinkAutoCalibrate',
  // ⚠️ Senza questo, accendendo il canale combinato l'elenco dei
  // canali da sommare non compariva: bisognava cambiare gruppo e
  // tornare indietro. Un comando che non mostra ciò che governa
  // sembra guasto.
  'gestures.COMBO.enabled',
  'signal.blinkRichiedeIride',
  'detection.irisOcclusionFix',
  'stampa.enabled',
]);

export class SettingsView {
  constructor(root, app) { this.root = root; this.app = app; }

  render() {
    const cfg = this.app.cfg;
    this.root.innerHTML = '';
    document.getElementById('profileName').value = cfg.profileName || '';

    /* ══════════════════════════════════════════════════════════════════
     * QUATTRO GRUPPI, NELL'ORDINE IN CUI SI CONFIGURA
     * ══════════════════════════════════════════════════════════════════
     *
     * Le schede erano venticinque, tutte una dopo l'altra: trovare
     * quella giusta voleva dire scorrere e ricordare. Ora sono
     * raggruppate secondo l'ordine naturale del lavoro di chi installa:
     * prima si fa vedere la persona alla telecamera, poi si tara come
     * rilevare i suoi movimenti, poi si decide come comunica, e infine
     * si collega ciò che c'è intorno.
     *
     * ⚠️ Nessuna scheda è stata rimossa o modificata: solo raggruppata.
     */
    this.gruppi = [
      {
        id: 'vedere',
        nome: P(['Vedere la persona', 'Seeing the person']),
        sub: P(['Aspetto, telecamera e riconoscimento del volto',
                'Appearance, camera and face detection']),
        schede: [
          () => this._uiCard(cfg),
          () => this._sourceCard(cfg),
          () => this._detectionCard(cfg),
          () => this._channelCard(cfg),
        ],
      },
      {
        id: 'capire',
        nome: P(['Capire i movimenti', 'Understanding movements']),
        sub: P(['Gesti, segnale, ammiccamento e puntatore',
                'Gestures, signal, blinking and pointer']),
        schede: [
          () => this._gesturesCard(cfg),
          () => this._faceCard(cfg),
          () => this._comboCard(cfg),
          () => this._signalCard(cfg),
          () => this._blinkCard(cfg),
          () => this._directionCard(cfg),
          () => this._debugCard(cfg),
          () => this._pointerCard(cfg),
        ],
      },
      {
        id: 'comunicare',
        nome: P(['Come comunica', 'How they communicate']),
        sub: P(['Scansione, voce, lettere, frasi e predizione',
                'Scanning, voice, letters, phrases and prediction']),
        schede: [
          () => this._scanCard(cfg),
          () => this._keyboardCard(cfg),
          () => this._audioCard(cfg),
          () => this._voiceBankCard(cfg),
          () => this._groupsCard(cfg),
          () => this._phraseGroupsCard(cfg),
          () => this._draftsCard(cfg),
          () => this._predictionCard(cfg),
        ],
      },
      {
        id: 'mondo',
        nome: P(['Aprirsi al mondo', 'Reaching outside']),
        sub: P(['Uso senza internet, mouse, radio, posta e dispositivi',
                'Offline use, mouse, radio, email and devices']),
        schede: [
          () => this._offlineCard(cfg),
          () => this._mouseCard(cfg),
          () => this._radioCard(cfg),
          () => this._emailCard(cfg),
          () => this._assistenteCard(cfg),
          () => this._telegramCard(cfg),
          () => this._domoticaCard(cfg),
          () => this._deviceCard(cfg),
        ],
      },
    ];

    /* Il gruppo scelto si ricorda: ridisegnando dopo ogni modifica —
     * cosa che accade a ogni interruttore che apre una sezione — si
     * tornerebbe altrimenti sempre al primo, perdendo il punto in cui
     * si stava lavorando. */
    if (!this.gruppoAttivo || !this.gruppi.some(g => g.id === this.gruppoAttivo)) {
      this.gruppoAttivo = this.gruppi[0].id;
    }

    const barra = h('div', 'set-tabs');
    for (const g of this.gruppi) {
      const b = h('button', 'set-tab' + (g.id === this.gruppoAttivo ? ' is-on' : ''));
      b.append(h('strong', null, g.nome), h('em', null, g.sub));
      b.onclick = () => {
        this.gruppoAttivo = g.id;
        this.render();
        // Si torna in cima: cambiando gruppo ci si aspetta di vedere
        // la prima scheda, non il punto in cui si era altrove.
        this.root.scrollIntoView?.({ block: 'start', behavior: 'auto' });
      };
      barra.append(b);
    }
    this.root.append(barra);

    const gruppo = this.gruppi.find(g => g.id === this.gruppoAttivo);
    for (const fai of gruppo.schede) this.root.append(fai());
  }

  /* ------------------------- helper di controllo ------------------------- */

  _toggle(path, label, desc) {
    // ⚠️ DEVE essere una <label>, non un <div>.
    // La casella vera ha dimensione zero (è nascosta) e sopra c'è uno
    // <span> disegnato. Dentro un <div> quel disegno non è collegato a
    // niente: si vede un interruttore che NON si può premere. Solo la
    // <label> propaga il clic alla casella che contiene.
    const wrap = h('label', 'switch');
    const inp = h('input');
    inp.type = 'checkbox';
    inp.checked = !!this.app.get(path);
    inp.onchange = () => {
      this.app.set(path, inp.checked);
      /* ⚠️ Alcuni interruttori APRONO una parte della scheda: elenco
       * dei destinatari, stazioni radio, dispositivi di casa. Senza
       * ridisegnare, quella parte compariva solo cambiando scheda e
       * tornando indietro — e sembrava che l'impostazione non
       * funzionasse. Si ridisegna quindi subito, ma solo per gli
       * interruttori che governano davvero qualcosa: ridisegnare a
       * ogni tocco farebbe perdere il punto in cui si stava
       * scorrendo. */
      if (INTERRUTTORI_CHE_APRONO.has(path)) this.render();
    };
    wrap.append(inp, h('span'));
    return field(label, desc, wrap);
  }

  _range(path, label, desc, min, max, step, unit = '') {
    const inp = h('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
    inp.value = this.app.get(path);
    const val = h('span', 'val', `${inp.value}${unit}`);
    inp.oninput = () => { val.textContent = `${inp.value}${unit}`; this.app.set(path, parseFloat(inp.value)); };
    return field(label, desc, inp, val);
  }

  _number(path, label, desc, min, max, step = 1) {
    const inp = h('input');
    inp.type = 'number'; inp.min = min; inp.max = max; inp.step = step;
    inp.value = this.app.get(path);
    inp.onchange = () => this.app.set(path, parseFloat(inp.value));
    return field(label, desc, inp);
  }

  _select(path, label, desc, options) {
    const sel = h('select');
    for (const [v, t] of Object.entries(options)) {
      const o = h('option', null, t); o.value = v;
      if (String(this.app.get(path)) === v) o.selected = true;
      sel.append(o);
    }
    /* ⚠️ Anche i MENU A TENDINA possono governare altri controlli.
     *
     * L'elenco degli interruttori che ridisegnano copriva solo le
     * caselle. Ma cambiando fornitore dell'assistente cambiano il
     * modello predefinito e le note del servizio: restavano quelli di
     * prima finché non si usciva dalla scheda e si rientrava. Stessa
     * classe di difetto, altra forma di controllo. */
    sel.onchange = () => {
      this.app.set(path, sel.value);
      if (INTERRUTTORI_CHE_APRONO.has(path)) this.render();
    };
    return field(label, desc, sel);
  }

  _card(title, note, children) {
    const c = h('section', 'card');
    c.append(h('h2', null, title));
    if (note) c.append(h('p', 'note', note));
    children.forEach(x => c.append(x));
    return c;
  }

  /* ------------------------------- Schede -------------------------------- */

  _sourceCard(cfg) {
    const camSel = h('select');
    camSel.id = 'cameraSelect';
    camSel.append(Object.assign(h('option', null, 'Predefinita'), { value: '' }));
    camSel.onchange = () => this.app.set('source.deviceId', camSel.value);
    this.app.listCameras().then(list => {
      for (const d of list) {
        const o = h('option', null, d.label); o.value = d.id;
        if (cfg.source.deviceId === d.id) o.selected = true;
        camSel.append(o);
      }
    });

    const bridge = h('input', 'input');
    bridge.value = cfg.source.bridgeUrl;
    bridge.onchange = () => this.app.set('source.bridgeUrl', bridge.value);

    return this._card(t('sec.source'),
      'Su PC funzionano sia le camere interne sia quelle USB. Su Android il browser espone solo le camere interne: per una camera esterna serve la shell nativa, che la ripubblica sul bridge locale.',
      [
        this._select('source.mode', 'Modalità', null, {
          camera: 'Camera del dispositivo', bridge: 'Bridge locale (shell nativa)',
        }),
        field('Dispositivo', null, camSel),
        field('Indirizzo bridge', 'WebSocket su 127.0.0.1 servito dalla shell nativa', bridge),
        this._number('source.width', 'Larghezza', null, 160, 1920, 16),
        this._number('source.height', 'Altezza', null, 120, 1080, 16),
        this._number('source.fps', 'Fotogrammi al secondo', 'Per un gesto di 400 ms bastano 30 fps', 5, 120),
        this._toggle('source.mirror', P(['Anteprima specchiata', 'Mirrored preview']),
          P(['Solo grafica: non altera la misura', 'Display only: does not affect the measurement'])),
        this._toggle('source.autoStart', P(['Avvia camera all\'apertura', 'Start camera on launch']),
          P(['Evita di dimenticare di accenderla prima dell\'uso',
             'Avoids forgetting to turn it on before use'])),
      ]);
  }

  _detectionCard(cfg) {
    return this._card(t('sec.detection'),
      'In luce visibile il segnale è il centro dell\'IRIDE: con occhi scuri la pupilla non è separabile. Sotto infrarosso è il centro della PUPILLA, molto più preciso. Tutto è normalizzato sulla larghezza dell\'occhio, quindi il montaggio (occhiali, fascia, braccio) non cambia i parametri.',
      [
        this._select('detection.mode', 'Modalità', null, {
          rgb: 'RGB — luce visibile', ir: 'IR — infrarosso', auto: 'Ibrida — MediaPipe guida, IR misura',
        }),
        this._select('detection.activeEye', 'Occhio attivo', 'Etichette riferite al lato dell\'immagine', {
          both: 'Entrambi', left: 'Solo sinistro', right: 'Solo destro',
        }),
        this._range('detection.minConfidence',
          P(['Confidenza minima', 'Minimum confidence']),
          P(['Sotto questa soglia il campione viene scartato. ⚠️ Alzarla NON affina il rilevamento: lo restringe, e proprio dove serve di più — la fiducia cala quando la palpebra si abbassa, cioè durante uno sguardo verso il basso. Sopra 0,45 quel movimento comincia a sparire a metà. Il consigliato è 0,40; se il segnale si interrompe prima del picco, abbassala.',
             'Below this the sample is discarded. ⚠️ Raising it does NOT sharpen detection: it narrows it, exactly where it matters most — confidence drops as the lid lowers, that is, during a downward gaze. Above 0.45 that movement starts vanishing halfway. Recommended is 0.40; if the signal breaks before the peak, lower it.']),
          0.1, 0.9, 0.05),
        this._range('detection.roiPadding', 'Margine ROI', 'Quanto allargare l\'area attorno all\'occhio', 1, 3, 0.1, '×'),
        /* ⚠️ Fino a 90, non a 50.
         *
         * Il percentile decide quanti pixel vengono considerati
         * pupilla. Con un sensore a colori usato come infrarosso, o con
         * un'iride chiara, la pupilla può occupare una frazione molto
         * maggiore di quella prevista — e fermando il cursore a
         * cinquanta non la si raggiunge mai. */
        this._number('detection.irDarkPercentile', 'IR · percentile scuro', 'Percentuale di pixel più scuri considerati pupilla. Alzare se il bordo trovato è troppo piccolo o cade fuori dall\'iride', 1, 90),
        this._number('detection.irMinArea', 'IR · area minima', 'px², scarta blob troppo piccoli', 5, 20000, 5),
        /* ⚠️ Quattro filtri per la SOLA modalità infrarossa, tutti
         * spenti di default. Ciascuno con il proprio interruttore: se
         * uno peggiora si toglie da solo, senza rimettere in
         * discussione gli altri. */
        this._number('detection.irBlur', 'IR · sfocatura (px)', 'Toglie il rumore del sensore, che fa cadere pixel isolati fra i più scuri e attacca ciglia e ombre alla pupilla. 1 o 2 bastano; sui bordi veri, che sono ampi, non incide. 0 = spenta', 0, 4),
        this._number('detection.irApertura', 'IR · apertura morfologica', 'Erosione seguita da dilatazione: stacca la pupilla da ciò che la tocca per un filo di pixel, e ripristina poi la dimensione. È il rimedio quando le ciglia fanno da ponte e il bordo si allunga. 0 = spenta', 0, 3),
        this._number('detection.irPesoCentro', 'IR · preferisci il centro', 'Il riquadro è centrato sull\'occhio, quindi la pupilla sta vicino al centro mentre ombre e ciglia stanno ai bordi. ⚠️ Scoraggia, non esclude: chi guarda molto in alto porta la pupilla verso il bordo, ed escluderla la perderebbe proprio nel momento del gesto. 0 = nessuna preferenza', 0, 0.9, 0.1),
        this._number('detection.irPesoContinuita', 'IR · continuità nel tempo', 'La pupilla non salta di venti pixel in trentatré millesimi di secondo: preferire ciò che sta vicino a dove era prima toglie gran parte della frammentazione del segnale. 0 = nessuna memoria', 0, 0.9, 0.1),
        this._number('detection.irContinuitaMs', 'IR · durata della memoria', 'Dopo quanto tempo senza rilevamento si ricomincia liberi. ⚠️ Serve: senza, un rilevamento perso resterebbe ancorato al posto sbagliato per sempre', 100, 3000, 100),
        this._number('detection.irClahe', 'IR · contrasto locale (CLAHE)', 'Equalizza ogni riquadro dell\'immagine per conto suo. ⚠️ È l\'unico filtro che aggiunge davvero informazione, perché non conserva l\'ordine dei pixel: serve quando un lato dell\'occhio è in ombra e nessuna soglia unica può separare iride e sclera. Amplifica anche il rumore: usalo insieme alla sfocatura. 0 = spento, 2-4 è il campo utile', 0, 8, 0.5),
        this._number('detection.irClaheRiquadri', 'IR · riquadri del contrasto locale', 'In quanti riquadri per lato si divide l\'immagine. Più riquadri = adattamento più locale ma più rumore', 1, 8),
        this._number('detection.irRaffinaBordo', 'IR · raffina sul bordo', 'Cambia principio: invece di fidarsi della soglia, cerca dove la luminanza cambia più bruscamente lungo raggi che partono dal centro. ⚠️ È il modo dei tracciatori professionali, e la ragione è che una soglia sbagliata di poco sposta il centro di molto, mentre il massimo del gradiente resta dov\'è. 0 = spento, 1 = acceso', 0, 1),
        this._number('detection.irRaggi', 'IR · quanti raggi', 'Su quante direzioni si cerca il bordo. Più raggi = centro più stabile ma più calcolo', 8, 64),
        this._number('detection.irGradienteMin', 'IR · gradiente minimo', 'Quanto deve essere netto il passaggio scuro-chiaro per essere considerato un bordo. Troppo basso accetta il rumore; troppo alto non trova nulla e il raffinamento si tira indietro lasciando il centro di prima', 2, 60),
        this._number('detection.irMaxAllungamento', 'IR · allungamento massimo', 'Quanto può essere lunga rispetto a larga una regione per essere ancora considerata un\'iride. Un\'iride resta tonda anche tagliata dalla palpebra; un\'ombra o le ciglia no. Abbassare se il bordo giallo appare ellittico e il centro finisce sul bordo dell\'occhio. A 0 il controllo è tolto', 0, 6, 0.1),
        this._number('detection.irMaxArea', 'IR · area massima', 'px², scarta blob troppo grandi: se il bordo scappa sulla palpebra o sull\'ombra dell\'orbita, abbassare questo valore', 100, 60000, 100),
        this._toggle('detection.irUseGlint', 'IR · usa glint (PCCR)', 'Sottrae il riflesso corneale: cancella i movimenti di testa'),
        this._toggle('detection.irInvert', 'IR · inverti immagine', 'Per sensori che restituiscono il negativo'),
      ]);
  }

  /* ⚠️ Ritorno ai filtri sicuri.
   *
   * I parametri applicati restano salvati: una taratura sbagliata —
   * per esempio un passa-basso dentro la banda del gesto — rovina
   * anche tutte le sessioni successive, e sembra un difetto del
   * programma invece che una regolazione da rifare.
   *
   * Questo comando riporta SOLO i filtri e le soglie ai valori
   * predefiniti, senza toccare nient'altro. */
  /* ⚠️ Ritorno ai valori sicuri.
   *
   * I parametri applicati restano salvati: una taratura sbagliata —
   * per esempio un passa-basso dentro la banda del gesto — rovina
   * anche tutte le sessioni successive, e sembra un difetto del
   * programma invece che una regolazione da rifare.
   *
   * ⚠️ L'elenco è ricavato dai valori PREDEFINITI, non scritto a mano.
   * Scritto a mano era già divenuto incoerente: la diagnostica poteva
   * proporre tredici parametri e il ripristino ne riportava sei, così
   * sette regolazioni restavano incastrate sui valori applicati senza
   * modo di tornare indietro. Ogni parametro nuovo aggiunto alla
   * diagnostica si aggiunge qui da solo.
   */
  _viePrestazioni() {
    return [
      // Filtri e soglie: il cuore del rilevamento.
      'signal.medianWindowMs', 'signal.lowPassHz',
      'signal.thresholdOn', 'signal.thresholdOff',
      'signal.baselineTauSec', 'signal.minSigma',
      // Stima del rumore.
      'signal.sigmaPercentile', 'signal.sigmaRitaratura',
      'signal.sigmaFinestraMs', 'signal.normalizzaSuRumore', 'signal.sigmaFisso',
      // Distinzione fra ammiccamento e sguardo alzato.
      'signal.blinkRatio', 'signal.blinkRichiedeIride',
      'signal.blinkSogliaIride', 'signal.blinkSmentiSopra',
      'signal.blinkClosedRatio', 'signal.blinkFloor',
      /* ⚠️ Le sovrascritture PER DIREZIONE.
       *
       * `thresholdDir` e `gainDir` contengono soglie e guadagni
       * specifici di ciascuna direzione, e quando ci sono VINCONO su
       * quelli globali. Non erano nella lista: premendo "torna ai
       * predefiniti" i valori globali tornavano a posto ma la soglia
       * effettiva restava quella scritta lì, e sembrava che il
       * comando non funzionasse.
       *
       * Vanno svuotate, non riportate a un valore: "nessuna
       * sovrascrittura" è proprio lo stato predefinito. */
      'signal.thresholdDir', 'signal.gainDir', 'signal.gainEye',
      'signal.modoGrezzo', 'signal.modoGrezzoRiposoSec', 'signal.perOcchio',
      'signal.plafondSigma', 'signal.sogliaRelativa', 'signal.sogliaFrazione',
      // Rilevamento e durate.
      'detection.minConfidence',
      // Parametri della modalità infrarossa, proposti dalla diagnostica
      // quando quella modalità è in uso.
      'detection.irDarkPercentile', 'detection.irMinArea', 'detection.irMaxArea',
      /* ⚠️ Anche i filtri aggiunti dopo: erano stati dimenticati qui, e
       * "torna ai predefiniti" li lasciava accesi — proprio quando
       * servono di più, cioè quando una prova è andata male e si vuole
       * ripartire puliti. */
      'detection.irMaxAllungamento', 'detection.irBlur', 'detection.irApertura',
      'detection.irPesoCentro', 'detection.irPesoContinuita', 'detection.irContinuitaMs',
      'detection.irClahe', 'detection.irClaheRiquadri',
      'detection.irRaffinaBordo', 'detection.irRaggi', 'detection.irGradienteMin',
      'detection.mostraCanali',
      'gestures.UP.dwellMs', 'gestures.UP.maxMs',
      'gestures.blinkMaxPulseMs', 'gestures.blinkMinPulseMs',
    ];
  }

  _ripristinaFiltri() {
    const leggi = (via) => {
      let n = DEFAULT_CONFIG;
      for (const k of via.split('.')) n = n?.[k];
      return n;
    };
    let quanti = 0;
    for (const via of this._viePrestazioni()) {
      const val = leggi(via);
      if (val === undefined) continue;      // parametro non più esistente
      /* Gli oggetti di sovrascrittura si copiano, non si condividono:
       * assegnare il riferimento ai valori predefiniti farebbe sì che
       * la prima modifica successiva li corrompa per sempre. */
      this.app.set(via, (val && typeof val === 'object') ? deepClone(val) : val);
      quanti++;
    }
    this.render();
    this.app.toast(`${quanti} parametri riportati ai valori predefiniti`);
  }

  _signalCard(cfg) {
    return this._card(t('sec.signal'),
      'Il nistagmo oscilla a 2–6 Hz; il gesto volontario è un gradino sostenuto. I filtri rimuovono l\'oscillazione e lasciano il gradino. La baseline si congela durante il gesto: se la inseguisse, lo cancellerebbe dopo pochi secondi.',
      [
        /* ⚠️ Il ritorno ai valori sicuri, in cima e ben visibile.
         *
         * I parametri applicati restano salvati: una taratura sbagliata
         * — per esempio un passa-basso dentro la banda del gesto —
         * rovina anche tutte le sessioni successive, e sembra un
         * difetto del programma invece che una regolazione da rifare.
         * Deve essere la prima cosa che si trova qui. */
        (() => {
          const az = h('div', 'profile-actions');
          const b = h('button', 'btn btn-sm btn-primary',
            P(['Riporta filtri e soglie ai valori predefiniti',
               'Restore filters and thresholds to defaults']));
          b.onclick = () => this._ripristinaFiltri();
          az.append(b);
          return az;
        })(),
        h('p', 'note', P(
          ['⚠️ Filtrare troppo è peggio che filtrare poco. Un passa-basso sotto i 2,5 Hz o una mediana oltre i 350 ms tagliano anche il GESTO, non solo il tremore: l\'ampiezza rilevata crolla pur restando il movimento identico. Se dopo una taratura le ampiezze sono basse e calano nel tempo, il primo sospetto sono questi due valori — e il pulsante qui sopra li riporta a posto.',
             '⚠️ Over-filtering is worse than under-filtering. A low-pass below 2.5 Hz or a median beyond 350 ms cut the GESTURE too.'])),
        /* ══════════════════════════════════════════════════════════
         * TARATURE PER SINGOLO OCCHIO
         * ══════════════════════════════════════════════════════════
         *
         * ⚠️ Due occhi possono misurare diversamente lo STESSO
         * movimento: uno più coperto dalla palpebra, uno più obliquo,
         * uno abitualmente socchiuso. Chi guarda il video li vede
         * muoversi uguale, e ha ragione: è la MISURA a essere diversa.
         *
         * Le soglie restano comuni di proposito — sono il criterio con
         * cui si decide che un gesto è avvenuto e devono significare
         * la stessa cosa per entrambi. È il guadagno a portare i due
         * segnali sulla stessa scala.
         */
        h('div', 'vb-testa', P(['EQUILIBRIO FRA I DUE OCCHI', 'BALANCE BETWEEN THE EYES'])),
        h('p', 'sub', P(
          ['Questi guadagni pareggiano i due occhi, come si tarano due microfoni perché registrino allo stesso livello. A 1 non cambiano nulla, e la diagnostica li propone da sola.',
           'These gains balance the two eyes. At 1 they change nothing.'])),
        this._range('signal.gainEye.left',
          P(['Guadagno occhio sinistro', 'Left eye gain']), null, 0.5, 4, 0.05),
        this._range('signal.gainEye.right',
          P(['Guadagno occhio destro', 'Right eye gain']), null, 0.5, 4, 0.05),

        h('div', 'vb-testa', P(['FILTRI E RUMORE, PER OCCHIO', 'FILTERS AND NOISE, PER EYE'])),
        h('p', 'sub', P(
          ['Lasciati al valore generale valgono per entrambi. La diagnostica li misura separatamente e li propone; qui si possono correggere a mano. ⚠️ Un occhio più coperto o più obliquo ha un rumore diverso, e un filtro tarato sull\'altro lo penalizza.',
           'Left at the shared value they apply to both. Diagnostics measures them separately.'])),
        ...['left', 'right'].flatMap((eye) => {
          const nome = eye === 'left' ? 'SINISTRO' : 'DESTRO';
          const v = cfg.signal.perOcchio?.[eye] || {};
          const propri = Object.keys(v).length;
          const campi = [
            ['medianWindowMs', ['Finestra mediana', 'Median window'], 0, 800, 10, ' ms'],
            ['lowPassHz', ['Passa-basso', 'Low-pass'], 0.5, 8, 0.1, ' Hz'],
            ['baselineTauSec', ['Costante della baseline', 'Baseline time constant'], 5, 120, 5, ' s'],
            ['sigmaPercentile', ['Quanta parte è quiete', 'Rest fraction'], 0.10, 0.45, 0.01, ''],
            ['sigmaRitaratura', ['Ritaratura del percentile', 'Recalibration'], 0.8, 3, 0.01, ''],
            ['minConfidence', ['Confidenza minima', 'Minimum confidence'], 0.10, 0.80, 0.05, ''],
          ];
          const azzera = h('button', 'btn btn-sm',
            P([`Occhio ${nome.toLowerCase()}: torna ai valori generali`,
               `${nome}: back to shared values`]));
          azzera.onclick = () => {
            this.app.set(`signal.perOcchio.${eye}`, {});
            this.render();
          };
          const az = h('div', 'profile-actions');
          az.append(azzera);
          return [
            h('div', 'vb-testa', `OCCHIO ${nome}${propri ? ` — ${propri} valori propri` : ' — usa i valori generali'}`),
            ...campi.map(([k, et, min, max, step, suff]) => {
              const attuale = v[k];
              const riga = h('div', 'set-row');
              riga.append(h('label', null,
                P(et) + (attuale === undefined ? ' · generale' : '')));
              const inp = h('input');
              inp.type = 'range';
              inp.min = String(min); inp.max = String(max); inp.step = String(step);
              inp.value = String(attuale ?? cfg.signal[k] ?? min);
              inp.oninput = () => {
                const o = { ...(this.app.get(`signal.perOcchio.${eye}`) || {}) };
                o[k] = Number(inp.value);
                this.app.set(`signal.perOcchio.${eye}`, o);
                this.render();
              };
              riga.append(inp, h('span', 'val', inp.value + (suff || '')));
              return riga;
            }),
            az,
          ];
        }),

        h('div', 'vb-testa', P(['STABILITÀ NEL TEMPO', 'STABILITY OVER TIME'])),
        this._range('signal.plafondSigma',
          P(['Tetto all\'ampiezza in sigma', 'Cap on amplitude in sigma']),
          P(['La stima del rumore scende verso il proprio minimo, e con un gesto ampio l\'ampiezza sale per minuti prima di fermarsi — costringendo a inseguire con i guadagni. Questo tetto alza il minimo in proporzione al gesto di QUESTA persona, così l\'ampiezza si stabilizza attorno al valore indicato invece di crescere a lungo. ⚠️ Chi ha un gesto piccolo non viene penalizzato: per lui questo darebbe un minimo più basso di quello assoluto, e non si applica. A zero il tetto è tolto.',
             'Caps how high the amplitude can climb, shortening the transient.']),
          0, 60, 1, 'σ'),
        this._toggle('signal.sogliaRelativa',
          P(['Soglia come frazione del gesto', 'Threshold as a fraction of the gesture']),
          P(['⚠️ SPERIMENTALE, spenta di default. Misurare in multipli del rumore è il rapporto fra due grandezze che evolvono entrambe: anche quando tutto funziona quel numero non è stabile. L\'escursione del gesto invece lo è. Accendendo questa opzione la soglia significa "scatta quando il segnale supera questa frazione del gesto tipico di questa persona", e l\'ampiezza diventa costante per costruzione — pareggiando anche i due occhi da sola. Cambia però il significato delle soglie, che vanno riguardate.',
             '⚠️ EXPERIMENTAL, off by default. Makes the threshold a fraction of the person\'s own gesture.'])),
        ...(cfg.signal.sogliaRelativa ? [
          this._range('signal.sogliaFrazione',
            P(['Frazione del gesto a cui scatta', 'Fraction of the gesture at which it fires']),
            P(['0,40 significa "scatta al 40% del gesto tipico". Più basso = più sensibile.',
               '0.40 means "fires at 40% of the typical gesture".']),
            0.15, 0.80, 0.05),
        ] : []),

        h('div', 'vb-testa', P(['VALORI GENERALI', 'SHARED VALUES'])),
        this._range('signal.medianWindowMs', 'Finestra mediana', 'Rimuove le fasi rapide del nistagmo', 0, 800, 10, ' ms'),
        this._range('signal.lowPassHz', 'Passa-basso', 'Più basso = più stabile ma più lento', 0.3, 6, 0.1, ' Hz'),
        this._range('signal.baselineTauSec', 'Costante baseline', 'Insegue derive lente di postura e supporto', 3, 120, 1, ' s'),
        this._toggle('signal.baselineFreezeDuringGesture', 'Congela baseline nel gesto', 'Lasciare acceso salvo prova contraria'),
        /* ⚠️ Fino a 40, non a 10.
         *
         * In modalità infrarossa il segnale e il rumore hanno scale
         * molto diverse da quelle di MediaPipe, e le soglie utili
         * possono stare ben oltre i dieci sigma. Un cursore che si
         * ferma prima del valore necessario è un cursore che impedisce
         * di tarare, e obbliga a rinunciare a una modalità intera. */
        this._range('signal.thresholdOn', 'Soglia attivazione', 'In deviazioni standard. Alzare se ci sono falsi positivi', 1, 40, 0.1, 'σ'),
        this._range('signal.thresholdOff', 'Soglia rilascio', 'Deve restare sotto quella di attivazione', 0.2, 40, 0.1, 'σ'),
        this._range('signal.blinkLidThreshold', 'Soglia ammiccamento', 'Sotto questa apertura il campione è invalidato', 0.1, 0.9, 0.01),
        this._toggle('signal.blinkDiscriminate',
          P(['Distingui ammiccamento da sguardo in basso', 'Tell blink from looking down']),
          P(['Un ammiccamento dura poco; guardare in basso tiene la palpebra abbassata. Senza questa distinzione il canale "giù" veniva azzerato.',
             'A blink is brief; looking down keeps the lid lowered. Without this distinction the "down" channel was zeroed out.'])),
        this._range('signal.blinkClosedRatio',
          P(['Frazione di CHIUSURA vera', 'True CLOSURE fraction']),
          P(['Sotto questa frazione dell\'apertura di riposo l\'occhio è considerato CHIUSO, non solo abbassato: resta mascherato per tutta la durata, anche di minuti. Guardando in basso l\'apertura scende al 40-60% del riposo; chiudendo scende sotto il 25%. Alzarla fa scambiare uno sguardo in basso per una chiusura; abbassarla fa risultare "aperto" un occhio chiuso.',
             'Below this fraction of the resting opening the eye counts as CLOSED, not merely lowered: it stays masked for the whole duration, even minutes. Looking down brings the opening to 40-60% of rest; closing brings it below 25%. Raising it makes a downward gaze look like a closure; lowering it makes a closed eye look open.']),
          0.05, 0.5, 0.01),
        /* ══════════════════════════════════════════════════════════
         * DISTINZIONE FRA AMMICCAMENTO E SGUARDO ALZATO
         * ══════════════════════════════════════════════════════════
         * Sono i parametri più delicati di tutta la taratura: una
         * chiusura dichiarata per sbaglio maschera il gesto proprio
         * mentre avviene, e il suo transitorio gonfia la stima del
         * rumore abbassando TUTTE le ampiezze di quell'occhio.       */
        this._toggle('signal.blinkRichiedeIride',
          P(['Per dichiarare chiuso serve che l\'iride sparisca', 'Closure also requires the iris to disappear']),
          P(['⚠️ Il parametro più importante per chi tiene un occhio semichiuso o alza molto lo sguardo. Con la palpebra che copre, l\'apertura misurata si stringe e il gesto verrebbe scambiato per un ammiccamento — mascherato mentre avviene, con il suo transitorio che gonfia il rumore e abbassa tutte le ampiezze di quell\'occhio. In un ammiccamento vero la palpebra copre anche l\'IRIDE e il rilevamento crolla; stringendo gli occhi l\'iride resta visibile. Spegnere solo se gli ammiccamenti volontari non vengono più riconosciuti.',
             '⚠️ The most important parameter for someone who keeps an eye half-closed or looks far up. In a real blink the lid also covers the IRIS and detection collapses; when squinting the iris stays visible.'])),
        ...(cfg.signal.blinkRichiedeIride ? [
          this._range('signal.blinkSogliaIride',
            P(['Confidenza sopra cui l\'iride si vede ancora', 'Confidence above which the iris is still visible']),
            P(['Sopra questo valore di confidenza il rilevamento dell\'iride è ancora buono, quindi non è un ammiccamento. Guarda la CONFIDENZA nei contatori: se durante i gesti resta vicino a 1,00 e durante gli ammiccamenti veri scende molto, la soglia va messa fra i due. Alzarla rende la distinzione più prudente; abbassarla la rende più decisa.',
               'Above this confidence the iris is still well detected, so it is not a blink. Compare with the CONFIDENZA counter during gestures and during real blinks.']),
            0.2, 0.9, 0.05),
          this._range('signal.blinkSmentiSopra',
            P(['Apertura sopra cui vale la distinzione', 'Opening above which the distinction applies']),
            P(['Frazione dell\'apertura di riposo sotto la quale la distinzione NON si applica più: lì l\'occhio è considerato chiuso comunque. Serve a non smentire mai un ammiccamento vero, che scende molto in basso. ⚠️ Alzarla troppo restringe la finestra utile: con il riposo a 0,44 e questo valore a 0,45 la distinzione valeva solo fra 0,20 e 0,24, e uno sguardo molto alzato ci passava sotto — trentasette ammiccamenti fantasma in tre minuti. Abbassarla allarga la protezione.',
               'Fraction of the resting opening below which the distinction no longer applies. Raising it too much narrows the useful window.']),
            0.05, 0.60, 0.01),
        ] : []),
        this._range('signal.blinkSustainedMs',
          P(['Oltre questo tempo non è un ammiccamento', 'Beyond this it is not a blink']),
          P(['Palpebra abbassata più a lungo di così: è sguardo in basso, non chiusura',
             'Lid held lower than this: it is looking down, not a closure']), 150, 2000, 50, ' ms'),
        this._range('signal.maxLatchMs',
          P(['Tempo massimo di aggancio', 'Maximum gesture latch time']),
          P(['Se un gesto resta attivo oltre questo tempo viene sciolto d\'ufficio, senza emettere nulla. Protegge dal caso in cui l\'occhio non torna del tutto al riposo: il segnale resterebbe sopra la soglia di rilascio per sempre e nessun gesto successivo verrebbe più riconosciuto. 0 = nessun limite.',
             'If a gesture stays active beyond this it is released automatically, emitting nothing. Protects against the case where the eye does not fully return to rest: the signal would stay above the release threshold forever and no further gesture would be recognised. 0 = no limit.']),
          0, 30000, 500, ' ms'),
        this._select('signal.eyeFusion',
          P(['Combinazione occhi', 'Eye combination']),
          P(['Applicata agli eventi, non al segnale: ogni occhio ha soglia propria',
             'Applied to events, not the signal: each eye has its own threshold']), {
          any:   P(['Uno qualsiasi (consigliato)', 'Either eye (recommended)']),
          best:  P(['Solo il migliore', 'Best eye only']),
          both:  P(['Entrambi insieme', 'Both together']),
          left:  P(['Solo sinistro', 'Left only']),
          right: P(['Solo destro', 'Right only']),
        }),
        this._range('signal.dualWindowMs',
          P(['Finestra "entrambi"', 'Both-eyes window']),
          P(['Quanto possono distanziarsi i due occhi', 'How far apart the two eyes may be']),
          100, 1500, 50, ' ms'),
      ]);
  }

  _gesturesCard(cfg) {
    const rows = [];
    for (const key of Object.keys(GESTURE_META)) {
      const g = cfg.gestures[key];
      if (!g) continue;
      const m = GESTURE_META[key];
      const row = h('div', 'gesture-row' + (g.enabled ? '' : ' is-off'));

      const sw = h('label', 'switch');
      const inp = h('input'); inp.type = 'checkbox'; inp.checked = g.enabled;
      inp.onchange = () => { this.app.set(`gestures.${key}.enabled`, inp.checked); this.render(); };
      sw.append(inp, h('span'));

      const name = h('div', 'gname');
      name.append(document.createTextNode(P(m.name)));
      if (m.hint) name.append(h('small', null, P(m.hint)));

      const ctrl = h('div', 'gctrl');

      const act = h('select');
      for (const [v, label] of Object.entries(ACTION_LABELS)) {
        const o = h('option', null, P(label)); o.value = v;
        if (g.action === v) o.selected = true;
        act.append(o);
      }
      act.disabled = !g.enabled;
      act.onchange = () => this.app.set(`gestures.${key}.action`, act.value);

      const dur = h('div', 'dur');
      const mk = (field, val) => {
        const i = h('input'); i.type = 'number'; i.min = 40; i.max = 99000; i.step = 20;
        i.value = val; i.disabled = !g.enabled;
        i.onchange = () => this.app.set(`gestures.${key}.${field}`, +i.value);
        return i;
      };
      dur.append(mk('dwellMs', g.dwellMs), document.createTextNode('–'),
                 mk('maxMs', g.maxMs), document.createTextNode('ms'));

      ctrl.append(act, dur);
      row.append(sw, name, ctrl);
      rows.push(row);
    }

    rows.push(this._number('gestures.refractoryMs',
      P(['Periodo refrattario', 'Refractory period']),
      P(['Silenzio dopo un gesto: impedisce raffiche accidentali',
         'Silence after a gesture: prevents accidental bursts']), 0, 4000, 50));

    return this._card(t('sec.gestures'),
      P(['Un canale spento non viene calcolato, non solo ignorato: non può generare falsi positivi. Per chi ha spasmi palpebrali involontari, tenere spento l\'ammiccamento non è un\'omissione, è una protezione. Stesso movimento con durate diverse produce azioni diverse: attiva l\'interruttore per rendere modificabili azione e durate.',
         'A disabled channel is not computed at all, not merely ignored: it cannot produce false positives. For someone with involuntary eyelid spasms, leaving blink off is protection, not an omission. The same movement held for different durations triggers different actions. Flip the switch to make action and durations editable.']),
      rows);
  }

  /** Campo di testo semplice legato a un percorso di configurazione. */
  _text(percorso, etichetta, nota) {
    const inp = h('input', 'input largo');
    inp.type = 'text';
    inp.value = this.app.get(percorso) ?? '';
    if (nota && !/\s/.test(String(nota))) inp.placeholder = nota;
    inp.onchange = () => this.app.set(percorso, inp.value.trim());
    return field(etichetta, (nota && /\s/.test(String(nota))) ? nota : null, inp);
  }

  /** Elenco modificabile di voci con due campi. */
  _elencoDue(percorso, voci, campi, etichettaAggiungi) {
    const box = h('div', 'pgroup');
    (voci || []).forEach((v, i) => {
      const riga = h('div', 'lista-riga');
      for (const [chiave, segna, largo] of campi) {
        const inp = h('input', 'input' + (largo ? ' largo' : ''));
        inp.value = v?.[chiave] ?? '';
        inp.placeholder = segna;
        inp.onchange = () => {
          const nuovi = deepClone(voci);
          nuovi[i] = { ...nuovi[i], [chiave]: inp.value.trim() };
          this.app.set(percorso, nuovi);
          this.render();
        };
        riga.append(inp);
      }
      const via = h('button', 'btn btn-sm btn-danger', '×');
      via.title = P(['Rimuovi', 'Remove']);
      via.onclick = () => {
        const nuovi = deepClone(voci); nuovi.splice(i, 1);
        this.app.set(percorso, nuovi); this.render();
      };
      riga.append(via);
      box.append(riga);
    });
    const piu = h('button', 'btn btn-sm', etichettaAggiungi);
    piu.onclick = () => {
      const nuovi = deepClone(voci || []);
      nuovi.push(Object.fromEntries(campi.map(c => [c[0], ''])));
      this.app.set(percorso, nuovi); this.render();
    };
    box.append(piu);
    return box;
  }

  _mouseCard(cfg) {
    const righe = [];
    righe.push(h('p', 'note', P(
      ['Per chi controlla il cursore con gli occhi e vuole navigare in internet o nel sistema operativo, non solo dentro Aurora. ⚠️ Non riguarda la scansione uditiva: chi usa Aurora con la voce guida non ha bisogno di nulla di tutto questo.',
       'For those who control the cursor with their eyes and want to browse the internet or the operating system, not only inside Aurora. ⚠️ It does not concern auditory scanning.'])));

    righe.push(this._toggle('device.mouse.enabled',
      P(['Comanda il mouse del sistema', 'Control the system mouse']),
      P(['⚠️ Una pagina web NON può muovere il cursore da sola: serve un dispositivo che al computer si presenti come un mouse. Va bene un ESP32 configurato come mouse USB, oppure un piccolo programma sul computer che riceve i comandi ed emula il mouse. Bastano cinque comandi: sposta, clic, doppio clic, tieni premuto, rotellina.',
         '⚠️ A web page CANNOT move the cursor by itself: a device that presents itself to the computer as a mouse is required. An ESP32 configured as a USB mouse works, or a small program on the computer that receives the commands.'])));

    if (cfg.device.mouse.enabled) {
      righe.push(this._range('device.mouse.sensitivity',
        P(['Sensibilità', 'Sensitivity']),
        P(['Quanto si sposta il cursore per un dato movimento oculare. Troppo alta rende difficile fermarsi su un bersaglio piccolo.',
           'How far the cursor moves for a given eye movement. Too high makes small targets hard to hit.']),
        100, 3000, 50),
        );
      righe.push(this._range('device.mouse.maxStep',
        P(['Passo massimo', 'Maximum step']),
        P(['Tetto per singolo comando: uno scatto del puntatore non deve mandare il cursore dall\'altra parte dello schermo.',
           'Cap per command: a pointer jump must not throw the cursor across the screen.']),
        10, 200, 5));
      righe.push(this._range('device.mouse.scrollStep',
        P(['Passo della rotellina', 'Wheel step']), null, 1, 10, 1));
      righe.push(this._toggle('device.mouse.invertX', P(['Inverti orizzontale', 'Invert horizontal']), null));
      righe.push(this._toggle('device.mouse.invertY', P(['Inverti verticale', 'Invert vertical']), null));
      righe.push(this._toggle('device.mouse.invertScroll', P(['Inverti rotellina', 'Invert wheel']), null));

      /* ── Programmi da scaricare ──
       * Stanno sul sito di Aurora, così l'assistente li prende da qui
       * senza dover cercare altrove. Il collegamento porta al file, e
       * il browser lo scarica. */
      righe.push(h('div', 'vb-testa', P(['PROGRAMMA DA SCARICARE', 'PROGRAM TO DOWNLOAD'])));
      righe.push(h('p', 'sub', P(
        ['Serve UNO SOLO di questi, sul computer di chi usa Aurora. Su Windows il primo non richiede di installare nulla: si scarica la cartella, doppio clic sul file .bat, e si lascia aperta la finestrella che compare.',
         'Only ONE of these is needed, on the computer of whoever uses Aurora. On Windows the first requires no installation.'])));

      const scarica = h('div', 'profile-actions');
      for (const [file, etichetta, nota] of [
        ['strumenti/avvia-mouse.bat', 'Windows — avvia-mouse.bat',
         P(['Doppio clic, niente da installare', 'Double click, nothing to install'])],
        ['strumenti/aurora-mouse.ps1', 'Windows — aurora-mouse.ps1',
         P(['Il programma vero: va nella stessa cartella del .bat', 'The actual program: same folder as the .bat'])],
        ['strumenti/aurora-mouse.py', 'macOS e Linux — aurora-mouse.py',
         P(['Richiede Python', 'Requires Python'])],
        ['strumenti/aurora-esp32.ino', 'Scheda ESP32 — mouse e braccio',
         P(['Per chi vuole anche il braccio robotico', 'For those who also want the robotic arm'])],
        ['strumenti/LEGGIMI.md', 'Istruzioni complete', ''],
      ]) {
        const a = h('a', 'btn btn-sm');
        a.href = file;
        a.download = file.split('/').pop();
        a.textContent = etichetta;
        if (nota) a.title = nota;
        scarica.append(a);
      }
      righe.push(scarica);

      righe.push(h('p', 'note', P(
        ['⚠️ Il browser NON può avviare quel programma da solo: nessuna pagina web può eseguire nulla sul computer, ed è la regola che protegge chiunque navighi. Per non doverlo avviare a mano ogni volta, mettine una scorciatoia nella cartella Esecuzione automatica di Windows (tasto Windows+R, scrivi shell:startup, invio): da quel momento parte da solo all\'accensione.',
         '⚠️ The browser CANNOT start that program by itself: no web page can execute anything on the computer. To avoid starting it manually, put a shortcut in the Windows Startup folder (Windows+R, type shell:startup): from then on it starts automatically at boot.'])));

      // Stato del ponte: si vede subito se il programma è in ascolto
      const statoPonte = h('div', 'profile-actions');
      const bVerifica = h('button', 'btn btn-sm btn-primary',
        P(['Verifica se il programma è avviato', 'Check whether the program is running']));
      const esitoPonte = h('span', 'dt-stato', '');
      bVerifica.onclick = async () => {
        esitoPonte.textContent = P(['verifica in corso…', 'checking…']);
        esitoPonte.classList.remove('on');
        const r = await this.app.verificaPonte();
        esitoPonte.textContent = (r.ok ? '✓ ' : '⚠️ ') + r.messaggio;
        esitoPonte.classList.toggle('on', r.ok);
      };
      statoPonte.append(bVerifica, esitoPonte);
      righe.push(statoPonte);

      righe.push(h('div', 'vb-testa', P(['PROTOCOLLO', 'PROTOCOL'])));
      const pre = h('pre', 'codice');
      pre.textContent = [
        'M <dx> <dy>    sposta il cursore, passi interi',
        'C <n>          clic: 1 sinistro, 2 destro, 3 centrale',
        'K <n>          doppio clic',
        'T <n> <0|1>    tiene premuto (1) o rilascia (0)',
        'W <n>          rotellina, positivo verso l\'alto',
      ].join('\n');
      righe.push(pre);
      righe.push(h('p', 'sub', P(
        ['Testo semplice, una riga per comando. Si può collaudare il dispositivo da un terminale seriale prima di collegarlo qui.',
         'Plain text, one line per command. The device can be tested from a serial terminal before connecting it here.'])));
    }

    // ── Finestra sempre in primo piano ──
    righe.push(h('div', 'vb-testa', P(['FINESTRA SEMPRE IN PRIMO PIANO', 'ALWAYS-ON-TOP WINDOW'])));
    righe.push(h('p', 'sub', P(
      ['⚠️ Quando la finestra del browser va in secondo piano, il riconoscimento oculare si FERMA: è una regola del browser, non un difetto. Chi apre un\'altra applicazione perderebbe il controllo senza modo di tornare indietro.',
       '⚠️ When the browser window goes to the background, eye tracking STOPS: this is a browser rule, not a defect.'])));
    righe.push(h('p', 'sub', P(
      ['Il pannello compatto risolve il problema: è una finestrella che sta sopra le altre applicazioni, resta visibile e quindi non viene fermata. Dentro ci sono la voce corrente, lo stato e i comandi del mouse. Solo Chrome ed Edge da computer.',
       'The compact panel solves it: a small window that stays above other applications, remains visible and is therefore not throttled. Chrome and Edge on desktop only.'])));
    const az = h('div', 'profile-actions');
    const bf = h('button', 'btn btn-sm btn-primary');
    bf.id = 'btnFloatWindow';
    bf.textContent = P(['Apri il pannello in primo piano', 'Open the panel on top']);
    az.append(bf);
    righe.push(az);

    // Si dice SUBITO se il browser la offre: premere un pulsante che
    // non può funzionare e non capire perché è la peggiore delle
    // esperienze.
    const disponibile = typeof globalThis !== 'undefined' && 'documentPictureInPicture' in globalThis;
    righe.push(h('p', disponibile ? 'sub' : 'note', disponibile
      ? P(['✓ Il tuo browser offre questa funzione.', '✓ Your browser supports this feature.'])
      : P(['⚠️ Il tuo browser NON offre le finestre sempre in primo piano, quindi il pulsante qui sopra non può funzionare. Servono Chrome o Edge da computer in versione recente: su Firefox, Safari e sui telefoni la funzione non esiste. Il resto del programma funziona comunque.',
           '⚠️ Your browser does NOT support always-on-top windows, so the button above cannot work. Chrome or Edge on desktop are required.'])));

    righe.push(this._range('ui.miniLarghezza',
      P(['Larghezza del pannello ridotto', 'Compact panel width']),
      P(['Quanto spazio occupa la finestrella sempre in primo piano. Piccola di proposito: un riquadro che copre un angolo di schermo è un riquadro che dà fastidio, e che si finisce per chiudere.',
         'How much space the always-on-top window takes. Deliberately small.']),
      180, 500, 10, ' px'));
    righe.push(this._range('ui.miniAltezza',
      P(['Altezza del pannello ridotto', 'Compact panel height']), null, 100, 320, 10, ' px'));

    righe.push(this._toggle('source.backgroundMode',
      P(['Continua anche a finestra nascosta', 'Keep running when the window is hidden']),
      P(['Fa scandire i fotogrammi dalla TELECAMERA invece che dal disegno dello schermo, così l\'elaborazione continua anche riducendo a icona. Se il browser non lo sostiene si torna da solo al funzionamento di sempre, senza conseguenze. Sperimentale: consuma più batteria.',
         'Frames are driven by the CAMERA rather than by screen painting, so processing continues even when minimised. If the browser does not support it, the usual behaviour resumes automatically. Experimental: uses more battery.'])));

    return this._card(t('sec.mouse'), null, righe);
  }

  _debugCard(cfg) {
    const righe = [];
    righe.push(this._toggle('debug.console',
      P(['Registro dettagliato nella console', 'Detailed log in the console']),
      P(['Scrive una riga ogni due secondi nella console del browser (si apre con F12, scheda Console) con rumore stimato, baseline, ampiezza, campioni validi, stato del video e conteggio dei blocchi. ⚠️ Serve a capire cosa succede DAVVERO quando qualcosa non torna: descrivere a parole "l\'ampiezza cala" non basta a sapere dove intervenire. Tienilo spento nell\'uso normale.',
         'Writes a line every two seconds to the browser console (F12) with estimated noise, baseline, amplitude, valid samples, video state and stall counts. Keep it off in normal use.'])));
    if (cfg.debug.console) {
      righe.push(h('p', 'sub', P(
        ['Apri la console con F12, lascia girare il video o la telecamera un paio di minuti, poi copia qualche riga: da lì si capisce se il rumore stimato cresce, se la baseline si sposta, se i campioni di un occhio vengono scartati, o se il video si ferma.',
         'Open the console with F12, let the video or camera run for a couple of minutes, then copy a few lines.'])));
      righe.push(this._range('debug.ogniMs',
        P(['Ogni quanto scrivere', 'How often to write']), null, 500, 10000, 500, ' ms'));
    }

    righe.push(h('div', 'vb-testa', P(['CORREZIONE DELL\'IRIDE COPERTA', 'OCCLUDED IRIS CORRECTION'])));
    righe.push(this._toggle('detection.irisOcclusionFix',
      P(['Compensa quando la palpebra copre l\'iride', 'Compensate when the eyelid covers the iris']),
      P(['⚠️ SPERIMENTALE, spenta di default. Chi alza molto lo sguardo porta la pupilla sotto la palpebra: il centro stimato scivola in basso e il movimento risulta più piccolo di quanto sia. Guarda in Diagnostica il contatore "Palpebra copre iride": a occhio rilassato dovrebbe stare vicino a zero, e salire nettamente quando lo sguardo va in alto. Se non sale, non c\'è nulla da compensare e questa funzione va lasciata spenta.',
         '⚠️ EXPERIMENTAL, off by default. Check the "Palpebra copre iride" counter in Diagnostics before enabling.'])));
    if (cfg.detection.irisOcclusionFix) {
      righe.push(this._range('detection.irisOcclusionSoglia',
        P(['Copertura oltre cui compensare', 'Coverage above which to compensate']),
        P(['Un po\' di palpebra sopra l\'iride c\'è sempre, anche a occhio rilassato: compensare quella sposterebbe il segno di continuo. Metti questa soglia POCO SOPRA il valore che leggi a occhio rilassato nel contatore "Palpebra copre iride".',
           'Some eyelid over the iris is always present. Set this slightly above the value read at rest.']),
        0.02, 0.60, 0.01));
      righe.push(this._range('detection.irisOcclusionForza',
        P(['Quanto compensare', 'How much to compensate']),
        P(['Frazione della copertura eccedente che viene compensata. Alzala finché il segno rosso segue il centro della pupilla anche a sguardo molto alzato, senza superarlo. Se lo supera o vibra, abbassala.',
           'Fraction of the excess coverage that is compensated. Raise until the red mark follows the pupil centre without overshooting.']),
        0, 1.5, 0.05));
      righe.push(this._range('detection.irisOcclusionMax',
        P(['Compensazione massima', 'Maximum compensation']),
        P(['Tetto di sicurezza, in frazione del raggio dell\'iride: un rilevamento sbagliato non deve poter far volare il segno lontano dall\'occhio.',
           'Safety cap, as a fraction of the iris radius.']),
        0.1, 1.2, 0.05));
    }

    return this._card(t('sec.debug'), null, righe);
  }

  _offlineCard(cfg) {
    const righe = [];
    righe.push(h('p', 'note', P(
      ['Aurora funziona SENZA internet. Libreria di riconoscimento, codice di calcolo e carattere di lettura sono inclusi nel programma: nessun server esterno può renderli indisponibili.',
       'Aurora works WITHOUT internet. The recognition library, the computation code and the reading typeface are bundled with the program: no external server can make them unavailable.'])));
    righe.push(h('p', 'sub', P(
      ['Serve la rete SOLO la prima volta, per scaricare il modello di riconoscimento del volto (alcuni megabyte, non ridistribuibile insieme al programma). Da quel momento resta nella memoria del browser e tutto funziona anche senza connessione.',
       'Network is needed ONLY the first time, to download the face recognition model (a few megabytes, not redistributable with the program). From then on it stays in the browser and everything works offline.'])));

    const azioni = h('div', 'profile-actions');
    const b = h('button', 'btn btn-sm btn-primary');
    b.id = 'btnOffline';
    b.textContent = P(['Prepara per l\'uso senza internet', 'Prepare for offline use']);
    azioni.append(b);
    righe.push(azioni);

    righe.push(h('p', 'sub', P(
      ['Premilo ora, mentre c\'è connessione: scarica subito tutto il necessario invece di aspettare che si scarichi al primo utilizzo. Da fare una volta sola, e da rifare dopo un aggiornamento del programma.',
       'Press it now, while online: it downloads everything needed straight away instead of waiting for first use. Do it once, and again after a program update.'])));

    righe.push(h('div', 'vb-testa', P(['COSA RICHIEDE INTERNET', 'WHAT NEEDS INTERNET'])));
    const elenco = h('ul', 'gate-list');
    for (const [it2, en2] of [
      ['Traduzione nella scheda Detta', 'Translation in the Dictate tab'],
      ['Riconoscimento vocale (il browser lo elabora sui propri server)', 'Speech recognition (processed on browser vendor servers)'],
      ['Video di YouTube', 'YouTube videos'],
      ['Radio online', 'Online radio'],
      ['Invio di messaggi di posta', 'Sending email'],
      ['Dispositivi di casa, se Home Assistant è su un\'altra rete', 'Home devices, if Home Assistant is on another network'],
    ]) elenco.append(h('li', null, P([it2, en2])));
    righe.push(elenco);
    righe.push(h('p', 'sub', P(
      ['⚠️ Tutto il resto — scansione, scrittura, frasi, testi salvati, autocorrezione, voce, puntatore, canali del viso, diagnostica e statistiche — funziona senza connessione.',
       '⚠️ Everything else — scanning, writing, phrases, saved texts, autocorrection, voice, pointer, face channels, diagnostics and statistics — works without a connection.'])));

    return this._card(t('sec.offline'), null, righe);
  }

  _radioCard(cfg) {
    const righe = [];
    righe.push(this._toggle('radio.enabled',
      P(['Radio online', 'Online radio']),
      P(['Aggiunge la voce RADIO nella scansione dei media. Una radio è un flusso audio come un altro: non serve nulla oltre all\'indirizzo. Spenta, la voce non compare da nessuna parte.',
         'Adds a RADIO item to media scanning. A radio is just an audio stream: nothing beyond its address is needed. Off, the item appears nowhere.'])));
    if (cfg.radio.enabled) {
      righe.push(h('p', 'sub', P(
        ['Incolla l\'indirizzo del flusso, non quello della pagina web della radio. Di solito finisce in .mp3, .aac o /stream. Mentre la radio suona, la voce di guida si abbassa da sola e torna al volume pieno quando ha finito di parlare.',
         'Paste the stream address, not the radio\'s web page. It usually ends in .mp3, .aac or /stream. While the radio plays, the guidance voice ducks by itself and returns to full volume afterwards.'])));
      righe.push(this._elencoDue('radio.stazioni', cfg.radio.stazioni,
        [['nome', P(['Nome', 'Name']), false], ['url', 'https://…', true]],
        P(['+ Aggiungi stazione', '+ Add station'])));
    }
    return this._card(t('sec.radio'), null, righe);
  }

  _telegramCard(cfg) {
    const righe = [];
    righe.push(h('p', 'note', P(
      ['Manda messaggi a persone o canali di Telegram. ⚠️ Telegram e non WhatsApp: WhatsApp non permette di inviare messaggi da una pagina web se non attraverso un\'interfaccia commerciale a pagamento; Telegram mette a disposizione un\'interfaccia gratuita e diretta.',
       'Sends messages to Telegram people or channels. WhatsApp does not allow sending from a web page except through a paid commercial interface.'])));
    righe.push(this._toggle('telegram.enabled',
      P(['Attiva Telegram', 'Enable Telegram']),
      P(['Acceso, compare la voce TELEGRAM fra le azioni dei testi salvati, e il pulsante Telegram nella tastiera a puntamento.',
         'When on, a TELEGRAM item appears among the saved-text actions.'])));

    if (cfg.telegram?.enabled) {
      righe.push(h('pre', 'code-box', ISTRUZIONI_TG));
      righe.push(this._text('telegram.token',
        P(['Gettone del robot', 'Bot token']), '123456:ABC-DEF...'));
      const bp = h('button', 'btn btn-sm', P(['Prova il gettone', 'Test the token']));
      bp.onclick = async () => {
        const { prova } = await import('../lang/Telegram.js');
        const r = await prova(this.app.cfg);
        this.app.toast(r.ok ? `Robot "${r.nome}" raggiunto` : `Non riuscito: ${r.errore}`, !r.ok);
      };
      const az = h('div', 'profile-actions'); az.append(bp);
      righe.push(az);

      righe.push(h('div', 'vb-testa', P(['DESTINATARI', 'RECIPIENTS'])));
      righe.push(h('p', 'sub', P(
        ['⚠️ Ogni persona deve aver scritto almeno una volta al robot, altrimenti Telegram rifiuta il messaggio: un robot non può scrivere per primo a nessuno. Per un canale, aggiungi il robot come amministratore e usa @nomecanale.',
         '⚠️ Each person must have written to the bot at least once, otherwise Telegram refuses the message.'])));
      righe.push(this._listaContatti('telegram.contatti', 'chatId',
        P(['identificativo o @canale', 'chat id or @channel'])));

      righe.push(this._toggle('telegram.conferma',
        P(['Chiedi conferma prima di mandare', 'Ask before sending']),
        P(['Un messaggio parte una volta sola e non torna indietro.',
           'A message is sent once and cannot be recalled.'])));
      righe.push(this._toggle('telegram.silenzioso',
        P(['Manda senza suono di notifica', 'Send silently']), null));
      righe.push(this._text('telegram.firma',
        P(['Firma in fondo al messaggio', 'Signature']), 'es. Daniela'));
    }

    return this._card(t('sec.telegram'), null, righe);
  }

  /**
   * Elenco di destinatari, con nome e campo di recapito.
   *
   * ⚠️ Uno solo per posta e Telegram: due elenchi separati col tempo
   * divergono, e chi assiste si troverebbe due modi diversi di fare la
   * stessa cosa.
   */
  _listaContatti(via, campo, segnaposto) {
    const box = h('div');
    const lista = (this.app.get(via) || []).slice();
    lista.forEach((c, i) => {
      const riga = h('div', 'row');
      const n = h('input'); n.type = 'text'; n.value = c?.nome || '';
      n.placeholder = 'nome';
      n.oninput = () => { lista[i] = { ...lista[i], nome: n.value }; this.app.set(via, lista); };
      const d = h('input'); d.type = 'text'; d.value = c?.[campo] || '';
      d.placeholder = segnaposto;
      d.oninput = () => { lista[i] = { ...lista[i], [campo]: d.value.trim() }; this.app.set(via, lista); };
      const x = h('button', 'btn btn-sm btn-danger', '✕');
      x.onclick = () => { lista.splice(i, 1); this.app.set(via, lista); this.render(); };
      riga.append(n, d, x);
      box.append(riga);
    });
    const add = h('button', 'btn btn-sm', P(['Aggiungi destinatario', 'Add recipient']));
    add.onclick = () => { this.app.set(via, [...lista, { nome: '', [campo]: '' }]); this.render(); };
    const az = h('div', 'profile-actions'); az.append(add);
    box.append(az);
    return box;
  }

  _assistenteCard(cfg) {
    const righe = [];
    // Elenco dei servizi, letto dal modulo che li conosce davvero.
    if (!this._provAI) {
      import('../lang/Assistant.js').then((m) => {
        this._provAI = m;
        if (document.body.dataset.tab === 'impostazioni') this.render();
      }).catch(() => {});
    }
    righe.push(h('p', 'note', P(
      ['Per chi comunica con un solo movimento, è la differenza fra poter DIRE e poter anche CHIEDERE. Il testo composto diventa una domanda, e la risposta viene letta ad alta voce.',
       'For someone who communicates with a single movement, this is the difference between being able to SAY and being able to ASK.'])));
    righe.push(this._toggle('assistente.enabled',
      P(['Attiva l\'assistente', 'Enable the assistant']),
      P(['Acceso, compare la voce CHIEDI fra le azioni della scrittura, dopo RILEGGI. ⚠️ Il testo NON viene svuotato dopo la domanda: se la risposta non arriva, chi ha impiegato minuti a scrivere non deve ricominciare.',
         'When on, a CHIEDI item appears among the writing actions.'])));

    if (cfg.assistente?.enabled) {
      const P_AI = {
        openrouter: 'OpenRouter (ha modelli gratuiti)',
        deepseek: 'DeepSeek (molto economico)',
        google: 'Google Gemini',
        openai: 'OpenAI',
        anthropic: 'Anthropic Claude',
        personale: 'Altro servizio',
      };
      righe.push(this._select('assistente.provider',
        P(['Servizio', 'Service']),
        P(['OpenRouter e DeepSeek sono i più economici; il primo ha modelli gratuiti.',
           'OpenRouter and DeepSeek are the cheapest; the first has free models.']),
        P_AI));

      if (cfg.assistente.provider === 'personale') {
        righe.push(this._text('assistente.url',
          P(['Indirizzo del servizio', 'Service address']),
          'https://.../v1/chat/completions'));
      }
      const { PROVIDER_AI } = this._provAI || {};
      const mod = PROVIDER_AI?.[cfg.assistente.provider]?.modelli || [];
      righe.push(this._text('assistente.modello',
        P(['Modello', 'Model']),
        mod.length ? mod[0] : 'lasciando vuoto usa il primo disponibile'));
      if (mod.length) {
        righe.push(h('p', 'sub', P(
          [`Disponibili: ${mod.join(' · ')}`, `Available: ${mod.join(' · ')}`])));
      }
      if (cfg.assistente.provider === 'openrouter') {
        righe.push(h('p', 'note', P(
          ['💡 Lasciando il campo vuoto si usa openrouter/free, che sceglie da solo un modello fra quelli gratuiti disponibili e non costa nulla — né il router né le richieste che instrada. Evita anche di dover inseguire quale sia il modello gratuito del mese, che cambia di continuo. ⚠️ openrouter/auto invece sceglie fra TUTTI i modelli, anche a pagamento.',
             '💡 Leaving the field empty uses openrouter/free, which picks a free model by itself at no cost. ⚠️ openrouter/auto instead picks among ALL models, including paid ones.'])));
      }

      /* ⚠️ Una chiave PER SERVIZIO, tutte visibili insieme.
       *
       * Con una chiave sola, cambiare fornitore per provarne un altro
       * significava cancellare la precedente e riscriverla per tornare
       * indietro. Così chi installa ne tiene diverse e passa dall'una
       * all'altra scegliendo il fornitore, senza riscrivere nulla. */
      righe.push(h('div', 'vb-testa', P(['CHIAVI DI ACCESSO', 'ACCESS KEYS'])));
      for (const [id, nome] of Object.entries(P_AI)) {
        const attivo = cfg.assistente.provider === id;
        righe.push(this._text(`assistente.chiavi.${id}`,
          nome + (attivo ? '  ← in uso' : ''), 'sk-...'));
      }
      righe.push(h('p', 'sub', P(
        ['🔒 Le chiavi restano su questo computer, come tutte le altre impostazioni, e ciascuna viene inviata solo al proprio servizio. Un servizio senza chiave non può essere usato: scegliendolo, l\'assistente lo dirà invece di provare a contattarlo.',
         '🔒 Keys stay on this computer and each is sent only to its own service.'])));

      righe.push(this._range('assistente.maxParole',
        P(['Lunghezza massima della risposta', 'Maximum answer length']),
        P(['⚠️ Questo numero viene CHIESTO all\'assistente a ogni domanda — "rispondi usando al massimo N parole" — non applicato tagliando la risposta. La differenza è sostanziale: tagliando si ottengono frasi interrotte a metà, chiedendo si ottiene una risposta compiuta e della lunghezza voluta. La risposta viene ASCOLTATA, non letta: un paragrafo che a schermo si scorre in un istante, ad alta voce dura un minuto.',
           '⚠️ This number is ASKED of the assistant on every question, not applied by truncating.']),
        20, 2000, 10, ' parole'));
      righe.push(this._toggle('assistente.ricercaWeb',
        P(['Cerca sul web', 'Search the web']),
        P(['⚠️ Indispensabile per i video. Senza, l\'assistente non cerca su YouTube ma RICORDA indirizzi visti durante l\'addestramento: molti sono vecchi, alcuni rimossi, e qualcuno inventato con la stessa sicurezza di uno vero — chi chiede un video si troverebbe una pagina che non esiste. Con la ricerca attiva, scrivendo "documentario africa v" alla fine del testo si ottiene il video più pertinente, che si apre da solo. Su OpenRouter e Gemini funziona; con gli altri servizi la richiesta viene fatta lo stesso ma senza ricerca.',
           '⚠️ Required for videos. Without it the assistant recalls addresses instead of searching, and many no longer exist.'])),
        );
      righe.push(this._toggle('assistente.frasiSeparate',
        P(['Leggi una frase per volta', 'Read one sentence at a time']),
        P(['Rende l\'ascolto interrompibile: una risposta lunga letta tutta d\'un fiato, senza poter dire "basta", è una trappola per chi non può parlare.',
           'Makes listening interruptible.'])));
      righe.push(this._range('assistente.attesaSec',
        P(['Quanto attendere una risposta', 'How long to wait']),
        P(['Scaduto questo tempo il programma dice che il servizio non ha risposto, invece di lasciare in attesa senza sapere.',
           'After this the program says the service did not answer.']),
        5, 90, 5, ' s'));
      righe.push(this._text('assistente.istruzione',
        P(['Istruzione all\'assistente', 'Instruction to the assistant']),
        'vuoto = chiede risposte brevi e dirette'));
      righe.push(h('p', 'sub', P(
        ['⚠️ Scrivendo qui un\'istruzione propria, il limite di parole qui sopra NON viene più aggiunto automaticamente: va incluso nel testo.',
         '⚠️ With a custom instruction the word limit above is no longer added automatically.'])));
    }

    return this._card(t('sec.assistente'), null, righe);
  }

  _emailCard(cfg) {
    const righe = [];
    righe.push(this._toggle('email.enabled',
      P(['Invio di messaggi di posta', 'Sending email messages']),
      P(['Permette di spedire un testo salvato a un destinatario scelto da un elenco. Spento, non compare nulla.',
         'Allows sending a saved text to a recipient chosen from a list. Off, nothing appears.'])));

    if (cfg.email.enabled) {
      // ⚠️ La spiegazione sta QUI, sotto gli occhi di chi compila il
      // campo — non in una pagina da cercare altrove.
      const spiega = h('details', 'dt-trad');
      const som = h('summary', null, P(['⚠️ Come si configura (leggere prima)', '⚠️ How to set it up (read first)']));
      spiega.append(som);
      const testo = h('div');
      testo.innerHTML = P([
        `<p class="note">Un browser <b>non può spedire posta da solo</b>: non è un limite di Aurora ma una regola di sicurezza del web, e non cambierà. Serve un piccolo servizio esterno che riceva il messaggio e lo spedisca.</p>
         <p class="sub">La strada più semplice, se il programma è già su Netlify: crea il file <code>netlify/functions/invia-email.js</code> con il codice qui sotto, imposta le variabili d'ambiente <code>MAIL_USER</code> e <code>MAIL_PASS</code> nelle impostazioni del sito, e scrivi qui l'indirizzo <code>https://iltuosito.netlify.app/.netlify/functions/invia-email</code>.</p>
         <p class="note">🔒 Con Gmail serve una <b>password per le applicazioni</b>, MAI quella principale. Le credenziali restano sul servizio: qui non vengono mai salvate, perché sarebbero leggibili da chiunque apra gli strumenti di sviluppo del browser.</p>`,
        `<p class="note">A browser <b>cannot send email by itself</b>: this is a web security rule, not an Aurora limitation, and it will not change. A small external service is needed to receive the message and send it.</p>
         <p class="sub">The simplest route, if the program is already on Netlify: create <code>netlify/functions/invia-email.js</code> with the code below, set the <code>MAIL_USER</code> and <code>MAIL_PASS</code> environment variables in the site settings, and write the address <code>https://yoursite.netlify.app/.netlify/functions/invia-email</code> here.</p>
         <p class="note">🔒 With Gmail you need an <b>app password</b>, NEVER the main one. Credentials stay on the service: they are never saved here, because they would be readable by anyone opening the browser developer tools.</p>`]);
      spiega.append(testo);
      const pre = h('pre', 'codice');
      pre.textContent = ESEMPIO_NETLIFY;
      spiega.append(pre);
      const copia = h('button', 'btn btn-sm', P(['Copia il codice', 'Copy the code']));
      copia.onclick = async () => {
        try { await navigator.clipboard.writeText(ESEMPIO_NETLIFY); this.app.toast('Codice copiato'); } catch {}
      };
      spiega.append(copia);
      righe.push(spiega);

      righe.push(this._text('email.endpoint',
        P(['Indirizzo del servizio di invio', 'Sending service address']),
        'https://…/.netlify/functions/invia-email'));
      righe.push(this._text('email.mittente',
        P(['Nome del mittente', 'Sender name']), P(['Come comparirà a chi riceve', 'As it will appear to the recipient'])));
      righe.push(this._text('email.oggetto',
        P(['Oggetto predefinito', 'Default subject']), null));
      righe.push(h('div', 'vb-testa', P(['CASELLA IN USCITA (facoltativa)', 'OUTGOING MAILBOX (optional)'])));
      righe.push(h('p', 'sub', P(
        ['Da compilare solo se Aurora non sta su Netlify, o se il servizio di invio deve servire più installazioni. Questi valori vengono trasmessi al servizio insieme al messaggio, così lo stesso servizio funziona con qualunque provider senza riconfigurarlo. Lasciandoli vuoti, il servizio usa la propria configurazione.',
         'Fill these only if Aurora is not on Netlify, or if one sending service must serve several installations. Leave empty to use the service own configuration.'])));
      righe.push(this._text('email.smtpHost',
        P(['Server di posta in uscita', 'Outgoing mail server']), 'smtp.gmail.com'));
      righe.push(this._range('email.smtpPort',
        P(['Porta', 'Port']),
        P(['587 con STARTTLS (la più comune), 465 con TLS diretto, 25 solo su reti interne.',
           '587 with STARTTLS (most common), 465 with direct TLS, 25 only on internal networks.']),
        25, 588, 1));
      righe.push(this._text('email.smtpUser',
        P(['Indirizzo della casella in uscita', 'Outgoing mailbox address']), 'nome@dominio.it'));
      righe.push(this._toggle('email.smtpSicuro',
        P(['Connessione cifrata diretta (porta 465)', 'Direct TLS (port 465)']),
        P(['Da accendere SOLO sulla porta 465. Sulla 587 la cifratura si negozia dopo il collegamento e questo interruttore va lasciato spento.',
           'Turn on ONLY for port 465. On 587 encryption is negotiated after connecting.'])));
      righe.push(h('p', 'note', P(
        ['🔒 LA PASSWORD NON SI METTE QUI, ed è una scelta di sicurezza, non una dimenticanza. Tutto ciò che si scrive in queste impostazioni resta nel browser, dove chiunque apra gli strumenti di sviluppo può leggerlo — e parliamo della casella personale di una persona malata. La password va messa fra le variabili d\'ambiente del servizio di invio, dove nessun browser la vede. Il codice di esempio qui sopra mostra come.',
         '🔒 THE PASSWORD DOES NOT GO HERE. Anything written in these settings stays in the browser, readable by anyone opening developer tools. Put it in the sending service environment variables.'])));

      righe.push(this._toggle('email.conferma',
        P(['Chiedi conferma prima di spedire', 'Ask for confirmation before sending']),
        P(['⚠️ Consigliato. Un messaggio parte una volta sola e non torna indietro: per chi seleziona con lo sguardo, un gesto involontario non deve poter spedire una lettera.',
           '⚠️ Recommended. A message is sent once and cannot be recalled: for someone selecting by gaze, an involuntary gesture must not be able to send a letter.'])));

      righe.push(h('div', 'vb-testa', P(['DESTINATARI', 'RECIPIENTS'])));
      righe.push(this._elencoDue('email.contatti', cfg.email.contatti,
        [['nome', P(['Nome', 'Name']), false], ['indirizzo', 'nome@esempio.it', true]],
        P(['+ Aggiungi destinatario', '+ Add recipient'])));

      // Esito della verifica: si vede subito se manca qualcosa, invece
      // di scoprirlo quando la persona ha finito di scrivere.
      const v = verificaConfigurazione(cfg);
      const stato = h('p', v.ok ? 'sub' : 'note');
      stato.textContent = v.ok
        ? P([`✓ Configurazione completa: ${v.contatti.length} destinatari.`,
             `✓ Configuration complete: ${v.contatti.length} recipients.`])
        : P([`⚠️ Manca ancora: ${v.problemi.join('; ')}`, `⚠️ Still missing: ${v.problemi.join('; ')}`]);
      righe.push(stato);
      const cattivi = (cfg.email.contatti || []).filter(c => c?.indirizzo && !indirizzoValido(c.indirizzo));
      if (cattivi.length) {
        righe.push(h('p', 'note', P(
          [`⚠️ Indirizzi non validi: ${cattivi.map(c => c.indirizzo).join(', ')}`,
           `⚠️ Invalid addresses: ${cattivi.map(c => c.indirizzo).join(', ')}`])));
      }
    }
    return this._card(t('sec.email'), null, righe);
  }

  _domoticaCard(cfg) {
    const righe = [];
    righe.push(this._toggle('domotica.enabled',
      P(['Dispositivi di casa (Home Assistant)', 'Home devices (Home Assistant)']),
      P(['Televisore, luci, tapparelle, prese. Accesa, compare la voce CASA nella scansione dei media. Accendere la televisione senza chiedere a nessuno è una cosa piccola che per chi non può muoversi vale molto.',
         'TV, lights, blinds, sockets. When on, a HOME item appears in media scanning. Turning on the TV without asking anyone is a small thing that means a lot to someone who cannot move.'])));

    if (cfg.domotica.enabled) {
      // Istruzioni sotto gli occhi di chi compila, non in un manuale.
      const guida = h('details', 'dt-trad');
      guida.append(h('summary', null, P(['📖 Come si configura Home Assistant', '📖 How to set up Home Assistant'])));
      for (const passo of ISTRUZIONI) {
        guida.append(h('div', 'vb-testa', passo.titolo));
        const par = h('p', 'sub');
        par.style.whiteSpace = 'pre-wrap';
        par.textContent = passo.testo;
        guida.append(par);
      }
      guida.append(h('p', 'note', P(
        ['🔒 Il gettone è una chiave di casa: chi lo ha può comandare tutto ciò che Home Assistant comanda. Creane uno dedicato ad Aurora, così puoi revocarlo da solo. E usalo solo sulla rete locale: un Home Assistant esposto su internet con un gettone dentro un browser è una cattiva idea.',
         '🔒 The token is a house key: whoever has it can control everything Home Assistant controls. Create one dedicated to Aurora so you can revoke it alone. And use it only on the local network.'])));
      righe.push(guida);

      righe.push(this._text('domotica.url',
        P(['Indirizzo di Home Assistant', 'Home Assistant address']),
        'http://homeassistant.local:8123'));
      righe.push(this._text('domotica.token',
        P(['Gettone di accesso', 'Access token']),
        P(['Token di accesso a lunga durata', 'Long-lived access token'])));

      const prova = h('button', 'btn btn-sm btn-primary', P(['Prova la connessione', 'Test the connection']));
      const esito = h('span', 'dt-stato', '');
      prova.onclick = async () => {
        esito.textContent = P(['prova in corso…', 'testing…']);
        const r = await provaConnessione(cfg);
        esito.textContent = (r.ok ? '✓ ' : '⚠️ ') + r.messaggio;
        esito.classList.toggle('on', r.ok);
      };
      const riga = h('div', 'profile-actions');
      riga.append(prova, esito);
      righe.push(riga);

      righe.push(h('div', 'vb-testa', P(['DISPOSITIVI', 'DEVICES'])));
      righe.push(h('p', 'sub', P(
        ['Il nome è quello che sentirà chi usa il programma. L\'identificativo si trova in Home Assistant: Strumenti per sviluppatori → Stati, e ha la forma dominio.nome. I comandi vengono dedotti dal tipo: un media_player avrà accensione, volume e canali; una light solo accendi e spegni.',
         'The name is what the user will hear. The identifier is found in Home Assistant: Developer tools → States, in the form domain.name. Commands are inferred from the type.'])));
      righe.push(this._elencoDue('domotica.dispositivi', cfg.domotica.dispositivi,
        [['nome', P(['Nome', 'Name']), false], ['entita', 'media_player.tv_salotto', true]],
        P(['+ Aggiungi dispositivo', '+ Add device'])));

      // Anteprima: si vede subito quali comandi avrà ciascun dispositivo
      for (const d of (cfg.domotica.dispositivi || [])) {
        if (!d?.nome || !entitaValida(d?.entita)) continue;
        const cmd = comandiDi(d);
        const p2 = h('p', 'sub', `${d.nome}: ${cmd.length ? cmd.map(c => c.nome).join(' · ') : P(['tipo non riconosciuto, nessun comando', 'unknown type, no commands'])}`);
        righe.push(p2);
      }
      const storti = (cfg.domotica.dispositivi || []).filter(d => d?.entita && !entitaValida(d.entita));
      if (storti.length) {
        righe.push(h('p', 'note', P(
          [`⚠️ Identificativi non validi: ${storti.map(d => d.entita).join(', ')} — devono avere la forma dominio.nome`,
           `⚠️ Invalid identifiers: ${storti.map(d => d.entita).join(', ')} — they must be in the form domain.name`])));
      }
      const v = verificaDomotica(cfg);
      righe.push(h('p', v.ok ? 'sub' : 'note', v.ok
        ? P([`✓ ${v.dispositivi.length} dispositivi pronti.`, `✓ ${v.dispositivi.length} devices ready.`])
        : P([`⚠️ Manca ancora: ${v.problemi.join('; ')}`, `⚠️ Still missing: ${v.problemi.join('; ')}`])));

      const tipi = Object.values(MODELLI).map(m => `${m.nome} (${m.dominio})`).join(' · ');
      righe.push(h('p', 'sub', P([`Tipi riconosciuti: ${tipi}`, `Recognised types: ${tipi}`])));
    }

    // ── Stampa: non passa da Home Assistant ──
    righe.push(h('div', 'vb-testa', P(['STAMPA', 'PRINTING'])));
    righe.push(this._toggle('stampa.enabled',
      P(['Stampa dei testi salvati', 'Printing of saved texts']),
      P(['Aggiunge la voce STAMPA accanto a MANDA nell\'archivio dei testi. ⚠️ Non passa da Home Assistant: il browser stampa già su qualunque stampante collegata al computer, senza intermediari e senza configurazione. Home Assistant serve semmai ad ACCENDERLA, ed è un dispositivo come gli altri.',
         'Adds a PRINT item next to SEND in the text archive. ⚠️ It does not go through Home Assistant: the browser already prints to any printer connected to the computer. Home Assistant is only useful to TURN IT ON, as any other device.'])));
    if (cfg.stampa.enabled) {
      righe.push(this._toggle('stampa.conferma',
        P(['Chiedi conferma prima di stampare', 'Ask for confirmation before printing']),
        P(['⚠️ Consigliato, come per la posta: un gesto involontario non deve poter far partire una stampa.',
           '⚠️ Recommended, as for email: an involuntary gesture must not be able to start a print job.'])));
    }

    return this._card(t('sec.domotica'), null, righe);
  }

  _channelCard(cfg) {
    const aSoglia = cfg.detection.mode === 'ir' || cfg.detection.mode === 'auto';
    const righe = [];

    if (!aSoglia) {
      righe.push(h('p', 'note', P(
        ['⚠️ Questa scheda non ha effetto nella modalità attuale. In luce visibile il rilevamento lo fa MediaPipe, una rete addestrata su immagini a colori normali: darle un canale solo la porterebbe fuori dalla distribuzione su cui è stata addestrata e peggiorerebbe i punti dell\'iride. La miscelazione serve al tracciamento A SOGLIA — modalità Infrarosso o Automatica.',
         '⚠️ This card has no effect in the current mode. In visible light detection is done by MediaPipe, a network trained on normal colour images: feeding it a single channel would take it out of its training distribution and worsen the iris points. Channel mixing is for THRESHOLD tracking — Infrared or Automatic mode.'])));
    }

    const sel = h('select');
    for (const [k, v] of Object.entries(CHANNEL_PRESETS)) {
      const o = h('option', null, v.label); o.value = k;
      if (cfg.detection.channelPreset === k) o.selected = true;
      sel.append(o);
    }
    const perso = h('option', null, P(['Personalizzata', 'Custom']));
    perso.value = 'custom';
    if (cfg.detection.channelPreset === 'custom') perso.selected = true;
    sel.append(perso);
    sel.onchange = () => {
      this.app.set('detection.channelPreset', sel.value);
      const pr = CHANNEL_PRESETS[sel.value];
      if (pr) this.app.set('detection.channelMix', { r: pr.r, g: pr.g, b: pr.b });
      this.render();
    };
    const nota = CHANNEL_PRESETS[cfg.detection.channelPreset]?.nota || '';
    righe.push(field(P(['Combinazione', 'Combination']), nota, sel));

    // Coefficienti liberi: servono per casi che nessuna combinazione
    // pronta copre, e per capire cosa fanno le combinazioni stesse.
    const riga = h('div', 'dir-row');
    const campo = (et, inp) => { const c = h('div', 'campo'); c.append(inp, h('small', null, et)); return c; };
    for (const canale of ['r', 'g', 'b']) {
      const i = h('input', 'input'); i.type = 'number';
      i.min = -2; i.max = 2; i.step = 0.05;
      i.value = cfg.detection.channelMix?.[canale] ?? 0;
      i.onchange = () => {
        const mix = { ...cfg.detection.channelMix, [canale]: parseFloat(i.value) || 0 };
        this.app.set('detection.channelMix', mix);
        this.app.set('detection.channelPreset', 'custom');
        this.render();
      };
      riga.append(campo(canale.toUpperCase(), i));
    }
    righe.push(riga);
    righe.push(h('p', 'sub', P(
      ['Somma positiva: si normalizza sulla somma. Somma nulla (differenza fra canali): si centra a metà scala. In entrambi i casi la soglia per percentile non va ritarata.',
       'Positive sum: normalised by the sum. Zero sum (channel difference): centred at mid scale. In both cases the percentile threshold needs no retuning.'])));

    /* ⚠️ Vedere ciò che il rilevatore vede.
     *
     * I riquadri mostravano sempre l'immagine a colori, anche quando il
     * rilevamento lavorava sul solo canale rosso: si sceglieva una
     * combinazione senza poterne vedere l'effetto, cioè proprio la cosa
     * che quella scelta esiste per migliorare. */
    righe.push(this._toggle('detection.mostraCanali',
      P(['Mostra i riquadri con i canali scelti', 'Show the eye views with the chosen channels']),
      P(['I riquadri degli occhi in Diagnostica mostrano ciò che il rilevatore VEDE davvero, invece dell\'immagine a colori. Serve a scegliere la combinazione guardandone l\'effetto: se l\'iride si stacca bene dal bianco dell\'occhio, quella combinazione è buona. ⚠️ Vale solo in modalità infrarossa o ibrida — con MediaPipe la combinazione di canali non ha alcun effetto, e il riquadro resta a colori.',
         'The eye views in Diagnostics show what the detector actually SEES. ⚠️ Only in infrared or hybrid mode.'])));

    return this._card(t('sec.channels'),
      P(['La melanina assorbe molto nel blu e nel verde, poco nel rosso: un\'iride marrone scuro nel canale ROSSO appare più chiara, mentre la pupilla resta nera. È lo stesso principio per cui funziona l\'infrarosso a 940 nm, solo più debole — e permette il tracciamento a soglia anche con una webcam normale. Su un\'iride chiara il guadagno è minore o nullo. In Diagnostica trovi il CONTRASTO misurato: prova le combinazioni e tieni quella con il valore più alto su questa persona.',
         'Melanin absorbs strongly in blue and green, weakly in red: a dark brown iris looks lighter in the RED channel, while the pupil stays black. This is the same principle that makes 940 nm infrared work, only weaker — and it enables threshold tracking with an ordinary webcam. On a light iris the gain is smaller or nil. Diagnostics shows the measured CONTRAST: try the combinations and keep the one with the highest value for this person.']),
      righe);
  }

  _comboCard(cfg) {
    const righe = [];
    righe.push(h('p', 'note', P(
      ['Un solo movimento volontario produce spesso PIÙ segnali insieme: alzando lo sguardo l\'iride sale, la palpebra si spalanca, e a volte il sopracciglio si solleva. Finora ciascuno veniva giudicato da solo, e se nessuno superava la propria soglia il gesto andava perso — anche quando tutti dicevano la stessa cosa.',
       'A single voluntary movement often produces SEVERAL signals at once. Until now each was judged alone, and if none crossed its threshold the gesture was lost.'])));
    righe.push(h('p', 'sub', P(
      ['Sommandoli il guadagno è preciso e prevedibile: il rumore dei canali è in buona parte indipendente, quindi sommandone due il rapporto segnale-rumore migliora del 41%, con tre del 73%. Il canale combinato si misura nella stessa unità degli altri, quindi le soglie restano confrontabili.',
       'Summing them, noise grows as the square root while the signal grows linearly: two channels give +41%, three +73%.'])));

    righe.push(this._toggle('gestures.COMBO.enabled',
      P(['Usa il canale combinato', 'Use the combined channel']),
      P(['⚠️ I canali singoli continuano a funzionare esattamente come prima: questo si aggiunge, non sostituisce. Spento, nulla cambia.',
         '⚠️ Single channels keep working exactly as before: this adds to them.'])));

    if (cfg.gestures.COMBO?.enabled) {
      righe.push(h('div', 'vb-testa', P(['CANALI DA SOMMARE', 'CHANNELS TO SUM'])));
      const scelti = new Set(cfg.signal.comboCanali || []);
      const box = h('div', 'pgroup');
      const disponibili = [
        ['up', P(['Occhio in alto', 'Eye up'])],
        ['down', P(['Occhio in basso', 'Eye down'])],
        ['left', P(['Occhio a sinistra', 'Eye left'])],
        ['right', P(['Occhio a destra', 'Eye right'])],
        ['wide', P(['Occhio spalancato', 'Eye wide open'])],
        ['narrow', P(['Occhio socchiuso', 'Eye narrowed'])],
        ['browUp', P(['Sopracciglia alzate', 'Brows raised'])],
        ['mouthOpen', P(['Bocca aperta', 'Mouth open'])],
      ];
      /* ⚠️ Caselle con l'etichetta ACCANTO, non interruttori nudi.
       *
       * Prima erano interruttori senza testo visibile e allineati a
       * caso: si vedevano otto levette identiche senza sapere quale
       * canale governasse ciascuna. Un controllo che non dice cosa fa
       * è peggio di un controllo assente, perché invita a premerlo
       * alla cieca. */
      for (const [id, nome] of disponibili) {
        const riga = h('label', 'combo-voce' + (scelti.has(id) ? ' is-on' : ''));
        const inp = h('input');
        inp.type = 'checkbox';
        inp.checked = scelti.has(id);
        inp.onchange = () => {
          const s2 = new Set(this.app.get('signal.comboCanali') || []);
          if (inp.checked) s2.add(id); else s2.delete(id);
          this.app.set('signal.comboCanali', [...s2]);
          this.render();
        };
        riga.append(inp, h('span', 'combo-nome', nome));
        box.append(riga);
      }
      box.className = 'combo-elenco';
      righe.push(box);
      righe.push(h('p', scelti.size >= 2 ? 'sub' : 'note',
        scelti.size >= 2
          ? P([`✓ ${scelti.size} canali sommati: guadagno atteso ×${Math.sqrt(scelti.size).toFixed(2)} sul rapporto segnale-rumore.`,
               `✓ ${scelti.size} channels summed: expected gain ×${Math.sqrt(scelti.size).toFixed(2)}.`])
          : P(['⚠️ Servono almeno DUE canali: con uno solo non c\'è nulla da sommare e il combinato resta inattivo.',
               '⚠️ At least TWO channels are needed.'])));
      righe.push(h('p', 'sub', P(
        ['Scegli i canali che si muovono INSIEME durante il gesto della persona. Guarda il grafico in diagnostica: se due tracce salgono nello stesso momento, sommarle conviene. Sommare un canale che non si muove peggiora invece il risultato, perché aggiunge rumore senza segnale.',
         'Choose channels that move TOGETHER during the person\'s gesture. Adding a channel that does not move makes things worse.'])));
    }

    return this._card(t('sec.combo'), null, righe);
  }

  _faceCard(cfg) {
    const righe = [];
    righe.push(this._toggle('detection.faceChannels',
      P(['Usa i canali del viso', 'Use face channels']),
      P(['Bocca, labbra, guance e sopracciglia come comandi. SPENTO: il rilevatore non calcola nemmeno le espressioni, quindi il costo è zero e nulla cambia rispetto a prima. Serve a chi non può usare lo sguardo — ogni movimento in più è una possibilità in più di comunicare.',
         'Mouth, lips, cheeks and brows as commands. OFF: the detector does not even compute expressions, so the cost is zero and nothing changes. It is for people who cannot use their gaze — every extra movement is one more way to communicate.'])));

    if (!cfg.detection.faceChannels) {
      righe.push(h('p', 'sub', P(
        ['Accendi l\'interruttore per vedere e configurare i singoli canali.',
         'Turn the switch on to see and configure the individual channels.'])));
      return this._card(t('sec.face'), null, righe);
    }

    righe.push(h('p', 'note', P(
      ['⚠️ Mentre si detta a voce questi canali vengono sospesi da soli: parlando la bocca si muove di continuo, e ogni parola diventerebbe un comando.',
       '⚠️ While dictating these channels suspend themselves: when speaking the mouth moves constantly and every word would become a command.'])));

    for (const E of EXPR_CHECKS) {
      const g = cfg.gestures[E.key] || {};
      const box = h('div', 'pgroup');
      const testa = h('div', 'group-row');
      testa.append(h('span', 'glabel', E.label));

      const sw = h('label', 'switch');
      const inp = h('input'); inp.type = 'checkbox'; inp.checked = !!g.enabled;
      inp.onchange = () => { this.app.set(`gestures.${E.key}.enabled`, inp.checked); this.render(); };
      sw.append(inp, h('span'));
      testa.append(sw);

      const sel = h('select');
      for (const [k, lab] of Object.entries(ACTIONS)) {
        const o = h('option', null, ACTION_LABELS[k] ? P(ACTION_LABELS[k]) : lab);
        o.value = k;
        if (g.action === k) o.selected = true;
        sel.append(o);
      }
      sel.onchange = () => this.app.set(`gestures.${E.key}.action`, sel.value);
      testa.append(sel);
      box.append(testa);

      const riga = h('div', 'dir-row');
      const campo = (etichetta, input) => {
        const c = h('div', 'campo'); c.append(input, h('small', null, etichetta)); return c;
      };
      const num = (val, min, max, step, onCh) => {
        const i = h('input', 'input'); i.type = 'number';
        i.min = min; i.max = max; i.step = step; i.value = val;
        i.onchange = () => onCh(i.value);
        return i;
      };
      riga.append(
        campo(P(['durata min', 'min hold']), num(g.dwellMs ?? 600, 100, 5000, 50,
          v => this.app.set(`gestures.${E.key}.dwellMs`, parseInt(v, 10) || 600))),
        campo(P(['durata max', 'max hold']), num(g.maxMs ?? 6000, 500, 60000, 100,
          v => this.app.set(`gestures.${E.key}.maxMs`, parseInt(v, 10) || 6000))),
      );
      const th = h('input', 'input'); th.type = 'number';
      /* Fino a 40 come le soglie generali: in modalità infrarossa i
       * valori utili possono stare ben oltre. */
      th.min = 0.5; th.max = 40; th.step = 0.1;
      th.placeholder = String(cfg.signal.thresholdOn);
      const cur = cfg.signal.thresholdExpr?.[E.id];
      th.value = (cur === null || cur === undefined) ? '' : cur;
      th.onchange = () => this.app.set(`signal.thresholdExpr.${E.id}`,
        th.value.trim() === '' ? null : parseFloat(th.value));
      const gn = h('input', 'input'); gn.type = 'number';
      gn.min = 0.1; gn.max = 20; gn.step = 0.1;
      gn.value = cfg.signal.gainExpr?.[E.id] ?? 1;
      gn.onchange = () => this.app.set(`signal.gainExpr.${E.id}`, parseFloat(gn.value) || 1);
      riga.append(campo(P(['soglia', 'threshold']), th), campo(P(['guadagno', 'gain']), gn));
      box.append(riga);
      righe.push(box);
    }

    return this._card(t('sec.face'),
      P(['I canali del viso passano dalla stessa catena di filtri di quelli oculari, quindi ereditano la stessa protezione dai falsi positivi. Le durate sono più lunghe: aprire la bocca o sorridere capita anche parlando o per reazione, e un comando volontario si distingue perché viene TENUTO.',
         'Face channels go through the same filter chain as the eye ones, inheriting the same false-positive protection. Hold times are longer: opening the mouth or smiling also happens while speaking or reacting, and a deliberate command stands out because it is HELD.']),
      righe);
  }

  _directionCard(cfg) {
    const dirs = [['up', ['Su', 'Up']], ['down', ['Giù', 'Down']],
                  ['left', ['Sinistra', 'Left']], ['right', ['Destra', 'Right']],
                  // L'apertura ha soglia e guadagno propri come gli altri
                  // canali: è misurata in multipli del proprio rumore.
                  ['wide', ['Occhio spalancato', 'Eye wide open']],
                  ['narrow', ['Occhio socchiuso', 'Eye narrowed']]];
    const rows = [];
    for (const [id, nome] of dirs) {
      const row = h('div', 'dir-row');
      row.append(h('span', 'glabel', P(nome)));

      const campo = (etichetta, input) => {
        const c = h('div', 'campo');
        c.append(input, h('small', null, etichetta));
        return c;
      };

      // Soglia: vuoto = eredita la globale
      const th = h('input', 'input'); th.type = 'number';
      /* Fino a 40 come le soglie generali: in modalità infrarossa i
       * valori utili possono stare ben oltre. */
      th.min = 0.5; th.max = 40; th.step = 0.1;
      th.placeholder = String(cfg.signal.thresholdOn);
      const cur = cfg.signal.thresholdDir?.[id];
      th.value = (cur === null || cur === undefined) ? '' : cur;
      th.onchange = () => {
        const v = th.value.trim() === '' ? null : parseFloat(th.value);
        this.app.set(`signal.thresholdDir.${id}`, v);
      };

      const gn = h('input', 'input'); gn.type = 'number';
      gn.min = 0.1; gn.max = 20; gn.step = 0.1;
      gn.value = cfg.signal.gainDir?.[id] ?? 1;
      gn.onchange = () => this.app.set(`signal.gainDir.${id}`, parseFloat(gn.value) || 1);

      row.append(campo(P(['soglia', 'threshold']), th), campo(P(['guadagno', 'gain']), gn));
      rows.push(row);
    }

    const cal = h('button', 'btn btn-sm btn-primary',
      P(['Calibra i movimenti', 'Calibrate movements']));
    cal.onclick = () => this.app.avviaCalibrazioneMovimenti?.();
    const rip = h('button', 'btn btn-sm', P(['Azzera', 'Reset']));
    rip.onclick = () => {
      for (const [id] of dirs) {
        this.app.set(`signal.thresholdDir.${id}`, null);
        this.app.set(`signal.gainDir.${id}`, 1);
      }
      this.render();
    };
    const az = h('div', 'profile-actions');
    az.append(cal, rip);
    rows.push(az);
    rows.push(h('p', 'sub', P(
      ['Soglia vuota = usa quella globale.', 'Empty threshold = use the global one.'])));

    return this._card(t('sec.directions'),
      P(['Le quattro direzioni non sono equivalenti sulla stessa persona: "su" è più ampio perché la palpebra non lo limita, "giù" è più piccolo, e i movimenti orizzontali si riducono perché di solito la testa accompagna lo sguardo. Il guadagno riequilibra ciascuna direzione, la soglia ne regola la sensibilità. "Calibra i movimenti" li misura sulla persona e li imposta da solo.',
         'The four directions are not equivalent for the same person: "up" is wider because the lid does not limit it, "down" is smaller, and horizontal movements shrink because the head usually follows the gaze. Gain rebalances each direction, threshold tunes its sensitivity. "Calibrate movements" measures them on the person and sets them automatically.']),
      rows);
  }

  _blinkCard(cfg) {
    return this._card(t('sec.blink'),
      P(['La soglia si calibra da sola sull\'apertura di riposo della persona: una soglia assoluta sbagliata di poco classificherebbe come "chiuso" ogni fotogramma e invaliderebbe l\'intero segnale. Le durate distinguono un ammiccamento vero dal rumore e dall\'occhio semplicemente chiuso.',
         'The threshold self-calibrates to this person\'s resting eye opening: an absolute threshold that is slightly wrong would mark every frame as "closed" and invalidate the whole signal. The durations separate a real blink from noise and from an eye simply held shut.']),
      [
        this._toggle('signal.blinkAutoCalibrate',
          P(['Calibrazione automatica', 'Auto-calibration']),
          P(['Consigliato. Misura di continuo l\'apertura di riposo',
             'Recommended. Continuously measures the resting opening'])),
        this._range('signal.blinkRatio',
          P(['Frazione di chiusura', 'Closing fraction']),
          P(['Chiuso sotto questa frazione dell\'apertura di riposo',
             'Closed below this fraction of the resting opening']), 0.15, 0.9, 0.01),
        this._range('signal.blinkFloor',
          P(['Soglia minima assoluta', 'Absolute floor']),
          P(['Rete di sicurezza', 'Safety net']), 0.02, 0.3, 0.01),
        this._range('signal.blinkLidThreshold',
          P(['Soglia fissa', 'Fixed threshold']),
          P(['Usata solo a calibrazione automatica spenta',
             'Used only when auto-calibration is off']), 0.05, 0.6, 0.01),
        this._range('gestures.blinkBurstMs',
          P(['Finestra raffica', 'Burst window']),
          P(['Due chiusure entro questo tempo = doppio, tre = triplo',
             'Two closures within this time = double, three = triple']), 150, 3000, 50, ' ms'),
        this._number('gestures.blinkMinPulseMs',
          P(['Durata minima', 'Minimum duration']),
          P(['Sotto: rumore, non un ammiccamento', 'Below: noise, not a blink']), 10, 500, 10),
        this._number('gestures.blinkMaxPulseMs',
          P(['Durata massima', 'Maximum duration']),
          P(['Sopra: occhio chiuso, non un ammiccamento', 'Above: eye held shut, not a blink']), 100, 3000, 20),
      ]);
  }

  _scanCard(cfg) {
    return this._card(t('sec.scan'), null, [
      this._range('scan.stepMs', P(['Durata passo — menu', 'Step duration — menus']),
        P(['Tempo su ogni voce di menu prima di passare alla successiva',
           'Time on each menu item before moving on']), 200, 6000, 50, ' ms'),
      this._range('scan.letterStepMs', P(['Durata passo — lettere', 'Step duration — letters']),
        P(['Dentro i gruppi di lettere. Una lettera si riconosce più in fretta di una voce di menu: è una sillaba, e si sa già quali aspettarsi. Tenerlo più corto accorcia il percorso più frequente di tutti.',
           'Inside letter groups. A letter is recognised faster than a menu item: it is one syllable, and you already know which ones to expect. Keeping it shorter speeds up the most frequent path.']),
        200, 6000, 50, ' ms'),
      this._range('scan.letterEnterDelayMs', P(['Attesa entrando in un gruppo di lettere', 'Delay entering a letter group']),
        P(['Di solito serve meno respiro che entrando in un menu: si sa già cosa sta per arrivare.',
           'Usually less breathing room is needed than entering a menu: you already know what is coming.']),
        0, 3000, 50, ' ms'),
      this._toggle('scan.adaptive', P(['Timing adattivo', 'Adaptive timing']),
        P(['Si regola sui tempi di risposta reali della persona', 'Adjusts to the person\'s actual response times'])),
      this._range('scan.adaptivePercentile', P(['Percentile adattivo', 'Adaptive percentile']),
        P(['Più alto = più tollerante ai ritardi', 'Higher = more tolerant of slow responses']), 50, 99, 1, '°'),
      this._number('scan.minStepMs', P(['Passo minimo', 'Minimum step']), null, 200, 4000, 50),
      this._number('scan.maxStepMs', P(['Passo massimo', 'Maximum step']), null, 500, 12000, 100),
      this._range('scan.enterDelayMs', P(['Attesa entrando in una sezione', 'Delay when entering a section']),
        P(['Respiro dopo aver selezionato un gruppo, prima che parta la prima voce. Senza, la prima voce scorre via mentre si è ancora fermi dal gesto appena fatto.',
           'A breath after selecting a group, before the first item starts. Without it the first item goes by while you are still recovering from the gesture just made.']),
        0, 3000, 50, ' ms'),
      this._range('scan.cyclePauseMs', P(['Pausa tra i giri', 'Pause between cycles']),
        P(['Respiro prima di ricominciare il ciclo', 'A breath before the cycle restarts']), 0, 4000, 100, ' ms'),
      this._number('scan.visibleItems', P(['Voci visibili a schermo', 'Items shown on screen']),
        P(['Quante voci mostrare attorno a quella corrente. Con menu lunghi si attiva una finestra scorrevole.',
           'How many items to show around the current one. With long menus a sliding window kicks in.']), 3, 20),
      this._range('scan.resumeDelayMs', P(['Attesa dopo la ripresa', 'Delay after resuming']),
        P(['Evita che "riprendo" e la prima voce si accavallino',
           'Prevents "resuming" and the first item from overlapping']), 0, 3000, 100, ' ms'),
      this._number('scan.maxCycles', P(['Giri a vuoto', 'Empty cycles']),
        P(['Dopo N giri senza selezione il sistema va in pausa', 'After N cycles with no selection the system pauses']), 1, 10),
      this._toggle('scan.showSuggestions', P(['Mostra suggerimenti', 'Show suggestions']),
        P(['Completamenti come primo gruppo del ciclo', 'Completions as the first group of the cycle'])),
      this._number('scan.suggestionCount', P(['Numero suggerimenti', 'Suggestion count']), null, 1, 8),
      this._number('scan.phraseCount', P(['Frasi rapide mostrate', 'Quick phrases shown']),
        P(['Meno frasi = ognuna si raggiunge prima', 'Fewer phrases = each is reached sooner']), 3, 30),
      this._number('scan.draftCount', P(['Testi nel menu', 'Texts in the menu']),
        P(['Meno testi = ognuno si raggiunge prima', 'Fewer texts = each is reached sooner']), 1, 30),
      /* ⚠️ Fuori da Parla i gesti servono ad altro: puntare, tarare,
         guardare i grafici. Una scansione che continua ad annunciare è
         nel migliore dei casi rumore di fondo, nel peggiore un gesto
         involontario che pronuncia qualcosa che nessuno voleva. */
      this._toggle('scan.soloInParla',
        P(['Ferma la scansione fuori dalla scheda Parla', 'Pause scanning outside the Speak tab']),
        P(['ACCESO (predefinito): uscendo da Parla la voce guida tace e la scansione si ferma. ⚠️ Da SPEGNERE quando si vogliono provare i gesti dalla scheda Diagnostica sentendo la voce guida mentre si guardano i grafici. Se la persona aveva messo in pausa da sé, tornando in Parla la pausa resta com\'era.',
           'ON (default): leaving the Speak tab pauses scanning and the guide voice. Turn OFF to test gestures from the Diagnostics tab.'])),
      this._toggle('scan.showBackItem', P(['Voce "indietro" nei sottomenu', 'Back item in submenus']),
        P(['Senza, per uscire da una sezione bisogna aspettare i giri a vuoto',
           'Without it, leaving a section means waiting for the empty cycles'])),
      this._select('scan.backPosition', P(['Posizione di "indietro" nei gruppi di lettere', 'Back position in letter groups']),
        P(['In coda costa nulla sul percorso frequente; in testa è più raggiungibile',
           'Last costs nothing on the frequent path; first is quicker to reach']),
        { last: P(['In coda (consigliato)', 'Last (recommended)']), first: P(['In testa', 'First']) }),
    ]);
  }

  _phraseGroupsCard(cfg) {
    const gruppi = cfg.scan.phraseGroups || [];
    const rows = gruppi.map((g, i) => {
      const box = h('div', 'pgroup');
      const testa = h('div', 'group-row');
      const lab = h('input', 'input glabel'); lab.value = g.label;
      lab.onchange = () => this.app.set(`scan.phraseGroups.${i}.label`, lab.value);
      const spo = h('input', 'input gspoken'); spo.value = g.spoken || '';
      spo.title = P(['Come pronunciarlo', 'How to pronounce it']);
      spo.onchange = () => this.app.set(`scan.phraseGroups.${i}.spoken`, spo.value);
      const su = h('button', 'btn btn-sm', '▲');
      su.onclick = () => this._spostaGruppo(i, -1);
      const giu = h('button', 'btn btn-sm', '▼');
      giu.onclick = () => this._spostaGruppo(i, 1);
      const via = h('button', 'btn btn-sm btn-danger', '×');
      via.onclick = () => {
        const a = [...gruppi]; a.splice(i, 1);
        this.app.set('scan.phraseGroups', a); this.render();
      };
      testa.append(lab, spo, su, giu, via);
      box.append(testa);

      // Una frase per riga: è il modo più semplice per riordinarle,
      // aggiungerne e toglierne senza controlli complicati.
      const ta = h('textarea', 'input pgtext');
      ta.rows = Math.min(10, Math.max(3, g.phrases.length + 1));
      ta.value = g.phrases.join('\n');
      ta.onchange = () => {
        const arr = ta.value.split('\n').map(x => x.trim()).filter(Boolean);
        this.app.set(`scan.phraseGroups.${i}.phrases`, arr);
        this.render();
      };
      box.append(ta);
      const conta = h('p', 'sub', `${g.phrases.length} ${P(['frasi', 'phrases'])}`);
      box.append(conta);
      return box;
    });

    const agg = h('button', 'btn btn-sm', P(['Aggiungi gruppo', 'Add group']));
    agg.onclick = () => {
      this.app.set('scan.phraseGroups', [...gruppi,
        { id: 'pg' + Date.now(), label: P(['Nuovo', 'New']), spoken: P(['nuovo', 'new']), phrases: [] }]);
      this.render();
    };
    const rip = h('button', 'btn btn-sm', P(['Ripristina predefiniti', 'Restore defaults']));
    rip.onclick = () => { this.app.set('scan.phraseGroups', deepClone(DEFAULT_PHRASE_GROUPS)); this.render(); };
    const uno = h('button', 'btn btn-sm', P(['Un solo elenco', 'Single list']));
    uno.title = P(['Unisce tutto in un elenco unico, come prima',
                   'Merges everything into one list, as before']);
    uno.onclick = () => {
      const tutte = gruppi.flatMap(g => g.phrases);
      this.app.set('scan.phraseGroups', [{ id: 'pg1', label: 'Frasi', spoken: 'frasi', phrases: tutte }]);
      this.render();
    };
    const azioni = h('div', 'profile-actions');
    azioni.append(agg, uno, rip);
    rows.push(azioni);

    return this._card(t('sec.phrases'),
      P(['Con UN solo gruppo l\'elenco è piatto: si scorre tutto finché non arriva la frase voluta. Con PIÙ gruppi si sceglie prima il gruppo, e le frasi di un certo tipo si raggiungono senza dover ascoltare tutte le altre — è il modo per tenere corto il percorso quando le frasi sono molte. Ogni sezione ha sempre "indietro" come prima voce. Una frase per riga, nell\'ordine in cui vanno annunciate.',
         'With ONE group the list is flat: you scan through everything until the wanted phrase arrives. With SEVERAL groups you pick the group first, so phrases of one kind are reached without hearing all the others — this is how you keep the path short when there are many phrases. Every section always has "back" as its first item. One phrase per line, in the order they should be announced.']),
      rows);
  }

  _spostaGruppo(i, d) {
    const a = [...(this.app.cfg.scan.phraseGroups || [])];
    const j = Math.max(0, Math.min(a.length - 1, i + d));
    if (i === j) return;
    a.splice(j, 0, a.splice(i, 1)[0]);
    this.app.set('scan.phraseGroups', a);
    this.render();
  }

  _groupsCard(cfg) {
    const rows = cfg.scan.groups.map((g, i) => {
      const row = h('div', 'group-row');
      const lab = h('input', 'input glabel'); lab.value = g.label;
      lab.onchange = () => this.app.set(`scan.groups.${i}.label`, lab.value);
      const items = h('input', 'input gitems'); items.value = g.items.join(' ');
      items.onchange = () => {
        const arr = items.value.trim().split(/\s+/).filter(Boolean);
        this.app.set(`scan.groups.${i}.items`, arr);
      };
      const spoken = h('input', 'input gspoken'); spoken.value = g.spoken || '';
      spoken.onchange = () => this.app.set(`scan.groups.${i}.spoken`, spoken.value);
      row.append(lab, items, spoken);
      return row;
    });

    const freq = h('button', 'btn btn-sm', P(['Ordine per frequenza', 'Frequency order']));
    freq.title = P(['Lettere più frequenti per prime: circa 1,5 annunci in meno per lettera',
                    'Most frequent letters first: about 1.5 fewer announcements per letter']);
    freq.onclick = () => { this.app.set('scan.groups', deepClone(DEFAULT_GROUPS)); this.render(); };
    const alpha = h('button', 'btn btn-sm', P(['Ordine alfabetico', 'Alphabetical order']));
    alpha.title = P(['Se la persona ha già memorizzato l\'alfabeto in ordine',
                     'If the person already memorised the alphabet in order']);
    alpha.onclick = () => { this.app.set('scan.groups', deepClone(ALPHABETICAL_GROUPS)); this.render(); };
    const add = h('button', 'btn btn-sm', P(['Aggiungi gruppo', 'Add group']));
    add.onclick = () => {
      this.app.set('scan.groups', [...cfg.scan.groups,
        { id: 'g' + Date.now(), label: 'Nuovo', spoken: 'nuovo', items: ['A'] }]);
      this.render();
    };
    const del = h('button', 'btn btn-sm btn-danger', P(['Rimuovi ultimo', 'Remove last']));
    del.onclick = () => {
      if (cfg.scan.groups.length <= 1) return;
      this.app.set('scan.groups', cfg.scan.groups.slice(0, -1));
      this.render();
    };
    const actions = h('div', 'profile-actions');
    actions.append(freq, alpha, add, del);
    rows.push(actions);

    return this._card(t('sec.groups'),
      P(['I nomi dei gruppi e l\'ordine delle lettere sono liberi: se la persona ha già memorizzato una mappa, riportala qui — il programma si adatta a lei, non il contrario. L\'ordine predefinito NON è alfabetico ma per frequenza dell\'italiano, perché in scansione la posizione è il costo: vale circa 1,5 annunci in meno per lettera. Usa ␣ per lo spazio. Colonne: nome mostrato · lettere separate da spazio · come pronunciarlo.',
         'Group names and letter order are free: if the person already memorised a map, enter it here — the program adapts to them, not the other way round. The default order is NOT alphabetical but by Italian letter frequency, because in scanning, position is cost: it saves roughly 1.5 announcements per letter. Use ␣ for space. Columns: shown name · space-separated letters · how to pronounce it.']),
      rows);
  }

  _audioCard(cfg) {
    /**
     * Selettore di voce per un canale, con prova immediata.
     * Il pulsante di prova non è un accessorio: è il modo per verificare
     * che il canale esca davvero dal dispositivo giusto — cosa che
     * altrimenti si scopre solo durante l'uso reale.
     */
    const mkVoce = (path, label, desc, canale, testo) => {
      const sel = h('select');
      const riempi = () => {
        const scelto = this.app.get(path);
        sel.innerHTML = '';
        const auto = h('option', null, P(['Automatica (italiano)', 'Automatic (Italian)']));
        auto.value = '';
        sel.append(auto);
        for (const v of this.app.audio.availableVoices) {
          const o = h('option', null, `${v.it ? '🇮🇹 ' : ''}${v.name} — ${v.lang}`);
          o.value = v.uri;
          if (scelto === v.uri) o.selected = true;
          sel.append(o);
        }
      };
      riempi();
      // Le voci arrivano in modo asincrono nei browser: si ricarica.
      setTimeout(riempi, 700);
      setTimeout(riempi, 2000);
      /* ⚠️ Anche i MENU A TENDINA possono governare altri controlli.
     *
     * L'elenco degli interruttori che ridisegnano copriva solo le
     * caselle. Ma cambiando fornitore dell'assistente cambiano il
     * modello predefinito e le note del servizio: restavano quelli di
     * prima finché non si usciva dalla scheda e si rientrava. Stessa
     * classe di difetto, altra forma di controllo. */
    sel.onchange = () => {
      this.app.set(path, sel.value);
      if (INTERRUTTORI_CHE_APRONO.has(path)) this.render();
    };

      const prova = h('button', 'btn btn-sm', '▶');
      prova.title = P(['Prova questa voce su questo canale', 'Test this voice on this channel']);
      prova.onclick = () => this.app.audio.speakProtected(testo, canale, false);

      const riga = h('div', 'voice-row');
      riga.append(sel, prova);
      return field(label, desc, riga);
    };

    /**
     * Selettore di uscita audio.
     *
     * ⚠️ I browser non rivelano i dispositivi audio finché non c'è un
     * permesso attivo su questa origine: prima di accendere la
     * telecamera l'elenco è VUOTO, e sembra che la funzione non esista.
     * Per questo l'elenco si può ricaricare e dice esplicitamente
     * perché è vuoto.
     */
    const mkSink = (path, label, desc) => {
      const sel = h('select');
      const nota = h('small', 'sink-nota');

      const riempi = () => {
        const scelto = this.app.get(path);
        sel.innerHTML = '';
        const def = h('option', null, P(['Uscita predefinita di sistema', 'System default output']));
        def.value = '';
        sel.append(def);
        this.app.listAudioOutputs().then(list => {
          for (const d of list) {
            const o = h('option', null, d.label || P(['Uscita senza nome', 'Unnamed output']));
            o.value = d.id;
            if (scelto === d.id) o.selected = true;
            sel.append(o);
          }
          const supporto = this.app.audio.statoInstradamento;
          if (!list.length) {
            nota.textContent = P(
              ['Nessun dispositivo elencato: accendi la telecamera e ricarica l\'elenco — i browser non li mostrano senza un permesso attivo.',
               'No devices listed: turn on the camera and refresh the list — browsers hide them without an active permission.']);
          } else if (!supporto.sinkSupported) {
            nota.textContent = P(
              [`${list.length} dispositivi trovati, ma questo browser non permette di scegliere l\'uscita.`,
               `${list.length} devices found, but this browser cannot choose the output.`]);
          } else {
            nota.textContent = P(
              [`${list.length} dispositivi disponibili. Vale per i toni brevi; il parlato segue l\'uscita di sistema.`,
               `${list.length} devices available. Applies to the short tones; speech follows the system output.`]);
          }
        });
      };
      riempi();

      const ric = h('button', 'btn btn-sm', '⟳');
      ric.title = P(['Ricarica l\'elenco dei dispositivi', 'Refresh the device list']);
      ric.onclick = () => riempi();

      sel.onchange = () => { this.app.set(path, sel.value); this.app.audio.applySinks(); };

      const riga = h('div', 'voice-row');
      riga.append(sel, ric);
      const box = h('div', 'sink-box');
      box.append(riga, nota);
      return field(label, desc, box);
    };

    /** Che cosa questo browser sa davvero instradare, misurato adesso. */
    const diagnostica = () => {
      const st = this.app.audio.statoInstradamento;
      const box = h('div', 'sink-diag');
      const riga = (etichetta, ok, dettaglio) =>
        `<div><span class="pallino ${ok ? 'si' : 'no'}"></span>${etichetta}: <b>${ok ? P(['sì', 'yes']) : P(['no', 'no'])}</b>${dettaglio ? ' — ' + dettaglio : ''}</div>`;
      box.innerHTML =
        riga(P(['Uscita scegliibile per i toni', 'Output selectable for tones']), st.earcon, st.motivo) +
        riga(P(['Uscita scegliibile per il parlato', 'Output selectable for speech']), false,
             P(['limite del browser, non aggirabile', 'browser limitation, cannot be worked around'])) +
        riga(P(['Canale stereo per i toni', 'Stereo channel for tones']), true, '') +
        riga(P(['Canale stereo per il parlato', 'Stereo channel for speech']), false,
             P(['stessa causa', 'same cause']));
      return field(P(['Cosa può fare questo browser', 'What this browser can do']),
        P(['Misurato adesso, non dichiarato a priori.', 'Measured now, not assumed.']), box);
    };

    const provaAnnuncio = P(['Vocali. A. E. I.', 'Vowels. A. E. I.']);
    const provaFrase = P(['Ho sete, per favore mi daresti un po\' d\'acqua?',
                          'I am thirsty, could you give me some water please?']);

    return this._card(t('sec.audio'),
      P(['⚠️ LIMITE DEL BROWSER, da conoscere prima di tarare. La sintesi vocale (`speechSynthesis`) esce SEMPRE dal dispositivo predefinito di sistema: non esiste alcuna API per instradarla su un\'altra uscita né per spostarla su un canale stereo, perché quell\'audio è generato dal sistema operativo e non passa da Web Audio. Si possono separare solo i TONI BREVI, che invece passano da Web Audio: per quelli funzionano sia l\'uscita sia il canale stereo. La separazione reale dei due canali parlati richiede la shell nativa Android. Nel frattempo restano utili due voci, due velocità e due volumi.\n\nDue canali e DUE VOCI distinte. Gli annunci di scansione servono a essere riconosciuti in fretta: vanno bene veloci, anche meccanici, e li sente solo lei nell\'auricolare. La frase che esce dall\'altoparlante è quello che lei DICE agli altri: lì conta la naturalezza. Sono esigenze opposte, e una sola voce le peggiorava entrambe. I pulsanti ▶ provano subito voce e canale.',
         'Two channels and TWO DISTINCT VOICES. Scanning announcements need to be recognised fast: quick and even mechanical is fine, and only she hears them in the earpiece. The sentence coming out of the speaker is what she SAYS to others: there, naturalness matters. These are opposite needs, and one voice made both worse. The ▶ buttons test voice and channel immediately.']),
      [
        this._toggle('audio.enabled', P(['Audio attivo', 'Audio enabled']),
          P(['Alcuni preferiscono solo il riscontro visivo', 'Some prefer visual feedback only'])),

        mkVoce('audio.menuVoiceUri',
          P(['Voce degli annunci', 'Announcement voice']),
          P(['Canale privato — auricolare. Conta la rapidità.', 'Private channel — earpiece. Speed matters.']),
          'menu', provaAnnuncio),
        this._range('audio.menuRate', P(['Velocità annunci', 'Announcement rate']), null, 0.5, 3, 0.05, '×'),
        this._range('audio.menuPitch', P(['Tono annunci', 'Announcement pitch']), null, 0.5, 2, 0.05),
        this._range('audio.menuVolume', P(['Volume annunci', 'Announcement volume']), null, 0, 1, 0.05),
        diagnostica(),
        mkSink('audio.menuSinkId', P(['Uscita annunci', 'Announcement output']),
          P(['Dove escono gli annunci', 'Where announcements come out'])),

        mkVoce('audio.speechVoiceUri',
          P(['Voce della frase detta', 'Spoken sentence voice']),
          P(['Canale pubblico — altoparlante. Conta la naturalezza.', 'Public channel — speaker. Naturalness matters.']),
          'speech', provaFrase),
        this._range('audio.speechRate', P(['Velocità frase', 'Sentence rate']), null, 0.5, 2, 0.05, '×'),
        this._range('audio.speechPitch', P(['Tono frase', 'Sentence pitch']), null, 0.5, 2, 0.05),
        this._range('audio.speechVolume', P(['Volume frase', 'Sentence volume']), null, 0, 1, 0.05),
        mkSink('audio.speechSinkId', P(['Uscita frase', 'Sentence output']),
          P(['Dove esce la frase finita', 'Where the finished sentence comes out'])),

        this._range('audio.earconPan', P(['Canale stereo dei toni', 'Earcon stereo channel']),
          P(['−1 tutto a sinistra · 0 centro · +1 tutto a destra. Vale SOLO per i toni brevi: il parlato del browser non è separabile (vedi sotto).',
             '−1 full left · 0 centre · +1 full right. Applies ONLY to the short tones: browser speech cannot be separated (see below).']),
          -1, 1, 0.1),
        this._toggle('audio.earcons', P(['Toni brevi', 'Earcons']),
          P(['Un bip prima del parlato: si riconosce la posizione senza aspettare la parola',
             'A beep before speech: the position is recognised without waiting for the word'])),
        this._toggle('audio.speakLetters', P(['Pronuncia le lettere', 'Speak letters']), null),
        this._toggle('audio.letterNames', P(['Nomi delle lettere', 'Letter names']),
          P(['"bi" invece di "b": molto più distinguibile a volume basso',
             '"bee" instead of "b": far easier to tell apart at low volume'])),
        this._toggle('audio.echoSpeechToMenu', P(['Eco della frase in auricolare', 'Echo spoken phrase to earpiece']),
          P(['Conferma a chi compone che la frase è davvero uscita',
             'Confirms to the person composing that the phrase actually came out'])),
        this._range('audio.wakeReminderSec', P(['Promemoria di risveglio', 'Wake reminder']),
          P(['Ripete come riprendere, ogni tot secondi. 0 = mai, giusto di notte',
             'Repeats how to resume every N seconds. 0 = never, the right choice at night']),
          0, 300, 10, ' s'),
      ]);
  }

  _voiceBankCard(cfg) {
    const voci = this.app.vocabolarioVoci?.() || [];
    const fatte = voci.filter(v => v.registrata).length;
    const righe = [];

    righe.push(this._toggle('audio.useVoiceBank',
      P(['Usa le voci registrate', 'Use recorded voices']),
      P(['Quando esiste una registrazione viene usata quella; per tutto il resto resta la sintesi. Spento: tutto come sempre.',
         'When a recording exists it is used; everything else stays on speech synthesis. Off: exactly as before.'])));
    righe.push(this._range('audio.recordMs', P(['Durata di ogni registrazione', 'Length of each recording']),
      null, 800, 5000, 100, ' ms'));

    const stato = h('div', 'vb-stato');
    stato.innerHTML = `<b>${fatte}</b> / ${voci.length} ` +
      P(['voci registrate', 'voices recorded']);
    righe.push(stato);

    const azioni = h('div', 'profile-actions');
    const tutte = h('button', 'btn btn-sm btn-primary',
      P(['Registra quelle che mancano', 'Record the missing ones']));
    tutte.onclick = () => this.app.registraTutte(true);
    const stop = h('button', 'btn btn-sm', P(['Ferma', 'Stop']));
    stop.onclick = () => this.app.fermaRegistrazione();
    const via = h('button', 'btn btn-sm btn-danger', P(['Cancella tutte', 'Delete all']));
    via.onclick = async () => {
      if (!confirm(P(['Cancellare tutte le registrazioni?', 'Delete all recordings?']))) return;
      await this.app.voci.eliminaTutte();
      this.render();
    };
    azioni.append(tutte, stop, via);
    righe.push(azioni);

    // Elenco per gruppo, con registra e ascolta per ciascuna voce.
    const gruppi = {};
    for (const v of voci) (gruppi[v.gruppo] ||= []).push(v);
    for (const [nome, lista] of Object.entries(gruppi)) {
      const sez = h('div', 'vb-gruppo');
      sez.append(h('div', 'vb-testa', `${nome} — ${lista.filter(v => v.registrata).length}/${lista.length}`));
      const riga = h('div', 'vb-righe');
      for (const v of lista) {
        const b = h('button', 'vb-voce' + (v.registrata ? ' ok' : ''));
        b.textContent = v.testo;
        b.title = v.registrata
          ? P(['Registrata — tocca per rifarla', 'Recorded — tap to redo'])
          : P(['Tocca per registrare', 'Tap to record']);
        b.onclick = async () => {
          await this.app.audio.speakProtected(v.testo, 'menu');
          await new Promise(r => setTimeout(r, 150));
          await this.app.registraVoce(v.testo);
          this.render();
        };
        riga.append(b);
      }
      sez.append(riga);
      righe.push(sez);
    }

    return this._card(t('sec.voicebank'),
      P(['FACOLTATIVO. La sintesi vocale del browser esce sempre dall\'uscita predefinita di sistema: non è instradabile, ed è per questo che guida e frase pronunciata non si possono separare. Ma il vocabolario della guida è piccolo e fisso — poche decine di parole. Registrandolo si ottengono dati audio veri, e su quelli la scelta dell\'uscita FUNZIONA: si mette l\'uscita di sistema sull\'altoparlante (la frase la sentono tutti) e la guida registrata sull\'auricolare. Serve anche il microfono. Con registrazioni parziali funziona lo stesso: ciò che manca ricade sulla sintesi.',
         'OPTIONAL. Browser speech synthesis always comes out of the system default output: it cannot be routed, which is why guidance and spoken sentence cannot be separated. But the guidance vocabulary is small and fixed — a few dozen words. Recording it produces real audio data, and for that the output choice DOES work: set the system output to the speaker (everyone hears the sentence) and the recorded guidance to the earpiece. A microphone is needed. Partial recordings work fine: whatever is missing falls back to synthesis.']),
      righe);
  }

  _predictionCard(cfg) {
    return this._card(t('sec.prediction'),
      P(['Il modello personale conta più del corpus generico: dopo poche settimane lo supera, perché segue la vita attuale della persona.',
         'The personal model matters more than the generic corpus: after a few weeks it overtakes it, because it follows the person\'s current life.']),
      [
        this._toggle('prediction.enabled', P(['Predizione attiva', 'Prediction enabled']), null),

        // ── Autocorrezione ──
        this._toggle('prediction.autoCorrect',
          P(['Autocorrezione', 'Autocorrection']),
          P(['Corregge le parole sbagliate usando il lessico personale, il corpus italiano e il contesto. Il criterio è "nel dubbio non correggere": se due parole sono ugualmente plausibili, lascia com\'è. Scrivere una parola con un gesto costa un minuto, e vedersela cambiare in una sbagliata sarebbe peggio dell\'errore.',
             'Corrects mistyped words using the personal lexicon, the Italian corpus and context. The rule is "when in doubt, do not correct": if two words are equally plausible it leaves the text alone. Writing a word by gesture costs a minute, and seeing it changed into a wrong one would be worse than the mistake.'])),
        this._select('prediction.autoCorrectMode',
          P(['Quando correggere', 'When to correct']),
          P(['"Dopo ogni parola" corregge appena si preme spazio, quando la persona non ha ancora ripreso a scrivere. "Prima di parlare" corregge tutta la frase al momento di pronunciarla: avendo il contesto completo scioglie ambiguità che parola per parola resterebbero.',
             '"After each word" corrects as soon as space is pressed. "Before speaking" corrects the whole sentence when it is spoken: with the full context it resolves ambiguities that word-by-word would not.']), {
          parola: P(['Dopo ogni parola', 'After each word']),
          frase: P(['Prima di parlare (tutta la frase)', 'Before speaking (whole sentence)']),
        }),
        this._number('prediction.autoCorrectMinLen',
          P(['Lunghezza minima', 'Minimum length']),
          P(['Sotto questa lunghezza non si corregge: fra parole cortissime troppe sono ugualmente vicine.',
             'Below this length nothing is corrected: among very short words too many are equally close.']), 2, 8),
        this._number('prediction.autoCorrectMaxDist',
          P(['Modifiche massime', 'Maximum edits']),
          P(['1 corregge solo errori di una lettera, ed è molto prudente. 2 recupera anche parole più storpiate, come un nome scritto male.',
             '1 corrects single-letter mistakes only, and is very cautious. 2 also recovers more mangled words, such as a badly typed name.']), 1, 2),
        this._range('prediction.autoCorrectMargin',
          P(['Prudenza', 'Caution']),
          P(['Quanto la parola migliore deve staccare la seconda per essere accettata. Alzandola si corregge meno ma con più sicurezza; abbassandola si corregge di più, con qualche rischio in più.',
             'How far the best candidate must beat the runner-up. Higher means fewer but safer corrections; lower means more corrections and slightly more risk.']),
          0.02, 0.5, 0.01),
        this._toggle('prediction.autoCorrectAnnounce',
          P(['Annuncia le correzioni a voce', 'Announce corrections aloud']),
          P(['A schermo la correzione si vede sempre. A voce costa qualche secondo, ma una correzione silenziosa su un testo costato minuti è indistinguibile da un errore del programma.',
             'On screen the correction is always shown. Aloud it costs a few seconds, but a silent correction on a text that took minutes is indistinguishable from a program error.'])),
        this._toggle('prediction.autoCorrectUndo',
          P(['Voce "annulla correzione" nelle azioni', '"Undo correction" item in actions']),
          P(['Aggiunge un comando per riportare l\'ultima parola come era stata scritta. Allunga il menu di una voce: accendilo solo se serve davvero.',
             'Adds a command to restore the last word as it was typed. It makes the menu one item longer: turn it on only if really needed.'])),
        this._range('prediction.personalWeight', P(['Peso lessico personale', 'Personal lexicon weight']), null, 0, 1, 0.05),
        this._range('prediction.recentWeight', P(['Peso recenza', 'Recency weight']), null, 0, 1, 0.05),
        this._range('prediction.corpusWeight', P(['Peso corpus generale', 'General corpus weight']), null, 0, 1, 0.05),
        this._number('prediction.recencyHalfLifeDays', P(['Emivita recenza', 'Recency half-life']),
          P(['Giorni dopo i quali un uso pesa la metà', 'Days after which one use counts half']), 1, 365),
        this._number('prediction.minPrefixForWord', P(['Lettere prima di suggerire', 'Letters before suggesting']), null, 1, 6),
        this._toggle('prediction.reorderLetters', P(['Riordino dinamico', 'Dynamic reordering']),
          P(['Spento di default: riordinare a ogni lettera distrugge la memoria motoria costruita in mesi. Accenderlo solo con misure alla mano.',
             'Off by default: reordering on every letter destroys motor memory built over months. Turn it on only with measurements in hand.'])),
      ]);
  }

  _pointerCard(cfg) {
    return this._card(t('sec.pointer'),
      P(['Due modalità per due situazioni. SGUARDO: serve controllo oculare su due assi, richiede calibrazione, due gesti impliciti per un click. BANDE: serve UN SOLO gesto — una banda verticale scorre, un gesto la ferma, poi una orizzontale, un gesto conferma. Nessuna calibrazione, due o quattro gesti per qualunque punto dello schermo.',
         'Two modes for two situations. GAZE: needs two-axis eye control, requires calibration. STRIPES: needs a SINGLE gesture — a vertical band sweeps, one gesture stops it, then a horizontal one, another confirms. No calibration, two or four gestures to reach any point on screen.']),
      [
        this._toggle('pointer.enabled', P(['Puntatore attivo', 'Pointer enabled']), null),
        this._select('pointer.mode', P(['Modalità', 'Mode']), null, {
          gaze: P(['Sguardo (due assi)', 'Gaze (two axes)']),
          scanStripe: P(['Bande a scansione (un gesto)', 'Scanning stripes (one gesture)']),
        }),
        this._toggle('pointer.showCursor', P(['Mostra cursore', 'Show cursor']), null),
        this._select('pointer.calibrationPoints', P(['Punti di calibrazione', 'Calibration points']),
          P(['Più punti = più preciso ma più faticoso', 'More points = more accurate but more tiring']),
          { 5: '5', 9: '9', 13: '13' }),
        this._range('pointer.calibrationGiri',
          P(['Quanti giri sui bersagli', 'Passes over the targets']),
          P(['⚠️ Un giro solo affida ogni punto a una manciata di fotogrammi consecutivi: se in quel momento la persona ammicca o si distrae, quel punto è compromesso e nessuno se ne accorge. Due giri danno due misure indipendenti per ogni bersaglio, che vengono mediate.',
             '⚠️ A single pass leaves each point to a handful of consecutive frames.']),
          1, 4, 1),
        this._range('pointer.calibrationBordoPunti',
          P(['Bersagli lungo il bordo', 'Targets along the border']),
          P(['Punti FERMI agli angoli e a metà dei lati, in aggiunta ai nove interni. Misurano fin dove arriva lo sguardo — i bersagli interni campionano solo il centro e sottostimano gli estremi, ed è la ragione per cui il puntatore non raggiunge i margini. ⚠️ Fermi e non in movimento: un punto che scorre viene inseguito con un ritardo che si può solo stimare, e la stima sbaglia proprio sulle curve. 0 = nessuno.',
             'FIXED points at the corners and mid-edges, in addition to the nine inner ones.']),
          0, 12, 4),
        this._range('pointer.calibrationBordoGiri',
          P(['Giri del punto in movimento (sconsigliato)', 'Moving-dot laps (not recommended)']),
          P(['Un punto percorre il perimetro dello schermo e si campiona seguendolo. ⚠️ Misura l\'escursione MASSIMA dello sguardo — quanto la persona riesce davvero a spostarsi verso i bordi. I bersagli fissi campionano solo l\'interno e sottostimano gli estremi: è la ragione principale per cui il puntatore risulta impreciso ai margini. 0 = nessun giro.',
             'A dot travels the screen perimeter while sampling. Measures the MAXIMUM gaze range.']),
          0, 4, 1),
        this._range('pointer.calibrationBordoMs',
          P(['Durata di un giro del bordo', 'Duration of one border lap']), null, 4000, 20000, 500, ' ms'),
        this._range('pointer.calibrationRitardoMs',
          P(['Ritardo dello sguardo', 'Gaze lag']),
          P(['⚠️ Seguendo un punto in movimento l\'occhio arriva sempre DOPO: circa due decimi di secondo. Senza tenerne conto ogni campione del bordo porta un errore nella stessa direzione del moto — che non si media via, e comprime la mappatura verso il centro facendo sì che il puntatore non arrivi ai lati. Alzalo se il puntatore resta troppo al centro, abbassalo se esagera verso i bordi.',
             '⚠️ The eye always lags behind a moving dot. Without compensation the mapping is compressed toward the centre.']),
          0, 500, 25, ' ms'),
        this._range('pointer.calibrationPesoBersagli',
          P(['Quanto valgono i bersagli fissi', 'Weight of the fixed targets']),
          P(['⚠️ Sui bersagli l\'occhio è FERMO e guarda un punto noto: la corrispondenza è esatta. Sul bordo insegue un punto in movimento: è approssimata. Ma i campioni del bordo sono molti di più, e senza questo peso comanderebbero l\'ottanta per cento della calibrazione. A 1 tornano a contare uguale.',
             '⚠️ Fixed targets are exact, border samples approximate — but far more numerous.']),
          1, 10, 1, '×'),
        this._range('pointer.calibrationDwellMs', P(['Permanenza per punto', 'Dwell per point']),
          P(['⚠️ Con tempi troppo brevi la calibrazione risulta frettolosa: lo sguardo non fa in tempo ad assestarsi, i campioni contengono ancora il tragitto verso il bersaglio, e alla fine viene rifiutata per "movimento troppo piccolo" — dopo tutta la fatica. Meglio una calibrazione che dura il doppio e riesce.',
             '⚠️ Too short and the calibration is rushed, then rejected at the end.']),
          400, 5000, 100, ' ms'),
        this._range('pointer.smoothing', P(['Smorzamento', 'Smoothing']),
          P(['Alto = stabile ma lento. Serve contro nistagmo e tremore', 'High = steady but slow. Counters nystagmus and tremor']), 0, 0.95, 0.05),
        this._range('pointer.dwellClickMs', P(['Click per permanenza', 'Dwell click']), null, 200, 4000, 50, ' ms'),
        this._range('pointer.dwellRadiusPx', P(['Raggio di tolleranza', 'Tolerance radius']),
          P(['Uscire da qui azzera il conteggio. Largo = meno annullamenti, meno precisione',
             'Leaving this resets the count. Wider = fewer aborts, less precision']), 15, 250, 5, ' px'),
        this._range('pointer.refractoryMs', P(['Pausa dopo il click', 'Pause after click']), null, 100, 3000, 50, ' ms'),
        this._toggle('pointer.doubleClickEnabled', P(['Doppio click', 'Double click']),
          P(['Seconda permanenza vicina alla prima', 'Second dwell close to the first'])),
        this._range('pointer.doubleWindowMs', P(['Finestra doppio click', 'Double click window']), null, 200, 3000, 50, ' ms'),
        this._range('pointer.holdMs', P(['Click prolungato', 'Long press']),
          P(['0 = disattivo. Permanenza molto lunga per click destro', '0 = off. Very long dwell for right click']), 0, 6000, 100, ' ms'),
        this._range('pointer.stripeSpeedMs',
          P(['Velocità bande — prima passata', 'Stripe speed — first pass']),
          P(['Quanto impiega la banda ad attraversare lo schermo. ⚠️ Chi seleziona alzando l\'occhio ha bisogno di tempo per reagire dopo aver visto dove la banda sta arrivando: se le selezioni cadono sempre un po\' oltre il punto voluto, rallentare.',
             'How long the stripe takes to cross the screen.']),
          600, 8000, 100, ' ms'),
        this._range('pointer.stripeSpeedFineMs',
          P(['Velocità bande — seconda passata', 'Stripe speed — second pass']),
          P(['La passata fine percorre una fascia stretta invece dello schermo intero, ed è lì che si decide il punto esatto. Poterla rallentare separatamente evita di pagare la precisione con la lentezza dappertutto. 0 = come la prima.',
             'The fine pass covers a narrow band. 0 = same as the first.']),
          0, 8000, 100, ' ms'),
        this._select('pointer.stripePasses', P(['Passate per asse', 'Passes per axis']),
          P(['2 = precisione al pixel, due gesti in più', '2 = pixel accuracy, two extra gestures']),
          { 1: P(['1 — due gesti', '1 — two gestures']), 2: P(['2 — quattro gesti', '2 — four gestures']) }),
      ]);
  }

  _draftsCard(cfg) {
    return this._card(t('sec.drafts'),
      P(['Comporre una lettera è diverso dal dire una frase: si scrive in più sedute, si rilegge, si corregge, e deve essere ancora lì domani. Per questo leggere ad alta voce non cancella nulla, e il lavoro in corso viene salvato da solo.',
         'Writing a letter is different from saying a sentence: it happens over several sittings, gets re-read and corrected, and must still be there tomorrow. That is why reading aloud erases nothing, and work in progress saves itself.']),
      [
        this._toggle('drafts.autosave', P(['Salvataggio automatico', 'Autosave']),
          P(['Recupera il testo se la scheda si chiude per sbaglio', 'Recovers the text if the tab closes by accident'])),
        this._toggle('drafts.speakBySentence', P(['Leggi frase per frase', 'Read sentence by sentence']),
          P(['Permette di fermarsi a metà di un testo lungo', 'Lets you stop halfway through a long text'])),
        this._toggle('drafts.stopSpeechOnGesture', P(['Un gesto interrompe la lettura', 'A gesture stops the reading']),
          P(['Indispensabile per una lettera di cinque minuti', 'Essential for a five-minute letter'])),
        this._number('scan.draftCount', P(['Testi nel menu', 'Texts in the menu']),
          P(['Meno testi = ognuno si raggiunge prima', 'Fewer texts = each is reached sooner']), 1, 30),
      ]);
  }

  _keyboardCard(cfg) {
    return this._card(t('sec.keyboard'),
      P(['La tastiera della scheda Punta scrive nello stesso buffer della scansione: si possono alternare i due metodi nella stessa frase.',
         'The keyboard in the Point tab writes into the same buffer as scanning: the two methods can be alternated within one sentence.']),
      [
        this._select('keyboard.layout', P(['Disposizione', 'Layout']), null, {
          abc: P(['Alfabetica', 'Alphabetical']),
          qwerty: 'QWERTY',
          frequenza: P(['Per frequenza', 'By frequency']),
        }),
        this._toggle('keyboard.showNumbers', P(['Riga dei numeri', 'Number row']), null),
        this._range('keyboard.keyGap', P(['Distanza fra i tasti', 'Key spacing']),
          P(['Con lo sguardo la distanza conta più della dimensione', 'With gaze, spacing matters more than key size']), 0, 24, 1, ' px'),
        this._toggle('keyboard.speakOnPress', P(['Pronuncia il tasto', 'Speak the key']), null),
      ]);
  }

  _deviceCard(cfg) {
    return this._card(t('sec.device'),
      P(['⚠️ Un braccio robotico vicino a chi non può spostarsi è un rischio serio: non può scansare un movimento sbagliato né chiedere aiuto in fretta. Questi limiti sono il minimo, NON il sufficiente. Servono anche un arresto fisico raggiungibile da chi assiste, limiti di coppia e corrente sul dispositivo stesso, e prove prolungate a vuoto lontano dalla persona.',
         '⚠️ A robotic arm near someone who cannot move away is a serious risk: they cannot dodge a wrong movement or call for help quickly. These limits are the minimum, NOT the sufficient set. You also need a physical stop within the assistant\'s reach, torque and current limits on the device itself, and long dry runs away from the person.']),
      [
        this._toggle('device.enabled', P(['Dispositivo attivo', 'Device enabled']), null),
        this._select('device.transport', P(['Collegamento', 'Connection']),
          P(['USB diretto funziona solo su Chrome/Edge da computer; su Android serve il bridge',
             'Direct USB only works on Chrome/Edge desktop; Android needs the bridge']), {
          serial: P(['USB diretto (Web Serial)', 'Direct USB (Web Serial)']),
          bridge: P(['Bridge locale', 'Local bridge']),
        }),
        this._number('device.baudRate', P(['Velocità seriale', 'Baud rate']), null, 1200, 921600, 100),
        this._range('device.updateHz', P(['Frequenza comandi', 'Command rate']),
          P(['Troppo alta riempie il buffer del dispositivo e aggiunge ritardo',
             'Too high fills the device buffer and adds latency']), 1, 60, 1, ' Hz'),
        this._range('device.maxSpeedPerSec', P(['Velocità massima', 'Maximum speed']),
          P(['Frazione dello spazio al secondo: un salto del puntatore non deve diventare uno scatto',
             'Fraction of the workspace per second: a pointer jump must not become a lurch']), 0.02, 2, 0.01),
        this._range('device.deadmanMs', P(['Uomo-morto', 'Deadman timeout']),
          P(['Silenzio più lungo di così → arresto. Il firmware deve averne uno proprio',
             'Silence longer than this → stop. The firmware should have its own too']), 200, 5000, 100, ' ms'),
        this._range('device.limitXMin', P(['Limite X minimo', 'X limit min']), null, 0, 1, 0.01),
        this._range('device.limitXMax', P(['Limite X massimo', 'X limit max']), null, 0, 1, 0.01),
        this._range('device.limitYMin', P(['Limite Y minimo', 'Y limit min']), null, 0, 1, 0.01),
        this._range('device.limitYMax', P(['Limite Y massimo', 'Y limit max']), null, 0, 1, 0.01),
        this._select('device.clickAction', P(['Azione del click', 'Click action']), null, {
          gripper: P(['Apri/chiudi pinza', 'Toggle gripper']),
          digital: P(['Uscita digitale', 'Digital output']),
          none: P(['Nessuna', 'None']),
        }),
        this._select('device.dblclickAction', P(['Azione del doppio click', 'Double click action']), null, {
          home: P(['Torna a riposo', 'Return home']),
          digital: P(['Uscita digitale', 'Digital output']),
          none: P(['Nessuna', 'None']),
        }),
        this._toggle('device.showFeedback', P(['Riscontro grafico', 'Visual feedback']),
          P(['Mostra spazio di lavoro, limiti e pinza', 'Shows workspace, limits and gripper'])),
      ]);
  }

  _uiCard(cfg) {
    return this._card(t('sec.ui'),
      P(['La lingua dell\'interfaccia è separata da quella della voce: un assistente anglofono può assistere una persona che comunica in italiano.',
         'Interface language is separate from the voice language: an English-speaking assistant can support someone who communicates in Italian.']),
      [
      field(P(['Versione caricata', 'Loaded version']),
        P(['Se questo numero non cambia dopo un aggiornamento, il browser sta usando la copia in cache: chiudi tutte le schede e riapri.',
           'If this number does not change after an update, the browser is using the cached copy: close all tabs and reopen.']),
        h('code', null, BUILD)),
      this._select('ui.language', P(['Lingua interfaccia', 'Interface language']), null,
        { it: 'Italiano', en: 'English' }),
      this._select('ui.theme', P(['Tema', 'Theme']), null,
        { dark: P(['Scuro', 'Dark']), light: P(['Chiaro', 'Light']) }),
      this._range('ui.fontScale',
        P(['Dimensione di TUTTA l\'interfaccia', 'Size of the WHOLE interface']),
        P(['Pulsanti, etichette, menu. Per il testo che si legge mentre si scrive c\'è il comando qui sotto.',
           'Buttons, labels, menus. For the text you read while writing use the control below.']),
        0.7, 2.2, 0.05, '×'),
      this._toggle('ui.highContrast',
        P(['Contrasto massimo (tutta l\'interfaccia)', 'Maximum contrast (whole interface)']),
        P(['Nero puro, testo bianco', 'Pure black, white text'])),

      // ── Area di lettura ──
      this._range('ui.readScale',
        P(['Dimensione di lettera, parola e frase', 'Size of letter, word and sentence']),
        P(['⚠️ È il comando più importante per chi ci vede male: ingrandisce SOLO il testo che si legge mentre si scrive, non il resto. Se ingrandendo qualcosa non entra più nello schermo, il programma rimpicciolisce da solo quel tanto che basta a evitare lo scorrimento.',
           '⚠️ This is the most important control for people with low vision: it enlarges ONLY the text read while writing, not the rest. If something no longer fits, the program shrinks it just enough to avoid scrolling.']),
        0.6, 4, 0.05, '×'),
      this._range('ui.stageScale',
        P(['Dimensione della voce corrente (al centro)', 'Size of the current item (centre)']),
        P(['La lettera o il comando che si sta per scegliere. Deve essere grande per capire al volo cosa si sta selezionando, ma non tanto da schiacciare la frase che si sta componendo, che è altrettanto importante e va letta.',
           'The letter or command about to be chosen. It must be large enough to see at a glance, but not so large as to dwarf the sentence being composed.']),
        0.3, 2.5, 0.02, '×'),
      this._range('ui.pathScale',
        P(['Dimensione del percorso e delle voci vicine', 'Size of the path and neighbouring items']),
        P(['"Dove sono" — per esempio Menu → Scrivi — e le voci che vengono prima e dopo. Sapere a che punto della sequenza ci si trova aiuta molto, e prima era scritto in caratteri minuscoli senza alcun controllo.',
           '"Where I am" — for example Menu → Write — and the items before and after. Knowing where you are in the sequence helps a lot.']),
        0.5, 4, 0.05, '×'),
      this._select('ui.readContrast',
        P(['Contrasto dell\'area di lettura', 'Reading area contrast']),
        P(['"Alto" schiarisce il testo e scurisce il fondo. "Massimo" usa nero pieno e giallo, la combinazione con più contrasto percepito quando il residuo visivo è ridotto.',
           '"High" brightens the text and darkens the background. "Maximum" uses solid black and yellow, the highest perceived contrast for reduced residual vision.']), {
        normale: P(['Normale', 'Normal']),
        alto: P(['Alto', 'High']),
        massimo: P(['Massimo (nero e giallo)', 'Maximum (black and yellow)']),
      }),
      this._toggle('ui.readFocus',
        P(['Mostra solo la voce corrente', 'Show only the current item']),
        P(['Nasconde le voci vicine e il percorso, lasciando tutto lo spazio al testo. Si perde però il contesto di ciò che sta per arrivare.',
           'Hides neighbouring items and the path, leaving all the space to the text. You lose the context of what is coming next, though.'])),
      this._toggle('ui.showMirrorText', 'Mostra testo agli astanti', null),
      this._toggle('ui.keyboardInput', 'Barra spaziatrice attiva', 'Per collaudare tutto senza telecamera'),
      this._toggle('ui.showCounters', 'Contatori in diagnostica', null),
      this._toggle('ui.debugMode', 'Modalità diagnostica', 'Calcola tutti gli assi anche se i canali sono spenti'),
    ]);
  }
}


/* ------------------------------------------------------------------ *
 * Etichette bilingui. Tenerle in coppie [it, en] sulla stessa riga
 * rende impossibile aggiungere una voce dimenticando la traduzione.
 * ------------------------------------------------------------------ */

const ACTION_LABELS = {
  NONE:        ['Nessuna', 'None'],
  SELECT:      ['Seleziona', 'Select'],
  UNDO:        ['Annulla', 'Undo'],
  WAKE:         ['Risveglia (solo se in pausa)', 'Wake (only if paused)'],
  PAUSE:        ['Metti in pausa (solo se attivo)', 'Pause (only if running)'],
  TOGGLE_PAUSE: ['Pausa / Risveglia (alterna)', 'Pause / Wake (toggle)'],
  SPEAK:       ['Pronuncia frase', 'Speak sentence'],
  BACK:        ['Torna indietro', 'Go back'],
  NEXT:        ['Avanti (scansione manuale)', 'Next (manual scanning)'],
  CLICK:       ['Click del puntatore', 'Pointer click'],
  RIGHT_CLICK: ['Click destro', 'Right click'],
};

const GESTURE_META = {
  UP:           { name: ['Occhio in alto', 'Eye up'],                        hint: ['gesto breve', 'short gesture'] },
  UP_LONG:      { name: ['Occhio in alto — lungo', 'Eye up — long'],         hint: ['stesso movimento, tenuto', 'same movement, held'] },
  UP_VERYLONG:  { name: ['Occhio in alto — molto lungo', 'Eye up — very long'], hint: ['per il risveglio dalla pausa', 'to wake from pause'] },
  DOWN:         { name: ['Occhio in basso', 'Eye down'],                     hint: null },
  LEFT:         { name: ['Occhio a sinistra', 'Eye left'],                   hint: null },
  RIGHT:        { name: ['Occhio a destra', 'Eye right'],                    hint: null },
  /* ⚠️ Apertura della palpebra e canale combinato.
   *
   * Mancavano in questo elenco — che è quello che DISEGNA la scheda —
   * quindi i due canali esistevano, funzionavano, avevano soglia,
   * guadagno e traccia nel grafico, ma non si potevano assegnare a
   * un'azione. Una funzione che non si può usare è una funzione che
   * non c'è. */
  WIDE:         { name: ['Occhio spalancato', 'Eye wide open'],
                  hint: ['alzando lo sguardo l\'occhio si apre: spesso piu netto del movimento dell\'iride',
                         'looking up widens the eye: often clearer than the iris movement'] },
  NARROW:       { name: ['Occhio socchiuso', 'Eye narrowed'],
                  hint: ['per chi socchiude volontariamente', 'for those who deliberately narrow the eye'] },
  COMBO:        { name: ['Canale combinato', 'Combined channel'],
                  hint: ['somma dei canali scelti nella scheda del canale combinato',
                         'sum of the channels chosen in the combined channel card'] },
  BLINK:        { name: ['Ammiccamento singolo', 'Single blink'],            hint: ['attenzione agli spasmi involontari', 'beware of involuntary spasms'] },
  DOUBLE_BLINK: { name: ['Doppio ammiccamento', 'Double blink'],             hint: null },
  TRIPLE_BLINK: { name: ['Triplo ammiccamento', 'Triple blink'],             hint: null },
  LONG_CLOSE:   { name: ['Occhi chiusi a lungo', 'Eyes held shut'],          hint: null },
};
