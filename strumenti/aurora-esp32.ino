/*
 * aurora-esp32.ino — ESP32-S3: mouse USB E braccio robotico per Aurora.
 *
 * Una scheda sola fa entrambe le cose, sullo stesso cavo e con lo
 * stesso protocollo. È il motivo per cui questa strada esiste: il
 * computer non ha uscite per servomotori, la scheda sì.
 *
 * L'assistente sceglie in Aurora quale funzione usare; la scheda
 * esegue ciò che le arriva e ignora il resto senza dare errori.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUANDO SERVE QUESTO INVECE DEL PROGRAMMA PYTHON
 * ═══════════════════════════════════════════════════════════════════
 *
 * Il programma Python è più semplice, ma va installato sul computer e
 * su macOS richiede un permesso di accessibilità.
 *
 * Questa scheda invece si presenta al computer come un MOUSE VERO:
 * nessun driver, nessun permesso, nessun programma da installare.
 * Funziona su Windows, macOS, Linux — e anche su televisori e console
 * che accettano un mouse USB ma su cui non si può installare nulla.
 *
 * ⚠️ Serve un ESP32-S3 (o S2): l'ESP32 originale NON ha l'USB nativo
 * necessario per presentarsi come mouse.
 *
 * ═══════════════════════════════════════════════════════════════════
 * COME FUNZIONA
 * ═══════════════════════════════════════════════════════════════════
 *
 * La scheda espone DUE cose sullo stesso cavo:
 *   · una porta seriale, con cui Aurora le parla dal browser;
 *   · un'interfaccia mouse, con cui il sistema la vede.
 *
 * Il computer non sa che c'è di mezzo un programma: vede un mouse.
 *
 * ═══════════════════════════════════════════════════════════════════
 * COME SI CARICA
 * ═══════════════════════════════════════════════════════════════════
 *
 * Arduino IDE → Strumenti:
 *   Scheda:           ESP32S3 Dev Module
 *   USB Mode:         USB-OTG (TinyUSB)
 *   USB CDC On Boot:  Enabled
 *
 * Poi in Aurora: Impostazioni → Dispositivo → collegamento "seriale",
 * e scegli la porta della scheda.
 *
 * ═══════════════════════════════════════════════════════════════════
 * PROTOCOLLO — una riga per comando
 * ═══════════════════════════════════════════════════════════════════
 *
 * ── MOUSE ──
 *   M <dx> <dy>     sposta il cursore
 *   C <n>           clic: 1 sinistro, 2 destro, 3 centrale
 *   K <n>           doppio clic
 *   T <n> <0|1>     tiene premuto (1) o rilascia (0)
 *   W <n>           rotellina, positivo verso l'alto
 *
 * ── BRACCIO ROBOTICO ──
 *   P <x> <y> <z>   posizione assoluta, 0.000-1.000
 *   D <dx> <dy>     spostamento relativo, -1.000-1.000
 *   G <0-100>       apertura pinza in percentuale
 *   B <n> <0|1>     uscita digitale n
 *   H               ritorno alla posizione di riposo
 *
 * ── COMUNI ──
 *   S               ARRESTO IMMEDIATO
 *   ?               richiesta di stato
 *
 * ⚠️ Il braccio va collegato solo se serve: senza servomotori la
 * scheda funziona lo stesso come mouse, e i comandi del braccio
 * vengono accettati senza fare nulla.
 */

#include "USB.h"
#include "USBHIDMouse.h"
#include <ESP32Servo.h>          // solo se si usa il braccio

USBHIDMouse Mouse;

/* ══════════════════════════════════════════════════════════════════
 * BRACCIO ROBOTICO
 * ══════════════════════════════════════════════════════════════════
 *
 * Mettere BRACCIO_COLLEGATO a 0 se si usa solo il mouse: la scheda
 * continua a funzionare e i comandi del braccio vengono accettati
 * senza fare nulla.
 *
 * ⚠️ I limiti di corsa non sono un dettaglio: un servomotore spinto
 * oltre il proprio arco meccanico si rovina in pochi secondi, e un
 * braccio che si muove dove non dovrebbe può ferire una persona che
 * non ha modo di scansarsi. */
#define BRACCIO_COLLEGATO 0

const int PIN_BASE   = 4;
const int PIN_SPALLA = 5;
const int PIN_GOMITO = 6;
const int PIN_PINZA  = 7;
const int PIN_USCITA[4] = { 15, 16, 17, 18 };

