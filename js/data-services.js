"use strict";

/**
 * PetriKlar · data-services.js
 * Pegel-, Wetter- und Wassergüte-Abrufe samt Darstellung.
 * Lade-Reihenfolge und Abhängigkeiten: docs/ARCHITEKTUR.md
 */
// Klassifizierungs-Farbe -> CSS-Farbe für den Kachelstreifen
function stripeColor(c){
  return c==="pg-green" ? "var(--green)"
       : c==="pg-amber" ? "var(--amber)"
       : c==="pg-red"   ? "var(--red)"
       : "var(--water)"; // ohne Gut/Schlecht-Einstufung: blau
}

function trendBadge(series){
  if(!series || series.length<8) return "";
  const last = series[series.length-1].value;
  const ref  = series[Math.max(0,series.length-13)].value; // ~3 h zurück (15-min-Werte)
  const diff = last-ref;
  const th = Math.max(1, Math.abs(ref)*0.004);
  if(diff> th) return '<span class="trend t-up">'+uiIcon('trend-up')+' steigt</span>';
  if(diff<-th) return '<span class="trend t-dn">'+uiIcon('trend-down')+' fällt</span>';
  return '<span class="trend t-fl">'+uiIcon('minus')+' stabil</span>';
}
function sparkline(svgEl,series,color){
  if(!svgEl) return;
  if(!series || series.length<2){ svgEl.innerHTML=""; return; }
  const vals = series.map(p=>p.value);
  const min=Math.min(...vals), max=Math.max(...vals), rng=(max-min)||1, n=vals.length;
  const pts = vals.map((v,i)=>{
    const x=(i/(n-1))*100, y=32-((v-min)/rng)*28-2;
    return x.toFixed(1)+","+y.toFixed(1);
  }).join(" ");
  svgEl.innerHTML =
    '<polyline fill="none" stroke="'+color+'" stroke-width="1.6" points="'+pts+'"/>'+
    '<polygon fill="'+color+'" opacity="0.18" points="0,34 '+pts+' 100,34"/>';
}
function relTime(iso){
  const t=new Date(iso), m=Math.round((new Date()-t)/60000);
  if(m<1) return "gerade eben";
  if(m<60) return "vor "+m+" Min";
  return "vor "+Math.floor(m/60)+" Std "+(m%60)+" Min";
}
function hhmm(iso){ return new Date(iso).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}); }

