"use strict";

/* Wasserqualität wird beim Laden aus wasserwerte.json geholt (mehrere Gütestationen).
   Die GitHub-Action aktualisiert die Datei stündlich. Nur Startwert: */
window.WQ = { "updated": "", "stations": [] };
const WQ_MAXKM = 60;   // Gütestation nur nutzen, wenn näher als … km und gleicher Fluss

const PO_BASE = "https://www.pegelonline.wsv.de/webservices/rest-api/v2";
const MAINZ_UUID = "a37a9aa3-45e9-4d90-9df6-109f3a28a5af";
const SPOTS_KEY = "rheincheck_spots_v1";
const ACTIVE_KEY = "rheincheck_activespot_v1";
let STATIONS = [{uuid:MAINZ_UUID, name:"Mainz", km:498.27, lat:50.003995, lon:8.275319, river:"Rhein"}];
let CUR = STATIONS[0];                 // aktuelle Messstation (für Pegel/Durchfluss)
let WXPOS = {lat:50.003995, lon:8.275319}; // Ort für Wetter (Angelplatz-Koordinaten)
const REF_CACHE = {};                  // Hauptwerte je Station-UUID
function poStation(){ return PO_BASE+"/stations/"+CUR.uuid; }

const $ = id => document.getElementById(id);
const fmt = (n,d=0) => (n==null||isNaN(n)) ? "–" : Number(n).toLocaleString("de-DE",{minimumFractionDigits:d,maximumFractionDigits:d});
const hesc = s => String(s==null?"":s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function uiIcon(name, extra){ return '<svg class="uiicon'+(extra?' '+extra:'')+'" aria-hidden="true"><use href="#i-'+name+'"></use></svg>'; }
function iconLabel(name,text){ return uiIcon(name)+' '+hesc(text); }
function setIconLabel(el,name,text){ if(el) el.innerHTML=iconLabel(name,text); }

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
      try{ const m=await getJSON(PO_BASE+"/stations/"+stn.uuid+"/"+sh+"/measurements.json?start=PT6H");
        if(m && m.length){ const def=PO_TS_MAP[sh], l=m[m.length-1];
          items.push({label:def[0], value:(+l.value).toFixed(def[3]).replace(".",","), unit:def[1], icon:def[2], time:hhmm2(l.timestamp)}); }
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
    return last ? {v:last[1], t:last[0]} : null; }catch(e){ return null; }
}
async function loadHessen(){
  if(window.HESSENWQ && window.HESSENWQ.length) return;      // nur einmal laden
  let list; try{ list=await fetch(HLNUG_BASE+"getThemeStations/6/63,67,55,69,110,126,138,144?tformat=d.m.Y%20H:i").then(r=>r.json()); }catch(e){ return; }
  const conti=(list||[]).filter(s=>s.isConti==1);
  if(!conti.length) return;
  let max=0; try{ const mm=await fetch(HLNUG_BASE+"getStationMinMaxTime/"+conti[0].stationId+"/1").then(r=>r.json()); max=mm&&mm.max; }catch(e){}
  if(!max) max=Math.floor(Date.now()/1000);
  const from=max-90000, to=max+3600;
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
    out.push({ id:"he-"+sid, name:(place||river), lat:+st.lat, lon:+st.lon, river, betreiber:"HLNUG", src:"hlnug",
               updated:items[0].time, items, history:{} });
  }));
  window.HESSENWQ=out; mergeHessen();
}