// Corsa consentita per ciascun servomotore, in gradi.
const int MIN_BASE = 20,   MAX_BASE = 160;
const int MIN_SPAL = 30,   MAX_SPAL = 150;
const int MIN_GOM  = 20,   MAX_GOM  = 160;
const int MIN_PINZ = 10,   MAX_PINZ = 90;

// Velocità massima: il braccio non deve mai scattare.
const int GRADI_PER_PASSO = 2;
const int MS_PER_PASSO    = 12;

#if BRACCIO_COLLEGATO
Servo sBase, sSpalla, sGomito, sPinza;
#endif
float posX = 0.5, posY = 0.5, posZ = 0.5, apertura = 50;
bool arrestato = false;

int daFrazione(float f, int minimo, int massimo) {
  if (f < 0) f = 0; if (f > 1) f = 1;
  return minimo + (int)(f * (massimo - minimo));
}

/* Muove un servomotore GRADUALMENTE verso l'angolo voluto.
 * Uno scatto improvviso sarebbe pericoloso e rovinerebbe la meccanica. */
void muoviPiano(int corrente, int voluto, void (*applica)(int)) {
  int passo = (voluto > corrente) ? GRADI_PER_PASSO : -GRADI_PER_PASSO;
  while (abs(voluto - corrente) > GRADI_PER_PASSO) {
    corrente += passo;
    applica(corrente);
    delay(MS_PER_PASSO);
  }
  applica(voluto);
}

void applicaBraccio() {
#if BRACCIO_COLLEGATO
  if (arrestato) return;
  sBase.write(daFrazione(posX, MIN_BASE, MAX_BASE));
  sSpalla.write(daFrazione(posY, MIN_SPAL, MAX_SPAL));
  sGomito.write(daFrazione(posZ, MIN_GOM, MAX_GOM));
  sPinza.write(daFrazione(apertura / 100.0, MIN_PINZ, MAX_PINZ));
#endif
}

/* ⚠️ Limiti di sicurezza.
 *
 * Chi usa questo ponte non può prendere il mouse e rimetterlo a posto.
 * Se il rilevamento oculare impazzisce, il cursore deve rallentare da
 * solo: sono le uniche protezioni che restano quando il browser, per
 * qualunque motivo, manda comandi assurdi. */
const int  MAX_PASSO            = 100;   // pixel per singolo comando
const long MAX_PIXEL_AL_SECONDO = 4000;

String riga;
unsigned long ultimoConteggio = 0;
long creditoPixel = MAX_PIXEL_AL_SECONDO;
unsigned long mosse = 0, clic = 0, scarti = 0;

void setup() {
  Mouse.begin();
  USB.begin();
  Serial.begin(115200);

#if BRACCIO_COLLEGATO
  sBase.attach(PIN_BASE);
  sSpalla.attach(PIN_SPALLA);
  sGomito.attach(PIN_GOMITO);
  sPinza.attach(PIN_PINZA);
  for (int i = 0; i < 4; i++) pinMode(PIN_USCITA[i], OUTPUT);
  applicaBraccio();
#endif

  delay(400);
  Serial.print("OK Aurora pronto - mouse");
#if BRACCIO_COLLEGATO
  Serial.print(" e braccio");
#endif
  Serial.println();
}

/* Ricarica il credito di movimento in proporzione al tempo passato. */
bool consentiMovimento(long distanza) {
  unsigned long ora = millis();
  unsigned long dt = ora - ultimoConteggio;
  ultimoConteggio = ora;
  creditoPixel += (long)((dt * MAX_PIXEL_AL_SECONDO) / 1000);
  if (creditoPixel > MAX_PIXEL_AL_SECONDO) creditoPixel = MAX_PIXEL_AL_SECONDO;
  if (distanza <= creditoPixel) { creditoPixel -= distanza; return true; }
  return false;
}

int limita(int v, int massimo) {
  if (v >  massimo) return  massimo;
  if (v < -massimo) return -massimo;
  return v;
}

uint8_t bottoneDi(int n) {
  if (n == 2) return MOUSE_RIGHT;
  if (n == 3) return MOUSE_MIDDLE;
  return MOUSE_LEFT;
}

