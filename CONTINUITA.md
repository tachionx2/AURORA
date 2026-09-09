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
