/**
 * config.js — Sorgente unica di verità per tutta la configurazione.
 *
 * Principio: NESSUN modulo contiene costanti di comportamento. Tutto ciò che
 * un assistente potrebbe voler cambiare vive qui, è serializzabile in JSON,
 * esportabile e importabile. Un profilo tarato su una persona è un file.
 *
 * Ogni voce ha: valore di default, tipo, range, etichetta e descrizione.
 * La UI delle impostazioni si genera da questo schema: aggiungere un
 * parametro qui lo fa comparire automaticamente nel tab Impostazioni.
 */

export const CONFIG_VERSION = 38;

/* ------------------------------------------------------------------ *
 * ALFABETO E GRUPPI
 * Default: mappa italiana ottimizzata sulle frequenze reali, con lo
 * spazio nel primo gruppo (è il carattere più frequente di qualsiasi
 * testo, ~17%). Completamente ridefinibile: alcune persone hanno già
 * memorizzato una mappa diversa e il programma deve adattarsi a loro,
 * non il contrario.
 * ------------------------------------------------------------------ */

/**
 * Ordine delle lettere DENTRO i gruppi: per frequenza decrescente
 * nell'italiano scritto, non alfabetico. In scansione la posizione è
 * il costo, quindi mettere E-A-I prima di B-C-D fa risparmiare circa
 * un annuncio e mezzo per lettera.
 * I GRUPPI però restano contigui nell'alfabeto, così la mappa resta
 * memorizzabile. Se una persona ha già memorizzato l'ordine alfabetico,
 * si usa il preset alternativo qui sotto: la mappa deve seguire lei.
 */
export const ALPHABETICAL_GROUPS = [
  { id: 'g1', label: 'Vocali',  spoken: 'vocali',      items: ['␣', 'A', 'E', 'I', 'O', 'U'] },
  { id: 'g2', label: 'B–H',     spoken: 'gruppo bi',   items: ['B', 'C', 'D', 'F', 'G', 'H'] },
  { id: 'g3', label: 'L–Q',     spoken: 'gruppo elle', items: ['L', 'M', 'N', 'P', 'Q'] },
  { id: 'g4', label: 'R–Z',     spoken: 'gruppo erre', items: ['R', 'S', 'T', 'V', 'Z'] },
];

/**
 * Gruppi di frasi. Con UN solo gruppo il comportamento è quello di
 * sempre: "Frasi" contiene direttamente l'elenco. Con più gruppi si
 * sceglie prima il gruppo, così le frasi di un certo tipo si
 * raggiungono senza dover ascoltare tutte le altre.
 */
/**
 * Combinazioni di canali pronte all'uso.
 * `luma` riproduce esattamente il comportamento precedente: sceglierla
 * significa che nulla cambia rispetto a prima che questa opzione
 * esistesse.
 */
export const CHANNEL_PRESETS = {
  luma:         { r: 0.299, g: 0.587, b: 0.114,
                  label: 'Luminanza (come prima)',
                  nota: 'I pesi della televisione, tarati sull\'occhio umano.' },
  red:          { r: 1, g: 0, b: 0,
                  label: 'Solo rosso',
                  nota: 'Più contrasto fra pupilla e iride scura: la melanina assorbe poco nel rosso.' },
  redGreen:     { r: 0.65, g: 0.35, b: 0,
                  label: 'Rosso e verde',
                  nota: 'Compromesso: più contrasto del solo rosso, meno rumore.' },
  redMinusBlue: { r: 1, g: 0, b: -1,
                  label: 'Rosso meno blu',
                  nota: 'La differenza fra due canali sopprime la luce ambientale che li illumina entrambi.' },
};

export const DEFAULT_PHRASE_GROUPS = [
  { id: 'pg1', label: 'Subito', spoken: 'subito',
    phrases: ['Sì', 'No', 'Grazie', 'Aiuto', 'Aspetta'] },
  { id: 'pg2', label: 'Corpo', spoken: 'corpo',
    phrases: ['Ho dolore', 'Ho sete', 'Ho fame', 'Cambiami posizione', 'Ho caldo', 'Ho freddo'] },
  { id: 'pg3', label: 'Persone', spoken: 'persone',
    phrases: ['Chiama qualcuno', 'Ciao', 'Ti voglio bene', 'Resta un po\''] },
];

export const DEFAULT_GROUPS = [
  { id: 'g1', label: 'Vocali',  spoken: 'vocali',        items: ['␣', 'E', 'A', 'I', 'O', 'U'] },
  { id: 'g2', label: 'R–Q',     spoken: 'gruppo erre',   items: ['R', 'S', 'N', 'P', 'M', 'Q'] },
  { id: 'g3', label: 'L–B',     spoken: 'gruppo elle',   items: ['L', 'C', 'D', 'G', 'H', 'F', 'B'] },
  { id: 'g4', label: 'T–Z',     spoken: 'gruppo ti',     items: ['T', 'V', 'Z', 'J', 'K', 'W', 'X', 'Y'] },
];

/* ------------------------------------------------------------------ *
 * CANALI DI GESTO
 *
 * Ogni canale è indipendente e disattivabile. Un canale disattivato non
 * viene calcolato a monte, non solo ignorato a valle: non può generare
 * falsi positivi perché non entra proprio nella pipeline.
 *
 * Questo è essenziale. Per una persona con spasmi palpebrali involontari
 * il rilevamento del blink non è inutile, è DANNOSO.
 * ------------------------------------------------------------------ */

export const GESTURE_CHANNELS = {
  UP:            { label: 'Occhio in alto',      axis: 'y', dir: -1, kind: 'dwell' },
  DOWN:          { label: 'Occhio in basso',     axis: 'y', dir: +1, kind: 'dwell' },
  LEFT:          { label: 'Occhio a sinistra',   axis: 'x', dir: -1, kind: 'dwell' },
  RIGHT:         { label: 'Occhio a destra',     axis: 'x', dir: +1, kind: 'dwell' },
  /* ⚠️ L'apertura come GESTO, non solo come rilevatore di chiusura.
   *
   * Alzando molto lo sguardo l'occhio si spalanca: la distanza fra le
   * palpebre cresce in modo netto. Per chi ha un occhio abitualmente
   * socchiuso quel cambiamento è spesso PIÙ marcato dello spostamento
   * dell'iride — misurato, oltre quattro volte tanto — e soprattutto
   * non soffre del problema che affligge l'iride: la palpebra che la
   * copre proprio quando il gesto è al culmine. */
  WIDE:          { label: 'Occhio spalancato',   axis: 'a', dir: +1, kind: 'dwell' },
  NARROW:        { label: 'Occhio socchiuso',    axis: 'a', dir: -1, kind: 'dwell' },
  BLINK:         { label: 'Ammiccamento',        axis: 'lid', dir: +1, kind: 'pulse' },
  DOUBLE_BLINK:  { label: 'Doppio ammiccamento', axis: 'lid', dir: +1, kind: 'pulse', count: 2 },
  TRIPLE_BLINK:  { label: 'Triplo ammiccamento', axis: 'lid', dir: +1, kind: 'pulse', count: 3 },
  LONG_CLOSE:    { label: 'Occhi chiusi a lungo',axis: 'lid', dir: +1, kind: 'dwell' },
};

/**
 * Azioni assegnabili a un canale.
 *
 * PAUSA e RISVEGLIA sono SEPARATE. Un unico comando che alterna è
 * pericoloso: chi tiene l'occhio in alto un po' più del previsto
 * finisce per mettere in pausa senza volerlo, e su alcune persone
 * capita di continuo. Separandole, un gesto che risveglia non può mai
 * mettere in pausa, qualunque sia la durata.
 *
 * TOGGLE_PAUSE resta disponibile per chi preferisce il vecchio
 * comportamento su un solo gesto.
 */
export const ACTIONS = {
  NONE:         'Nessuna',
  SELECT:       'Seleziona',
  UNDO:         'Annulla',
  WAKE:         'Risveglia (solo se in pausa)',
  PAUSE:        'Metti in pausa (solo se attivo)',
  TOGGLE_PAUSE: 'Pausa / Risveglia (alterna)',
  SPEAK:        'Pronuncia frase',
  BACK:         'Torna indietro',
  NEXT:         'Avanti (scansione manuale)',
  CLICK:        'Click del puntatore',
  RIGHT_CLICK:  'Click destro',
};

