"use strict";

/**
 * PetriKlar · stats.js
 * Statistiken, Personal Best und Erfolgskennzahlen.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
/* ===================== Statistik ===================== */
function fishCatches(){ return loadCatches().filter(isFish); }
function topBy(arr, keyFn, n){
  const m={}; arr.forEach(x=>{ const k=keyFn(x); if(k==null) return; const key=String(k).trim(); if(!key) return; m[key]=(m[key]||0)+1; });
  return Object.keys(m).map(k=>({key:k, count:m[k]})).sort((a,b)=>b.count-a.count).slice(0, n||99);
}
function statsByFish(){
  const byFish={};
  fishCatches().forEach(c=>{ const f=(c.fischart||"").trim(); if(!f) return; (byFish[f]=byFish[f]||[]).push(c); });
  return Object.keys(byFish).map(f=>({
    fisch:f, total:byFish[f].length,
    spots: topBy(byFish[f], c=>c.angelplatz, 3),
    baits: topBy(byFish[f], c=>c.koeder, 3)
  })).sort((a,b)=>b.total-a.total);
}
/* Köder-Empfehlung nur wenn statistisch sinnvoll: >=3 Fänge des Fisches UND Top-Köder >=2 */
function bestBaitForFish(fisch){
  const cs=fishCatches().filter(c=>(c.fischart||"").trim().toLowerCase()===String(fisch).toLowerCase());
  if(cs.length<3) return null;
  const t=topBy(cs, c=>c.koeder, 1);
  if(!t.length || t[0].count<2) return null;
  return { koeder:t[0].key, count:t[0].count, total:cs.length };
}
function showStats(){
  hideAllViews();
  const v=$("statsView"); if(v) v.style.display="block";
  renderStats();
  setActiveTab("stats");
  window.scrollTo({top:0, behavior:"smooth"});
}
function statLine(k, arr, withIcon){
  const body = arr.length ? arr.map(s=>esc(s.key)+' <b>'+s.count+'</b>').join(" · ") : "–";
  return '<div class="statline"><span class="statk">'+k+'</span>'+body+'</div>';
}
function personalBestHtml(fc){
  const fish=[...new Set(fc.map(c=>c.fischart).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"de"));
  const rows=fish.map(name=>{
    const a=fc.filter(c=>c.fischart===name);
    const longest=a.filter(c=>+c.groesse_cm>0).sort((x,y)=>(+y.groesse_cm)-(+x.groesse_cm))[0];
    const heaviest=a.filter(c=>+c.gewicht_kg>0).sort((x,y)=>(+y.gewicht_kg)-(+x.gewicht_kg))[0];
    const len=longest?(longest.groesse_cm+' cm'+(longest.datum?' · '+esc(longest.datum):'')):'–';
    const wei=heaviest?(Number(heaviest.gewicht_kg).toLocaleString('de-DE')+' kg'+(heaviest.datum?' · '+esc(heaviest.datum):'')):'–';
    return '<tr><th scope="row">'+esc(name)+'</th><td>'+len+'</td><td>'+wei+'</td></tr>';
  }).join('');
  return '<div class="statcard"><div class="stath">'+uiIcon('trophy')+' Personal Best je Fischart</div><div class="pbtablewrap"><table class="pbtable"><thead><tr><th>Fischart</th><th>Längster Fang</th><th>Schwerster Fang</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}
function tripSuccessHtml(all){
  const stored=loadTrips().filter(t=>t.end_iso);
  if(stored.length){
    const successful=stored.filter(t=>tripCatchRecords(t.id).some(isFish)).length;
    const pct=Math.round(successful/stored.length*100);
    return '<div class="statcard successcard"><div class="stath">'+uiIcon('line-chart')+' Erfolgreiche Trips</div>'+
      '<div class="successpct">'+pct+' %</div><div class="statline">'+successful+' von '+stored.length+' Trips mit mindestens einem Fang</div></div>';
  }
  const groups={};
  (all||[]).forEach(c=>{
    if(!c.datum) return;
    const key=(c.angelplatz||c.gewaesser||"?")+"|"+c.datum;
    (groups[key]=groups[key]||[]).push(c);
  });
  const trips=Object.values(groups), successful=trips.filter(a=>a.some(isFish)).length;
  const pct=trips.length?Math.round(successful/trips.length*100):0;
  return '<div class="statcard successcard"><div class="stath">'+uiIcon('line-chart')+' Erfolgreiche Trips</div>'+
    '<div class="successpct">'+pct+' %</div><div class="statline">'+successful+' von '+trips.length+' Angeltagen mit mindestens einem Fang</div></div>';
}
function renderStats(){
  const box=$("statsBody"); if(!box) return;
  const all=loadCatches(), fc=fishCatches();
  if(!all.length){ box.innerHTML='<div class="fbnote" style="padding:10px 4px">Noch keine Fangdaten vorhanden.</div>'; return; }
  let html=tripSuccessHtml(all);
  if(!fc.length){ box.innerHTML=html+'<div class="fbnote" style="padding:10px 4px">Noch keine Fänge – bisher sind nur Angeltage ohne Fang gespeichert.</div>'; return; }
  const days=totalDays();
  html+='<div class="statcard"><div class="stath">'+uiIcon('chart')+' Überblick <span class="statn">'+fc.length+(fc.length===1?' Fang':' Fänge')+' · '+days+(days===1?' Angeltag':' Angeltage')+'</span></div>'+
    statLine(uiIcon('pin')+" Beste Plätze", topBy(fc, c=>c.angelplatz, 3), false)+
    statLine(uiIcon('hook')+" Fängigste Köder", topBy(fc, c=>c.koeder, 3), true)+'</div>';
  html+=personalBestHtml(fc);
  html+=statsByFish().map(f=>
    '<div class="statcard"><div class="stath">'+esc(f.fisch)+' <span class="statn">'+f.total+(f.total===1?' Fang':' Fänge')+'</span></div>'+
    statLine("Beste Plätze", f.spots, false)+
    statLine("Fängigste Köder", f.baits, true)+'</div>').join("");
  box.innerHTML=html;
}
