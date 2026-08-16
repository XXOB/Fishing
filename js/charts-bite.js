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
/* Grobe Heuristik je Fischart aus Angler-Wissen & Fachbeiträgen (Luftdruck, Wassertemperatur,
   Licht, Trübung). Keine exakte Wissenschaft – als Faustregel gedacht. */
const BITE = [
  {name:"Zander",  temp:[12,22], tol:[8,26],  light:"low",  turbid:"like"},
  {name:"Hecht",   temp:[8,18],  tol:[3,22],  light:"low",  turbid:"neutral", wind:true},
  {name:"Barsch",  temp:[10,21], tol:[5,25],  light:"day",  turbid:"neutral"},
  {name:"Rapfen",  temp:[16,27], tol:[12,30], light:"day",  turbid:"clear", sun:true},
  {name:"Wels",    temp:[20,28], tol:[16,31], light:"low",  turbid:"like", risewater:true},
  {name:"Aal",     temp:[16,26], tol:[12,31], light:"night",turbid:"like", risewater:true, dark:true},
  {name:"Karpfen", temp:[15,25], tol:[10,29], light:"twi",  turbid:"neutral"},
  {name:"Brasse",  temp:[14,25], tol:[8,29],  light:"twi",  turbid:"slightlike"}
];
function qNum(label){
  const cur=wqCurrent(); const items=cur?cur.items:[];
  const it=items.find(x=>x.label===label);
  if(!it) return null; const n=deNum(it.value); return (typeof n==="number")? n : null;
}
function biteContext(){
  const w=snap.weather||{}, now=new Date(), hour=now.getHours();
  const cloud=w.bewoelkung_pct;
  let lowLight;
  if(hour<=5 || hour>=22) lowLight="night";
  else if(hour<=8 || hour>=19) lowLight="twilight";
  else if(cloud!=null && cloud>=70) lowLight="overcast";
  else lowLight="day";
  let pegelUp=null;
  if(state.pegelTrend && state.pegelTrend.length>13){
    const s=state.pegelTrend; pegelUp=s[s.length-1].value - s[s.length-13].value;
  }
  return { wt:qNum("Wassertemperatur"), turb:qNum("Trübung"), hour, cloud, lowLight,
    ptrend:w.luftdruck_tendenz_3h_hpa, wind:w.wind_kmh, gust:w.boen_kmh, wcode:w.wettercode,
    pegelUp, moon:moonPhase(now) };
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
  }
  if(ctx.turb!=null){
    if(sp.turbid==="like"){ if(ctx.turb>=5){ score+=1; pros.push("das Wasser leicht angetrübt ist"); } else if(ctx.turb<2){ score-=1; cons.push("das Wasser sehr klar ist"); } }
    else if(sp.turbid==="clear"){ if(ctx.turb<5){ score+=1; pros.push("das Wasser schön klar ist"); } else if(ctx.turb>=15){ score-=1; cons.push("das Wasser zu trüb ist"); } }
    else if(sp.turbid==="slightlike"){ if(ctx.turb>=3 && ctx.turb<20){ score+=1; pros.push("das Wasser leicht angetrübt ist"); } }
  }
  if(sp.risewater && ctx.pegelUp!=null && ctx.pegelUp>4){ score+=1; pros.push("der Pegel steigt (mehr Strömung und Trübung)"); }
  if(ctx.ptrend!=null){
    if(ctx.ptrend<=-1.5){ score+=1; pros.push("der Luftdruck fällt (kurbelt das Fressen an)"); }
    else if(ctx.ptrend<=0.8){ score+=1; pros.push("der Luftdruck stabil ist"); }
    else if(ctx.ptrend>=2.5){ score-=1; cons.push("der Luftdruck stark steigt"); }
  }
  if(sp.sun && ctx.cloud!=null && ctx.cloud<40 && ctx.wt!=null && ctx.wt>=16){ score+=1; pros.push("es warm und sonnig ist"); }
  if(sp.wind && ctx.wind!=null && ctx.wind>=12 && (ctx.gust==null||ctx.gust<45)){ score+=1; pros.push("leichter Wind das Wasser kräuselt"); }
  if([82,95,96,99].includes(ctx.wcode) && sp.name!=="Wels"){ score-=1; cons.push("ein Gewitter/Starkregen aufzieht"); }
  if(sp.dark && ctx.moon && ctx.moon.illum<=25){ score+=1; pros.push("die Nacht dunkel ist (wenig Mond)"); }

  let color, frag;
  if(score>=2){ color="green"; frag=pros[0]||"die Bedingungen gut passen"; }
  else if(score<=-1){ color="red"; frag=cons[0]||"die Bedingungen ungünstig sind"; }
  else { color="amber"; frag=cons[0]||pros[0]||"die Bedingungen durchwachsen sind"; }
  const lead = color==="green"?"Gut, weil ":color==="red"?"Schwierig, weil ":"Mittel – weil ";
  return { color, reason: lead+frag+"." };
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
    '<div class="fbnote" style="margin-top:8px">Grobe Faustregeln aus Angler-Wissen &amp; Fachbeiträgen – keine Garantie. Tippe einen Fisch für die Begründung an.</div>';
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