/* ===================== Fangbuch ===================== */
const CATCH_KEY = "rheincheck_faenge_v1";
function loadCatches(){ try{ return JSON.parse(localStorage.getItem(CATCH_KEY)) || []; }catch(e){ return []; } }
function saveCatches(a){ try{ localStorage.setItem(CATCH_KEY, JSON.stringify(a)); }catch(e){ alert("Speichern fehlgeschlagen (Speicher voll?)."); } }
let FB_FILTER="spot";   // "spot" = nur aktiver Angelplatz, "all" = alle
function catchesForView(){
  const all=loadCatches();
  if(FB_FILTER==="spot"){ const n=activeSpotName(); if(n) return all.filter(c=>c.angelplatz===n); }
  return all;
}
function toggleFbFilter(){ FB_FILTER = (FB_FILTER==="spot") ? "all" : "spot"; updateFilterBtn(); refreshFangbuch(); }
function updateFilterBtn(){ const b=$("filterBtn"); if(!b) return; const n=activeSpotName(); setIconLabel(b,"pin",(FB_FILTER==="spot") ? ("nur: "+(n||"aktueller Platz")) : "alle Plätze"); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function deNum(s){ if(s==null) return null; const n=parseFloat(String(s).replace(/\./g,'').replace(',','.')); return isNaN(n)? String(s) : n; }

function moonPhase(date){
  const syn=29.530588853, ref=Date.UTC(2000,0,6,18,14,0);
  let age=(((date.getTime()-ref)/86400000) % syn + syn) % syn;
  const illum=Math.round((1-Math.cos(2*Math.PI*age/syn))/2*100);
  const N=[[1.85,"Neumond"],[5.54,"zunehmende Sichel"],[9.23,"zunehmender Halbmond"],
    [12.91,"zunehmender Mond"],[16.61,"Vollmond"],[20.30,"abnehmender Mond"],
    [23.99,"abnehmender Halbmond"],[27.68,"abnehmende Sichel"]];
  let name="Neumond"; for(const [lim,nm] of N){ if(age<lim){ name=nm; break; } }
  return { name, age:Math.round(age*10)/10, illum };
}

function waterQualitySnap(){
  const M={ "Wassertemperatur":"wassertemperatur_c","Sauerstoff":"sauerstoff_mgl",
    "O₂-Sättigung":"o2_saettigung_pct","Trübung":"truebung","Schwebstoff":"schwebstoff_gm3",
    "pH-Wert":"ph","Leitfähigkeit":"leitfaehigkeit_uScm" };
  const cur=wqCurrent(); const items=cur?cur.items:[];
  const out={ stand:(cur&&cur.updated)||"", station:(cur&&cur.name)||"", quelle:(cur&&cur.source)||"",
    entfernung_km:(cur? Math.round(cur.dist*10)/10 : null) };
  items.forEach(it=>{ const k=M[it.label],v=deNum(it.value); if(k&&typeof v==="number"&&!isNaN(v)) out[k]=v; });
  return out;
}

function captureGps(){
  if(!navigator.geolocation){ $("gpsInfo").textContent="Ortung auf diesem Gerät nicht verfügbar."; return; }
  setIconLabel($("gpsBtn"),"pin","wird geortet …");
  navigator.geolocation.getCurrentPosition(p=>{
    setSelectedLocation(p.coords.latitude, p.coords.longitude, p.coords.accuracy, true);
    setIconLabel($("gpsBtn"),"pin","Standort aktualisieren");
  }, ()=>{
    $("gpsInfo").textContent="Ortung abgelehnt/fehlgeschlagen – Fang wird ohne Standort gespeichert.";
    setIconLabel($("gpsBtn"),"pin","Handy-Standort");
  }, {enableHighAccuracy:true, timeout:10000, maximumAge:0});
}

function readKoeder(){
  const base=($("f_koeder_base")?$("f_koeder_base").value:"").trim();
  const varLabel=($("f_koeder_var")?$("f_koeder_var").value:"").trim();
  const label = varLabel || base;
  let variante="";
  if(varLabel && base && varLabel.toLowerCase().indexOf(base.toLowerCase())===0)
    variante = varLabel.slice(base.length).replace(/^[\s,]+/,"").trim();
  return { label, base, variante };
}
function buildRecord(blank){
  const datum=$("f_datum").value, zeit=$("f_zeit").value;
  const dObj = datum ? new Date(datum+"T"+(zeit||"12:00")) : new Date();
  const mp=moonPhase(dObj);
  const sp=activeSpot();
  const k=readKoeder();
  return {
    id: Date.now(),
    erfasst_iso: new Date().toISOString(),
    kein_fang: !!blank,
    gewaesser: sp ? (sp.gewaesser||sp.river||"") : "",
    gewaessertyp: spotType(sp),
    angelplatz: sp ? sp.name : "",
    datum, uhrzeit: zeit,
    fischart: blank ? "" : $("f_art").value.trim(),
    groesse_cm: (!blank && $("f_groesse").value) ? +$("f_groesse").value : null,
    gewicht_kg: (!blank && $("f_gewicht").value) ? +$("f_gewicht").value : null,
    verwertung: blank ? "" : ($("f_verwertung")?$("f_verwertung").value:""),
    koeder: k.label,
    koeder_basis: k.base,
    koeder_variante: k.variante,
    methode: ($("f_methode") ? $("f_methode").value.trim() : ""),
    notiz: $("f_notiz").value.trim(),
    gps: CURRENT_GPS,
    mondphase: { name:mp.name, alter_tage:mp.age, illumination_pct:mp.illum },
    wetter: snap.weather,
    wasser: Object.assign({
      pegelstand_cm: snap.pegel? snap.pegel.pegelstand_cm : null,
      pegel_stufe: snap.pegel? snap.pegel.stufe : null,
      durchfluss_m3s: snap.q,
      wassertemperatur_modell_c: (snap.marineTemp!=null ? snap.marineTemp : null)
    }, waterQualitySnap()),
    station: { pegel: CUR?CUR.name:"", pegel_uuid: CUR?CUR.uuid:"", km: CUR?CUR.km:null }
  };
}
let EDIT_CATCH_ID=null;
function resetCatchEdit(){
  EDIT_CATCH_ID=null;
  const b=$("fbSaveBtn"), c=$("fbEditCancel");
  setIconLabel(b,"fish","Fang speichern");
  if(c) c.style.display="none";
}
function saveCatch(opts){
  opts=opts||{};
  const blank = opts.blank || !$("f_art").value.trim();   // ohne Fischart => Leereintrag (Angeltag)
  const rec=buildRecord(blank);
  const arr=loadCatches();
  if(EDIT_CATCH_ID!=null){
    const i=arr.findIndex(c=>String(c.id)===String(EDIT_CATCH_ID));
    if(i>=0){
      const old=arr[i];
      // Beim Bearbeiten bleiben die damals gespeicherten Bedingungen erhalten.
      rec.id=old.id; rec.erfasst_iso=old.erfasst_iso;
      rec.wetter=old.wetter; rec.wasser=old.wasser; rec.mondphase=old.mondphase;
      arr[i]=rec;
    } else arr.push(rec);
  } else arr.push(rec);
  saveCatches(arr);
  $("f_art").value=""; $("f_groesse").value=""; $("f_gewicht").value=""; $("f_notiz").value="";
  if($("f_koeder_base")) $("f_koeder_base").value=""; onKoederBaseChange();
  if($("f_methode")) $("f_methode").value=""; if($("f_verwertung")) $("f_verwertung").value="";
  const now=new Date(), pad=n=>String(n).padStart(2,'0');
  $("f_zeit").value=pad(now.getHours())+':'+pad(now.getMinutes());
  clearSelectedLocation();
  const wasEdit=EDIT_CATCH_ID!=null; resetCatchEdit();
  populateCatchSpots();
  refreshFangbuch();
  const bt=$(blank?"fbBlankBtn":"fbSaveBtn");
  if(bt){ const o=bt.innerHTML; setIconLabel(bt,"check",wasEdit?"Änderungen gespeichert":(blank?"Angeltag gespeichert":"Fang gespeichert")); setTimeout(()=>{ if(EDIT_CATCH_ID==null) setIconLabel(bt,"fish","Fang speichern"); else bt.innerHTML=o; }, 1500); }
}
function saveBlank(){ saveCatch({blank:true}); }

function editCatch(id){
  const c=loadCatches().find(x=>String(x.id)===String(id)); if(!c) return;
  const sp=loadSpots().find(s=>s.name===c.angelplatz);
  if(sp) activateSpotById(sp.id);
  openSpot(sp?sp.id:null); openFangbuchForm();
  EDIT_CATCH_ID=c.id;
  $("f_art").value=c.fischart||""; $("f_groesse").value=c.groesse_cm==null?"":c.groesse_cm;
  $("f_gewicht").value=c.gewicht_kg==null?"":c.gewicht_kg;
  if($("f_verwertung")) $("f_verwertung").value=c.verwertung||"";
  $("f_datum").value=c.datum||""; $("f_zeit").value=c.uhrzeit||""; $("f_notiz").value=c.notiz||"";
  populateKoeder();
  if($("f_koeder_base")) $("f_koeder_base").value=c.koeder_basis||c.koeder||"";
  onKoederBaseChange();
  if($("f_koeder_var") && c.koeder) $("f_koeder_var").value=c.koeder||"";
  CURRENT_GPS=c.gps||null;
  const gi=$("gpsInfo"); if(gi) gi.innerHTML=CURRENT_GPS?iconLabel("pin","Fangort: "+CURRENT_GPS.lat+", "+CURRENT_GPS.lon):"Kein eigener Fangort gespeichert.";
  const b=$("fbSaveBtn"), x=$("fbEditCancel"); setIconLabel(b,"check","Änderungen speichern"); if(x) x.style.display="";
  showFishRules();
  setTimeout(()=>$("fangbuchBox")&&$("fangbuchBox").scrollIntoView({behavior:"smooth",block:"start"}),120);
}
function cancelCatchEdit(){ resetCatchEdit(); $("f_art").value=""; $("f_groesse").value=""; $("f_gewicht").value=""; $("f_notiz").value=""; showFishRules(); }

function deleteCatch(id){
  if(!confirm("Diesen Fang löschen?")) return;
  saveCatches(loadCatches().filter(c=>c.id!==id));
  refreshFangbuch();
}

function weightStr(c){
  if(c.gewicht_kg!=null) return ' · '+String(c.gewicht_kg).replace('.',',')+' kg';
  if(c.gewicht_g!=null) return ' · '+c.gewicht_g+' g';   // Altdaten
  return '';
}
function catchCard(c){
  const w=c.wetter||{}, wa=c.wasser||{}, water=[], weather=[], context=[], extra=[];
  if(wa.wassertemperatur_c!=null) water.push("Wassertemperatur "+wa.wassertemperatur_c+" °C");
  if(wa.wassertemperatur_modell_c!=null) water.push("Wassertemperatur Modell "+wa.wassertemperatur_modell_c+" °C");
  if(wa.pegelstand_cm!=null) water.push("Pegel "+wa.pegelstand_cm+" cm"+(wa.pegel_stufe?" ("+wa.pegel_stufe+")":""));
  if(wa.durchfluss_m3s!=null) water.push("Durchfluss "+wa.durchfluss_m3s+" m³/s");
  if(wa.sauerstoff_mgl!=null) water.push("Sauerstoff "+wa.sauerstoff_mgl+" mg/l");
  if(wa.o2_saettigung_pct!=null) water.push("O₂-Sättigung "+wa.o2_saettigung_pct+" %");
  if(wa.truebung!=null) water.push("Trübung "+wa.truebung);
  if(wa.schwebstoff_gm3!=null) water.push("Schwebstoff "+wa.schwebstoff_gm3+" g/m³");
  if(wa.ph!=null) water.push("pH "+wa.ph);
  if(wa.leitfaehigkeit_uScm!=null) water.push("Leitfähigkeit "+wa.leitfaehigkeit_uScm+" µS/cm");
  if(w.lufttemperatur_c!=null) weather.push("Lufttemperatur "+w.lufttemperatur_c+" °C");
  if(w.luftdruck_hpa!=null) weather.push("Luftdruck "+Math.round(w.luftdruck_hpa)+" hPa");
  if(w.wind_kmh!=null) weather.push("Wind "+w.wind_kmh+" km/h"+(w.windrichtung?" "+w.windrichtung:""));
  if(w.boen_kmh!=null) weather.push("Böen "+w.boen_kmh+" km/h");
  if(w.niederschlag_mm_h!=null) weather.push("Niederschlag "+w.niederschlag_mm_h+" mm/h");
  if(w.wetterlage) weather.push(w.wetterlage);
  if(c.angelplatz) context.push("Angelplatz: "+c.angelplatz);
  if(c.gewaesser) context.push("Gewässer: "+c.gewaesser);
  if(c.gps&&c.gps.lat!=null) context.push("Fangort: "+c.gps.lat+", "+c.gps.lon);
  if(c.verwertung) extra.push("Verwertung: "+c.verwertung);
  if(c.methode) extra.push("Methode: "+c.methode);
  if(c.mondphase&&c.mondphase.name) extra.push("Mondphase: "+c.mondphase.name);
  if(c.notiz) extra.push("Notiz: „"+c.notiz+"“");
  const title = c.kein_fang
    ? uiIcon('ban')+' Kein Fang'
    : uiIcon('fish')+' '+esc(c.fischart)+(c.groesse_cm?' · '+c.groesse_cm+' cm':'')+weightStr(c);
  const short=c.kein_fang ? (esc(c.datum||"")+' '+esc(c.uhrzeit||"")) :
    (esc(c.datum||"")+' '+esc(c.uhrzeit||"")+(c.koeder?' · Köder: '+esc(c.koeder):''));
  const group=(label,arr)=>arr.length?'<div class="catchdetailgroup"><b>'+label+'</b><span>'+esc(arr.join(" · "))+'</span></div>':'';
  const details=group("Ort",context)+group("Wasserdaten",water)+group("Wetter",weather)+group("Weitere Angaben",extra);
  return '<div class="fbitem'+(c.kein_fang?' blank':'')+'"><div class="h"><span class="fish">'+title+'</span>'+
    '<span class="catchacts"><button class="editmini" onclick="editCatch('+c.id+')">bearbeiten</button>'+
    '<button class="del" onclick="deleteCatch('+c.id+')">'+uiIcon('close')+' löschen</button></span></div>'+
    '<div class="when">'+short+'</div>'+
    '<details class="catchdetails"><summary>Details</summary><div class="catchdetailbody">'+(details||'<span class="fbnote">Keine weiteren Angaben.</span>')+'</div></details></div>';
}
function renderCatches(){
  const arr=catchesForView().sort((a,b)=>((b.datum||"")+(b.uhrzeit||"")).localeCompare((a.datum||"")+(a.uhrzeit||"")));
  const cnt=$("fbCount"); if(cnt){ const f=arr.filter(isFish).length, d=countFishingDays(arr); cnt.textContent = f+" Fang"+(f===1?"":"e")+" · "+d+" Angeltag"+(d===1?"":"e"); }
  const box=$("fbList"); if(!box) return;
  if(!arr.length){ box.innerHTML='<div class="fbnote" style="padding:8px 4px">Noch keine Fänge – trag deinen ersten Fang oben ein.</div>'; return; }
  box.innerHTML = arr.map(catchCard).join("");
}
let CATCH_VIEW_SPOT = null;   // Name des Angelplatzes, oder null = Gesamtfangbuch
function isFish(c){ return !c.kein_fang && !!c.fischart; }
function countFishingDays(arr){ return new Set((arr||[]).map(c=>c.datum).filter(Boolean)).size; }
function fishCountForSpot(name){ return loadCatches().filter(c=>c.angelplatz===name && isFish(c)).length; }
function dayCountForSpot(name){ return countFishingDays(loadCatches().filter(c=>c.angelplatz===name)); }
function totalFish(){ return loadCatches().filter(isFish).length; }
function totalDays(){ return countFishingDays(loadCatches()); }
function countBadge(fish, days){
  return '<span class="countbadge" title="Fänge · Angeltage"><span class="fishico">'+uiIcon('fish')+'</span>'+fish+
    ' <span class="dayico">'+uiIcon('calendar')+'</span>'+days+'</span>';
}
function renderCatchList(){
  const box=$("catchList"); if(!box) return;
  const all=loadCatches();
  let arr = CATCH_VIEW_SPOT ? all.filter(c=>c.angelplatz===CATCH_VIEW_SPOT) : all;
  arr=arr.sort((a,b)=>((b.datum||"")+(b.uhrzeit||"")).localeCompare((a.datum||"")+(a.uhrzeit||"")));
  const t=$("catchListTitle");
  if(t) t.textContent = CATCH_VIEW_SPOT ? (CATCH_VIEW_SPOT+" Fangbuch") : "Gesamtfangbuch · alle Fänge";
  if(!arr.length){ box.innerHTML='<div class="fbnote" style="padding:10px 4px">Noch keine Fänge'+(CATCH_VIEW_SPOT?' hier':' erfasst')+'.</div>'; return; }
  box.innerHTML = arr.map(catchCard).join("");
}
function catchListBack(){ showFangbuchList(); }

/* ---- Export / Import ---- */
function download(name,text,type){
  const b=new Blob([text],{type:type||"text/plain;charset=utf-8"}), u=URL.createObjectURL(b);
  const a=document.createElement("a"); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),1500);
}
function exportJSON(){ download("faenge_rheincheck.json", JSON.stringify(loadCatches(),null,2), "application/json"); }
function W_(c,k){ return c.wetter&&c.wetter[k]!=null? c.wetter[k] : ""; }
function A_(c,k){ return c.wasser&&c.wasser[k]!=null? c.wasser[k] : ""; }
function exportCSV(){
  const arr=loadCatches();
  const cols=[
    ["id",c=>c.id],["datum",c=>c.datum],["uhrzeit",c=>c.uhrzeit],["kein_fang",c=>c.kein_fang?1:0],
    ["gewaesser",c=>c.gewaesser],["gewaessertyp",c=>c.gewaessertyp||""],["fischart",c=>c.fischart],
    ["angelplatz",c=>c.angelplatz],["groesse_cm",c=>c.groesse_cm],["gewicht_kg",c=>c.gewicht_kg],["gewicht_g",c=>c.gewicht_g],["koeder",c=>c.koeder],["koeder_basis",c=>c.koeder_basis||""],["koeder_variante",c=>c.koeder_variante||""],["methode",c=>c.methode],["verwertung",c=>c.verwertung||""],["notiz",c=>c.notiz],
    ["gps_lat",c=>c.gps?c.gps.lat:""],["gps_lon",c=>c.gps?c.gps.lon:""],["gps_genauigkeit_m",c=>c.gps?c.gps.genauigkeit_m:""],
    ["mondphase",c=>c.mondphase?c.mondphase.name:""],["mond_illum_pct",c=>c.mondphase?c.mondphase.illumination_pct:""],
    ["lufttemp_c",c=>W_(c,"lufttemperatur_c")],["gefuehlt_c",c=>W_(c,"gefuehlt_c")],["wind_kmh",c=>W_(c,"wind_kmh")],
    ["windrichtung",c=>W_(c,"windrichtung")],["boen_kmh",c=>W_(c,"boen_kmh")],["luftdruck_hpa",c=>W_(c,"luftdruck_hpa")],
    ["luftdruck_tendenz_3h_hpa",c=>W_(c,"luftdruck_tendenz_3h_hpa")],["bewoelkung_pct",c=>W_(c,"bewoelkung_pct")],
    ["luftfeuchte_pct",c=>W_(c,"luftfeuchte_pct")],["niederschlag_mm_h",c=>W_(c,"niederschlag_mm_h")],["wetterlage",c=>W_(c,"wetterlage")],
    ["pegel_cm",c=>A_(c,"pegelstand_cm")],["pegel_stufe",c=>A_(c,"pegel_stufe")],["durchfluss_m3s",c=>A_(c,"durchfluss_m3s")],
    ["wassertemp_c",c=>A_(c,"wassertemperatur_c")],["wassertemp_modell_c",c=>A_(c,"wassertemperatur_modell_c")],["sauerstoff_mgl",c=>A_(c,"sauerstoff_mgl")],["o2_saettigung_pct",c=>A_(c,"o2_saettigung_pct")],
    ["truebung",c=>A_(c,"truebung")],["ph",c=>A_(c,"ph")],["leitfaehigkeit_uScm",c=>A_(c,"leitfaehigkeit_uScm")]
  ];
  const cell=v=>{ if(v==null)v=""; v=String(v).replace(/"/g,'""'); return /[";\n]/.test(v)?'"'+v+'"':v; };
  const head=cols.map(c=>c[0]).join(";");
  const body=arr.map(c=>cols.map(col=>cell(col[1](c))).join(";")).join("\n");
  download("faenge_rheincheck.csv", "﻿"+head+"\n"+body, "text/csv;charset=utf-8");
}
function importJSON(ev){
  const f=ev.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const data=JSON.parse(rd.result); if(!Array.isArray(data)) throw 0;
      const cur=loadCatches(), ids=new Set(cur.map(x=>x.id)); let added=0;
      data.forEach(r=>{ if(r&&r.id!=null&&!ids.has(r.id)){ cur.push(r); ids.add(r.id); added++; } });
      saveCatches(cur); refreshFangbuch(); alert(added+" Fänge importiert.");
    }catch(e){ alert("Import fehlgeschlagen: keine gültige Fangbuch-JSON."); }
    ev.target.value="";
  };
  rd.readAsText(f);
}

