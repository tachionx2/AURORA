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


-----------------------------------------------


Ecco la traduzione del testo in inglese, mantenendo esattamente la stessa impaginazione, formattazione Markdown e struttura:

Aurora
Auditory scanning communicator for people with severe paralysis.

Aurora allows composing words and sentences with a single voluntary
movement — typically an upward glance — guided by voice.
It runs in a browser, requires no installation, and works offline
starting from the second launch.

Author: Francesco Pagliano
License: see LICENSE.txt — AGPL-3.0 with additional
conditions of perpetual free availability and unalterability of attribution.

⚠️ Not a medical device
Aurora is not certified as a medical device and must not be used as the
sole means of communication in emergency situations. An alternative
communication method must always remain available — a paper alphabet
board, an agreed movement code, a call bell.

Anyone installing, configuring, assisting with, or using Aurora does so
under their own exclusive responsibility.

Free of charge
Aurora is and will always remain free of charge for anyone who needs
it. No one may request money for its use, directly or indirectly, and
it cannot be used as a fundraising tool without the written consent of
the author.

How to publish
No build step required: these are static files. Simply publish the
folder as it is on any hosting service.

On Netlify:

build command: none (leave blank)

publish directory: . (the root)

⚠️ The vendor/ folder must be published: it contains the face
recognition library and the high-legibility font. Without it, Aurora
will not work.

Structure
index.html          the page
js/                 the program
  core/             configuration, language, license terms
  signal/           filters, gesture detection, statistics
  vision/           camera, video, face recognition
  scan/             auditory scanning tree
  lang/             prediction, autocorrect, dictation, mail
  ui/               panels, settings, floating window
  device/           robotic arm, mouse, home automation
css/                stylesheets
vendor/             included libraries and font (required)
strumenti/          tools for mouse control
documenti/          terms and license in PDF
test/               1531 automated checks
Verification
sh test/tutti.sh
