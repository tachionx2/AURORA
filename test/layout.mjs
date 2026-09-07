/**
 * Bilancio verticale delle schede a schermata fissa (Parla e Punta).
 * Riproduce la matematica delle clamp() del CSS: nessuna deve mai
 * richiedere scorrimento, a nessuno zoom.
 */
const cl=(mn,v,mx)=>Math.max(mn,Math.min(v,mx));
const REM=16;
let pass=0, fail=0;
const ok=(c,m)=>{ if(c) pass++; else {fail++; console.log('  ✗ '+m);} };

function header(H,rem,vh){
  const padV=cl(rem(.3),vh(.8),rem(.6));
  const chipF=cl(rem(.6),vh(1.3),rem(.72));
  const chipH=chipF+rem(.6)+2;
  const brandH=Math.max(rem(1)*1.4,chipH,16);
  const tabPad=cl(rem(.35),vh(1),rem(.6));
  const tabF=cl(rem(.85),vh(2.1),rem(1.15));   // schede piu grandi
  return 2*padV+brandH+rem(.6)+(2*tabPad+tabF*1.4+3)+1;
}

function parla(w,h,z,leggi=1){
  const W=w/z,H=h/z, vh=x=>H*x/100, vw=x=>W*x/100, rem=x=>x*REM;
  const hdr=header(H,rem,vh);
  const panPad=cl(rem(.4),vh(1.2),rem(1.1)), gap=cl(rem(.35),vh(1),rem(.9));
  const cPad=cl(rem(.5),vh(1.4),rem(1.1));
  const sentF=cl(rem(1.05),Math.min(vw(3.4),vh(3.4)),rem(2.2))*leggi;
  const curF=cl(rem(.95),Math.min(vw(2.5),vh(2.5)),rem(1.6))*leggi;
  const compose=2*cPad+sentF*2.4+rem(.2)+curF*1.4+2;
  const btnPad=cl(rem(.45),vh(1.3),rem(.85)), btnF=cl(rem(.78),vh(1.8),rem(1));
  const btnH=2*btnPad+btnF*1.4+2, btnGap=cl(rem(.25),vh(.8),rem(.6));
  const minBtn=W<=520?Math.max(70,(W-2*panPad)*0.29):100;
  const rows=Math.ceil(6/Math.max(1,Math.floor((W-2*panPad)/minBtn)));
  const controls=rows*btnH+(rows-1)*btnGap;
  const cam=2*rem(.5)+rem(.85)*1.4+2, hint=cl(rem(.68),vh(1.5),rem(.85))*1.4;
  const fixed=hdr+2*panPad+4*gap+compose+controls+cam+hint;
  return { stage:H-fixed, glyph:Math.min(vw(15),vh(22),rem(9))*leggi };
}

function punta(w,h,z){
  const W=w/z,H=h/z, vh=x=>H*x/100, vw=x=>W*x/100, rem=x=>x*REM;
  const hdr=header(H,rem,vh);
  const panPad=cl(rem(.4),vh(1.1),rem(.9)), gap=cl(rem(.3),vh(.9),rem(.7));
  // riga alta: modalità + azioni + stato (può andare su due righe)
  const modeH=2*cl(rem(.3),vh(.9),rem(.5))+cl(rem(.75),vh(1.6),rem(.9))*1.4;
  const smallBtn=2*rem(.5)+rem(.85)*1.4+2;
  const topRows = W<980 ? 2 : 1;   // tre modalità + quattro azioni
  const top=topRows*Math.max(modeH,smallBtn)+(topRows-1)*4;
  // composizione
  const cPad=cl(rem(.5),vh(1.4),rem(1));
  const sentF=cl(rem(1.2),Math.min(vw(3.6),vh(4)),rem(2.4));
  const letF=cl(rem(1),Math.min(vw(2.8),vh(3)),rem(1.8));
  const compose=2*cPad+sentF*2.5+rem(.15)+letF*1.2+2;
  // barra in basso
  const btnPad=cl(rem(.45),vh(1.3),rem(.85)), btnF=cl(rem(.78),vh(1.8),rem(1));
  const bottom=2*btnPad+btnF*1.4+2;
  const fixed=hdr+2*panPad+3*gap+top+compose+bottom;
  // 4 o 5 righe di tastiera (con riga numeri)
  return { kb:H-fixed, minKb: 5*Math.max(26, cl(rem(.9),vh(3.4),rem(1.6))*1.6) };
}

