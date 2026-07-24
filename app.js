"use strict";

/* Wasserqualitäts-Werte werden beim Laden aus wasserwerte.json geholt.
   Die GitHub-Action aktualisiert diese Datei alle 3 Stunden. Nur Startwert: */
window.WQ_DATA = { "updated": "", "items": [] };

const RHEIN_UUID = "a37a9aa3-45e9-4d90-9df6-109f3a28a5af"; // Pegel MAINZ, Rhein
const LAT = 50.004, LON = 8.271;
const STATION = {lat:50.0068, lon:8.2795};
const PO = "https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations/" + RHEIN_UUID;

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
const snap = { weather:null, pegel:null, q:null };  // Momentaufnahme für Fänge
let CURRENT_GPS = null;

// Amtliche Hauptwerte Pegel Mainz (Zeitreihe 2010–2020, Quelle: PEGELONLINE), in cm
const PEGEL_REF = { MNW:159, MW:288, MHW:547 };
function classifyPegel(w){
  const {MNW,MW,MHW}=PEGEL_REF;
  const loMid=(MNW+MW)/2, hiMid=(MW+MHW)/2;
  if(w<MNW)   return {t:"sehr niedrig", c:"pg-red"};
  if(w<loMid) return {t:"niedrig",      c:"pg-amber"};
  if(w<hiMid) return {t:"normal",       c:"pg-green"};
  if(w<MHW)   return {t:"hoch",         c:"pg-amber"};
  return              {t:"sehr hoch",   c:"pg-red"};
}

async function loadPegel(){
  try{
    const w = await getJSON(PO+"/W/measurements.json?start=P2D");
    const last = w[w.length-1];
    $("pegelVal").innerHTML = fmt(last.value)+' <small>cm</small>';
    const pc = classifyPegel(last.value);
    $("pegelMeta").innerHTML = '<span class="pgbadge '+pc.c+'" title="Einordnung nach Hauptwerten Pegel Mainz: MNW 159 · MW 288 · MHW 547 cm">'+pc.t+'</span>'+trendBadge(w)+' · '+relTime(last.timestamp);
    sparkline($("pegelSpark"), w.slice(-96), "#38bdf8");
    const pt=$("tilePegel"); if(pt) pt.style.borderTopColor = stripeColor(pc.c);
    state.pegelTrend = w;
    snap.pegel = { pegelstand_cm: last.value, stufe: pc.t };
  }catch(e){ $("pegelVal").innerHTML='<span class="err">n/v</span>'; $("pegelMeta").textContent="Pegel nicht erreichbar"; }
  try{
    const q = await getJSON(PO+"/Q/measurements.json?start=P2D");
    const last = q[q.length-1];
    $("qVal").innerHTML = fmt(last.value)+' <small>m³/s</small>';
    $("qMeta").innerHTML = trendBadge(q)+' · '+relTime(last.timestamp);
    sparkline($("qSpark"), q.slice(-96), "#2dd4bf");
    snap.q = last.value;
  }catch(e){ $("qVal").innerHTML='<span class="err">n/v</span>'; $("qMeta").textContent="Durchfluss nicht erreichbar"; }
}

async function loadWeather(){
  const url = "https://api.open-meteo.com/v1/forecast?latitude="+LAT+"&longitude="+LON+
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
  const t = STATION.lat+", "+STATION.lon;
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
  const d=window.WQ_DATA||{items:[]};
  const items=(d.items||[]).filter(it=> it.label!=="pH-Wert" && it.label!=="Leitfähigkeit");
  if(!items.length){
    box.innerHTML='<div class="qtile"><div class="lbl">🌡️ Wasserqualität</div>'+
      '<div class="hint">Noch keine Werte importiert. Der 3-Stunden-Job füllt sie automatisch – oder öffne die amtliche Live-Ansicht.</div>'+
      '<a class="go" target="_blank" rel="noopener" href="https://geodaten-wasser.rlp-umwelt.de/gus/2511510500/messwerte">Live-Wert öffnen ↗</a></div>';
    return;
  }
  box.innerHTML = items.map(it=>{
    const cls=classifyWQ(it.label, deNum(it.value));
    const badge = cls ? '<span class="pgbadge '+cls.c+'">'+cls.t+'</span>' : '';
    const stripe = cls ? stripeColor(cls.c) : "var(--water)";
    return '<div class="tile" style="border-top-color:'+stripe+'"><div class="lbl">'+(it.icon||"•")+' '+it.label+'</div>'+
      '<div class="val">'+it.value+' <small>'+(it.unit||"")+'</small></div>'+
      '<div class="meta">'+badge+'Stand: '+(it.time||"–")+'</div></div>';
  }).join("");
  const st=$("qStamp");
  if(st && d.updated){ st.innerHTML='Importiert am '+d.updated+' aus dem RLP-Portal · '+
    '<a href="https://geodaten-wasser.rlp-umwelt.de/gus/2511510500/messwerte" target="_blank" rel="noopener">Amtliche Live-Ansicht ↗</a>'; }
}