/* ------------------------------------------------------------------ *
 * CONFIGURAZIONE DI DEFAULT
 * Profilo iniziale: persona che può alzare UN SOLO occhio. Tutti gli
 * altri canali spenti. È il caso più restrittivo, e quindi il default
 * più sicuro: si accende ciò che serve, non si spegne ciò che disturba.
 * ------------------------------------------------------------------ */

export const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  profileName: 'Profilo predefinito',

  /* ---------------- Sorgente video ---------------- */
  source: {
    mode: 'camera',              // camera | bridge | file
    deviceId: '',                // vuoto = predefinita
    bridgeUrl: 'ws://127.0.0.1:8088/stream',
    width: 640,
    height: 480,
    fps: 30,
    mirror: true,                // ribalta orizzontalmente l'anteprima
    autoStart: false,
    /* Continua a elaborare anche a finestra nascosta.
     * Serve a chi comanda il cursore con gli occhi e vuole usare altre
     * applicazioni. SPENTO: il ciclo segue il disegno dello schermo,
     * come sempre. */
    backgroundMode: false,            // apre la camera all'avvio dell'app
  },

  /* ---------------- Rilevamento ---------------- */
  detection: {
    mode: 'rgb',                 // rgb | ir | auto
    activeEye: 'both',           // left | right | both
    // In RGB il segnale è il centro dell'IRIDE normalizzato: con occhi
    // scuri la pupilla non è separabile dall'iride in luce visibile.
    // In IR è il centro della PUPILLA, molto più preciso.
    minConfidence: 0.4,
    roiPadding: 1.6,             // moltiplicatore della larghezza occhio
    // --- solo modalità IR ---
    irDarkPercentile: 12,        // percentile per la soglia adattiva
    irMinArea: 30,               // px², scarta blob troppo piccoli
    irMaxArea: 20000,
    irUseGlint: true,            // PCCR: sottrae il riflesso corneale
    irInvert: false,             // per sensori che restituiscono il negativo

    /* ── Miscelazione dei canali RGB ──
     * Vale SOLO per il tracciamento a soglia (modalità infrarosso e
     * ibrida): il percorso in luce visibile usa MediaPipe, una rete
     * addestrata su immagini a colori normali, che peggiorerebbe se
     * ricevesse un canale solo.
     *
     * Perché serve: la melanina assorbe molto nel blu e nel verde,
     * poco nel rosso. Un'iride marrone scuro nel canale ROSSO appare
     * più chiara, mentre la pupilla resta nera — la luce entra e non
     * torna. È lo stesso principio per cui funziona l'infrarosso a
     * 940 nm, solo più debole.
     *
     * I coefficienti di partenza sono quelli della luminanza
     * televisiva, pensati per l'occhio umano: il verde pesa il 59%,
     * cioè si amplifica il canale che contiene meno informazione utile.
     */
    channelPreset: 'luma',       // luma | red | redGreen | redMinusBlue | custom
    channelMix: { r: 0.299, g: 0.587, b: 0.114 },
    // Le etichette "sinistro"/"destro" si riferiscono agli occhi DELLA
    // PERSONA. Se la telecamera è montata specchiata e risultano
    // invertite, si corregge qui.
    swapEyes: false,
    /* Ricostruisce il centro dell'iride quando la palpebra la copre.
     * Serve a chi alza molto lo sguardo: proprio in fondo alla corsa
     * l'iride finisce sotto la palpebra e il centro stimato scivola
     * verso il basso, facendo risultare il movimento più piccolo di
     * quanto sia. */
    /* ⚠️ SPENTA di default.
     * L'idea è giusta — la palpebra copre l'iride e il centro stimato
     * scivola in basso — ma su volti veri il criterio di schiacciamento
     * scattava anche quando l'iride era intera, aggiungendo uno
     * spostamento variabile a ogni fotogramma: il rumore stimato
     * cresceva e TUTTE le ampiezze crollavano.
     * Va riattivata solo dopo aver verificato in diagnostica quanto
     * spesso interviene: se interviene sempre, la soglia è sbagliata. */
    irisOcclusionFix: false,
    /* Copertura oltre la quale si comincia a correggere. Un po' di
     * palpebra sopra l'iride c'è sempre: correggerla sposterebbe il
     * segno di continuo. */
    irisOcclusionSoglia: 0.10,
    // Quanta parte della copertura eccedente viene compensata.
    irisOcclusionForza: 0.5,
    // Tetto assoluto, in frazione del raggio dell'iride.
    irisOcclusionMax: 0.6,
    // ── Canali del viso (bocca, labbra, guance, sopracciglia) ──
    // Interruttore generale. SPENTO: MediaPipe non calcola nemmeno le
    // espressioni, quindi il costo aggiuntivo è esattamente zero e il
    // programma si comporta come prima che esistessero.
    faceChannels: false,
  },

  /* ---------------- Elaborazione del segnale ---------------- */
  signal: {
    medianWindowMs: 250,         // rimuove le fasi rapide del nistagmo
    lowPassHz: 1.5,              // il gesto volontario è un gradino lento
    baselineTauSec: 30,          // deriva lenta: postura, scivolamento
    /* Tetto al congelamento continuo della baseline: oltre questo
     * tempo si smette di resistere e si segue. Un movimento dura
     * secondi, una deriva vera molto di più. */
    /* Cinque secondi: un gesto dura uno o due secondi, quindi è
     * abbondante; una deriva vera dura molto di più e va seguita.
     * Il tetto vale SOLO per il criterio debole — un gesto
     * riconosciuto è protetto senza limite. */
    /* Sopra quanto rumore si considera "movimento in corso" e si
     * protegge la baseline. Deve stare SOPRA il rumore di riposo —
     * altrimenti si congela di continuo e il tetto scade a metà
     * gesto — e ben SOTTO la soglia del gesto, altrimenti un occhio
     * debole resta senza protezione. */
    /* ⚠️ 0 = SPENTA, ed è il valore giusto.
     *
     * L'idea era proteggere la baseline appena il segnale si muove,
     * non solo quando il gesto viene riconosciuto, così da coprire
     * anche un occhio troppo debole per superare la soglia.
     *
     * Con segnali puliti funzionava. Con il rumore VERO — cinque volte
     * quello che simulavo — il segnale supera 1,5σ quasi sempre: la
     * protezione restava attiva di continuo, la stima del rumore non
     * si aggiornava mai e restava artificialmente al minimo, poi
     * scadeva il tetto e crollava tutto insieme. Misurato in
     * condizioni reali: −76% di ampiezza contro −16% senza.
     *
     * Lezione: una protezione che si attiva quasi sempre non è una
     * protezione, è un blocco. Riattivarla solo dopo averla verificata
     * con rumore realistico. */
    baselineFreezeSigma: 0,
    /* ══════════════════════════════════════════════════════════════
     * STIMA DEL RUMORE — parametri, non più valori fissi nel codice
     * ══════════════════════════════════════════════════════════════
     *
     * Il programma misura ogni gesto in multipli del rumore di quella
     * persona. Questi tre numeri governano come quel rumore viene
     * stimato, ed erano scritti nel codice: cambiarli richiedeva una
     * versione nuova.
     */
    // Quale percentile degli scostamenti si considera "rumore".
    // Più basso = sopporta più tempo in movimento senza gonfiarsi.
    sigmaPercentile: 0.25,
    // Fattore che riporta quel percentile nella scala di riferimento.
    // ⚠️ Va cambiato INSIEME al percentile: sono una coppia.
    sigmaRitaratura: 1.577,
    // Finestra su cui si guarda, in millisecondi.
    sigmaFinestraMs: 20000,
    /* Spegne la normalizzazione: le soglie diventano valori ASSOLUTI
     * di spostamento invece che multipli del rumore. Serve quando il
     * rumore è così basso o così irregolare che normalizzare confonde
     * invece di aiutare. ⚠️ Spegnendola, le soglie vanno ritarate da
     * capo: 3,5 non vorrà più dire "tre volte e mezzo il rumore". */
    normalizzaSuRumore: true,
    sigmaFisso: 0.02,
    /* ⚠️ Guadagno PER OCCHIO.
     *
     * Due occhi possono misurare diversamente lo stesso movimento
     * fisico: uno più coperto dalla palpebra, uno più obliquo rispetto
     * alla telecamera, uno abitualmente socchiuso. Il rapporto fra le
     * due ampiezze grezze è però stabile e misurabile, e un guadagno
     * lo pareggia.
     *
     * Non è un modo di nascondere un difetto: è la stessa cosa che si
     * fa tarando due microfoni diversi perché registrino allo stesso
     * livello. La diagnostica lo misura sul segnale grezzo e lo
     * propone. A 1 non cambia nulla. */
    gainEye: { left: 1, right: 1 },
    /* ⚠️ Quiete misurata in unità ASSOLUTE, non in multipli del rumore.
     *
     * Baseline e stima del rumore presuppongono che la persona stia
     * ferma la maggior parte del tempo. In una sessione di prova, dove
     * si ripete lo stesso gesto per minuti, non è così: misurato su
     * dati reali, la baseline scivolava al 58% dentro il gesto e il
     * rumore stimato diventava grande quanto il gesto stesso.
     *
     * Proteggerle con una soglia in sigma non funziona: se sigma è
     * gonfiato, la soglia si gonfia con lui. Si usa quindi l'escursione
     * grezza — quanto il segnale si muove davvero — che non dipende né
     * dalla baseline né da sigma. */
    /* ⚠️ SPENTA di default, dopo averla misurata sul caso reale.
     *
     * L'idea era giusta e i test di laboratorio la promuovevano. Ma
     * sulla configurazione che riproduce i dati veri — gesti dal primo
     * istante e poca quiete fra l'uno e l'altro — peggiorava tutto in
     * modo drastico: rumore stimato da 0,0076 a 0,1592 e ampiezza da
     * 22,5σ a 0,5σ.
     *
     * Il motivo è che entra in conflitto con il congelamento legato
     * all'aggancio del gesto: i due meccanismi si scongelano a
     * vicenda, e i campioni del gesto finiscono nella stima proprio
     * quando dovrebbero esserne esclusi.
     *
     * Resta accendibile per poterla studiare, ma non va usata finché
     * quel conflitto non è risolto. La lezione, l'ennesima: un
     * miglioramento che i test approvano va comunque provato sulla
     * configurazione che riproduce i dati veri. */
    /* ══════════════════════════════════════════════════════════════
     * MODALITÀ GREZZA — nessuna baseline, nessuna normalizzazione
     * ══════════════════════════════════════════════════════════════
     *
     * Il programma normalmente misura ogni gesto in multipli del
     * rumore di quella persona, e sottrae una baseline che insegue la
     * posizione di riposo. Sono due meccanismi che si adattano da soli
     * — ed è il loro pregio, perché rendono le soglie valide per
     * chiunque — ma sono anche due cose che possono sbagliarsi.
     *
     * In modalità grezza non si adatta nulla: si prende la posizione
     * come esce dal rilevatore, le si sottrae un riposo FISSO misurato
     * una volta all'avvio, e la si confronta con soglie espresse in
     * unità di spostamento. Nessuna deriva possibile, nessun rumore
     * che cresce, nessuna sorpresa dopo tre minuti.
     *
     * ⚠️ Il prezzo è reale: le soglie vanno tarate a mano per QUELLA
     * persona e QUELLA telecamera, e non compensano più uno
     * spostamento della testa. È una scelta di robustezza contro
     * adattabilità, e va fatta sapendolo. */
    /* ══════════════════════════════════════════════════════════════
     * PARAMETRI PER SINGOLO OCCHIO
     * ══════════════════════════════════════════════════════════════
     *
     * ⚠️ Due occhi possono avere bisogno di tarature diverse: uno più
     * coperto dalla palpebra, uno più obliquo, uno abitualmente
     * socchiuso. Un filtro o un percentile tarato sul primo può
     * peggiorare il secondo, e finora era proprio ciò che accadeva —
     * la diagnostica misurava sull'occhio migliore e applicava a
     * entrambi.
     *
     * Qui ogni occhio può avere i propri valori. Vuoto significa "usa
     * quello generale", quindi chi non li tocca non cambia nulla.
     *
     * ⚠️ Le SOGLIE restano comuni di proposito: sono il criterio con
     * cui si decide che un gesto è avvenuto, e devono significare la
     * stessa cosa per entrambi gli occhi. È il guadagno per occhio a
     * portare i due segnali sulla stessa scala, non la soglia a
     * inseguirli. */
    /* ⚠️ TETTO all'ampiezza in sigma.
     *
     * La stima del rumore scende verso il proprio pavimento assoluto
     * (0,004). Con un gesto ampio ciò significa che l'ampiezza sale
     * fino a quaranta sigma e oltre — e ci mette minuti, durante i
     * quali chi assiste deve inseguire con i guadagni.
     *
     * Non è instabilità: è un transitorio troppo lungo. Alzando il
     * pavimento in proporzione all'escursione di QUELLA persona, la
     * stima arriva prima al suo limite e l'ampiezza si stabilizza
     * attorno a questo valore.
     *
     * ⚠️ Il pavimento assoluto resta comunque: chi ha un gesto piccolo
     * non viene penalizzato, perché per lui questo tetto darebbe un
     * pavimento più basso e non si applica. */
    plafondSigma: 25,

    /* ══════════════════════════════════════════════════════════════
     * SOGLIA COME FRAZIONE DEL GESTO — spenta di default
     * ══════════════════════════════════════════════════════════════
     *
     * ⚠️ Il difetto di fondo del misurare in multipli del rumore: è il
     * rapporto fra due grandezze che evolvono ENTRAMBE. Anche quando
     * tutto funziona, quel numero non può essere stabile, e chi assiste
     * deve inseguire con i guadagni.
     *
     * L'escursione grezza invece è stabilissima — nei registri reali
     * resta a 0,15 per tutta la sessione. Esprimendo la soglia come
     * frazione di essa — "scatta quando il segnale supera il 40% del
     * gesto tipico di questa persona" — l'ampiezza diventa costante
     * per costruzione.
     *
     * ⚠️ SPENTA di default perché cambia il significato delle soglie,
     * e la situazione attuale funziona. Da provare a parte, non da
     * subire. */
    sogliaRelativa: false,
    sogliaFrazione: 0.40,

    perOcchio: {
      left:  {},   // medianWindowMs, lowPassHz, baselineTauSec,
      right: {},   // sigmaPercentile, sigmaRitaratura, minSigma, minConfidence
    },

    modoGrezzo: false,
    // Secondi di osservazione con cui si misura il riposo fisso.
    modoGrezzoRiposoSec: 3,

    quieteAssoluta: false,
    quieteFrazione: 0.25,
    /* ⚠️ Quante volte il rumore veloce deve valere l'escursione perché
     * si possa dire che ci sono gesti veri da proteggere.
     *
     * Tarato misurando. Sotto 8 la protezione scattava anche col solo
     * rumore: con un tremore lento il confronto passa-passo lo
     * sottostima, l'escursione sembra un gesto, e baseline e stima
     * restavano congelate su rumore puro — il modo più diretto per
     * riempire il programma di comandi involontari.
     *
     * A 12 il rumore resta intatto (0,0224) e i gesti restano
     * protetti. */
    quieteMinRapporto: 12,
    /* ── Quali canali sommare nel canale combinato ──
     *
     * Un solo movimento volontario produce spesso più segnali insieme:
     * alzando lo sguardo l'iride sale, la palpebra si spalanca, e a
     * volte il sopracciglio si solleva. Sommandoli il rapporto
     * segnale-rumore migliora della RADICE del numero di canali: due
     * danno +41%, tre +73%.
     *
     * Si possono indicare direzioni ('up', 'wide', 'down'…) e canali
     * del viso ('browUp'…). I pesi permettono di dare più importanza
     * al canale più affidabile per quella persona. */
    comboCanali: ['up', 'wide'],
    comboPesi: {},
    baselineFreezeMaxMs: 20000,
    baselineFreezeDuringGesture: true,   // CRITICO: vedi nota in filters.js
    thresholdOn: 3.5,            // in sigma
    thresholdOff: 1.5,           // isteresi
    minSigma: 0.004,             // pavimento: evita soglie assurde se fermo
    // Tempo di assestamento dopo una ricostruzione dei filtri: finché
    // baseline e sigma non hanno senso, il segnale normalizzato è
    // inaffidabile e non deve produrre gesti.
    settleMs: 2000,
    // Tempo massimo di aggancio di un gesto. Oltre, si rilascia
    // d'ufficio senza emettere nulla: protegge dal caso in cui l'occhio
    // non torna al riposo e il segnale resta sopra la soglia di
    // rilascio per sempre, bloccando ogni gesto successivo.
    // 0 = nessun limite (comportamento precedente).
    /* ⚠️ 30 secondi, non 10.
     * Un gesto volontario non dura mai mezzo minuto, ma TENERE l'occhio
     * alzato dieci secondi è del tutto normale — per riposare, per
     * pensare, o semplicemente perché quella è la posizione comoda. A
     * 10 secondi la protezione scattava su gesti legittimi e spostava
     * la taratura, facendo calare l'ampiezza di tutti i gesti
     * successivi. */
    /* ⚠️ DUE MINUTI, non trenta secondi.
     *
     * Un segnale alto a lungo può essere due cose opposte: una tenuta
     * volontaria, che va protetta, o un blocco vero, che va sciolto.
     * Per durata sono indistinguibili.
     *
     * Fra i due errori possibili il peggiore è chiaro: sciogliere una
     * tenuta legittima fa sparire il gesto di chi sta comunicando —
     * misurato, da 16σ a 0,2σ. Aspettare due minuti prima di sciogliere
     * un blocco vero costa invece solo un ritardo, e nel frattempo il
     * programma continua a funzionare.
     *
     * Nessuno tiene un gesto oculare per due minuti. */
    maxLatchMs: 120000,
    // Durata dell'osservazione per la taratura automatica. Più lunga =
    // stima più affidabile del rumore, ma anche più fatica per chi deve
    // restare fermo.
    autoTuneSec: 25,
    // Ammiccamento: auto-calibrato sull'apertura di riposo della persona.
    // Una soglia ASSOLUTA sbagliata di poco classifica come "chiuso" ogni
    // fotogramma e invalida l'intero segnale — vedi BlinkDetector.
    blinkAutoCalibrate: true,
    blinkRatio: 0.55,            // frazione dell'apertura di riposo
    blinkFloor: 0.08,            // rete di sicurezza assoluta
    blinkLidThreshold: 0.15,     // usato solo se auto-calibrazione spenta
    // Distingue l'ammiccamento (breve) dallo sguardo in basso (palpebra
    // abbassata a lungo). Senza, guardare in basso veniva scambiato per
    // una chiusura e il segnale "giù" veniva azzerato.
    blinkDiscriminate: true,
    // Frazione dell'apertura di riposo sotto cui l'occhio è CHIUSO, non
    // solo abbassato. Guardando in basso l'apertura scende al 40-60%
    // del riposo; chiudendo scende sotto il 25%. Serve a non scambiare
    // una chiusura prolungata per uno sguardo in basso.
    blinkClosedRatio: 0.25,
    /* ⚠️ Per dichiarare l'occhio chiuso non basta l'apertura ridotta.
     *
     * Alzando molto lo sguardo la palpebra copre parte dell'occhio e
     * l'apertura misurata si stringe: il gesto veniva scambiato per un
     * ammiccamento, mascherato proprio mentre avveniva, e il suo
     * transitorio gonfiava la stima del rumore abbassando TUTTE le
     * ampiezze di quell'occhio.
     *
     * In un ammiccamento vero la palpebra copre l'IRIDE e il
     * rilevamento crolla; alzando lo sguardo l'iride resta visibile.
     * Si richiede quindi anche che l'iride non si veda più. */
    blinkRichiedeIride: true,
    blinkSogliaIride: 0.55,
    /* ⚠️ Zona di smentimento, allargata dopo i dati reali.
     *
     * A 0,45 la finestra era 0,196–0,239 su un riposo di 0,435:
     * troppo stretta. Alzando molto lo sguardo la palpebra portava
     * l'apertura sotto 0,196 e la chiusura veniva dichiarata lo
     * stesso — trentasette ammiccamenti fantasma in tre minuti su un
     * occhio, zero sull'altro.
     *
     * A 0,20 la finestra copre quasi tutto ciò che sta sopra il
     * pavimento assoluto. La sicurezza non viene dal restringere la
     * finestra ma dalle altre due condizioni: il pavimento, che un
     * ammiccamento vero attraversa sempre, e la confidenza, che in un
     * ammiccamento vero crolla perché l'iride sparisce. */
    blinkSmentiSopra: 0.20,
    /* ⚠️ Velocità di chiusura oltre la quale è un ammiccamento vero,
     * in unità di apertura al secondo.
     *
     * È il criterio che distingue un ammiccamento da uno sguardo
     * alzato: la palpebra che ammicca percorre la propria corsa in due
     * o tre fotogrammi, chi stringe gli occhi guardando in alto
     * impiega dieci volte tanto. Un criterio basato sul TEMPO — "aspetta
     * un quarto di secondo prima di decidere" — creava invece un
     * ammiccamento fantasma all'inizio di ogni gesto. */
    blinkSmentiVelocita: 1.8,
    blinkSustainedMs: 500,       // oltre: non è un ammiccamento

    // ── Soglie e guadagni PER DIREZIONE ──
    // null = eredita il valore globale. Servono perché le quattro
    // direzioni non sono equivalenti: "su" è più ampio di "giù" (la
    // palpebra limita), e i movimenti orizzontali sono più piccoli
    // perché la testa accompagna lo sguardo.
    thresholdDir: { up: null, down: null, left: null, right: null },
    gainDir: { up: 1, down: 1, left: 1, right: 1 },
    // Soglie e guadagni per le espressioni del viso. Stessa logica
    // delle direzioni: null = eredita il valore globale.
    thresholdExpr: { mouthOpen: null, smile: null, pucker: null, funnel: null, cheekPuff: null, browUp: null },
    gainExpr: { mouthOpen: 1, smile: 1, pucker: 1, funnel: 1, cheekPuff: 1, browUp: 1 },
    // Politica di combinazione fra i due occhi, applicata sugli EVENTI
    // (non sul segnale: vedi la nota in GestureEngine.process).
    //   any  → basta un occhio. Default: continua a funzionare se
    //          l'altro è chiuso, non rilevato o inutilizzabile.
    //   best → solo l'occhio con il segnale migliore.
    //   both → servono entrambi entro dualWindowMs. Meno falsi
    //          positivi per chi muove gli occhi in modo coniugato, ma
    //          si blocca se un occhio non viene rilevato.
    eyeFusion: 'any',            // any | best | both | left | right
    dualWindowMs: 400,
    fusionDominanceRatio: 2.0,
  },

  /* ---------------- Gesti ---------------- */
  gestures: {
    UP:           { enabled: true,  action: 'SELECT', dwellMs: 400,  maxMs: 2200 },
    UP_LONG:      { enabled: true,  action: 'UNDO',   dwellMs: 2200, maxMs: 3400 },
    // Solo RISVEGLIA: tenere l'occhio su a lungo non deve poter mettere
    // in pausa. La pausa resta raggiungibile dal menu, ed è
    // assegnabile a un canale a parte se serve.
    UP_VERYLONG:  { enabled: true,  action: 'WAKE',   dwellMs: 3400, maxMs: 99000 },
    DOWN:         { enabled: false, action: 'UNDO',   dwellMs: 400,  maxMs: 2200 },
    LEFT:         { enabled: false, action: 'BACK',   dwellMs: 400,  maxMs: 2200 },
    RIGHT:        { enabled: false, action: 'NEXT',   dwellMs: 400,  maxMs: 2200 },
    // Spenti di default: chi non li usa non deve accorgersi che esistono.
    WIDE:         { enabled: false, action: 'NONE',   dwellMs: 400,  maxMs: 2600 },
    NARROW:       { enabled: false, action: 'NONE',   dwellMs: 400,  maxMs: 2600 },
    /* ── Canale COMBINATO ──
     * Somma più canali che descrivono lo stesso movimento. Spento di
     * default: chi non lo usa non deve accorgersi che esiste. */
    COMBO:        { enabled: false, action: 'NONE',   dwellMs: 400,  maxMs: 2600 },
    BLINK:        { enabled: false, action: 'SELECT', dwellMs: 80,   maxMs: 400 },
    DOUBLE_BLINK: { enabled: false, action: 'UNDO',   dwellMs: 80,   maxMs: 700 },
    TRIPLE_BLINK: { enabled: false, action: 'SPEAK',  dwellMs: 80,   maxMs: 1100 },
    /* ── Canali del viso ──
     * Tutti SPENTI: chi non li usa non deve accorgersi che esistono.
     * Le durate sono più lunghe di quelle oculari, perché aprire la
     * bocca o sorridere capita anche parlando o per reazione: un
     * comando volontario si distingue perché viene TENUTO. */
    MOUTH_OPEN:   { enabled: false, action: 'NONE', dwellMs: 700, maxMs: 6000 },
    SMILE:        { enabled: false, action: 'NONE', dwellMs: 600, maxMs: 6000 },
    PUCKER:       { enabled: false, action: 'NONE', dwellMs: 600, maxMs: 6000 },
    FUNNEL:       { enabled: false, action: 'NONE', dwellMs: 600, maxMs: 6000 },
    CHEEK_PUFF:   { enabled: false, action: 'NONE', dwellMs: 700, maxMs: 6000 },
    BROW_UP:      { enabled: false, action: 'NONE', dwellMs: 600, maxMs: 6000 },
    LONG_CLOSE:   { enabled: false, action: 'WAKE',   dwellMs: 1500, maxMs: 99000 },
    refractoryMs: 700,           // silenzio dopo un gesto: evita rimbalzi
    // Finestra entro cui più ammiccamenti contano come raffica.
    // Due chiusure entro questo tempo = doppio, tre = triplo.
    blinkBurstMs: 700,
    blinkMinPulseMs: 40,         // sotto: rumore, non un ammiccamento
    blinkMaxPulseMs: 600,        // sopra: occhio chiuso, non un ammiccamento
  },

  /* ---------------- Scansione ---------------- */
  scan: {
    stepMs: 1500,
    adaptive: true,
    adaptivePercentile: 85,
    minStepMs: 600,
    maxStepMs: 4000,
    cyclePauseMs: 900,           // respiro tra un giro e il successivo
    // Durata del passo DENTRO i gruppi di lettere.
    // Le lettere si riconoscono molto più in fretta di una voce di menu
    // — sono una sillaba, e la persona sa già quali aspettarsi — quindi
    // tenere lo stesso passo dei menu rallenta il percorso più
    // frequente di tutti. Vuoto o 0 = usa la durata dei menu.
    letterStepMs: 1000,
    // Attesa entrando in un gruppo di LETTERE. Di solito serve meno
    // respiro che entrando in un menu: si sa già cosa sta per arrivare.
    letterEnterDelayMs: 450,
    // Attesa dopo essere entrati in una sezione, PRIMA di annunciare la
    // prima voce. Senza, il primo elemento parte nello stesso istante
    // in cui si è selezionato il gruppo: chi ha appena fatto un gesto
    // non è pronto a farne subito un altro, e la prima voce — spesso
    // proprio quella che serve — va perduta.
    /* In pausa, anche una selezione risveglia.
     * ACCESO (predefinito): comportamento di sempre, e nessuno può
     * restare chiuso fuori dal programma.
     * SPENTO: risveglia solo il gesto dedicato — serve per ascoltare
     * radio, musica o video senza che un gesto involontario rimetta la
     * voce a parlare sopra. Vale solo se esiste un gesto di risveglio
     * acceso: altrimenti viene ignorato, per non lasciare mai la
     * persona senza via d'uscita. */
    selectWakes: true,
    /* Voce MENU in fondo a ogni sottomenu, per tornare subito alla
     * radice. SPENTA: ogni voce in più costa un giro a ogni scansione,
     * e per tornare indietro basta ESCI. */
    showMenuItem: false,
    /* ── Finestra di grazia ──
     * Chi seleziona reagisce a ciò che ha SENTITO, e fra la fine
     * dell'annuncio e il gesto passano centinaia di millisecondi. Se
     * la scansione è già passata oltre, viene scelta la voce
     * sbagliata: l'errore più frustrante di tutti, perché la persona
     * ha fatto tutto giusto.
     * Entro questo tempo dall'avanzamento, la selezione vale per la
     * voce PRECEDENTE. 0 = comportamento di sempre. */
    graceMs: 0,
    enterDelayMs: 700,
    maxCycles: 3,                // dopo N giri a vuoto → pausa automatica
    // Giri a vuoto consentiti mentre si sta guardando un contenuto:
    // chi si sta godendo delle foto o un video non deve essere messo in
    // pausa perché non sceglie nulla per un po'.
    maxCyclesMedia: 12,
    groups: DEFAULT_GROUPS,
    showSuggestions: true,
    suggestionCount: 4,
    phraseCount: 12,
    // Gruppi di frasi. Vuoto = elenco unico, ordinato dalle statistiche.
    phraseGroups: DEFAULT_PHRASE_GROUPS,
    // Quante voci mostrare a schermo attorno a quella corrente. Con
    // menu lunghi mostrarle tutte le farebbe traboccare e le ultime
    // sparirebbero: si scorre una finestra che tiene sempre visibile
    // la voce corrente e quelle che stanno per arrivare.
    // Voci mostrate attorno a quella corrente. Sotto il numero di voci
    // di un menu si attiva una finestra scorrevole: senza, i menu
    // lunghi traboccano e le ultime voci non si vedono mai.
    visibleItems: 6,
    // Attesa dopo "riprendo", prima di annunciare la prima voce: evita
    // che le due pronunce si accavallino.
    resumeDelayMs: 600,
    // Voce "← INDIETRO" in ogni sottomenu: senza, chi entra per errore
    // in una sezione deve aspettare i giri a vuoto per uscirne.
    showBackItem: true,
    draftCount: 10,              // testi mostrati nel menu "Miei testi"
    mediaCount: 10,              // contenuti mostrati per categoria
    // Dentro i gruppi di lettere l'uscita sta in coda: in testa
    // costerebbe un annuncio in più per OGNI lettera.
    backPosition: 'last',        // last | first
    autoSpeakOnWordEnd: false,
  },

  /* ---------------- Audio ---------------- */
  audio: {
    enabled: true,
    // ── Due voci distinte, una per canale ──
    // Gli annunci di scansione servono a essere riconosciuti in fretta:
    // vanno bene veloci, anche meccanici. La frase che esce
    // dall'altoparlante è quello che la persona DICE agli altri: lì
    // conta la naturalezza. Sono due esigenze opposte, e forzarle sulla
    // stessa voce peggiorava entrambe.
    // Vuoto = prima voce italiana disponibile.
    menuVoiceUri: '',
    speechVoiceUri: '',
    menuRate: 1.3,               // annunci: più svelti
    speechRate: 1.0,             // frase detta agli altri: naturale
    menuPitch: 1.0,
    speechPitch: 1.0,
    // Voci di guida registrate da chi assiste. FACOLTATIVE: spente,
    // tutto funziona come sempre con la sintesi. Servono a ottenere
    // l'unica cosa che la sintesi non permette — far uscire la guida da
    // un dispositivo diverso dalla frase pronunciata.
    useVoiceBank: false,
    recordMs: 1800,              // durata di ogni registrazione guidata
    // Conservati per i profili salvati con le versioni precedenti.
    ttsVoiceUri: '',
    rate: 1.15,
    pitch: 1.0,
    menuVolume: 1.0,             // canale privato (auricolare)
    speechVolume: 1.0,           // canale pubblico (altoparlante)
    menuSinkId: '',              // setSinkId: uscita per gli annunci
    speechSinkId: '',            // uscita per la frase finita
    earcons: true,
    earconGroupHz: 880,
    earconItemHz: 440,
    // Panning stereo dei TONI BREVI: -1 = tutto a sinistra, +1 = tutto
    // a destra, 0 = centro. Riguarda solo i toni, non il parlato: la
    // sintesi vocale del browser non passa da Web Audio e non è né
    // instradabile né pannabile (vedi la nota in AudioDirector).
    earconPan: 0,
    speakLetters: true,
    letterNames: true,
    // Ripetizione della frase anche nel canale annunci.
    // SPENTA: finché il parlato esce da un solo dispositivo, la persona
    // sente già la frase e ripeterla è solo fastidio. Serve solo se un
    // giorno i due canali usciranno davvero da dispositivi diversi.
    echoSpeechToMenu: false,
    // Promemoria periodico di come riprendere, mentre si è in pausa.
    // 0 = mai (di notte è la scelta giusta).
    wakeReminderSec: 0,           // "bi" invece di "b" — più distinguibile
  },

  /* ---------------- Predizione ---------------- */
  prediction: {
    /* ── Autocorrezione ──
     * SPENTA di default: è un'aggiunta, e nulla cambia finché non la si
     * accende. Il criterio guida del correttore è "nel dubbio non
     * correggere": scrivere una parola con un gesto oculare costa un
     * minuto, e vedersela cambiare in una sbagliata è peggio
     * dell'errore. */
    autoCorrect: false,
    autoCorrectMode: 'parola',   // parola (subito) | frase (prima di parlare)
    autoCorrectMinLen: 3,        // sotto: troppe parole ugualmente vicine
    autoCorrectMaxDist: 2,       // modifiche massime consentite
    autoCorrectMargin: 0.12,     // quanto il migliore deve staccare il secondo
    autoCorrectAnnounce: true,   // annuncia la correzione fatta
    autoCorrectUndo: false,      // voce "annulla correzione" nelle azioni
    enabled: true,
    personalWeight: 0.5,
    recentWeight: 0.3,
    corpusWeight: 0.2,
    recencyHalfLifeDays: 30,
    minPrefixForWord: 2,
    reorderLetters: false,       // riordino dinamico: spento di default,
                                 // distrugge la memoria motoria acquisita
    reorderStrength: 0.0,
  },

  /* ---------------- Interfaccia ---------------- */
  ui: {
    // Statistiche cliniche di sessione. Additive: spegnendole il ciclo
    // torna esattamente a com'era prima che esistessero.
    sessionStats: true,
    /* Continua a calcolare tutti gli assi anche fuori dalla scheda
     * diagnostica. Serve a chi vuole misurare mentre la persona usa
     * davvero il programma: uscendo dalla scheda la misura non deve
     * interrompersi. Costa un po' di calcolo in più. */
    diagAlways: false,
    /* Dimensione della finestra sempre in primo piano. Piccola di
     * proposito: deve stare in un angolo senza dare fastidio. */
    miniLarghezza: 250,
    miniAltezza: 130,
    language: 'it',              // it | en
    theme: 'dark',               // dark | light
    fontScale: 1.0,
    /* ── Leggibilità dell'area di lettura ──
     * `fontScale` agisce sui rem e quindi su tutta l'interfaccia, ma il
     * testo che conta — lettera, parola, frase — è dimensionato sul
     * viewport perché deve riempire lo schermo: ingrandire il resto non
     * lo ingrandiva quasi. Serve un moltiplicatore suo.
     *
     * Per chi ci vede male questo è il comando più importante: se non
     * riesce a leggere ciò che sta scrivendo, il resto non serve. */
    readScale: 1.0,               // barra di lettera, parola e frase
    /* Voce corrente al centro dello schermo.
     * Predefinito 0,72 e non 1: prima era enorme rispetto alla frase
     * che si sta componendo, che è altrettanto importante e va letta.
     * Deve essere grande, non schiacciare tutto il resto. */
    stageScale: 0.72,
    /* Percorso e voci vicine — "dove sono e cosa arriva dopo".
     * Predefinito 1,5: erano minuscole e senza alcun controllo, e per
     * chi ci vede male l'informazione andava perduta. */
    pathScale: 1.5,
    readContrast: 'normale',      // normale | alto | massimo
    // Nasconde le voci vicine per lasciare tutto lo spazio alla voce
    // corrente. Si perde il contesto di ciò che arriva: è una scelta.
    readFocus: false,
    highContrast: false,
    showMirrorText: true,
    debugMode: false,
    keyboardInput: true,         // barra spaziatrice = SELECT
    keyboardUndoKey: 'Backspace',
    showCounters: true,
    reducedMotion: false,
    // Tracce visibili nel grafico diagnostico. Vuoto = mostra
    // automaticamente solo i canali attivi.
    plotTraces: [],
    plotShowRaw: true,
  },

  /* ---------------- Puntatore ----------------
   * Due modalità distinte per due situazioni diverse:
   *   gaze       → chi controlla lo sguardo su DUE assi
   *   scanStripe → chi ha UN SOLO gesto: bande a raffinamento
   *                progressivo, due o quattro gesti per un punto
   *                qualsiasi, nessuna calibrazione necessaria
   */
  pointer: {
    enabled: false,
    mode: 'gaze',                // gaze | scanStripe
    showCursor: true,
    // --- calibrazione (solo gaze) ---
    calibrationPoints: 9,        // 5 | 9 | 13
    calibrationDwellMs: 1400,    // permanenza su ogni bersaglio
    calibrationSettleMs: 500,    // attesa prima di raccogliere: lo
                                 // sguardo deve prima arrivare
    // Escursione minima fra i bersagli perché la calibrazione sia
    // accettata. In luce visibile il movimento verticale è più
    // compresso di quello orizzontale (le palpebre lo limitano),
    // quindi una soglia troppo alta rifiuta calibrazioni utilizzabili.
    minSpan: 0.012,
    // --- movimento ---
    smoothing: 0.35,             // più alto = più stabile, più lento
    // --- click per permanenza ---
    dwellClickMs: 900,
    dwellRadiusPx: 60,           // uscire da qui azzera il conteggio
    refractoryMs: 500,
    doubleClickEnabled: true,
    doubleWindowMs: 900,
    holdMs: 0,                   // 0 = disattivo; >0 → click prolungato
    // --- cursore a bande ---
    stripeSpeedMs: 2200,
    stripePasses: 2,             // 2 = passata fine, precisione al pixel
    stripeMaxSweeps: 4,          // passate a vuoto prima di annullare
    // Trasformazione sguardo→schermo salvata. Dichiarata qui perché
    // faccia parte del profilo esportato in modo prevedibile, invece
    // di comparire solo dopo la prima calibrazione.
    calibrationData: null,
  },

  /* ---------------- Tastiera a puntamento ---------------- */
  keyboard: {
    layout: 'abc',               // abc | qwerty | frequenza
    showNumbers: true,
    keyGap: 6,
    speakOnPress: true,
  },

  /* ---------------- Contenuti (video, PDF, testi, immagini) ---------- */
  drafts: {
    autosave: true,              // salva il lavoro in corso di continuo
    speakBySentence: true,       // legge frase per frase: si può fermare
    stopSpeechOnGesture: true,   // un gesto interrompe una lettura lunga
  },

  /* ── Radio online ──
   * Una radio è un flusso audio come un altro: l'elemento che il
   * programma già usa per i file lo riproduce senza aggiungere nulla.
   * L'elenco lo compila l'assistente, come già fa con i video. */
  radio: {
    enabled: false,
    stazioni: [],   // { nome, url }
  },

  /* ── Invio di messaggi di posta ──
   * ⚠️ Un browser NON può parlare SMTP: nessun programma nel browser
   * può inviare posta da solo. Serve un servizio di appoggio — una
   * funzione su Netlify, EmailJS, o qualunque indirizzo che accetti
   * una richiesta e spedisca. L'assistente lo configura qui.
   *
   * Le credenziali della casella NON stanno mai qui: restano sul
   * servizio. In un programma che gira nel browser di una persona
   * malata, una password di posta sarebbe leggibile da chiunque
   * apra gli strumenti di sviluppo. */
  email: {
    enabled: false,
    endpoint: '',        // indirizzo del servizio che spedisce
    mittente: '',        // nome che comparirà come mittente
    oggetto: 'Messaggio da Aurora',
    contatti: [],        // { nome, indirizzo }
    conferma: true,      // chiedere conferma prima di spedire
    /* ── Parametri della casella in uscita ──
     * Vengono trasmessi al servizio di invio insieme al messaggio, così
     * lo stesso servizio funziona con qualunque provider senza doverlo
     * riconfigurare: Netlify, un server proprio, un hosting qualunque.
     *
     * ⚠️ LA PASSWORD NON STA QUI, ed è una scelta di sicurezza, non una
     * dimenticanza. Tutto ciò che si scrive nelle impostazioni resta
     * nel browser, dove chiunque apra gli strumenti di sviluppo può
     * leggerlo — e parliamo della casella personale di una persona
     * malata. La password va messa fra le variabili d'ambiente del
     * servizio, dove nessun browser la vede. */
    smtpHost: '',        // es. smtp.gmail.com
    smtpPort: 587,       // 587 con STARTTLS, 465 con TLS diretto
    smtpUser: '',        // indirizzo della casella in uscita
    smtpSicuro: false,   // vero solo sulla porta 465
  },

  /* ── Domotica tramite Home Assistant ──
   * Televisore, luci, tapparelle: dispositivi diversi dietro una sola
   * interfaccia. Accendere la televisione senza chiedere a nessuno è
   * una cosa piccola che per chi non può muoversi vale molto.
   *
   * ⚠️ Il gettone è una chiave di casa: va creato dedicato ad Aurora,
   * così può essere revocato da solo. Ha senso solo sulla rete locale. */
  domotica: {
    enabled: false,
    url: '',
    token: '',
    dispositivi: [],   // { nome, entita, comandi? }
  },

  /* ── Stampa ──
   * NON passa da Home Assistant: il browser sa già stampare su
   * qualunque stampante collegata al computer, senza intermediari.
   * Home Assistant serve semmai ad accenderla, ed è un dispositivo
   * come gli altri. */
  stampa: {
    enabled: false,
    conferma: true,
  },

  /* Registro dettagliato nella console del browser (F12).
   * Serve a capire cosa succede davvero quando qualcosa non torna:
   * ampiezze, rumore, stato del video, correzioni applicate. */
  debug: {
    console: false,
    ogniMs: 2000,
  },

  media: {
    seekSeconds: 15,
    autoScanOnOpen: true,        // apre subito i comandi in scansione
    readAloudEnabled: true,
    // Elenco di video preferiti, gestito dall'assistente: la persona
    // li sceglie in scansione senza dover cercare né digitare nulla.
    favorites: [],               // [{ title, url }]
  },

  /* ---------------- Dispositivo esterno (braccio robotico) ----------
   * ⚠️ Un braccio vicino a chi non può spostarsi è un rischio serio.
   * Questi limiti sono il minimo, non il sufficiente: servono anche un
   * arresto fisico raggiungibile e limiti di coppia sul dispositivo.
   */
  device: {
    /* ── Mouse del sistema operativo ──
     * Per chi controlla il cursore con gli occhi e vuole navigare in
     * internet o nel sistema, non solo dentro Aurora.
     *
     * Richiede un dispositivo che si presenti al computer come un
     * mouse: un ESP32 come mouse USB, oppure un programmino sul
     * computer che riceve i comandi. SPENTO di default. */
    mouse: {
      enabled: false,
      sensitivity: 900,     // passi di mouse per unità di puntatore
      maxStep: 60,          // tetto per singolo comando
      scrollStep: 1,
      invertX: false, invertY: false, invertScroll: false,
    },
    enabled: false,
    transport: 'serial',         // serial (USB, solo desktop) | bridge
    bridgeUrl: 'ws://127.0.0.1:8089/device',
    baudRate: 115200,
    updateHz: 20,                // frequenza di invio posizione
    maxSpeedPerSec: 0.35,        // frazione dello spazio al secondo
    deadmanMs: 1200,             // silenzio → arresto automatico
    limitXMin: 0.05, limitXMax: 0.95,
    limitYMin: 0.05, limitYMax: 0.95,
    clickAction: 'gripper',      // gripper | digital | none
    dblclickAction: 'home',      // home | digital | none
    showFeedback: true,
  },
};

