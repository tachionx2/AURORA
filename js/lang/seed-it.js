/**
 * seed-it.js — Corpus italiano minimo di partenza.
 *
 * Serve solo perché il sistema non sia inutile al primo avvio. Il vero
 * modello è quello personale, che dopo poche settimane lo supera.
 *
 * Le parole scelte non sono le più frequenti dell'italiano scritto in
 * generale, ma quelle del registro che serve qui: bisogni, corpo,
 * persone, assistenza quotidiana.
 *
 * → Sostituire al più presto con l'intervista alla famiglia.
 */

/** Frequenze relative (scala arbitraria coerente). */
export const SEED_WORDS = {
  // Funzionali
  'di': 90, 'e': 88, 'il': 86, 'la': 85, 'che': 84, 'non': 82, 'un': 78,
  'per': 76, 'in': 74, 'una': 72, 'mi': 70, 'con': 68, 'ho': 67, 'si': 66,
  'sono': 65, 'ma': 63, 'come': 62, 'se': 60, 'da': 59, 'più': 58,
  'quando': 52, 'perché': 51, 'anche': 50, 'adesso': 49, 'poi': 47,
  'molto': 46, 'poco': 44, 'tanto': 43, 'ancora': 42, 'sempre': 41,
  'mai': 40, 'oggi': 39, 'domani': 38, 'ieri': 37, 'dopo': 36, 'prima': 35,

  // Bisogni e corpo
  'sì': 95, 'no': 94, 'dolore': 80, 'male': 78, 'sete': 76, 'fame': 75,
  'acqua': 74, 'caldo': 70, 'freddo': 69, 'stanca': 66, 'stanco': 65,
  'testa': 62, 'gamba': 58, 'braccio': 57, 'mano': 60, 'piede': 55,
  'schiena': 60, 'occhi': 58, 'bocca': 56, 'gola': 54, 'stomaco': 52,
  'respiro': 55, 'cuscino': 64, 'letto': 63, 'coperta': 58, 'posizione': 62,
  'girare': 56, 'alzare': 58, 'abbassare': 52, 'muovere': 54, 'toccare': 45,
  'prurito': 50, 'crampo': 46, 'nausea': 44, 'sonno': 52, 'dormire': 55,
  'sveglia': 44, 'riposare': 48, 'bagno': 55, 'lavare': 44, 'pulire': 42,
  'medicina': 56, 'dottore': 54, 'infermiera': 50, 'terapia': 44,

  // Ambiente
  'luce': 60, 'buio': 50, 'finestra': 52, 'porta': 48, 'aria': 50,
  'musica': 52, 'televisione': 50, 'radio': 40, 'telefono': 48,
  'spegnere': 50, 'accendere': 50, 'aprire': 48, 'chiudere': 46,
  'alzare': 50, 'volume': 44, 'canale': 40, 'film': 42, 'libro': 40,

  // Relazione
  'grazie': 78, 'prego': 50, 'scusa': 52, 'aspetta': 66, 'basta': 62,
  'ancora': 60, 'aiuto': 70, 'chiama': 64, 'vieni': 58, 'resta': 54,
  'parlare': 52, 'dire': 56, 'capire': 54, 'sentire': 52, 'vedere': 54,
  'voglio': 72, 'vorrei': 66, 'posso': 60, 'devo': 55, 'bene': 70,
  'meglio': 58, 'peggio': 46, 'contenta': 48, 'triste': 44, 'paura': 46,
  'mamma': 62, 'papà': 60, 'figlio': 52, 'figlia': 52, 'sorella': 48,
  'fratello': 48, 'marito': 50, 'moglie': 50, 'amica': 50, 'amico': 50,
  'casa': 62, 'famiglia': 56, 'insieme': 50, 'solo': 52, 'sola': 52,
  'ti': 68, 'voglio': 72, 'bene': 70, 'amore': 56,
};