async function loadQuality(){
  try{
    const r = await fetch("wasserwerte.json?t="+Math.floor(Date.now()/300000), {cache:"no-store"});
    if(r.ok){ const j = await r.json(); if(j && Array.isArray(j.items)){ window.WQ_DATA = j; } }
  }catch(e){ /* z.B. lokal ohne Server geöffnet – dann Startwert/Hinweis */ }
  renderQuality();
}

/* ===================== Fangbuch ===================== */
const CATCH_KEY = "rheincheck_faenge_v1";
function loadCatches(){ try{ return JSON.parse(localStorage.getItem(CATCH_KEY)) || []; }catch(e){ return []; } }
function saveCatches(a){ try{ localStorage.setItem(CATCH_KEY, JSON.stringify(a)); }catch(e){ alert("Speichern fehlgeschlagen (Speicher voll?)."); } }
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
  const out={ stand: (window.WQ_DATA&&window.WQ_DATA.updated)||"" };
  ((window.WQ_DATA&&window.WQ_DATA.items)||[]).forEach(it=>{ const k=M[it.label]; if(k) out[k]=deNum(it.value); });
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

function saveCatch(){
  const art=$("f_art").value.trim();
  if(!art){ alert("Bitte eine Fischart eintragen."); $("f_art").focus(); return; }
  const datum=$("f_datum").value, zeit=$("f_zeit").value;
  const dObj = datum ? new Date(datum+"T"+(zeit||"12:00")) : new Date();
  const mp=moonPhase(dObj);
  const rec={
    id: Date.now(),
    erfasst_iso: new Date().toISOString(),
    gewaesser: $("f_gewaesser").value.trim() || "Rhein (Mainz/Wiesbaden)",
    datum, uhrzeit: zeit,
    fischart: art,
    groesse_cm: $("f_groesse").value ? +$("f_groesse").value : null,
    gewicht_g: $("f_gewicht").value ? +$("f_gewicht").value : null,
    koeder: $("f_koeder").value.trim(),
    methode: $("f_methode").value.trim(),
    notiz: $("f_notiz").value.trim(),
    gps: CURRENT_GPS,
    mondphase: { name:mp.name, alter_tage:mp.age, illumination_pct:mp.illum },
    wetter: snap.weather,
    wasser: Object.assign({
      pegelstand_cm: snap.pegel? snap.pegel.pegelstand_cm : null,
      pegel_stufe: snap.pegel? snap.pegel.stufe : null,
      durchfluss_m3s: snap.q
    }, waterQualitySnap()),
    station: { pegel:"MAINZ", guete:"Mainz-Wiesbaden" }
  };
  const arr=loadCatches(); arr.push(rec); saveCatches(arr);
  $("f_art").value=""; $("f_groesse").value=""; $("f_gewicht").value=""; $("f_koeder").value=""; $("f_notiz").value="";
  const now=new Date(), pad=n=>String(n).padStart(2,'0');
  $("f_zeit").value=pad(now.getHours())+':'+pad(now.getMinutes());
  clearSelectedLocation();
  refreshFangbuch();
}

function deleteCatch(id){
  if(!confirm("Diesen Fang löschen?")) return;
  saveCatches(loadCatches().filter(c=>c.id!==id));
  refreshFangbuch();
}

