#!/usr/bin/env python3
"""
aurora-mouse.py — Ponte fra Aurora e il mouse del computer.

═══════════════════════════════════════════════════════════════════
A COSA SERVE
═══════════════════════════════════════════════════════════════════

Una pagina web non può muovere il cursore del sistema: non esiste
alcuna interfaccia per farlo, e non esisterà, perché sarebbe la fine
della sicurezza del web.

Questo programmino sta fuori dal browser, riceve da Aurora cinque
comandi in testo semplice, e muove il mouse per davvero. Chi controlla
lo sguardo può così usare internet, aprire cartelle, comandare
qualunque programma — non solo Aurora.

Funziona anche quando la finestra di Aurora è ridotta o in secondo
piano: il ponte è indipendente da ciò che il browser sta mostrando.

═══════════════════════════════════════════════════════════════════
COME SI USA
═══════════════════════════════════════════════════════════════════

  pip install websockets pyautogui
  python aurora-mouse.py

Poi in Aurora: Impostazioni → Dispositivo → collegamento "ponte".
L'indirizzo predefinito è già quello giusto.

Su Linux può servire anche:  pip install python-xlib
Su macOS va concesso il permesso in Impostazioni di Sistema →
Privacy e Sicurezza → Accessibilità.

═══════════════════════════════════════════════════════════════════
PROTOCOLLO — una riga per comando
═══════════════════════════════════════════════════════════════════

  M <dx> <dy>     sposta il cursore, in pixel
  C <n>           clic: 1 sinistro, 2 destro, 3 centrale
  K <n>           doppio clic
  T <n> <0|1>     tiene premuto (1) o rilascia (0)
  W <n>           rotellina, positivo verso l'alto
  ?               richiesta di stato

Risposte:  OK  ·  ERR <testo>  ·  ST <x> <y>

═══════════════════════════════════════════════════════════════════
⚠️ SICUREZZA
═══════════════════════════════════════════════════════════════════

Questo programma muove il mouse del computer. Tre protezioni:

  1. ascolta SOLO su 127.0.0.1 — nessuno dalla rete può raggiungerlo;
  2. limita quanto il cursore può spostarsi in un secondo, così un
     guasto del rilevamento non fa impazzire il puntatore;
  3. si ferma premendo Ctrl+C, e portando il mouse in un angolo dello
     schermo (protezione di pyautogui).
"""

import asyncio
import sys
import time

INDIRIZZO = '127.0.0.1'
PORTA = 8089
PERCORSO = '/device'

# Quanto può muoversi il cursore in un secondo, in pixel. Un guasto del
# rilevamento non deve poter far attraversare lo schermo al puntatore
# decine di volte al secondo.
MAX_PIXEL_AL_SECONDO = 4000
# Tetto per singolo comando: una seconda difesa, indipendente.
MAX_PASSO = 200

try:
    import websockets
except ImportError:
    sys.exit('Manca "websockets".  Installa con:  pip install websockets')

try:
    import pyautogui
    pyautogui.FAILSAFE = True      # angolo dello schermo = arresto
    pyautogui.PAUSE = 0            # nessuna pausa: la fluidità conta
except ImportError:
    sys.exit('Manca "pyautogui".  Installa con:  pip install pyautogui')


class LimiteVelocita:
    """Impedisce al cursore di muoversi più di quanto sia sensato.

    Non è una formalità: chi usa questo ponte non può prendere il mouse
    e rimetterlo a posto. Se il rilevamento impazzisce, il cursore deve
    rallentare da solo.
    """

    def __init__(self, max_al_secondo):
        self.max = max_al_secondo
        self.credito = max_al_secondo
        self.ultimo = time.monotonic()

    def consenti(self, distanza):
        ora = time.monotonic()
        self.credito = min(self.max, self.credito + (ora - self.ultimo) * self.max)
        self.ultimo = ora
        if distanza <= self.credito:
            self.credito -= distanza
            return True
        return False


limite = LimiteVelocita(MAX_PIXEL_AL_SECONDO)
BOTTONI = {1: 'left', 2: 'right', 3: 'middle'}
statistiche = {'mosse': 0, 'clic': 0, 'scarti': 0}