/** Bigrammi utili: "parola1 parola2" → peso. */
export const SEED_BIGRAMS = {
  'ho sete': 40, 'ho fame': 38, 'ho dolore': 42, 'ho caldo': 34, 'ho freddo': 34,
  'ho sonno': 30, 'ho paura': 26, 'ho bisogno': 36,
  'mi fa': 34, 'fa male': 40, 'mi gira': 24, 'mi sento': 30,
  'non riesco': 34, 'non voglio': 30, 'non capisco': 24, 'non sento': 22,
  'voglio dormire': 26, 'voglio parlare': 24, 'voglio bene': 40,
  'ti voglio': 42, 'per favore': 40,
  'gira il': 26, 'il cuscino': 32, 'alza il': 26, 'il letto': 34,
  'chiama la': 24, 'chiama il': 24, 'accendi la': 22, 'spegni la': 22,
  'la luce': 34, 'la televisione': 26, 'la musica': 24,
  'sto bene': 30, 'sto male': 30, 'va bene': 34,
  'cambia posizione': 28, 'un momento': 24,
};

/**
 * Il parlato di chi è assistito, in prima persona.
 *
 * Usate SOLO quando i suggerimenti leggono grammatica e significato
 * (`prediction.contestoFrase`): ne sono il contrappeso. Spento quello,
 * i suggerimenti tornano esattamente come prima, anche in questo.
 */
export const SEED_BIGRAMS_PARLATO = {
  /* ── Il parlato di chi è assistito, in prima persona ──
   * Aggiunte quando i suggerimenti hanno cominciato a leggere grammatica
   * e significato dai testi SCRITTI: lì "sono" è quasi sempre "sono
   * stati", "hai" quasi sempre "hai fatto", "per" quasi sempre "per
   * fare". Queste coppie ricordano il registro di Daniela, che parla di
   * sé, dei propri bisogni e a chi le sta accanto. */
  'sono stanca': 30, 'sono stanco': 28, 'sono contenta': 26, 'sono contento': 24,
  'sono triste': 24, 'sono felice': 22, 'sono arrabbiata': 22, 'sono preoccupata': 20,
  'sono qui': 20, 'sono pronta': 20, 'sono sveglia': 20, 'sono scomoda': 22,
  'sei stanco': 20, 'sei stanca': 20, 'sei bravo': 20, 'sei brava': 20, 'sei gentile': 22,
  'hai ragione': 28, 'hai capito': 24, 'hai mangiato': 22, 'hai fatto': 22, 'hai sentito': 20,
  'ho capito': 28, 'ho finito': 26, 'ho sbagliato': 24, 'ho dormito': 24, 'ho mangiato': 22,
  'ho voglia': 26, 'ho la': 20, 'ho mal': 26, 'mal di': 30,
  'lasciami sola': 24, 'lasciami stare': 26, 'lasciami dormire': 22,
  'parla piano': 22, 'più piano': 26, 'più forte': 26, 'più tardi': 24, 'più vicino': 22,
  'mi giri': 30, 'mi alzi': 26, 'mi metti': 26, 'mi dai': 28, 'mi porti': 26, 'mi aiuti': 26,
  'mi manca': 24, 'mi manchi': 24, 'mi piace': 30, 'mi prude': 22, 'mi brucia': 22,
  'mi serve': 26, 'mi scappa': 22, 'mi chiami': 24, 'mi leggi': 22, 'mi senti': 22,
  'puoi chiamare': 24, 'puoi aprire': 22, 'puoi chiudere': 22, 'puoi darmi': 26,
  'puoi aiutarmi': 26, 'puoi venire': 22, 'puoi spegnere': 22, 'puoi accendere': 22,
  'vorrei bere': 26, 'vorrei mangiare': 26, 'vorrei dormire': 26, 'vorrei riposare': 24,
  'vorrei vedere': 24, 'vorrei uscire': 22, 'vorrei parlare': 24, 'vorrei andare': 24,
  'voglio andare': 24, 'voglio vedere': 24, 'voglio uscire': 20, 'voglio stare': 20,
  'non ho': 28, 'non so': 28, 'non posso': 26, 'non mi': 26, 'non è': 24, 'non lo': 24,
  'non ce': 20, 'non vedo': 22, 'non respiro': 24, 'non preoccuparti': 24,
  'grazie mille': 26, 'grazie di': 22, 'ti amo': 30, 'ti prego': 24, 'ti ringrazio': 22,
  'come stai': 30, 'come va': 26, 'che ore': 26, 'che cosa': 26, 'che fai': 22,
  'a casa': 26, 'a letto': 26, 'in bagno': 28, 'in giardino': 20, 'al bagno': 22,
  'buona notte': 24, 'buona giornata': 22, 'buon appetito': 24, 'buon compleanno': 26,
  'un bacio': 26, 'un abbraccio': 24, 'un po': 30, 'un bicchiere': 26, 'di acqua': 24,
  'la mano': 24, 'la testa': 30, 'la schiena': 26, 'la pancia': 24, 'la gamba': 22,
  'il braccio': 22, 'il piede': 22, 'il dottore': 26, 'il telefono': 24, 'il medico': 24,
  'le gambe': 24, 'le braccia': 22, 'gli occhi': 26, 'le medicine': 24, 'la coperta': 24,
};