/* ---- Leaflet-Karte ---- */
let MAP=null, CATCH_LAYER=null, SELECT_MARKER=null;
let STATIONS_LAYER=null, SPOTS_LAYER=null, STATIONS_VISIBLE=false, SPOTS_VISIBLE=true, SPOT_PICK=false, STATION_PICK=false;
let STATION_MINWERTE=false;   // false = alle Stationen, true = nur mit >= 2 Werten
let PO_PARAMS=null, PO_LOADING=false;            // uuid -> {wt,o2,tr}
async function ensureStationParams(){
  if(PO_PARAMS || PO_LOADING) return;
  PO_LOADING=true;
  try{
    const arr=await getJSON(PO_BASE+"/stations.json?includeTimeseries=true");
    const m={};
    for(const s of arr){
      const sh=(s.timeseries||[]).map(t=>String(t.shortname||"").toUpperCase());
      const pegel=sh.includes("W")||sh.includes("Q");   // Wasserstand/Abfluss = Pegel (grau)
      const wt=sh.includes("WT");
      if(!pegel && !wt) continue;
      m[s.uuid]={ pegel, wt, o2:sh.includes("O2"), tr:sh.some(x=>x==="TR"||x.indexOf("TRUEB")===0||x==="TB") };
    }
    PO_PARAMS=m;
  }catch(e){ PO_PARAMS={}; }
  PO_LOADING=false;
}
/* Farblogik fuer einzelne Altanzeigen; die Karte selbst nutzt Kuchen-Segmente. */
function paramColor(p){ if(!p||!p.wt) return null; if(p.o2&&p.tr) return "#8a5a2b"; if(p.o2) return "#3b82f6"; return "#e0483b"; }
function guteParams(st){ const L=(st.items||[]).map(i=>String(i.label||"").toLowerCase()),p=st.params||{};
  return { pegel:!!p.pegel||L.some(l=>l.includes("pegel")||l.includes("wasserstand")||l.includes("durchfluss")),
    wt:!!p.wt||L.some(l=>l.includes("wassertemperatur")),
    o2:!!p.o2||L.some(l=>l.includes("sauerstoff")||l.includes("o₂")),
    tr:!!p.tr||L.some(l=>l.includes("trübung")||l.includes("truebung")||l.includes("schwebstoff")) }; }
