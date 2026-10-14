# Dati dei "suggerimenti che capiscono la frase"

Qui c'è lo script che costruisce i tre file di dati usati dai
suggerimenti di parola. **Non serve per usare Aurora**: i file sono già
pronti in `js/lang/`. Serve solo a chi volesse rigenerarli o migliorarli.

| file | cosa sa | fonte | licenza della fonte |
|---|---|---|---|
| `js/lang/semantica-it.js` | il **significato** delle parole: "chiesa" è vicina a "pregare" | vettori fastText per l'italiano di Explosion, nel modello spaCy `it_core_news_lg` 3.7.0 (solo i vettori) | **CC0**, pubblico dominio |
| `js/lang/grammatica-it.js` | la **grammatica**: dopo "in" viene un nome, dopo "io" un verbo in -o | treebank Universal Dependencies: MarkIT, TWITTIRO, PUD, ParlaMint | CC BY 4.0, CC BY-SA 4.0, CC BY-SA 3.0, CC BY-SA 4.0 |
| `js/lang/coppie-it.js` | le **espressioni** dell'italiano reale: "mal di testa", "a pregare" | frasi italiane di Mozilla Common Voice (`server/data/it`) | **CC0**, pubblico dominio |

Per le licenze CC BY-SA, `grammatica-it.js` è distribuito sotto
**CC BY-SA 4.0**, come opera separata dentro Aurora. Le intestazioni dei
file lo dichiarano.

**Escluse di proposito**, anche se disponibili:
- i treebank ISDT, VIT, PoSTWITA e ParTUT, gratuiti ma **non commerciali**
  (CC BY-NC-SA);
- il corpus MITADS, che contiene sottotitoli di OpenSubtitles con
  licenza non chiara;
- Valico, italiano scritto da studenti stranieri, con errori.

## Come rigenerarli

1. Prepara una cartella di dati, per esempio `dati/`, con:
   - `it_core_news_lg-3.7.0/` — scompatta il pacchetto
     `https://github.com/explosion/spacy-models/releases/download/it_core_news_lg-3.7.0/it_core_news_lg-3.7.0-py3-none-any.whl`
     (è uno zip) e prendi la cartella `it_core_news_lg/it_core_news_lg-3.7.0`;
   - i treebank, ognuno con il nome `UD_<nome>_<parte>.conllu`, da
     `https://raw.githubusercontent.com/UniversalDependencies/UD_Italian-<nome>/master/it_<nome minuscolo>-ud-<parte>.conllu`:
     `MarkIT train`, `TWITTIRO train`, `PUD test`, `ParlaMint train`, `ParlaMint test`;
   - `cv/wiki.it.txt` e `cv/sentence-collector.txt`, da
     `https://raw.githubusercontent.com/common-voice/common-voice/main/server/data/it/`.
2. `pip install numpy scipy scikit-learn spacy`
3. `python3 strumenti/suggerimenti/costruisci.py dati tutto`
   (circa due minuti). Si può rigenerarne uno solo: `semantica`,
   `grammatica` oppure `coppie`.

Lo script legge il vocabolario dei suggerimenti direttamente da
`js/lang/vocabolario-it.js` e `js/lang/seed-it.js`: se quelli cambiano,
vanno rigenerati anche questi tre file.

## Come è stato tarato

I pesi in `Predictor.suggerisci()` (fonti 8-10) sono stati scelti
misurando, non a intuito, su tre banchi:
- le frasi di assistenza di `test/dati/frasi-banco.txt`;
- frasi vere dei treebank liberi (MarkIT e TWITTIRO, parti *dev* e
  *test*, mai usate per costruire i dati);
- frasi vere del treebank ISDT (parte *test*), usato **solo per
  misurare** e mai distribuito.

Per ogni parola si misura se la proposta a voce è giusta dopo 2 e dopo 3
lettere, se la parola è nel gruppo Suggerimenti, e quante lettere si
risparmiano. Rispetto alla versione precedente, le parole piene giuste al
primo colpo dopo due lettere sono passate dal 18% al 42% sulle frasi di
assistenza e dall'8% al 24% sui testi veri.