/** Frequenze delle lettere nell'italiano scritto (%). */
export const LETTER_FREQ_IT = {
  'E': 11.8, 'A': 11.7, 'I': 11.3, 'O': 9.8, 'N': 6.9, 'L': 6.5, 'R': 6.4,
  'T': 5.6, 'S': 5.0, 'C': 4.5, 'D': 3.7, 'P': 3.1, 'U': 3.0, 'M': 2.5,
  'V': 2.1, 'G': 1.6, 'H': 1.5, 'F': 1.2, 'B': 0.9, 'Q': 0.5, 'Z': 0.5,
  'J': 0.05, 'K': 0.05, 'W': 0.03, 'X': 0.03, 'Y': 0.03,
};

/**
 * Lessico italiano d'uso quotidiano, orientato alla comunicazione
 * assistita: corpo, bisogni, persone, tempo, sentimenti, azioni.
 *
 * Serve all'AUTOCORREZIONE, che senza un vocabolario ampio non può
 * funzionare: con poche decine di parole quasi tutto risulterebbe
 * sconosciuto e non correggibile. Le frequenze non sono qui — le
 * fornisce SEED_WORDS per le parole comuni e il lessico personale per
 * tutto il resto: questo elenco dice soltanto *quali parole esistono*.
 */
export const VOCABOLARIO_IT = [
  'a', 'abbastanza', 'abbiamo', 'accendere', 'accendi', 'acqua', 'adesso', 'aiutami',
  'aiuto', 'allora', 'alto', 'alza', 'alzare', 'alzarmi', 'alzato', 'alzi',
  'alzo', 'amica', 'amici', 'amico', 'anche', 'ancora', 'andare', 'andate',
  'andato', 'andiamo', 'anno', 'antidolorifico', 'apre', 'apri', 'aprire', 'arrabbiato',
  'arrivederci', 'aspetta', 'avanti', 'avete', 'bagno', 'basso', 'bello', 'bene',
  'bere', 'beve', 'bevi', 'bevo', 'bevuto', 'bocca', 'braccia', 'braccio',
  'brutto', 'buio', 'buonanotte', 'buonasera', 'buongiorno', 'buono', 'caffè', 'caldo',
  'camera', 'casa', 'cattivo', 'certo', 'che', 'chi', 'chiama', 'chiamami',
  'chiamare', 'chiamato', 'chiami', 'chiamo', 'chiude', 'chiudere', 'chiudi', 'ci',
  'ciao', 'collo', 'come', 'computer', 'con', 'contenta', 'contento', 'coperta',
  'corto', 'cosa', 'crampo', 'cucina', 'cugina', 'cugino', 'cuore', 'cuscino',
  'da', 'davvero', 'dei', 'del', 'della', 'delle', 'dentro', 'destra',
  'detto', 'deve', 'devi', 'devo', 'devono', 'di', 'dice', 'dici',
  'diciamo', 'dico', 'dicono', 'dire', 'dita', 'dite', 'dito', 'dobbiamo',
  'dolore', 'domani', 'dopo', 'dorme', 'dormi', 'dormire', 'dormito', 'dormo',
  'dottore', 'dottoressa', 'dove', 'dovete', 'dovrei', 'fa', 'faccia', 'facciamo',
  'faccio', 'fai', 'fame', 'famiglia', 'fanno', 'fare', 'fastidio', 'fate',
  'fatto', 'favore', 'felice', 'fiato', 'figlia', 'figlio', 'film', 'finestra',
  'fisioterapista', 'forse', 'fra', 'fratello', 'freddo', 'frutta', 'fuori', 'gamba',
  'gambe', 'gente', 'giardino', 'giornale', 'giorni', 'giorno', 'gira', 'girami',
  'girare', 'girato', 'giro', 'già', 'gli', 'grande', 'grazie', 'guarda',
  'guardare', 'guardato', 'guardi', 'guardo', 'ha', 'hai', 'hanno', 'ho',
  'i', 'ieri', 'il', 'in', 'indietro', 'infermiera', 'infermiere', 'io',
  'la', 'latte', 'le', 'lei', 'lenzuolo', 'letto', 'libro', 'lo',
  'lontano', 'loro', 'luce', 'lui', 'lungo', 'là', 'ma', 'madre',
  'mai', 'male', 'mamma', 'mangi', 'mangia', 'mangiare', 'mangiato', 'mangio',
  'mani', 'mano', 'marito', 'materasso', 'mattina', 'me', 'medicina', 'medicine',
  'medico', 'meglio', 'meno', 'mese', 'messo', 'mette', 'mettere', 'metti',
  'metto', 'mia', 'mie', 'miei', 'mille', 'minestra', 'minuti', 'minuto',
  'mio', 'moglie', 'molto', 'muovere', 'muovi', 'musica', 'naso', 'ne',
  'neve', 'nipote', 'no', 'noi', 'non', 'nonna', 'nonno', 'nostra',
  'nostro', 'notte', 'nuovo', 'nuvola', 'occhi', 'occhio', 'oggi', 'ora',
  'ore', 'orecchie', 'orecchio', 'padre', 'pancia', 'pane', 'papà', 'parla',
  'parlare', 'parlato', 'parli', 'parlo', 'pasta', 'pastiglia', 'peggio', 'per',
  'perché', 'persona', 'persone', 'però', 'petto', 'piccolo', 'piede', 'piedi',
  'pioggia', 'più', 'poco', 'poi', 'pomeriggio', 'porta', 'portare', 'portato',
  'porti', 'porto', 'possiamo', 'posso', 'possono', 'potete', 'potrei', 'prego',
  'prende', 'prendere', 'prendi', 'prendo', 'preoccupato', 'preso', 'prima', 'prurito',
  'puoi', 'può', 'quale', 'quando', 'quanto', 'quasi', 'quella', 'quelle',
  'quelli', 'quello', 'questa', 'queste', 'questi', 'questo', 'qui', 'quindi',
  'radio', 'respirare', 'respiro', 'schermo', 'schiena', 'scusa', 'scusami', 'se',
  'sedia', 'sei', 'sempre', 'sente', 'senti', 'sentiamo', 'sentire', 'sentite',
  'sentito', 'sento', 'sentono', 'sera', 'sete', 'settimana', 'si', 'siamo',
  'siete', 'sinistra', 'sole', 'sonno', 'sono', 'sopra', 'sorella', 'sotto',
  'spalla', 'spalle', 'spegnere', 'spegni', 'spesso', 'sposta', 'spostami', 'spostare',
  'sta', 'stai', 'stanca', 'stanchezza', 'stanco', 'stanno', 'stare', 'state',
  'stato', 'stiamo', 'sto', 'stomaco', 'strada', 'su', 'sua', 'subito',
  'succo', 'suo', 'sì', 'tablet', 'tanto', 'tastiera', 'te', 'telefono',
  'televisione', 'terapia', 'testa', 'tra', 'tranquillo', 'triste', 'troppo', 'tu',
  'tua', 'tue', 'tuo', 'tuoi', 'tè', 'un', 'una', 'uno',
  'va', 'vado', 'vai', 'vanno', 'vecchio', 'vede', 'vedere', 'vedete',
  'vedi', 'vediamo', 'vedo', 'vedono', 'vengo', 'vengono', 'veniamo', 'venire',
  'venite', 'vento', 'venuto', 'veramente', 'vi', 'vicino', 'viene', 'vieni',
  'viso', 'visto', 'vogliamo', 'voglio', 'vogliono', 'voi', 'volete', 'vorrei',
  'vuoi', 'vuole', 'zia', 'zio', 'è',
];