function initMap(){
  if(MAP || !window.L || !document.getElementById("map")) return;
  MAP = L.map("map",{scrollWheelZoom:false}).setView([WXPOS.lat, WXPOS.lon], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(MAP);
  STATIONS_LAYER=L.layerGroup(); SPOTS_LAYER=L.layerGroup();
  addStationDots(); addSpotMarkers();
  if(STATIONS_VISIBLE) STATIONS_LAYER.addTo(MAP);
  if(SPOTS_VISIBLE) SPOTS_LAYER.addTo(MAP);
  MAP.createPane("selectionPane");
  MAP.getPane("selectionPane").style.zIndex="690";
  MAP.getPane("selectionPane").style.pointerEvents="none";
  CATCH_LAYER=L.layerGroup().addTo(MAP);
  let stationRedrawTimer=null;
  MAP.on("moveend", ()=>{
    clearTimeout(stationRedrawTimer);
    stationRedrawTimer=setTimeout(addStationDots,70);
  });
  MAP.on("click", e=>{
    if(STATION_PICK){
      STATION_PICK=false; const hb=$("markHint"); if(hb) hb.style.display="none";
      const st=nearestStation(e.latlng.lat, e.latlng.lng);
      const sp=activeSpot();
      if(sp){ assignStationToSpot(sp.id, st.uuid); }
      else { activateStationFor(st.uuid); reflectStation(); updateStationMarker(); loadAll(); }
      return;
    }
    if(SPOT_PICK){
      SPOT_PICK=false; const hb=$("markHint"); if(hb) hb.style.display="none";
      createSpotAt(e.latlng.lat, e.latlng.lng); return;
    }
    if(MARKING){ setProvFangort(e.latlng.lat, e.latlng.lng); }
  });
  updateLayerBtns();
  renderMarkers();
}
/* Kuchen-Symbol: gleich große Segmente je vorhandenem Parameter.
   Reihenfolge/Farben: grau=Pegel, rot=Temperatur, blau=Sauerstoff, braun=Trübung/Schwebstoff. */
const SEG_DEF=[["pegel","#9aa3ab","Pegel"],["wt","#e0483b","Temperatur"],["o2","#3b82f6","Sauerstoff"],["tr","#8a5a2b","Trübung/Schwebstoff"]];
function segList(p){ return SEG_DEF.filter(d=>p&&p[d[0]]); }
function pieIcon(segs, r){
  r=r||7; const pad=2, c=r+pad, size=c*2, n=segs.length;
  let inner="";
  if(n<=1){ const col=n?segs[0][1]:"#9aa3ab";
    inner='<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="'+col+'" stroke="#fff" stroke-width="1"/>'; }
  else { for(let i=0;i<n;i++){
      const a0=(i/n)*2*Math.PI - Math.PI/2, a1=((i+1)/n)*2*Math.PI - Math.PI/2;
      const x0=(c+r*Math.cos(a0)).toFixed(2), y0=(c+r*Math.sin(a0)).toFixed(2);
      const x1=(c+r*Math.cos(a1)).toFixed(2), y1=(c+r*Math.sin(a1)).toFixed(2);
      const large=(a1-a0)>Math.PI?1:0;
      inner+='<path d="M'+c+','+c+' L'+x0+','+y0+' A'+r+','+r+' 0 '+large+' 1 '+x1+','+y1+' Z" fill="'+segs[i][1]+'" stroke="#fff" stroke-width="0.8"/>';
    }
    inner+='<circle cx="'+c+'" cy="'+c+'" r="'+r+'" fill="none" stroke="#fff" stroke-width="1"/>';
  }
  const svg='<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" xmlns="http://www.w3.org/2000/svg">'+inner+'</svg>';
  return L.divIcon({className:"pie-ic", html:svg, iconSize:[size,size], iconAnchor:[c,c]});
}
function stationClusterIcon(count,segs){
  const size=count>=100?52:(count>=20?46:40), n=Math.max(1,segs.length);
  const stops=segs.length ? segs.map((d,i)=>d[1]+" "+((i/n)*360)+"deg "+(((i+1)/n)*360)+"deg").join(",") : "#9aa3ab 0deg 360deg";
  const html='<div class="sensor-cluster" style="--cluster-size:'+size+'px;--cluster-ring:conic-gradient('+stops+')"><span>'+count+'</span></div>';
  return L.divIcon({className:"sensor-cluster-wrap",html,iconSize:[size,size],iconAnchor:[size/2,size/2]});
}
function clusterStationList(list){
  if(!MAP) return list;
  const zoom=MAP.getZoom()||6;
  if(zoom>=11 || list.length<2) return list;
  const cell=zoom<=6?86:(zoom<=8?70:54), buckets=new Map();
  for(const o of list){
    const p=MAP.project([o.s.lat,o.s.lon],zoom);
    const key=Math.floor(p.x/cell)+":"+Math.floor(p.y/cell);
    if(!buckets.has(key)) buckets.set(key,[]);
    buckets.get(key).push(o);
  }
  const out=[];
  for(const group of buckets.values()){
    if(group.length===1){ out.push(group[0]); continue; }
    const keys=new Set(), segs=[];
    let lat=0,lon=0;
    for(const o of group){
      lat+=+o.s.lat; lon+=+o.s.lon;
      for(const seg of o.segs){ if(!keys.has(seg[0])){ keys.add(seg[0]); segs.push(seg); } }
    }
    segs.sort((a,b)=>SEG_DEF.findIndex(x=>x[0]===a[0])-SEG_DEF.findIndex(x=>x[0]===b[0]));
    out.push({cluster:true,count:group.length,lat:lat/group.length,lon:lon/group.length,segs});
  }
  return out;
}
function addStationDots(){
  if(!STATIONS_LAYER) return;
  STATIONS_LAYER.clearLayers();
  if(!STATIONS_VISIBLE) return;
  // Alle Punkte einsammeln: PEGELONLINE (mit grauem Pegel-Segment) + Güte/NIZ-Stationen
  const pts=[];
  for(const s of STATIONS){ const p=PO_PARAMS&&PO_PARAMS[s.uuid]; if(!p) continue;
    pts.push({lat:s.lat, lon:s.lon, name:s.name, river:s.river, r:5, p}); }
  const gu=(window.WQ&&window.WQ.stations)||[];
  for(const s of gu){ if(s.lat==null) continue; const g=guteParams(s);
    pts.push({lat:s.lat, lon:s.lon, name:s.name, river:s.river, id:s.id, source_url:s.source_url||"", r:6,
      p:{pegel:g.pegel,wt:g.wt,o2:g.o2,tr:g.tr}, guete:true}); }
  // Messnetze am selben Ort zusammenfassen. Andernfalls verdecken sich z. B.
  // in Ingolstadt der graue PEGELONLINE- und der GKD/NID-Gütepunkt.
  { const merged=[];
    const norm=x=>String(x||"").toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss").replace(/[^a-z0-9]/g,"");
    for(const s of pts){
      const nr=norm(s.river);
      const hit=merged.find(x=>nr&&norm(x.river)===nr&&haversine(s.lat,s.lon,x.lat,x.lon)<2);
      if(!hit){ merged.push(s); continue; }
      hit.p={pegel:!!(hit.p.pegel||s.p.pegel),wt:!!(hit.p.wt||s.p.wt),o2:!!(hit.p.o2||s.p.o2),tr:!!(hit.p.tr||s.p.tr)};
      hit.guete=hit.guete||s.guete; hit.r=Math.max(hit.r||5,s.r||5);
      if(s.guete){ hit.name=s.name; hit.id=s.id; hit.lat=s.lat; hit.lon=s.lon; hit.source_url=s.source_url||hit.source_url||""; }
    }
    pts.length=0; pts.push(...merged);
  }
  let list=pts.map(s=>({s, segs:segList(s.p)})).filter(o=>o.segs.length>0);
  // Filter: sichtbarer Ausschnitt + optional nur Stationen mit >= 2 Werten
  try{ if(MAP){ const b=MAP.getBounds().pad(.15); list=list.filter(o=>b.contains([o.s.lat,o.s.lon])); } }catch(e){}
  if(STATION_MINWERTE) list=list.filter(o=>o.segs.length>=2);
  // Deutschlandweit sind inzwischen deutlich mehr als 500 Pegel- und Gütepunkte
  // vorhanden. Der alte 500er-Schnitt ließ vor allem später geladene Landesnetze weg.
  if(list.length>2500) list=list.slice(0,2500);
  list=clusterStationList(list);
  for(const o of list){
    if(o.cluster){
      const mk=L.marker([o.lat,o.lon],{icon:stationClusterIcon(o.count,o.segs),keyboard:true});
      mk.bindTooltip(o.count+" Messstationen · antippen zum Vergrößern");
      mk.on("click",()=>MAP.setView([o.lat,o.lon],Math.min((MAP.getZoom()||6)+2,12)));
      STATIONS_LAYER.addLayer(mk);
      continue;
    }
    const names=o.segs.map(d=>d[2]).join("+");
    const mk=L.marker([o.s.lat,o.s.lon],{icon:pieIcon(o.segs, o.s.r)});
    mk.bindTooltip((o.s.guete?"Gütestation ":"Pegel ")+o.s.name+" · "+(o.s.river||"")+" · "+names);
    if(o.s.source_url) mk.bindPopup('<b>'+esc(o.s.name)+'</b><br>'+esc(o.s.river||"")+'<br>'+esc(names)+
      '<br><a href="'+esc(o.s.source_url)+'" target="_blank" rel="noopener">Amtliche Messstation öffnen '+uiIcon('external')+'</a>');
    STATIONS_LAYER.addLayer(mk);
  }
}
function toggleStationMode(){
  STATION_MINWERTE=!STATION_MINWERTE; updateLayerBtns();
  if(STATIONS_VISIBLE) addStationDots();
}
function spotLatLon(sp){
  if(sp.lat!=null && sp.lon!=null) return [sp.lat, sp.lon];
  const st=STATIONS.find(x=>x.uuid===sp.uuid); return st?[st.lat,st.lon]:[CUR.lat,CUR.lon];
}
function addSpotMarkers(){
  if(!SPOTS_LAYER || !window.L) return;
  SPOTS_LAYER.clearLayers();
  const icon=L.divIcon({className:"spot-ic",
    html:'<svg width="26" height="26" viewBox="0 0 24 24" fill="rgba(15,23,42,.55)" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M12 22s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6" fill="none"/></svg>',
    iconSize:[26,26], iconAnchor:[13,26]});
  for(const sp of loadSpots()){
    const ll=spotLatLon(sp);
    const mk=L.marker(ll,{icon}).bindTooltip(uiIcon('pin')+' '+esc(sp.name));
    mk.on("click", ()=>openSpot(sp.id));
    SPOTS_LAYER.addLayer(mk);
  }
}
function toggleStationsLayer(){
  STATIONS_VISIBLE=!STATIONS_VISIBLE; updateLayerBtns();
  if(!MAP || !STATIONS_LAYER) return;
  if(STATIONS_VISIBLE){
    const a=$("layStations"); setIconLabel(a,"gauge","lädt …");
    ensureStationParams().then(()=>{
      // In der Länderübersicht Deutschland plus AT/CH/NL gemeinsam zeigen.
      try{
        const home=$("homeView");
        if(home && home.style.display!=="none" && (MAP.getZoom()||6)<=7)
          MAP.fitBounds([[45.6,3.0],[55.7,17.4]],{padding:[24,24],maxZoom:7});
      }catch(e){}
      addStationDots(); STATIONS_LAYER.addTo(MAP); updateLayerBtns();
    });
  } else { STATIONS_LAYER.remove(); }
}
function toggleSpotsLayer(){ SPOTS_VISIBLE=!SPOTS_VISIBLE; if(MAP&&SPOTS_LAYER){ if(SPOTS_VISIBLE) SPOTS_LAYER.addTo(MAP); else SPOTS_LAYER.remove(); } updateLayerBtns(); }
function updateLayerBtns(){ const a=$("layStations"), b=$("laySpots"), m=$("layMode");
  setIconLabel(a,"gauge","Stationen"); setIconLabel(b,"pin","Angelplätze");
  if(a) a.classList.toggle("active",STATIONS_VISIBLE); if(b) b.classList.toggle("active",SPOTS_VISIBLE);
  if(m){ m.textContent=STATION_MINWERTE?"≥2 Werte":"alle"; m.style.display=STATIONS_VISIBLE?"":"none"; } }
function setSelectedLocation(lat, lon, acc, pan){
  CURRENT_GPS={ lat:+(+lat).toFixed(6), lon:+(+lon).toFixed(6), genauigkeit_m: (acc==null? null : Math.round(acc)) };
  if(MAP && window.L){
    if(!SELECT_MARKER){
      SELECT_MARKER=L.circleMarker([lat,lon],{pane:"selectionPane",radius:10,color:"#fff",weight:3,fillColor:"#fbbf24",fillOpacity:.9}).addTo(MAP);
      SELECT_MARKER.bindPopup("Gewählter Fangort");
    } else SELECT_MARKER.setLatLng([lat,lon]);
    if(SELECT_MARKER.bringToFront) SELECT_MARKER.bringToFront();
    if(pan){ try{ MAP.setView([lat,lon], Math.max(MAP.getZoom()||13, 15)); }catch(e){} }
  }
  const extra = CURRENT_GPS.genauigkeit_m!=null ? " (Handy, ±"+CURRENT_GPS.genauigkeit_m+" m)" : " (auf Karte gewählt)";
  const gi=$("gpsInfo");
  if(gi) gi.innerHTML=uiIcon('pin')+' Fangort: '+CURRENT_GPS.lat+', '+CURRENT_GPS.lon+extra+
    ' · <a href="#" onclick="clearSelectedLocation();return false;">entfernen</a>';
}
function clearSelectedLocation(){
  CURRENT_GPS=null; MARKING=false; removeProv();
  if(SELECT_MARKER && MAP){ MAP.removeLayer(SELECT_MARKER); SELECT_MARKER=null; }
  const gi=$("gpsInfo"); if(gi) gi.textContent="Kein Standort gewählt – nutze die Handy-Ortung oder „Auf Karte markieren\".";
  setIconLabel($("gpsBtn"),"pin","Handy-Standort");
  const hb=$("markHint"); if(hb) hb.style.display="none";
}
function renderMarkers(){
  if(!CATCH_LAYER) return;
  CATCH_LAYER.clearLayers();
  const cs=catchesForView().filter(c=>c.gps&&c.gps.lat!=null);
  cs.forEach(c=>{
    const wa=c.wasser||{};
    const html='<b>'+esc(c.fischart||"Fang")+'</b>'+(c.groesse_cm?' · '+c.groesse_cm+' cm':'')+
      '<br>'+esc(c.datum||"")+' '+esc(c.uhrzeit||"")+(c.angelplatz?'<br>Platz: '+esc(c.angelplatz):'')+(c.koeder?'<br>Köder: '+esc(c.koeder):'')+
      (wa.pegelstand_cm!=null?'<br>Pegel: '+wa.pegelstand_cm+' cm':'')+
      (wa.wassertemperatur_c!=null?'<br>Wasser: '+wa.wassertemperatur_c+' °C':'');
    L.circleMarker([c.gps.lat,c.gps.lon],{radius:6,color:"#4ade80",weight:2,fillColor:"#4ade80",fillOpacity:.85})
      .bindPopup(html).addTo(CATCH_LAYER);
  });
  if(cs.length){ try{ MAP.fitBounds(L.featureGroup(CATCH_LAYER.getLayers()).getBounds().pad(0.3)); }catch(e){} }
}
function clearCatchMarkers(){ if(CATCH_LAYER) CATCH_LAYER.clearLayers(); }

let MARKING=false, PROV=null, PROV_MARKER=null;
function markOnMap(){
  MARKING=true; removeProv();
  if(!MAP) initMap();
  const hb=$("markHint"); if(hb){ hb.innerHTML=uiIcon('target')+" Tippe auf die Karte an die Stelle deines Fangs."; hb.style.display="block"; }
  const m=document.getElementById("map"); if(m) m.scrollIntoView({behavior:"smooth", block:"center"});
}
function setProvFangort(lat, lon){                 // erst provisorisch – muss bestätigt werden
  PROV={ lat:+(+lat).toFixed(6), lon:+(+lon).toFixed(6) };
  if(MAP && window.L){
    if(!PROV_MARKER){ PROV_MARKER=L.circleMarker([lat,lon],{pane:"selectionPane",radius:12,color:"#fff",weight:3,fillColor:"#fbbf24",fillOpacity:.82}).addTo(MAP); }
    else PROV_MARKER.setLatLng([lat,lon]);
    if(PROV_MARKER.bringToFront) PROV_MARKER.bringToFront();
  }
  const hb=$("markHint");
  if(hb){ hb.innerHTML=uiIcon('pin')+' Fangort hier setzen? <button class="mhbtn" onclick="confirmFangort()">'+uiIcon('check')+' Bestätigen</button><button class="mhbtn sec" onclick="cancelFangort()">'+uiIcon('close')+' Abbrechen</button>'; hb.style.display="block"; }
}
function removeProv(){ if(PROV_MARKER && MAP){ try{ MAP.removeLayer(PROV_MARKER); }catch(e){} } PROV_MARKER=null; PROV=null; }
function confirmFangort(){
  if(!PROV) return;
  setSelectedLocation(PROV.lat, PROV.lon, null, false);
  removeProv();
  const hb=$("markHint");
  if(hb){ hb.innerHTML=uiIcon('check')+' Fangort gesetzt · für einen weiteren Ort erneut tippen · <a href="#" onclick="scrollToSave();return false;">Fang speichern</a> · <a href="#" onclick="stopMarking();return false;">fertig</a>'; hb.style.display="block"; }
  // MARKING bleibt aktiv – der nächste Fangort kann direkt markiert werden
}
function cancelFangort(){ removeProv(); const hb=$("markHint"); if(hb){ hb.innerHTML=uiIcon('target')+' Tippe auf die Karte an die Stelle deines Fangs.'; hb.style.display="block"; } }
function stopMarking(){ MARKING=false; removeProv(); const hb=$("markHint"); if(hb) hb.style.display="none"; }
function scrollToSave(){ const b=document.getElementById("fbSaveBtn"); if(b) b.scrollIntoView({behavior:"smooth", block:"center"}); }
function centerOnActiveSpot(){
  if(!MAP) return;
  const sp=activeSpot(); const ll = sp ? spotLatLon(sp) : [WXPOS.lat, WXPOS.lon];
  try{ MAP.setView(ll, Math.max(MAP.getZoom()||13, 13)); }catch(e){}
}
function mountMapCard(hostId,isHome){
  const host=$(hostId), card=$("mapCard"), add=$("mapAddSpot");
  if(host&&card&&card.parentElement!==host) host.appendChild(card);
  if(card) card.classList.toggle("home-map-card",!!isHome);
  if(add) add.style.display=isHome?"inline-flex":"none";
}
function centerHomeMap(){
  if(!MAP) return;
  const points=loadSpots().map(spotLatLon).filter(x=>x&&isFinite(x[0])&&isFinite(x[1]));
  try{
    if(points.length>1) MAP.fitBounds(points,{padding:[34,34],maxZoom:13});
    else if(points.length===1) MAP.setView(points[0],13);
    else MAP.fitBounds([[45.6,3.0],[55.7,17.4]],{padding:[24,24],maxZoom:7});
  }catch(e){}
}
function renderTable(){
  const box=$("fbTable"); if(!box) return;
  const arr=catchesForView().sort((a,b)=>((b.datum||"")+(b.uhrzeit||"")).localeCompare((a.datum||"")+(a.uhrzeit||"")));
  if(!arr.length){ box.innerHTML='<div class="fbnote" style="padding:8px 4px">Noch keine Fänge.</div>'; return; }
  const rows=arr.map(c=>{
    const ort = c.gps ? (c.gps.lat+', '+c.gps.lon) : esc(c.gewaesser||"");
    return '<tr><td>'+esc(c.datum||"")+'</td><td>'+esc(c.uhrzeit||"")+'</td><td>'+(c.kein_fang?"— (kein Fang)":esc(c.fischart||""))+'</td>'+
      '<td>'+(c.groesse_cm!=null?c.groesse_cm:"")+'</td><td>'+(c.gewicht_kg!=null?c.gewicht_kg:(c.gewicht_g!=null?(c.gewicht_g/1000):""))+'</td>'+
      '<td>'+esc(c.koeder||"")+'</td><td>'+esc(c.angelplatz||"")+'</td><td>'+ort+'</td></tr>';
  }).join("");
  box.innerHTML='<div class="fbwrap"><table class="fbtable"><thead><tr>'+
    '<th>Datum</th><th>Zeit</th><th>Fischart</th><th>cm</th><th>kg</th><th>Köder</th><th>Angelplatz</th><th>Ort</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div>';
}
function toggleTable(){
  const box=$("fbTable"), b=$("tblBtn"); if(!box) return;
  const show=(box.style.display==="none" || !box.style.display);
  if(show){ renderTable(); box.style.display="block"; setIconLabel(b,"table","Tabelle ausblenden"); }
  else { box.style.display="none"; setIconLabel(b,"table","Tabelle anzeigen"); }
}
function toggleList(){
  const box=$("fbList"), b=$("listBtn"); if(!box) return;
  const show=(box.style.display==="none" || !box.style.display);
  box.style.display = show ? "block" : "none";
  if(b) b.textContent = show ? "Fänge ausblenden" : "Fänge anzeigen";
}
function refreshFangbuch(){
  renderCatches(); renderMarkers();
  if($("fbTable") && $("fbTable").style.display==="block") renderTable();
  if($("catchListView") && $("catchListView").style.display!=="none") renderCatchList();
  if($("fbIndexView") && $("fbIndexView").style.display!=="none") renderFbIndex();
  if($("homeView") && $("homeView").style.display!=="none") renderSpotList();
  if($("statsView") && $("statsView").style.display!=="none") renderStats();
}

/* Gesetzliche Basiswerte. Gewässerordnungen/Erlaubnisscheine können strengere
   Regeln enthalten. Bayern und NRW sind aus den amtlichen Landesvorschriften
   hinterlegt; bei anderen Ländern wird bewusst keine Zahl geraten. */
const FISH_RULES=window.FISH_RULES||{};
function fishKey(s){
  const key=String(s||"").toLowerCase().trim().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss").replace(/[^a-z]/g,"");
  const aliases={forelle:"bachforelle",flussforelle:"bachforelle",truesche:"quappe",rutte:"quappe",aalrutte:"quappe",
    aitel:"doebel",schied:"rapfen",blei:"brassen",brachse:"brassen",flussbarsch:"barsch",paling:"aal",
    snoek:"hecht",snoekbaars:"zander",baars:"barsch",alet:"doebel",felchen:"renke"};
  return aliases[key]||key;
}
function countryRuleKey(code){ return code==="ch"?"Schweiz":code==="nl"?"Niederlande":""; }
async function resolveSpotRegion(sp){
  if(!sp) return {key:"",label:"Standort nicht ermittelbar",country:""};
  if(sp.country_code){
    const ck=countryRuleKey(sp.country_code);
    return {key:FISH_RULES[sp.bundesland]?sp.bundesland:(ck||sp.bundesland||""),label:sp.bundesland||ck||sp.country_code,country:sp.country_code};
  }
  const ll=spotLatLon(sp);
  try{
    const u="https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=7&accept-language=de&lat="+encodeURIComponent(ll[0])+"&lon="+encodeURIComponent(ll[1]);
    const r=await fetch(u); if(!r.ok) throw new Error("Geokodierung"); const j=await r.json(), a=j.address||{};
    const state=a.state||a.region||a.province||"", code=String(a.country_code||"").toLowerCase(), ck=countryRuleKey(code);
    const list=loadSpots(), x=list.find(s=>String(s.id)===String(sp.id));
    if(x){ x.bundesland=state; x.country_code=code; x.land=a.country||""; saveSpots(list); }
    return {key:FISH_RULES[state]?state:(ck||state),label:state||ck||a.country||"Standort",country:code};
  }catch(e){
    const state=sp.bundesland||"", ck=countryRuleKey(sp.country_code||"");
    return {key:FISH_RULES[state]?state:(ck||state),label:state||ck||"Standort nicht ermittelbar",country:sp.country_code||""};
  }
}
let RULE_REQ=0;
async function showFishRules(){
  const box=$("fishRules"); if(!box) return; const art=$("f_art")?$("f_art").value.trim():"";
  if(!art){ box.style.display="none"; box.innerHTML=""; return; }
  const req=++RULE_REQ, sp=activeSpot(); box.style.display="block"; box.textContent="Bestimmungen am Angelplatz werden ermittelt …";
  const region=await resolveSpotRegion(sp); if(req!==RULE_REQ) return;
  const data=FISH_RULES[region.key], rule=data&&data.rules[fishKey(art)];
  const caution='<small> Erlaubnisschein, Gewässerordnung und örtliche Verfügungen können strengere oder abweichende Regeln enthalten.</small>';
  if(rule){
    const extra=rule[2]?'<br><small>'+esc(rule[2])+'</small>':'';
    box.innerHTML='<b>'+esc(region.label)+' · '+esc(art)+'</b><br>Mindestmaß: <b>'+esc(rule[0])+'</b> · Schonzeit: <b>'+esc(rule[1])+'</b>'+extra+(data.note?'<br><small>'+esc(data.note)+'</small>':'')+'<br>'+caution;
  } else if(data){
    box.innerHTML='<b>'+esc(region.label)+' · '+esc(art)+'</b><br>Diese Fischbezeichnung ist in der eingebetteten allgemeinen Tabelle nicht eindeutig aufgeführt.'+(data.note?'<br><small>'+esc(data.note)+'</small>':'')+'<br>'+caution;
  } else {
    box.innerHTML='<b>'+esc(region.label)+' · '+esc(art)+'</b><br>Für diesen Standort ist noch keine allgemeine Regel eindeutig hinterlegt.<br>'+caution;
  }
}

function initFangbuch(){
  const now=new Date(), pad=n=>String(n).padStart(2,'0');
  if($("f_datum")) $("f_datum").value = now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  if($("f_zeit")) $("f_zeit").value = pad(now.getHours())+':'+pad(now.getMinutes());
  populateCatchSpots();
  updateFilterBtn();
  updateFangbuchBtn();
  renderBaitList();
  refreshFangbuch();
  initMap();
}

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
const WQ_UNIT={"Wassertemperatur":"°C","O₂-Sättigung":"%","Trübung":"TE"};
const WQ_COLOR={"Wassertemperatur":"#fbbf24","O₂-Sättigung":"#4ade80","Trübung":"#8ea2be"};
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
  CHART_KEY=key; $("cmTitle").textContent=def.title+" – Verlauf";
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
  updateFangbuchBtn();
}

