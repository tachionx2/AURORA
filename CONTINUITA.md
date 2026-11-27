# Aurora — documento di continuità

Da leggere **prima di toccare qualunque cosa**, se si riprende il lavoro
in una conversazione nuova.

Versione di riferimento: **v 20260908-1715** · configurazione 38 ·
1797 verifiche automatiche, tutte verdi.

---

## ⚠️ LA COSA PIÙ IMPORTANTE

Per giorni il programma ha avuto un difetto che lo rendeva inservibile:
**l'ampiezza dei gesti calava nel tempo** fino a scendere sotto la
soglia, pur restando il movimento fisico identico. È stato risolto.

**Quel codice non va toccato.** Se una modifica futura sfiora le aree
elencate qui sotto, va detto a Francesco *prima* di farla, e la
decisione si prende insieme.

### Il difetto, per capirlo

La stima del rumore escludeva i campioni dei gesti **riconosciuti**.
Ma il riconoscimento confronta il segnale con una soglia espressa in
multipli del rumore stimato. Quindi la regola era:

> escludi i campioni in base a una soglia che dipende da ciò che sto
> stimando

Un anello chiuso. Bastava un transitorio — una pausa del video, un
ammiccamento anomalo — perché un occhio scendesse sotto soglia una
volta sola. Da lì: non si aggancia → non viene escluso → il rumore
stimato cresce → si aggancia ancora meno. **Nessuna via di ritorno.**

Misurato su dati reali: rumore stimato da 0,004 a 0,124, cioè fino a
valere quanto il gesto stesso; ampiezza da 12σ a 0,7σ.

### La soluzione

L'esclusione si basa sul **movimento**, non sul riconoscimento:
l'escursione grezza, misurata per percentili sul segnale crudo, non
dipende né dalla baseline né dalla stima del rumore. L'anello è rotto
alla radice.

---

## CODICE DA NON TOCCARE

### `js/signal/GestureEngine.js`

| cosa | perché non toccarla |
|---|---|
| `A.rumoreVeloce` (differenze fra fotogrammi consecutivi) | riferimento di rumore **immune ai gesti**. ⚠️ Non usarlo mai come sigma: non vede il tremore lento e produce 41 comandi involontari al minuto. Serve solo a dare la scala. |
| `A.escursioneGrezza` (97° percentile degli scarti dalla mediana, 10 s) | il metro che non dipende da nulla. È ciò che rompe l'anello. |
| `A.riposoStimato` (moda del segnale) | usato **solo** per giudicare la quiete. ⚠️ Non usarlo per riancorare la baseline: distrugge le tenute lunghe (misurato, da 10,5σ a 0,4σ). |
| Il blocco `congelaScala(dentroGesto)` prima di `A.base.push` | esclude i campioni del gesto **senza dipendere dal riconoscimento**. È la correzione decisiva. |
| Il tetto `pav = max(minSigma, escursione / plafondSigma)` | accorcia il transitorio senza penalizzare i gesti piccoli. |
| `_congelaAsse` — **nessuna propagazione fra occhi** | legare i due occhi faceva collassare il debole insieme al forte, allo stesso istante e allo stesso valore. |
| `_sig(eye)` — parametri per occhio, **soglie escluse** | le soglie devono significare la stessa cosa per entrambi. Anche scrivendole per occhio vengono ignorate di proposito. |

### `js/signal/filters.js`

| cosa | perché non toccarla |
|---|---|
| `perc = 0.25` e `ritaratura = 1.577` in `RobustScale` | **sono una coppia**. Il 25° percentile regge fino al 75% di tempo in movimento; il fattore 1,577 è il rapporto misurato fra 25° e 40° percentile su rumore pulito, e lo riporta nella scala giusta. Cambiarne uno solo sballa la stima. |
| Azzeramento della finestra dopo un buco > 1000 ms | dopo una pausa del video la finestra si svuotava e la stima si ricalcolava su pochi campioni, tutti di gesto. Erano i **salti** visibili nei registri reali. |
| `buf.length < 60` (non 10) | dieci campioni sono un terzo di secondo: se cadono dentro un gesto, la stima prende il gesto per rumore. |
| Distinzione ammiccamento / sguardo alzato per **velocità** | un ammiccamento percorre la corsa in due o tre fotogrammi, stringere gli occhi impiega dieci volte tanto. ⚠️ Un criterio basato sul tempo crea un ammiccamento fantasma all'inizio di ogni gesto. |
| `configure` che ignora i parametri `undefined` | assegnarli comunque trasformava la soglia in NaN e l'occhio non risultava mai chiuso. |

### `js/signal/SessionStats.js`

| cosa | perché non toccarla |
|---|---|
| Soglie calcolate sull'occhio **peggiore** | calcolarle sul migliore le metteva dove l'altro non arriva, e faceva ripartire l'anello. |
| Tutto misurato sul segnale **grezzo** | misurare sul segnale già normalizzato rende la diagnosi non idempotente: applicandola due volte dà valori diversi. |
| `sigmaPercentile` proposto **mai sopra 0,25** | proporre 0,40 faceva crollare entrambi gli occhi. Un consiglio non deve mai peggiorare la configurazione di partenza. |
| Guadagno che porta il gesto a **3× la soglia** | sotto soglia il gesto non viene riconosciuto, quindi non escluso: il guadagno è l'uscita dal circolo. |
| Proposta **cumulativa** (`_propostaCum`) | i parametri non devono sparire osservando più a lungo. |