def esegui(riga: str) -> str:
    """Esegue un comando. Non solleva MAI: risponde con ERR."""
    parti = riga.strip().split()
    if not parti:
        return 'ERR vuoto'
    cmd = parti[0].upper()

    try:
        if cmd == 'M':
            dx, dy = int(float(parti[1])), int(float(parti[2]))
            dx = max(-MAX_PASSO, min(MAX_PASSO, dx))
            dy = max(-MAX_PASSO, min(MAX_PASSO, dy))
            if dx == 0 and dy == 0:
                return 'OK'
            if not limite.consenti(abs(dx) + abs(dy)):
                statistiche['scarti'] += 1
                return 'ERR troppo veloce'
            pyautogui.moveRel(dx, dy, duration=0)
            statistiche['mosse'] += 1
            return 'OK'

        if cmd == 'C':
            pyautogui.click(button=BOTTONI.get(int(parti[1]), 'left'))
            statistiche['clic'] += 1
            return 'OK'

        if cmd == 'K':
            pyautogui.doubleClick(button=BOTTONI.get(int(parti[1]), 'left'))
            statistiche['clic'] += 1
            return 'OK'

        if cmd == 'T':
            bottone = BOTTONI.get(int(parti[1]), 'left')
            if parti[2] == '1':
                pyautogui.mouseDown(button=bottone)
            else:
                pyautogui.mouseUp(button=bottone)
            return 'OK'

        if cmd == 'W':
            pyautogui.scroll(int(float(parti[1])) * 40)
            return 'OK'

        if cmd == '?':
            x, y = pyautogui.position()
            return f'ST {x} {y}'

        # Comandi del braccio robotico: riconosciuti e ignorati, così lo
        # stesso ponte può servire a entrambi senza dare errori.
        if cmd in ('P', 'D', 'G', 'B', 'H', 'S'):
            return 'OK'

        return f'ERR comando sconosciuto: {cmd}'

    except pyautogui.FailSafeException:
        return 'ERR arresto di sicurezza (mouse in un angolo)'
    except (IndexError, ValueError):
        return f'ERR argomenti non validi: {riga.strip()}'
    except Exception as e:                                   # noqa: BLE001
        return f'ERR {e}'


async def servi(ws):
    indirizzo = getattr(ws, 'remote_address', ('?',))[0]
    print(f'  ← Aurora collegata da {indirizzo}')
    try:
        async for messaggio in ws:
            # Possono arrivare più righe insieme: si eseguono in ordine.
            for riga in str(messaggio).splitlines():
                if riga.strip():
                    await ws.send(esegui(riga))
    except Exception:                                        # noqa: BLE001
        pass
    finally:
        # ⚠️ Se il collegamento cade con un pulsante premuto, resterebbe
        # premuto per sempre: il computer diventerebbe inutilizzabile.
        for b in BOTTONI.values():
            try:
                pyautogui.mouseUp(button=b)
            except Exception:                                # noqa: BLE001
                pass
        print('  → Aurora scollegata (pulsanti rilasciati)')


async def principale():
    larghezza, altezza = pyautogui.size()
    print('╭───────────────────────────────────────────────╮')
    print('│  Aurora — ponte per il mouse                   │')
    print('╰───────────────────────────────────────────────╯')
    print(f'  schermo: {larghezza}×{altezza}')
    print(f'  in ascolto su ws://{INDIRIZZO}:{PORTA}{PERCORSO}')
    print('  (solo dal computer locale: nessuno dalla rete può connettersi)')
    print()
    print('  In Aurora: Impostazioni → Dispositivo → collegamento "ponte"')
    print('  Per fermare: Ctrl+C, oppure porta il mouse in un angolo')
    print()

    async with websockets.serve(servi, INDIRIZZO, PORTA):
        await asyncio.Future()


if __name__ == '__main__':
    try:
        asyncio.run(principale())
    except KeyboardInterrupt:
        print(f"\n  fermato · mosse {statistiche['mosse']} · "
              f"clic {statistiche['clic']} · scartate {statistiche['scarti']}")