/* ===================== Angelplatz / Stationswahl ===================== */
function tidy(s){ return String(s||"").toLowerCase().replace(/(^|[\s\-\/])([a-zäöü])/g,(m,a,b)=>a+b.toUpperCase()); }
function haversine(la1,lo1,la2,lo2){
  const R=6371, r=Math.PI/180, dLa=(la2-la1)*r, dLo=(lo2-lo1)*r,
    x=Math.sin(dLa/2)**2 + Math.cos(la1*r)*Math.cos(la2*r)*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
async function loadStations(){
  try{
    const arr=await getJSON(PO_BASE+"/stations.json");   // alle deutschen Pegel (alle Flüsse)
    const list=arr.filter(s=>s.latitude&&s.longitude)
      .map(s=>({uuid:s.uuid, name:tidy(s.shortname), km:s.km, lat:s.latitude, lon:s.longitude,
        river:(s.water&&s.water.shortname)? tidy(s.water.shortname) : ""}))
      .sort((a,b)=>a.name.localeCompare(b.name));
    if(list.length) STATIONS=list;
  }catch(e){}
}
function nearestList(lat, lon, n){
  return STATIONS.map(s=>({s, d:haversine(lat,lon,s.lat,s.lon)})).sort((a,b)=>a.d-b.d).slice(0, n||8);
}
function nearestStation(lat,lon,river){
  let pool=STATIONS;
  if(river){ const f=STATIONS.filter(s=>s.river===river); if(f.length) pool=f; }
  let best=pool[0], bd=1e9; for(const s of pool){ const d=haversine(lat,lon,s.lat,s.lon); if(d<bd){ bd=d; best=s; } } return best;
}
function activeSpot(){ return loadSpots().find(x=>String(x.id)===String(localStorage.getItem(ACTIVE_KEY))) || null; }
function activeSpotName(){ const s=activeSpot(); return s ? s.name : ""; }
function assignStationToSpot(spotId, uuid){
  const spots=loadSpots(), sp=spots.find(x=>String(x.id)===String(spotId)), st=STATIONS.find(x=>x.uuid===uuid);
  if(!sp || !st) return;
  sp.uuid=st.uuid; sp.station=st.name; sp.river=st.river; saveSpots(spots);
  activateStationFor(st.uuid);
  reflectStation(); updateStationMarker(); renderSpots(); populateCatchSpots(); loadAll();
}
/* Stations-Auswahl (nächste Stationen mit Fluss + Entfernung) */
function openStationPicker(lat, lon, onPick){
  const box=$("stPickList"); if(!box){ if(onPick) onPick(nearestStation(lat,lon).uuid); return; }
  const list=nearestList(lat, lon, 8);
  box.innerHTML='<button class="stpick stpick-none" onclick="__stPick(\'\')">'+uiIcon('ban')+' Keine Messstation</button>'+
    list.map(o=>'<button class="stpick" onclick="__stPick(\''+o.s.uuid+'\')">'+esc(o.s.name)+
    ' <small>· '+esc(o.s.river||"?")+' · '+o.d.toFixed(1)+' km</small></button>').join("");
  window.__stPickCb = onPick;
  const m=$("stationModal"); if(m) m.style.display="flex";
}
function __stPick(uuid){ const cb=window.__stPickCb; window.__stPickCb=null; const m=$("stationModal"); if(m) m.style.display="none"; if(cb) cb(uuid); }
function closeStationPicker(){ window.__stPickCb=null; const m=$("stationModal"); if(m) m.style.display="none"; }
function pegPickList(){
  hidePegEdit();
  const sp=activeSpot();
  const la = sp && sp.lat!=null ? sp.lat : (sp? CUR.lat : WXPOS.lat);
  const lo = sp && sp.lon!=null ? sp.lon : (sp? CUR.lon : WXPOS.lon);
  openStationPicker(la, lo, function(uuid){
    if(sp) assignStationToSpot(sp.id, uuid);
    else { activateStationFor(uuid); reflectStation(); updateStationMarker(); loadAll(); }
  });
}
/* Messstation eines Angelplatzes ändern */
function togglePegEdit(){ if(spotType(activeSpot())!=="fluss") return; const el=$("pegEdit"); if(!el) return; el.style.display=(el.style.display==="none"||!el.style.display)?"inline-flex":"none"; }
function hidePegEdit(){ const el=$("pegEdit"); if(el) el.style.display="none"; }
function pegAuto(){
  hidePegEdit();
  const sp=activeSpot();
  if(sp){ const st=nearestStation(sp.lat!=null?sp.lat:CUR.lat, sp.lon!=null?sp.lon:CUR.lon, sp.river||null); assignStationToSpot(sp.id, st.uuid); }
  else { const st=nearestStation(WXPOS.lat, WXPOS.lon); activateStationFor(st.uuid); reflectStation(); updateStationMarker(); loadAll(); }
}
function pegPickMap(){
  hidePegEdit(); STATION_PICK=true;
  ensureMapVisible();
  const hb=$("markHint"); if(hb){ hb.innerHTML=uiIcon('target')+" Tippe die gewünschte Messstation an (grauer Punkt)."; hb.style.display="block"; }
  setTimeout(()=>{ const m=document.getElementById("map"); if(m) m.scrollIntoView({behavior:"smooth", block:"center"}); }, 120);
}
function applyWaterType(sp){
  const isRiver = spotType(sp)==="fluss";
  const hasStation=isRiver && !!(sp&&sp.uuid&&STATIONS.some(s=>s.uuid===sp.uuid));
  ["pegelSect","pegelGrid"].forEach(id=>{ const e=$(id); if(e) e.style.display = hasStation ? "" : "none"; });
  const cond=$("cond"); if(cond) cond.style.display=isRiver?"":"none";
  ["qSect","quality","qStamp"].forEach(id=>{ const e=$(id); if(e) e.style.display=""; });  // Wasserqualität auch für Seen (z. B. Ammersee)
  const bt=$("biteBtn"); if(bt) bt.style.display = isRiver ? "" : "none";
  if(!isRiver){ const bb=$("biteBox"); if(bb) bb.style.display="none"; }
  const wt=$("waterTempTile"); if(wt) wt.style.display = isRiver ? "none" : "";
  const hint=$("pegEditHint"); if(hint) hint.style.display = isRiver ? "" : "none";
}
function reflectStation(){
  const sp=loadSpots().find(x=>String(x.id)===String(localStorage.getItem(ACTIVE_KEY)));
  const title=$("spotTitle"); if(title) title.textContent=sp?sp.name:"–";
  const typ=spotType(sp);
  const pre=$("pegPrefix"), pn=$("staPegName");
  if(typ!=="fluss"){                                  // See / Meer: kein Pegel
    if(pre) pre.textContent="Gewässer:";
    if(pn) pn.textContent=(sp&&sp.gewaesser? sp.gewaesser : "")+(typ==="see"?" (See)":" (Meer)");
    applyWaterType(sp);
    return;
  }
  if(pre) pre.textContent="Messstation:";
  if(!sp || !sp.uuid || !STATIONS.some(s=>s.uuid===sp.uuid)){
    if(pn) pn.textContent="Keine Messstation";
    const ps=$("pegelSect"); if(ps) ps.textContent="Messstation · keine ausgewählt";
    applyWaterType(sp); return;
  }
  const ps=$("pegelSect"); if(ps) ps.textContent="Fluss · Messstation "+CUR.name+" (PEGELONLINE)";
  const cs=$("curStation"); if(cs) cs.textContent = (sp? "Angelplatz: "+sp.name+" · " : "")+"Messstation "+CUR.name+" · km "+CUR.km;
  if(pn) pn.textContent = CUR.name + (CUR.river? " ("+CUR.river+")" : "");
  const mc=$("mapCo"); if(mc) mc.innerHTML=iconLabel("pin","Pegel "+CUR.name+" · "+CUR.lat.toFixed(4)+"° N, "+CUR.lon.toFixed(4)+"° O");
  const mo=$("mapOsm"); if(mo) mo.href="https://www.openstreetmap.org/?mlat="+WXPOS.lat+"&mlon="+WXPOS.lon+"#map=14/"+WXPOS.lat+"/"+WXPOS.lon;
  const mg=$("mapGmaps"); if(mg) mg.href="https://www.google.com/maps/search/?api=1&query="+WXPOS.lat+","+WXPOS.lon;
  applyWaterType(sp);
}
function updateStationMarker(){
  // Der dauerhaft sichtbare blaue Pegelpunkt wurde entfernt. Zugeordnete
  // Stationen erscheinen nur noch in der einschaltbaren Sensor-Ebene.
}
function activateStationFor(uuid){ const s=STATIONS.find(x=>x.uuid===uuid); if(s){ CUR=s; delete HIST.pegel; delete HIST.durchfluss; delete HIST.wx; } }
/* gespeicherte Angelplätze */
function spotType(sp){ return (sp && sp.typ) ? sp.typ : "fluss"; }
function spotWaterLabel(s){
  const typ=spotType(s);
  if(typ==="see")  return "See · "+esc(s.gewaesser||s.river||"");
  if(typ==="meer") return "Meer · "+esc(s.gewaesser||s.river||"");
  return s.uuid ? ("Fluss · Messstation "+esc(s.station||"")+(s.river?" ("+esc(s.river)+")":"")) : "Fluss · keine Messstation";
}
function loadSpots(){ try{ return JSON.parse(localStorage.getItem(SPOTS_KEY))||[]; }catch(e){ return []; } }
function saveSpots(a){ localStorage.setItem(SPOTS_KEY, JSON.stringify(a)); }
function setAddMapView(){                 // Startausschnitt beim Anlegen: nicht rauszoomen
  if(!MAP) return;
  const spots=loadSpots();
  if(spots.length){ const last=spots[spots.length-1]; const ll=spotLatLon(last); try{ MAP.setView(ll, 13); }catch(e){} }  // ~5×5 km
  else { try{ MAP.setView([51.3, 10.4], 6); }catch(e){} }                                                                // Deutschland
}
function newSpotOnMap(){
  SPOT_PICK=true;
  // Beim Anlegen keine bereits gespeicherten grünen Fangpunkte einblenden.
  clearCatchMarkers();
  ensureMapVisible();
  setAddMapView();
  const hb=$("markHint"); if(hb){ hb.innerHTML=uiIcon('target')+" Tippe auf deinen Angelplatz auf der Karte – danach kannst du ihn benennen."; hb.style.display="block"; }
  setTimeout(()=>{ setAddMapView(); const m=document.getElementById("map"); if(m) m.scrollIntoView({behavior:"smooth", block:"center"}); }, 120);
}
function pickAuto(){
  if(!navigator.geolocation){ alert("Ortung auf diesem Gerät nicht verfügbar."); return; }
  navigator.geolocation.getCurrentPosition(p=>{ createSpotAt(p.coords.latitude, p.coords.longitude); },
    ()=>alert("Ortung fehlgeschlagen."), {enableHighAccuracy:true, timeout:10000, maximumAge:0});
}
let PENDING_SPOT=null;
function createSpotAt(lat, lon){                 // öffnet den Dialog (Name + Typ-Dropdown)
  PENDING_SPOT={lat, lon};
  const head=$("addSpotModal")?.querySelector(".cmhead span"); if(head) head.textContent="Angelplatz hinzufügen";
  if($("as_name")) $("as_name").value="";
  if($("as_typ")) $("as_typ").value="fluss";
  if($("as_gw")) $("as_gw").value="";
  asTypeChange();
  const m=$("addSpotModal"); if(m) m.style.display="flex";
  setTimeout(()=>{ const n=$("as_name"); if(n) n.focus(); }, 60);
}
function asTypeChange(){
  const typ=$("as_typ")?$("as_typ").value:"fluss";
  const row=$("as_gwrow"), hint=$("as_hint");
  if(typ==="fluss"){ if(row) row.style.display="none"; if(hint) hint.textContent="Für Flüsse kannst du danach eine passende Messstation wählen – oder keine Messstation verwenden."; }
  else { if(row) row.style.display=""; if(hint) hint.textContent="See/Meer: kein Pegel – Wetter, Mond & Bedingungen werden gespeichert."; }
}
function closeAddSpot(){ const m=$("addSpotModal"); if(m) m.style.display="none"; PENDING_SPOT=null; }
function confirmAddSpot(){
  if(!PENDING_SPOT) return;
  const name=($("as_name")?$("as_name").value:"").trim();
  if(!name){ alert("Bitte einen Namen eingeben."); if($("as_name")) $("as_name").focus(); return; }
  const typ=$("as_typ")?$("as_typ").value:"fluss";
  const lat=PENDING_SPOT.lat, lon=PENDING_SPOT.lon;
  const editId=PENDING_SPOT.editId, oldName=PENDING_SPOT.oldName||"";
  const targetId=editId!=null?editId:Date.now();
  const upsert=(base)=>{
    const spots=loadSpots(); let sp=spots.find(x=>String(x.id)===String(targetId));
    if(sp) Object.assign(sp,base); else spots.push(base);
    saveSpots(spots);
    if(oldName && oldName!==name){
      const catches=loadCatches(); catches.forEach(c=>{ if(c.angelplatz===oldName) c.angelplatz=name; }); saveCatches(catches);
    }
    addSpotMarkers(); renderSpotList(); openSpot(targetId);
  };
  if(typ==="fluss"){
    const m=$("addSpotModal"); if(m) m.style.display="none";      // Stationswahl folgt
    openStationPicker(lat, lon, function(uuid){
      const st=uuid ? STATIONS.find(x=>x.uuid===uuid) : null;
      const river=st?st.river:(PENDING_SPOT.oldRiver||"");
      upsert({id:targetId, name, lat:+lat.toFixed(6), lon:+lon.toFixed(6), typ:"fluss",
        uuid:st?st.uuid:null, station:st?st.name:"", river, gewaesser:river||"Fluss"});
      PENDING_SPOT=null;
    });
  } else {
    const gw=($("as_gw")?$("as_gw").value:"").trim() || (typ==="see"?"See":"Meer");
    upsert({id:targetId, name, lat:+lat.toFixed(6), lon:+lon.toFixed(6), typ, uuid:null, station:"", river:gw, gewaesser:gw});
    closeAddSpot();
  }
}
function activateSpotById(id, latlon){
  const sp=loadSpots().find(x=>String(x.id)===String(id)); if(!sp) return;
  localStorage.setItem(ACTIVE_KEY, sp.id);
  activateStationFor(sp.uuid);
  const ll = latlon || spotLatLon(sp);
  WXPOS={ lat:ll[0], lon:ll[1] };
  reflectStation(); updateStationMarker(); centerOnActiveSpot(); populateCatchSpots(); renderSpots();
  updateFilterBtn(); updateFangbuchBtn(); refreshFangbuch();
  loadAll();
}
function loadSpot(id){ activateSpotById(id); }
function deleteSpot(id){
  const sp=loadSpots().find(x=>String(x.id)===String(id)); if(!sp) return;
  if(!confirm('Angelplatz „'+sp.name+'" löschen?')) return;
  saveSpots(loadSpots().filter(x=>String(x.id)!==String(id)));
  if(String(localStorage.getItem(ACTIVE_KEY))===String(id)) localStorage.removeItem(ACTIVE_KEY);
  const n=loadCatches().filter(c=>c.angelplatz===sp.name).length;
  if(n>0 && confirm("Auch die "+n+" Fangbuch-Einträge dieses Angelplatzes löschen?")){
    saveCatches(loadCatches().filter(c=>c.angelplatz!==sp.name));
  }
  addSpotMarkers(); renderSpots(); populateCatchSpots();
}
function renderSpots(){
  const sel=$("spotSelect");
  const spots=loadSpots(), active=localStorage.getItem(ACTIVE_KEY);
  if(sel){
    if(!spots.length) sel.innerHTML='<option value="">— noch keiner —</option>';
    else { sel.innerHTML=spots.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join("");
      if(active && spots.some(s=>String(s.id)===String(active))) sel.value=active; }
  }
  const title=$("spotTitle"), current=spots.find(s=>String(s.id)===String(active));
  if(title) title.textContent=current?current.name:"–";
  renderSpotList();
}
const PIN_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
function renderSpotList(){
  const box=$("spotList"); if(!box) return;
  const spots=loadSpots();
  if(!spots.length){ box.innerHTML=
    '<div class="emptycard"><div class="emptyicon">'+PIN_SVG+'</div>'+
    '<div class="emptytitle">Noch kein Angelplatz gespeichert</div>'+
    '<div class="emptydesc">Wähle deinen Platz auf der Karte unten aus. Eine Standortfreigabe ist nicht nötig.</div></div>'; return; }
  box.innerHTML=spots.map(s=>'<div class="spotrow"><button class="spotopen" onclick="openSpot('+s.id+')">'+uiIcon('pin')+' '+esc(s.name)+
    '<span class="spotsub">'+spotWaterLabel(s)+'</span>'+
    '<span class="spotcond" id="cond_'+s.id+'">Bedingungen …</span></button>'+
    '<div class="spotbadges">'+countBadge(fishCountForSpot(s.name), dayCountForSpot(s.name))+
    '<span class="ampelbadge lg-amber" id="amp_'+s.id+'">'+uiIcon('minus')+' …</span></div>'+
    '<div class="spotactions"><button class="spotedit" title="Angelplatz bearbeiten" aria-label="Angelplatz bearbeiten" onclick="editSpot('+s.id+')">'+uiIcon('edit')+'</button>'+
    '<button class="spotdel" title="löschen" onclick="deleteSpotFromList('+s.id+')">'+uiIcon('close')+'</button></div></div>').join("");
  loadSpotConditions();
}
function deleteSpotFromList(id){ deleteSpot(id); renderSpotList(); }
function editSpot(id){
  const sp=loadSpots().find(x=>String(x.id)===String(id)); if(!sp) return;
  PENDING_SPOT={lat:+sp.lat,lon:+sp.lon,editId:sp.id,oldName:sp.name,oldRiver:sp.river||sp.gewaesser||""};
  if($("as_name")) $("as_name").value=sp.name||"";
  if($("as_typ")) $("as_typ").value=spotType(sp);
  if($("as_gw")) $("as_gw").value=sp.gewaesser||sp.river||"";
  asTypeChange();
  const head=$("addSpotModal")?.querySelector(".cmhead span"); if(head) head.textContent="Angelplatz bearbeiten";
  const m=$("addSpotModal"); if(m) m.style.display="flex";
  setTimeout(()=>{ const n=$("as_name"); if(n){ n.focus(); n.select(); } },60);
}
/* Live-Bedingungen je Angelplatz in der Übersicht (Wetter-Ampel, 30 min zwischengespeichert) */
const COND_CACHE={};
async function spotCondition(s){
  const key=String(s.id), cached=COND_CACHE[key];
  if(cached && (Date.now()-cached.ts)<30*60*1000) return cached;
  const url="https://api.open-meteo.com/v1/forecast?latitude="+s.lat+"&longitude="+s.lon+
    "&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,pressure_msl"+
    "&hourly=pressure_msl&forecast_days=1&timezone=Europe%2FBerlin&wind_speed_unit=kmh";
  const d=await getJSON(url), cur=d.current;
  let pt=null;
  try{ const now=new Date(cur.time), times=d.hourly.time.map(t=>new Date(t));
    let i=times.findIndex(t=>t>=now); if(i<1) i=times.length-1;
    pt=d.hourly.pressure_msl[i]-d.hourly.pressure_msl[Math.max(0,i-3)]; }catch(_){}
  // gleiche Logik wie updateAmpel (Wetter-Anteil)
  let sc=0;
  if(pt!=null){ if(pt<-3) sc--; else if(pt<=0.8) sc++; else if(pt>3) sc--; }
  if(cur.wind_gusts_10m!=null){ if(cur.wind_gusts_10m>=45) sc--; else if(cur.wind_gusts_10m>=12 && cur.wind_gusts_10m<35) sc++; }
  if((cur.precipitation!=null && cur.precipitation>=2) || [82,95,96,99].includes(cur.weather_code)) sc--;
  const wc=WMO[cur.weather_code]||["",""];
  const text=Math.round(cur.temperature_2m)+"° "+(wc[0]||"")+" · Wind "+Math.round(cur.wind_speed_10m)+" km/h";
  const res={ts:Date.now(), lvl:ampelLevel(sc), text}; COND_CACHE[key]=res; return res;
}
async function loadSpotConditions(){
  const spots=loadSpots(); if(!spots.length) return;
  await Promise.allSettled(spots.map(async s=>{
    const el=$("cond_"+s.id), amp=$("amp_"+s.id);
    try{
      const c=await spotCondition(s);
      if(amp){ amp.className="ampelbadge "+c.lvl.cls; amp.innerHTML=uiIcon(c.lvl.icon)+" "+c.lvl.word; }
      if(el) el.textContent=c.text;
    }catch(e){ if(amp){ amp.className="ampelbadge lg-amber"; amp.innerHTML=uiIcon('minus')+' n/v'; } if(el) el.textContent="Bedingungen n/v"; }
  }));
}
/* Ansichten: Start (Liste) · Angelplatz (Daten) · Mein Fangbuch (alle Fänge) */
function hideAllViews(){ ["homeView","spotView","mapCard","fbIndexView","catchListView","baitView","statsView"].forEach(id=>{ const e=$(id); if(e) e.style.display="none"; }); }
function showHome(){
  hideAllViews();
  clearCatchMarkers();
  const h=$("homeView"); if(h) h.style.display="block";
  renderSpotList();
  mountMapCard("homeMapHost",true);
  ensureMapVisible();
  setTimeout(()=>{ try{ if(MAP){ MAP.invalidateSize(); centerHomeMap(); } }catch(e){} },100);
  setActiveTab("places");
}
/* --- Tab 2: Fangbücher (Liste je Angelplatz + Gesamt) --- */
function showFangbuchList(){
  hideAllViews();
  const v=$("fbIndexView"); if(v) v.style.display="block";
  renderFbIndex();
  setActiveTab("fb");
  window.scrollTo({top:0, behavior:"smooth"});
}
function renderFbIndex(){
  const box=$("fbIndexList"); if(!box) return;
  const spots=loadSpots();
  let html='<div class="spotrow"><button class="spotopen" onclick="showCatchList(null)">'+uiIcon('book-open')+' Gesamtfangbuch'+
    '<span class="spotsub">alle Angelplätze</span></button>'+countBadge(totalFish(), totalDays())+'</div>';
  if(spots.length){
    html+=spots.map(s=>'<div class="spotrow"><button class="spotopen" onclick="showCatchListBySpot('+s.id+')">'+uiIcon('book')+' '+esc(s.name)+' Fangbuch'+
      '<span class="spotsub">'+spotWaterLabel(s)+'</span></button>'+
      countBadge(fishCountForSpot(s.name), dayCountForSpot(s.name))+'</div>').join("");
  } else {
    html+='<div class="fbnote" style="padding:10px 4px">Noch keine Angelplätze – lege zuerst einen an.</div>';
  }
  box.innerHTML=html;
}
function showCatchListBySpot(id){ const sp=loadSpots().find(x=>String(x.id)===String(id)); showCatchList(sp?sp.name:null); }
function showCatchList(spotName){
  CATCH_VIEW_SPOT = spotName || null;
  const bb=$("catchBackBtn"); setIconLabel(bb,"arrow-left","Fangbücher");
  hideAllViews();
  const v=$("catchListView"); if(v) v.style.display="block";
  renderCatchList();
  setActiveTab("fb");
  window.scrollTo({top:0, behavior:"smooth"});
}
let FISHPIE=null;
function toggleFishPie(){ const b=$("fishPieBox"); if(!b) return;
  const show=(b.style.display==="none"||!b.style.display); b.style.display=show?"block":"none"; if(show) renderFishPie(); }
function renderFishPie(){
  const box=$("fishPieBox"); if(!box) return;
  const fish=loadCatches().filter(isFish);
  const by={}; fish.forEach(c=>{ const f=(c.fischart||"").trim()||"?"; by[f]=(by[f]||0)+1; });
  const entries=Object.entries(by).sort((a,b)=>b[1]-a[1]);
  if(!entries.length){ box.innerHTML='<div class="fbnote" style="padding:8px 4px">Noch keine Fänge.</div>'; return; }
  const total=fish.length;
  const colors=["#38bdf8","#4ade80","#fbbf24","#f87171","#a78bfa","#2dd4bf","#fb923c","#f472b6","#60a5fa","#a3e635","#e879f9","#facc15"];
  box.innerHTML='<div class="statcard"><div class="cmcanvas" style="height:260px;position:relative"><canvas id="fishPieCanvas"></canvas></div>'+
    '<div class="fbnote" style="margin-top:10px;line-height:1.7">'+entries.map((e,i)=>
      '<span class="statusdot" style="color:'+colors[i%colors.length]+'"></span> '+esc(e[0])+': '+e[1]+' ('+Math.round(e[1]/total*100)+' %)').join(' · ')+'</div></div>';
  const cv=$("fishPieCanvas"); if(!cv || !window.Chart) return;
  if(FISHPIE){ try{ FISHPIE.destroy(); }catch(e){} }
  FISHPIE=new Chart(cv.getContext("2d"),{ type:"pie",
    data:{ labels:entries.map(e=>e[0]), datasets:[{ data:entries.map(e=>e[1]), backgroundColor:entries.map((e,i)=>colors[i%colors.length]), borderColor:"#0a0e14", borderWidth:2 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:"#e8eef7" } } } } });
}
/* Fang direkt aus einem Fangbuch eintragen: passenden Angelplatz öffnen + Formular aufklappen */
function openFangbuchForm(){
  const box=$("fangbuchBox"); if(box){ box.style.display="block"; updateFangbuchBtn(); }
  setTimeout(()=>{ const el=$("f_art"); if(el){ el.scrollIntoView({behavior:"smooth", block:"center"}); try{ el.focus(); }catch(e){} } }, 160);
}
function addCatchFromList(){
  const spots=loadSpots();
  if(!spots.length){ alert("Lege zuerst einen Angelplatz an, dann kannst du Fänge eintragen."); showHome(); return; }
  let sp = CATCH_VIEW_SPOT ? spots.find(s=>s.name===CATCH_VIEW_SPOT) : (activeSpot()||spots[0]);
  if(!sp) sp=spots[0];
  openSpot(sp.id);        // Platz aktivieren, Live-Daten laden, Datenansicht zeigen
  openFangbuchForm();     // Fangbuch-Formular aufklappen + hinscrollen
}
/* --- Tab 3: Köder-Liste --- */
const BAIT_KEY="deepfish_koeder_v1";
/* Köder: Oberstruktur (Kunst/Natur/Sonstige) -> Kategorie -> Varianten [{size,color}] */
const BAIT_GROUPS=[{key:"kunst",name:"Kunstköder"},{key:"natur",name:"Naturköder"},{key:"sonstige",name:"Sonstige"}];
function baitGroup(base){
  const s=String(base||"").toLowerCase();
  if(/gummi|shad|wobbler|crank|jerk|spinner|blinker|spoon|l(ö|oe)ffel|twister|fliege|streamer|nymphe|popper|jig|chatter|kunst/.test(s)) return "kunst";
  if(/wurm|made|mais|boilie|brot|teig|k(ä|ae)se|k(ö|oe)derfisch|k(ö|oe)fi|fischfetzen|pellet|dendro|garnele|bienenmade|leber|natur/.test(s)) return "natur";
  return "sonstige";
}
function loadBaits(){
  let raw=[]; try{ raw=JSON.parse(localStorage.getItem(BAIT_KEY))||[]; }catch(e){ raw=[]; }
  const cats=[], idx={};
  const cat=(base, group)=>{ base=String(base||"").trim(); if(!base) return null; const k=base.toLowerCase();
    if(!(k in idx)){ idx[k]=cats.length; cats.push({base, group: group||baitGroup(base), variants:[]}); }
    else if(group){ cats[idx[k]].group=group; } return cats[idx[k]]; };
  const addV=(c,size,color)=>{ if(!c) return; size=(size||"").trim(); color=(color||"").trim(); if(!size&&!color) return;
    const key=(size+"|"+color).toLowerCase(); if(!c.variants.some(v=>(v.size+"|"+v.color).toLowerCase()===key)) c.variants.push({size,color}); };
  raw.forEach(it=>{
    if(typeof it==="string"){ cat(it); }
    else if(it && Array.isArray(it.variants)){ const c=cat(it.base, it.group); if(c) it.variants.forEach(v=>addV(c, v.size, v.color)); }
    else if(it && it.base){ addV(cat(it.base, it.group), it.size, it.color); }   // altes Flachformat
  });
  return cats;
}
function saveBaits(cats){ try{ localStorage.setItem(BAIT_KEY, JSON.stringify(cats)); }catch(e){} }
const BAIT_INIT_KEY="deepfish_koeder_init_v1";
const DEFAULT_BAITS=["Tauwurm","Rotwurm","Made","Mais","Boilie","Brot","Käse",
  "Köderfisch","Gummifisch","Wobbler","Spinner","Blinker","Twister","Fliege"].map(b=>({base:b, group:baitGroup(b), variants:[]}));