void esegui(String r) {
  r.trim();
  if (r.length() == 0) return;
  char cmd = toupper(r.charAt(0));
  String resto = r.substring(1);
  resto.trim();

  if (cmd == 'M') {
    int sp = resto.indexOf(' ');
    if (sp < 0) { Serial.println("ERR argomenti"); return; }
    int dx = limita(resto.substring(0, sp).toInt(), MAX_PASSO);
    int dy = limita(resto.substring(sp + 1).toInt(), MAX_PASSO);
    if (dx == 0 && dy == 0) { Serial.println("OK"); return; }
    if (!consentiMovimento(abs(dx) + abs(dy))) {
      scarti++;
      Serial.println("ERR troppo veloce");
      return;
    }
    Mouse.move(dx, dy);
    mosse++;
    Serial.println("OK");
    return;
  }

  if (cmd == 'C') { Mouse.click(bottoneDi(resto.toInt())); clic++; Serial.println("OK"); return; }

  if (cmd == 'K') {
    uint8_t b = bottoneDi(resto.toInt());
    Mouse.click(b); delay(60); Mouse.click(b);
    clic++;
    Serial.println("OK");
    return;
  }

  if (cmd == 'T') {
    int sp = resto.indexOf(' ');
    if (sp < 0) { Serial.println("ERR argomenti"); return; }
    uint8_t b = bottoneDi(resto.substring(0, sp).toInt());
    if (resto.substring(sp + 1).toInt() == 1) Mouse.press(b);
    else Mouse.release(b);
    Serial.println("OK");
    return;
  }

  if (cmd == 'W') { Mouse.move(0, 0, resto.toInt()); Serial.println("OK"); return; }

  if (cmd == '?') {
    Serial.print("ST mosse "); Serial.print(mosse);
    Serial.print(" clic ");    Serial.print(clic);
    Serial.print(" scarti ");  Serial.print(scarti);
    Serial.print(" pos ");     Serial.print(posX, 3);
    Serial.print(" ");         Serial.print(posY, 3);
    Serial.print(" pinza ");   Serial.print(apertura, 0);
    Serial.print(arrestato ? " ARRESTATO" : " attivo");
    Serial.println();
    return;
  }

  /* ⚠️ ARRESTO IMMEDIATO.
   * Rilascia i pulsanti del mouse — uno rimasto premuto renderebbe il
   * computer inutilizzabile — e ferma il braccio dov'è. Chi usa Aurora
   * non può rimediare da solo a nessuna delle due cose. */
  if (cmd == 'S') {
    Mouse.release(MOUSE_LEFT);
    Mouse.release(MOUSE_RIGHT);
    Mouse.release(MOUSE_MIDDLE);
    arrestato = true;
    Serial.println("OK arresto");
    return;
  }

  /* ── BRACCIO ROBOTICO ── */

  if (cmd == 'P') {                       // posizione assoluta
    int s1 = resto.indexOf(' ');
    int s2 = resto.indexOf(' ', s1 + 1);
    if (s1 < 0 || s2 < 0) { Serial.println("ERR argomenti"); return; }
    arrestato = false;
    posX = resto.substring(0, s1).toFloat();
    posY = resto.substring(s1 + 1, s2).toFloat();
    posZ = resto.substring(s2 + 1).toFloat();
    applicaBraccio();
    Serial.println("OK");
    return;
  }

  if (cmd == 'D') {                       // spostamento relativo
    int s1 = resto.indexOf(' ');
    if (s1 < 0) { Serial.println("ERR argomenti"); return; }
    arrestato = false;
    posX += resto.substring(0, s1).toFloat();
    posY += resto.substring(s1 + 1).toFloat();
    if (posX < 0) posX = 0; if (posX > 1) posX = 1;
    if (posY < 0) posY = 0; if (posY > 1) posY = 1;
    applicaBraccio();
    Serial.println("OK");
    return;
  }

  if (cmd == 'G') {                       // pinza
    arrestato = false;
    apertura = resto.toFloat();
    if (apertura < 0) apertura = 0; if (apertura > 100) apertura = 100;
    applicaBraccio();
    Serial.println("OK");
    return;
  }

  if (cmd == 'B') {                       // uscita digitale
    int s1 = resto.indexOf(' ');
    if (s1 < 0) { Serial.println("ERR argomenti"); return; }
    int n = resto.substring(0, s1).toInt();
    int v = resto.substring(s1 + 1).toInt();
    if (n < 0 || n > 3) { Serial.println("ERR uscita inesistente"); return; }
    digitalWrite(PIN_USCITA[n], v ? HIGH : LOW);
    Serial.println("OK");
    return;
  }

  if (cmd == 'H') {                       // ritorno al riposo
    arrestato = false;
    posX = 0.5; posY = 0.5; posZ = 0.5; apertura = 50;
    applicaBraccio();
    Serial.println("OK riposo");
    return;
  }

  Serial.print("ERR comando sconosciuto: ");
  Serial.println(cmd);
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') { esegui(riga); riga = ""; }
    else if (riga.length() < 64) riga += c;
    else riga = "";              // riga assurdamente lunga: si scarta
  }
}
