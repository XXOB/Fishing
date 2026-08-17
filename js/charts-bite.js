"use strict";

/**
 * PetriKlar · charts-bite.js
 * Chart.js-Verläufe und Bissprognose.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
/* ===================== Verlaufs-Grafen (Chart.js) ===================== */
let CHART=null, CHART_KEY=null, CHART_RANGE="24h";
const HIST={};
const CHART_DEFS={
  pegel:      {title:"Pegelstand",     unit:"cm",   color:"#38bdf8", src:"pegel"},
  durchfluss: {title:"Durchfluss",     unit:"m³/s", color:"#2dd4bf", src:"durchfluss"},
  airTemp:    {title:"Lufttemperatur", unit:"°C",   color:"#fbbf24", src:"wx:temperature_2m"},
  wind:       {title:"Wind",           unit:"km/h", color:"#2dd4bf", src:"wx:wind_speed_10m"},
  rain:       {title:"Niederschlag",   unit:"mm/h", color:"#38bdf8", src:"wx:precipitation"},
  press:      {title:"Luftdruck",      unit:"hPa",  color:"#fbbf24", src:"wx:pressure_msl"},
  cloud:      {title:"Bewölkung",      unit:"%",    color:"#8ea2be", src:"wx:cloud_cover"}
};
const WQ_UNIT={"Wassertemperatur":"°C","Sauerstoff":"mg/l","O₂-Sättigung":"%","Trübung":"TE","Schwebstoff":"g/m³"};
const WQ_COLOR={"Wassertemperatur":"#fbbf24","Sauerstoff":"#3b82f6","O₂-Sättigung":"#4ade80","Trübung":"#8ea2be","Schwebstoff":"#8a5a2b"};
function defFor(key){
  if(CHART_DEFS[key]) return CHART_DEFS[key];
  if(key.indexOf("wq:")===0){ const l=key.slice(3); return {title:l, unit:WQ_UNIT[l]||"", color:WQ_COLOR[l]||"#38bdf8", src:key}; }
  return null;
}
function toHourly(pts){
  const m=new Map();
  for(const p of pts){ if(p.v==null||isNaN(p.v)) continue; const k=Math.floor(p.t.getTime()/3600000); m.set(k,{t:new Date(k*3600000), v:p.v}); }
  return [...m.values()].sort((a,b)=>a.t-b.t);
}
async function histPegel(param){
  const key=param==="W"?"pegel":"durchfluss";
  if(HIST[key]) return HIST[key];
  const a=await getJSON(poStation()+"/"+param+"/measurements.json?start=P8D");
  HIST[key]=a.map(p=>({t:new Date(p.timestamp), v:p.value}));
  return HIST[key];
}
async function histWx(){
  if(HIST.wx) return HIST.wx;
  const url="https://api.open-meteo.com/v1/forecast?latitude="+WXPOS.lat+"&longitude="+WXPOS.lon+
    "&hourly=temperature_2m,wind_speed_10m,pressure_msl,precipitation,cloud_cover"+
    "&past_days=7&forecast_days=1&timezone=Europe%2FBerlin&wind_speed_unit=kmh";
  const d=await getJSON(url);
  HIST.wx={times:d.hourly.time.map(t=>new Date(t)), h:d.hourly};
  return HIST.wx;
}
async function getSeries(def, range){
  const cutoff=Date.now()-(range==="24h"?24*3600e3:7*24*3600e3);
  let pts=null;
  if(def.src==="pegel"||def.src==="durchfluss") pts=await histPegel(def.src==="pegel"?"W":"Q");
  else if(def.src.indexOf("wx:")===0){ const v=def.src.slice(3), wx=await histWx(); pts=wx.times.map((t,i)=>({t, v:wx.h[v]?wx.h[v][i]:null})); }
  else if(def.src.indexOf("wq:")===0){ const l=def.src.slice(3), cur=wqCurrent(), hi=cur&&cur.history&&cur.history[l]; if(!hi) return null; pts=hi.map(p=>({t:new Date(p.t), v:p.v})); }
  if(!pts) return null;
  return toHourly(pts).filter(p=>p.t.getTime()>=cutoff);
}
function openChart(key){
  const def=defFor(key); if(!def) return;
  CHART_KEY=key; $("chartTitle").textContent=def.title+" – Verlauf";
  $("chartModal").style.display="flex";
  setChartRange("24h");
}
function closeChart(){ $("chartModal").style.display="none"; if(CHART){ CHART.destroy(); CHART=null; } }
async function setChartRange(range){
  CHART_RANGE=range;
  $("cmt24").classList.toggle("active", range==="24h");
  $("cmt7").classList.toggle("active", range==="7d");
  const def=defFor(CHART_KEY), meta=$("cmMeta");
  meta.textContent="lädt …";
  let pts=null; try{ pts=await getSeries(def, range); }catch(e){ pts=null; }
  if(!pts || !pts.length){
    meta.textContent = (def.src.indexOf("wq:")===0) ? "Für diesen Wert liegt noch kein Verlauf vor (kommt nach dem nächsten Datenimport)." : "Keine Verlaufsdaten verfügbar.";
    if(CHART){ CHART.destroy(); CHART=null; }
    return;
  }
  const labels=pts.map(p=> range==="24h" ? hhmm(p.t) : (p.t.getDate()+"."+(p.t.getMonth()+1)+". "+hhmm(p.t)));
  const values=pts.map(p=>p.v);
  const mn=Math.min(...values), mx=Math.max(...values), last=values[values.length-1];
  meta.innerHTML="Aktuell <b>"+fmt(last,1)+" "+def.unit+"</b> · Min "+fmt(mn,1)+" · Max "+fmt(mx,1)+" · Auflösung 1 h";
  drawChart(labels, values, def);
}
function drawChart(labels, values, def){
  const cv=$("cmChart"); if(!cv || !window.Chart) return;
  if(CHART) CHART.destroy();
  CHART=new Chart(cv.getContext("2d"),{
    type:"line",
    data:{labels, datasets:[{data:values, borderColor:def.color, backgroundColor:def.color+"22", borderWidth:2, pointRadius:0, fill:true, tension:.25}]},
    options:{responsive:true, maintainAspectRatio:false, animation:false,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>fmt(c.parsed.y,1)+" "+def.unit}}},
      scales:{x:{ticks:{color:"#8ea2be", maxTicksLimit:7, maxRotation:0, autoSkip:true}, grid:{color:"#1c2635"}},
              y:{ticks:{color:"#8ea2be"}, grid:{color:"#1c2635"}}}}
  });
}