function ensureBaitSeed(){                         // Standardköder als Startpunkt (einmalig)
  if(localStorage.getItem(BAIT_INIT_KEY)) return;
  if(!loadBaits().length) saveBaits(DEFAULT_BAITS.slice());
  localStorage.setItem(BAIT_INIT_KEY,"1");
}
const BAIT_GROUP_OPEN={kunst:true, natur:true, sonstige:true};
function toggleBaitGroup(k){ BAIT_GROUP_OPEN[k]=!(BAIT_GROUP_OPEN[k]!==false); renderBaitList(); }
function variantLabel(base, v){ return base + (v&&v.size?(" "+v.size):"") + (v&&v.color?(", "+v.color):""); }
/* Anzahl Fänge je Köder: Kategorie = alle Varianten (Präfix), Variante = exakt. Nur echte Fänge. */
function koederCatchCount(text, isCat){
  const t=String(text||"").toLowerCase().trim(); if(!t) return 0;
  return loadCatches().filter(c=>{ if(!isFish(c)) return false; const k=(c.koeder||"").toLowerCase().trim();
    return isCat ? (k===t || k.indexOf(t+" ")===0 || k.indexOf(t+",")===0) : k===t; }).length;
}
function countBadgeFish(n){ return '<span class="countbadge" title="Fänge mit diesem Köder"><span class="fishico">'+uiIcon('fish')+'</span>'+n+'</span>'; }
const BAIT_OPEN={};   // aufgeklappte Kategorien (Basename kleingeschrieben)
function showBaitList(){
  hideAllViews();
  const v=$("baitView"); if(v) v.style.display="block";
  renderBaitList();
  setActiveTab("bait");
  window.scrollTo({top:0, behavior:"smooth"});
}
function addCategory(){
  const inp=$("baitCatInput"); if(!inp) return; const base=(inp.value||"").trim(); if(!base){ inp.focus(); return; }
  const gsel=$("baitCatGroup"); const group=(gsel&&gsel.value)?gsel.value:baitGroup(base);
  const cats=loadBaits();
  let c=cats.find(x=>x.base.toLowerCase()===base.toLowerCase());
  if(!c) cats.push({base, group, variants:[]}); else c.group=group;
  saveBaits(cats); inp.value=""; BAIT_OPEN[base.toLowerCase()]=true; BAIT_GROUP_OPEN[group]=true; renderBaitList(); inp.focus();
}
function toggleBaitCat(i){ const c=loadBaits()[i]; if(!c) return; const k=c.base.toLowerCase(); BAIT_OPEN[k]=!BAIT_OPEN[k]; renderBaitList(); }
function deleteBaitCat(i){ const cats=loadBaits(); if(i<0||i>=cats.length) return;
  if(!confirm("Köder „"+cats[i].base+"“ mit allen Varianten löschen?")) return; cats.splice(i,1); saveBaits(cats); renderBaitList(); }