/**
 * Frequenze d'uso approssimative dell'italiano, in tre fasce.
 *
 * ⚠️ Servono all'AUTOCORREZIONE, e senza di esse non può funzionare:
 * con quasi tutto il vocabolario a frequenza zero, fra due candidati
 * ugualmente vicini non c'è modo di scegliere, e il correttore —
 * giustamente — rinuncia. È esattamente il motivo per cui `sno` non
 * diventava `sono`.
 *
 * I valori non pretendono precisione statistica: servono a ORDINARE i
 * candidati, e per quello tre fasce ben separate bastano. Le parole
 * fuori da queste liste ricevono comunque una frequenza minima, perché
 * "rara" non vuol dire "inesistente".
 */
export const FREQ_FASCIA = (() => {
  /* Le parole più frequenti dell'italiano, in ordine DECRESCENTE.
   *
   * ⚠️ È l'ordine a contare, non i valori assoluti: serve a rompere i
   * pareggi fra candidati ugualmente vicini. Con frequenze piatte
   * `sno` aveva quattro candidati a pari merito — `sono`, `suo`,
   * `sto`, `uno` — e il correttore rinunciava, giustamente: scegliere
   * sarebbe stato tirare una monetina.
   *
   * L'elenco è pesato anche sull'uso PARLATO e sulla comunicazione
   * assistita: `sì`, `no`, `grazie`, `dolore`, `aiuto` sono molto più
   * frequenti qui che in un corpus di giornali. */
  const ordine = [
    'di', 'e', 'il', 'che', 'la', 'a', 'un', 'in',
    'per', 'è', 'non', 'una', 'mi', 'si', 'sono', 'ho',
    'ma', 'con', 'come', 'lo', 'le', 'i', 'gli', 'da',
    'su', 'del', 'al', 'più', 'anche', 'se', 'ci', 'quando',
    'cosa', 'dove', 'chi', 'tutto', 'solo', 'ora', 'bene', 'sì',
    'no', 'grazie', 'me', 'ti', 'ne', 'suo', 'mio', 'già',
    'lei', 'lui', 'questo', 'quello', 'essere', 'fare', 'molto', 'poi',
    'però', 'perché', 'niente', 'sempre', 'mai', 'cui', 'loro', 'noi',
    'voi', 'tu', 'io', 'quella', 'questa', 'sua', 'nostro', 'dopo',
    'prima', 'adesso', 'oggi', 'domani', 'ieri', 'qui', 'là', 'così',
    'tanto', 'poco', 'meno', 'posso', 'voglio', 'devo', 'faccio', 'dico',
    'vedo', 'sento', 'vado', 'vengo', 'sto', 'do', 'sai', 'puoi',
    'vuoi', 'casa', 'tempo', 'giorno', 'anno', 'volta', 'uomo', 'donna',
    'vita', 'mano', 'occhio', 'testa', 'parte', 'notte', 'sera', 'mattina',
    'acqua', 'padre', 'madre', 'figlio', 'amico', 'bambino', 'persona', 'cuore',
    'mondo', 'grande', 'piccolo', 'nuovo', 'bello', 'buono', 'male', 'dolore',
    'fame', 'sete', 'caldo', 'freddo', 'sonno', 'letto', 'porta', 'luce',
    'aiuto', 'scusa', 'prego', 'ciao', 'aspetta', 'subito', 'piano', 'forte',
    'stanco', 'felice', 'triste', 'medico', 'dottore', 'infermiere', 'famiglia', 'fratello',
    'sorella', 'mamma', 'papà', 'nonna', 'nonno', 'marito', 'moglie',
  ];
  const out = {};
  // Decrescenza dolce: le prime restano molto sopra le ultime, ma
  // nessuna scende a zero — "rara" non vuol dire "inesistente".
  ordine.forEach((w, i) => { out[w] = Math.round(100 * Math.pow(1 - i / (ordine.length + 60), 2)); });
  return out;
})();

/** Frequenza di base per una parola del vocabolario non in elenco. */
export const FREQ_BASE = 8;
