# Verifiche automatiche

Da eseguire **prima di ogni caricamento su Netlify**:

```
sh test/tutti.sh
```

## Cosa controlla ciascuna suite

| File | Cosa verifica |
|---|---|
| `integrita.mjs` | Collegamenti fra i file: ogni `getElementById` ha un id nell'HTML, ogni chiave di traduzione esiste in entrambe le lingue, ogni percorso di configurazione esiste davvero, nessun metodo invocato è stato cancellato, ogni classe CSS usata è definita, il service worker elenca tutti i file, la migrazione funziona da ogni versione precedente, nessun parametro chiamato `t` oscura la traduzione. |
| `logica.mjs` | Motore di scansione, filtri del segnale, predizione, archivio testi, struttura dell'albero. |
| `puntatore.mjs` | Calibrazione, mappatura sguardo→schermo, click per permanenza, cursore a bande. |
| `video.mjs` | Catena di osservazione con DOM simulato: che gli occhi vengano davvero disegnati. |
| `diagnostica.mjs` | Camera e analisi degli occhi: che ogni impostazione produca un effetto **misurabile** (soglie, filtri, baseline, occhio attivo, confidenza, ammiccamento, durate, combinazione dei due occhi), che i dieci canali diagnostici e i contatori siano corretti, che il grafico disegni solo le tracce scelte, e che il rilevamento IR trovi pupilla, riflesso e movimento su un'immagine sintetica. |
| `layout.mjs` | Bilancio verticale delle pagine Parla e Punta su 8 schermi × 4 livelli di zoom: nessuna deve richiedere scorrimento. |
| `larghezze.mjs` | Larghezza dei controlli nelle righe di impostazione, su quattro larghezze di colonna: nessun controllo deve essere compresso al punto da mandare il testo a capo lettera per lettera. |
| `resilienza.mjs` | Telecamera e audio: perdita di segnale, blocco, dispositivi scollegati, ripristino automatico. È la suite più importante: chi usa Aurora non ha altro modo di comunicare. |
| `offline.mjs` | Funzionamento senza internet: librerie incluse, nessuna dipendenza da server esterni per comunicare, conservazione nella cache. |
| `percorsi.mjs` | **I percorsi d'uso reali con UN SOLO GESTO**: dire "Sì", scrivere e pronunciare, uscire da una sezione sbagliata, salvare una lettera e farla pronunciare più tardi, riprenderla, annullare, mettere in pausa e risvegliarsi, il segnale oculare dal riposo all'azione. |
| `applicazione.mjs` | Avvio dell'applicazione completa con DOM simulato, poi **pressione di ogni pulsante** di ogni scheda e **modifica di ogni impostazione** una per una, verificando che il ciclo di scansione resti vivo. |

## Le tre regole imparate a caro prezzo

1. **Un test che verifica solo "non lancia errori" non basta.** Una pagina vuota non lancia errori. Le suite contano il contenuto prodotto.
2. **Il ciclo di scansione non deve poter morire.** Parte per primo e si riarma in `finally`: è l'unico modo che la persona ha di parlare.
3. **Dopo ogni modifica strutturale, `integrita.mjs`.** I guasti peggiori non sono stati errori di logica ma collegamenti spezzati.