const WMO = {
  0:["Klar","sun"],1:["Überwiegend klar","sun"],2:["Teils bewölkt","cloud"],3:["Bedeckt","cloud"],
  45:["Nebel","cloud"],48:["Reifnebel","cloud"],
  51:["Leichter Niesel","rain"],53:["Niesel","rain"],55:["Starker Niesel","rain"],
  61:["Leichter Regen","rain"],63:["Regen","rain"],65:["Starker Regen","rain"],
  66:["Gefr. Regen","rain"],67:["Gefr. Regen","rain"],
  71:["Leichter Schnee","cloud"],73:["Schnee","cloud"],75:["Starker Schnee","cloud"],77:["Schneegriesel","cloud"],
  80:["Schauer","rain"],81:["Schauer","rain"],82:["Heftige Schauer","rain"],
  85:["Schneeschauer","cloud"],86:["Schneeschauer","cloud"],
  95:["Gewitter","warning"],96:["Gewitter + Hagel","warning"],99:["Gewitter + Hagel","warning"]
};
function windDir(deg){
  const d=["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return d[Math.round(deg/22.5)%16];
}
async function getJSON(url){
  const r = await fetch(url,{cache:"no-store"});
  if(!r.ok) throw new Error(url+": "+r.status);
  return r.json();
}
const state = {pegelTrend:null, gust:null, rainNow:null, wcode:null, pressTrend:null};
const snap = { weather:null, pegel:null, q:null, marineTemp:null };  // Momentaufnahme für Fänge
let CURRENT_GPS = null;

function classifyPegel(w, ref){
  if(!ref || ref.MNW==null || ref.MW==null || ref.MHW==null) return null;
  const {MNW,MW,MHW}=ref;
  const loMid=(MNW+MW)/2, hiMid=(MW+MHW)/2;
  if(w<MNW)   return {t:"sehr niedrig", c:"pg-red"};
  if(w<loMid) return {t:"niedrig",      c:"pg-amber"};
  if(w<hiMid) return {t:"normal",       c:"pg-green"};
  if(w<MHW)   return {t:"hoch",         c:"pg-amber"};
  return              {t:"sehr hoch",   c:"pg-red"};
}
async function stationRef(uuid){
  if(uuid in REF_CACHE) return REF_CACHE[uuid];
  let ref=null;
  try{
    const d=await getJSON(PO_BASE+"/stations/"+uuid+"/W.json?includeCharacteristicValues=true");
    const cv=d.characteristicValues||[], g=n=>{ const e=cv.find(x=>x.shortname===n); return e?e.value:null; };
    const r={MNW:g("MNW"), MW:g("MW"), MHW:g("MHW")};
    if(r.MNW!=null && r.MW!=null && r.MHW!=null) ref=r;
  }catch(e){}
  REF_CACHE[uuid]=ref; return ref;
}

async function loadPegel(){
  const base=poStation();
  const ref=await stationRef(CUR.uuid);
  try{
    const w = await getJSON(base+"/W/measurements.json?start=P2D");
    if(!w.length) throw 0;
    const last = w[w.length-1];
    $("pegelVal").innerHTML = fmt(last.value)+' <small>cm</small>';
    const pc = classifyPegel(last.value, ref);
    const badge = pc ? '<span class="pgbadge '+pc.c+'" title="Hauptwerte '+CUR.name+': MNW '+ref.MNW+' · MW '+ref.MW+' · MHW '+ref.MHW+' cm">'+pc.t+'</span>' : '';
    $("pegelMeta").innerHTML = badge+trendBadge(w)+' · '+relTime(last.timestamp);
    sparkline($("pegelSpark"), w.slice(-96), "#38bdf8");
    const pt=$("tilePegel"); if(pt) pt.style.borderTopColor = pc ? stripeColor(pc.c) : "var(--water)";
    state.pegelTrend = w;
    snap.pegel = { pegelstand_cm: last.value, stufe: pc? pc.t : null };
  }catch(e){ $("pegelVal").innerHTML='<span class="err">n/v</span>'; $("pegelMeta").textContent="Pegel nicht erreichbar"; state.pegelTrend=null; snap.pegel=null; }
  try{
    const q = await getJSON(base+"/Q/measurements.json?start=P2D");
    if(!q.length) throw 0;
    const last = q[q.length-1];
    $("qVal").innerHTML = fmt(last.value)+' <small>m³/s</small>';
    $("qMeta").innerHTML = trendBadge(q)+' · '+relTime(last.timestamp);
    sparkline($("qSpark"), q.slice(-96), "#2dd4bf");
    snap.q = last.value;
  }catch(e){ $("qVal").innerHTML='<span class="err">–</span>'; $("qMeta").textContent="kein Durchfluss an dieser Station"; snap.q=null; }
}

async function loadWeather(){
  const url = "https://api.open-meteo.com/v1/forecast?latitude="+WXPOS.lat+"&longitude="+WXPOS.lon+
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m"+
    "&hourly=pressure_msl&daily=sunrise,sunset,precipitation_sum"+
    "&timezone=Europe%2FBerlin&forecast_days=1&wind_speed_unit=kmh";
  try{
    const d = await getJSON(url), c = d.current;
    $("airVal").innerHTML = fmt(c.temperature_2m,1)+' <small>°C</small>';
    $("airMeta").textContent = "gefühlt "+fmt(c.apparent_temperature,1)+" °C";
    $("windVal").innerHTML = fmt(c.wind_speed_10m)+' <small>km/h '+windDir(c.wind_direction_10m)+'</small>';
    $("windMeta").textContent = "Böen "+fmt(c.wind_gusts_10m)+" km/h";
    $("rainVal").innerHTML = fmt(c.precipitation,1)+' <small>mm/h</small>';
    $("rainMeta").textContent = "heute "+fmt(d.daily.precipitation_sum[0],1)+" mm";
    const wc = WMO[c.weather_code] || ["–","cloud"];
    $("skyVal").innerHTML = iconLabel(wc[1],wc[0]);
    $("skyMeta").textContent = "Bewölkung "+fmt(c.cloud_cover)+" % · Feuchte "+fmt(c.relative_humidity_2m)+" %";
    $("sunVal").innerHTML = iconLabel("sunrise",hhmm(d.daily.sunrise[0])+" – "+hhmm(d.daily.sunset[0]));
    $("sunMeta").textContent = "Sonnenauf- / -untergang";

    let pt=null;
    try{
      const now=new Date(c.time), times=d.hourly.time.map(t=>new Date(t));
      let i=times.findIndex(t=>t>=now); if(i<1) i=times.length-1;
      pt = d.hourly.pressure_msl[i] - d.hourly.pressure_msl[Math.max(0,i-3)];
    }catch(_){}
    let trendIcon="minus", ptxt="stabil";
    if(pt!=null){ if(pt>0.8){trendIcon="trend-up";ptxt="steigend";} else if(pt<-0.8){trendIcon="trend-down";ptxt="fallend";} }
    $("pressVal").innerHTML = fmt(c.pressure_msl)+' <small>hPa</small> '+uiIcon(trendIcon);
    $("pressMeta").textContent = "Tendenz "+ptxt+" (3 h)";
    state.pressTrend=pt; state.gust=c.wind_gusts_10m; state.rainNow=c.precipitation; state.wcode=c.weather_code;
    snap.weather = {
      lufttemperatur_c: c.temperature_2m, gefuehlt_c: c.apparent_temperature,
      luftfeuchte_pct: c.relative_humidity_2m, niederschlag_mm_h: c.precipitation,
      wettercode: c.weather_code, wetterlage: (WMO[c.weather_code]||["",""])[0],
      bewoelkung_pct: c.cloud_cover, luftdruck_hpa: c.pressure_msl,
      sonnenaufgang: d.daily.sunrise[0], sonnenuntergang: d.daily.sunset[0],
      luftdruck_tendenz_3h_hpa: (pt==null? null : Math.round(pt*10)/10),
      wind_kmh: c.wind_speed_10m, windrichtung: windDir(c.wind_direction_10m),
      windrichtung_grad: c.wind_direction_10m, boen_kmh: c.wind_gusts_10m
    };
  }catch(e){ $("skyVal").innerHTML='<span class="err">Wetter n/v</span>'; }
}

function updateAmpel(){
  let score=0; const reasons=[];
  if(state.pressTrend!=null){
    if(state.pressTrend<-3){ score-=1; reasons.push("Luftdruck fällt stark (Wetterumschwung)"); }
    else if(state.pressTrend<=0.8){ score+=1; reasons.push("Luftdruck stabil/leicht fallend – oft gute Beißzeit"); }
    else if(state.pressTrend>3){ score-=1; reasons.push("Luftdruck steigt stark – Fische oft träge"); }
  }
  if(state.gust!=null){
    if(state.gust>=45){ score-=1; reasons.push("kräftige Böen ("+fmt(state.gust)+" km/h)"); }
    else if(state.gust>=12 && state.gust<35){ score+=1; reasons.push("leichte Kräuselung durch Wind"); }
  }
  if(state.rainNow>=2 || [82,95,96,99].includes(state.wcode)){ score-=1; reasons.push("Starkregen/Gewitter"); }
  if(state.pegelTrend && state.pegelTrend.length>13){
    const s=state.pegelTrend, diff=s[s.length-1].value-s[s.length-13].value;
    if(diff>6){ score-=1; reasons.push("Pegel steigt schnell (+"+fmt(diff)+" cm/3h) – Wasser wird trüb"); }
    else if(Math.abs(diff)<=4){ reasons.push("Pegel stabil"); }
  }
  const lv=ampelLevel(score);
  $("condDot").className="dot "+lv.cls; $("condDot").innerHTML=uiIcon(lv.icon);
  $("condLvl").textContent=lv.long;
  $("condWhy").textContent = reasons.length ? reasons.join(" · ") : "Keine auffälligen Faktoren.";
}
/* gemeinsame Einstufung (gleiche Wörter/Icons wie im Angelplatz) */
function ampelLevel(score){
  if(score>=2)  return {cls:"lg-green", icon:"circle-check", word:"Gut",       long:"Gute Bedingungen"};
  if(score<=-1) return {cls:"lg-red",   icon:"warning",      word:"Schwierig", long:"Schwierige Bedingungen"};
  return              {cls:"lg-amber", icon:"minus",        word:"Mittel",    long:"Mittelmäßige Bedingungen"};
}

function copyCoords(){
  const t = CUR.lat+", "+CUR.lon;
  navigator.clipboard?.writeText(t).then(()=>{
    const b=$("copyBtn"), o=b.innerHTML; setIconLabel(b,"check","kopiert"); setTimeout(()=>b.innerHTML=o,1500);
  }).catch(()=>{});
}

// Einstufung Wasserwerte in 5 Stufen (Faustregel für Angler)
function classifyWQ(label, num){
  if(num==null || isNaN(num)) return null;
  const labels=["sehr niedrig","niedrig","normal","hoch","sehr hoch"];
  let bands, colors;
  if(label==="Wassertemperatur"){ bands=[4,10,20,25];  colors=["pg-red","pg-amber","pg-green","pg-amber","pg-red"]; }
  else if(label==="O₂-Sättigung"){ bands=[60,80,110,130]; colors=["pg-red","pg-amber","pg-green","pg-amber","pg-red"]; }
  else if(label==="Trübung"){       bands=[2,5,15,40];    colors=["pg-green","pg-green","pg-amber","pg-amber","pg-red"]; }
  else return null;
  let i=0; while(i<bands.length && num>=bands[i]) i++;
  return { t:labels[i], c:colors[i] };
}
function qualityIcon(label){
  const s=String(label||"").toLowerCase();
  if(s.includes("temperatur")) return "thermometer";
  if(s.includes("sauerstoff")||s.includes("sättigung")) return "oxygen";
  if(s.includes("trüb")||s.includes("schwebstoff")) return "turbidity";
  if(s.includes("pegel")||s.includes("durchfluss")) return "gauge";
  return "droplet";
}
function renderQuality(){
  const box=$("quality"); if(!box) return;
  const st=$("qStamp");
  const cur=wqCurrent();
  if(!cur){
    box.innerHTML='<div class="qtile"><div class="lbl">'+uiIcon('droplet')+' Wasserqualität</div>'+
      '<div class="hint">Für dieses Gewässer liegen (noch) keine Wasserwerte vor. Pegel &amp; Wetter passen aber zum Angelplatz.</div></div>';
    if(st) st.textContent="";
    return;
  }
  const items=(cur.items||[]).filter(it=> it.label!=="pH-Wert" && it.label!=="Leitfähigkeit");
  const CHARTABLE={"Wassertemperatur":1,"O₂-Sättigung":1,"Trübung":1,"Schwebstoff":1,"Sauerstoff":1};
  box.innerHTML = items.map(it=>{
    const cls=classifyWQ(it.label, deNum(it.value));
    const badge = cls ? '<span class="pgbadge '+cls.c+'">'+cls.t+'</span>' : '';
    const stripe = cls ? stripeColor(cls.c) : "var(--water)";
    const clk = (CHARTABLE[it.label] && (cur.history||{})[it.label]) ? ' clickable" onclick="openChart(\'wq:'+it.label+'\')' : '';
    const ext=it.chart_url||it.source_url||"";
    const val=(it.value==null||it.value==="")
      ? (ext?'<a href="'+esc(ext)+'" target="_blank" rel="noopener">Aktuelles Diagramm öffnen '+uiIcon('external')+'</a>':'keine Zahlen-API')
      : esc(it.value)+' <small>'+esc(it.unit||"")+'</small>';
    const meta=(it.value==null||it.value==="") ? 'Amtliche Messreihe' : badge+'Stand: '+esc(it.time||"–");
    return '<div class="tile'+clk+'" style="border-top-color:'+stripe+'"><div class="lbl">'+uiIcon(qualityIcon(it.label))+' '+esc(it.label)+'</div>'+
      '<div class="val">'+val+'</div><div class="meta">'+meta+'</div></div>';
  }).join("");
  if(st){
    if(cur.source==="live"){
      const dtxt = cur.dist>0.3 ? " · "+cur.dist.toFixed(1)+" km" : "";
      const extra=cur.supplement ? " · Zusatzwerte: "+esc(cur.supplement)+
        (cur.source_url?' <a href="'+esc(cur.source_url)+'" target="_blank" rel="noopener">amtlich '+uiIcon('external')+'</a>':'') : "";
      st.innerHTML='<span class="statusdot" style="color:var(--green)"></span> Live am Pegel '+esc(cur.name)+dtxt+" (PEGELONLINE) · Stand "+esc(cur.updated)+extra;
    } else if(cur.src==="niz"){
      const bet=cur.betreiber?" · "+esc(cur.betreiber):"";
      st.innerHTML="Gütestation "+esc(cur.name)+" · "+cur.dist.toFixed(1)+" km entfernt · Stand "+esc(cur.updated)+
        bet+' · Daten: <a href="https://niz.baden-wuerttemberg.de/oberflaechengewaesser/gueteparameter" target="_blank" rel="noopener">LUBW/NIZ '+uiIcon('external')+'</a>';
    } else if(cur.src==="hlnug"){
      st.innerHTML="Gütestation "+esc(cur.name)+" · "+cur.dist.toFixed(1)+" km entfernt · Stand "+esc(cur.updated)+
        ' · Daten: <a href="https://www.hlnug.de/messwerte/datenportal" target="_blank" rel="noopener">HLNUG '+uiIcon('external')+'</a>';
    } else if(cur.src==="undine" || String(cur.id||"").indexOf("undine-")===0){
      st.innerHTML="Gütestation "+esc(cur.name)+" · "+cur.dist.toFixed(1)+" km entfernt · Stand "+esc(cur.updated)+
        ' · Daten: <a href="https://undine.bafg.de" target="_blank" rel="noopener">BfG/Undine '+uiIcon('external')+'</a>';
    } else {
      const sid=cur.id?String(cur.id):"";
      const surl=cur.source_url || (sid ? (/^https?:/.test(sid) ? sid : "https://geodaten-wasser.rlp-umwelt.de/gus/"+esc(sid)+"/messwerte") : "");
      const link=surl ? ' · <a href="'+esc(surl)+'" target="_blank" rel="noopener">amtlich '+uiIcon('external')+'</a>' : '';
      st.innerHTML="Gütestation "+esc(cur.name)+" · "+cur.dist.toFixed(1)+" km entfernt · Stand "+esc(cur.updated)+link;
    }
  }
}

async function loadQuality(){
  try{
    const r = await fetch("wasserwerte.json?t="+Math.floor(Date.now()/300000), {cache:"no-store"});
    if(r.ok){ const j = await r.json();
      if(j && Array.isArray(j.stations)){
        // Nur automatische/aktuelle Messreihen anzeigen. Damit verschwinden auch
        // periodische Altbestände sofort, selbst wenn noch eine ältere JSON-Datei
        // aus dem Cache geladen wurde.
        j.stations=j.stations.filter(s=>!s.periodic).map(s=>{
          if(Array.isArray(s.items)) s.items=s.items.filter(item=>!item.periodic);
          return s;
        });
        window.WQ = j;
      }
      else if(j && Array.isArray(j.items)) window.WQ = { updated:j.updated||"", stations:[{ id:"2511510500", name:"Mainz-Wiesbaden", lat:50.0068, lon:8.2795, river:"Rhein", updated:j.updated||"", items:j.items, history:j.history||{} }] };
    }
  }catch(e){ console.warn("wasserwerte.json konnte nicht geladen werden",e); }
  mergeNIZ();                               // BW-NIZ-Stationen anhängen (falls schon geladen)
  mergeHessen();                            // Hessen-HLNUG-Stationen anhängen
  renderQuality();
  // Die Ebene kann schon vor wasserwerte.json gezeichnet worden sein. Danach
  // neu zeichnen, damit GKD-/NID-Werte (z. B. Ingolstadt) sofort sichtbar sind.
  if(STATIONS_VISIBLE && typeof addStationDots === "function") addStationDots();
}
function activeWQ(){
  const st=(window.WQ&&window.WQ.stations)||[]; if(!st.length) return null;
  const sp=activeSpot();
  if(sp && spotType(sp)==="fluss" && !sp.uuid) return null;
  const river = (sp&&sp.river) ? sp.river : (CUR&&CUR.river ? CUR.river : null);
  if(!river) return null;                                   // Fluss unbekannt: keine Güte (nie Mainz-Notlösung)
  const rk = String(river).toLowerCase().trim();
  const exact = st.filter(s => String(s.river||"").toLowerCase().trim() === rk && (s.items||[]).length);  // NUR gleicher Fluss, nur darstellbare Werte/Diagramme
  if(!exact.length) return null;                            // kein Messpunkt an diesem Fluss: nichts anzeigen
  // Ein reiner Pegelpunkt darf eine am selben Gewässer vorhandene Temperatur-/
  // Gütestation nicht verdrängen (wichtig bei den österreichischen Landesfeeds).
  const quality = exact.filter(s=>{ const p=guteParams(s); return p.wt||p.o2||p.tr; });
  const cand = quality.length ? quality : exact;
  let best=null, bd=1e9;
  for(const s of cand){ if(s.lat==null) continue; const d=haversine(WXPOS.lat,WXPOS.lon,s.lat,s.lon); if(d<bd){ bd=d; best=s; } }
  if(!best || bd>WQ_MAXKM) return null;
  return { station:best, dist:bd };
}

/* Live-Wasserwerte direkt vom Pegel des Angelplatzes (PEGELONLINE, ganz Deutschland).
   Viele WSV-Stationen liefern Wassertemperatur (WT), einige auch O2/Leitfähigkeit/pH – im 15-Min-Takt. */
const PO_TS_MAP = { WT:["Wassertemperatur","°C","",1], O2:["Sauerstoff","mg/l","",1],
                    LF:["Leitfähigkeit","µS/cm","",0], PH:["pH-Wert","","",2] };
window.LIVEWQ = null;
function hhmm2(iso){ const d=new Date(iso), p=n=>String(n).padStart(2,"0");
  return p(d.getDate())+"."+p(d.getMonth()+1)+"."+d.getFullYear()+" "+p(d.getHours())+":"+p(d.getMinutes()); }
function histFromPO(arr){
  const by={}; for(const p of arr){ const d=new Date(p.timestamp); d.setMinutes(0,0,0); by[d.getTime()]=+p.value; }
  return Object.keys(by).sort((a,b)=>a-b).map(k=>({t:new Date(+k).toISOString().slice(0,16), v:Math.round(by[k]*1000)/1000}));
}
/* Sucht die nächste Station am selben Fluss, die Wassertemperatur (WT) liefert. */
async function loadLiveWQ(){
  window.LIVEWQ=null;
  const sp=activeSpot();
  const river = (sp&&sp.river) ? sp.river : (CUR&&CUR.river) || null;
  const cands=[];
  if(CUR && CUR.uuid) cands.push(CUR);
  if(river){
    STATIONS.filter(s=>s.river===river && s.uuid)
      .map(s=>({s, d:haversine(WXPOS.lat,WXPOS.lon,s.lat,s.lon)}))
      .sort((a,b)=>a.d-b.d).slice(0,10)
      .forEach(o=>{ if(!cands.some(c=>c.uuid===o.s.uuid)) cands.push(o.s); });
  }
  for(const stn of cands){
    const d=haversine(WXPOS.lat,WXPOS.lon,stn.lat,stn.lon);
    if(d>WQ_MAXKM) break;
    let wt; try{ wt=await getJSON(PO_BASE+"/stations/"+stn.uuid+"/WT/measurements.json?start=P8D"); }catch(e){ continue; }
    if(!wt || !wt.length) continue;
    const last=wt[wt.length-1];
    const items=[{label:"Wassertemperatur", value:(+last.value).toFixed(1).replace(".",","), unit:"°C", icon:"", time:hhmm2(last.timestamp)}];
    const history={ "Wassertemperatur": histFromPO(wt) };
    for(const sh of ["O2","LF","PH"]){    // Zusatzwerte, wenn die Station sie hat
      try{ const span=sh==="O2"?"P8D":"PT6H";
        const m=await getJSON(PO_BASE+"/stations/"+stn.uuid+"/"+sh+"/measurements.json?start="+span);
        if(m && m.length){ const def=PO_TS_MAP[sh], l=m[m.length-1];
          items.push({label:def[0], value:(+l.value).toFixed(def[3]).replace(".",","), unit:def[1], icon:def[2], time:hhmm2(l.timestamp)});
          if(sh==="O2") history[def[0]]=histFromPO(m); }
      }catch(e){}
    }
    window.LIVEWQ={ station:stn.name, dist:d, items, history, updated:items[0].time };
    return;
  }
}
/* Aktuelle Wasserqualitäts-Quelle: bevorzugt Live-Pegel (frisch, am Ort), sonst Gütestation (JSON). */
function wqCurrent(){
  const live=window.LIVEWQ;
  const aw=activeWQ();
  if(live && live.items && live.items.length){
    // PEGELONLINE bleibt die frischeste Temperaturquelle. Fehlende O2-/Trübungs-/
    // Schwebstoffwerte der Landesmessstation werden aber zusätzlich angezeigt.
    const key=it=>{ const l=String(it.label||"").toLowerCase();
      if(l.includes("wassertemperatur")) return "wt"; if(l.includes("sauerstoff")||l.includes("o₂")) return "o2";
      if(l.includes("trübung")||l.includes("truebung")) return "tr"; if(l.includes("schwebstoff")) return "ss"; return l; };
    const items=(live.items||[]).slice(), have=new Set(items.map(key));
    if(aw) for(const it of (aw.station.items||[])){ const k=key(it); if(!have.has(k)){ items.push(it); have.add(k); } }
    return { items, history:Object.assign({},aw?aw.station.history||{}:{},live.history||{}), name:live.station,
      dist:(live.dist||0), source:"live", id:(CUR&&CUR.uuid)||"", updated:live.updated||"",
      supplement:aw?aw.station.name:"", source_url:aw?aw.station.source_url||"":"" };
  }
  if(aw) return { items:aw.station.items||[], history:aw.station.history||{}, name:aw.station.name, dist:aw.dist,
                  source:"guete", id:aw.station.id||"", src:aw.station.src||"", betreiber:aw.station.betreiber||"",
                  source_url:aw.station.source_url||"",
                  updated:aw.station.updated||(window.WQ&&window.WQ.updated)||"" };
  return null;
}

/* Baden-Württemberg: Live-Wassergüte (Temperatur + O2/pH/Leitfähigkeit/Trübung) direkt vom
   NIZ-Backend der LUBW (client-seitig, CORS offen). 133 Stationen in einem Aufruf.
   Es wird nichts gespeichert/neu gehostet – der Browser lädt direkt bei der LUBW. */
const NIZ_URL = "https://inovum-services.de/gmb/md/v1/gewaesser;1.0.0?page[limit]=1000";
window.NIZBW = [];
function nizTime(ms){ if(!ms) return ""; const d=new Date(+ms), p=n=>String(n).padStart(2,"0");
  return p(d.getDate())+"."+p(d.getMonth()+1)+"."+d.getFullYear()+" "+p(d.getHours())+":"+p(d.getMinutes()); }
function mergeNIZ(){
  if(!window.NIZBW || !window.NIZBW.length) return;
  if(!window.WQ) window.WQ={updated:"",stations:[]};
  if(!Array.isArray(window.WQ.stations)) window.WQ.stations=[];
  const have=new Set(window.WQ.stations.map(s=>s.id));
  for(const s of window.NIZBW){ if(!have.has(s.id)) window.WQ.stations.push(s); }
}
async function loadNizBW(){
  if(window.NIZBW && window.NIZBW.length) return;         // nur einmal laden
  let j; try{ const r=await fetch(NIZ_URL,{cache:"no-store"}); if(!r.ok) return; j=await r.json(); }catch(e){ return; }
  const out=[];
  for(const it of (j.data||[])){
    const a=it.attributes||{}, g=a.geometry||{}; if(g.lat==null) continue;
    const M=a.messreihen||{}, items=[];
    const push=(mr,label,unit,icon,dec)=>{
      if(!mr || (mr.status && mr.status!=="operational")) return;
      const v=mr.values && mr.values.latest; if(v==null || v==="") return;
      const num=parseFloat(String(v).replace(",",".")); if(isNaN(num)) return;
      items.push({label, value:num.toFixed(dec).replace(".",","), unit, icon, time:nizTime(mr.values["latest-ts"])});
    };
    push(M.temp,"Wassertemperatur","°C","",1);
    push(M.o2,"Sauerstoff","mg/l","",1);
    push(M.tr,"Trübung","FNU","",1);
    push(M.lf,"Leitfähigkeit","µS/cm","",0);
    push(M.pH,"pH-Wert","","",1);
    if(!items.length) continue;
    out.push({ id:"niz-"+(a.id||it.id), name:(a.name||a.gewaesser||""), lat:g.lat, lon:g.lon,
               river:(a.gewaesser||""), betreiber:(a.betreiber||""), src:"niz",
               updated:items[0].time, items, history:{} });
  }
  window.NIZBW=out; mergeNIZ();
}

/* Hessen (HLNUG): Live-Wassergüte der kontinuierlichen DFÜ-Gütemessstationen, client-seitig
   über app.hlnug.de. Wassertemperatur = Parameter 150, Sauerstoff = 124. Werte-Fenster wird
   an den letzten verfügbaren Zeitstempel gehängt (sonst liefert die API leere Reihen). */
const HLNUG_BASE="https://app.hlnug.de/json/wasser/";
window.HESSENWQ=[];
function mergeHessen(){
  if(!window.HESSENWQ || !window.HESSENWQ.length) return;
  if(!window.WQ) window.WQ={updated:"",stations:[]};
  if(!Array.isArray(window.WQ.stations)) window.WQ.stations=[];
  const have=new Set(window.WQ.stations.map(s=>s.id));
  for(const s of window.HESSENWQ){ if(!have.has(s.id)) window.WQ.stations.push(s); }
}
async function hlnugVal(sid,param,from,to){
  try{ const cd=await fetch(HLNUG_BASE+"getStationChartData/"+sid+"/"+param+"/"+from+"/"+to+"?pad=1&valueType=1").then(r=>r.json());
    const s=cd&&cd[0]; const d=(s&&s.data||[]).filter(p=>p[1]!=null); const last=d[d.length-1];
    return last ? {v:last[1], t:last[0], history:d.map(p=>({t:new Date(+p[0]).toISOString().slice(0,16),v:+p[1]}))} : null; }catch(e){ return null; }
}
async function loadHessen(){
  if(window.HESSENWQ && window.HESSENWQ.length) return;      // nur einmal laden
  let list; try{ list=await fetch(HLNUG_BASE+"getThemeStations/6/63,67,55,69,110,126,138,144?tformat=d.m.Y%20H:i").then(r=>r.json()); }catch(e){ return; }
  const conti=(list||[]).filter(s=>s.isConti==1);
  if(!conti.length) return;
  let max=0; try{ const mm=await fetch(HLNUG_BASE+"getStationMinMaxTime/"+conti[0].stationId+"/1").then(r=>r.json()); max=mm&&mm.max; }catch(e){}
  if(!max) max=Math.floor(Date.now()/1000);
  const from=max-8*86400, to=max+3600;
  const out=[];
  await Promise.all(conti.map(async st=>{
    const sid=st.stationId;
    const [wt,o2]=await Promise.all([hlnugVal(sid,150,from,to), hlnugVal(sid,124,from,to)]);
    if(!wt) return;                                          // ohne Temperatur nicht anzeigen
    const parts=String(st.displayName||"").split(",");
    const river=(parts[0]||"").trim();
    const place=(parts[1]||"").replace(/Messstation.*/,"").trim();
    const items=[{label:"Wassertemperatur", value:(+wt.v).toFixed(1).replace(".",","), unit:"°C", icon:"", time:nizTime(wt.t)}];
    if(o2) items.push({label:"Sauerstoff", value:(+o2.v).toFixed(1).replace(".",","), unit:"mg/l", icon:"", time:nizTime(o2.t)});
    const history={"Wassertemperatur":wt.history||[]};
    if(o2) history["Sauerstoff"]=o2.history||[];
    out.push({ id:"he-"+sid, name:(place||river), lat:+st.lat, lon:+st.lon, river, betreiber:"HLNUG", src:"hlnug",
               updated:items[0].time, items, history });
  }));
  window.HESSENWQ=out; mergeHessen();
}