function renderCatches(){
  const arr=loadCatches().sort((a,b)=>((b.datum||"")+(b.uhrzeit||"")).localeCompare((a.datum||"")+(a.uhrzeit||"")));
  $("fbCount").textContent = arr.length+" Fang"+(arr.length===1?"":"e")+" gespeichert";
  const box=$("fbList");
  if(!arr.length){ box.innerHTML='<div class="fbnote" style="padding:8px 4px">Noch keine Fänge – trag deinen ersten Fang oben ein.</div>'; return; }
  box.innerHTML = arr.map(c=>{
    const w=c.wetter||{}, wa=c.wasser||{}, cond=[];
    if(wa.wassertemperatur_c!=null) cond.push("Wasser "+wa.wassertemperatur_c+" °C");
    if(wa.pegelstand_cm!=null) cond.push("Pegel "+wa.pegelstand_cm+" cm"+(wa.pegel_stufe?" ("+wa.pegel_stufe+")":""));
    if(wa.sauerstoff_mgl!=null) cond.push("O₂ "+wa.sauerstoff_mgl+" mg/l");
    if(w.lufttemperatur_c!=null) cond.push("Luft "+w.lufttemperatur_c+" °C");
    if(w.luftdruck_hpa!=null) cond.push(Math.round(w.luftdruck_hpa)+" hPa");
    if(w.wetterlage) cond.push(w.wetterlage);
    if(c.mondphase&&c.mondphase.name) cond.push(c.mondphase.name);
    return '<div class="fbitem"><div class="h"><span class="fish">🐟 '+esc(c.fischart)+
      (c.groesse_cm?' · '+c.groesse_cm+' cm':'')+(c.gewicht_g?' · '+c.gewicht_g+' g':'')+'</span>'+
      '<button class="del" onclick="deleteCatch('+c.id+')">löschen ✕</button></div>'+
      '<div class="when">'+esc(c.datum||"")+' '+esc(c.uhrzeit||"")+' · '+esc(c.gewaesser||"")+
      (c.koeder?' · '+esc(c.koeder):'')+(c.methode?' · '+esc(c.methode):'')+(c.gps?' · 📍':'')+'</div>'+
      (cond.length?'<div class="cond">'+esc(cond.join(" · "))+'</div>':'')+
      (c.notiz?'<div class="cond">„'+esc(c.notiz)+'"</div>':'')+'</div>';
  }).join("");
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
    ["id",c=>c.id],["datum",c=>c.datum],["uhrzeit",c=>c.uhrzeit],["gewaesser",c=>c.gewaesser],["fischart",c=>c.fischart],
    ["groesse_cm",c=>c.groesse_cm],["gewicht_g",c=>c.gewicht_g],["koeder",c=>c.koeder],["methode",c=>c.methode],["notiz",c=>c.notiz],
    ["gps_lat",c=>c.gps?c.gps.lat:""],["gps_lon",c=>c.gps?c.gps.lon:""],["gps_genauigkeit_m",c=>c.gps?c.gps.genauigkeit_m:""],
    ["mondphase",c=>c.mondphase?c.mondphase.name:""],["mond_illum_pct",c=>c.mondphase?c.mondphase.illumination_pct:""],
    ["lufttemp_c",c=>W_(c,"lufttemperatur_c")],["gefuehlt_c",c=>W_(c,"gefuehlt_c")],["wind_kmh",c=>W_(c,"wind_kmh")],
    ["windrichtung",c=>W_(c,"windrichtung")],["boen_kmh",c=>W_(c,"boen_kmh")],["luftdruck_hpa",c=>W_(c,"luftdruck_hpa")],
    ["luftdruck_tendenz_3h_hpa",c=>W_(c,"luftdruck_tendenz_3h_hpa")],["bewoelkung_pct",c=>W_(c,"bewoelkung_pct")],
    ["luftfeuchte_pct",c=>W_(c,"luftfeuchte_pct")],["niederschlag_mm_h",c=>W_(c,"niederschlag_mm_h")],["wetterlage",c=>W_(c,"wetterlage")],
    ["pegel_cm",c=>A_(c,"pegelstand_cm")],["pegel_stufe",c=>A_(c,"pegel_stufe")],["durchfluss_m3s",c=>A_(c,"durchfluss_m3s")],
    ["wassertemp_c",c=>A_(c,"wassertemperatur_c")],["sauerstoff_mgl",c=>A_(c,"sauerstoff_mgl")],["o2_saettigung_pct",c=>A_(c,"o2_saettigung_pct")],
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
function initMap(){
  if(MAP || !window.L || !document.getElementById("map")) return;
  MAP = L.map("map",{scrollWheelZoom:false}).setView([STATION.lat, STATION.lon], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(MAP);
  L.circleMarker([STATION.lat,STATION.lon],{radius:7,color:"#38bdf8",weight:2,fillColor:"#38bdf8",fillOpacity:.9})
    .addTo(MAP).bindPopup("Messstation Mainz-Wiesbaden");
  CATCH_LAYER=L.layerGroup().addTo(MAP);
  MAP.on("click", e=>{
    setSelectedLocation(e.latlng.lat, e.latlng.lng, null, false);
    MARKING=false;
    const hb=$("markHint");
    if(hb){ hb.innerHTML='✓ Fangort markiert. <a href="#" onclick="scrollToSave();return false;">↑ zum Speichern</a>'; hb.style.display="block"; }
  });
  renderMarkers();
}
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
  const cs=loadCatches().filter(c=>c.gps&&c.gps.lat!=null);
  cs.forEach(c=>{
    const wa=c.wasser||{};
    const html='<b>🐟 '+esc(c.fischart||"Fang")+'</b>'+(c.groesse_cm?' · '+c.groesse_cm+' cm':'')+
      '<br>'+esc(c.datum||"")+' '+esc(c.uhrzeit||"")+(c.koeder?'<br>Köder: '+esc(c.koeder):'')+
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
  const arr=loadCatches().sort((a,b)=>((b.datum||"")+(b.uhrzeit||"")).localeCompare((a.datum||"")+(a.uhrzeit||"")));
  if(!arr.length){ box.innerHTML='<div class="fbnote" style="padding:8px 4px">Noch keine Fänge.</div>'; return; }
  const rows=arr.map(c=>{
    const ort = c.gps ? (c.gps.lat+', '+c.gps.lon) : esc(c.gewaesser||"");
    return '<tr><td>'+esc(c.datum||"")+'</td><td>'+esc(c.uhrzeit||"")+'</td><td>'+esc(c.fischart||"")+'</td>'+
      '<td>'+(c.groesse_cm!=null?c.groesse_cm:"")+'</td><td>'+(c.gewicht_g!=null?c.gewicht_g:"")+'</td>'+
      '<td>'+esc(c.koeder||"")+'</td><td>'+ort+'</td></tr>';
  }).join("");
  box.innerHTML='<div class="fbwrap"><table class="fbtable"><thead><tr>'+
    '<th>Datum</th><th>Zeit</th><th>Fischart</th><th>cm</th><th>g</th><th>Köder</th><th>Ort</th></tr></thead>'+
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
  if(b) b.textContent = show ? "🐟 Fänge ausblenden" : "🐟 Fänge anzeigen";
}
function refreshFangbuch(){
  renderCatches(); renderMarkers();
  if($("fbTable") && $("fbTable").style.display==="block") renderTable();
}

function initFangbuch(){
  const now=new Date(), pad=n=>String(n).padStart(2,'0');
  if($("f_datum")) $("f_datum").value = now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  if($("f_zeit")) $("f_zeit").value = pad(now.getHours())+':'+pad(now.getMinutes());
  refreshFangbuch();
  initMap();
}

async function loadAll(){
  $("updated").textContent = "aktualisiere …";
  await Promise.allSettled([loadPegel(), loadWeather(), loadQuality()]);
  updateAmpel();
  $("updated").textContent = "Stand: " + new Date().toLocaleString("de-DE",{dateStyle:"short",timeStyle:"short"}) + " Uhr";
}
loadAll();
setInterval(loadAll, 10*60*1000);
initFangbuch();