function guarda(w,h,z){
  const W=w/z,H=h/z, vh=x=>H*x/100, rem=x=>x*REM;
  const hdr=header(H,rem,vh);
  const panPad=cl(rem(.4),vh(1.1),rem(.9)), gap=cl(rem(.3),vh(.9),rem(.7));
  // intestazione: titolo + sottotitolo + pulsanti (due righe su schermi stretti)
  const titolo=cl(rem(1),vh(2.4),rem(1.4))*1.4;
  const sub=cl(rem(.7),vh(1.5),rem(.85))*1.5*(W<820?2:1);
  const btn=2*rem(.5)+rem(.85)*1.4+2;
  const testa=titolo+sub+(W<820?btn+6:0);
  const fixed=hdr+2*panPad+gap+testa;
  // il corpo (preferiti + visualizzatore) prende tutto il resto
  return { corpo:H-fixed, min: W<900 ? 220 : 180 };
}

const cases=[['Desktop 1920×1080',1920,1080],['Laptop 1440×900',1440,900],
  ['Laptop 1366×768',1366,768],['Netbook 1280×720',1280,720],
  ['iPad 820×1180',820,1180],['iPhone 390×844',390,844],
  ['Android 360×740',360,740],['Piccolo 360×640',360,640]];

console.log('schermo                zoom │ Parla: palco/glifo │ Punta: tastiera/min │ Guarda');
console.log('────────────────────────────┼────────────────────┼─────────────────────┼───────');
for(const [n,w,h] of cases){
  for(const z of [1,1.1,1.2,1.5]){
    const a=parla(w,h,z), b=punta(w,h,z), c2=guarda(w,h,z);
    const okA=a.stage>=a.glyph+40, okB=b.kb>=b.minKb*0.8, okC=c2.corpo>=c2.min;
    ok(okA, `${n} @${Math.round(z*100)}% — Parla non entra (palco ${Math.round(a.stage)} < glifo ${Math.round(a.glyph)})`);
    ok(okB, `${n} @${Math.round(z*100)}% — Punta non entra (tastiera ${Math.round(b.kb)} < minimo ${Math.round(b.minKb*0.8)})`);
    ok(okC, `${n} @${Math.round(z*100)}% — Guarda non entra (corpo ${Math.round(c2.corpo)} < minimo ${c2.min})`);
    if(z===1.2) console.log(`${n.padEnd(21)} ${String(Math.round(z*100)+'%').padStart(5)} │ ${String(Math.round(a.stage)).padStart(8)} / ${String(Math.round(a.glyph)).padStart(6)} │ ${String(Math.round(b.kb)).padStart(9)} / ${String(Math.round(b.minKb*0.8)).padStart(7)} │ ${String(Math.round(c2.corpo)).padStart(7)}`);
  }
}
/* ── Ingrandire il testo NON deve richiedere lo scorrimento ──
 * `--fit` è la rete: quando il contenuto eccede, il programma
 * rimpicciolisce quel tanto che basta. Qui si verifica che la rete
 * basti, cioè che il fattore necessario resti ragionevole invece di
 * schiacciare il testo fino a renderlo illeggibile.                */
console.log();
console.log('ingrandimento del testo — fattore di adattamento necessario:');
console.log('schermo                 1,0×    1,5×    2,0×    2,5×');
for(const [n,w,h] of cases){
  const riga=[];
  for(const leggi of [1,1.5,2,2.5]){
    const a=parla(w,h,1.2,leggi);
    // Il palco deve contenere il glifo: se non basta, --fit lo riduce.
    const serve = a.stage>0 ? Math.min(1, (a.stage-40)/Math.max(1,a.glyph)) : 0;
    riga.push(serve>=1 ? ' 1,00' : serve.toFixed(2).replace('.',','));
    // Anche al massimo ingrandimento deve restare leggibile: il
    // fattore non deve scendere sotto 0,35, altrimenti si sarebbe
    // ingrandito per nulla.
    ok(serve>0.35, `${n} a ${leggi}× — adattamento troppo aggressivo (${serve.toFixed(2)})`);
  }
  console.log('  '+n.padEnd(22)+riga.map(x=>String(x).padStart(6)).join(' '));
}

console.log(`\n${pass} superati, ${fail} falliti`);
process.exit(fail?1:0);