/* ------------------------------------------------------------------ *
 * Utility
 * ------------------------------------------------------------------ */

export function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

/** Fonde la config salvata con i default: le chiavi nuove appaiono da sole. */
export function mergeConfig(base, patch) {
  if (patch === null || patch === undefined) return deepClone(base);
  if (Array.isArray(base)) return Array.isArray(patch) ? deepClone(patch) : deepClone(base);
  if (typeof base !== 'object') return patch !== undefined ? patch : base;
  const out = deepClone(base);
  for (const k of Object.keys(patch)) {
    out[k] = (k in base) ? mergeConfig(base[k], patch[k]) : deepClone(patch[k]);
  }
  return out;
}

/**
 * Migrazione fra versioni di config. Un profilo salvato mesi fa deve
 * continuare a caricarsi: è la taratura di una persona, non un file
 * qualsiasi.
 */
export function migrateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return deepClone(DEFAULT_CONFIG);
  let c = deepClone(cfg);
  const v = c.version || 1;
  if (v < 2 && c.scan && !c.scan.groups) c.scan.groups = deepClone(DEFAULT_GROUPS);
  if (v < 3 && c.gestures && !c.gestures.UP_VERYLONG) {
    c.gestures.UP_VERYLONG = { enabled: true, action: 'WAKE', dwellMs: 3400, maxMs: 99000 };
  }
  // Soglia di chiusura relativa: prima non esisteva e un occhio chiuso
  // sopra il pavimento assoluto veniva scambiato per sguardo in basso.
  // Canali del viso: soglie e guadagni per espressione.
  if (v < 31 && c.signal) {
    if (c.signal.blinkRichiedeIride === undefined) c.signal.blinkRichiedeIride = true;
    if (c.signal.blinkSogliaIride === undefined) c.signal.blinkSogliaIride = 0.55;
    if (c.signal.blinkSmentiSopra === undefined) c.signal.blinkSmentiSopra = 0.45;
    if (c.signal.baselineFreezeMaxMs === undefined) c.signal.baselineFreezeMaxMs = 20000;
    if (c.signal.baselineFreezeSigma === undefined) c.signal.baselineFreezeSigma = 0;
  }
  if (v < 31 && !c.debug) c.debug = { console: false, ogniMs: 2000 };
  if (v < 38 && c.signal) {
    if (c.signal.plafondSigma === undefined) c.signal.plafondSigma = 25;
    if (c.signal.sogliaRelativa === undefined) c.signal.sogliaRelativa = false;
    if (c.signal.sogliaFrazione === undefined) c.signal.sogliaFrazione = 0.40;
  }
  if (v < 37 && c.signal && !c.signal.perOcchio) {
    c.signal.perOcchio = { left: {}, right: {} };
  }
  if (v < 36 && c.signal && c.signal.modoGrezzo === undefined) {
    c.signal.modoGrezzo = false;
    c.signal.modoGrezzoRiposoSec = 3;
  }
  if (v < 35 && c.signal && c.signal.quieteAssoluta === undefined) {
    c.signal.quieteAssoluta = true;
    c.signal.quieteFrazione = 0.25;
  }
  if (v < 35 && c.signal && !c.signal.gainEye) c.signal.gainEye = { left: 1, right: 1 };
  if (v < 34) {
    if (c.gestures && !c.gestures.COMBO) {
      c.gestures.COMBO = { enabled: false, action: 'NONE', dwellMs: 400, maxMs: 2600 };
    }
    if (c.signal && !c.signal.comboCanali) c.signal.comboCanali = ['up', 'wide'];
    if (c.signal && !c.signal.comboPesi) c.signal.comboPesi = {};
  }
  if (v < 33 && c.gestures) {
    // Canali dell'apertura: spenti, come ogni novità.
    if (!c.gestures.WIDE) c.gestures.WIDE = { enabled: false, action: 'NONE', dwellMs: 400, maxMs: 2600 };
    if (!c.gestures.NARROW) c.gestures.NARROW = { enabled: false, action: 'NONE', dwellMs: 400, maxMs: 2600 };
  }
  if (v < 32 && c.detection) {
    /* ⚠️ La vecchia soglia (0,78) apparteneva a una misura DIVERSA —
     * lo schiacciamento dell'iride — che sui volti veri non
     * discriminava. La nuova misura è la copertura della palpebra, con
     * scala opposta: vicina a zero a occhio rilassato.
     *
     * Conservare il vecchio valore darebbe una compensazione sempre
     * attiva e al massimo: esattamente il difetto che aveva fatto
     * crollare tutte le ampiezze. Va sostituito, non migrato. */
    if (c.detection.irisOcclusionSoglia === undefined
        || c.detection.irisOcclusionSoglia > 0.6) c.detection.irisOcclusionSoglia = 0.10;
    if (c.detection.irisOcclusionForza === undefined) c.detection.irisOcclusionForza = 0.5;
    if (c.detection.irisOcclusionMax === undefined) c.detection.irisOcclusionMax = 0.6;
  }
  if (v < 31 && c.ui) {
    if (c.ui.diagAlways === undefined) c.ui.diagAlways = false;
    if (c.ui.miniLarghezza === undefined) c.ui.miniLarghezza = 250;
    if (c.ui.miniAltezza === undefined) c.ui.miniAltezza = 130;
  }
  if (v < 31 && c.detection && c.detection.irisOcclusionFix === undefined) c.detection.irisOcclusionFix = true;
  if (v < 30 && c.scan) {
    if (c.scan.showMenuItem === undefined) c.scan.showMenuItem = false;
    if (c.scan.graceMs === undefined) c.scan.graceMs = 0;
  }
  if (v < 30 && c.ui) {
    if (c.ui.stageScale === undefined) c.ui.stageScale = 0.72;
    if (c.ui.pathScale === undefined) c.ui.pathScale = 1.5;
  }
  if (v < 29 && c.source && c.source.backgroundMode === undefined) c.source.backgroundMode = false;
  if (v < 29 && c.device && !c.device.mouse) {
    c.device.mouse = { enabled: false, sensitivity: 900, maxStep: 60,
                       scrollStep: 1, invertX: false, invertY: false, invertScroll: false };
  }
  if (v < 28) {
    if (!c.domotica) c.domotica = { enabled: false, url: '', token: '', dispositivi: [] };
    if (!c.stampa) c.stampa = { enabled: false, conferma: true };
  }
  if (v < 27 && c.scan && c.scan.selectWakes === undefined) c.scan.selectWakes = true;
  if (v < 26) {
    if (!c.radio) c.radio = { enabled: false, stazioni: [] };
    if (!c.email) c.email = { enabled: false, endpoint: '', mittente: '',
                              oggetto: 'Messaggio da Aurora', contatti: [], conferma: true };
  }
  if (v < 24 && c.ui) {
    if (c.ui.readScale === undefined) c.ui.readScale = 1;
    if (c.ui.readContrast === undefined) c.ui.readContrast = 'normale';
    if (c.ui.readFocus === undefined) c.ui.readFocus = false;
  }
  if (v < 23 && c.detection) {
    if (!c.detection.channelMix) c.detection.channelMix = { r: 0.299, g: 0.587, b: 0.114 };
    if (!c.detection.channelPreset) c.detection.channelPreset = 'luma';
  }
  if (v < 22 && c.signal) {
    if (!c.signal.thresholdExpr) c.signal.thresholdExpr = { mouthOpen: null, smile: null, pucker: null, funnel: null, cheekPuff: null, browUp: null };
    if (!c.signal.gainExpr) c.signal.gainExpr = { mouthOpen: 1, smile: 1, pucker: 1, funnel: 1, cheekPuff: 1, browUp: 1 };
  }
  if (v < 20 && c.signal && c.signal.blinkClosedRatio === undefined) c.signal.blinkClosedRatio = 0.25;
  if (v < 13 && c.audio) {
    // L'eco era attiva per default e risultava ridondante: si spegne,
    // a meno che sia stata scelta esplicitamente.
    if (c.audio.echoSpeechToMenu === undefined) c.audio.echoSpeechToMenu = false;
  }
  if (v < 12 && c.audio) {
    // I profili precedenti avevano una sola voce e una sola velocità:
    // si applicano a entrambi i canali, così nulla cambia finché non si
    // sceglie diversamente.
    if (c.audio.ttsVoiceUri && !c.audio.menuVoiceUri) c.audio.menuVoiceUri = c.audio.ttsVoiceUri;
    if (c.audio.ttsVoiceUri && !c.audio.speechVoiceUri) c.audio.speechVoiceUri = c.audio.ttsVoiceUri;
    if (typeof c.audio.rate === 'number') {
      if (c.audio.menuRate === undefined) c.audio.menuRate = c.audio.rate;
      if (c.audio.speechRate === undefined) c.audio.speechRate = c.audio.rate;
    }
  }
  if (v < 11 && c.signal) {
    if (!c.signal.thresholdDir) c.signal.thresholdDir = { up: null, down: null, left: null, right: null };
    if (!c.signal.gainDir) c.signal.gainDir = { up: 1, down: 1, left: 1, right: 1 };
  }
  if (v < 10 && c.scan && !Array.isArray(c.scan.phraseGroups)) {
    c.scan.phraseGroups = deepClone(DEFAULT_PHRASE_GROUPS);
  }
  if (v < 8 && c.media && !Array.isArray(c.media.favorites)) c.media.favorites = [];
  if (v < 7) {
    // I profili precedenti non avevano la sezione dispositivo: viene
    // aggiunta disattivata, come deve essere per default.
    if (c.device) c.device.enabled = false;
  }
  if (v < 5 && c.signal) {
    // 'average' fondeva i segnali prima dei filtri: architettura
    // superata, i profili che la usavano passano ad 'any'.
    if (c.signal.eyeFusion === 'average') c.signal.eyeFusion = 'any';
  }
  if (v < 4 && c.signal) {
    // La vecchia soglia assoluta (0.42) classificava come "chiuso" ogni
    // fotogramma. I profili salvati con quel valore vanno corretti,
    // altrimenti il rilevamento resterebbe rotto dopo l'aggiornamento.
    if (c.signal.blinkLidThreshold >= 0.4) c.signal.blinkLidThreshold = 0.15;
    c.signal.blinkAutoCalibrate = true;
  }
  c.version = CONFIG_VERSION;
  return mergeConfig(DEFAULT_CONFIG, c);
}

