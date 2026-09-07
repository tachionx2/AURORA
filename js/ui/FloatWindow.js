/**
 * FloatWindow.js — Finestra compatta sempre in primo piano.
 *
 * ══════════════════════════════════════════════════════════════════
 * IL PROBLEMA CHE RISOLVE
 * ══════════════════════════════════════════════════════════════════
 *
 * Chi controlla il cursore con gli occhi vuole navigare in internet o
 * nel sistema operativo, non solo dentro Aurora. Ma appena la finestra
 * del browser va in secondo piano succede una cosa che pochi si
 * aspettano: `requestAnimationFrame` **si ferma del tutto**. Il ciclo
 * video di Aurora si basa su quello, quindi il riconoscimento oculare
 * si spegne — la telecamera resta accesa, ma nessuno guarda più i
 * fotogrammi.
 *
 * Risultato: chi apre un'altra applicazione perde il controllo, e non
 * ha più modo di tornare indietro. Esattamente il contrario di ciò che
 * serve.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA SOLUZIONE
 * ══════════════════════════════════════════════════════════════════
 *
 * Chrome ed Edge da desktop offrono una finestra fluttuante che sta
 * SOPRA tutte le altre applicazioni e può contenere elementi scelti da
 * noi. Essendo visibile **non viene rallentata**: il ciclo continua.
 *
 * Ci si mette dentro un pannello minimo — la voce corrente, lo stato,
 * pochi comandi — e lo si lascia in un angolo dello schermo. Aurora
 * resta viva mentre la persona usa il computer.
 *
 * ⚠️ Limiti da conoscere:
 *   · solo Chrome ed Edge da computer, non da telefono;
 *   · la finestra NON può essere trasparente né senza bordi: per
 *     quello servirebbe un programma fuori dal browser;
 *   · si apre solo in risposta a un gesto della persona, mai da sola.
 */

export function finestraSupportata() {
  return typeof globalThis !== 'undefined'
    && 'documentPictureInPicture' in globalThis;
}

export class FinestraFluttuante {
  /**
   * @param opzioni {{ onApri, onChiudi, larghezza, altezza }}
   */
  constructor(opzioni = {}) {
    this.opz = opzioni;
    this.win = null;
    this.origine = null;      // dove stava l'elemento prima
    this.segnaposto = null;
    this.elemento = null;
  }

  get aperta() { return !!this.win && !this.win.closed; }

  /**
   * Sposta un elemento della pagina nella finestra fluttuante.
   *
   * Si SPOSTA, non si duplica: due copie dello stesso pannello
   * andrebbero tenute allineate, e prima o poi divergerebbero. Al
   * ritorno l'elemento torna esattamente dov'era, grazie a un
   * segnaposto lasciato al suo posto.
   */
  async apri(elemento, { larghezza = 380, altezza = 260, stili = [] } = {}) {
    if (!finestraSupportata()) {
      return { ok: false, motivo: 'Questa funzione richiede Chrome o Edge da computer.' };
    }
    if (this.aperta) return { ok: true, motivo: 'già aperta' };
    if (!elemento) return { ok: false, motivo: 'nessun pannello da mostrare' };

    try {
      this.win = await globalThis.documentPictureInPicture.requestWindow({
        width: Math.round(larghezza),
        height: Math.round(altezza),
      });
    } catch (e) {
      // Serve un gesto della persona: senza, il browser rifiuta.
      return { ok: false, motivo: e?.message || 'apertura non consentita' };
    }

    // Gli stili non seguono l'elemento: vanno copiati.
    try {
      for (const foglio of document.styleSheets) {
        try {
          const regole = [...foglio.cssRules].map(r => r.cssText).join('\n');
          const st = this.win.document.createElement('style');
          st.textContent = regole;
          this.win.document.head.append(st);
        } catch {
          // Foglio di altra origine: si rimanda al file, che il browser
          // caricherà da sé.
          if (foglio.href) {
            const l = this.win.document.createElement('link');
            l.rel = 'stylesheet'; l.href = foglio.href;
            this.win.document.head.append(l);
          }
        }
      }
      for (const extra of stili) {
        const st = this.win.document.createElement('style');
        st.textContent = extra;
        this.win.document.head.append(st);
      }
    } catch { /* senza stili è brutta ma funziona */ }

    // Segnaposto: al ritorno l'elemento va rimesso esattamente qui.
    this.elemento = elemento;
    this.origine = elemento.parentNode;
    this.segnaposto = document.createComment('finestra-fluttuante');
    this.origine.insertBefore(this.segnaposto, elemento);

    this.win.document.body.classList.add('in-finestra');
    this.win.document.body.append(elemento);

    this.win.addEventListener('pagehide', () => this._riporta());
    this.opz.onApri?.(this.win);
    return { ok: true };
  }

  chiudi() {
    if (!this.aperta) { this._riporta(); return; }
    try { this.win.close(); } catch {}
    this._riporta();
  }

  /** Rimette il pannello dov'era. Sicuro anche se chiamato due volte. */
  _riporta() {
    try {
      if (this.elemento && this.segnaposto?.parentNode) {
        this.segnaposto.parentNode.insertBefore(this.elemento, this.segnaposto);
        this.segnaposto.remove();
      }
    } catch {}
    this.segnaposto = null;
    this.elemento = null;
    this.origine = null;
    const w = this.win;
    this.win = null;
    if (w) this.opz.onChiudi?.();
  }
}
