/**
 * i18n.js — Traduzioni.
 *
 * Chiavi piatte, nessuna dipendenza. Le stringhe dell'interfaccia
 * statica si marcano con data-i18n nell'HTML; quelle generate dal
 * codice passano da t().
 *
 * Nota: la lingua dell'interfaccia è separata dalla lingua della VOCE.
 * Un assistente anglofono può assistere una persona che comunica in
 * italiano, e la sintesi vocale deve restare italiana.
 */

const IT = {
  'app.tagline': 'Comunicatore a scansione uditiva per chi dispone di un solo gesto volontario.',
  'gate.p1': 'Tutto resta sul dispositivo. Nessun video o testo viene inviato altrove.',
  'gate.p2': 'Non è un dispositivo medico e non sostituisce il sistema di chiamata d\'emergenza.',
  'gate.p3': 'Tieni sempre disponibile il metodo manuale come riserva.',
  'gate.free': 'Aurora è gratuito e lo sarà per sempre, per chiunque ne abbia bisogno. Nessuno può chiedere denaro per il suo utilizzo.',
  'gate.accept': 'Ho letto e accetto i termini e le condizioni', 'gate.readTerms': 'Leggi i termini e le condizioni', 'gate.termsLink': 'termini e condizioni',
  'gate.licence': 'licenza libera con vincolo di gratuità',
  'legal.title': 'Termini e condizioni',
  'btn.close': 'Chiudi', 'btn.licenceTxt': 'Scarica la licenza (TXT)',
  'btn.termsPdf': 'Scarica il documento (PDF)',
  'btn.printTerms': 'Stampa', 'btn.acceptTerms': 'Ho letto e accetto',
  'gate.enter': 'Attiva audio e inizia',
  'gate.foot': 'L\'audio richiede un tocco: è una regola del browser, non un\'impostazione.',

  'tab.speak': 'Parla', 'tab.settings': 'Impostazioni',
  'tab.stats': 'Statistiche', 'tab.debug': 'Diagnostica', 'tab.point': 'Punta',
  'tab.watch': 'Media', 'tab.dictate': 'Detta',
  'btn.dictStart': '🎤 Detta', 'btn.dictStop': '⏹ Ferma', 'btn.dictSpeak': '🔊 Pronuncia',
  'btn.copy': 'Copia', 'btn.cut': 'Taglia', 'btn.paste': 'Incolla', 'btn.openTxt': 'Apri file',
  'btn.dictSave': 'Salva nei miei testi', 'btn.dictToBuffer': 'Manda a Parla',
  'btn.translate': 'Traduci', 'btn.useTranslation': 'Usa come testo',
  'dict.placeholder': 'Premi Detta e parla, oppure scrivi qui.',
  'dict.translate': 'Traduci',
  'dict.translateNote': '⚠️ La traduzione è l\'unica funzione che richiede una connessione a internet, e il servizio gratuito ha un limite giornaliero.',
  'dict.translationHere': 'La traduzione comparirà qui.',
  'dict.listening': 'in ascolto', 'dict.idle': 'fermo',
  'dict.title': 'Titolo del documento',
  'btn.dictStopSpeak': '⏹ Ferma voce', 'btn.selectAll': 'Seleziona tutto',
  'btn.dictDownload': 'Scarica come file',
  'dict.fromFile': 'Trascrivi da un file audio o video',
  'dict.fromFileNote': '⚠️ Il browser non sa leggere direttamente l\'audio di un file: il file viene riprodotto ad alta voce e il microfono lo ascolta. Serve quindi volume alto, poco rumore intorno, e il microfono acceso.',
  'btn.loadAudio': 'Carica audio o video', 'btn.transcribe': '▶ Trascrivi', 'btn.stop': '⏹ Ferma',
  'watch.title': 'Media',
  'watch.sub': 'Video, audio, documenti e immagini. I comandi diventano una voce del menu di scansione: si guidano con lo stesso gesto usato per scrivere.',
  'watch.favNote': 'Chi assiste incolla qui i link. La persona li sceglie in scansione, senza dover cercare né digitare.',
  'card.favorites': 'Video preferiti', 'card.viewer': 'Visualizzatore',
  'card.drafts': 'I miei testi', 'card.library': 'File caricati',
  'watch.libNote': 'I file caricati restano disponibili nel menu GUARDA della pagina Parla, finché la scheda resta aperta.',
  'drafts.how': 'Come si usa. Si scrive un po\' alla volta — nella pagina Parla con la scansione, o qui con la tastiera. Quando il testo è pronto: SALVA. Resta qui finché serve. Per farlo pronunciare quando arriva la persona a cui è rivolto: si sceglie I MIEI TESTI nel menu di scansione, poi il testo, poi PARLA QUESTO. Rileggere non cancella niente, e il lavoro in corso viene salvato da solo.',
  'btn.saveDraft': 'Salva il testo in composizione',
  'btn.saveDraft2': 'Salva testo', 'btn.clear': 'Svuota',
  'pt.keyboard': 'Tastiera', 'pt.texts': 'I miei testi', 'pt.media': 'Media', 'pt.arm': 'Braccio',
  'btn.exportDrafts': 'Esporta tutti', 'btn.importDrafts': 'Importa',
  'sec.drafts': 'Testi lunghi',
  'btn.openDoc': 'Carica file', 'btn.openImg': 'Carica immagini', 'btn.openFolder': 'Carica cartella',
  'btn.saveText': 'Salva ciò che ho scritto', 'btn.recenter': 'Ricentra',
  'ph.favTitle': 'Titolo', 'ph.favUrl': 'Link YouTube',
  'media.empty': 'Scegli un video preferito, oppure apri un documento o delle immagini.',
  'sec.media': 'Contenuti',
  'point.title': 'Punta',
  'point.sub': 'Puntatore a sguardo per chi controlla due assi, oppure bande a scansione per chi ha un solo gesto.',
  'point.kbNote': 'Ogni tasto è un bersaglio: funziona con lo sguardo, con le bande, col dito e col mouse. Il testo finisce nello stesso buffer della scansione.',
  'point.armWarn': 'Un braccio vicino a chi non può spostarsi è un rischio serio: servono un arresto fisico raggiungibile da chi assiste, limiti di coppia sul dispositivo e prove prolungate a vuoto prima dell\'uso.',
  'card.keyboard': 'Tastiera', 'card.arm': 'Braccio robotico',
  'btn.calibrate': 'Calibra', 'btn.ptrStart': 'Attiva puntatore',
  'btn.ptrStop': 'Ferma puntatore', 'btn.stripe': 'Bande a scansione',
  'sec.device': 'Dispositivo esterno', 'sec.keyboard': 'Tastiera a puntamento',
  'cal.look': 'Guarda il punto e resta fermo', 'cal.done': 'Calibrazione completata',
  'cal.mUp': 'Guarda in ALTO e tieni', 'cal.mDown': 'Guarda in BASSO e tieni',
  'cal.mLeft': 'Guarda a SINISTRA e tieni', 'cal.mRight': 'Guarda a DESTRA e tieni',
  'cal.rest': 'Torna al centro e rilassati', 'cal.mDone': 'Movimenti calibrati',

  'btn.start': 'Avvia', 'btn.pause': 'Pausa', 'btn.select': 'Seleziona',
  'btn.undo': 'Annulla', 'btn.speak': 'Pronuncia', 'btn.back': 'Indietro',
  'btn.camStart': 'Avvia camera', 'btn.camStop': 'Ferma camera',
  'btn.loadVideo': 'Carica video', 'btn.export': 'Esporta profilo',
  'btn.import': 'Importa profilo', 'btn.reset': 'Ripristina', 'btn.autotune': 'Taratura automatica', 'btn.statsExport': 'Esporta statistiche', 'btn.statsMerge': 'Importa e unisci', 'btn.statsReplace': 'Importa e sostituisci',
  'btn.add': 'Aggiungi',

  'status.paused': 'In pausa', 'status.running': 'In scansione',
  'status.noEye': 'nessun occhio', 'status.good': 'segnale buono',
  'status.fair': 'segnale discreto', 'status.weak': 'segnale debole',

  'hint.keyboard': 'Spazio: seleziona · Backspace: annulla · ← : indietro · Invio: pronuncia · Esc: pausa',
  'placeholder.profile': 'Nome profilo',
  'placeholder.newPhrase': 'Aggiungi una frase che usa davvero',

  'settings.title': 'Impostazioni',
  'settings.sub': 'Tutto ciò che si può tarare vive qui. La pagina Parla resta pulita.',
  'stats.title': 'Statistiche',
  'stats.sub': 'Non è un pannello informativo: è il modello predittivo, visibile e modificabile.',
  'debug.title': 'Diagnostica',
  'vid.loop': 'ciclo',
  'btn.diagSession': 'Salva statistica sessione', 'btn.diagTotal': 'Salva statistica cumulata',
  'btn.diagImport': 'Importa diagnostica', 'btn.nuovaSessione': 'Nuova sessione',
  'btn.diagReset': 'Torna ai predefiniti',
  'btn.diagUndo': 'Ripristina i precedenti', 'diag.always': 'Misura sempre',
  'btn.diagApply': 'Applica parametri',
  'card.diagStats': 'Comportamento oculare',
  'debug.statsNote': 'Misurato di continuo mentre usi il programma, su ogni scheda. Più a lungo osserva, più i parametri proposti sono affidabili: la taratura automatica dura venticinque secondi, questa può durare ore.',
  'debug.sub': 'Cosa il programma sta vedendo, in tempo reale. Senza questa vista si tara alla cieca.',

  'card.phrases': 'Frasi più usate', 'card.words': 'Parole più usate',
  'card.letters': 'Lettere', 'card.session': 'Sessione',
  'card.eyeLeft': 'Occhio sinistro (suo)', 'card.eyeRight': 'Occhio destro (suo)',
  'card.signal': 'Segnale',
  'plot.raw': 'grezzo',
  'plot.showRaw': 'mostra grezzo',
  'plot.active': 'attivo',
  'plot.off': 'canale spento',
  'plot.hint': 'tratto pieno = filtrato · sottile = grezzo · la distanza fra i due è il nistagmo rimosso',
  'plot.blinkHint': 'bande in alto = occhio chiuso', 'card.counters': 'Contatori',
  'card.eventlog': 'Registro eventi',

  'sec.source': 'Sorgente video', 'sec.detection': 'Rilevamento',
  'sec.signal': 'Segnale e anti-nistagmo', 'sec.gestures': 'Canali di gesto',
  'sec.blink': 'Ammiccamento', 'sec.mouse': 'Mouse del sistema e finestra in primo piano',
  'sec.debug': 'Registro e diagnosi avanzata',
  'sec.offline': 'Funzionamento senza internet',
  'sec.radio': 'Radio online', 'sec.email': 'Invio di messaggi email',
  'sec.domotica': 'Dispositivi di casa e stampa',
  'sec.combo': 'Canale combinato (somma di più segnali)',
  'sec.channels': 'Canali RGB dello stream video',
  'sec.face': 'Canali del viso (bocca, labbra, sopracciglia)',
  'sec.directions': 'Direzioni: soglia e guadagno', 'sec.scan': 'Scansione',
  'sec.groups': 'Gruppi di lettere', 'sec.phrases': 'Gruppi di frasi', 'sec.audio': 'Audio', 'sec.voicebank': 'Voci di guida registrate',
  'sec.prediction': 'Predizione', 'sec.pointer': 'Puntatore e sguardo',
  'sec.ui': 'Interfaccia e lingua',
};