/** Validazione difensiva: un profilo corrotto non deve rompere l'app. */
export function validateConfig(c) {
  const errs = [];
  const num = (v, lo, hi, path) => {
    if (typeof v !== 'number' || !isFinite(v)) errs.push(`${path}: non numerico`);
    else if (v < lo || v > hi) errs.push(`${path}: fuori range [${lo}, ${hi}]`);
  };
  num(c.signal.thresholdOn, 0.5, 20, 'signal.thresholdOn');
  num(c.signal.thresholdOff, 0.1, 20, 'signal.thresholdOff');
  if (c.signal.thresholdOff >= c.signal.thresholdOn)
    errs.push('signal.thresholdOff deve essere minore di thresholdOn (isteresi)');
  num(c.signal.medianWindowMs, 0, 2000, 'signal.medianWindowMs');
  num(c.signal.lowPassHz, 0.1, 15, 'signal.lowPassHz');
  num(c.scan.stepMs, 200, 10000, 'scan.stepMs');
  if (c.scan.letterStepMs) num(c.scan.letterStepMs, 200, 10000, 'scan.letterStepMs');
  num(c.signal.blinkRatio, 0.1, 0.95, 'signal.blinkRatio');
  if (c.signal.gainDir) for (const d of ['up','down','left','right']) {
    const g = c.signal.gainDir[d];
    if (typeof g !== 'number' || !isFinite(g) || g <= 0 || g > 20)
      errs.push(`signal.gainDir.${d}: guadagno fuori range`);
  }
  if (c.signal.thresholdDir) for (const d of ['up','down','left','right']) {
    const th = c.signal.thresholdDir[d];
    if (th !== null && (typeof th !== 'number' || th < 0.5 || th > 20))
      errs.push(`signal.thresholdDir.${d}: soglia fuori range`);
  }
  num(c.gestures.blinkBurstMs, 100, 5000, 'gestures.blinkBurstMs');
  if (c.pointer) {
    num(c.pointer.dwellClickMs, 150, 8000, 'pointer.dwellClickMs');
    num(c.pointer.dwellRadiusPx, 10, 400, 'pointer.dwellRadiusPx');
    num(c.pointer.smoothing, 0, 0.98, 'pointer.smoothing');
  }
  if (c.device) {
    num(c.device.maxSpeedPerSec, 0.01, 5, 'device.maxSpeedPerSec');
    if (c.device.limitXMin >= c.device.limitXMax) errs.push('device: limiti X invertiti');
    if (c.device.limitYMin >= c.device.limitYMax) errs.push('device: limiti Y invertiti');
  }
  if (c.gestures.blinkMinPulseMs >= c.gestures.blinkMaxPulseMs)
    errs.push('gestures.blinkMinPulseMs deve essere minore di blinkMaxPulseMs');
  if (!Array.isArray(c.scan.groups) || c.scan.groups.length === 0)
    errs.push('scan.groups: almeno un gruppo richiesto');
  else c.scan.groups.forEach((g, i) => {
    if (!Array.isArray(g.items) || g.items.length === 0)
      errs.push(`scan.groups[${i}]: gruppo vuoto`);
  });
  return errs;
}

export function exportProfile(cfg, stats) {
  return JSON.stringify({
    aurora: true,
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    config: cfg,
    stats: stats || null,
  }, null, 2);
}

export function importProfile(text) {
  const data = JSON.parse(text);
  if (!data || !data.config) throw new Error('File non valido: manca la sezione "config".');
  const cfg = migrateConfig(data.config);
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error('Profilo non valido:\n' + errs.join('\n'));
  return { config: cfg, stats: data.stats || null };
}
