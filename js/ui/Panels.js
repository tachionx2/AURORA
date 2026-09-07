/**
 * Panels.js — Viste Statistiche e Diagnostica.
 */

const h = (t, c, html) => { const e = document.createElement(t); if (c) e.className = c; if (html !== undefined) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

/* ============================== STATISTICHE ============================== */

export class StatsView {
  constructor(app) { this.app = app; }

  render() {
    const s = this.app.predictor.stats();

    // Le frasi si mostrano NELL'ORDINE IN CUI COMPAIONO nel menu
    // rapido, non per punteggio: chi le riordina deve vedere subito il
    // risultato di ciò che sta facendo.
    const phrases = document.getElementById('statPhrases');
    phrases.innerHTML = '';
    const list = this.app.predictor.phraseList();
    const shown = this.app.cfg.scan.phraseCount || 12;
    if (!list.length) {
      phrases.append(h('p', 'sub', 'Ancora niente. Aggiungine una qui sopra, oppure compaiono da sole appena vengono pronunciate.'));
    }
    list.forEach((p, i) => {
      const row = h('div', 'row');
      if (i === shown) {
        const sep = h('p', 'sub', `↓ oltre le prime ${shown}: non compaiono nel menu rapido`);
        sep.style.margin = '.5rem 0 .2rem';
        phrases.append(sep);
      }
      const k = h('span', 'k', esc(p.key));
      k.title = 'Tocca per rinominare';
      k.style.cursor = 'text';
      k.onclick = () => {
        const nuovo = prompt('Modifica la frase:', p.key);
        if (nuovo === null) return;
        if (this.app.predictor.renamePhrase(p.key, nuovo)) {
          this.app.persist(); this.app.refreshContext(); this.render();
        }
      };
      row.append(k, h('span', 'n', p.count));

      const ord = h('div', 'ord');
      const up = h('button', null, '▲'); up.title = 'Sposta in alto: si raggiunge prima';
      up.onclick = () => { this.app.predictor.movePhrase(p.key, -1); this.app.persist(); this.app.refreshContext(); this.render(); };
      const dn = h('button', null, '▼'); dn.title = 'Sposta in basso';
      dn.onclick = () => { this.app.predictor.movePhrase(p.key, 1); this.app.persist(); this.app.refreshContext(); this.render(); };
      ord.append(up, dn);

      const pin = h('button', p.pinned ? 'on' : '', '★');
      pin.title = p.pinned ? 'Fissata: non verrà rimossa automaticamente' : 'Fissa: non verrà rimossa automaticamente';
      pin.onclick = () => { this.app.predictor.pin('phrase', p.key, !p.pinned); this.app.persist(); this.render(); };
      const del = h('button', null, '×');
      del.title = 'Rimuovi';
      del.onclick = () => {
        if (!confirm(`Rimuovere "${p.key}"?`)) return;
        this.app.predictor.remove('phrase', p.key);
        this.app.persist(); this.app.refreshContext(); this.render();
      };
      row.append(ord, pin, del);
      phrases.append(row);
    });

    const auto = h('button', 'btn btn-sm', 'Ordine automatico per frequenza');
    auto.style.marginTop = '.6rem';
    auto.onclick = () => {
      this.app.predictor.clearPhraseOrder();
      this.app.persist(); this.app.refreshContext(); this.render();
    };
    phrases.append(auto);

    const words = document.getElementById('statWords');
    words.innerHTML = '';
    if (!s.words.length) words.append(h('p', 'sub', 'Il lessico personale si costruisce con l\'uso.'));
    for (const w of s.words) {
      const row = h('div', 'row');
      row.append(h('span', 'k', esc(w.key)), h('span', 'n', w.count));
      const del = h('button', null, '×');
      del.onclick = () => { this.app.predictor.remove('word', w.key); this.app.persist(); this.render(); };
      row.append(del);
      words.append(row);
    }

    const letters = document.getElementById('statLetters');
    letters.innerHTML = '';
    const max = s.letters[0]?.count || 1;
    for (const l of s.letters.slice(0, 26)) {
      const bar = h('div', 'bar');
      const track = h('div', 'track');
      const fill = h('i'); fill.style.width = `${(l.count / max) * 100}%`;
      track.append(fill);
      bar.append(h('span', 'ch', esc(l.key)), track, h('span', 'n', l.count));
      letters.append(bar);
    }

    const st = this.app.scan.stats;
    const dur = st.startedAt ? (performance.now() - st.startedAt) / 60000 : 0;
    const ksr = st.selections > 0 ? (st.predictionHits * 4) / (st.selections + st.predictionHits * 4) : 0;
    const metrics = [
      ['Selezioni', st.selections],
      ['Caratteri', st.chars],
      ['Annullamenti', st.undos],
      ['Da predizione', st.predictionHits],
      ['Car./min', dur > 0.05 ? (st.chars / dur).toFixed(1) : '—'],
      ['Risparmio stimato', st.selections ? `${Math.round(ksr * 100)}%` : '—'],
      ['Parole note', s.totals.words],
      ['Frasi note', s.totals.phrases],
    ];
    const mEl = document.getElementById('statSession');
    mEl.innerHTML = '';
    for (const [label, value] of metrics) {
      const m = h('div', 'metric');
      m.append(h('div', 'mv', esc(value)), h('div', 'ml', label));
      mEl.append(m);
    }
  }
}

/* ============================== DIAGNOSTICA ============================== */

/**
 * Classe di dimensione in base a quanto è lungo il valore.
 *
 * La finestrella è larga 150 px e il carattere a larghezza fissa
 * occupa circa 0,6 em per carattere: oltre una dozzina di caratteri
 * si esce, e i valori doppi ne hanno spesso quindici o più.
 */
function misuraTesto(v) {
  const t = String(v ?? '');
  /* ⚠️ I valori doppi vanno A CAPO, non rimpiccioliti fino a
   * illeggibilità.
   *
   * "0.01492 / 0.00587" a un carattere che ci stia su una riga sola
   * richiederebbe 0,59 rem: troppo piccolo per leggerlo di sfuggita
   * mentre si osserva un video. Su due righe restano sette caratteri
   * per riga, che stanno comodi a una misura leggibile.
   *
   * L'etichetta sotto dice già "SX / DX", quindi l'ordine si capisce
   * senza bisogno del separatore su una riga sola. */
  if (t.includes(' / ')) return 'cv-due';
  const n = t.length;
  if (n <= 12) return '';
  if (n <= 17) return 'cv-m';
  return 'cv-s';
}

export class DebugView {
  constructor(app) {
    this.app = app;
    this.events = [];
    this.lastRender = 0;
  }

  logEvent(text, warn = false) {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    this.events.unshift({ ts, text, warn });
    if (this.events.length > 120) this.events.pop();
    const el = document.getElementById('eventLog');
    if (!el) return;
    el.innerHTML = this.events.map(e =>
      `<div class="${e.warn ? 'warn' : ''}">${e.ts} <b>${esc(e.text)}</b></div>`).join('');
  }

  renderCounters() {
    if (!this.app.cfg.ui.showCounters) return;
    const now = performance.now();
    if (now - this.lastRender < 200) return;    // 5 Hz: non serve di più
    this.lastRender = now;

    const g = this.app.gestures.counters;
    const vp = this.app.vision;
    const sig = this.app.lastSignal || {};
    // framesValid è contato una volta per fotogramma, non per occhio:
    // la percentuale non può più superare il 100%.
    const validPct = g.framesTotal ? Math.min(100, Math.round(100 * g.framesValid / g.framesTotal)) : 0;

    const bs = this.app.gestures.blinkStatus();
    const items = [
      ['Sorgente', vp.status],
      ['FPS', vp.fps ? vp.fps.toFixed(1) : '—'],
      ['Elab.', vp.procMs ? `${vp.procMs.toFixed(1)} ms` : '—'],
      ['Frame totali', g.framesTotal],
      ['Frame validi', `${validPct}%`],
      // Tempo cumulato con l'occhio chiuso, separato per occhio: è il
      // dato leggibile, a differenza di un conteggio di fotogrammi.
      ['SX chiuso', `${(g.closedMsLeft / 1000).toFixed(1)} s`],
      ['DX chiuso', `${(g.closedMsRight / 1000).toFixed(1)} s`],
      // Per occhio: un occhio che non contribuisce si vede subito.
      ['Singoli SX / DX', `${g.blinkSingleLeft ?? 0} / ${g.blinkSingleRight ?? 0}`],
      ['Doppi SX / DX', `${g.blinkDoubleLeft ?? 0} / ${g.blinkDoubleRight ?? 0}`],
      ['Tripli SX / DX', `${g.blinkTripleLeft ?? 0} / ${g.blinkTripleRight ?? 0}`],
      ['Brevi SX / DX', `${g.blinkShortLeft ?? 0} / ${g.blinkShortRight ?? 0}`],
      ['Lunghi SX / DX', `${g.blinkLongLeft ?? 0} / ${g.blinkLongRight ?? 0}`],
      // Rendono visibile dove è finita una chiusura che non è stata
      // contata: senza, sembra che i contatori non funzionino.
      ['Scartati: abbassamento sostenuto', g.burstAborted ?? 0],
      ['Agganci sciolti d\'ufficio', g.latchReleased ?? 0],
      // Costo misurato del rilevamento: dice quanto costano davvero le
      // espressioni del viso su QUESTO dispositivo, invece di stimarlo.
      ['Rilevamento', `${(this.app.vision?.rgb?.msMedio ?? 0).toFixed(1)} ms`],
      /* ⚠️ SIGMA e BASELINE, in chiaro.
       *
       * Il grafico mostra il segnale diviso per sigma. Se sigma cresce,
       * TUTTO si abbassa — movimento e rumore insieme — e sembra che la
       * persona si muova meno mentre si muove uguale. Senza vedere
       * questi due numeri è impossibile distinguere "il movimento è
       * calato" da "il metro è cambiato". */
      // Errori nel ciclo dei fotogrammi: prima uccidevano il ciclo in
      // silenzio, ora vengono assorbiti — ma devono restare visibili.
      ['Errori fotogramma', this.app.vision?.source?.errori ?? 0],
      // Blocchi del video e riprese automatiche: se crescono, il file
      // si sta impuntando e il programma lo sta rimettendo in moto.
      // Ultimo evento del video: dice cosa ha fatto l'elemento nel
      // momento in cui si è fermato.
      ['Ultimo evento video', this.app.vision?.source?.ultimoEvento ?? '—'],
      ['Video bloccato / ripreso', `${this.app.vision?.source?.bloccati ?? 0} / ${this.app.vision?.source?.riprese ?? 0}`],
      /* ⚠️ Fotogrammi VALIDI per occhio.
       * Un occhio i cui campioni vengono scartati spesso — luce
       * peggiore, iride più coperta — mostra un'ampiezza più bassa
       * senza che il movimento sia diverso. Senza questo numero
       * sembrerebbe che quell'occhio si muova di meno. */
      ['Validi SX / DX', (() => {
        const c = this.app.gestures?.counters || {};
        const vl = c.validiLeft ?? 0, vr = c.validiRight ?? 0;
        const sl = c.scartatiLeft ?? 0, sr = c.scartatiRight ?? 0;
        const pl = (vl + sl) ? Math.round(100 * vl / (vl + sl)) : 0;
        const pr = (vr + sr) ? Math.round(100 * vr / (vr + sr)) : 0;
        return `${pl}% / ${pr}%`;
      })()],
      /* ⚠️ Schiacciamento dell'iride: quanto la palpebra la copre.
       *
       * È il numero da guardare per decidere se accendere la
       * ricostruzione del centro. A iride intera vale circa 1; più
       * scende, più la palpebra sta tagliando. La soglia va messa
       * SOTTO il valore che si legge a occhio in posizione normale e
       * SOPRA quello che si legge a sguardo alzato. */
      ['Palpebra copre iride SX / DX', (() => {
        const m = (lato) => {
          const a = this.app.vision?.rgb?.stato?.[lato]?.copSopra;
          if (!a?.length) return '—';
          const v = a.reduce((x, y) => x + y, 0) / a.length;
          return (v * 100).toFixed(0) + '%';
        };
        return `${m('left')} / ${m('right')}`;
      })()],
      ['Iride corretta SX / DX', (() => {
        const q = (lato) => {
          const st = this.app.vision?.rgb?.stato?.[lato];
          if (!st?.totali) return '—';
          return Math.round(100 * (st.corretti || 0) / st.totali) + '%';
        };
        return `${q('left')} / ${q('right')}`;
      })()],
      ['Sigma SX / DX', `${(this.app.gestures?.eyes?.left?.y?.sigma ?? 0).toFixed(5)} / ${(this.app.gestures?.eyes?.right?.y?.sigma ?? 0).toFixed(5)}`],
      ['Baseline SX / DX', `${(this.app.gestures?.eyes?.left?.y?.baseline ?? 0).toFixed(4)} / ${(this.app.gestures?.eyes?.right?.y?.baseline ?? 0).toFixed(4)}`],
      /* ⚠️ Segnale grezzo per ENTRAMBI gli occhi.
       *
       * È il numero che distingue le due cause possibili quando un
       * occhio mostra un'ampiezza minore: se il grezzo è simile e solo
       * il sigma differisce, il movimento è uguale e il problema sta
       * nella stima del rumore; se il grezzo differisce, allora è il
       * rilevamento a vedere davvero un movimento più piccolo. */
      ['Segnale grezzo SX / DX', `${(this.app.gestures?.eyes?.left?.y?.smooth ?? 0).toFixed(4)} / ${(this.app.gestures?.eyes?.right?.y?.smooth ?? 0).toFixed(4)}`],
      ['Scostamento SX / DX', `${(this.app.gestures?.eyes?.left?.y?.disp ?? 0).toFixed(4)} / ${(this.app.gestures?.eyes?.right?.y?.disp ?? 0).toFixed(4)}`],
      ['Viso soppressi', g.visoSoppressi ?? 0],
      ['Apertura riposo SX', bs.left.openRef !== null ? bs.left.openRef.toFixed(3) : 'calibrando…'],
      ['Soglia chiusura SX', bs.left.calibrated ? bs.left.threshold.toFixed(3) : '—'],
      ['Apertura riposo DX', bs.right.openRef !== null ? bs.right.openRef.toFixed(3) : 'calibrando…'],
      ['Soglia chiusura DX', bs.right.calibrated ? bs.right.threshold.toFixed(3) : '—'],
      ['Occhio dominante', this.app.gestures.dominant || '—'],
      ['SNR sx', (this.app.gestures.snr.left || 0).toFixed(2)],
      ['SNR dx', (this.app.gestures.snr.right || 0).toFixed(2)],
      ['σ corrente', sig.sigma !== undefined ? sig.sigma.toFixed(5) : '—'],
      ['Spostamento', sig.n !== undefined ? `${sig.n.toFixed(2)}σ` : '—'],
      ['Gesti accettati', Object.values(g.gestures).reduce((a, b) => a + b, 0)],
      ['Gesti scartati', g.rejected],
      ['Passo scansione', `${Math.round(this.app.scan.timing.current)} ms`],
    ];
    for (const [k, v] of Object.entries(g.gestures)) items.push([`↳ ${k}`, v]);

    // Stato per canale: quale occhio sta superando quale soglia, adesso.
    const ch = this.app.gestures.channels();
    for (const eye of ['left', 'right']) {
      const tag = eye === 'left' ? 'SX' : 'DX';
      for (const [d, arrow] of [['up','↑'],['down','↓'],['left','←'],['right','→'],
                                ['wide','⬍+'],['narrow','⬍−'],['combo','Σ']]) {
        const c = ch[`${eye}.${d}`];
        if (!c) continue;
        items.push([`${tag} ${arrow}`, `${c.n.toFixed(2)}σ${c.active ? ' ●' : ''}`]);
      }
    }
    if (g.lastRejectReason) items.push(['Ultimo scarto', g.lastRejectReason]);

    const el = document.getElementById('counters');
    if (!el) return;
    el.innerHTML = items.map(([l, v]) =>
      /* ⚠️ Il testo si adatta alla lunghezza.
       *
       * I valori doppi — "0.0150 / 0.0142" — non entravano nei 150 px
       * della finestrella e venivano troncati: si leggeva il valore
       * dell'occhio sinistro e del destro restavano i puntini. Proprio
       * il confronto fra i due occhi, che è la cosa più utile da
       * guardare, era l'unica che non si poteva fare. */
      `<div class="counter"><div class="cv ${misuraTesto(v)}">${esc(v)}</div><div class="cl">${esc(l)}</div></div>`).join('');
  }

  updateTags(res) {
    const set = (id, o) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = o ? `conf ${o.confidence.toFixed(2)} · ap ${o.openness.toFixed(2)}` : 'non rilevato';
    };
    set('tagLeft', res?.left);
    set('tagRight', res?.right);
  }
}
