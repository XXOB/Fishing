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
let CUR = STATIONS[0];                 // aktuelle Pegel-Station (für Pegel/Durchfluss)
let WXPOS = {lat:50.003995, lon:8.275319}; // Ort für Wetter (Angelplatz-Koordinaten)
const REF_CACHE = {};                  // Hauptwerte je Station-UUID
function poStation(){ return PO_BASE+"/stations/"+CUR.uuid; }

const $ = id => document.getElementById(id);
const fmt = (n,d=0) => (n==null||isNaN(n)) ? "–" : Number(n).toLocaleString("de-DE",{minimumFractionDigits:d,maximumFractionDigits:d});

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
  if(diff> th) return '<span class="trend t-up">▲ steigt</span>';
  if(diff<-th) return '<span class="trend t-dn">▼ fällt</span>';
  return '<span class="trend t-fl">▬ stabil</span>';
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
  0:["Klar","☀️"],1:["Überwiegend klar","🌤️"],2:["Teils bewölkt","⛅"],3:["Bedeckt","☁️"],
  45:["Nebel","🌫️"],48:["Reifnebel","🌫️"],
  51:["Leichter Niesel","🌦️"],53:["Niesel","🌦️"],55:["Starker Niesel","🌧️"],
  61:["Leichter Regen","🌦️"],63:["Regen","🌧️"],65:["Starker Regen","🌧️"],
  66:["Gefr. Regen","🌧️"],67:["Gefr. Regen","🌧️"],
  71:["Leichter Schnee","🌨️"],73:["Schnee","🌨️"],75:["Starker Schnee","❄️"],77:["Schneegriesel","🌨️"],
  80:["Schauer","🌦️"],81:["Schauer","🌧️"],82:["Heftige Schauer","⛈️"],
  85:["Schneeschauer","🌨️"],86:["Schneeschauer","🌨️"],
  95:["Gewitter","⛈️"],96:["Gewitter + Hagel","⛈️"],99:["Gewitter + Hagel","⛈️"]
};
function windDir(deg){
  const d=["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return d[Math.round(deg/22.5)%16];
}
async function getJSON(url){
  const r = await fetch(url,{cache:"no-store"});
  if(!r.ok) throw new Error(url+" → "+r.status);
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
    const wc = WMO[c.weather_code] || ["–","•"];
    $("skyVal").textContent = wc[1]+" "+wc[0];
    $("skyMeta").textContent = "Bewölkung "+fmt(c.cloud_cover)+" % · Feuchte "+fmt(c.relative_humidity_2m)+" %";
    $("sunVal").textContent = "☀️ "+hhmm(d.daily.sunrise[0])+" – "+hhmm(d.daily.sunset[0]);
    $("sunMeta").textContent = "Sonnenauf- / -untergang";

    let pt=null;
    try{
      const now=new Date(c.time), times=d.hourly.time.map(t=>new Date(t));
      let i=times.findIndex(t=>t>=now); if(i<1) i=times.length-1;
      pt = d.hourly.pressure_msl[i] - d.hourly.pressure_msl[Math.max(0,i-3)];
    }catch(_){}
    let arrow="▬", ptxt="stabil";
    if(pt!=null){ if(pt>0.8){arrow="▲";ptxt="steigend";} else if(pt<-0.8){arrow="▼";ptxt="fallend";} }
    $("pressVal").innerHTML = fmt(c.pressure_msl)+' <small>hPa</small> '+arrow;
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
  let cls,txt,ico;
  if(score>=2){ cls="lg-green"; txt="Gute Bedingungen"; ico="👍"; }
  else if(score<=-1){ cls="lg-red"; txt="Schwierige Bedingungen"; ico="⚠️"; }
  else { cls="lg-amber"; txt="Mittelmäßige Bedingungen"; ico="≈"; }
  $("condDot").className="dot "+cls; $("condDot").textContent=ico;
  $("condLvl").textContent=txt;
  $("condWhy").textContent = reasons.length ? reasons.join(" · ") : "Keine auffälligen Faktoren.";
}

function copyCoords(){
  const t = CUR.lat+", "+CUR.lon;
  navigator.clipboard?.writeText(t).then(()=>{
    const b=$("copyBtn"), o=b.textContent; b.textContent="✓ kopiert"; setTimeout(()=>b.textContent=o,1500);
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
function renderQuality(){
  const box=$("quality"); if(!box) return;
  const st=$("qStamp");
  const aw=activeWQ();
  if(!aw){
    box.innerHTML='<div class="qtile"><div class="lbl">🌊 Wasserqualität</div>'+
      '<div class="hint">Für dieses Gewässer gibt es (noch) keine unterstützte Gütestation in der Nähe. Weitere Stationen folgen (Phase 2). Pegel &amp; Wetter passen aber zum Angelplatz.</div></div>';
    if(st) st.textContent="";
    return;
  }
  const items=(aw.station.items||[]).filter(it=> it.label!=="pH-Wert" && it.label!=="Leitfähigkeit");
  const CHARTABLE={"Wassertemperatur":1,"O₂-Sättigung":1,"Trübung":1};
  box.innerHTML = items.map(it=>{
    const cls=classifyWQ(it.label, deNum(it.value));
    const badge = cls ? '<span class="pgbadge '+cls.c+'">'+cls.t+'</span>' : '';
    const stripe = cls ? stripeColor(cls.c) : "var(--water)";
    const clk = CHARTABLE[it.label] ? ' clickable" onclick="openChart(\'wq:'+it.label+'\')' : '';
    return '<div class="tile'+clk+'" style="border-top-color:'+stripe+'"><div class="lbl">'+(it.icon||"•")+' '+it.label+'</div>'+
      '<div class="val">'+it.value+' <small>'+(it.unit||"")+'</small></div>'+
      '<div class="meta">'+badge+'Stand: '+(it.time||"–")+'</div></div>';
  }).join("");
  if(st){
    const link = aw.station.id ? ' · <a href="https://geodaten-wasser.rlp-umwelt.de/gus/'+esc(aw.station.id)+'/messwerte" target="_blank" rel="noopener">amtlich ↗</a>' : '';
    st.innerHTML="Gütestation "+esc(aw.station.name)+" · "+aw.dist.toFixed(1)+" km entfernt · Stand "+esc(aw.station.updated||(window.WQ&&window.WQ.updated)||"")+link;
  }
}

async function loadQuality(){
  try{
    const r = await fetch("wasserwerte.json?t="+Math.floor(Date.now()/300000), {cache:"no-store"});
    if(r.ok){ const j = await r.json();
      if(j && Array.isArray(j.stations)) window.WQ = j;
      else if(j && Array.isArray(j.items)) window.WQ = { updated:j.updated||"", stations:[{ id:"2511510500", name:"Mainz-Wiesbaden", lat:50.0068, lon:8.2795, river:"Rhein", updated:j.updated||"", items:j.items, history:j.history||{} }] };
    }
  }catch(e){ /* z.B. lokal ohne Server geöffnet */ }
  renderQuality();
}
function activeWQ(){
  const st=(window.WQ&&window.WQ.stations)||[]; if(!st.length) return null;
  const sp=activeSpot();
  const river = (sp&&sp.river) ? sp.river : (CUR&&CUR.river ? CUR.river : null);
  if(!river) return null;                                   // Fluss unbekannt → keine Güte (nie Mainz-Notlösung)
  const rk = String(river).toLowerCase().trim();
  const cand = st.filter(s => String(s.river||"").toLowerCase().trim() === rk);  // NUR gleicher Fluss
  if(!cand.length) return null;                             // kein Messpunkt an diesem Fluss → nichts anzeigen
  let best=null, bd=1e9;
  for(const s of cand){ if(s.lat==null) continue; const d=haversine(WXPOS.lat,WXPOS.lon,s.lat,s.lon); if(d<bd){ bd=d; best=s; } }
  if(!best || bd>WQ_MAXKM) return null;
  return { station:best, dist:bd };
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
function updateFilterBtn(){ const b=$("filterBtn"); if(!b) return; const n=activeSpotName(); b.textContent = (FB_FILTER==="spot") ? ("🎣 nur: "+(n||"aktueller Platz")) : "🎣 alle Plätze"; }
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
    "O₂-Sättigung":"o2_saettigung_pct","Trübung":"truebung","pH-Wert":"ph","Leitfähigkeit":"leitfaehigkeit_uScm" };
  const aw=activeWQ(); const items=aw?aw.station.items:[];
  const out={ stand:(aw&&aw.station.updated)||"", station:(aw&&aw.station.name)||"", entfernung_km:(aw? Math.round(aw.dist*10)/10 : null) };
  items.forEach(it=>{ const k=M[it.label]; if(k) out[k]=deNum(it.value); });
  return out;
}

function captureGps(){
  if(!navigator.geolocation){ $("gpsInfo").textContent="Ortung auf diesem Gerät nicht verfügbar."; return; }
  $("gpsBtn").textContent="… wird geortet";
  navigator.geolocation.getCurrentPosition(p=>{
    setSelectedLocation(p.coords.latitude, p.coords.longitude, p.coords.accuracy, true);
    $("gpsBtn").textContent="📍 Standort aktualisieren";
  }, ()=>{
    $("gpsInfo").textContent="Ortung abgelehnt/fehlgeschlagen – Fang wird ohne Standort gespeichert.";
    $("gpsBtn").textContent="📍 Handy-Standort";
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
    gewaesser: $("f_gewaesser").value.trim() || (sp? (sp.gewaesser||sp.river||"") : ""),
    gewaessertyp: spotType(sp),
    angelplatz: (loadSpots().find(x=>String(x.id)===String($("f_angelplatz").value))||{}).name || (sp?sp.name:""),
    datum, uhrzeit: zeit,
    fischart: blank ? "" : $("f_art").value.trim(),
    groesse_cm: (!blank && $("f_groesse").value) ? +$("f_groesse").value : null,
    gewicht_g: (!blank && $("f_gewicht").value) ? +$("f_gewicht").value : null,
    koeder: k.label,                 // wird auch beim Trip ohne Fang gespeichert
    koeder_basis: k.base,
    koeder_variante: k.variante,
    methode: $("f_methode").value.trim(),
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
function saveCatch(opts){
  opts=opts||{};
  const blank = opts.blank || !$("f_art").value.trim();   // ohne Fischart => Leereintrag (Angeltag)
  const rec=buildRecord(blank);
  const arr=loadCatches(); arr.push(rec); saveCatches(arr);
  $("f_art").value=""; $("f_groesse").value=""; $("f_gewicht").value=""; $("f_notiz").value="";
  if($("f_koeder_base")) $("f_koeder_base").value=""; onKoederBaseChange();
  const now=new Date(), pad=n=>String(n).padStart(2,'0');
  $("f_zeit").value=pad(now.getHours())+':'+pad(now.getMinutes());
  clearSelectedLocation();
  populateCatchSpots();
  refreshFangbuch();
  const bt=$(blank?"fbBlankBtn":"fbSaveBtn");
  if(bt){ const o=bt.textContent; bt.textContent = blank?"✓ Angeltag gespeichert":"✓ Fang gespeichert"; setTimeout(()=>{ bt.textContent=o; }, 1500); }
}
function saveBlank(){ saveCatch({blank:true}); }

function deleteCatch(id){
  if(!confirm("Diesen Fang löschen?")) return;
  saveCatches(loadCatches().filter(c=>c.id!==id));
  refreshFangbuch();
}

function catchCard(c){
  const w=c.wetter||{}, wa=c.wasser||{}, cond=[];
  if(wa.wassertemperatur_c!=null) cond.push("Wasser "+wa.wassertemperatur_c+" °C");
  if(wa.wassertemperatur_modell_c!=null) cond.push("Wasser≈ "+wa.wassertemperatur_modell_c+" °C (Modell)");
  if(wa.pegelstand_cm!=null) cond.push("Pegel "+wa.pegelstand_cm+" cm"+(wa.pegel_stufe?" ("+wa.pegel_stufe+")":""));
  if(wa.sauerstoff_mgl!=null) cond.push("O₂ "+wa.sauerstoff_mgl+" mg/l");
  if(w.lufttemperatur_c!=null) cond.push("Luft "+w.lufttemperatur_c+" °C");
  if(w.luftdruck_hpa!=null) cond.push(Math.round(w.luftdruck_hpa)+" hPa");
  if(w.wetterlage) cond.push(w.wetterlage);
  if(c.mondphase&&c.mondphase.name) cond.push(c.mondphase.name);
  const title = c.kein_fang
    ? '🚫 Kein Fang'
    : esc(c.fischart)+(c.groesse_cm?' · '+c.groesse_cm+' cm':'')+(c.gewicht_g?' · '+c.gewicht_g+' g':'');
  return '<div class="fbitem'+(c.kein_fang?' blank':'')+'"><div class="h"><span class="fish">'+title+'</span>'+
    '<button class="del" onclick="deleteCatch('+c.id+')">löschen ✕</button></div>'+
    '<div class="when">'+esc(c.datum||"")+' '+esc(c.uhrzeit||"")+
    (c.angelplatz?' · <b>'+esc(c.angelplatz)+'</b>':'')+' · '+esc(c.gewaesser||"")+
    (c.koeder?' · '+baitIcon(c.koeder)+' '+esc(c.koeder):'')+(c.methode?' · '+esc(c.methode):'')+(c.gps?' · 📍':'')+'</div>'+
    (cond.length?'<div class="cond">'+esc(cond.join(" · "))+'</div>':'')+
    (c.notiz?'<div class="cond">„'+esc(c.notiz)+'"</div>':'')+'</div>';
}
function renderCatches(){
  const arr=catchesForView().sort((a,b)=>((b.datum||"")+(b.uhrzeit||"")).localeCompare((a.datum||"")+(a.uhrzeit||"")));
  const cnt=$("fbCount"); if(cnt){ const f=arr.filter(isFish).length; cnt.textContent = f+" Fang"+(f===1?"":"e")+" · "+arr.length+" Angeltrip"+(arr.length===1?"":"s"); }
  const box=$("fbList"); if(!box) return;
  if(!arr.length){ box.innerHTML='<div class="fbnote" style="padding:8px 4px">Noch keine Fänge – trag deinen ersten Fang oben ein.</div>'; return; }
  box.innerHTML = arr.map(catchCard).join("");
}
let CATCH_VIEW_SPOT = null;   // Name des Angelplatzes, oder null = Gesamtfangbuch
function isFish(c){ return !c.kein_fang && !!c.fischart; }
function fishCountForSpot(name){ return loadCatches().filter(c=>c.angelplatz===name && isFish(c)).length; }
function tripCountForSpot(name){ return loadCatches().filter(c=>c.angelplatz===name).length; }
function totalFish(){ return loadCatches().filter(isFish).length; }
function totalTrips(){ return loadCatches().length; }
function countBadge(fish, trips){
  return '<span class="countbadge" title="Fänge · Angeltrips"><span class="fishico">🐟</span>'+fish+
    ' <span class="tripico">🎣</span>'+trips+'</span>';
}
function renderCatchList(){
  const box=$("catchList"); if(!box) return;
  const all=loadCatches();
  const arr=(CATCH_VIEW_SPOT ? all.filter(c=>c.angelplatz===CATCH_VIEW_SPOT) : all)
    .sort((a,b)=>((b.datum||"")+(b.uhrzeit||"")).localeCompare((a.datum||"")+(a.uhrzeit||"")));
  const t=$("catchListTitle");
  if(t) t.textContent = CATCH_VIEW_SPOT ? (CATCH_VIEW_SPOT+" Fangbuch") : "Gesamtfangbuch · alle Fänge";
  if(!arr.length){ box.innerHTML='<div class="fbnote" style="padding:10px 4px">Noch keine Fänge'+(CATCH_VIEW_SPOT?' an diesem Angelplatz':' erfasst')+'.</div>'; return; }
  box.innerHTML = arr.map(catchCard).join("");
}

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
    ["angelplatz",c=>c.angelplatz],["groesse_cm",c=>c.groesse_cm],["gewicht_g",c=>c.gewicht_g],["koeder",c=>c.koeder],["koeder_basis",c=>c.koeder_basis||""],["koeder_variante",c=>c.koeder_variante||""],["methode",c=>c.methode],["notiz",c=>c.notiz],
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
let MAP=null, CATCH_LAYER=null, SELECT_MARKER=null, STATION_MARKER=null;
let STATIONS_LAYER=null, SPOTS_LAYER=null, STATIONS_VISIBLE=true, SPOTS_VISIBLE=true, SPOT_PICK=false, STATION_PICK=false;
function initMap(){
  if(MAP || !window.L || !document.getElementById("map")) return;
  MAP = L.map("map",{scrollWheelZoom:false}).setView([WXPOS.lat, WXPOS.lon], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(MAP);
  STATIONS_LAYER=L.layerGroup(); SPOTS_LAYER=L.layerGroup();
  addStationDots(); addSpotMarkers();
  if(STATIONS_VISIBLE) STATIONS_LAYER.addTo(MAP);
  if(SPOTS_VISIBLE) SPOTS_LAYER.addTo(MAP);
  STATION_MARKER=L.circleMarker([CUR.lat,CUR.lon],{radius:7,color:"#38bdf8",weight:2,fillColor:"#38bdf8",fillOpacity:.9})
    .addTo(MAP).bindPopup("Pegel "+CUR.name);
  CATCH_LAYER=L.layerGroup().addTo(MAP);
  MAP.on("moveend", addStationDots);
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
    setSelectedLocation(e.latlng.lat, e.latlng.lng, null, false);
    MARKING=false;
    const hb=$("markHint");
    if(hb){ hb.innerHTML='✓ Fangort markiert. <a href="#" onclick="scrollToSave();return false;">↑ zum Speichern</a>'; hb.style.display="block"; }
  });
  updateLayerBtns();
  renderMarkers();
}
function addStationDots(){
  if(!STATIONS_LAYER) return;
  STATIONS_LAYER.clearLayers();
  let list=STATIONS;
  try{ if(MAP){ const b=MAP.getBounds(); list=STATIONS.filter(s=>b.contains([s.lat,s.lon])); } }catch(e){}
  if(list.length>250) list=list.slice(0,250);
  for(const s of list){
    const mk=L.circleMarker([s.lat,s.lon],{radius:4,color:"#7f93b3",weight:1,fillColor:"#7f93b3",fillOpacity:.55});
    mk.bindTooltip(s.name+" · "+(s.river||"")+" · km "+s.km);
    STATIONS_LAYER.addLayer(mk);
  }
}
function spotLatLon(sp){
  if(sp.lat!=null && sp.lon!=null) return [sp.lat, sp.lon];
  const st=STATIONS.find(x=>x.uuid===sp.uuid); return st?[st.lat,st.lon]:[CUR.lat,CUR.lon];
}
function addSpotMarkers(){
  if(!SPOTS_LAYER || !window.L) return;
  SPOTS_LAYER.clearLayers();
  const icon=L.divIcon({className:"spot-ic", html:"🎣", iconSize:[26,26], iconAnchor:[13,13]});
  for(const sp of loadSpots()){
    const ll=spotLatLon(sp);
    const mk=L.marker(ll,{icon}).bindTooltip("🎣 "+sp.name);
    mk.on("click", ()=>openSpot(sp.id));
    SPOTS_LAYER.addLayer(mk);
  }
}
function toggleStationsLayer(){ STATIONS_VISIBLE=!STATIONS_VISIBLE; if(MAP&&STATIONS_LAYER){ if(STATIONS_VISIBLE) STATIONS_LAYER.addTo(MAP); else STATIONS_LAYER.remove(); } updateLayerBtns(); }
function toggleSpotsLayer(){ SPOTS_VISIBLE=!SPOTS_VISIBLE; if(MAP&&SPOTS_LAYER){ if(SPOTS_VISIBLE) SPOTS_LAYER.addTo(MAP); else SPOTS_LAYER.remove(); } updateLayerBtns(); }
function updateLayerBtns(){ const a=$("layStations"), b=$("laySpots"); if(a) a.textContent=(STATIONS_VISIBLE?"◉":"○")+" Stationen"; if(b) b.textContent=(SPOTS_VISIBLE?"◉":"○")+" Angelplätze"; }
function setSelectedLocation(lat, lon, acc, pan){
  CURRENT_GPS={ lat:+(+lat).toFixed(6), lon:+(+lon).toFixed(6), genauigkeit_m: (acc==null? null : Math.round(acc)) };
  if(MAP && window.L){
    if(!SELECT_MARKER){
      SELECT_MARKER=L.circleMarker([lat,lon],{radius:8,color:"#fbbf24",weight:3,fillColor:"#fbbf24",fillOpacity:.55}).addTo(MAP);
      SELECT_MARKER.bindPopup("Gewählter Fangort");
    } else SELECT_MARKER.setLatLng([lat,lon]);
    if(pan){ try{ MAP.setView([lat,lon], Math.max(MAP.getZoom()||13, 15)); }catch(e){} }
  }
  const extra = CURRENT_GPS.genauigkeit_m!=null ? " (Handy, ±"+CURRENT_GPS.genauigkeit_m+" m)" : " (auf Karte gewählt)";
  const gi=$("gpsInfo");
  if(gi) gi.innerHTML='📍 Fangort: '+CURRENT_GPS.lat+', '+CURRENT_GPS.lon+extra+
    ' · <a href="#" onclick="clearSelectedLocation();return false;">entfernen</a>';
}
function clearSelectedLocation(){
  CURRENT_GPS=null; MARKING=false;
  if(SELECT_MARKER && MAP){ MAP.removeLayer(SELECT_MARKER); SELECT_MARKER=null; }
  const gi=$("gpsInfo"); if(gi) gi.textContent="Kein Standort gewählt – nutze die Handy-Ortung oder „Auf Karte markieren\".";
  const b=$("gpsBtn"); if(b) b.textContent="📍 Handy-Standort";
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

let MARKING=false;
function markOnMap(){
  MARKING=true;
  if(!MAP) initMap();
  const hb=$("markHint"); if(hb){ hb.innerHTML="👆 Tippe auf die Karte an die Stelle deines Fangs."; hb.style.display="block"; }
  const m=document.getElementById("map"); if(m) m.scrollIntoView({behavior:"smooth", block:"center"});
}
function scrollToSave(){ const b=document.getElementById("fbSaveBtn"); if(b) b.scrollIntoView({behavior:"smooth", block:"center"}); }
function renderTable(){
  const box=$("fbTable"); if(!box) return;
  const arr=catchesForView().sort((a,b)=>((b.datum||"")+(b.uhrzeit||"")).localeCompare((a.datum||"")+(a.uhrzeit||"")));
  if(!arr.length){ box.innerHTML='<div class="fbnote" style="padding:8px 4px">Noch keine Fänge.</div>'; return; }
  const rows=arr.map(c=>{
    const ort = c.gps ? (c.gps.lat+', '+c.gps.lon) : esc(c.gewaesser||"");
    return '<tr><td>'+esc(c.datum||"")+'</td><td>'+esc(c.uhrzeit||"")+'</td><td>'+(c.kein_fang?"— (kein Fang)":esc(c.fischart||""))+'</td>'+
      '<td>'+(c.groesse_cm!=null?c.groesse_cm:"")+'</td><td>'+(c.gewicht_g!=null?c.gewicht_g:"")+'</td>'+
      '<td>'+esc(c.koeder||"")+'</td><td>'+esc(c.angelplatz||"")+'</td><td>'+ort+'</td></tr>';
  }).join("");
  box.innerHTML='<div class="fbwrap"><table class="fbtable"><thead><tr>'+
    '<th>Datum</th><th>Zeit</th><th>Fischart</th><th>cm</th><th>g</th><th>Köder</th><th>Angelplatz</th><th>Ort</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div>';
}
function toggleTable(){
  const box=$("fbTable"), b=$("tblBtn"); if(!box) return;
  const show=(box.style.display==="none" || !box.style.display);
  if(show){ renderTable(); box.style.display="block"; if(b) b.textContent="📋 Tabelle ausblenden"; }
  else { box.style.display="none"; if(b) b.textContent="📋 Tabelle anzeigen"; }
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
  else if(def.src.indexOf("wq:")===0){ const l=def.src.slice(3), aw=activeWQ(), hi=aw&&aw.station.history&&aw.station.history[l]; if(!hi) return null; pts=hi.map(p=>({t:new Date(p.t), v:p.v})); }
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
  const aw=activeWQ(); const items=aw?aw.station.items:[];
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
    const recHtml = rec ? '<div class="biterec">🎣 Bewährter Köder bei dir: '+baitIcon(rec.koeder)+' <b>'+esc(rec.koeder)+
      '</b> <small>('+rec.count+' von '+rec.total+' '+esc(sp.name)+'-Fängen)</small></div>' : '';
    return '<div class="biteitem"><button class="bitehead" onclick="var e=this.nextElementSibling;e.style.display=(e.style.display===\'block\'?\'none\':\'block\')">'+
      '<span class="bitedot bd-'+r.color+'"></span>'+sp.name+
      '<span class="bitetag" style="color:var('+col[r.color]+')">'+tag[r.color]+' ▾</span></button>'+
      '<div class="bitereason">'+esc(r.reason)+recHtml+'</div></div>';
  }).join("");
  const warn = ctx.wt==null ? '<div class="fbnote" style="margin:0 4px 10px">Wassertemperatur noch nicht geladen – Einstufung vorläufig.</div>' : '';
  box.innerHTML = warn + rows +
    '<div class="fbnote" style="margin-top:8px">Grobe Faustregeln aus Angler-Wissen &amp; Fachbeiträgen – keine Garantie. Tippe einen Fisch für die Begründung an.</div>';
}
function toggleBite(){
  const box=$("biteBox"), b=$("biteBtn"); if(!box) return;
  const show=(box.style.display==="none"||!box.style.display);
  if(show){ renderBite(); box.style.display="block"; if(b) b.textContent="🎯 Beißwetter ausblenden"; }
  else { box.style.display="none"; if(b) b.textContent="🎯 Beißwetter anzeigen"; }
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
  box.innerHTML=list.map(o=>'<button class="stpick" onclick="__stPick(\''+o.s.uuid+'\')">'+esc(o.s.name)+
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
/* Pegelstation eines Angelplatzes ändern */
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
  const hb=$("markHint"); if(hb){ hb.innerHTML="👆 Tippe die gewünschte Pegel-Station an (grauer Punkt)."; hb.style.display="block"; }
  setTimeout(()=>{ const m=document.getElementById("map"); if(m) m.scrollIntoView({behavior:"smooth", block:"center"}); }, 120);
}
function applyWaterType(sp){
  const isRiver = spotType(sp)==="fluss";
  ["pegelSect","pegelGrid","qSect","quality","qStamp","cond"].forEach(id=>{ const e=$(id); if(e) e.style.display = isRiver ? "" : "none"; });
  const bt=$("biteBtn"); if(bt) bt.style.display = isRiver ? "" : "none";
  if(!isRiver){ const bb=$("biteBox"); if(bb) bb.style.display="none"; }
  const wt=$("waterTempTile"); if(wt) wt.style.display = isRiver ? "none" : "";
  const hint=$("pegEditHint"); if(hint) hint.style.display = isRiver ? "" : "none";
}
function reflectStation(){
  const sp=loadSpots().find(x=>String(x.id)===String(localStorage.getItem(ACTIVE_KEY)));
  const typ=spotType(sp);
  const pre=$("pegPrefix"), pn=$("staPegName");
  if(typ!=="fluss"){                                  // See / Meer: kein Pegel
    if(pre) pre.textContent="Gewässer:";
    if(pn) pn.textContent=(sp&&sp.gewaesser? sp.gewaesser : "")+(typ==="see"?" (See)":" (Meer)");
    applyWaterType(sp);
    return;
  }
  if(pre) pre.textContent="Pegelstation:";
  const ps=$("pegelSect"); if(ps) ps.textContent="Fluss · Pegel "+CUR.name+" (PEGELONLINE)";
  const cs=$("curStation"); if(cs) cs.textContent = (sp? "Angelplatz: "+sp.name+" · " : "")+"Pegel "+CUR.name+" · km "+CUR.km;
  if(pn) pn.textContent = CUR.name + (CUR.river? " ("+CUR.river+")" : "");
  const mc=$("mapCo"); if(mc) mc.textContent="📍 Pegel "+CUR.name+" · "+CUR.lat.toFixed(4)+"° N, "+CUR.lon.toFixed(4)+"° O";
  const mo=$("mapOsm"); if(mo) mo.href="https://www.openstreetmap.org/?mlat="+WXPOS.lat+"&mlon="+WXPOS.lon+"#map=14/"+WXPOS.lat+"/"+WXPOS.lon;
  const mg=$("mapGmaps"); if(mg) mg.href="https://www.google.com/maps/search/?api=1&query="+WXPOS.lat+","+WXPOS.lon;
  applyWaterType(sp);
}
function updateStationMarker(){
  if(!MAP || !STATION_MARKER) return;
  STATION_MARKER.setLatLng([CUR.lat,CUR.lon]).bindPopup("Pegel "+CUR.name);
  try{ MAP.setView([WXPOS.lat, WXPOS.lon], MAP.getZoom()||13); }catch(e){}
}
function activateStationFor(uuid){ const s=STATIONS.find(x=>x.uuid===uuid); if(s){ CUR=s; delete HIST.pegel; delete HIST.durchfluss; delete HIST.wx; } }
/* gespeicherte Angelplätze */
function spotType(sp){ return (sp && sp.typ) ? sp.typ : "fluss"; }
function spotWaterLabel(s){
  const typ=spotType(s);
  if(typ==="see")  return "See · "+esc(s.gewaesser||s.river||"");
  if(typ==="meer") return "Meer · "+esc(s.gewaesser||s.river||"");
  return "Fluss · Pegel "+esc(s.station||"")+(s.river?" ("+esc(s.river)+")":"");
}
function loadSpots(){ try{ return JSON.parse(localStorage.getItem(SPOTS_KEY))||[]; }catch(e){ return []; } }
function saveSpots(a){ localStorage.setItem(SPOTS_KEY, JSON.stringify(a)); }
function newSpotOnMap(){
  SPOT_PICK=true;
  ensureMapVisible();
  const b=$("homeMapBtn"); if(b && $("homeView") && $("homeView").style.display!=="none") b.textContent="🗺️ Karte ausblenden";
  const hb=$("markHint"); if(hb){ hb.innerHTML="👆 Tippe auf deinen Angelplatz auf der Karte – danach kannst du ihn benennen."; hb.style.display="block"; }
  setTimeout(()=>{ const m=document.getElementById("map"); if(m) m.scrollIntoView({behavior:"smooth", block:"center"}); }, 120);
}
function pickAuto(){
  if(!navigator.geolocation){ alert("Ortung auf diesem Gerät nicht verfügbar."); return; }
  navigator.geolocation.getCurrentPosition(p=>{ createSpotAt(p.coords.latitude, p.coords.longitude); },
    ()=>alert("Ortung fehlgeschlagen."), {enableHighAccuracy:true, timeout:10000, maximumAge:0});
}
function createSpotAt(lat, lon){
  const name=(prompt("Name des Angelplatzes:","")||"").trim();
  if(!name) return;
  const t=(prompt("Gewässertyp?   1 = Fluss   2 = See   3 = Meer","1")||"").trim();
  const typ = t==="2" ? "see" : t==="3" ? "meer" : "fluss";
  const upsert=(base)=>{
    const spots=loadSpots();
    let sp=spots.find(x=>x.name.toLowerCase()===name.toLowerCase());
    if(sp) Object.assign(sp, base); else spots.push(base);
    saveSpots(spots); addSpotMarkers(); openSpot(base.id);
  };
  if(typ==="fluss"){
    openStationPicker(lat, lon, function(uuid){
      const st=STATIONS.find(x=>x.uuid===uuid) || nearestStation(lat,lon);
      const ex=loadSpots().find(x=>x.name.toLowerCase()===name.toLowerCase());
      upsert({id: ex?ex.id:Date.now(), name, lat:+lat.toFixed(6), lon:+lon.toFixed(6), typ:"fluss",
        uuid:st.uuid, station:st.name, river:st.river, gewaesser:st.river});
    });
  } else {
    const gw=(prompt("Name des Gewässers (z. B. Bodensee, Ostsee bei Kühlungsborn):","")||"").trim() || (typ==="see"?"See":"Meer");
    const ex=loadSpots().find(x=>x.name.toLowerCase()===name.toLowerCase());
    upsert({id: ex?ex.id:Date.now(), name, lat:+lat.toFixed(6), lon:+lon.toFixed(6), typ,
      uuid:null, station:"", river:gw, gewaesser:gw});
  }
}
function activateSpotById(id, latlon){
  const sp=loadSpots().find(x=>String(x.id)===String(id)); if(!sp) return;
  localStorage.setItem(ACTIVE_KEY, sp.id);
  activateStationFor(sp.uuid);
  const ll = latlon || spotLatLon(sp);
  WXPOS={ lat:ll[0], lon:ll[1] };
  reflectStation(); updateStationMarker(); populateCatchSpots(); renderSpots();
  updateFilterBtn(); updateFangbuchBtn(); refreshFangbuch();
  loadAll();
}
function loadSpot(id){ activateSpotById(id); }
function deleteSpot(id){
  if(!confirm("Angelplatz löschen?")) return;
  saveSpots(loadSpots().filter(x=>String(x.id)!==String(id)));
  if(String(localStorage.getItem(ACTIVE_KEY))===String(id)) localStorage.removeItem(ACTIVE_KEY);
  addSpotMarkers(); renderSpots(); populateCatchSpots();
}
function renderSpots(){
  const sel=$("spotSelect");
  const spots=loadSpots(), active=localStorage.getItem(ACTIVE_KEY);
  if(sel){
    if(!spots.length) sel.innerHTML='<option value="">— noch keiner —</option>';
    else { sel.innerHTML=spots.map(s=>'<option value="'+s.id+'">🎣 '+esc(s.name)+'</option>').join("");
      if(active && spots.some(s=>String(s.id)===String(active))) sel.value=active; }
  }
  renderSpotList();
}
function renderSpotList(){
  const box=$("spotList"); if(!box) return;
  const spots=loadSpots();
  if(!spots.length){ box.innerHTML='<div class="fbnote" style="padding:10px 4px">Noch kein Angelplatz – lege deinen ersten an (Knöpfe unten).</div>'; return; }
  box.innerHTML=spots.map(s=>'<div class="spotrow"><button class="spotopen" onclick="openSpot('+s.id+')">🎣 '+esc(s.name)+
    '<span class="spotsub">'+spotWaterLabel(s)+'</span></button>'+
    countBadge(fishCountForSpot(s.name), tripCountForSpot(s.name))+
    '<button class="spotdel" title="löschen" onclick="deleteSpotFromList('+s.id+')">✕</button></div>').join("");
}
function deleteSpotFromList(id){ deleteSpot(id); renderSpotList(); }
/* Ansichten: Start (Liste) · Angelplatz (Daten) · Mein Fangbuch (alle Fänge) */
function hideAllViews(){ ["homeView","spotView","mapCard","fbIndexView","catchListView","baitView","statsView"].forEach(id=>{ const e=$(id); if(e) e.style.display="none"; }); }
function showHome(){
  hideAllViews();
  const h=$("homeView"); if(h) h.style.display="block";
  const b=$("homeMapBtn"); if(b) b.textContent="🗺️ Karte anzeigen";
  renderSpotList();
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
  let html='<div class="spotrow"><button class="spotopen" onclick="showCatchList(null)">📚 Gesamtfangbuch'+
    '<span class="spotsub">alle Angelplätze</span></button>'+countBadge(totalFish(), totalTrips())+'</div>';
  if(spots.length){
    html+=spots.map(s=>'<div class="spotrow"><button class="spotopen" onclick="showCatchListBySpot('+s.id+')">📒 '+esc(s.name)+' Fangbuch'+
      '<span class="spotsub">'+spotWaterLabel(s)+'</span></button>'+
      countBadge(fishCountForSpot(s.name), tripCountForSpot(s.name))+'</div>').join("");
  } else {
    html+='<div class="fbnote" style="padding:10px 4px">Noch keine Angelplätze – lege zuerst einen an.</div>';
  }
  box.innerHTML=html;
}
function showCatchListBySpot(id){ const sp=loadSpots().find(x=>String(x.id)===String(id)); showCatchList(sp?sp.name:null); }
function showCatchList(spotName){
  CATCH_VIEW_SPOT = spotName || null;
  hideAllViews();
  const v=$("catchListView"); if(v) v.style.display="block";
  renderCatchList();
  setActiveTab("fb");
  window.scrollTo({top:0, behavior:"smooth"});
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
/* Köder = Kategorien mit Varianten: [{base, variants:[{size,color}]}] (migriert alte Formate) */
function loadBaits(){
  let raw=[]; try{ raw=JSON.parse(localStorage.getItem(BAIT_KEY))||[]; }catch(e){ raw=[]; }
  const cats=[], idx={};
  const cat=(base)=>{ base=String(base||"").trim(); if(!base) return null; const k=base.toLowerCase();
    if(!(k in idx)){ idx[k]=cats.length; cats.push({base, variants:[]}); } return cats[idx[k]]; };
  const addV=(c,size,color)=>{ if(!c) return; size=(size||"").trim(); color=(color||"").trim(); if(!size&&!color) return;
    const key=(size+"|"+color).toLowerCase(); if(!c.variants.some(v=>(v.size+"|"+v.color).toLowerCase()===key)) c.variants.push({size,color}); };
  raw.forEach(it=>{
    if(typeof it==="string"){ cat(it); }
    else if(it && Array.isArray(it.variants)){ const c=cat(it.base); if(c) it.variants.forEach(v=>addV(c, v.size, v.color)); }
    else if(it && it.base){ addV(cat(it.base), it.size, it.color); }   // altes Flachformat {base,size,color}
  });
  return cats;
}
function saveBaits(cats){ try{ localStorage.setItem(BAIT_KEY, JSON.stringify(cats)); }catch(e){} }
const BAIT_INIT_KEY="deepfish_koeder_init_v1";
const DEFAULT_BAITS=["Tauwurm","Rotwurm","Made","Mais","Boilie","Brot","Käse",
  "Köderfisch","Gummifisch","Wobbler","Spinner","Blinker","Twister","Fliege"].map(b=>({base:b, variants:[]}));
function ensureBaitSeed(){                         // Standardköder als Startpunkt (einmalig)
  if(localStorage.getItem(BAIT_INIT_KEY)) return;
  if(!loadBaits().length) saveBaits(DEFAULT_BAITS.slice());
  localStorage.setItem(BAIT_INIT_KEY,"1");
}
function baitIcon(text){
  const s=String(text||"").toLowerCase();
  if(/tauwurm|rotwurm|dendro|wurm/.test(s)) return "🪱";
  if(/made|maden/.test(s)) return "🐛";
  if(/mais/.test(s)) return "🌽";
  if(/boilie|pellet/.test(s)) return "🔴";
  if(/brot|teig/.test(s)) return "🍞";
  if(/k(ä|ae)se/.test(s)) return "🧀";
  if(/k(ö|oe)derfisch|fischfetzen|k(ö|oe)fi/.test(s)) return "🐟";
  if(/gummifisch|gummi|shad|kaulquappe/.test(s)) return "🐠";
  if(/wobbler|crank|jerk/.test(s)) return "🐡";
  if(/spinner/.test(s)) return "✨";
  if(/blinker|l(ö|oe)ffel|spoon/.test(s)) return "🥄";
  if(/twister|twist/.test(s)) return "🌀";
  if(/fliege|streamer|nymphe/.test(s)) return "🪰";
  return "🎣";
}
function variantLabel(base, v){ return base + (v&&v.size?(" "+v.size):"") + (v&&v.color?(", "+v.color):""); }
/* Anzahl Fänge je Köder: Kategorie = alle Varianten (Präfix), Variante = exakt. Nur echte Fänge. */
function koederCatchCount(text, isCat){
  const t=String(text||"").toLowerCase().trim(); if(!t) return 0;
  return loadCatches().filter(c=>{ if(!isFish(c)) return false; const k=(c.koeder||"").toLowerCase().trim();
    return isCat ? (k===t || k.indexOf(t+" ")===0 || k.indexOf(t+",")===0) : k===t; }).length;
}
function countBadgeFish(n){ return '<span class="countbadge" title="Fänge mit diesem Köder"><span class="fishico">🐟</span>'+n+'</span>'; }
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
  const cats=loadBaits();
  if(!cats.some(c=>c.base.toLowerCase()===base.toLowerCase())) cats.push({base, variants:[]});
  saveBaits(cats); inp.value=""; BAIT_OPEN[base.toLowerCase()]=true; renderBaitList(); inp.focus();
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
  const box=$("baitList"); if(!box) return;
  if(!cats.length){ box.innerHTML='<div class="fbnote" style="padding:10px 4px">Noch keine Köder – lege oben eine Kategorie an.</div>'; return; }
  box.innerHTML=cats.map((c,i)=>{
    const open=!!BAIT_OPEN[c.base.toLowerCase()];
    let h='<div class="baitcat"><div class="baitcatrow">'+
      '<button class="baitcathead" onclick="toggleBaitCat('+i+')"><span class="tw">'+(open?'▾':'▸')+'</span> '+
        baitIcon(c.base)+' '+esc(c.base)+' <small>'+c.variants.length+' Variante'+(c.variants.length===1?'':'n')+'</small></button>'+
      countBadgeFish(koederCatchCount(c.base,true))+
      '<button class="spotdel" title="Köder löschen" onclick="deleteBaitCat('+i+')">✕</button></div>';
    if(open){
      h+='<div class="baitvars">';
      h+=c.variants.map((v,j)=>{ const lbl=variantLabel(c.base,v);
        return '<div class="baitvar"><span class="vlabel">'+esc(lbl)+'</span>'+countBadgeFish(koederCatchCount(lbl,false))+
          '<button class="spotdel" onclick="deleteBaitVar('+i+','+j+')">✕</button></div>'; }).join("");
      h+='<div class="baitvaradd">'+
         '<input id="var_size_'+i+'" placeholder="Größe, z. B. 5 cm">'+
         '<input id="var_color_'+i+'" placeholder="Farbe, z. B. braun" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addVariant('+i+');}">'+
         '<button onclick="addVariant('+i+')">+ Variante</button></div>';
      h+='</div>';
    }
    return h+'</div>';
  }).join("");
  populateKoeder();
}
/* Köder-Auswahl im Fangformular: Kategorie -> Varianten */
function populateKoeder(){
  const bsel=$("f_koeder_base"); if(!bsel) return;
  const cats=loadBaits(), cur=bsel.value;
  bsel.innerHTML='<option value="">— Köder —</option>'+cats.map(c=>'<option value="'+esc(c.base)+'">'+baitIcon(c.base)+' '+esc(c.base)+'</option>').join("");
  if(cur && cats.some(c=>c.base===cur)) bsel.value=cur;
  onKoederBaseChange();
}
function onKoederBaseChange(){
  const bsel=$("f_koeder_base"), vsel=$("f_koeder_var"); if(!vsel) return;
  const base=bsel?bsel.value:"";
  const c=loadBaits().find(x=>x.base===base);
  if(!base || !c || !c.variants.length){
    vsel.innerHTML='<option value="">'+(base?'— ohne Variante —':'— erst Köder wählen —')+'</option>';
    vsel.disabled=!base; return;
  }
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
  const body = arr.length ? arr.map(s=>(withIcon?baitIcon(s.key)+' ':'')+esc(s.key)+' <b>'+s.count+'</b>').join(" · ") : "–";
  return '<div class="statline"><span class="statk">'+k+'</span>'+body+'</div>';
}
function renderStats(){
  const box=$("statsBody"); if(!box) return;
  const fc=fishCatches();
  if(!fc.length){ box.innerHTML='<div class="fbnote" style="padding:10px 4px">Noch keine Fänge – sobald du welche einträgst, erscheint hier die Auswertung: beste Plätze und fängigste Köder je Fischart.</div>'; return; }
  let html='<div class="statcard"><div class="stath">📊 Überblick <span class="statn">'+fc.length+' Fänge · '+loadCatches().length+' Trips</span></div>'+
    statLine("🎣 Beste Plätze", topBy(fc, c=>c.angelplatz, 3), false)+
    statLine("🪱 Fängigste Köder", topBy(fc, c=>c.koeder, 3), true)+'</div>';
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
  if(sv) sv.style.display="block";
  if(mc) mc.style.display="block";
  initMap();
  setTimeout(()=>{ try{ if(MAP) MAP.invalidateSize(); }catch(e){} }, 80);
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
  const m=$("mapCard"); if(!m) return;
  const hidden = (m.style.display==="none" || m.style.display==="");
  const b=$("homeMapBtn");
  if(hidden){ ensureMapVisible(); if(b) b.textContent="🗺️ Karte ausblenden"; m.scrollIntoView({behavior:"smooth", block:"start"}); }
  else { m.style.display="none"; if(b) b.textContent="🗺️ Karte anzeigen"; }
}
function fbTitle(){ const n=activeSpotName(); return (n? n+" " : "")+"Fangbuch"; }
function updateFangbuchBtn(){
  const b=$("fangbuchBtn"); if(!b) return;
  const box=$("fangbuchBox"); const shown = box && box.style.display && box.style.display!=="none";
  b.textContent="📒 "+fbTitle()+(shown?" ausblenden":" anzeigen");
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
function populateCatchSpots(){
  const sel=$("f_angelplatz"); if(!sel) return;
  const spots=loadSpots(), active=localStorage.getItem(ACTIVE_KEY);
  if(!spots.length){ sel.innerHTML='<option value="">— kein Angelplatz gespeichert —</option>'; return; }
  sel.innerHTML='<option value="">— keiner —</option>'+spots.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join("");
  if(active && spots.some(s=>String(s.id)===String(active))) sel.value=active;
  const asp=spots.find(x=>String(x.id)===String(active));
  const gw=$("f_gewaesser"); if(gw && asp) gw.value = asp.gewaesser || asp.river || "";
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
  const typ = spotType(activeSpot());
  if(typ==="fluss"){
    snap.marineTemp=null;
    await Promise.allSettled([loadPegel(), loadWeather(), loadQuality()]);
    updateAmpel();
    if($("biteBox") && $("biteBox").style.display==="block") renderBite();
  } else {
    snap.pegel=null; snap.q=null;
    await Promise.allSettled([loadWeather(), loadMarine()]);
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
  initFangbuch();                             // Formular, Karte (Stationen + Angelplätze)
  showHome();                                 // Startbildschirm: nur Angelplatz-Liste
  setInterval(()=>{ if($("spotView") && $("spotView").style.display!=="none") loadAll(); }, 10*60*1000);
}
boot();
