# Aurora

Comunicatore a scansione uditiva per persone con paralisi grave.

Aurora permette di comporre parole e frasi con un solo movimento
volontario — tipicamente uno sguardo verso l'alto — guidato dalla voce.
Funziona in un browser, non richiede installazione, e dal secondo
avvio funziona anche senza internet.

**Autore:** Francesco Pagliano
**Licenza:** vedi [`LICENSE.txt`](LICENSE.txt) — AGPL-3.0 con condizioni
aggiuntive di gratuità perpetua e inalterabilità dell'attribuzione.

---

## ⚠️ Non è un dispositivo medico

Aurora non è certificato come dispositivo medico e non deve essere usato
come unico mezzo di comunicazione in situazioni di emergenza. **Deve
sempre restare disponibile un metodo di comunicazione alternativo** —
una tabella alfabetica cartacea, un codice concordato di movimenti, un
campanello.

Chi installa, configura, assiste o usa Aurora lo fa sotto la propria
esclusiva responsabilità.

---

## Gratuità

Aurora **è e resterà per sempre gratuito** per chiunque ne abbia
bisogno. Nessuno può chiedere denaro per il suo utilizzo, né
direttamente né indirettamente, e non può essere usato come strumento
di raccolta fondi senza il consenso scritto dell'autore.

---

## Come si pubblica

Non serve compilare nulla: sono file statici. Basta pubblicare la
cartella così com'è su un qualunque servizio di hosting.

Su Netlify:

- comando di compilazione: **nessuno** (lasciare vuoto)
- cartella da pubblicare: **`.`** (la radice)

⚠️ La cartella `vendor/` **va pubblicata**: contiene la libreria di
riconoscimento del volto e il carattere ad alta leggibilità. Senza,
Aurora non funziona.

---

## Struttura

```
index.html          la pagina
js/                 il programma
  core/             configurazione, lingua, termini di licenza
  signal/           filtri, rilevamento dei gesti, statistiche
  vision/           telecamera, video, riconoscimento del volto
  scan/             albero della scansione uditiva
  lang/             predizione, autocorrezione, dettatura, posta
  ui/               pannelli, impostazioni, finestra fluttuante
  device/           braccio robotico, mouse, domotica
css/                fogli di stile
vendor/             librerie e carattere inclusi (necessari)
strumenti/          programmi per il controllo del mouse
documenti/          termini e licenza in PDF
test/               1531 verifiche automatiche
```

---

## Verifiche

```
sh test/tutti.sh
```

Undici suite. Nessuna richiede rete o browser.