function addVariant(i){
  const cats=loadBaits(); const c=cats[i]; if(!c) return;
  const size=(($("var_size_"+i)||{}).value||"").trim();
  const color=(($("var_color_"+i)||{}).value||"").trim();
  if(!size && !color){ const e=$("var_size_"+i); if(e) e.focus(); return; }
  const key=(size+"|"+color).toLowerCase();
  if(!c.variants.some(v=>(v.size+"|"+v.color).toLowerCase()===key)) c.variants.push({size,color});
  saveBaits(cats); BAIT_OPEN[c.base.toLowerCase()]=true; renderBaitList();
}
function deleteBaitVar(i,j){ const cats=loadBaits(); if(!cats[i]) return; cats[i].variants.splice(j,1); saveBaits(cats); renderBaitList(); }
function renderBaitList(){
  const cats=loadBaits();
  const dl=$("koederliste");
  if(dl){ let opts=[]; cats.forEach(c=>{ opts.push(c.base); c.variants.forEach(v=>opts.push(variantLabel(c.base,v))); });
    dl.innerHTML=opts.map(o=>'<option>'+esc(o)+'</option>').join(""); }
  const box=$("baitList"); if(!box){ populateKoeder(); return; }
  if(!cats.length){ box.innerHTML='<div class="fbnote" style="padding:10px 4px">Noch keine Köder – lege oben einen an.</div>'; populateKoeder(); return; }
  const indexed=cats.map((c,i)=>({c,i}));
  const catHtml=(c,i)=>{
    const open=!!BAIT_OPEN[c.base.toLowerCase()];
    let h='<div class="baitcat"><div class="baitcatrow">'+
      '<button class="baitcathead" onclick="toggleBaitCat('+i+')"><span class="tw">'+uiIcon(open?'chevron-down':'chevron-right')+'</span> '+
        esc(c.base)+' <small>'+c.variants.length+' Variante'+(c.variants.length===1?'':'n')+'</small></button>'+
      countBadgeFish(koederCatchCount(c.base,true))+
      '<button class="spotdel" title="Köder löschen" onclick="deleteBaitCat('+i+')">'+uiIcon('close')+'</button></div>';
    if(open){
      h+='<div class="baitvars">';
      h+=c.variants.map((v,j)=>{ const lbl=variantLabel(c.base,v);
        return '<div class="baitvar"><span class="vlabel">'+esc(lbl)+'</span>'+countBadgeFish(koederCatchCount(lbl,false))+
          '<button class="spotdel" onclick="deleteBaitVar('+i+','+j+')">'+uiIcon('close')+'</button></div>'; }).join("");
      h+='<div class="baitvaradd">'+
         '<input id="var_size_'+i+'" placeholder="Größe, z. B. 5 cm">'+
         '<input id="var_color_'+i+'" placeholder="Farbe, z. B. braun" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addVariant('+i+');}">'+
         '<button onclick="addVariant('+i+')">+ Variante</button></div>';
      h+='</div>';
    }
    return h+'</div>';
  };
  let html="";
  BAIT_GROUPS.forEach(gr=>{
    const items=indexed.filter(o=>(o.c.group||baitGroup(o.c.base))===gr.key);
    if(!items.length) return;
    const gopen=BAIT_GROUP_OPEN[gr.key]!==false;
    html+='<div class="baitgroup"><button class="baitgrouphead" onclick="toggleBaitGroup(\''+gr.key+'\')">'+
      '<span class="tw">'+uiIcon(gopen?'chevron-down':'chevron-right')+'</span> '+gr.name+' <small>'+items.length+'</small></button>';
    if(gopen) html+='<div class="baitgroupbody">'+items.map(o=>catHtml(o.c,o.i)).join("")+'</div>';
    html+='</div>';
  });
  box.innerHTML=html;
  populateKoeder();
}
/* Köder-Auswahl im Fangformular: Kategorie -> Varianten */
function populateKoeder(){
  const bsel=$("f_koeder_base"); if(!bsel) return;
  const cats=loadBaits(), cur=bsel.value;
  let html='<option value="">— Köder —</option>';
  BAIT_GROUPS.forEach(gr=>{
    const items=cats.filter(c=>(c.group||baitGroup(c.base))===gr.key);
    if(!items.length) return;
    html+='<optgroup label="'+gr.name+'">'+items.map(c=>'<option value="'+esc(c.base)+'">'+esc(c.base)+'</option>').join("")+'</optgroup>';
  });
  bsel.innerHTML=html;
  if(cur && cats.some(c=>c.base===cur)) bsel.value=cur;
  onKoederBaseChange();
}
function onKoederBaseChange(){
  const bsel=$("f_koeder_base"), vsel=$("f_koeder_var"), field=$("f_var_field"); if(!vsel) return;
  const base=bsel?bsel.value:"";
  const c=loadBaits().find(x=>x.base===base);
  if(!base || !c || !c.variants.length){          // ohne Köder oder ohne Varianten: Variante-Feld ausblenden
    vsel.innerHTML='<option value="">— ohne Variante —</option>'; vsel.disabled=!base;
    if(field) field.style.display="none"; return;
  }
  if(field) field.style.display="";                // erst nach Köderwahl (mit Varianten) einblenden
  vsel.disabled=false;
  vsel.innerHTML='<option value="">— ohne Variante —</option>'+c.variants.map(v=>{
    const det=(v.size||"")+((v.size&&v.color)?", ":"")+(v.color||"");
    return '<option value="'+esc(variantLabel(base,v))+'">'+esc(det||"(ohne Angabe)")+'</option>';
  }).join("");
}
/* --- Tab-Leiste (aktiver Reiter) --- */
function setActiveTab(which){
  const map={places:"tabPlaces", fb:"tabFb", bait:"tabBait", stats:"tabStats"};
  Object.values(map).forEach(id=>{ const e=$(id); if(e) e.classList.remove("active"); });
  const el=$(map[which]); if(el) el.classList.add("active");
}

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
  const groups={};
  (all||[]).forEach(c=>{
    if(!c.datum) return;
    const key=(c.angelplatz||c.gewaesser||"?")+"|"+c.datum;
    (groups[key]=groups[key]||[]).push(c);
  });
  const trips=Object.values(groups), successful=trips.filter(a=>a.some(isFish)).length;
  const pct=trips.length?Math.round(successful/trips.length*100):0;
  return '<div class="statcard successcard"><div class="stath">'+uiIcon('line-chart')+' Erfolgreiche Trips <span class="statn">aus Fangdaten</span></div>'+
    '<div class="successpct">'+pct+' %</div><div class="statline">'+successful+' von '+trips.length+' Angeltagen mit mindestens einem Fang</div></div>';
}
function renderStats(){
  const box=$("statsBody"); if(!box) return;
  const all=loadCatches(), fc=fishCatches();
  if(!all.length){ box.innerHTML='<div class="fbnote" style="padding:10px 4px">Noch keine Fangdaten vorhanden.</div>'; return; }
  let html=tripSuccessHtml(all);
  if(!fc.length){ box.innerHTML=html+'<div class="fbnote" style="padding:10px 4px">Noch keine Fänge – bisher sind nur Angeltage ohne Fang gespeichert.</div>'; return; }
  html+='<div class="statcard"><div class="stath">'+uiIcon('chart')+' Überblick <span class="statn">'+fc.length+' Fänge · '+totalDays()+' Angeltage</span></div>'+
    statLine(uiIcon('pin')+" Beste Plätze", topBy(fc, c=>c.angelplatz, 3), false)+
    statLine(uiIcon('hook')+" Fängigste Köder", topBy(fc, c=>c.koeder, 3), true)+'</div>';
  html+=personalBestHtml(fc);
  html+=statsByFish().map(f=>
    '<div class="statcard"><div class="stath">'+esc(f.fisch)+' <span class="statn">'+f.total+' Fang'+(f.total===1?'':'e')+'</span></div>'+
    statLine("Beste Plätze", f.spots, false)+
    statLine("Fängigste Köder", f.baits, true)+'</div>').join("");
  box.innerHTML=html;
}
function openSpot(id){
  if(id) activateSpotById(id);
  hideAllViews();
  const sv=$("spotView"), mc=$("mapCard");
  mountMapCard("spotMapHost",false);
  if(sv) sv.style.display="block";
  if(mc) mc.style.display="block";
  initMap();
  setTimeout(()=>{ try{ if(MAP){ MAP.invalidateSize(); centerOnActiveSpot(); } }catch(e){} }, 90);
  setActiveTab("places");
  window.scrollTo({top:0, behavior:"smooth"});
}
function goHome(){ showHome(); }
function ensureMapVisible(){
  const m=$("mapCard"); if(m) m.style.display="block";
  if(!MAP) initMap();
  setTimeout(()=>{ try{ if(MAP) MAP.invalidateSize(); }catch(e){} }, 80);
}
function toggleHomeMap(){
  mountMapCard("homeMapHost",true);
  ensureMapVisible();
}
function fbTitle(){ const n=activeSpotName(); return (n? n+" " : "")+"Fangbuch"; }
function updateFangbuchBtn(){
  const b=$("fangbuchBtn"); if(!b) return;
  const box=$("fangbuchBox"); const shown = box && box.style.display && box.style.display!=="none";
  b.innerHTML=iconLabel("book",fbTitle()+(shown?" ausblenden":" anzeigen"));
}
function onSpotSelect(id){ if(id) loadSpot(id); }
function deleteActiveSpot(){
  const sel=$("spotSelect"); const id = sel ? sel.value : localStorage.getItem(ACTIVE_KEY);
  if(!id){ alert("Kein Angelplatz zum Löschen gewählt."); return; }
  deleteSpot(id);
  const rest=loadSpots();
  if(rest.length) loadSpot(rest[0].id);
}
function currentSpotName(){
  const sp=loadSpots().find(x=>String(x.id)===String(localStorage.getItem(ACTIVE_KEY)));
  return sp ? sp.name : "";
}
function populateCatchSpots(){                 // zeigt, für welchen Angelplatz der Fang gilt
  const sp=activeSpot(), l=$("f_ort_label");
  if(l) l.textContent = sp ? ("Fang für: "+sp.name+" · "+(sp.gewaesser||sp.river||"")) : "Kein Angelplatz gewählt.";
}
function onCatchSpotChange(id){ if(id) loadSpot(id); }