### `js/vision/RgbTracker.js`

| cosa | perché non toccarla |
|---|---|
| Apertura misurata su **tre coppie** di punti palpebrali | con una coppia sola l'apertura cambiava di 5 millesimi mentre l'occhio si spalancava visibilmente. |
| `nuovaSessione()` che azzera `stato[lato]` | il riferimento del raggio dell'iride sopravviveva a tutto, ed è il motivo per cui un programma appena aperto si comportava diversamente da uno già in uso. |

---

## STRADE GIÀ PROVATE E SCARTATE

Non ritentarle senza una ragione nuova: sono documentate nel codice con
i numeri misurati.

**Stimare il rumore dalle differenze passo-passo.** Sulla carta
perfetto: contaminazione dal 280% al 2%. Nella prova completa **41
comandi involontari al minuto**, perché non vede il tremore lento.

**Abbassare il percentile senza ritararlo.** 13 falsi comandi al
minuto.

**Congelare la baseline quando il segnale supera una soglia in sigma.**
Se sigma è gonfiato la soglia si gonfia con lui: non scatta mai.
In condizioni reali **−76% di ampiezza**.

**Quiete assoluta come meccanismo separato** (`quieteAssoluta`, oggi
spenta). Entra in conflitto con il congelamento dell'aggancio: i due si
scongelano a vicenda. Misurato: sigma da 0,0076 a 0,1592.

**Riancorare la baseline al riposo stimato.** Distrugge le tenute
lunghe: 27 verifiche cadute in un colpo.

**Correzione dell'iride coperta per schiacciamento** (oggi spenta).
Il modello restituisce sempre un cerchio completo: quella misura
descrive ciò che ha dedotto, non ciò che vede. Su volti veri non
discrimina — 0,85 a riposo e 0,90 a sguardo alzato.

---

## COME LAVORARE IN SICUREZZA

### 1. Provare sullo scenario reale, non su segnali puliti

⚠️ **È l'errore che ha fatto perdere giorni.** Le prove con quiete
iniziale e gesti radi approvavano correzioni che nella realtà
peggioravano le cose.

Lo scenario che boccia le correzioni sbagliate:

```js
// gesto 0,15-0,17 · rumore 0,006-0,015 · NESSUNA quiete iniziale
// gesti dal primo istante, pause del video, occhio destro più debole
const R = (x) => 0.006 * Math.sin(2 * Math.PI * 4.2 * x / 1000)
               + 0.008 * Math.sin(2 * Math.PI * 0.35 * x / 1000);
// 70-80 gesti, con `t += 82000` a metà per simulare una pausa
```

Va sempre misurato: **ampiezza al gesto 3, 20, 45 e 80**, più `sigma` e
`baseline`. Se l'ampiezza cala fra il primo e l'ultimo, la correzione è
sbagliata comunque, anche se tutte le verifiche passano.

### 2. Misurare sempre anche i falsi comandi

Ogni modifica al segnale va provata anche su **solo rumore**, senza
gesti. Il valore di riferimento è **0,17 comandi al minuto**. Se sale,
la modifica va scartata: un programma che scrive lettere da solo è
peggio di uno che ne scrive poche.

### 3. Eseguire tutte le suite

```
sh test/tutti.sh
```

Undici suite, 1797 verifiche. `diagnostica.mjs` da sola richiede
diversi minuti: va lanciata in sottofondo con un `timeout` generoso.

### 4. Se un test cade, non allentarlo per far passare la modifica

Ogni verifica documenta un difetto già accaduto. Se cade, o la modifica
è sbagliata o il test misurava la cosa sbagliata — e nel secondo caso
va spiegato **perché** nel commento, non solo cambiato il numero.

### 5. Verificare che i comandi siano RAGGIUNGIBILI

Tre volte in questo progetto è successo che il codice fosse corretto ma
mai raggiungibile: un pulsante mai aggiunto alla pagina, un elenco
duplicato aggiornato a metà, un `import` mancante che faceva fallire in
silenzio il ripristino dei parametri.

Non basta verificare che una funzione esista: va verificato che **un
comando la invochi** e che **abbia effetto**.

---

## STRUMENTI DI DIAGNOSI

**Registro in console** — interruttore in Diagnostica, accanto ai
comandi. Scrive ogni due secondi tutti i valori, e a ogni pulsante
premuto scrive i parametri applicati, **separatamente per occhio**.

**Contatori in Diagnostica** — i due che contano di più:

- `Escursione grezza SX / DX` — quanto il segnale si muove **davvero**.
  Se resta costante mentre l'ampiezza in sigma cala, il movimento è
  identico e il problema è nella stima. Se cala anche lei, è il
  rilevamento.
- `Sigma SX / DX` — se cresce mentre l'escursione è ferma, l'anello si
  sta richiudendo.

**Modalità grezza** — *Segnale e antinistagmo*, in cima. Niente
baseline, niente normalizzazione. Se in modalità grezza il segnale è
stabile e in modalità normale cala, il problema è nell'adattamento e
non nel rilevamento. È una prova diagnostica, prima che un modo d'uso.

---

## OPZIONI SPERIMENTALI, SPENTE DI PROPOSITO