const EN = {
  'app.tagline': 'Auditory scanning communicator for people with a single voluntary gesture.',
  'gate.p1': 'Everything stays on this device. No video or text is sent anywhere.',
  'gate.p2': 'This is not a medical device and does not replace an emergency call system.',
  'gate.p3': 'Always keep the manual method available as a backup.',
  'gate.free': 'Aurora is free and will always be, for anyone who needs it. Nobody may charge money for its use.',
  'gate.accept': 'I have read and accept the terms and conditions', 'gate.readTerms': 'Read the terms and conditions', 'gate.termsLink': 'terms and conditions',
  'gate.licence': 'free licence with a gratuity condition',
  'legal.title': 'Terms and conditions',
  'btn.close': 'Close', 'btn.licenceTxt': 'Download the licence (TXT)',
  'btn.termsPdf': 'Download the document (PDF)',
  'btn.printTerms': 'Print', 'btn.acceptTerms': 'I have read and accept',
  'gate.enter': 'Enable audio and start',
  'gate.foot': 'Audio needs a tap first — that is a browser rule, not a setting.',

  'tab.speak': 'Speak', 'tab.settings': 'Settings',
  'tab.stats': 'Statistics', 'tab.debug': 'Diagnostics', 'tab.point': 'Point',
  'tab.watch': 'Media', 'tab.dictate': 'Dictate',
  'btn.dictStart': '🎤 Dictate', 'btn.dictStop': '⏹ Stop', 'btn.dictSpeak': '🔊 Speak',
  'btn.copy': 'Copy', 'btn.cut': 'Cut', 'btn.paste': 'Paste', 'btn.openTxt': 'Open file',
  'btn.dictSave': 'Save to my texts', 'btn.dictToBuffer': 'Send to Speak',
  'btn.translate': 'Translate', 'btn.useTranslation': 'Use as text',
  'dict.placeholder': 'Press Dictate and speak, or type here.',
  'dict.translate': 'Translate',
  'dict.translateNote': '⚠️ Translation is the only feature needing an internet connection, and the free service has a daily limit.',
  'dict.translationHere': 'The translation will appear here.',
  'dict.listening': 'listening', 'dict.idle': 'idle',
  'dict.title': 'Document title',
  'btn.dictStopSpeak': '⏹ Stop voice', 'btn.selectAll': 'Select all',
  'btn.dictDownload': 'Download as file',
  'dict.fromFile': 'Transcribe from an audio or video file',
  'dict.fromFileNote': '⚠️ The browser cannot read a file\'s audio directly: the file is played aloud and the microphone listens to it. Loud volume, a quiet room and a working microphone are needed.',
  'btn.loadAudio': 'Load audio or video', 'btn.transcribe': '▶ Transcribe', 'btn.stop': '⏹ Stop',
  'watch.title': 'Media',
  'watch.sub': 'Videos, audio, documents and images. The controls become an entry in the scanning menu: driven by the same gesture used for writing.',
  'watch.favNote': 'The assistant pastes links here. The person picks them by scanning, with no searching or typing.',
  'card.favorites': 'Favourite videos', 'card.viewer': 'Viewer',
  'card.drafts': 'My texts', 'card.library': 'Loaded files',
  'watch.libNote': 'Loaded files stay available in the WATCH menu of the Speak page, for as long as the tab stays open.',
  'drafts.how': 'How it works. You write a little at a time — in the Speak page by scanning, or here with the keyboard. When the text is ready: SAVE. It stays here as long as needed. To have it spoken when the right person arrives: choose MY TEXTS in the scanning menu, then the text, then SPEAK THIS. Re-reading erases nothing, and work in progress saves itself.',
  'btn.saveDraft': 'Save the text being composed',
  'btn.saveDraft2': 'Save text', 'btn.clear': 'Clear',
  'pt.keyboard': 'Keyboard', 'pt.texts': 'My texts', 'pt.media': 'Media', 'pt.arm': 'Arm',
  'btn.exportDrafts': 'Export all', 'btn.importDrafts': 'Import',
  'sec.drafts': 'Long texts',
  'btn.openDoc': 'Load files', 'btn.openImg': 'Load images', 'btn.openFolder': 'Load folder',
  'btn.saveText': 'Save what I wrote', 'btn.recenter': 'Recentre',
  'ph.favTitle': 'Title', 'ph.favUrl': 'YouTube link',
  'media.empty': 'Pick a favourite video, or open a document or some images.',
  'sec.media': 'Content',
  'point.title': 'Point',
  'point.sub': 'Gaze pointer for people with two-axis control, or scanning stripes for people with a single gesture.',
  'point.kbNote': 'Every key is a target: it works with gaze, with stripes, with a finger and with a mouse. The text goes into the same buffer as scanning.',
  'point.armWarn': 'A robotic arm near someone who cannot move away is a serious risk: you need a physical stop within reach of the assistant, torque limits on the device itself, and long dry runs before use.',
  'card.keyboard': 'Keyboard', 'card.arm': 'Robotic arm',
  'btn.calibrate': 'Calibrate', 'btn.ptrStart': 'Enable pointer',
  'btn.ptrStop': 'Stop pointer', 'btn.stripe': 'Scanning stripes',
  'sec.device': 'External device', 'sec.keyboard': 'Pointing keyboard',
  'cal.look': 'Look at the dot and hold still', 'cal.done': 'Calibration complete',
  'cal.mUp': 'Look UP and hold', 'cal.mDown': 'Look DOWN and hold',
  'cal.mLeft': 'Look LEFT and hold', 'cal.mRight': 'Look RIGHT and hold',
  'cal.rest': 'Back to centre and relax', 'cal.mDone': 'Movements calibrated',

  'btn.start': 'Start', 'btn.pause': 'Pause', 'btn.select': 'Select',
  'btn.undo': 'Undo', 'btn.speak': 'Speak it', 'btn.back': 'Back',
  'btn.camStart': 'Start camera', 'btn.camStop': 'Stop camera',
  'btn.loadVideo': 'Load video', 'btn.export': 'Export profile',
  'btn.import': 'Import profile', 'btn.reset': 'Reset', 'btn.autotune': 'Auto-tune', 'btn.statsExport': 'Export statistics', 'btn.statsMerge': 'Import and merge', 'btn.statsReplace': 'Import and replace',
  'btn.add': 'Add',

  'status.paused': 'Paused', 'status.running': 'Scanning',
  'status.noEye': 'no eye found', 'status.good': 'good signal',
  'status.fair': 'fair signal', 'status.weak': 'weak signal',

  'hint.keyboard': 'Space: select · Backspace: undo · ← : back · Enter: speak · Esc: pause',
  'placeholder.profile': 'Profile name',
  'placeholder.newPhrase': 'Add a phrase they actually use',

  'settings.title': 'Settings',
  'settings.sub': 'Everything tunable lives here, so the Speak page stays clean.',
  'stats.title': 'Statistics',
  'stats.sub': 'Not an info panel: this is the prediction model, visible and editable.',
  'debug.title': 'Diagnostics',
  'vid.loop': 'loop',
  'btn.diagSession': 'Save session statistics', 'btn.diagTotal': 'Save cumulative statistics',
  'btn.diagImport': 'Import diagnostics', 'btn.nuovaSessione': 'New session',
  'btn.diagReset': 'Back to defaults',
  'btn.diagUndo': 'Restore the previous ones', 'diag.always': 'Always measure',
  'btn.diagApply': 'Apply parameters',
  'card.diagStats': 'Eye behaviour',
  'debug.statsNote': 'Measured continuously while you use the program, on every tab. The longer it observes, the more reliable the proposed parameters: auto-tuning lasts twenty-five seconds, this can last hours.',
  'debug.sub': 'What the program is seeing, live. Without this view you tune blind.',

  'card.phrases': 'Most used phrases', 'card.words': 'Most used words',
  'card.letters': 'Letters', 'card.session': 'Session',
  'card.eyeLeft': 'Left eye (theirs)', 'card.eyeRight': 'Right eye (theirs)',
  'card.signal': 'Signal',
  'plot.raw': 'raw',
  'plot.showRaw': 'show raw',
  'plot.active': 'active',
  'plot.off': 'channel off',
  'plot.hint': 'thick = filtered · thin = raw · the gap between them is the nystagmus removed',
  'plot.blinkHint': 'bands at top = eye closed', 'card.counters': 'Counters',
  'card.eventlog': 'Event log',

  'sec.source': 'Video source', 'sec.detection': 'Detection',
  'sec.signal': 'Signal and anti-nystagmus', 'sec.gestures': 'Gesture channels',
  'sec.blink': 'Blink', 'sec.mouse': 'System mouse and always-on-top window',
  'sec.debug': 'Logging and advanced diagnosis',
  'sec.offline': 'Working without internet',
  'sec.radio': 'Online radio', 'sec.email': 'Sending email messages',
  'sec.domotica': 'Home devices and printing',
  'sec.combo': 'Combined channel (sum of several signals)',
  'sec.channels': 'RGB channels of the video stream',
  'sec.face': 'Face channels (mouth, lips, brows)',
  'sec.directions': 'Directions: threshold and gain', 'sec.scan': 'Scanning',
  'sec.groups': 'Letter groups', 'sec.phrases': 'Phrase groups', 'sec.audio': 'Audio', 'sec.voicebank': 'Recorded guidance voices',
  'sec.prediction': 'Prediction', 'sec.pointer': 'Pointer and gaze',
  'sec.ui': 'Interface and language',
};

const DICTS = { it: IT, en: EN };
let current = 'it';

export function setLanguage(lang) {
  current = DICTS[lang] ? lang : 'it';
  // Guardia: il modulo deve poter essere importato anche dai test in
  // Node, dove non esiste il DOM.
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  applyStatic();
}

export function getLanguage() { return current; }

export function t(key, fallback) {
  return DICTS[current][key] ?? DICTS.it[key] ?? fallback ?? key;
}

/** Applica le traduzioni agli elementi marcati nell'HTML. */
export function applyStatic(root) {
  if (typeof document === 'undefined') return;
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n, el.textContent);
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh, el.placeholder);
  });
}

/**
 * Etichette bilingui per le schede impostazioni. Ogni voce è
 * [italiano, inglese] così le due lingue restano allineate riga per
 * riga e non si perde una traduzione senza accorgersene.
 */
export const L = {
  pick: (pair) => current === 'en' ? pair[1] : pair[0],
};