async function loadMarine(){
  const val=$("waterTempVal"), meta=$("waterTempMeta");
  try{
    const url="https://marine-api.open-meteo.com/v1/marine?latitude="+WXPOS.lat+"&longitude="+WXPOS.lon+
      "&current=sea_surface_temperature&timezone=Europe%2FBerlin";
    const d=await getJSON(url);
    const t=(d&&d.current)? d.current.sea_surface_temperature : null;
    if(t==null||isNaN(t)) throw 0;
    if(val) val.innerHTML=fmt(t,1)+' <small>°C</small>';
    if(meta) meta.textContent="Oberflächentemperatur (Open-Meteo Modell)";
    snap.marineTemp=t;
  }catch(e){
    if(val) val.innerHTML='<span class="err">n/v</span>';
    if(meta) meta.textContent="Modell liefert hier keine Wassertemperatur";
    snap.marineTemp=null;
  }
}
async function loadAll(){
  $("updated").textContent = "aktualisiere …";
  const sp=activeSpot(), typ=spotType(sp), hasStation=typ==="fluss"&&!!(sp&&sp.uuid&&STATIONS.some(s=>s.uuid===sp.uuid));
  if(typ==="fluss" && hasStation){
    snap.marineTemp=null;
    await Promise.allSettled([loadPegel(), loadWeather(), loadQuality(), loadLiveWQ()]);
    renderQuality();                    // Live-Pegelwerte bevorzugen, sonst Gütestation
    updateAmpel();
    if($("biteBox") && $("biteBox").style.display==="block") renderBite();
  } else if(typ==="fluss"){
    snap.pegel=null; snap.q=null; snap.marineTemp=null; window.LIVEWQ=null;
    await Promise.allSettled([loadWeather(),loadQuality()]);
    renderQuality(); updateAmpel();
  } else {
    snap.pegel=null; snap.q=null; window.LIVEWQ=null;
    await Promise.allSettled([loadWeather(), loadMarine(), loadQuality()]);  // Güte auch für Seen (z. B. Ammersee)
    renderQuality();
  }
  $("updated").textContent = "Stand: " + new Date().toLocaleString("de-DE",{dateStyle:"short",timeStyle:"short"}) + " Uhr";
}
async function boot(){
  await loadStations();                       // alle Rhein-Pegel laden
  const spots=loadSpots(), active=localStorage.getItem(ACTIVE_KEY);
  const sp = spots.find(x=>String(x.id)===String(active)) || spots[0] || null;
  if(sp){
    const st=STATIONS.find(x=>x.uuid===sp.uuid) || STATIONS[0];
    CUR=st; localStorage.setItem(ACTIVE_KEY, sp.id);
    const ll=spotLatLon(sp); WXPOS={lat:ll[0], lon:ll[1]};
  } else {
    CUR = STATIONS.find(x=>x.uuid===MAINZ_UUID) || STATIONS[0];
    WXPOS={lat:CUR.lat, lon:CUR.lon};
  }
  reflectStation(); renderSpots();
  ensureBaitSeed();                           // Standardköder beim ersten Start anlegen
  loadNizBW().then(()=>{ renderQuality(); if(typeof addStationDots==="function") addStationDots(); });  // BW-Wassergüte (LUBW/NIZ)
  loadHessen().then(()=>{ renderQuality(); if(typeof addStationDots==="function") addStationDots(); }); // Hessen-Wassergüte (HLNUG)
  initFangbuch();                             // Formular, Karte (Stationen + Angelplätze)
  loadQuality();                             // Länder- und Nachbarland-Sensoren schon auf der Startkarte laden
  showHome();                                 // Startbildschirm: Angelplätze
  setInterval(()=>{ if($("spotView") && $("spotView").style.display!=="none") loadAll(); }, 10*60*1000);
}
boot();