| opzione | stato | nota |
|---|---|---|
| `signal.sogliaRelativa` | spenta | Rende l'ampiezza costante per costruzione e pareggia i due occhi da sola. Cambia il significato delle soglie. Promettente. |
| `signal.modoGrezzo` | spenta | Nessun adattamento. Rete di sicurezza e strumento di diagnosi. |
| `signal.quieteAssoluta` | spenta | ⚠️ Provata due volte, peggiora drasticamente. Non riaccendere. |
| `detection.irisOcclusionFix` | spenta | La metrica di copertura cambia troppo poco per essere utile. |

---

## DECISIONE PONDERATA: LA PASSWORD DI POSTA NELLA CONFIGURAZIONE

Fino alla versione `20260917-1904` la regola era assoluta: **nessuna
credenziale di posta nella configurazione**, perché è leggibile con gli
strumenti di sviluppo del browser. Dalla `20260918-1130` la regola è
cambiata **di proposito**, e chi trova qui una password non sta
guardando una svista.

**Perché.** Un browser non può parlare SMTP — mai, per regola del web —
quindi serve comunque un servizio di appoggio. Ma con le credenziali
fra le variabili d'ambiente di Netlify, *una* installazione serve *una*
casella: ogni famiglia avrebbe bisogno di un proprio sito, e di
qualcuno che lo configuri. Con le credenziali nella configurazione
locale, **una sola Aurora pubblica serve tutti**, ognuno con la propria
casella, e nessuno deve toccare Netlify.

**Il prezzo, che resta vero.** La password è leggibile sul computer di
chi la scrive e finisce dentro il file di configurazione esportato.
Quel file vale la casella di posta.

**Le condizioni che rendono la scelta accettabile** — verificate dai
test, non da una promessa:

1. `email.smtpPass` nasce **vuota**: chi usa le variabili d'ambiente non
   si accorge del cambiamento (`33q`, integrità).
2. Vuota, **non viene trasmessa affatto**: il servizio ricade sulle
   proprie variabili, comportamento identico a prima (`33v`).
3. Le credenziali partono **solo verso l'indirizzo configurato** (`33x`).
4. Il servizio accetta credenziali **solo da pagine del proprio sito**,
   confrontando `Origin` con l'host della richiesta — senza dipendere da
   variabili da impostare a mano, altrimenti un sito non configurato
   smetterebbe di spedire senza che si capisca perché.
5. Chi esporta un profilo **viene avvisato** di cosa contiene
   (`segretiInConfig`, avviso fisso accanto al pulsante).

⚠️ **Non rimuovere nessuna delle cinque.** Sono ciò che separa questa
scelta da una fuga di credenziali. In particolare il punto 4: senza,
il servizio diventa un ponte anonimo per spedire posta.

Le due strade convivono. `netlify/functions/invia-email.js` usa le
credenziali della richiesta se complete, altrimenti le variabili
d'ambiente. Difese facoltative: `MAIL_ALLOWED` (destinatari ammessi),
`MAIL_CHIAVE` (parola condivisa), `MAIL_ORIGINI` (altre provenienze).

---

## CHI È DANIELA, E PERCHÉ CONTA

Sindrome locked-in. Un solo movimento volontario: l'occhio **sinistro**
verso l'alto. L'occhio **destro** sta abitualmente **semichiuso** per
fotosensibilità — ed è la ragione di metà dei problemi affrontati:
apertura più bassa, iride più coperta, ammiccamenti scambiati per gesti.

**Ogni decisione va pesata su di lei**, non sul caso medio. Un
programma che funziona per la maggior parte delle persone ma non per
chi ha un occhio socchiuso è un programma che non funziona.

E vale la regola generale del progetto: **non regredire**. Meglio non
aggiungere una funzione che rischiare quella che già funziona.

---

## SUGGERIMENTI DI PAROLA (dalla versione `20261014`)

`Predictor.suggerisci()` guarda l'intera frase: frequenza dell'italiano,
lessico personale, una e due parole precedenti, argomento della frase
(compresenze), continuazione di frasi già dette o preparate dalla
famiglia. La `quota` è misurata fra le **prime cinque** candidate, non su
tutto il dizionario: sommando su tutto, anche una parola ovvia stava al 6%.

La scelta fra proposta a voce e gruppo "Suggerimenti" sta in **una sola**
funzione, `scegliSuggerimenti()`, usata dal programma e dai test. Non
duplicarla.

**Mai suggerimenti dopo uno spazio**: riguardano la parola in corso.
Deciso con l'utente, non è una dimenticanza.

**Proposta a voce** (`scan.suggerimentiDiretti`): NON è una voce
dell'albero. È `ScanEngine.proposta`, restituita da `currentNode` per un
passo dopo ogni lettera, detta a voce e mostrata in corsivo nella barra
(`_mostraParolaInCorso`). Scaduto il passo si prosegue dal punto di
ripartenza (Suggerimenti se ci sono, altrimenti gruppo 1).