/* ===================== Beißwetter ===================== */
/* Evidenzgewichtete Heuristik aus Fang-, Fütterungs-, Aktivitäts- und Stoffwechselstudien.
   Direkte Fang-/Fütterungsbefunde wiegen stärker als Aktivität oder Wachstum. Die Regeln
   bleiben eine Faustregel und werden mit den persönlichen Fangdaten ergänzt. */
const BITE = [
  {name:"Zander",  temp:[12,23], tol:[10,27], light:"twi",      turbid:"moderate", oxygenSensitive:true},
  {name:"Hecht",   temp:[6,18],  tol:[3,23],  light:"dusk",     turbid:"neutral",  wind:true, moonEdges:true},
  {name:"Barsch",  temp:[10,23], tol:[5,27],  light:"day",      turbid:"clear"},
  {name:"Rapfen",  temp:[16,27], tol:[12,30], light:"day",      turbid:"clear",    sun:true, weakTurbidity:true},
  {name:"Wels",    temp:[20,28], tol:[15,31], light:"night",    turbid:"slightlike", risewater:true},
  {name:"Aal",     temp:[16,26], tol:[11,29], light:"night",    turbid:"like",     risewater:true, dark:true},
  {name:"Karpfen", temp:[18,28], tol:[10,32], light:"carp",     turbid:"neutral"},
  {name:"Brasse",  temp:[14,25], tol:[8,29],  light:"flexible", turbid:"slightlike", weakTurbidity:true}
];
function qItem(label){
  const cur=wqCurrent(); const items=cur?cur.items:[];
  return items.find(x=>x.label===label)||items.find(x=>String(x.label||"").startsWith(label+" ("))||null;
}
function qNum(label){
  const it=qItem(label);
  if(!it) return null; const n=deNum(it.value); return (typeof n==="number")? n : null;
}
function solarLight(now,w){
  const rise=w.sonnenaufgang?new Date(w.sonnenaufgang):null;
  const set=w.sonnenuntergang?new Date(w.sonnenuntergang):null;
  if(rise && set && !isNaN(rise) && !isNaN(set)){
    const t=now.getTime(), twilight=75*60000;
    if(t<rise.getTime()-twilight || t>set.getTime()+twilight) return "night";
    if(Math.abs(t-rise.getTime())<=twilight || Math.abs(t-set.getTime())<=twilight) return "twilight";
    return (w.bewoelkung_pct!=null&&w.bewoelkung_pct>=70)?"overcast":"day";
  }
  const hour=now.getHours();
  if(hour<=5 || hour>=22) return "night";
  if(hour<=8 || hour>=19) return "twilight";
  return (w.bewoelkung_pct!=null&&w.bewoelkung_pct>=70)?"overcast":"day";
}
function biteContext(){
  const w=snap.weather||{}, now=new Date(), hour=now.getHours();
  const cloud=w.bewoelkung_pct;
  const lowLight=solarLight(now,w);
  let pegelUp=null, pegelUpPct=null;
  if(state.pegelTrend && state.pegelTrend.length>13){
    const s=state.pegelTrend, old=+s[s.length-13].value;
    pegelUp=+s[s.length-1].value-old;
    if(old) pegelUpPct=pegelUp/Math.abs(old)*100;
  }
  return { wt:qNum("Wassertemperatur"), turb:qNum("Trübung"), oxygen:qNum("Sauerstoff"),
    oxygenSat:qNum("O₂-Sättigung"), hour, cloud, lowLight,
    ptrend:w.luftdruck_tendenz_3h_hpa, wind:w.wind_kmh, gust:w.boen_kmh, wcode:w.wettercode,
    pegelUp, pegelUpPct, moon:moonPhase(now) };
}
function evalBite(sp, ctx){
  let score=0; const pros=[], cons=[];
  if(ctx.wt!=null){
    const [lo,hi]=sp.temp,[tlo,thi]=sp.tol;
    if(ctx.wt>=lo && ctx.wt<=hi){ score+=2; pros.push("die Wassertemperatur ("+ctx.wt+" °C) im idealen Bereich liegt"); }
    else if(ctx.wt<tlo || ctx.wt>thi){ score-=2; cons.push("die Wassertemperatur ("+ctx.wt+" °C) ungünstig ist"); }
    else { score-=1; cons.push("die Wassertemperatur ("+ctx.wt+" °C) nicht optimal ist"); }
  }
  const ll=ctx.lowLight;
  if(sp.light==="low"){
    if(ll==="night"||ll==="twilight"){ score+=1; pros.push("wenig Licht herrscht (Dämmerung/Nacht)"); }
    else if(ll==="overcast"){ score+=1; pros.push("der bedeckte Himmel das Licht dämpft"); }
    else { score-=1; cons.push("es am hellen Tag zu grell ist"); }
  } else if(sp.light==="day"){
    if(ll==="day"){ score+=1; pros.push("heller Tag herrscht"); }
    else if(ll==="night"){ score-=1; cons.push("nachts kaum Aktivität herrscht"); }
  } else if(sp.light==="night"){
    if(ll==="night"){ score+=2; pros.push("es dunkel ist (Nacht)"); }
    else if(ll==="twilight"){ score+=1; pros.push("Dämmerung herrscht"); }
    else { score-=2; cons.push("es tagsüber kaum Bisse gibt"); }
  } else if(sp.light==="twi"){
    if(ll==="twilight"){ score+=1; pros.push("Dämmerung herrscht – die beste Zeit"); }
    else if(ll==="overcast"){ score+=0.5; pros.push("der bedeckte Himmel das Licht dämpft"); }
    else if(ll==="night"){ score-=0.5; cons.push("die aktivere Dämmerungsphase vorbei ist"); }
  } else if(sp.light==="dusk"){
    if(ll==="twilight"){ score+=1.5; pros.push("Dämmerung herrscht – direkt gemessene Hechtfänge sind dann häufiger"); }
    else if(ll==="overcast"){ score+=0.5; pros.push("der bedeckte Himmel das Licht dämpft"); }
    else if(ll==="night"){ score-=0.5; cons.push("Hechte nachts meist weniger aktiv sind"); }
  } else if(sp.light==="carp"){
    if(ll==="twilight"||ll==="night"){ score+=1; pros.push("Karpfen morgens, abends und nachts häufig fressen"); }
    else if(ll==="overcast"){ score+=0.5; pros.push("das gedämpfte Licht eine längere Fressphase begünstigt"); }
  } else if(sp.light==="flexible"){
    if(ll==="twilight"){ score+=0.25; pros.push("Brassen auch in der Dämmerung aktiv sein können"); }
  }
  if(ctx.turb!=null){
    const tw=sp.weakTurbidity?0.5:1;
    if(sp.turbid==="like"){
      if(ctx.turb>=5&&ctx.turb<30){ score+=0.5*tw; pros.push("das Wasser leicht angetrübt ist"); }
      else if(ctx.turb<2){ score-=0.5*tw; cons.push("das Wasser sehr klar ist"); }
    } else if(sp.turbid==="moderate"){
      if(ctx.turb>=2&&ctx.turb<20){ score+=0.75; pros.push("eine mäßige Trübung die Zanderfütterung begünstigen kann"); }
      else if(ctx.turb<1){ score-=0.5; cons.push("das Wasser für Zander sehr klar ist"); }
      else if(ctx.turb>=40){ score-=0.5; cons.push("sehr starke Trübung die Beutesuche erschweren kann"); }
    } else if(sp.turbid==="clear"){
      if(ctx.turb<5){ score+=0.5*tw; pros.push("das Wasser relativ klar ist"); }
      else if(ctx.turb>=15){ score-=0.75*tw; cons.push("starke Trübung die Sichtjagd erschwert"); }
    } else if(sp.turbid==="slightlike"){
      if(ctx.turb>=3&&ctx.turb<20){ score+=0.25*tw; pros.push("das Wasser leicht angetrübt ist"); }
    }
  }
  const meaningfulRise=ctx.pegelUp!=null&&ctx.pegelUp>4&&
    (ctx.pegelUp>=10||ctx.pegelUpPct==null||ctx.pegelUpPct>=1);
  if(sp.risewater&&meaningfulRise){
    const riseWeight=sp.name==="Wels"?0.75:0.5;
    score+=riseWeight; pros.push("der Pegel deutlich steigt und damit Aktivität auslösen kann");
  }
  const oxygenCritical=(ctx.oxygenSat!=null&&ctx.oxygenSat<40)||(ctx.oxygen!=null&&ctx.oxygen<3);
  const oxygenLow=(ctx.oxygenSat!=null&&ctx.oxygenSat<65)||(ctx.oxygen!=null&&ctx.oxygen<5);
  if(oxygenCritical){ score-=2.5; cons.push("sehr wenig Sauerstoff Aktivität und Futteraufnahme stark bremst"); }
  else if(sp.oxygenSensitive&&oxygenLow){ score-=1; cons.push("niedriger Sauerstoff die Futteraufnahme von Zandern vermindern kann"); }
  if(ctx.ptrend!=null){
    // Luftdruck bleibt als schwacher Alt-Faktor erhalten; direkte Fütterungsbelege sind uneinheitlich.
    if(ctx.ptrend<=-1.5){ score+=0.25; pros.push("der Luftdruck leicht fällt"); }
    else if(ctx.ptrend<=0.8){ score+=0.25; pros.push("der Luftdruck stabil ist"); }
    else if(ctx.ptrend>=2.5){ score-=0.25; cons.push("der Luftdruck stark steigt"); }
  }
  if(sp.sun&&ctx.cloud!=null&&ctx.cloud<40&&ctx.wt!=null&&ctx.wt>=16){ score+=0.5; pros.push("es warm und hell ist"); }
  if(sp.wind && ctx.wind!=null && ctx.wind>=12 && (ctx.gust==null||ctx.gust<45)){ score+=1; pros.push("leichter Wind das Wasser kräuselt"); }
  if(sp.moonEdges&&ctx.moon&&(ctx.moon.illum<=15||ctx.moon.illum>=85)){ score+=0.5; pros.push("Neu- oder Vollmond in Fangstudien mit mehr Hechtfängen verbunden war"); }
  if([82,95,96,99].includes(ctx.wcode)&&sp.name!=="Wels"){ score-=0.25; cons.push("Gewitter oder Starkregen die Bedingungen unruhig macht"); }
  if(sp.dark&&ctx.moon&&ctx.moon.illum<=25){ score+=0.25; pros.push("die Nacht dunkel ist (wenig Mond)"); }

  let color, frag;
  if(score>=2){ color="green"; frag=pros.slice(0,2).join(" und ")||"die Bedingungen gut passen"; }
  else if(score<=-1){ color="red"; frag=cons.slice(0,2).join(" und ")||"die Bedingungen ungünstig sind"; }
  else if(cons.length&&pros.length){ color="amber"; frag=cons[0]+", aber "+pros[0]; }
  else { color="amber"; frag=cons[0]||pros[0]||"die Bedingungen durchwachsen sind"; }
  const lead = color==="green"?"Gut, weil ":color==="red"?"Schwierig, weil ":"Mittel – weil ";
  return { color, reason: lead+frag+".", score };
}
function renderBite(){
  const box=$("biteBox"); if(!box) return;
  const ctx=biteContext();
  const tag={green:"beißt gut",amber:"mittel",red:"eher nicht"};
  const col={green:"--green",amber:"--amber",red:"--red"};
  const rows=BITE.map(sp=>{
    const r=evalBite(sp,ctx);
    const rec=bestBaitForFish(sp.name);
    const recHtml = rec ? '<div class="biterec">'+uiIcon('hook')+' Bewährter Köder bei dir: <b>'+esc(rec.koeder)+
      '</b> <small>('+rec.count+' von '+rec.total+' '+esc(sp.name)+'-Fängen)</small></div>' : '';
    return '<div class="biteitem"><button class="bitehead" onclick="var e=this.nextElementSibling;e.style.display=(e.style.display===\'block\'?\'none\':\'block\')">'+
      '<span class="bitedot bd-'+r.color+'"></span>'+sp.name+
      '<span class="bitetag" style="color:var('+col[r.color]+')">'+tag[r.color]+' '+uiIcon('chevron-down')+'</span></button>'+
      '<div class="bitereason">'+esc(r.reason)+recHtml+'</div></div>';
  }).join("");
  const warn = ctx.wt==null ? '<div class="fbnote" style="margin:0 4px 10px">Wassertemperatur noch nicht geladen – Einstufung vorläufig.</div>' : '';
  box.innerHTML = warn + rows +
    '<div class="fbnote" style="margin-top:8px">Evidenzgewichtete Faustregeln aus Fang-, Fütterungs- und Aktivitätsstudien – keine Fanggarantie. Persönliche Fänge ergänzen die Köderempfehlung.</div>';
}
function toggleBite(){
  const box=$("biteBox"), b=$("biteBtn"); if(!box) return;
  const show=(box.style.display==="none"||!box.style.display);
  if(show){ renderBite(); box.style.display="block"; setIconLabel(b,"target","Beißwetter ausblenden"); }
  else { box.style.display="none"; setIconLabel(b,"target","Beißwetter anzeigen"); }
}
function toggleFangbuch(){
  const box=$("fangbuchBox"); if(!box) return;
  const show=(box.style.display==="none"||!box.style.display);
  box.style.display = show?"block":"none";
  if(show){
    const list=$("fbList"); if(list) list.style.display="block";
    renderCatches();
  }
  updateFangbuchBtn();
}
