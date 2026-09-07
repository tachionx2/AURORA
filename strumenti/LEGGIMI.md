# Strumenti per il controllo del mouse

Questi programmi stanno **fuori** da Aurora e servono a chi controlla
il cursore con gli occhi e vuole usare il computer, non solo Aurora.

## Perché servono

Una pagina web **non può muovere il cursore del sistema**. Non è un
limite di Aurora: è una regola di sicurezza del web, e non cambierà.
Serve qualcosa fuori dal browser che riceva i comandi e muova il mouse
per davvero.

## Quale scegliere — ne serve UNO SOLO

| | `avvia-mouse.bat` | `aurora-mouse.py` | `aurora-esp32.ino` |
|---|---|---|---|
| Sistema | **solo Windows** | Windows, macOS, Linux | tutto, anche TV e console |
| Cosa installare | **niente** | due comandi `pip` | una scheda ESP32-S3 |
| Come si avvia | doppio clic | da terminale | si infila nell'USB |
| Permessi | nessuno | su macOS l'accessibilità | nessuno |
| Braccio robotico | no | no | **sì** |
| Collegamento in Aurora | ponte | ponte | seriale |

### Su Windows: parti da qui

**Doppio clic su `avvia-mouse.bat`.** Non serve installare niente:
PowerShell è già dentro Windows, e muovere il mouse è una chiamata che
Windows offre da sempre. Si apre una finestrella nera che dice
"in ascolto" — lasciala aperta e vai in Aurora.

Se Windows blocca l'avvio, il file `.bat` contiene già l'istruzione che
lo consente **per quel solo avvio**, senza cambiare nulla nel sistema.

### Su macOS o Linux

Usa `aurora-mouse.py`: fa esattamente le stesse cose.

### La scheda ESP32

Serve quando vuoi anche il **braccio robotico**, o quando il computer
non deve avere nulla installato — per esempio su un televisore o una
console. È l'unica soluzione che fa entrambe le cose sullo stesso cavo.

## Il programma Python

```
pip install websockets pyautogui
python aurora-mouse.py
```

Poi in Aurora: *Impostazioni → Dispositivo* → collegamento **ponte**.
L'indirizzo predefinito è già quello giusto.

Su Linux può servire anche `pip install python-xlib`.
Su macOS: *Impostazioni di Sistema → Privacy e Sicurezza →
Accessibilità*, e autorizzare il Terminale.

## La scheda ESP32 — mouse e braccio robotico

Una scheda sola fa **entrambe le cose**, sullo stesso cavo e con lo
stesso protocollo. È il motivo per cui questa strada esiste: il
computer non ha uscite per servomotori, la scheda sì.

Per usare solo il mouse, lascia `BRACCIO_COLLEGATO` a `0`: i comandi
del braccio vengono accettati senza fare nulla, e la scheda funziona
comunque.

⚠️ Serve un **ESP32-S3** o S2: l'ESP32 originale non ha l'USB nativo
necessario per presentarsi come mouse.

⚠️ I limiti di corsa dei servomotori non sono un dettaglio. Un
servomotore spinto oltre il proprio arco meccanico si rovina in pochi
secondi, e un braccio che si muove dove non dovrebbe può ferire una
persona che non ha modo di scansarsi. I limiti sono in cima al file:
vanno adattati al braccio che si usa, **prima** di collegare
l'alimentazione ai motori.

Arduino IDE → Strumenti:
- Scheda: `ESP32S3 Dev Module`
- USB Mode: `USB-OTG (TinyUSB)`
- USB CDC On Boot: `Enabled`

Poi in Aurora: *Impostazioni → Dispositivo* → collegamento **seriale**,
e scegli la porta della scheda.

## Il protocollo

Testo semplice, una riga per comando. Si può collaudare da un
terminale seriale prima di collegare Aurora.

```
M <dx> <dy>     sposta il cursore
C <n>           clic: 1 sinistro, 2 destro, 3 centrale
K <n>           doppio clic
T <n> <0|1>     tiene premuto (1) o rilascia (0)
W <n>           rotellina, positivo verso l'alto
?               richiesta di stato
S               arresto: rilascia tutti i pulsanti
```

## ⚠️ Sicurezza

Chi usa questo ponte **non può prendere il mouse e rimetterlo a posto**
se qualcosa va storto. Entrambi i programmi hanno quindi:

- un **limite di velocità**: il cursore non può superare 4000 pixel al
  secondo, così un guasto del rilevamento non lo fa impazzire;
- un **tetto per singolo comando**, come seconda difesa indipendente;
- il **rilascio dei pulsanti** quando il collegamento cade: un pulsante
  rimasto premuto renderebbe il computer inutilizzabile;
- il programma Python ascolta **solo da 127.0.0.1**: nessuno dalla rete
  può raggiungerlo;
- portando il mouse in un angolo dello schermo, il programma Python si
  ferma.