**Ripartenze dentro Scrivi** (decise sul campo il 14/10, seconda
correzione dell'utente; test sezioni 71 e 72):
- lettera scelta o ESCI da un gruppo di lettere → **Suggerimenti** se
  ci sono (gruppo `hot`), altrimenti gruppo 1;
- ESCI da Suggerimenti → di nuovo **Suggerimenti**;
- parola scelta (da Suggerimenti o dalla proposta a voce) → **AZIONI**,
  come dopo uno spazio;
- azione o ESCI da AZIONI → AZIONI; spazio → AZIONI.
`rebuild()` conserva la posizione per VOCE, non per numero.

**LEGGI non insegna** (`rilettura: true`): rileggere una frase a metà la
insegnava come frase detta. ⚠️ NON usare `keep` per questo: lo usano
anche le frasi rapide di PUNTA, che vanno imparate.

### Suggerimenti che capiscono la frase (dal 14/10, `prediction.contestoFrase`)

Tre fonti in più in `suggerisci()`, dopo le sette di sempre (che NON sono
cambiate di una virgola):
- **8. significato** (`Senso.js` + `semantica-it.js`): affinità di ogni
  candidata con le parole piene della frase, pesate per vicinanza e per
  quanto sono NOMI ("chiesa" porta l'argomento, "andata" no). Conta lo
  scarto rispetto alle RIVALI (stesse lettere), non il valore assoluto;
  spinta extra per i legami netti (oltre 3 scarti).
- **9. grammatica** (`Grammatica.js` + `grammatica-it.js`): categoria
  attesa dopo le due parole precedenti. ASIMMETRICA: penalizza fino a
  e⁻³ ciò che è impossibile ("in basta"), favorisce al massimo e^1,5 ciò
  che è tipico. Si ASTIENE dopo "la/lo/le/gli/l'", che sono anche
  pronomi ("la voglio"): lì decide l'accordo (fonte 7).
- **10. coppie** (`Coppie.js` + `coppie-it.js`): espressioni dell'italiano
  reale ("mal di testa"), solo legami POSITIVI.

⚠️ Tre regole imparate misurando, da NON rompere:
1. Le tre fonti danno PUNTI DI FREQUENZA che si SOMMANO e si applicano una
   volta sola. La frequenza è logaritmica ("per" 90, "petto" 29, ma diecimila
   volte più frequente): moltiplicare, o applicare le fonti una sopra
   l'altra, faceva proporre "cornea" per "coperta".
2. I punti toccano SOLO la parte generica del punteggio (la frequenza).
   Lessico e frasi di Daniela e coppie di assistenza restano intatti:
   altrimenti l'italiano scritto travolgeva "per favore", "sono stanca".
3. Le coppie del parlato (`SEED_BIGRAMS_PARLATO`, "sono stanca", "hai
   ragione") sono il contrappeso dei testi scritti e valgono SOLO con
   `contestoFrase` acceso.

4. **Singolare prima del plurale** (fonte 11, test sezione 76): un
   nome, aggettivo o participio plurale scende se il suo singolare è fra
   le candidate, a meno che le ultime tre parole contengano un segno di
   plurale (i, le, dei, questi, tanti, due, noi, siamo…). I verbi
   coniugati sono esclusi ("sono" non è il plurale di nulla, "auguro" non
   è il singolare di "auguri").
5. Per grammatica ed espressioni **"sono" si legge "è"**: nei testi
   scritti è "loro sono", per Daniela "io sono". Era la causa di "sono
   andat…" → "andate, andati". Costa 1-3 decimi sui testi giornalistici,
   guadagna sul parlato: scelta voluta.

Spento `contestoFrase`, i suggerimenti sono IDENTICI alla versione
precedente (verificato su 30.029 suggerimenti, con lessico personale).
I dati si caricano a riposo 4 s dopo l'avvio (`main.js`), in modo
asincrono e senza rete; finché non ci sono, o se il caricamento fallisce,
i suggerimenti sono quelli di prima. Memoria: circa 21 MB (niente indici:
ricerche binarie su testo ordinato). Circa 2 ms a suggerimento.

Fonti, licenze e lo script che rigenera i tre file (identici byte per
byte): `strumenti/suggerimenti/`. Test: `percorsi` sezione 75.
⚠️ `test/percorsi.mjs` aspetta il caricamento all'inizio: senza, i test
girerebbero a volte prima e a volte dopo, con risultati diversi.

**Limite noto**: "sono andata in chiesa a pr…" propone *prendere* e mette
*pregare* terzo, nel gruppo. I vettori non distinguono abbastanza
"pregare" da "preghiera" e "predicare". Dopo che Daniela l'avrà usata una
volta, il suo lessico la porta in cima.

### ⚠️ Licenze dei dati linguistici

`semantica-it.js` e `coppie-it.js` derivano da dati in pubblico dominio
(CC0). `grammatica-it.js` è sotto **CC BY-SA 4.0** (treebank UD), come
opera separata, al pari del vocabolario qui sotto.

### ⚠️ Licenza del vocabolario

`js/lang/vocabolario-it.js` deriva dai dati di `wordfreq`, distribuiti
sotto **CC BY-SA 4.0**. Quel file è quindi sotto CC BY-SA 4.0, NON sotto
la licenza di Aurora, ed è incluso come opera separata. L'intestazione
del file lo dichiara. Se un giorno si volesse un vocabolario sotto la
stessa licenza di Aurora, va sostituito con dati di altra provenienza
rigenerando il file (lo script è descritto nell'intestazione).

L'**autocorrezione** NON usa questo vocabolario: ha il proprio
(`lessicoPerCorrezione`), tarato a parte.

---

## COSA RESTA APERTO

- **Modalità infrarossa** e canale rosso del sensore RGB: da provare.
- **Iride coperta dalla palpebra**: la croce del centro resta bassa a
  sguardo molto alzato. La strada geometrica è chiusa (il modello
  deduce il cerchio invece di vederlo); servirebbe l'analisi dei pixel,
  già presente in `IrTracker.js` per l'infrarosso.
- **Puntatore a due bande** per il controllo del mouse con un solo
  gesto, e **assistente conversazionale** fra i media: discussi, non
  ancora progettati.
- **Piattaforma utenti**: informativa privacy e registro dei
  trattamenti da scrivere, revisione legale prima di aprire le
  registrazioni.


---

## MENU SCRIVI, RIPETI, PUNTO, CORREZIONE (versione `20261113`)

Richieste dal campo, novembre 2026. Test: `percorsi` sezioni 77 e 78,
`applicazione` ("ripeti: …").

**AZIONI: PARLA, RIPETI, LEGGI, SALVA, [CHIEDI], ⌫ lettera, ⌫ parola,
[ANNULLA CORREZIONE], SVUOTA.**
- PARLA dice e toglie dallo schermo, ma tiene in `scan.ultimoDetto`.
- RIPETI (`SPEAK_AGAIN`): con un testo da dire fa ciò che fa PARLA;
  senza, ridice `ultimoDetto` con `{ rilettura: true }` (non lo insegna
  di nuovo). La memoria cambia solo quando si DICE altro (PARLA, RIPETI
  su testo nuovo, una frase pronta).
- LEGGI legge e lascia il testo.
- ⚠️ `main.js` deve passare le OPZIONI di `onOutput` (terzo argomento).
  Per mesi non le passava: LEGGI arrivava senza `rilettura` e insegnava
  la frase ai suggerimenti a ogni rilettura.

**Menu Scrivi**: ESCI, AZIONI, [␣ `spazioFuori`], [. `puntoFuori`],
[Suggerimenti], gruppi di lettere, [⌫ parola `cancellaDopoGruppi`].
- Spazio e punto stanno PRIMA del punto di ripartenza (`hot`): non
  costano un passo a ogni lettera. Lo spazio fuori è un'azione `SPAZIO`,
  NON `CHAR`: altrimenti Scrivi verrebbe preso per un gruppo di lettere
  (`_inLettere`) e ne avrebbe il passo corto. Con `spazioFuori` lo
  spazio dentro i gruppi sparisce.
- PUNTO chiude la parola, attacca "." all'ultima parola, riparte da
  AZIONI. Mai due di fila, mai su testo vuoto. Dopo un punto il contesto
  dei suggerimenti riparte (`fraseInCorso`), l'apprendimento separa le
  frasi e NON mette "sete." nel lessico (`frasiDi`).
- CANCELLA nei gruppi (`DEL_CHAR_QUI`): toglie una lettera, resta nel
  gruppo, riparte da ESCI. CANCELLA dopo i gruppi: `DEL_WORD` + resta lì.

**Proposta a voce**: torna a OGNI GIRO (`propostaOgniGiro`), un attimo
prima del punto di ripartenza, finché ci sono lettere in corso. La parola
proposta è anche la PRIMA dell'elenco Suggerimenti (prima ne era esclusa:
si sentiva "sono", si entrava nell'elenco e si prendeva "solo"). L'elenco
ha `suggestionCount` + le proposte: le alternative restano quante prima.

**Varianti** (`variantiSuggerimento`, spento): dopo una parola scelta
DALL'ELENCO, proposta virtuale `{variante:true}` che SOSTITUISCE.

**Genere di chi scrive** (`prediction.genereUtente` '' | 'f' | 'm'):
- suggerimenti: dopo "sono / mi sento / ero / sono stata…" (`parlaDiSe`)
  la forma giusta PRENDE IL POSTO di quella sbagliata. Si guarda la
  DESINENZA -o/-a e l'esistenza della gemella, non l'etichetta del
  lessico (inaffidabile per "triste", "felice"). Le forme giuste non
  vengono spinte: altrimenti ogni participio superava le parole neutre.
- correzione: `accordoConChiScrive` ("sono stanco" → "stanca").

**Correzione automatica** — ⚠️ il difetto più grave trovato: conosceva
437 parole e ne "correggeva" una SANA su sette ("chiesa" → "chiama").
Ora `lessicoPerCorrezione` usa tutte le trentamila (escluse le corte e
rarissime, che fanno da scudo agli errori: "cao", "aqua"), e
`formaPlausibile` riconosce verbo+pronome e voci verbali. La
punteggiatura si stacca e riattacca. Provati grammatica ed espressioni
come contesto: +2-3% di correzioni ma il DOPPIO di correzioni sbagliate
→ lasciati fuori. Banco: refusi plausibili per la scansione su frasi
vere (parole sane toccate 14% → 0,2%; correzioni sbagliate ~1%).

**Parole corte prima** (`cortePrima`, spento): misurato a ogni intensità,
anche come spareggio: abbassa sempre la precisione. La frequenza lo fa
già. **Nomi propri** leggermente dopo le parole comuni (`propriK` 4).


---

## GESTI NUOVI (versione `20261113`, seconda consegna) — tutti SPENTI di default

Test: `test/gesti.mjs`. ⚠️ Con le opzioni spente il motore dei gesti dà
gli stessi eventi della versione precedente (verificato su sessioni
casuali, evento per evento).

**Chiusura degli occhi a tre durate** — `CLOSE_SHORT`, `CLOSE_MEDIUM`,
`CLOSE_LONG` (`GestureEngine._chiusuraDurate`). Si decide alla
RIAPERTURA in base alla durata; ogni canale ha intervallo e azione
propri. Legge lo stesso "chiuso / aperto / non so" di ammiccamento e
`LONG_CLOSE` (che resta com'è: scatta MENTRE gli occhi sono chiusi).
"Non so" non chiude il gesto; una riapertura sotto `closeGapMs` è un
tremolio; se `LONG_CLOSE` è già scattata, niente secondo comando; se la
durata cade in una finestra, l'ammiccamento della stessa chiusura è
annullato. L'evento porta `agoMs` (da quanto il gesto è cominciato).
Le altre direzioni (giù, sinistra, destra) hanno ancora UNA durata;
"in alto" ne ha tre da sempre.

**Indietro di una voce** — azione `PREV` (≠ `BACK`, che esce dal
sottomenu). `ScanEngine.indietro(now, inizio)`: torna alla voce PRIMA
di quella che la sequenza stava dicendo quando il gesto è COMINCIATO
(`_storia` degli annunci), non di quella corrente: un gesto che dura
finisce quando la sequenza è già avanti. `scan.indietroAnticipoMs`
(250) compensa il ritardo di rilevamento. `main.onGesture` passa
`{ inizio }` a `handleAction`. Da tastiera: freccia su.

**Modalità normalizzata** — `signal.modoNormalizzato`,
`GestureEngine._normalizza`. Il gesto misurato rispetto a se stesso:
riferimento = MEDIANA degli ultimi 7 picchi delle escursioni (per
occhio, asse, direzione); soglie = frazioni (`normOn` 0,5, `normOff`
0,3). ⚠️ Regole trovate simulando, da non rompere:
- per COMINCIARE servono 3 escursioni SIMILI (max/min ≤ `normSimile`
  1,8, scelte fra le ultime 6), ognuna ≥ `normAvvioSigma` (3) nel
  GRAFICO, cioè con il guadagno di direzione × occhio applicato, e
  lunga ≥ `normDurMinMs` (250 ms). ⚠️ Fino al 13/11 ore 19 si chiedeva
  ≥ `thresholdOn`·σ: chi aveva alzato la soglia a 10 con un gesto di
  ~4 σ non vedeva MAI partire la modalità (il circolo vizioso
  segnalato da Francesco). Il tremore resta non imparato: 0 comandi
  involontari su 12 sessioni × 10 min di tremore forte;
- il riferimento NON decade col tempo (era il difetto di
  `sogliaRelativa`, che guarda solo gli ultimi 10 secondi);
- si riallinea dopo 3 escursioni di fila molto più piccole (<0,4) o
  molto più grandi (>2,5);
- la soglia non scende mai sotto `normMinSigma`·σ del rumore VERO,
  senza guadagno (`_scalaNorm`). ⚠️ Provato a dividerlo per il guadagno:
  a guadagno 2, 5 minuti di tremore forte davano 125 comandi involontari
  (la modalità di sempre 21); così 0;
- guadagni e soglie per direzione NON si applicano quando è attiva;
- mentre impara valgono le soglie di sempre per l'ATTIVAZIONE, ma il
  rilascio è già la frazione `normOff`/`normOn`, così le linee del
  grafico 0–1 dicono il vero;
- esclude `sogliaRelativa`: nel motore quel ramo è saltato se la
  normalizzata è accesa; in `main.set` accendendo una si spegne l'altra,
  con un avviso;
- è agganciata in punti soli dietro l'interruttore: una riga dopo il
  calcolo di `A.sigma` (salva `A.sigmaStd`, il rumore vero), un blocco
  in `_evaluate`, i campi `nNorm`/`nRawNorm`/`norm` di `channels()`.

**Insegna il gesto** (pulsante in Diagnostica, `btnInsegnaGesto`):
`insegnaGesto()` / `annullaInsegna()` / `statoInsegna`. Raccoglie le
escursioni per occhio/asse/verso (≥ `normInsegnaSigma` 2 nel grafico);
finisce 800 ms dopo che un canale ne ha 3, o dopo 40 s
(`normInsegnaMaxMs`). Fissa il riferimento di OGNI canale con ≥ 3.
Mentre insegna nessun gesto diventa comando (come `misura`). Se la
modalità è spenta il pulsante la accende.

**Grafico** — `js/ui/GraficoNorm.js`, sottoclasse di `SignalPlot`
(`js/vision/` NON toccato). Modalità spenta: `super.draw` identico.
Accesa: scala 0–1 (1 = gesto tipico), linee a `normOn`/`normOff`,
scritta per traccia "SX ↑ imparato" / "sto imparando N di 3". In
entrambe le modalità scrive accanto alla fine di ogni gesto l'esito:
l'azione (✓) o il motivo dello scarto (✗): occhio non attivo, durata
fuori finestra, in pausa, troppo vicino al precedente, aspetto l'altro
occhio (motore, `cand.motivo` via `this._motivo`), scansione sospesa
fuori da Parla, bande (main, `_esitoGesto`). Solo annotazioni: nessun
effetto sui comandi.
Effetto misurato: con un gesto ampio che non torna del tutto a riposo,
le soglie di sempre misuravano la durata con 1,6 s di errore e
prendevano 20 gesti brevi su 20 per LUNGHI (annulla invece di
seleziona); normalizzata, errore 30 ms.

**Difetto corretto nel motore**: le soglie PER DIREZIONE
(`signal.thresholdDir`) non venivano applicate all'avvio né dopo una
modifica ai filtri, ma solo al cambio di un'altra impostazione. Ora
`_rebuild` chiama `_aggiornaSoglie`.

### CANCELLA nei gruppi di lettere — dopo la lettera (13/11, build 2200)

`scan.cancellaNeiGruppi` (predefinito **spento**; CONFIG_VERSION 48 lo
rimette spento nei profili salvati, perché prima era acceso di serie con
un altro significato).

- **Spento**: nessun CANCELLA nei gruppi; dopo ogni lettera si esce
  subito, come sempre.
- **Acceso**: ⌫ in coda al gruppo (prima di ESCI). Scelta una LETTERA,
  la sequenza resta nel gruppo e si ferma un passo sul ⌫
  (`_verificaLettera`). Scelto ⌫ → `DEL_CHAR_QUI`: via la lettera, si
  resta nel gruppo ripartendo da ESCI. Lasciato passare (tick o NEXT) →
  `_concludiVerifica` → `_dopoComposizione`, esattamente la ripartenza
  di sempre dopo una lettera (punto, o spazio se fuori dai gruppi;
  proposta a voce compresa).
- Lo spazio dentro un gruppo NON si ferma sul ⌫.
- Finestra di grazia (`graceMs`): un gesto arrivato entro la grazia dopo
  che ⌫ è passato vale per ⌫ (`_verificaPassata`).
- `_verifica` si azzera in `_up`, `_backToWrite`, `_resetToRoot`, `undo`
  e a ogni selezione. Test: percorsi 77ac0–77ae6.

### Conferme a voce durante la scrittura (13/11, build 2300)

`scan.ecoLettera` e `scan.ecoParola`, entrambe spente di serie, in «Come
comunica» dopo i CANCELLA. `ScanEngine._ecoDi` → `h.onEco(tipo, testo)`
(main: canale annunci, nome della lettera se `audio.letterNames`). Detta
UNA volta con `_hold`, poi la sequenza riannuncia la voce corrente
(proposta a voce compresa). La lettera: CHAR non spazio. La parola:
spazio, SPAZIO, PUNTO, WORD (anche con varianti). Con il CANCELLA nei
gruppi la lettera è detta prima del ⌫ e non ripetuta alla conclusione.
Testo, PARLA, LEGGI invariati. Test: percorsi 77af1–77af8.

### Normalizzata: il gesto tipico arriva SEMPRE a 1 + Inquadratura (16/11, build 0100)

**Il difetto** (segnalato da Francesco: "il gesto non arriva mai a 1, sta
a 0,5–0,6"): con un gesto moderato (3–4 σ) il minimo di sicurezza
legava la scala; il grafico divideva per `max(on·R, minimo)/on`, quindi
il gesto tipico arrivava a `on·R/minimo` ≈ 0,6. E il minimo ignorava il
guadagno (scelta del 13/11), quindi il guadagno a 2 non aiutava.

**Ora** (tutto dietro `modoNormalizzato`):
- grafico: `nNorm = segno·disp / R` → gesto tipico = 1 sempre;
- `sogliaRealeNorm` = dove scatta davvero (≥ normOn), in `channels()` come
  `sogliaNorm`; il grafico la disegna tratteggiata «attiva davvero»
  quando il minimo la alza; il rilevamento è quello di prima;
- `_minimoNorm` = max(normMinSigma/guadagno, `normPavimentoSigma` 2)·σ
  vero: il guadagno conta, fino a 2 σ. Tremore forte grande quanto il
  gesto, 4×5 min: normalizzata 1 comando involontario a guadagno 2 e 3;
  modalità di sempre 21 e 502;
- apprendimento: un'escursione conta solo oltre max(minimo nel grafico,
  2 σ veri·guadagno) — con guadagno 4 il rumore amplificato veniva
  imparato come gesto (test 4p). A guadagno 1 invariato.
Test: gesti 4l (ora confronto con la modalità di sempre), 4m–4p.

**Occhio "ingrandito" con camera di lato**: è solo `drawEyeDebug`, che
adatta ogni ritaglio al riquadro: l'occhio lontano, più piccolo
nell'immagine, viene ingrandito di più. Il segnale non c'entra.
`js/vision` NON toccato.

**Inquadratura** (`js/ui/Inquadratura.js`, Diagnostica, pulsante
«Mostra inquadratura», spenta di serie): immagine INTERA a specchio di
`vision.lastFrame`, croce e zona consigliata, riquadro del volto dai
landmark MediaPipe (se ci sono), riquadri degli occhi in ogni modalità,
giudizio "ben inquadrato / troppo a destra / lontano…". Solo disegno.

### 25/11, build 0200 — otto ritocchi chiesti da Francesco

1. **Dopo una lettera si riparte dallo SPAZIO** (o dal PUNTO) fuori dai
   gruppi, se ci sono: spazio, punto, suggerimenti, gruppo 1.
   `scan.ripartiDaSpazio` (acceso); in `_backToWrite(…, 'gruppi')`.
   Spento, o senza spazio/punto fuori: `_hotIndex` come prima.
2. **⌫ dopo i gruppi = cancella LETTERA** (`k:cancella`, azione
   `DEL_CHAR`, voce "cancella", resta lì). ⌫ parola resta in AZIONI.
3. **PARLA / RIPETI / LEGGI protette**: `onOutput('speech', …, {frase})`
   → `speakLong(text, {protetta})`; in `onGesture` i gesti durante una
   frase protetta sono ignorati (la frase finisce, poi la scansione
   riprende da sola). Il tetto di sicurezza di `_hold` per le frasi è
   `_tettoFrase` = max(25 s, 150 ms × caratteri + 8 s): prima 25 s fissi,
   e una frase lunga faceva ripartire la voce guida a metà. Le letture
   lunghe (bozze, risposte) restano interrompibili.
4. **Selezione dall'INIZIO del gesto** (`select(now, inizio)`,
   `scan.selezioneDaInizio` acceso, `selezioneAnticipoMs` 150): sceglie
   la voce che suonava quando il gesto è cominciato, nello stesso
   livello (anche la proposta a voce: `_storia` ora la ricorda). Senza
   istante d'inizio (tastiera, mouse) come prima.
5. **Gesti → Cancella lettera / Cancella parola** (`ACTIONS.DEL_CHAR`,
   `DEL_WORD`; `cancellaDaGesto`): da qualunque punto, la sequenza resta
   dov'è e riannuncia la voce.
6. **Frase al centro** (`ui.fraseAlCentro`, spenta): `_posizionaFrase`
   SPOSTA il nodo `.compose` dentro `.stage` prima di `#stageCurrent`, e
   lo rimette dov'era spegnendo. CSS `body.frase-al-centro`.
7. **Parla: «Inquadratura» e «Insegna il gesto»** nella barra di chi
   assiste (`btnInquadraParla`, `btnInsegnaParla`): stessi comandi della
   Diagnostica; l'inquadratura è un riquadro sovrapposto in alto a destra.
8. **Timing adattivo** (decisioni in memoria di progetto): misura
   dall'annuncio della voce scelta all'INIZIO del gesto; passo =
   max(p·1,25, p+250 ms), ultimi 30 tempi → sale e SCENDE, converge.
   Corretto l'azzeramento: `updateConfig` confrontava `cfg.scan.stepMs`
   con sé stesso (stesso oggetto) — ora con `_impostato`.

### 27/11, build 20261127-0100 — proposta a voce e ESCI

1. **Proposta a voce a ogni giro nello stesso punto di dopo la lettera**:
   `_indiceRipartenza(node)` (spazio/punto se fuori dai gruppi e
   `ripartiDaSpazio` acceso, altrimenti `hot`) è ora l'unica regola sia
   per `_backToWrite(…, 'gruppi')` sia per `_propostaDelGiro`. Prima, a
   ogni giro, la proposta arrivava DOPO spazio e punto (prima di
   Suggerimenti). Ordine: proposta → ␣ → . → Suggerimenti → gruppi.
2. **INDIETRO ripropone le parole** (`indietro`): dal punto di ripartenza
   → di nuovo le proposte dalla prima; da una proposta non prima → quella
   prima; dalla PRIMA proposta → indietro come sempre (AZIONI), così non
   si resta chiusi. Solo con `suggerimentiDiretti`, parola in corso, non
   per le varianti. `_storia` dà la parola all'inizio del gesto.
3. **ESCI «sparito» (segnalazione)**: NON riprodotto. Ogni sottomenu ha
   ESCI per costruzione (controllati tutti, con ogni combinazione);
   simulazione casuale su migliaia di sequenze (gesti, indietro, PARLA,
   RIPETI, LEGGI, SALVA): ESCI sempre raggiunta. Spiegazione probabile:
   si finisce nel MENU PRINCIPALE, che non ha ESCI perché è il livello
   più alto — dopo 3 giri a vuoto (`maxCycles`) Scrivi si chiude da solo,
   e RILEGGI (Miei testi) e le Frasi riportano lì. Test 77es-*.

### 27/11, build 20261127-0200 — ESCI nel respiro fra due giri (segnalazione)

«Dopo la pausa, entrando in Scrivi, ESCI non funziona, si resta
bloccati»: RIPRODOTTO nel browser, ed era un difetto introdotto il 25/11
con la selezione dall'inizio del gesto. Nel respiro fra un giro e l'altro
(`cyclePauseMs`) lo schermo mostra già ESCI come voce corrente, ma la voce
guida non l'ha ancora detta: la memoria breve (`_storia`) aveva come
ultima voce l'ULTIMA del giro prima («⌫ lettera»), e il gesto partiva su
quella. Si vedeva ESCI, si faceva il gesto, e non si usciva.
 · `_advance`, al giro: si scrive nella memoria breve il respiro come
   voce 0 (`respiro: true`). Il gesto nel respiro vale per ESCI, come
   prima del 25/11; "indietro" nel respiro porta all'ultima voce (quella
   appena sentita) invece che alla penultima.
 · `resume`: la memoria breve riparte vuota — un gesto subito dopo il
   risveglio non può valere per una voce di prima della pausa.
Test 77es-r1…r3, 77es-p1…p5.
