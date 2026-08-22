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
  durchfluss: {title:"Durchfluss",     unit:"m³/s", color:"#64d2ff", src:"durchfluss"},
  airTemp:    {title:"Lufttemperatur", unit:"°C",   color:"#fbbf24", src:"wx:temperature_2m"},
  wind:       {title:"Wind",           unit:"km/h", color:"#5e5ce6", src:"wx:wind_speed_10m"},
  rain:       {title:"Niederschlag",   unit:"mm/h", color:"#38bdf8", src:"wx:precipitation"},
  press:      {title:"Luftdruck",      unit:"hPa",  color:"#fbbf24", src:"wx:pressure_msl"},
  cloud:      {title:"Bewölkung",      unit:"%",    color:"#8ea2be", src:"wx:cloud_cover"}
};
const WQ_UNIT={"Wassertemperatur":"°C","Sauerstoff":"mg/l","O₂-Sättigung":"%","Trübung":"TE","Schwebstoff":"g/m³"};
const WQ_COLOR={"Wassertemperatur":"#ff9f0a","Sauerstoff":"#0a84ff","O₂-Sättigung":"#64d2ff","Trübung":"#8e8e93","Schwebstoff":"#ac8e68"};
const CHART_EXPLANATIONS={
  pegel:"Pegeländerungen können Standplätze, Strömung und Trübung verändern. Ein klarer artspezifischer Grenzwert existiert nicht; im Beißindex zählt nur ein deutlicher Anstieg bei Wels und Aal schwach positiv.",
  durchfluss:"Der Durchfluss beschreibt die Wassermenge, nicht die lokale Strömung am Angelplatz. Veränderungen sind vor allem für strömungsliebende Arten relevant, werden mangels lokaler Fließgeschwindigkeit aber nicht direkt bepunktet.",
  airTemp:"Die Lufttemperatur wirkt nur indirekt. Entscheidend ist die gemessene Wassertemperatur; deshalb fließt die Lufttemperatur nicht direkt in den Beißindex ein.",
  wind:"Mäßiger Wind kann die Oberfläche kräuseln und Uferbereiche durchmischen. Im Modell erhält nur der Hecht einen kleinen Bonus; starke Böen werden nicht positiv bewertet.",
  rain:"Regen wirkt über Pegel, Trübung und Temperatur. Der Niederschlagswert allein bekommt deshalb keinen pauschalen Bonus.",
  press:"Luftdruck ist nur ein schwacher Begleitfaktor. Stabiler oder leicht fallender Druck wirkt minimal positiv, stark steigender minimal negativ.",
  cloud:"Bewölkung dämpft das Licht. Das kann Dämmerungs- und Schwachlichtjäger begünstigen, ersetzt aber keine Wasserwerte.",
  "wq:Wassertemperatur":"Die Wassertemperatur ist der stärkste Modellfaktor. Innerhalb des artspezifischen Aktivitätsfensters gibt es +2 Punkte, außerhalb der Toleranz −2 Punkte.",
  "wq:Sauerstoff":"Gelöster Sauerstoff beeinflusst Aktivität und Futteraufnahme. Unter rund 5–6 mg/l nimmt die Futteraufnahme vieler Fische ab; Salmoniden und Äschen werden im Modell strenger bewertet.",
  "wq:O₂-Sättigung":"Die Sättigung ergänzt mg/l, wenn kein Konzentrationswert vorliegt. Unter 65 % gilt der Wert als niedrig, unter 40 % als kritisch.",
  "wq:Trübung":"Trübung verändert die Sichtweite. Sichtjäger werden bei starker Trübung abgewertet; Zander, Aal und Wels vertragen leichte bis mäßige Trübung besser.",
  "wq:Schwebstoff":"Schwebstoff ist nicht immer direkt mit Trübung vergleichbar. Hohe Werte werden deshalb angezeigt, aber nicht als fester Beißindex-Grenzwert verwendet."
};
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
function chartExplanation(def,range,pts){
  const base=CHART_EXPLANATIONS[def.src]||"Der Verlauf hilft, kurzfristige Ausschläge von einem stabilen Trend zu unterscheiden.";
  const period=range==="7d"
    ? "Für die Woche zählt der Trend: mehrere Stunden oder Tage außerhalb eines günstigen Bereichs wiegen stärker als ein einzelner Ausreißer."
    : "Für den Tag zeigt der Verlauf, ob der aktuelle Wert stabil ist oder sich gerade deutlich verändert.";
  let fit="";
  if(pts&&pts.length&&def.src==="wq:Wassertemperatur"){
    const v=pts[pts.length-1].v, names=BITE.filter(sp=>v>=sp.temp[0]&&v<=sp.temp[1]).map(sp=>sp.name);
    fit=names.length?" Aktuell liegt der Wert im Modellfenster für "+names.slice(0,6).join(", ")+(names.length>6?" und weitere":"")+".":" Aktuell liegt der Wert in keinem idealen Modellfenster.";
  } else if(pts&&pts.length&&def.src==="wq:Sauerstoff"){
    const v=pts[pts.length-1].v;
    fit=v<3?" Der aktuelle Wert ist für alle Arten kritisch.":v<5.6?" Der aktuelle Wert kann Futteraufnahme und Aktivität bremsen.":" Der aktuelle Wert ist für die meisten Modellarten nicht begrenzend.";
  }
  return '<strong>Einordnung für '+(range==="7d"?'7 Tage':'24 Stunden')+'</strong><p>'+esc(base+" "+period+fit)+'</p>';
}
async function setChartRange(range){
  CHART_RANGE=range;
  $("cmt24").classList.toggle("active", range==="24h");
  $("cmt7").classList.toggle("active", range==="7d");
  const def=defFor(CHART_KEY), meta=$("cmMeta"), explain=$("cmExplain");
  meta.textContent="lädt …";
  if(explain) explain.innerHTML=chartExplanation(def,range,null);
  let pts=null; try{ pts=await getSeries(def, range); }catch(e){ pts=null; }
  if(explain) explain.innerHTML=chartExplanation(def,range,pts);
  if(!pts || !pts.length){
    meta.textContent = (def.src.indexOf("wq:")===0) ? "Für diesen Wert liegt noch kein Verlauf vor. Die Einordnung oben gilt trotzdem für den aktuellen Messwert." : "Keine Verlaufsdaten verfügbar.";
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
  {name:"Zander",            temp:[12,23], tol:[10,27], light:"twi",      turbid:"moderate", oxygen:[6,5,3], oxygenWeight:1},
  {name:"Hecht",             temp:[6,18],  tol:[3,23],  light:"dusk",     turbid:"neutral", oxygen:[5.6,4,3], oxygenWeight:.5, wind:true, moonEdges:true},
  {name:"Barsch",            temp:[10,23], tol:[5,27],  light:"day",      turbid:"clear", oxygen:[6,5,3], oxygenWeight:.75},
  {name:"Rapfen",            temp:[16,27], tol:[12,30], light:"day",      turbid:"clear", oxygen:[6,5,3], oxygenWeight:.75, sun:true, weakTurbidity:true},
  {name:"Wels",              temp:[20,28], tol:[15,31], light:"night",    turbid:"slightlike", oxygen:[5,3.5,2.5], oxygenWeight:.35, risewater:true},
  {name:"Aal",               temp:[16,26], tol:[11,29], light:"night",    turbid:"like", oxygen:[5,3.5,2.5], oxygenWeight:.35, risewater:true, dark:true},
  {name:"Karpfen",           temp:[18,28], tol:[10,32], light:"carp",     turbid:"neutral", oxygen:[5.5,4,3], oxygenWeight:.4},
  {name:"Brasse",            temp:[14,25], tol:[8,29],  light:"flexible", turbid:"slightlike", oxygen:[5.5,4,3], oxygenWeight:.4, weakTurbidity:true},
  {name:"Bachforelle",       temp:[8,16],  tol:[4,20],  light:"low",      turbid:"clear", oxygen:[8,6,4], oxygenWeight:1.25},
  {name:"Regenbogenforelle", temp:[10,18], tol:[4,21],  light:"low",      turbid:"clear", oxygen:[7.5,6,4], oxygenWeight:1.2},
  {name:"Äsche",             temp:[8,16],  tol:[4,20],  light:"day",      turbid:"clear", oxygen:[8,6.5,4.5], oxygenWeight:1.25},
  {name:"Huchen",            temp:[6,16],  tol:[3,22],  light:"twi",      turbid:"clear", oxygen:[8,6.5,5], oxygenWeight:1.25},
  {name:"Nase",              temp:[12,18], tol:[4,24],  light:"day",      turbid:"clear", oxygen:[8,6,4], oxygenWeight:1},
  {name:"Barbe",             temp:[18,25], tol:[5,28],  light:"low",      turbid:"slightlike", oxygen:[7,5.5,3.5], oxygenWeight:.8},
  {name:"Döbel",             temp:[14,24], tol:[5,28],  light:"day",      turbid:"neutral", oxygen:[6,5,3], oxygenWeight:.5},
  {name:"Schleie",           temp:[20,28], tol:[10,31], light:"carp",     turbid:"neutral", oxygen:[5,3.5,2.5], oxygenWeight:.35},
  {name:"Quappe",            temp:[4,14],  tol:[1,18],  light:"night",    turbid:"slightlike", oxygen:[6.5,5,3.5], oxygenWeight:.75, dark:true}
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
    if(ll==="twilight"){ score+=0.25; pros.push(sp.name+" auch in der Dämmerung aktiv sein kann"); }
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
  const oxygen=sp.oxygen||[5.6,5,3], oxygenWeight=sp.oxygenWeight==null?.5:sp.oxygenWeight;
  const oxygenCritical=(ctx.oxygenSat!=null&&ctx.oxygenSat<40)||(ctx.oxygen!=null&&ctx.oxygen<oxygen[2]);
  const oxygenLow=(ctx.oxygenSat!=null&&ctx.oxygenSat<65)||(ctx.oxygen!=null&&ctx.oxygen<oxygen[1]);
  if(oxygenCritical){ score-=2.5; cons.push("sehr wenig Sauerstoff Aktivität und Futteraufnahme stark bremst"); }
  else if(oxygenLow){ score-=oxygenWeight; cons.push("der Sauerstoffwert für "+sp.name+" niedrig ist"); }
  else if(ctx.oxygen!=null&&ctx.oxygen>=oxygen[0]&&oxygenWeight>=1){ score+=0.25; pros.push("genügend gelöster Sauerstoff vorhanden ist"); }
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
function biteHistoryStats(label,days){
  const cur=wqCurrent(), hi=cur&&cur.history&&cur.history[label];
  if(!hi||!hi.length) return null;
  const cutoff=Date.now()-days*86400e3;
  const vals=hi.map(p=>({t:new Date(p.t),v:+p.v})).filter(p=>!isNaN(p.t)&&isFinite(p.v)&&p.t.getTime()>=cutoff).map(p=>p.v);
  if(!vals.length) return null;
  return {min:Math.min(...vals),max:Math.max(...vals),avg:vals.reduce((a,b)=>a+b,0)/vals.length,n:vals.length};
}
function fishProfileHtml(sp,ctx){
  const o=sp.oxygen||[5.6,5,3], tNow=ctx.wt==null?"kein Temperaturwert":
    (ctx.wt>=sp.temp[0]&&ctx.wt<=sp.temp[1]?ctx.wt+" °C: ideal":ctx.wt<sp.tol[0]||ctx.wt>sp.tol[1]?ctx.wt+" °C: außerhalb der Toleranz":ctx.wt+" °C: nutzbar, aber nicht optimal");
  let oNow="kein Sauerstoffwert";
  if(ctx.oxygen!=null) oNow=ctx.oxygen+" mg/l: "+(ctx.oxygen<o[2]?"kritisch":ctx.oxygen<o[1]?"niedrig":ctx.oxygen>=o[0]?"günstig":"ausreichend");
  else if(ctx.oxygenSat!=null) oNow=ctx.oxygenSat+" % Sättigung: "+(ctx.oxygenSat<40?"kritisch":ctx.oxygenSat<65?"niedrig":"ausreichend");
  const ts=biteHistoryStats("Wassertemperatur",7), os=biteHistoryStats("Sauerstoff",7);
  const week=[];
  if(ts) week.push("Temperatur Ø "+fmt(ts.avg,1)+" °C ("+fmt(ts.min,1)+"–"+fmt(ts.max,1)+")");
  if(os) week.push("Sauerstoff Ø "+fmt(os.avg,1)+" mg/l ("+fmt(os.min,1)+"–"+fmt(os.max,1)+")");
  return '<div class="biteprofile"><div><b>Heute</b><span>'+esc(tNow)+' · '+esc(oNow)+'</span></div>'+
    '<div><b>7 Tage</b><span>'+esc(week.length?week.join(" · "):"Noch kein 7-Tage-Verlauf an dieser Messstation")+'</span></div>'+
    '<div><b>Modellwerte</b><span>Temperatur ideal '+sp.temp[0]+'–'+sp.temp[1]+' °C, Toleranz '+sp.tol[0]+'–'+sp.tol[1]+' °C · Sauerstoff günstig ab '+o[0]+' mg/l, niedrig unter '+o[1]+' mg/l, kritisch unter '+o[2]+' mg/l</span></div></div>';
}
const DEFAULT_TARGET_FISH=[];
let TARGET_FISH_PICKER_OPEN=false;
function targetFishNames(){
  const prefs=APP_STATE&&APP_STATE.ui_prefs, saved=prefs&&Array.isArray(prefs.target_fish)?prefs.target_fish:DEFAULT_TARGET_FISH;
  const valid=new Set(BITE.map(sp=>sp.name));
  return saved.filter((name,i,a)=>valid.has(name)&&a.indexOf(name)===i);
}
function toggleTargetFishPicker(){ TARGET_FISH_PICKER_OPEN=!TARGET_FISH_PICKER_OPEN; renderBite(); }
function toggleTargetFish(name){
  const current=new Set(targetFishNames());
  if(current.has(name)) current.delete(name); else current.add(name);
  if(!APP_STATE.ui_prefs||typeof APP_STATE.ui_prefs!=="object") APP_STATE.ui_prefs={onboarding_done:false};
  APP_STATE.ui_prefs.target_fish=BITE.filter(sp=>current.has(sp.name)).map(sp=>sp.name);
  markCloudDirty(); renderBite();
}
function biteRow(sp,ctx,tag,col){
  const r=evalBite(sp,ctx), rec=bestBaitForFish(sp.name);
  const recHtml=rec?'<div class="biterec">'+uiIcon('hook')+' Bewährter Köder bei dir: <b>'+esc(rec.koeder)+
    '</b> <small>('+rec.count+' von '+rec.total+' '+esc(sp.name)+'-Fängen)</small></div>':'';
  return '<div class="biteitem"><button class="bitehead" onclick="var e=this.nextElementSibling;e.style.display=(e.style.display===\'block\'?\'none\':\'block\')">'+
    '<span class="bitedot bd-'+r.color+'"></span>'+sp.name+
    '<span class="bitetag" style="color:var('+col[r.color]+')">'+tag[r.color]+' '+uiIcon('chevron-down')+'</span></button>'+
    '<div class="bitereason"><div class="bitedayreason">'+esc(r.reason)+'</div>'+fishProfileHtml(sp,ctx)+recHtml+'</div></div>';
}
function renderBite(){
  const box=$("biteBox"); if(!box) return;
  const ctx=biteContext();
  const tag={green:"beißt gut",amber:"mittel",red:"eher nicht"};
  const col={green:"--green",amber:"--amber",red:"--red"};
  const targets=targetFishNames(), selected=new Set(targets);
  const targetRows=BITE.filter(sp=>selected.has(sp.name)).map(sp=>biteRow(sp,ctx,tag,col)).join("");
  const others=BITE.filter(sp=>!selected.has(sp.name));
  const choices=BITE.map(sp=>{
    const on=selected.has(sp.name);
    return '<button type="button" class="targetfishchoice'+(on?' active':'')+'" aria-pressed="'+on+'" onclick="toggleTargetFish(\''+sp.name+'\')">'+
      '<span aria-hidden="true">'+(on?'✓':'+')+'</span>'+sp.name+'</button>';
  }).join("");
  const picker='<div class="targetfishsetup"><div><strong>Wähle Deine Zielfische:</strong><small>Diese Fische werden immer direkt angezeigt.</small></div>'+
    '<button type="button" class="targetfishedit" aria-expanded="'+TARGET_FISH_PICKER_OPEN+'" onclick="toggleTargetFishPicker()">'+
    (TARGET_FISH_PICKER_OPEN?'Auswahl schließen':'Zielfische bearbeiten')+'</button></div>'+
    '<div class="targetfishpicker" style="display:'+(TARGET_FISH_PICKER_OPEN?'flex':'none')+'">'+choices+'</div>';
  const targetBlock=targetRows||'<div class="targetfishempty">Noch keine Zielfische gewählt. Über „Zielfische bearbeiten“ kannst du welche hinzufügen.</div>';
  const otherBlock=others.length?'<details class="biteothers"><summary>Weitere Fische <span>'+others.length+'</span></summary><div class="biteothersbody">'+
    others.map(sp=>biteRow(sp,ctx,tag,col)).join("")+'</div></details>':'';
  const warn = ctx.wt==null ? '<div class="fbnote" style="margin:0 4px 10px">Wassertemperatur noch nicht geladen – Einstufung vorläufig.</div>' : '';
  box.innerHTML = picker+warn+'<div class="targetfishlist">'+targetBlock+'</div>'+otherBlock+
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
